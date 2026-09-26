import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import type {
  ArtifactSpec,
  Diagnostic,
  PreconditionViolation,
  ProjectModel,
  VerificationResult,
} from "../../core/contracts";
import type { UnityEditorToolchain } from "./editor";

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

/**
 * Tiempo máximo de una compilación. Holgado a propósito: sin `Library`, la
 * primera apertura importa todos los recursos del proyecto.
 */
export const COMPILE_TIMEOUT_MS = 10 * 60 * 1000;

/** Mensaje con el que el modo batch rechaza un proyecto abierto en otro editor. */
const PROJECT_OPEN_MESSAGE = "another Unity instance is running with this project open";

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

  const version = project.adapterData?.["unityVersion"];
  if (typeof version !== "string") {
    return notRun({
      code: "unity.editor-version-unknown",
      message: "No se pudo leer la versión del editor del proyecto.",
      remediation:
        'Abrí el proyecto una vez con Unity Hub para que se genere "ProjectSettings/ProjectVersion.txt".',
    });
  }

  const executable = await toolchain.findEditor(version);
  if (!executable) {
    return notRun({
      code: "unity.editor-not-installed",
      message: `No se encontró instalado el editor de Unity ${version}, que es el que usa el proyecto.`,
      remediation: `Instalá Unity ${version} desde Unity Hub.`,
    });
  }

  // Se comprueba antes de lanzar para no gastar el arranque del editor: con el
  // proyecto abierto, el modo batch tarda unos 8 s en rendirse.
  if (await toolchain.isProjectOpen(project.rootPath)) {
    return notRun(projectOpenBlocker());
  }

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "utia-unity-"));
  const logFile = path.join(workDir, "compile.log");
  try {
    const run = await toolchain.run(
      executable,
      ["-batchmode", "-quit", "-nographics", "-projectPath", project.rootPath, "-logFile", logFile],
      options.timeoutMs ?? COMPILE_TIMEOUT_MS
    );
    const log = await readLog(logFile);
    const artifactPath = `${spec.directory}/${spec.fileName}${spec.extension}`;
    return classifyRun(run, log, project.rootPath, artifactPath);
  } finally {
    await removeWorkDir(workDir);
  }
}

/**
 * Cuando el editor termina, un proceso hijo suyo sigue reteniendo el log unos
 * instantes: medido en Windows, borrarlo enseguida da `EBUSY` y a los ~0,4 s
 * ya se puede. Se reintenta, y si aun así no se puede, se deja el archivo en la
 * carpeta temporal: perder el resultado por eso sería peor.
 */
async function removeWorkDir(workDir: string): Promise<void> {
  try {
    await fsp.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // Queda en la carpeta temporal del sistema; el resultado no depende de él.
  }
}

function classifyRun(
  run: Awaited<ReturnType<UnityEditorToolchain["run"]>>,
  log: string,
  rootPath: string,
  artifactPath: string
): VerificationResult {
  if (run.spawnError) {
    return notRun(
      {
        code: "unity.editor-failed-to-start",
        message: `No se pudo lanzar el editor de Unity: ${run.spawnError}`,
        remediation: "Comprobá que el editor esté bien instalado abriéndolo desde Unity Hub.",
      },
      log
    );
  }

  if (run.timedOut) {
    return notRun(
      {
        code: "unity.compile-timeout",
        message: "Unity no terminó de compilar a tiempo y se detuvo.",
        remediation:
          "Abrí el proyecto una vez en el editor para que termine de importarlo, cerralo y volvé a intentar la compilación.",
      },
      log
    );
  }

  // En macOS y Linux el bloqueo no se detecta de antemano; este es el aviso
  // que queda. En Windows también llega aquí si el editor se abrió entre la
  // comprobación y el arranque.
  if (log.includes(PROJECT_OPEN_MESSAGE)) {
    return notRun(projectOpenBlocker(), log);
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

function projectOpenBlocker(): PreconditionViolation {
  return {
    code: "unity.project-open",
    message: "El proyecto está abierto en el editor de Unity, y el modo batch no puede compilarlo a la vez.",
    remediation: "Cerrá el editor de Unity y volvé a intentar la compilación. La prueba ya quedó escrita.",
  };
}

function notRun(blocker: PreconditionViolation, rawOutput?: string): VerificationResult {
  return rawOutput === undefined
    ? { status: "notRun", blocker }
    : { status: "notRun", blocker, rawOutput };
}

async function readLog(logFile: string): Promise<string> {
  try {
    return await fsp.readFile(logFile, "utf8");
  } catch {
    // El editor no llegó a crear el log: se clasifica con lo que haya.
    return "";
  }
}
