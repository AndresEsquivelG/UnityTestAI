import * as fsp from "fs/promises";
import * as path from "path";
import type { PreconditionViolation, ProjectModel } from "../../../core/contracts";
import { isFile, isVirtualEnvironment } from "../discovery/layout";
import { importRootOf } from "../discovery/projectModel";
import { interpreterMissing, virtualEnvironmentBroken } from "./blockers";
import type { PythonRuntime } from "./runtime";

/**
 * Qué Python usa el proyecto, y qué tiene instalado.
 *
 * **El entorno virtual del proyecto primero.** Ahí están las bibliotecas que
 * el proyecto necesita; con otro Python, la prueba fallaría al importarlas
 * aunque pytest estuviera. Un entorno se reconoce por su contenido, como en el
 * resto del adaptador, y no por su nombre. Si el proyecto tiene uno y no
 * arranca, se dice eso: usar otro Python escondería el problema.
 *
 * **Si no tiene, el de la máquina:** `python` del PATH y, en Windows, el
 * lanzador `py`. Cada uno se prueba antes de usarlo, porque en Windows
 * `python` puede ser el atajo de la Tienda, que no es un Python: termina con
 * el código 9009 y «no se encontró Python» (comprobado en esta máquina, con
 * `python3`).
 *
 * La prueba pregunta además si están pytest y coverage, para decir qué falta
 * antes de lanzar nada.
 */

export interface PythonInterpreter {
  /** El ejecutable: una ruta absoluta (el del entorno) o un comando del PATH. */
  readonly command: string;
  /** Lo que va antes de los argumentos de cada corrida: `-3` con `py`. */
  readonly prefixArgs: readonly string[];
  /** Cómo escribirlo en una terminal abierta en la raíz, para los avisos. */
  readonly commandLine: string;
  readonly version: string;
  readonly pytest: boolean;
  readonly coverage: boolean;
}

/** Tope de cada prueba de un Python: arrancar e importar dos módulos. */
const PROBE_TIMEOUT_MS = 30 * 1000;

/** Marca de la línea con el resultado: lo que imprima otra cosa no se confunde con él. */
const PROBE_MARK = "UTIA-PROBE:";

const PROBE_SCRIPT = [
  "import importlib.util, json, sys",
  `print("${PROBE_MARK}" + json.dumps({`,
  '    "version": "%d.%d.%d" % sys.version_info[:3],',
  '    "pytest": importlib.util.find_spec("pytest") is not None,',
  '    "coverage": importlib.util.find_spec("coverage") is not None,',
  "}))",
].join("\n");

/** El código de salida del atajo de la Tienda de Windows cuando Python no está instalado. */
const STORE_ALIAS_EXIT = 9009;

/** Los nombres que se prueban primero, entre los entornos de la raíz. */
const PREFERRED_ENVIRONMENTS = [".venv", "venv", "env"];

interface Candidate {
  readonly command: string;
  readonly prefixArgs: readonly string[];
  readonly commandLine: string;
}

type ProbeOutcome =
  | { readonly kind: "found"; readonly interpreter: PythonInterpreter }
  | { readonly kind: "storeAlias" }
  | { readonly kind: "failed"; readonly detail: string };

export async function locateInterpreter(
  project: ProjectModel,
  runtime: PythonRuntime
): Promise<PythonInterpreter | { readonly blocker: PreconditionViolation }> {
  const environments = await virtualEnvironmentsOf(project.rootPath);
  if (environments.length > 0) {
    let firstFailure: { name: string; detail: string } | undefined;
    for (const environment of environments) {
      const outcome = await probe(environment.candidate, project, runtime);
      if (outcome.kind === "found") {
        return outcome.interpreter;
      }
      firstFailure ??= {
        name: environment.name,
        detail: outcome.kind === "failed" ? outcome.detail : "no arrancó",
      };
    }
    return { blocker: virtualEnvironmentBroken(firstFailure?.name ?? environments[0].name, firstFailure?.detail ?? "") };
  }

  let sawStoreAlias = false;
  for (const candidate of systemCandidates()) {
    const outcome = await probe(candidate, project, runtime);
    if (outcome.kind === "found") {
      return outcome.interpreter;
    }
    sawStoreAlias ||= outcome.kind === "storeAlias";
  }
  return { blocker: interpreterMissing(sawStoreAlias) };
}

/** Los argumentos completos de una corrida con este Python. */
export function argsFor(interpreter: PythonInterpreter, args: readonly string[]): string[] {
  return [...interpreter.prefixArgs, ...args];
}

/**
 * Los entornos virtuales que cuelgan de la raíz, con su ejecutable: los de
 * nombre conocido primero, y los demás por orden alfabético.
 */
async function virtualEnvironmentsOf(
  rootPath: string
): Promise<{ readonly name: string; readonly candidate: Candidate }[]> {
  let entries;
  try {
    entries = await fsp.readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const found: { name: string; candidate: Candidate }[] = [];
  for (const name of names) {
    const directory = path.join(rootPath, name);
    if (!(await isVirtualEnvironment(directory))) {
      continue;
    }
    // `venv` deja el ejecutable en `Scripts\` en Windows y en `bin/` en los
    // demás; conda, en la raíz del entorno en Windows.
    const relativeExecutables =
      process.platform === "win32" ? [["Scripts", "python.exe"], ["python.exe"]] : [["bin", "python"]];
    for (const relative of relativeExecutables) {
      const executable = path.join(directory, ...relative);
      if (await isFile(executable)) {
        const commandLine = path.join(name, ...relative);
        found.push({
          name,
          candidate: { command: executable, prefixArgs: [], commandLine: /\s/.test(commandLine) ? `"${commandLine}"` : commandLine },
        });
        break;
      }
    }
  }
  return found;
}

function rank(name: string): number {
  const index = PREFERRED_ENVIRONMENTS.indexOf(name);
  return index === -1 ? PREFERRED_ENVIRONMENTS.length : index;
}

function systemCandidates(): Candidate[] {
  return process.platform === "win32"
    ? [
        { command: "python", prefixArgs: [], commandLine: "python" },
        { command: "py", prefixArgs: ["-3"], commandLine: "py -3" },
      ]
    : [
        { command: "python3", prefixArgs: [], commandLine: "python3" },
        { command: "python", prefixArgs: [], commandLine: "python" },
      ];
}

async function probe(candidate: Candidate, project: ProjectModel, runtime: PythonRuntime): Promise<ProbeOutcome> {
  const run = await runtime.run(candidate.command, [...candidate.prefixArgs, "-c", PROBE_SCRIPT], {
    cwd: project.rootPath,
    timeoutMs: PROBE_TIMEOUT_MS,
    importRoot: importRootOf(project),
  });
  if (run.exitCode === STORE_ALIAS_EXIT) {
    return { kind: "storeAlias" };
  }

  const line = run.stdout.split(/\r?\n/).find((text) => text.startsWith(PROBE_MARK));
  if (run.exitCode === 0 && line) {
    try {
      const facts = JSON.parse(line.slice(PROBE_MARK.length)) as {
        version?: unknown;
        pytest?: unknown;
        coverage?: unknown;
      };
      return {
        kind: "found",
        interpreter: {
          command: candidate.command,
          prefixArgs: candidate.prefixArgs,
          commandLine: candidate.commandLine,
          version: typeof facts.version === "string" ? facts.version : "",
          pytest: facts.pytest === true,
          coverage: facts.coverage === true,
        },
      };
    } catch {
      // Una línea con la marca que no es JSON: no es el guion de la extensión.
    }
  }

  const detail = run.spawnError ?? (run.timedOut ? "no terminó a tiempo" : firstLine(run.output));
  return { kind: "failed", detail };
}

function firstLine(output: string): string {
  return output.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "terminó sin decir nada";
}
