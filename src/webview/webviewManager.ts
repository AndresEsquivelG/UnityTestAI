import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { collectClassAndMethod } from "../collectInputs";
import { ChatSession, type ChatMessage } from "../llm/sessionManager";
import {
  generateWithChatGPT,
  generateWithOllama,
  generateWithClaude,
  type LLMResult,
} from "../llm";
import type { ActiveEcosystem } from "../core/adapters";
import { readArtifact } from "../core/project";
import type { VerificationOutcome } from "../core/verification";
import {
  checkGeneratedTest,
  generateTest,
  runAndMeasure,
  type CheckStage,
  type EditorSelection,
  type GeneratedTest,
  type PipelineEvent,
} from "../pipeline";
import { runChatFixer } from "../agents/chatFixer";
import { saveAgentOutput } from "../agents/agentOutputSaver";

// ── Per-panel state ────────────────────────────────────────────────────────────

const sessionsByPanel = new WeakMap<vscode.WebviewPanel, ChatSession>();

const generationMetaByPanel = new WeakMap<
  vscode.WebviewPanel,
  {
    className: string;
    methodName: string;
    model: string;
    subModel: string | null;
  }
>();

/** Lo que dejó la última generación de cada panel, para verificar y corregir. */
const testContextByPanel = new WeakMap<vscode.WebviewPanel, GeneratedTest>();

/**
 * Plantilla del informe de cobertura. Empaquetado, este módulo queda en
 * `dist/`, y la plantilla en `ui/coverage/`, como las plantillas de prompt
 * en `prompts/`.
 */
const COVERAGE_TEMPLATE = path.join(__dirname, "..", "ui", "coverage", "report.html");

/** Informe HTML de la última medición de cada panel, si se pudo escribir. */
const coverageReportByPanel = new WeakMap<
  vscode.WebviewPanel,
  { path: string; title: string }
>();

/** Pestaña con el informe de cobertura de cada panel, mientras esté abierta. */
const coverageTabByPanel = new WeakMap<vscode.WebviewPanel, vscode.WebviewPanel>();

/**
 * Paneles con una verificación en curso, con su corrección automática. Mientras
 * tanto no se acepta otra cosa que escriba la prueba: el corrector del chat o
 * una generación nueva pisarían el archivo a mitad del ciclo.
 */
const verifyingPanels = new WeakSet<vscode.WebviewPanel>();

/**
 * Estado de la última verificación de cada panel. Reintentar solo la
 * ejecución tiene que saber si la prueba compiló, sin volver a compilarla.
 */
const verificationStatusByPanel = new WeakMap<
  vscode.WebviewPanel,
  VerificationOutcome["status"]
>();

const tokenTotalsByPanel = new WeakMap<
  vscode.WebviewPanel,
  { inputTokens: number; outputTokens: number }
>();

function addTokenUsage(
  panel: vscode.WebviewPanel,
  usage: { inputTokens: number; outputTokens: number },
) {
  const totals = tokenTotalsByPanel.get(panel) ?? {
    inputTokens: 0,
    outputTokens: 0,
  };
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  tokenTotalsByPanel.set(panel, totals);
}

/** Copia de los totales: `addTokenUsage` modifica el objeto guardado. */
function tokenTotals(panel: vscode.WebviewPanel) {
  const totals = tokenTotalsByPanel.get(panel);
  return {
    inputTokens: totals?.inputTokens ?? 0,
    outputTokens: totals?.outputTokens ?? 0,
  };
}

// ── Model handlers ─────────────────────────────────────────────────────────────

type ModelProvider = (
  messages: ChatMessage[],
  subModel?: string,
) => Promise<LLMResult>;

const modelProviders: Record<string, ModelProvider> = {
  chatgpt: (messages, subModel) =>
    generateWithChatGPT(messages, subModel || "gpt-4o-mini"),
  llamaLocal: (messages) => generateWithOllama(messages),
  claude: (messages, subModel) =>
    generateWithClaude(messages, subModel || "claude-haiku-4-5"),
};

/**
 * Llamada sin historial. Los prompts de los agentes son autocontenidos: el
 * historial solo multiplicaba los tokens de entrada y, con ventanas chicas,
 * hacía que el servidor recortara el prompt del agente actual.
 */
async function askOnce(
  provider: ModelProvider,
  prompt: string,
  panel: vscode.WebviewPanel,
  subModel?: string,
): Promise<string> {
  const { text, usage } = await provider(
    [{ role: "user", content: prompt }],
    subModel,
  );
  addTokenUsage(panel, usage);
  return text;
}

/** Llamada dentro de la conversación del panel, que sí necesita historial. */
async function askInChat(
  provider: ModelProvider,
  message: string,
  panel: vscode.WebviewPanel,
  subModel?: string,
): Promise<string> {
  let session = sessionsByPanel.get(panel);
  if (!session) {
    session = new ChatSession();
    sessionsByPanel.set(panel, session);
  }
  session.addUserMessage(message);
  const { text, usage } = await provider(session.getMessages(), subModel);
  session.addAssistantMessage(text);
  addTokenUsage(panel, usage);
  return text;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Verifica la prueba del panel, la corrige si hace falta, la ejecuta y mide su
 * cobertura (ver `checkGeneratedTest`). Mientras tanto el panel queda ocupado:
 * el corrector del chat o una generación nueva pisarían el archivo a mitad del
 * ciclo.
 */
async function verifyInPanel(
  panel: vscode.WebviewPanel,
  ecosystem: ActiveEcosystem,
) {
  const testCtx = testContextByPanel.get(panel);
  const meta = generationMetaByPanel.get(panel);
  const provider = meta && modelProviders[meta.model];
  if (!testCtx || !meta || !provider || verifyingPanels.has(panel)) {
    return;
  }
  verifyingPanels.add(panel);
  const subModel = meta.subModel ?? undefined;

  try {
    await checkGeneratedTest({
      adapter: ecosystem.adapter,
      test: testCtx,
      className: meta.className,
      methodName: meta.methodName,
      ask: (prompt) => askOnce(provider, prompt, panel, subModel),
      tokenTotals: () => tokenTotals(panel),
      coverageTemplate: COVERAGE_TEMPLATE,
      onEvent: (event) => showPipelineEvent(panel, event),
    });
  } finally {
    verifyingPanels.delete(panel);
  }
}

/** Mensaje con el que la interfaz muestra que una etapa está corriendo. */
const RUNNING_COMMAND: Record<CheckStage, string> = {
  verification: "verificationRunning",
  testRun: "testRunRunning",
  coverage: "coverageRunning",
};

/**
 * Muestra en el panel un aviso del pipeline, con el mensaje que la interfaz ya
 * sabe mostrar, y guarda lo que el panel necesita después: la prueba
 * corregida, el estado de la verificación y el informe de cobertura.
 */
function showPipelineEvent(panel: vscode.WebviewPanel, event: PipelineEvent) {
  switch (event.kind) {
    case "generationStarted":
      panel.webview.postMessage({ command: "clearPipeline" });
      break;

    case "agent":
      notifyAgent(panel, event.agent, event.status, event.detail);
      break;

    case "dependencyFiles":
      panel.webview.postMessage({ command: "dependencyFiles", files: event.files });
      break;

    case "contextSlices":
      panel.webview.postMessage({
        command: "contextBuilderSlices",
        slices: event.slices,
      });
      break;

    case "stageRunning":
      panel.webview.postMessage({
        command: RUNNING_COMMAND[event.stage],
        stageName: event.stageName,
      });
      break;

    case "verification":
      panel.webview.postMessage({
        command: "showVerification",
        verification: event.presentation,
      });
      break;

    case "verified":
      verificationStatusByPanel.set(panel, event.status);
      break;

    case "testCodeUpdated": {
      const testCtx = testContextByPanel.get(panel);
      if (testCtx) {
        testContextByPanel.set(panel, { ...testCtx, testCode: event.code });
      }
      panel.webview.postMessage({ command: "updateResult", result: event.code });
      break;
    }

    case "testRun":
      panel.webview.postMessage({ command: "showTestRun", testRun: event.presentation });
      // La medición que sigue reemplaza al informe anterior: mientras corre,
      // el botón no tiene que abrir números viejos.
      coverageReportByPanel.delete(panel);
      break;

    case "coverage": {
      if (event.report) {
        coverageReportByPanel.set(panel, event.report);
      }

      // Una pestaña abierta con la medición anterior se pone al día, o se cierra
      // si esta no dejó informe: tampoco ahí quedan números viejos.
      const tab = coverageTabByPanel.get(panel);
      const report = coverageReportByPanel.get(panel);
      if (tab && report) {
        showCoverageReport(tab, report);
      } else if (tab) {
        coverageTabByPanel.delete(panel);
        tab.dispose();
      }

      panel.webview.postMessage({
        command: "showCoverage",
        coverage: event.presentation,
        reportAvailable: !!report,
      });
      break;
    }
  }
}

/**
 * Abre el informe de cobertura del panel en una pestaña de VS Code, o trae al
 * frente la que ya lo muestra. No va al navegador del sistema: Windows
 * decodifica mal la URL de una ruta con tildes (`Andr%C3%A9s` como
 * `AndrÃ©s`) y no encuentra el archivo.
 */
function openCoverageReport(panel: vscode.WebviewPanel) {
  const report = coverageReportByPanel.get(panel);
  if (!report || !fs.existsSync(report.path)) {
    vscode.window.showWarningMessage(
      "El informe de cobertura ya no está: volvé a intentar la ejecución.",
    );
    return;
  }

  let tab = coverageTabByPanel.get(panel);
  if (tab) {
    tab.reveal();
  } else {
    const created = vscode.window.createWebviewPanel(
      "unityTestIACoverage",
      report.title,
      vscode.ViewColumn.Active,
      // La plantilla trae todo adentro: no necesita leer archivos locales.
      { enableScripts: true, localResourceRoots: [] },
    );
    created.onDidDispose(() => {
      if (coverageTabByPanel.get(panel) === created) {
        coverageTabByPanel.delete(panel);
      }
    });
    coverageTabByPanel.set(panel, created);
    tab = created;
  }
  showCoverageReport(tab, report);
}

/** Carga en la pestaña el informe tal como quedó escrito en disco. */
function showCoverageReport(
  tab: vscode.WebviewPanel,
  report: { path: string; title: string },
) {
  tab.title = report.title;
  tab.webview.html = fs.readFileSync(report.path, "utf8");
}

/** Solo la ejecución, con la última verificación del panel. */
async function executeAgainInPanel(
  panel: vscode.WebviewPanel,
  ecosystem: ActiveEcosystem,
) {
  const testCtx = testContextByPanel.get(panel);
  const verification = verificationStatusByPanel.get(panel);
  if (!testCtx || !verification || verifyingPanels.has(panel)) {
    return;
  }
  verifyingPanels.add(panel);
  try {
    await runAndMeasure({
      adapter: ecosystem.adapter,
      project: testCtx.project,
      spec: testCtx.spec,
      verification,
      coverageTarget: testCtx.coverageTarget,
      coverageTemplate: COVERAGE_TEMPLATE,
      onEvent: (event) => showPipelineEvent(panel, event),
    });
  } finally {
    verifyingPanels.delete(panel);
  }
}

function notifyAgent(
  panel: vscode.WebviewPanel,
  agent: string,
  status: "running" | "done" | "error",
  detail?: string,
) {
  panel.webview.postMessage({ command: "agentStatus", agent, status, detail });
}

// ── Pipeline ───────────────────────────────────────────────────────────────────

/**
 * Genera la prueba desde el panel. La secuencia está en `src/pipeline/`; aquí
 * queda lo que es del panel: el bloqueo mientras se verifica, el modelo
 * elegido, el tiempo y los tokens, y cómo se muestra cada paso.
 */
async function handleGenerate(
  className: string,
  methodName: string,
  model: string,
  subModel: string | null,
  editor: EditorSelection,
  reduceContext: boolean,
  panel: vscode.WebviewPanel,
  ecosystem: ActiveEcosystem,
) {
  if (verifyingPanels.has(panel)) {
    panel.webview.postMessage({ command: "generationError" });
    vscode.window.showWarningMessage(
      "Hay una verificación en curso en este panel. Esperá a que termine para generar otra prueba.",
    );
    return;
  }

  generationMetaByPanel.set(panel, { className, methodName, model, subModel });

  const generationStart = Date.now();
  tokenTotalsByPanel.set(panel, { inputTokens: 0, outputTokens: 0 });

  try {
    const provider = modelProviders[model];
    if (!provider) throw new Error(`Modelo no válido: ${model}`);

    const test = await generateTest({
      adapter: ecosystem.adapter,
      rootPath: ecosystem.rootPath,
      className,
      methodName,
      modelId: model,
      reduceContext,
      editor,
      ask: (prompt) => askOnce(provider, prompt, panel, subModel ?? undefined),
      onEvent: (event) => showPipelineEvent(panel, event),
    });

    // Store test context for ChatFixer
    testContextByPanel.set(panel, test);

    const elapsedMs = Date.now() - generationStart;
    const tokens = tokenTotalsByPanel.get(panel) ?? {
      inputTokens: 0,
      outputTokens: 0,
    };
    const totalTokens = tokens.inputTokens + tokens.outputTokens;
    panel.webview.postMessage({
      command: "showResult",
      result: test.testCode,
      elapsedMs,
      totalTokens,
    });

    // ── OP-13: verificación del artefacto escrito y corrección automática ───
    // Fuera del tiempo y de los tokens de generación a propósito: esos miden
    // al pipeline hasta la primera versión escrita. Lo que cuesta corregir
    // queda registrado aparte, en el volcado `repair`.
    await verifyInPanel(panel, ecosystem);
  } catch (err: any) {
    panel.webview.postMessage({ command: "agentError", message: err.message });
    vscode.window.showErrorMessage("Error al generar: " + err.message);
  }
}

// ── Webview panel ──────────────────────────────────────────────────────────────

export async function createWebviewPanel(
  context: vscode.ExtensionContext,
  editor: EditorSelection,
  ecosystem: ActiveEcosystem,
) {
  const panel = vscode.window.createWebviewPanel(
    "unityTestIAView",
    "Unity Test IA",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, "ui")),
        vscode.Uri.file(path.join(context.extensionPath, "assets")),
        vscode.Uri.file(path.join(context.extensionPath, "dist")),
      ],
    },
  );

  const models: { id: string; name: string; type?: string }[] = [];
  if (process.env.OPENAI_API_KEY)
    models.push({ id: "chatgpt", name: "ChatGPT", type: "direct" });
  if (process.env.ANTHROPIC_API_KEY)
    models.push({ id: "claude", name: "Claude", type: "direct" });
  models.push({ id: "llamaLocal", name: "Llama Local", type: "direct" });

  // Ecosistema detectado, para que la interfaz diga contra qué se va a generar.
  // Sale del descriptor (OP-01) y de la evidencia de la detección (OP-02): el
  // núcleo no compone el texto ni pregunta por el identificador.
  const ecosystemInfo = {
    displayName: ecosystem.adapter.descriptor.displayName,
    version: ecosystem.adapter.descriptor.version,
    confidence: ecosystem.applicability.confidence,
    evidence: ecosystem.applicability.evidence,
  };

  const uiPath = path.join(context.extensionPath, "ui", "index.html");
  const cssUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, "dist", "bundle.css")),
  );
  const logoUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, "assets", "logo.png")),
  );
  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, "dist", "bundle.js")),
  );

  let html = fs.readFileSync(uiPath, "utf8");
  html = html.replace(
    "${code}",
    editor.code.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
  html = html.replace("${logoUri}", logoUri.toString());
  html = html.replace("@@styleUri", cssUri.toString());
  html = html.replace("@@scriptUri", scriptUri.toString());
  panel.webview.html = html;

  panel.webview.postMessage({ command: "setModels", models });
  panel.webview.postMessage({
    command: "setEcosystem",
    ecosystem: ecosystemInfo,
  });

  panel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case "validateInputs": {
        const { className, methodName } = await collectClassAndMethod(panel);

        // OP-05 sobre el proyecto entero, en lugar de dos expresiones regulares
        // sobre el archivo abierto. El motivo del fallo lo redacta el adaptador.
        const project = await ecosystem.adapter.buildProjectModel(
          ecosystem.rootPath,
        );
        const location = await ecosystem.adapter.locateSymbol(project, {
          className,
          methodName,
        });

        if (!location.found) {
          vscode.window.showErrorMessage(location.reason);
          panel.webview.postMessage({ command: "resetInputs" });
          return;
        }
        panel.webview.postMessage({
          command: "goToStep2",
          className,
          methodName,
        });
        break;
      }

      case "webviewReady": {
        panel.webview.postMessage({ command: "setModels", models });
        panel.webview.postMessage({
          command: "setEcosystem",
          ecosystem: ecosystemInfo,
        });
        break;
      }

      case "generateFromConfig": {
        // No se localiza aquí: `handleGenerate` lo hace de todos modos porque
        // necesita la declaración para especificar el artefacto, y repetirlo
        // sería recorrer el proyecto dos veces.
        const { className, methodName, model, subModel } = message;
        const reduceContext = message.reduceContext !== false;
        await handleGenerate(
          className,
          methodName,
          model,
          subModel,
          editor,
          reduceContext,
          panel,
          ecosystem,
        );
        break;
      }

      case "generateTest": {
        const { className, methodName } = await collectClassAndMethod(panel);
        const reduceContext = message.reduceContext !== false;
        await handleGenerate(
          className,
          methodName,
          message.model,
          message.subModel,
          editor,
          reduceContext,
          panel,
          ecosystem,
        );
        break;
      }

      case "verifyAgain":
        await verifyInPanel(panel, ecosystem);
        break;

      case "runTestsAgain":
        await executeAgainInPanel(panel, ecosystem);
        break;

      case "openCoverageReport":
        openCoverageReport(panel);
        break;

      case "chatMessage": {
        const text = String(message.text || "").trim();
        if (!text) return;

        const meta = generationMetaByPanel.get(panel);
        if (!meta) {
          vscode.window.showErrorMessage(
            "No hay configuración de modelo cargada.",
          );
          return;
        }

        const provider = modelProviders[meta.model];
        const subModel = meta.subModel ?? undefined;
        const testCtx = testContextByPanel.get(panel);

        if (testCtx) {
          if (verifyingPanels.has(panel)) {
            panel.webview.postMessage({
              command: "chatResponse",
              text: "Hay una verificación en curso. Esperá a que termine para pedir otra corrección.",
            });
            return;
          }

          // Los volcados van a la raíz del proyecto, como los del pipeline, y
          // no a la carpeta abierta: si se abrió una subcarpeta, caerían
          // dentro del proyecto y el editor del ecosistema los importaría.
          const outputRoot = testCtx.project.rootPath;

          // Route through ChatFixer: the agent has full context of the test + source
          notifyAgent(panel, "Chat Fixer", "running");
          const fixResult = await runChatFixer(
            {
              profile: testCtx.profile,
              // El disco y no la última versión escrita: la persona puede haber
              // editado la prueba, y el error que pega habla de ese texto.
              testCode: await readArtifact(testCtx.project, testCtx.spec).catch(
                () => testCtx.testCode,
              ),
              assembledContext: testCtx.assembledContext,
              userMessage: text,
              className: meta.className,
              methodName: meta.methodName,
              workspaceRoot: outputRoot,
            },
            (prompt) => askOnce(provider, prompt, panel, subModel),
          );
          saveAgentOutput(outputRoot, "chat-fixer", fixResult);

          if (fixResult.status === "FIXED") {
            // Se normaliza igual que el código original: si el modelo renombró
            // la clase, el archivo y la clase dejarían de llamarse igual y el
            // ecosistema no reconocería la prueba.
            const corrected = ecosystem.adapter.normalizeGeneratedCode(
              fixResult.correctedCode,
              testCtx.spec,
            );
            testContextByPanel.set(panel, { ...testCtx, testCode: corrected });
            fs.writeFileSync(testCtx.savedPath, corrected, "utf8");
            const summary = fixResult.summary ?? "Correcciones aplicadas";
            notifyAgent(panel, "Chat Fixer", "done", summary);
            panel.webview.postMessage({
              command: "chatResponse",
              text: `✓ ${summary}`,
            });
            // updateResult: updates the code panel without clearing the agent pipeline
            panel.webview.postMessage({
              command: "updateResult",
              result: corrected,
            });
            // La verificación anterior era de la versión que se acaba de
            // reemplazar: se repite para que lo mostrado corresponda al disco.
            await verifyInPanel(panel, ecosystem);
          } else if (fixResult.status === "INFO") {
            notifyAgent(panel, "Chat Fixer", "done");
            panel.webview.postMessage({
              command: "chatResponse",
              text: fixResult.answer,
            });
          } else {
            // ERROR from ChatFixer — fall back to plain chat
            notifyAgent(panel, "Chat Fixer", "error", fixResult.message);
            const reply = await askInChat(provider, text, panel, subModel);
            panel.webview.postMessage({ command: "chatResponse", text: reply });
          }
          return;
        }

        // No generated test yet — plain chat
        const reply = await askInChat(provider, text, panel, subModel);
        panel.webview.postMessage({ command: "chatResponse", text: reply });
        break;
      }
    }
  });
}
