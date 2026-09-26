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
import {
  supportsDependencyDetection,
  supportsSchemaExtension,
  supportsTestRun,
  supportsVerification,
} from "../core/contracts";
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
  readArtifact,
  renderProjectTree,
  resolveDependencies,
  writeArtifact,
  type ResolvedDependency,
} from "../core/project";
import {
  TEST_RUN_STAGE_NAME,
  presentRepairProgress,
  presentRepairResult,
  presentTestRun,
  runTestStage,
  verificationStageName,
  verifyAndRepair,
  type RepairReply,
  type RepairRequest,
  type VerificationOutcome,
  type VerificationPresentation,
} from "../core/verification";
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
  {
    className: string;
    methodName: string;
    model: string;
    subModel: string | null;
  }
>();

type TestContext = {
  testCode: string;
  assembledContext: string;
  savedPath: string;
  /** Modelo de la corrida, para volver a verificar el artefacto (OP-13). */
  project: ProjectModel;
  /** Especificación con la que se escribió, para volver a normalizar (OP-11). */
  spec: ArtifactSpec;
  /** Perfil de la corrida, para que el corrector componga el mismo prompt. */
  profile: PromptProfile;
};
const testContextByPanel = new WeakMap<vscode.WebviewPanel, TestContext>();

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
 * Verifica el artefacto que ya está en disco (OP-13) y, mientras la
 * verificación lo rechace con errores dentro de la prueba, se los pasa al
 * corrector y vuelve a verificar. Cada paso se muestra debajo de la prueba.
 *
 * Corre después de mostrar la prueba y no antes: la verificación puede tardar
 * segundos o minutos, y la prueba ya está escrita y se puede leer mientras
 * tanto. Si el adaptador no ofrece verificación, la etapa se informa como no
 * aplicable sin lanzar nada.
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

  const { adapter } = ecosystem;
  const kind = adapter.capabilities.verification;
  const { project, spec } = testCtx;
  const outputRoot = project.rootPath;
  const subModel = meta.subModel ?? undefined;
  const showVerification = (verification: VerificationPresentation) =>
    panel.webview.postMessage({ command: "showVerification", verification });

  const fix = async ({
    cycle,
    code,
    feedback,
  }: RepairRequest): Promise<RepairReply> => {
    const before = tokenTotals(panel);
    const fixResult = await runChatFixer(
      {
        profile: testCtx.profile,
        testCode: code,
        assembledContext: testCtx.assembledContext,
        userMessage: feedback,
        className: meta.className,
        methodName: meta.methodName,
        workspaceRoot: outputRoot,
        dumpDir: path.join("repair", `cycle-${cycle}`),
      },
      (prompt) => askOnce(provider, prompt, panel, subModel),
    );
    const after = tokenTotals(panel);
    const usage = {
      inputTokens: after.inputTokens - before.inputTokens,
      outputTokens: after.outputTokens - before.outputTokens,
    };

    switch (fixResult.status) {
      case "FIXED":
        return {
          status: "fixed",
          code: fixResult.correctedCode,
          summary: fixResult.summary,
          usage,
        };
      case "INFO":
        return {
          status: "notFixed",
          reason: `respondió sin corregir: ${fixResult.answer}`,
          usage,
        };
      case "ERROR":
        return { status: "notFixed", reason: fixResult.message, usage };
    }
  };

  try {
    // Los volcados son de la última verificación, igual que los de los
    // agentes: sin borrar, un ciclo de una corrida anterior quedaría mezclado.
    // Dentro del try: si el borrado fallara afuera, el panel quedaría marcado
    // como ocupado para siempre.
    fs.rmSync(path.join(outputRoot, "AgentOutputs", "repair"), {
      recursive: true,
      force: true,
    });

    const result = await verifyAndRepair({
      adapter,
      project,
      spec,
      fix,
      onEvent: (event) => {
        const fixerAgent = `Auto Fixer #${event.cycle}`;
        switch (event.kind) {
          case "verifying":
            if (supportsVerification(adapter)) {
              panel.webview.postMessage({
                command: "verificationRunning",
                stageName: verificationStageName(kind),
              });
            }
            break;
          case "fixing":
            showVerification(
              presentRepairProgress(
                kind,
                event.outcome,
                event.cycle,
                event.maxCycles,
              ),
            );
            notifyAgent(panel, fixerAgent, "running");
            break;
          case "fixed":
            testContextByPanel.set(panel, { ...testCtx, testCode: event.code });
            notifyAgent(
              panel,
              fixerAgent,
              "done",
              event.summary ?? "Correcciones aplicadas",
            );
            panel.webview.postMessage({
              command: "updateResult",
              result: event.code,
            });
            break;
          case "notFixed":
            notifyAgent(panel, fixerAgent, "error", event.reason);
            break;
        }
      },
    });

    const { outcome, ...record } = result;
    saveAgentOutput(outputRoot, "verification", outcome);
    saveAgentOutput(outputRoot, "repair", {
      ...record,
      finalStatus: outcome.status,
    });
    showVerification(presentRepairResult(kind, result));
    verificationStatusByPanel.set(panel, outcome.status);

    // ── OP-14: ejecución, solo con la prueba ya verificada ─────────────────
    await executeInPanel(panel, ecosystem, project, spec, outcome.status);
  } catch (err: any) {
    // La prueba ya está escrita: un fallo aquí no invalida la generación.
    showVerification({
      stageName: verificationStageName(kind),
      status: "notRun",
      summary: `La verificación se interrumpió: ${err.message}`,
      remediation: "Volvé a intentar la verificación.",
      diagnostics: [],
    });
  } finally {
    verifyingPanels.delete(panel);
  }
}

/**
 * Ejecuta las pruebas del artefacto (OP-14) y muestra los contadores debajo
 * de la verificación. Quien llama tiene que haber marcado el panel como
 * ocupado: la ejecución abre el mismo proyecto que la verificación.
 */
async function executeInPanel(
  panel: vscode.WebviewPanel,
  ecosystem: ActiveEcosystem,
  project: ProjectModel,
  spec: ArtifactSpec,
  verification: VerificationOutcome["status"],
) {
  const { adapter } = ecosystem;
  const willRun =
    supportsTestRun(adapter) &&
    (verification === "passed" || verification === "notApplicable");
  if (willRun) {
    panel.webview.postMessage({
      command: "testRunRunning",
      stageName: TEST_RUN_STAGE_NAME,
    });
  }

  const started = Date.now();
  const outcome = await runTestStage(adapter, project, spec, verification);
  // Fuera del tiempo de generación, como la verificación; se guarda aparte
  // para medir cuánto cuesta ejecutar.
  saveAgentOutput(project.rootPath, "test-run", {
    ...outcome,
    durationMs: Date.now() - started,
  });
  panel.webview.postMessage({
    command: "showTestRun",
    testRun: presentTestRun(outcome, spec.unitName),
  });
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
    await executeInPanel(
      panel,
      ecosystem,
      testCtx.project,
      testCtx.spec,
      verification,
    );
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

/** Detalle de un validador que encontró problemas y no trajo corrección. */
function unfixedIssues(issues: readonly string[]): string {
  return `${issues.length} problema(s) sin corregir: ${issues.join(" | ")}`;
}

function buildFullContext(
  className: string,
  methodName: string,
  targetCode: string,
  dependencyFiles: readonly ResolvedDependency[],
): string {
  const header = `// ── TARGET: ${className}.${methodName} ──────────────────────────────────────`;
  const parts = [header, targetCode];

  for (const dep of dependencyFiles) {
    if (!dep.found || !dep.content) continue;
    parts.push(
      `// ── DEPENDENCY: ${dependencyLabel(dep)} ──────────────────────────────────────`,
      dep.content,
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
  location: SymbolCandidate,
): Promise<string> {
  const declaredIn = path.join(
    project.rootPath,
    ...location.filePath.split("/"),
  );
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

    const provider = modelProviders[model];
    if (!provider) throw new Error(`Modelo no válido: ${model}`);
    const ask = (prompt: string) =>
      askOnce(provider, prompt, panel, subModel ?? undefined);

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
    const targetCode = await readTargetCode(
      ecosystem,
      project,
      editor,
      targetLocation,
    );

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
        {
          profile,
          code: targetCode,
          className,
          methodName,
          workspaceRoot: outputRoot,
        },
        ask,
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
      {
        profile,
        codeSlice,
        projectTree,
        className,
        methodName,
        workspaceRoot: outputRoot,
      },
      ask,
    );
    saveAgentOutput(outputRoot, "dependency-resolver", depResult);

    if (depResult.status === "ERROR") {
      notifyAgent(panel, depAgent, "error", depResult.message);
      throw new Error(`Dependency Resolver failed: ${depResult.message}`);
    }
    notifyAgent(panel, depAgent, "done");

    // ── OP-17 y OP-07: dependencias pedidas y detectadas ─────────────────────
    // El agente decide qué pedir y a veces omite un tipo del proyecto que el
    // código usa. Si el adaptador sabe detectarlos, se suman a lo pedido; si
    // no, queda solo lo que pidió el agente, sin ninguna condición más.
    const depReferences: string[] =
      depResult.status === "MISSING_DEPENDENCIES" ? depResult.files : [];

    let detectedReferences: readonly string[] = [];
    let detectionError: string | undefined;
    if (supportsDependencyDetection(adapter)) {
      try {
        // Sin recorte, `codeSlice` es el archivo entero: el foco limita la
        // detección al método, como se le pide al agente.
        detectedReferences = await adapter.detectDependencies(
          project,
          codeSlice,
          reduceContext ? undefined : target,
        );
      } catch (err: any) {
        // Complementa al agente: si falla, se sigue con lo que él pidió.
        detectionError = err.message;
      }
    }

    const dependencies = await resolveDependencies(
      adapter,
      project,
      depReferences,
      detectedReferences,
    );
    saveAgentOutput(outputRoot, "dependencies", {
      requested: depReferences,
      detected: detectedReferences,
      ...(detectionError === undefined ? {} : { detectionError }),
      files: dependencies.files.map(({ content, ...file }) => file),
    });

    if (dependencies.files.length > 0) {
      panel.webview.postMessage({
        command: "dependencyFiles",
        files: dependencies.files.map((f) => ({
          path: dependencyLabel(f),
          found: f.found,
          detected: f.detected,
        })),
      });
    }

    // Solo las que se encontraron: con una referencia que no existe, el
    // constructor de contexto gastaría una llamada sin nada que recortar.
    const dependencyFiles = dependencies.files
      .filter((f) => f.found)
      .map(dependencyLabel);

    // ── Step 2: Context Builder ───────────────────────────────────────────────
    let preValidationContext: string;
    if (reduceContext) {
      const ctxAgent = "Context Builder";
      notifyAgent(panel, ctxAgent, "running");
      const ctxResult = await runContextBuilder(
        {
          profile,
          codeSlice,
          dependencyFiles,
          resolvedDependencyCode: dependencies.code,
          className,
          methodName,
          workspaceRoot: outputRoot,
        },
        ask,
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
          slices: ctxResult.dependencySlices.map((s) => ({
            filePath: s.filePath,
          })),
        });
      }

      preValidationContext = ctxResult.assembledContext;
    } else {
      preValidationContext = buildFullContext(
        className,
        methodName,
        targetCode,
        dependencies.files,
      );
    }

    // ── Step 2.5: Context Validator ───────────────────────────────────────────
    const ctxValAgent = "Context Validator";
    notifyAgent(panel, ctxValAgent, "running");
    const ctxValResult = await runContextValidator(
      {
        profile,
        assembledContext: preValidationContext,
        className,
        methodName,
        workspaceRoot: outputRoot,
        fullContext: !reduceContext,
      },
      ask,
    );
    saveAgentOutput(outputRoot, "validator-context", ctxValResult);

    if (ctxValResult.status === "ERROR") {
      notifyAgent(panel, ctxValAgent, "error", ctxValResult.message);
      throw new Error(`Context Validator failed: ${ctxValResult.message}`);
    }
    if (ctxValResult.status === "UNFIXED") {
      // Falla blanda: se sigue con el contexto tal cual. Cortar aquí tiraría
      // las llamadas ya pagadas por algo que el validador no puede arreglar,
      // y los problemas quedan a la vista.
      notifyAgent(panel, ctxValAgent, "error", unfixedIssues(ctxValResult.issues));
    } else {
      notifyAgent(
        panel,
        ctxValAgent,
        "done",
        ctxValResult.status === "FIXED"
          ? `Corregidos ${ctxValResult.issues.length} problema(s)`
          : undefined,
      );
    }

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
      ask,
    );
    saveAgentOutput(outputRoot, "code-analyzer", codeAnalyzerResult);

    // Soft failure: log and continue without the pre-computed analysis
    const codeAnalysis =
      codeAnalyzerResult.status === "READY"
        ? formatCodeAnalysis(codeAnalyzerResult, analysisSchema?.format)
        : undefined;

    notifyAgent(
      panel,
      codeAnalyzerAgent,
      codeAnalyzerResult.status === "READY" ? "done" : "error",
      codeAnalyzerResult.status === "ERROR"
        ? codeAnalyzerResult.message
        : undefined,
    );

    // ── Step 3: Test Generator ────────────────────────────────────────────────
    const testAgent = "Test Generator";
    notifyAgent(panel, testAgent, "running");
    const testResult = await runTestGenerator(
      {
        profile,
        assembledContext,
        codeAnalysis,
        className,
        methodName,
        workspaceRoot: outputRoot,
      },
      ask,
    );
    saveAgentOutput(outputRoot, "test-generator", testResult);

    if (testResult.status === "ERROR") {
      notifyAgent(panel, testAgent, "error", testResult.message);
      throw new Error(`Test Generator failed: ${testResult.message}`);
    }
    notifyAgent(panel, testAgent, "done");

    // ── OP-11: normalización y escritura del artefacto ───────────────────────
    let finalTestCode = adapter.normalizeGeneratedCode(
      testResult.testCode,
      spec,
    );
    const savedPath = await writeArtifact(project, spec, finalTestCode);

    // ── Step 3.5: Test Validator ──────────────────────────────────────────────
    const testValAgent = "Test Validator";
    notifyAgent(panel, testValAgent, "running");
    const testValResult = await runTestValidator(
      {
        profile,
        testCode: finalTestCode,
        assembledContext,
        className,
        methodName,
        workspaceRoot: outputRoot,
      },
      ask,
    );
    saveAgentOutput(outputRoot, "validator-test", testValResult);

    if (testValResult.status === "ERROR") {
      // Soft failure: surface the error but keep the original generated code
      notifyAgent(panel, testValAgent, "error", testValResult.message);
    } else if (testValResult.status === "UNFIXED") {
      notifyAgent(panel, testValAgent, "error", unfixedIssues(testValResult.issues));
    } else if (testValResult.status === "FIXED") {
      finalTestCode = adapter.normalizeGeneratedCode(
        testValResult.output,
        spec,
      );
      await writeArtifact(project, spec, finalTestCode);
      notifyAgent(
        panel,
        testValAgent,
        "done",
        `Corregidos ${testValResult.issues.length} problema(s)`,
      );
    } else {
      notifyAgent(panel, testValAgent, "done");
    }

    // Store test context for ChatFixer
    testContextByPanel.set(panel, {
      testCode: finalTestCode,
      assembledContext,
      savedPath,
      project,
      spec,
      profile,
    });

    const elapsedMs = Date.now() - generationStart;
    const tokens = tokenTotalsByPanel.get(panel) ?? {
      inputTokens: 0,
      outputTokens: 0,
    };
    const totalTokens = tokens.inputTokens + tokens.outputTokens;
    panel.webview.postMessage({
      command: "showResult",
      result: finalTestCode,
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
