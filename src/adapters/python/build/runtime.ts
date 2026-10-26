import { spawn } from "child_process";

/**
 * Acceso a Python como programa externo: lanzarlo y esperar a que termine.
 *
 * Está separado de la comprobación, la ejecución y la cobertura para poder
 * reemplazarlo en las pruebas: Python no está instalado en todas las
 * máquinas, y las pruebas del adaptador no lo necesitan.
 *
 * A diferencia de Maven y Gradle, Python se lanza directo, sin pasar por la
 * consola: su ejecutable es un `.exe` en Windows, y Node lo lanza solo
 * (comprobado con Node 24 y Python 3.14). Así ninguna ruta, con sus espacios
 * y tildes, pasa por una línea de comandos.
 */
export interface PythonRuntime {
  /**
   * Lanza `command` con la raíz del proyecto como carpeta de trabajo, sin
   * entrada, y espera a que termine o a que se agote el tiempo.
   */
  run(command: string, args: readonly string[], options: PythonRunOptions): Promise<PythonRunResult>;
}

export interface PythonRunOptions {
  /** Raíz del proyecto. */
  readonly cwd: string;
  readonly timeoutMs: number;
  /**
   * La carpeta desde la que se importan los módulos del proyecto, relativa a
   * la raíz: `.` en la forma plana, `src` en la forma con esa carpeta.
   */
  readonly importRoot: string;
}

export interface PythonRunResult {
  /** Código de salida, o `null` si el proceso no llegó a terminar por sí mismo. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Error del sistema al lanzar el proceso: `ENOENT` si el comando no existe. */
  readonly spawnError?: string;
  /** Solo la salida estándar: ahí escriben su resultado los guiones de la extensión. */
  readonly stdout: string;
  /** Salida estándar y de error juntas, en el orden en que llegaron. */
  readonly output: string;
}

/**
 * Tope de la salida que se guarda. Los resultados se leen de los informes, no
 * de la consola; sin tope, una prueba que imprime sin parar hasta agotar el
 * tiempo llenaría la memoria.
 */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * El entorno de cada corrida:
 *
 *   · `PYTHONUTF8=1`: sin esto, la salida que va a otro programa llega en la
 *     codificación de Windows (página 1252), y la «é» de una ruta llega como
 *     un byte suelto (comprobado con Python 3.14);
 *   · `PYTHONDONTWRITEBYTECODE=1`: que no queden carpetas `__pycache__` en el
 *     proyecto;
 *   · la carpeta de importación delante de `PYTHONPATH`: con la forma con
 *     `src/`, sin ella no se encuentra ningún módulo del proyecto (comprobado
 *     con `humanize`);
 *   · sin `PYTEST_ADDOPTS`: es el mismo `addopts` del proyecto, puesto en una
 *     variable, y se anula por el mismo motivo (ver `commands.ts`).
 */
export function pythonEnvironment(env: NodeJS.ProcessEnv, importRoot: string, delimiter: string): NodeJS.ProcessEnv {
  const extended: NodeJS.ProcessEnv = {};
  let pythonPath: string | undefined;
  for (const [key, value] of Object.entries(env)) {
    // Windows no distingue mayúsculas en los nombres: se reemplaza la
    // variable que ya hubiera, se llame como se llame, en lugar de duplicarla.
    const upper = key.toUpperCase();
    if (upper === "PYTHONPATH") {
      pythonPath = value;
      continue;
    }
    if (upper === "PYTEST_ADDOPTS" || upper === "PYTHONUTF8" || upper === "PYTHONDONTWRITEBYTECODE") {
      continue;
    }
    extended[key] = value;
  }
  extended["PYTHONUTF8"] = "1";
  extended["PYTHONDONTWRITEBYTECODE"] = "1";
  extended["PYTHONPATH"] = pythonPath ? `${importRoot}${delimiter}${pythonPath}` : importRoot;
  return extended;
}

function runPython(command: string, args: readonly string[], options: PythonRunOptions): Promise<PythonRunResult> {
  return new Promise((resolve) => {
    const all: Buffer[] = [];
    const out: Buffer[] = [];
    let stored = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const text = (chunks: Buffer[]) => Buffer.concat(chunks).toString("utf8");
    const settle = (result: Omit<PythonRunResult, "output" | "stdout">) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const output = text(all);
        resolve({
          ...result,
          stdout: text(out),
          output: truncated ? `${output}\n[salida recortada: superó ${MAX_OUTPUT_BYTES} bytes]` : output,
        });
      }
    };

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: pythonEnvironment(process.env, options.importRoot, process.platform === "win32" ? ";" : ":"),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const collect = (chunk: Buffer, stdout: boolean) => {
      // Una vez recortada no se guarda nada más, ni siquiera un pedazo chico
      // que entraría: la salida quedaría con un hueco en el medio.
      if (truncated || stored + chunk.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      all.push(chunk);
      if (stdout) {
        out.push(chunk);
      }
      stored += chunk.length;
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, options.timeoutMs);

    child.on("error", (error) => settle({ exitCode: null, timedOut, spawnError: error.message }));
    child.on("close", (code) => settle({ exitCode: code, timedOut }));
  });
}

/**
 * El `python.exe` de un entorno virtual es un lanzador que corre un segundo
 * `python.exe`, el de verdad. Matar solo el primero alcanzó en la prueba a
 * mano, pero se mata el árbol entero, como con Maven y Gradle.
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

/** El Python de esta máquina. */
export const systemPythonRuntime: PythonRuntime = { run: runPython };
