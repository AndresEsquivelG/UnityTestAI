import * as path from "path";
import type {
  ArtifactSpec,
  Diagnostic,
  PreconditionViolation,
  ProjectModel,
  VerificationResult,
} from "../../core/contracts";
import {
  BATCH_TIMEOUT_MS,
  batchBlocker,
  prepareEditor,
  runInBatch,
  type BatchActivity,
} from "./batch";
import type { EditorRunResult, UnityEditorToolchain } from "./editor";

/**
 * OP-13 — Compilación del proyecto Unity con la prueba ya escrita.
 *
 * Se abre el proyecto con el editor en modo batch y se cierra en cuanto
 * termina de importar. Unity no tiene una orden de «solo compilar», pero abrir
 * el proyecto compila todos los ensamblados, también el de pruebas, y con
 * errores de compilación el modo batch termina con código 1.
 *
 * Medido con Unity 2021.3 sobre un proyecto chico con la carpeta `Library` ya
 * construida: 9 s si compila y 4 s si no. Sin `Library`, la primera vez
 * importa el proyecto entero y puede tardar minutos.
 *
 * Efecto secundario: como cualquier apertura del proyecto, Unity crea el
 * `.meta` de la prueba nueva y actualiza `Library`.
 */

/** Tiempo máximo de una compilación. */
export const COMPILE_TIMEOUT_MS = BATCH_TIMEOUT_MS;

const COMPILE: BatchActivity = {
  doing: "compilar",
  retry: "la compilación",
  timeoutCode: "unity.compile-timeout",
};

/**
 * Diagnóstico del compilador tal como lo escribe Unity en el log:
 * `Assets\Tests\Prueba.cs(28,9): error CS0246: The type or namespace ...`.
 */
const DIAGNOSTIC_LINE = /^(.+?)\((\d+),(\d+)\): (error|warning) ([A-Z]+\d+): (.*)$/;

export interface CompileOptions {
  readonly toolchain: UnityEditorToolchain;
  readonly timeoutMs?: number;
}

export async function compileUnityProject(
  project: ProjectModel,
  spec: ArtifactSpec,
  options: CompileOptions
): Promise<VerificationResult> {
  const { toolchain } = options;

  const editor = await prepareEditor(project, toolchain, COMPILE);
  if ("blocker" in editor) {
    return notRun(editor.blocker);
  }

  const artifactPath = `${spec.directory}/${spec.fileName}${spec.extension}`;
  return runInBatch(
    toolchain,
    editor.executable,
    (_workDir, logFile) => [
      "-batchmode",
      "-quit",
      "-nographics",
      "-projectPath",
      project.rootPath,
      "-logFile",
      logFile,
    ],
    options.timeoutMs ?? COMPILE_TIMEOUT_MS,
    async (run, log) => classifyRun(run, log, project.rootPath, artifactPath)
  );
}

function classifyRun(
  run: EditorRunResult,
  log: string,
  rootPath: string,
  artifactPath: string
): VerificationResult {
  const blocker = batchBlocker(run, log, COMPILE);
  if (blocker) {
    return notRun(blocker, log);
  }

  const exitCode = run.exitCode ?? -1;
  const diagnostics = parseUnityCompilerLog(log, rootPath);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");

  if (exitCode === 0) {
    return {
      status: "passed",
      // Unity compila el proyecto entero y los paquetes. Los avisos del resto
      // del código no son asunto de la prueba generada.
      diagnostics: diagnostics.filter((diagnostic) => samePath(diagnostic.filePath, artifactPath)),
      exitCode,
      rawOutput: log,
    };
  }

  if (errors.length > 0) {
    // Los errores se conservan todos, estén donde estén: un error en el código
    // del proyecto también impide compilar la prueba.
    return { status: "failed", diagnostics: errors, exitCode, rawOutput: log };
  }

  return notRun(
    {
      code: "unity.editor-failed",
      message: `Unity terminó con el código ${exitCode} sin informar errores de compilación.`,
      remediation:
        "Revisá la salida del editor guardada con la corrida; suele ser un problema de licencia o de importación.",
    },
    log
  );
}

/**
 * Diagnósticos del compilador presentes en el log del modo batch.
 *
 * Unity escribe cada diagnóstico dos veces, así que se descartan los
 * repetidos. Las rutas llegan relativas a la raíz del proyecto y con barra
 * invertida en Windows; se devuelven con "/" como el resto del modelo.
 */
export function parseUnityCompilerLog(log: string, rootPath: string): Diagnostic[] {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const line of log.split(/\r?\n/)) {
    const match = DIAGNOSTIC_LINE.exec(line.trim());
    if (!match) {
      continue;
    }
    const [, file, lineNumber, column, severity, code, message] = match;
    const key = `${file}|${lineNumber}|${column}|${severity}|${code}|${message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    diagnostics.push({
      filePath: toProjectRelative(file, rootPath),
      line: Number(lineNumber),
      column: Number(column),
      severity: severity as Diagnostic["severity"],
      code,
      message,
    });
  }

  return diagnostics;
}

function toProjectRelative(file: string, rootPath: string): string {
  const normalized = file.replace(/\\/g, "/");
  if (!path.isAbsolute(file)) {
    return normalized;
  }
  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  // Unity puede cambiar la mayúscula de la unidad o de alguna carpeta en las
  // rutas que escribe, así que el prefijo se compara sin distinguirlas.
  return normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
}

/** Las rutas de Windows no distinguen mayúsculas, y Unity no siempre las respeta. */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function notRun(blocker: PreconditionViolation, rawOutput?: string): VerificationResult {
  return rawOutput === undefined
    ? { status: "notRun", blocker }
    : { status: "notRun", blocker, rawOutput };
}
