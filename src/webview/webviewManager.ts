import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { collectClassAndMethod } from "../collectInputs";
import { ChatSession } from "../llm/sessionManager";
import { generateWithChatGPT, generateWithOllama, generateWithClaude } from "../llm";
import type { ActiveEcosystem } from "../core/adapters";
import { supportsSchemaExtension } from "../core/contracts";
import type {
  ArtifactSpec,
  ProjectModel,
  PromptProfile,
  SymbolCandidate,
  UnitTarget,
} from "../core/contracts";
import {
  dependencyLabel,
  describeViolations,
  renderProjectTree,
  resolveDependencies,
  writeArtifact,
  type ResolvedDependency,
} from "../core/project";
import { runMethodSlicer } from "../agents/methodSlicer";
import { runDependencyResolver } from "../agents/dependencyResolver";
import { runContextBuilder } from "../agents/contextBuilder";
import { runContextValidator, runTestValidator } from "../agents/validator";
import { runTestGenerator } from "../agents/testGenerator";
import { runCodeAnalyzer } from "../agents/codeAnalyzer";
import { formatCodeAnalysis } from "../agents/analysisText";
import { runChatFixer } from "../agents/chatFixer";
import { saveAgentOutput } from "../agents/agentOutputSaver";

// ── Editor input ───────────────────────────────────────────────────────────────

/** Archivo abierto con el que se invocó el comando. */
export interface EditorSelection {
  /** Texto del archivo tal como está en el editor, con cambios sin guardar. */
  readonly code: string;
  /** Ruta absoluta del archivo abierto. */
  readonly path: string;
}

// ── Per-panel state ────────────────────────────────────────────────────────────

const sessionsByPanel = new WeakMap<vscode.WebviewPanel, ChatSession>();

const generationMetaByPanel = new WeakMap<
  vscode.WebviewPanel,
  { className: string; methodName: string; model: string; subModel: string | null }
>();

type TestContext = {
  testCode: string;
  assembledContext: string;
  savedPath: string;
  /** Especificación con la que se escribió, para volver a normalizar (OP-11). */
  spec: ArtifactSpec;
  /** Perfil de la corrida, para que el corrector componga el mismo prompt. */
  profile: PromptProfile;
};
const testContextByPanel = new WeakMap<vscode.WebviewPanel, TestContext>();

const tokenTotalsByPanel = new WeakMap<
  vscode.WebviewPanel,
  { inputTokens: number; outputTokens: number }
>();

function addTokenUsage(
  panel: vscode.WebviewPanel,
  usage: { inputTokens: number; outputTokens: number }
) {
  const totals = tokenTotalsByPanel.get(panel) ?? { inputTokens: 0, outputTokens: 0 };
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  tokenTotalsByPanel.set(panel, totals);
}

// ── Model handlers ─────────────────────────────────────────────────────────────

const modelHandlers: Record<
  string,
  (prompt: string, panel: vscode.WebviewPanel, subModel?: string) => Promise<string>
> = {
  chatgpt: async (prompt, panel, subModel) => {
    let session = sessionsByPanel.get(panel);
    if (!session) { session = new ChatSession(); sessionsByPanel.set(panel, session); }
    session.addUserMessage(prompt);
    const { text, usage } = await generateWithChatGPT(session.getMessages(), subModel || "gpt-4o-mini");
    session.addAssistantMessage(text);
    addTokenUsage(panel, usage);
    return text;
  },
  llamaLocal: async (prompt, panel) => {
    let session = sessionsByPanel.get(panel);
    if (!session) { session = new ChatSession(); sessionsByPanel.set(panel, session); }
    session.addUserMessage(prompt);
    const { text, usage } = await generateWithOllama(session.getMessages());
    session.addAssistantMessage(text);
    addTokenUsage(panel, usage);
    return text;
  },
  claude: async (prompt, panel, subModel) => {
    let session = sessionsByPanel.get(panel);
    if (!session) { session = new ChatSession(); sessionsByPanel.set(panel, session); }
    session.addUserMessage(prompt);
    const { text, usage } = await generateWithClaude(session.getMessages(), subModel || "claude-opus-4-8");
    session.addAssistantMessage(text);
    addTokenUsage(panel, usage);
    return text;
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function notifyAgent(
  panel: vscode.WebviewPanel,
  agent: string,
  status: "running" | "done" | "error",
  detail?: string
) {
  panel.webview.postMessage({ command: "agentStatus", agent, status, detail });
}

/**
 * Compara dos rutas absolutas del mismo sistema de archivos.
 *
 * En Windows y macOS el nombre no distingue mayúsculas, y la ruta que entrega el
 * editor puede diferir en la letra de unidad de la que se compone aquí. Un
 * empate de más solo haría usar el texto del editor en lugar del disco; un
 * empate de menos, al contrario.
 */
function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  if (process.platform === "win32" || process.platform === "darwin") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function buildFullContext(
  className: string,
  methodName: string,
  targetCode: string,
  dependencyFiles: readonly ResolvedDependency[]
): string {
  const header = `// ── TARGET: ${className}.${methodName} ──────────────────────────────────────`;
  const parts = [header, targetCode];

  for (const dep of dependencyFiles) {
    if (!dep.found || !dep.content) continue;
    parts.push(
      `// ── DEPENDENCY: ${dependencyLabel(dep)} ──────────────────────────────────────`,
      dep.content
    );
  }

  return parts.join("\n\n");
}

/**
 * Código de la unidad bajo prueba.
 *
 * Sale de OP-06 y no del editor, porque la declaración que localizó OP-05 no
 * siempre está en el archivo abierto: antes, pedir una clase declarada en otro
 * archivo fallaba de entrada. Cuando sí coincide con el archivo abierto se usa
 * el texto del editor, que incluye los cambios todavía sin guardar.
 */
async function readTargetCode(
  ecosystem: ActiveEcosystem,
  project: ProjectModel,
  editor: EditorSelection,
  location: SymbolCandidate
): Promise<string> {
  const declaredIn = path.join(project.rootPath, ...location.filePath.split("/"));
  if (samePath(declaredIn, editor.path)) {
    return editor.code;
  }
  const source = await ecosystem.adapter.readSource(project, location);
  return source.content;
}

// ── Pipeline ───────────────────────────────────────────────────────────────────

async function handleGenerate(
  className: string,
  methodName: string,
  model: string,
  subModel: string | null,
  editor: EditorSelection,
  reduceContext: boolean,
  panel: vscode.WebviewPanel,
  ecosystem: ActiveEcosystem
) {
  generationMetaByPanel.set(panel, { className, methodName, model, subModel });

  const generationStart = Date.now();
  tokenTotalsByPanel.set(panel, { inputTokens: 0, outputTokens: 0 });

  const { adapter } = ecosystem;

  try {
    // ── OP-04: modelo del proyecto ───────────────────────────────────────────
    // Se reconstruye en cada corrida a propósito: un archivo agregado desde que
    // se abrió el panel tiene que entrar en el árbol y en la localización.
    const project = await adapter.buildProjectModel(ecosystem.rootPath);
    const projectTree = renderProjectTree(project);

    // Los volcados van a la raíz del proyecto y no a la carpeta abierta, para
    // que no se partan en dos cuando se abre una subcarpeta. Los agentes siguen
    // llamando a este valor `workspaceRoot`; el nombre se corrige cuando se les
    // extraigan las plantillas.
    const outputRoot = project.rootPath;

    panel.webview.postMessage({ command: "clearPipeline" });

    const handler = modelHandlers[model];
    if (!handler) throw new Error(`Modelo no válido: ${model}`);

    // ── OP-05: localización de la unidad bajo prueba ─────────────────────────
    const target: UnitTarget = { className, methodName };
    const location = await adapter.locateSymbol(project, target);
    if (!location.found) {
      throw new Error(location.reason);
    }
    // Ante sobrecargas se toma la primera; elegir entre las firmas es trabajo
    // de la interfaz y todavía no hay dónde preguntarlo.
    const [targetLocation] = location.candidates;

    // ── OP-10 y OP-12: destino y precondiciones ──────────────────────────────
    // Se comprueban antes de la primera llamada al modelo. Antes se comprobaba
    // al final, después de pagar el pipeline completo, para descubrir entonces
    // que no había dónde escribir el archivo.
    const spec = adapter.specifyArtifact({
      project,
      target,
      targetLocation,
      modelId: model,
    });
    const violations = await adapter.checkPreconditions(project, spec);
    if (violations.length > 0) {
      throw new Error(describeViolations(violations));
    }

    // ── OP-06: código de la unidad ───────────────────────────────────────────
    const targetCode = await readTargetCode(ecosystem, project, editor, targetLocation);

    // ── OP-08: perfil con el que se componen las plantillas neutras ──────────
    // Se pide una sola vez por corrida: depende del proyecto descubierto y ese
    // no cambia a mitad del pipeline.
    const profile = adapter.getPromptProfile(project);

    // ── OP-09: extensión del esquema de análisis, si el adaptador la ofrece ──
    // Se pregunta por la capacidad declarada, nunca por el identificador del
    // ecosistema. Un adaptador que no la declare recorre el mismo camino con la
    // extensión ausente, sin ninguna condición más.
    const analysisSchema = supportsSchemaExtension(adapter)
      ? adapter.extendAnalysisSchema()
      : undefined;

    // ── Step 0: Method Slicer ──────────────────────────────────────────────
    let codeSlice: string;
    if (reduceContext) {
      const slicerAgent = "Method Slicer";
      notifyAgent(panel, slicerAgent, "running");
      const slicerResult = await runMethodSlicer(
        { profile, code: targetCode, className, methodName, workspaceRoot: outputRoot },
        (prompt) => handler(prompt, panel, subModel ?? undefined)
      );
      saveAgentOutput(outputRoot, "method-slicer", slicerResult);

      if (slicerResult.status === "ERROR") {
        notifyAgent(panel, slicerAgent, "error", slicerResult.message);
        throw new Error(`Method Slicer failed: ${slicerResult.message}`);
      }
      notifyAgent(panel, slicerAgent, "done");

      codeSlice = slicerResult.codeSlice.join("\n");
    } else {
      codeSlice = targetCode;
    }

    // ── Step 1: Dependency Resolver ──────────────────────────────────────────
    const depAgent = "Dependency Resolver";
    notifyAgent(panel, depAgent, "running");
    const depResult = await runDependencyResolver(
      { profile, codeSlice, projectTree, className, methodName, workspaceRoot: outputRoot },
      (prompt) => handler(prompt, panel, subModel ?? undefined)
    );
    saveAgentOutput(outputRoot, "dependency-resolver", depResult);

    if (depResult.status === "ERROR") {
      notifyAgent(panel, depAgent, "error", depResult.message);
      throw new Error(`Dependency Resolver failed: ${depResult.message}`);
    }
    notifyAgent(panel, depAgent, "done");

    // ── OP-07: resolución de las dependencias pedidas ────────────────────────
    const depReferences: string[] =
      depResult.status === "MISSING_DEPENDENCIES" ? depResult.files : [];

    const dependencies = await resolveDependencies(adapter, project, depReferences);

    if (dependencies.files.length > 0) {
      panel.webview.postMessage({
        command: "dependencyFiles",
        files: dependencies.files.map((f) => ({ path: dependencyLabel(f), found: f.found })),
      });
    }

    // ── Step 2: Context Builder ───────────────────────────────────────────────
    let preValidationContext: string;
    if (reduceContext) {
      const ctxAgent = "Context Builder";
      notifyAgent(panel, ctxAgent, "running");
      const ctxResult = await runContextBuilder(
        {
          profile,
          codeSlice,
          dependencyFiles: depReferences,
          resolvedDependencyCode: dependencies.code,
          className,
          methodName,
          workspaceRoot: outputRoot,
        },
        (prompt) => handler(prompt, panel, subModel ?? undefined)
      );
      saveAgentOutput(outputRoot, "context-builder", ctxResult);

      if (ctxResult.status === "ERROR") {
        notifyAgent(panel, ctxAgent, "error", ctxResult.message);
        throw new Error(`Context Builder failed: ${ctxResult.message}`);
      }
      notifyAgent(panel, ctxAgent, "done");

      if (ctxResult.dependencySlices.length > 0) {
        panel.webview.postMessage({
          command: "contextBuilderSlices",
          slices: ctxResult.dependencySlices.map((s) => ({ filePath: s.filePath })),
        });
      }

      preValidationContext = ctxResult.assembledContext;
    } else {
      preValidationContext = buildFullContext(
        className,
        methodName,
        targetCode,
        dependencies.files
      );
    }

    // ── Step 2.5: Context Validator ───────────────────────────────────────────
    const ctxValAgent = "Context Validator";
    notifyAgent(panel, ctxValAgent, "running");
    const ctxValResult = await runContextValidator(
      { profile, assembledContext: preValidationContext, className, methodName, workspaceRoot: outputRoot, fullContext: !reduceContext },
      (prompt) => handler(prompt, panel, subModel ?? undefined)
    );
    saveAgentOutput(outputRoot, "validator-context", ctxValResult);

    if (ctxValResult.status === "ERROR") {
      notifyAgent(panel, ctxValAgent, "error", ctxValResult.message);
      throw new Error(`Context Validator failed: ${ctxValResult.message}`);
    }
    notifyAgent(
      panel, ctxValAgent, "done",
      ctxValResult.status === "FIXED" ? `Corregidos ${ctxValResult.issues.length} problema(s)` : undefined
    );

    const assembledContext = ctxValResult.output;

    // ── Step 2.7: Code Analyzer ───────────────────────────────────────────────
    const codeAnalyzerAgent = "Code Analyzer";
    notifyAgent(panel, codeAnalyzerAgent, "running");
    const codeAnalyzerResult = await runCodeAnalyzer(
      {
        profile,
        schemaFields: analysisSchema?.fields,
        assembledContext,
        className,
        methodName,
        workspaceRoot: outputRoot,
      },
      (prompt) => handler(prompt, panel, subModel ?? undefined)
    );
    saveAgentOutput(outputRoot, "code-analyzer", codeAnalyzerResult);

    // Soft failure: log and continue without the pre-computed analysis
    const codeAnalysis =
      codeAnalyzerResult.status === "READY"
        ? formatCodeAnalysis(codeAnalyzerResult, analysisSchema?.format)
        : undefined;

    notifyAgent(
      panel, codeAnalyzerAgent,
      codeAnalyzerResult.status === "READY" ? "done" : "error",
      codeAnalyzerResult.status === "ERROR" ? codeAnalyzerResult.message : undefined
    );

    // ── Step 3: Test Generator ────────────────────────────────────────────────
    const testAgent = "Test Generator";
    notifyAgent(panel, testAgent, "running");
    const testResult = await runTestGenerator(
      { profile, assembledContext, codeAnalysis, className, methodName, workspaceRoot: outputRoot },
      (prompt) => handler(prompt, panel, subModel ?? undefined)
    );
    saveAgentOutput(outputRoot, "test-generator", testResult);

    if (testResult.status === "ERROR") {
      notifyAgent(panel, testAgent, "error", testResult.message);
      throw new Error(`Test Generator failed: ${testResult.message}`);
    }
    notifyAgent(panel, testAgent, "done");

    // ── OP-11: normalización y escritura del artefacto ───────────────────────
    let finalTestCode = adapter.normalizeGeneratedCode(testResult.testCode, spec);
    const savedPath = await writeArtifact(project, spec, finalTestCode);

    // ── Step 3.5: Test Validator ──────────────────────────────────────────────
    const testValAgent = "Test Validator";
    notifyAgent(panel, testValAgent, "running");
    const testValResult = await runTestValidator(
      { profile, testCode: finalTestCode, assembledContext, className, methodName, workspaceRoot: outputRoot },
      (prompt) => handler(prompt, panel, subModel ?? undefined)
    );
    saveAgentOutput(outputRoot, "validator-test", testValResult);

    if (testValResult.status === "ERROR") {
      // Soft failure: surface the error but keep the original generated code
      notifyAgent(panel, testValAgent, "error", testValResult.message);
    } else if (testValResult.status === "FIXED") {
      finalTestCode = adapter.normalizeGeneratedCode(testValResult.output, spec);
      await writeArtifact(project, spec, finalTestCode);
      notifyAgent(panel, testValAgent, "done", `Corregidos ${testValResult.issues.length} problema(s)`);
    } else {
      notifyAgent(panel, testValAgent, "done");
    }

    // Store test context for ChatFixer
    testContextByPanel.set(panel, {
      testCode: finalTestCode,
      assembledContext,
      savedPath,
      spec,
      profile,
    });

    const elapsedMs = Date.now() - generationStart;
    const tokens = tokenTotalsByPanel.get(panel) ?? { inputTokens: 0, outputTokens: 0 };
    const totalTokens = tokens.inputTokens + tokens.outputTokens;
    panel.webview.postMessage({ command: "showResult", result: finalTestCode, elapsedMs, totalTokens });

  } catch (err: any) {
    panel.webview.postMessage({ command: "agentError", message: err.message });
    vscode.window.showErrorMessage("Error al generar: " + err.message);
  }
}

// ── Webview panel ──────────────────────────────────────────────────────────────

export async function createWebviewPanel(
  context: vscode.ExtensionContext,
  editor: EditorSelection,
  ecosystem: ActiveEcosystem
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
    }
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
    vscode.Uri.file(path.join(context.extensionPath, "dist", "bundle.css"))
  );
  const logoUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, "assets", "logo.png"))
  );
  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, "dist", "bundle.js"))
  );

  let html = fs.readFileSync(uiPath, "utf8");
  html = html.replace("${code}", editor.code.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  html = html.replace("${logoUri}", logoUri.toString());
  html = html.replace("@@styleUri", cssUri.toString());
  html = html.replace("@@scriptUri", scriptUri.toString());
  panel.webview.html = html;

  panel.webview.postMessage({ command: "setModels", models });
  panel.webview.postMessage({ command: "setEcosystem", ecosystem: ecosystemInfo });
  sessionsByPanel.set(panel, new ChatSession());

  panel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case "validateInputs": {
        const { className, methodName } = await collectClassAndMethod(panel);

        // OP-05 sobre el proyecto entero, en lugar de dos expresiones regulares
        // sobre el archivo abierto. El motivo del fallo lo redacta el adaptador.
        const project = await ecosystem.adapter.buildProjectModel(ecosystem.rootPath);
        const location = await ecosystem.adapter.locateSymbol(project, { className, methodName });

        if (!location.found) {
          vscode.window.showErrorMessage(location.reason);
          panel.webview.postMessage({ command: "resetInputs" });
          return;
        }
        panel.webview.postMessage({ command: "goToStep2", className, methodName });
        break;
      }

      case "webviewReady": {
        panel.webview.postMessage({ command: "setModels", models });
        panel.webview.postMessage({ command: "setEcosystem", ecosystem: ecosystemInfo });
        break;
      }

      case "generateFromConfig": {
        // No se localiza aquí: `handleGenerate` lo hace de todos modos porque
        // necesita la declaración para especificar el artefacto, y repetirlo
        // sería recorrer el proyecto dos veces.
        const { className, methodName, model, subModel } = message;
        const reduceContext = message.reduceContext !== false;
        await handleGenerate(className, methodName, model, subModel, editor, reduceContext, panel, ecosystem);
        break;
      }

      case "generateTest": {
        const { className, methodName } = await collectClassAndMethod(panel);
        const reduceContext = message.reduceContext !== false;
        await handleGenerate(className, methodName, message.model, message.subModel, editor, reduceContext, panel, ecosystem);
        break;
      }

      case "chatMessage": {
        const text = String(message.text || "").trim();
        if (!text) return;

        const meta = generationMetaByPanel.get(panel);
        if (!meta) { vscode.window.showErrorMessage("No hay configuración de modelo cargada."); return; }

        const handler = modelHandlers[meta.model];
        const testCtx = testContextByPanel.get(panel);

        if (testCtx) {
          // Route through ChatFixer: the agent has full context of the test + source
          notifyAgent(panel, "Chat Fixer", "running");
          const fixResult = await runChatFixer(
            {
              profile: testCtx.profile,
              testCode: testCtx.testCode,
              assembledContext: testCtx.assembledContext,
              userMessage: text,
              className: meta.className,
              methodName: meta.methodName,
              workspaceRoot: ecosystem.rootPath,
            },
            (prompt) => handler(prompt, panel, meta.subModel ?? undefined)
          );
          saveAgentOutput(ecosystem.rootPath, "chat-fixer", fixResult);

          if (fixResult.status === "FIXED") {
            // Se normaliza igual que el código original: si el modelo renombró
            // la clase, el archivo y la clase dejarían de llamarse igual y el
            // ecosistema no reconocería la prueba.
            const corrected = ecosystem.adapter.normalizeGeneratedCode(
              fixResult.correctedCode,
              testCtx.spec
            );
            testContextByPanel.set(panel, { ...testCtx, testCode: corrected });
            fs.writeFileSync(testCtx.savedPath, corrected, "utf8");
            const summary = fixResult.summary ?? "Correcciones aplicadas";
            notifyAgent(panel, "Chat Fixer", "done", summary);
            panel.webview.postMessage({ command: "chatResponse", text: `✓ ${summary}` });
            // updateResult: updates the code panel without clearing the agent pipeline
            panel.webview.postMessage({ command: "updateResult", result: corrected });
          } else if (fixResult.status === "INFO") {
            notifyAgent(panel, "Chat Fixer", "done");
            panel.webview.postMessage({ command: "chatResponse", text: fixResult.answer });
          } else {
            // ERROR from ChatFixer — fall back to plain chat
            notifyAgent(panel, "Chat Fixer", "error", fixResult.message);
            const session = sessionsByPanel.get(panel);
            if (!session) return;
            session.addUserMessage(text);
            const reply = await handler(text, panel, meta.subModel ?? undefined);
            session.addAssistantMessage(reply);
            panel.webview.postMessage({ command: "chatResponse", text: reply });
          }
          return;
        }

        // No generated test yet — plain chat
        const session = sessionsByPanel.get(panel);
        if (!session) { vscode.window.showErrorMessage("No hay sesión de chat activa."); return; }
        session.addUserMessage(text);
        const reply = await handler(text, panel, meta.subModel ?? undefined);
        session.addAssistantMessage(reply);
        panel.webview.postMessage({ command: "chatResponse", text: reply });
        break;
      }
    }
  });
}
