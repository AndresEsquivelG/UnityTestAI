import * as path from "path";
import {
  supportsDependencyDetection,
  supportsSchemaExtension,
} from "../core/contracts";
import type {
  ArtifactSpec,
  CoverageTarget,
  EcosystemAdapter,
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
import { saveAgentOutput } from "../agents/agentOutputSaver";
import type { AgentStatus, Ask, PipelineEvent } from "./events";

/** Archivo abierto con el que se invocó el comando. */
export interface EditorSelection {
  /** Texto del archivo tal como está en el editor, con cambios sin guardar. */
  readonly code: string;
  /** Ruta absoluta del archivo abierto. */
  readonly path: string;
}

export interface GenerationRequest {
  readonly adapter: EcosystemAdapter;
  /** Raíz desde la que el adaptador construye el modelo (OP-04). */
  readonly rootPath: string;
  readonly className: string;
  readonly methodName: string;
  /** Identificador del modelo de lenguaje, que puede entrar en el nombre del artefacto. */
  readonly modelId: string;
  /** Con recorte: el recortador y el constructor de contexto achican lo que ve el modelo. */
  readonly reduceContext: boolean;
  /** Archivo abierto, si lo hay: su texto gana al del disco cuando es el de la unidad. */
  readonly editor?: EditorSelection;
  readonly ask: Ask;
  readonly onEvent?: (event: PipelineEvent) => void;
}

/** Lo que deja una generación, y lo que necesitan las etapas que siguen. */
export interface GeneratedTest {
  readonly testCode: string;
  readonly assembledContext: string;
  readonly savedPath: string;
  /** Modelo de la corrida, para volver a verificar el artefacto (OP-13). */
  readonly project: ProjectModel;
  /** Especificación con la que se escribió, para volver a normalizar (OP-11). */
  readonly spec: ArtifactSpec;
  /** Perfil de la corrida, para que el corrector componga el mismo prompt. */
  readonly profile: PromptProfile;
  /** Archivo y unidad bajo prueba, sobre los que se mide la cobertura (OP-15). */
  readonly coverageTarget: CoverageTarget;
}

/**
 * Genera la prueba de una unidad y la deja escrita y validada.
 *
 * Encadena OP-04 → OP-05 → OP-10 → OP-12 → OP-06 → OP-08 → agentes → OP-11 →
 * escritura. Un fallo que impide seguir se lanza; los fallos blandos de los
 * validadores y del analizador se avisan y la corrida sigue.
 */
export async function generateTest(request: GenerationRequest): Promise<GeneratedTest> {
  const { adapter, className, methodName, reduceContext, editor, ask } = request;
  const emit = request.onEvent ?? (() => undefined);
  const notifyAgent = (agent: string, status: AgentStatus, detail?: string) =>
    emit({ kind: "agent", agent, status, detail });

  // ── OP-04: modelo del proyecto ───────────────────────────────────────────
  // Se reconstruye en cada corrida a propósito: un archivo agregado desde que
  // se abrió el panel tiene que entrar en el árbol y en la localización.
  const project = await adapter.buildProjectModel(request.rootPath);
  const projectTree = renderProjectTree(project);

  // Los volcados van a la raíz del proyecto y no a la carpeta abierta, para
  // que no se partan en dos cuando se abre una subcarpeta. Los agentes siguen
  // llamando a este valor `workspaceRoot`; el nombre se corrige cuando se les
  // extraigan las plantillas.
  const outputRoot = project.rootPath;

  emit({ kind: "generationStarted" });

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
    modelId: request.modelId,
  });
  const violations = await adapter.checkPreconditions(project, spec);
  if (violations.length > 0) {
    throw new Error(describeViolations(violations));
  }

  // ── OP-06: código de la unidad ───────────────────────────────────────────
  const targetCode = await readTargetCode(adapter, project, editor, targetLocation);

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
    notifyAgent(slicerAgent, "running");
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
      notifyAgent(slicerAgent, "error", slicerResult.message);
      throw new Error(`Method Slicer failed: ${slicerResult.message}`);
    }
    notifyAgent(slicerAgent, "done");

    codeSlice = slicerResult.codeSlice.join("\n");
  } else {
    codeSlice = targetCode;
  }

  // ── Step 1: Dependency Resolver ──────────────────────────────────────────
  const depAgent = "Dependency Resolver";
  notifyAgent(depAgent, "running");
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
    notifyAgent(depAgent, "error", depResult.message);
    throw new Error(`Dependency Resolver failed: ${depResult.message}`);
  }
  notifyAgent(depAgent, "done");

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
    emit({
      kind: "dependencyFiles",
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
    notifyAgent(ctxAgent, "running");
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
      notifyAgent(ctxAgent, "error", ctxResult.message);
      throw new Error(`Context Builder failed: ${ctxResult.message}`);
    }
    notifyAgent(ctxAgent, "done");

    if (ctxResult.dependencySlices.length > 0) {
      emit({
        kind: "contextSlices",
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
  notifyAgent(ctxValAgent, "running");
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
    notifyAgent(ctxValAgent, "error", ctxValResult.message);
    throw new Error(`Context Validator failed: ${ctxValResult.message}`);
  }
  if (ctxValResult.status === "UNFIXED") {
    // Falla blanda: se sigue con el contexto tal cual. Cortar aquí tiraría
    // las llamadas ya pagadas por algo que el validador no puede arreglar,
    // y los problemas quedan a la vista.
    notifyAgent(ctxValAgent, "error", unfixedIssues(ctxValResult.issues));
  } else {
    notifyAgent(
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
  notifyAgent(codeAnalyzerAgent, "running");
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
    codeAnalyzerAgent,
    codeAnalyzerResult.status === "READY" ? "done" : "error",
    codeAnalyzerResult.status === "ERROR"
      ? codeAnalyzerResult.message
      : undefined,
  );

  // ── Step 3: Test Generator ────────────────────────────────────────────────
  const testAgent = "Test Generator";
  notifyAgent(testAgent, "running");
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
    notifyAgent(testAgent, "error", testResult.message);
    throw new Error(`Test Generator failed: ${testResult.message}`);
  }
  notifyAgent(testAgent, "done");

  // ── OP-11: normalización y escritura del artefacto ───────────────────────
  let finalTestCode = adapter.normalizeGeneratedCode(
    testResult.testCode,
    spec,
  );
  const savedPath = await writeArtifact(project, spec, finalTestCode);

  // ── Step 3.5: Test Validator ──────────────────────────────────────────────
  const testValAgent = "Test Validator";
  notifyAgent(testValAgent, "running");
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
    notifyAgent(testValAgent, "error", testValResult.message);
  } else if (testValResult.status === "UNFIXED") {
    notifyAgent(testValAgent, "error", unfixedIssues(testValResult.issues));
  } else if (testValResult.status === "FIXED") {
    finalTestCode = adapter.normalizeGeneratedCode(
      testValResult.output,
      spec,
    );
    await writeArtifact(project, spec, finalTestCode);
    notifyAgent(
      testValAgent,
      "done",
      `Corregidos ${testValResult.issues.length} problema(s)`,
    );
  } else {
    notifyAgent(testValAgent, "done");
  }

  return {
    testCode: finalTestCode,
    assembledContext,
    savedPath,
    project,
    spec,
    profile,
    coverageTarget: { filePath: targetLocation.filePath, unit: target },
  };
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
    if (!dep.found || !dep.content) {
      continue;
    }
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
  adapter: EcosystemAdapter,
  project: ProjectModel,
  editor: EditorSelection | undefined,
  location: SymbolCandidate,
): Promise<string> {
  const declaredIn = path.join(
    project.rootPath,
    ...location.filePath.split("/"),
  );
  if (editor && samePath(declaredIn, editor.path)) {
    return editor.code;
  }
  const source = await adapter.readSource(project, location);
  return source.content;
}
