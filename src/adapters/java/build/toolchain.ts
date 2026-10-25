import { spawn } from "child_process";
import * as fsp from "fs/promises";
import * as path from "path";
import type { SupportedBuildTool } from "../discovery/layout";

/**
 * Acceso a Maven y Gradle como programas externos: cuál usa el proyecto y
 * cómo lanzarlo.
 *
 * Está separado de la compilación, la ejecución y la cobertura para poder
 * reemplazarlo en las pruebas: las herramientas tardan segundos, bajan cosas
 * de Internet y no están instaladas en todas las máquinas.
 */
export interface JavaBuildToolchain {
  /**
   * El lanzador de la herramienta: el wrapper del proyecto si lo trae, y si
   * no, la instalada en la máquina. `undefined` si no hay ninguno.
   */
  findLauncher(tool: SupportedBuildTool, rootPath: string): Promise<BuildLauncher | undefined>;
  /**
   * Lanza la herramienta con la raíz del proyecto como carpeta de trabajo y
   * espera a que termine o a que se agote el tiempo.
   */
  run(launcher: BuildLauncher, args: readonly string[], options: BuildRunOptions): Promise<BuildRunResult>;
}

export interface BuildLauncher {
  /**
   * Cómo se invoca: la ruta del wrapper relativa a la raíz del proyecto
   * (`./mvnw`), o el nombre del comando instalado (`mvn`).
   */
  readonly command: string;
  /** Si es el wrapper que trae el proyecto. */
  readonly wrapper: boolean;
}

export interface BuildRunOptions {
  /** Raíz del proyecto. */
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface BuildRunResult {
  /** Código de salida, o `null` si el proceso no llegó a terminar por sí mismo. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Error del sistema al lanzar el proceso. */
  readonly spawnError?: string;
  /** Salida estándar y de error juntas, en el orden en que llegaron. */
  readonly output: string;
}

const WRAPPERS: Record<SupportedBuildTool, { readonly windows: string; readonly posix: string }> = {
  maven: { windows: "mvnw.cmd", posix: "mvnw" },
  gradle: { windows: "gradlew.bat", posix: "gradlew" },
};

const INSTALLED: Record<SupportedBuildTool, string> = { maven: "mvn", gradle: "gradle" };

/**
 * Tope de la salida que se guarda. Lo que importa (errores de compilación,
 * descargas que fallan) sale al principio, y los resultados se leen de los
 * informes, no de la consola. Sin tope, una prueba que imprime sin parar
 * hasta agotar el tiempo llenaría la memoria.
 */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * La consola de Java escribe en la codificación de Windows cuando su salida
 * va a otro programa: medido con Maven en esta máquina, la «é» de «Andrés»
 * llegaba como el byte 0xE9 de la página 1252. Se le pide UTF-8. Las dos
 * formas de la propiedad porque Java 19 cambió su nombre.
 */
const UTF8_CONSOLE =
  "-Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8";

export function buildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const extended: NodeJS.ProcessEnv = {};
  const current: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    // Windows no distingue mayúsculas en los nombres: se reemplaza la
    // variable que ya hubiera, se llame como se llame, en lugar de duplicarla.
    const upper = key.toUpperCase();
    if (upper === "MAVEN_OPTS" || upper === "GRADLE_OPTS") {
      current[upper] = value ?? "";
      continue;
    }
    extended[key] = value;
  }
  const append = (value: string | undefined) => (value ? `${value} ${UTF8_CONSOLE}` : UTF8_CONSOLE);
  extended["MAVEN_OPTS"] = append(current["MAVEN_OPTS"]);
  extended["GRADLE_OPTS"] = append(current["GRADLE_OPTS"]);
  return extended;
}

/**
 * Busca un comando en las carpetas del PATH, con las extensiones que Windows
 * prueba al ejecutar (`mvn` es `mvn.cmd` en Windows).
 */
export async function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | undefined> {
  const pathValue = env["PATH"] ?? env["Path"] ?? "";
  const separator = platform === "win32" ? ";" : ":";
  const extensions =
    platform === "win32"
      ? (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext !== "")
      : [""];

  for (const directory of pathValue.split(separator)) {
    const clean = directory.replace(/^"(.*)"$/, "$1").trim();
    if (clean === "") {
      continue;
    }
    for (const extension of extensions) {
      const candidate = path.join(clean, `${name}${extension.toLowerCase()}`);
      try {
        if ((await fsp.stat(candidate)).isFile()) {
          return candidate;
        }
      } catch {
        // No está en esta carpeta; se prueba la siguiente.
      }
    }
  }
  return undefined;
}

async function findLauncher(
  tool: SupportedBuildTool,
  rootPath: string
): Promise<BuildLauncher | undefined> {
  const isWindows = process.platform === "win32";
  const wrapper = isWindows ? WRAPPERS[tool].windows : WRAPPERS[tool].posix;
  try {
    if ((await fsp.stat(path.join(rootPath, wrapper))).isFile()) {
      // Relativa a la raíz, que es la carpeta de trabajo: así la ruta del
      // proyecto, con sus espacios y tildes, no pasa por la línea de comandos.
      return { command: isWindows ? `.\\${wrapper}` : `./${wrapper}`, wrapper: true };
    }
  } catch {
    // Sin wrapper se busca la instalada.
  }

  const installed = INSTALLED[tool];
  return (await findOnPath(installed, process.env, process.platform))
    ? { command: installed, wrapper: false }
    : undefined;
}

/**
 * Comillas para `cmd.exe`, solo cuando hacen falta. Los argumentos que arma
 * el adaptador son nombres de tareas, propiedades y rutas relativas sin
 * espacios, así que normalmente no llevan: `-Dtest=com.x.Prueba` pasa tal
 * cual, como se probó con `mvnw.cmd` y `gradlew.bat`.
 */
export function quoteForCmd(arg: string): string {
  return /[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

function runBuild(
  launcher: BuildLauncher,
  args: readonly string[],
  options: BuildRunOptions
): Promise<BuildRunResult> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const chunks: Buffer[] = [];
    let stored = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const output = () => {
      const text = Buffer.concat(chunks).toString("utf8");
      return truncated ? `${text}\n[salida recortada: superó ${MAX_OUTPUT_BYTES} bytes]` : text;
    };
    const settle = (result: Omit<BuildRunResult, "output">) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ...result, output: output() });
      }
    };

    // En Windows los lanzadores son `.cmd` o `.bat`, y Node no los lanza sin
    // pasar por la consola: sin `shell` da EINVAL (comprobado con Node 24).
    // En los demás sistemas el wrapper se pasa a `sh`, que no exige que el
    // archivo tenga permiso de ejecución.
    const child = isWindows
      ? spawn([launcher.command, ...args].map(quoteForCmd).join(" "), [], {
          cwd: options.cwd,
          env: buildEnvironment(process.env),
          shell: true,
          windowsHide: true,
        })
      : launcher.wrapper
        ? spawn("sh", [launcher.command, ...args], {
            cwd: options.cwd,
            env: buildEnvironment(process.env),
            detached: true,
          })
        : spawn(launcher.command, [...args], {
            cwd: options.cwd,
            env: buildEnvironment(process.env),
            detached: true,
          });

    const collect = (chunk: Buffer) => {
      // Una vez recortada no se guarda nada más, ni siquiera un pedazo chico
      // que entraría: la salida quedaría con un hueco en el medio.
      if (truncated || stored + chunk.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      chunks.push(chunk);
      stored += chunk.length;
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, options.timeoutMs);

    child.on("error", (error) => settle({ exitCode: null, timedOut, spawnError: error.message }));
    child.on("close", (code) => settle({ exitCode: code, timedOut }));
  });
}

/**
 * Matar solo el proceso lanzado no alcanza: en Windows es la consola, y Java
 * sigue corriendo debajo. Se mata el árbol entero.
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).on("error", () => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Ya terminó.
  }
}

/** Maven y Gradle de esta máquina. */
export const systemBuildToolchain: JavaBuildToolchain = {
  findLauncher,
  run: runBuild,
};
