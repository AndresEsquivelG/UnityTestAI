import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { PreconditionViolation, ProjectModel } from "../../core/contracts";
import type { EditorRunResult, UnityEditorToolchain } from "./editor";

/**
 * Lo que comparten la compilación (OP-13) y la ejecución de pruebas (OP-14):
 * las dos abren el proyecto con el editor en modo batch, con las mismas
 * condiciones para poder lanzarlo y las mismas formas de fallar antes de
 * llegar a hacer su trabajo.
 */

/**
 * Tiempo máximo de una corrida. Holgado a propósito: sin `Library`, la
 * primera apertura importa todos los recursos del proyecto.
 */
export const BATCH_TIMEOUT_MS = 10 * 60 * 1000;

/** Mensaje con el que el modo batch rechaza un proyecto abierto en otro editor. */
const PROJECT_OPEN_MESSAGE = "another Unity instance is running with this project open";

/** Lo que el log dice cuando el proyecto no compila, en las dos corridas. */
export const COMPILER_ERRORS_MESSAGE = "Scripts have compiler errors.";

/** Cómo se nombra, en los avisos, lo que la corrida iba a hacer. */
export interface BatchActivity {
  /** En infinitivo: "compilar", "ejecutar las pruebas". */
  readonly doing: string;
  /** Lo que se vuelve a intentar: "la compilación", "la ejecución". */
  readonly retry: string;
  /** Código del incumplimiento cuando se agota el tiempo. */
  readonly timeoutCode: string;
}

/** El editor que corresponde al proyecto, o por qué no se puede lanzar. */
export async function prepareEditor(
  project: ProjectModel,
  toolchain: UnityEditorToolchain,
  activity: BatchActivity
): Promise<{ readonly executable: string } | { readonly blocker: PreconditionViolation }> {
  const version = project.adapterData?.["unityVersion"];
  if (typeof version !== "string") {
    return {
      blocker: {
        code: "unity.editor-version-unknown",
        message: "No se pudo leer la versión del editor del proyecto.",
        remediation:
          'Abrí el proyecto una vez con Unity Hub para que se genere "ProjectSettings/ProjectVersion.txt".',
      },
    };
  }

  const executable = await toolchain.findEditor(version);
  if (!executable) {
    return {
      blocker: {
        code: "unity.editor-not-installed",
        message: `No se encontró instalado el editor de Unity ${version}, que es el que usa el proyecto.`,
        remediation: `Instalá Unity ${version} desde Unity Hub.`,
      },
    };
  }

  // Se comprueba antes de lanzar para no gastar el arranque del editor: con el
  // proyecto abierto, el modo batch tarda unos 8 s en rendirse.
  if (await toolchain.isProjectOpen(project.rootPath)) {
    return { blocker: projectOpenBlocker(activity) };
  }

  return { executable };
}

/**
 * Lanza el editor con una carpeta de trabajo propia, lee el log y la borra.
 * `args` recibe esa carpeta para ubicar ahí los archivos que produzca la
 * corrida; `read` los lee antes de que se borren.
 */
export async function runInBatch<T>(
  toolchain: UnityEditorToolchain,
  executable: string,
  args: (workDir: string, logFile: string) => readonly string[],
  timeoutMs: number,
  read: (run: EditorRunResult, log: string, workDir: string) => Promise<T>
): Promise<T> {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "utia-unity-"));
  const logFile = path.join(workDir, "unity.log");
  try {
    const run = await toolchain.run(executable, args(workDir, logFile), timeoutMs);
    const log = await readIfPresent(logFile);
    return await read(run, log, workDir);
  } finally {
    await removeWorkDir(workDir);
  }
}

/**
 * Las formas de fallar que no dependen de lo que la corrida iba a hacer: el
 * editor no arrancó, se agotó el tiempo, u otro editor tenía el proyecto.
 * Devuelve `undefined` si no pasó ninguna.
 */
export function batchBlocker(
  run: EditorRunResult,
  log: string,
  activity: BatchActivity
): PreconditionViolation | undefined {
  if (run.spawnError) {
    return {
      code: "unity.editor-failed-to-start",
      message: `No se pudo lanzar el editor de Unity: ${run.spawnError}`,
      remediation: "Comprobá que el editor esté bien instalado abriéndolo desde Unity Hub.",
    };
  }

  if (run.timedOut) {
    return {
      code: activity.timeoutCode,
      message: `Unity no terminó de ${activity.doing} a tiempo y se detuvo.`,
      remediation: `Abrí el proyecto una vez en el editor para que termine de importarlo, cerralo y volvé a intentar ${activity.retry}.`,
    };
  }

  // En macOS y Linux el bloqueo no se detecta de antemano; este es el aviso
  // que queda. En Windows también llega aquí si el editor se abrió entre la
  // comprobación y el arranque.
  if (log.includes(PROJECT_OPEN_MESSAGE)) {
    return projectOpenBlocker(activity);
  }

  return undefined;
}

function projectOpenBlocker(activity: BatchActivity): PreconditionViolation {
  return {
    code: "unity.project-open",
    message: `El proyecto está abierto en el editor de Unity, y el modo batch no puede ${activity.doing} mientras tanto.`,
    remediation: `Cerrá el editor de Unity y volvé a intentar ${activity.retry}. La prueba ya quedó escrita.`,
  };
}

/**
 * Cuando el editor termina, un proceso hijo suyo sigue reteniendo el log unos
 * instantes: medido en Windows, borrarlo enseguida da `EBUSY` y a los ~0,4 s
 * ya se puede. Se reintenta, y si aun así no se puede, se deja la carpeta en
 * el directorio temporal: perder el resultado por eso sería peor.
 */
async function removeWorkDir(workDir: string): Promise<void> {
  try {
    await fsp.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // Queda en la carpeta temporal del sistema; el resultado no depende de ella.
  }
}

/** Contenido de un archivo que la corrida pudo no llegar a escribir. */
export async function readIfPresent(file: string): Promise<string> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return "";
  }
}
