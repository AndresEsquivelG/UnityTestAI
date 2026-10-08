import { spawn } from "child_process";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Acceso al editor de Unity como programa externo: dónde está instalado, si
 * otra instancia tiene el proyecto abierto y cómo lanzarlo en modo batch.
 *
 * Está separado de la compilación para poder reemplazarlo en las pruebas: el
 * editor tarda segundos en arrancar y no está instalado en todas las máquinas.
 */
export interface UnityEditorToolchain {
  /** Ejecutable del editor de esa versión, o `undefined` si no está instalado. */
  findEditor(version: string): Promise<string | undefined>;
  /** Si otra instancia del editor tiene abierto el proyecto. */
  isProjectOpen(projectRoot: string): Promise<boolean>;
  /** Lanza el editor y espera a que termine o a que se agote el tiempo. */
  run(executable: string, args: readonly string[], timeoutMs: number): Promise<EditorRunResult>;
}

export interface EditorRunResult {
  /** Código de salida, o `null` si el proceso no llegó a terminar por sí mismo. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Error del sistema al lanzar el proceso, por ejemplo un ejecutable inexistente. */
  readonly spawnError?: string;
}

/**
 * Ubicaciones posibles del ejecutable, en orden de preferencia.
 *
 * Primero la carpeta secundaria que se puede configurar en Unity Hub, porque
 * si existe es la que la persona eligió; después la carpeta por defecto de
 * Hub en cada sistema. Solo la de Windows está comprobada en una máquina real.
 */
export function editorCandidates(
  version: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  secondaryInstallDir?: string
): string[] {
  const inside = (base: string): string => {
    if (platform === "darwin") {
      return path.posix.join(base, version, "Unity.app", "Contents", "MacOS", "Unity");
    }
    const join = platform === "win32" ? path.win32.join : path.posix.join;
    return join(base, version, "Editor", platform === "win32" ? "Unity.exe" : "Unity");
  };

  const candidates: string[] = [];
  if (secondaryInstallDir) {
    candidates.push(inside(secondaryInstallDir));
  }

  if (platform === "win32") {
    const programFiles = env["ProgramFiles"] ?? "C:\\Program Files";
    candidates.push(inside(path.win32.join(programFiles, "Unity", "Hub", "Editor")));
  } else if (platform === "darwin") {
    candidates.push(inside("/Applications/Unity/Hub/Editor"));
  } else {
    candidates.push(inside(path.posix.join(env["HOME"] ?? os.homedir(), "Unity", "Hub", "Editor")));
  }

  return candidates;
}

/**
 * Carpeta secundaria de instalación de Unity Hub.
 *
 * Hub la guarda como una cadena JSON en `secondaryInstallPath.json`. En la
 * máquina donde se escribió esto el archivo no existe, así que el formato no
 * está comprobado: si no se puede leer, se sigue con la carpeta por defecto.
 */
async function readSecondaryInstallDir(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const appData = env["APPDATA"];
  if (!appData) {
    return undefined;
  }
  try {
    const content = await fsp.readFile(
      path.join(appData, "UnityHub", "secondaryInstallPath.json"),
      "utf8"
    );
    const value: unknown = JSON.parse(content);
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Unity crea `Temp/UnityLockfile` al abrir un proyecto y lo mantiene tomado
 * mientras el editor sigue abierto.
 *
 * Comprobado en Windows con 2021.3: con el editor abierto, abrir el archivo da
 * `EBUSY`; si el editor se cerró de golpe, el archivo queda pero se abre sin
 * problema, y el modo batch lo ignora y compila. Por eso no basta con que el
 * archivo exista.
 *
 * En macOS y Linux el bloqueo es consultivo y abrir el archivo no falla, así
 * que esta comprobación da falso. Ahí el aviso llega igual, más tarde, por el
 * mensaje que deja el modo batch en el log.
 */
async function isUnityProjectOpen(projectRoot: string): Promise<boolean> {
  const lockfile = path.join(projectRoot, "Temp", "UnityLockfile");
  let handle;
  try {
    handle = await fsp.open(lockfile, "r+");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EBUSY" || code === "EPERM" || code === "EACCES";
  }
  await handle.close();
  return false;
}

function runEditor(
  executable: string,
  args: readonly string[],
  timeoutMs: number
): Promise<EditorRunResult> {
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const settle = (result: EditorRunResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    // La salida se lee del archivo de `-logFile`, no de la consola: el modo
    // batch escribe ahí todo lo que importa, y no depender de los flujos evita
    // que un búfer lleno detenga el proceso.
    const child = spawn(executable, [...args], { stdio: "ignore", windowsHide: true });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.on("error", (error) => settle({ exitCode: null, timedOut, spawnError: error.message }));
    child.on("close", (code) => settle({ exitCode: code, timedOut }));
  });
}

/** El editor instalado en esta máquina. */
export const systemEditorToolchain: UnityEditorToolchain = {
  async findEditor(version) {
    const secondary = await readSecondaryInstallDir(process.env);
    for (const candidate of editorCandidates(version, process.platform, process.env, secondary)) {
      try {
        if ((await fsp.stat(candidate)).isFile()) {
          return candidate;
        }
      } catch {
        // No está en esta ubicación; se prueba la siguiente.
      }
    }
    return undefined;
  },
  isProjectOpen: isUnityProjectOpen,
  run: runEditor,
};
