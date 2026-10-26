import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import type {
  ArtifactSpec,
  CoverageTarget,
  PreconditionViolation,
  ProjectModel,
  TestExecutionResult,
} from "../../../core/contracts";
import { importRootOf } from "../discovery/projectModel";
import { pytestMissing, runBlocker, savedOutputHint, type PythonActivity } from "./blockers";
import { PYTEST, PYTHON_TIMEOUT_MS, coverageConfig, testFileArg } from "./commands";
import { argsFor, locateInterpreter, type PythonInterpreter } from "./interpreter";
import { isCollectionFailure, parseJUnitReport } from "./junitReport";
import type { PythonRunResult, PythonRuntime } from "./runtime";

/**
 * OP-14 — Ejecución de la prueba generada con pytest, y si se pide, la
 * cobertura de esa misma corrida con coverage.
 *
 * Se ejecuta solo el archivo de la prueba, por su ruta. El resultado se lee
 * del informe JUnit, no de la consola. Con cobertura, pytest corre adentro de
 * `coverage run`, que devuelve el mismo código de salida, y después
 * `coverage json` deja el informe que lee OP-15. Una prueba que falla también
 * se mide: coverage guarda los datos igual.
 *
 * Todo lo que se escribe (el informe, los datos y la configuración de
 * coverage) va a una carpeta temporal que se borra al terminar: en el
 * proyecto no queda nada.
 *
 * Medido en `python-patterns`: 0,5 a 0,9 s, y 1,2 s midiendo.
 */

const RUN_TESTS: PythonActivity = { doing: "ejecutar las pruebas", retry: "la ejecución" };

/**
 * Lo que la ejecución le deja a OP-15 en `rawCoverage`. Solo lo lee este
 * adaptador: el informe de coverage, o por qué no lo hay.
 */
export type RawPythonCoverage =
  | { readonly json: string }
  | { readonly missing: "module"; readonly commandLine: string }
  | { readonly missing: "report"; readonly output: string };

export interface PythonTestRunOptions {
  readonly runtime: PythonRuntime;
  readonly timeoutMs?: number;
}

export async function runPythonTests(
  project: ProjectModel,
  spec: ArtifactSpec,
  options: PythonTestRunOptions,
  coverage?: CoverageTarget
): Promise<TestExecutionResult> {
  const located = await locateInterpreter(project, options.runtime);
  if ("blocker" in located) {
    return { status: "notRun", blocker: located.blocker };
  }
  if (!located.pytest) {
    return { status: "notRun", blocker: pytestMissing(located) };
  }

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "unitytestia-pytest-"));
  try {
    return await runIn(workDir, project, spec, located, options, coverage);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

async function runIn(
  workDir: string,
  project: ProjectModel,
  spec: ArtifactSpec,
  interpreter: PythonInterpreter,
  options: PythonTestRunOptions,
  coverage: CoverageTarget | undefined
): Promise<TestExecutionResult> {
  const timeoutMs = options.timeoutMs ?? PYTHON_TIMEOUT_MS;
  const run = (args: readonly string[]) =>
    options.runtime.run(interpreter.command, argsFor(interpreter, args), {
      cwd: project.rootPath,
      timeoutMs,
      importRoot: importRootOf(project),
    });

  const reportFile = path.join(workDir, "junit.xml");
  const configFile = path.join(workDir, "coveragerc");
  const pytestArgs = [...PYTEST, testFileArg(spec), `--junitxml=${reportFile}`];
  const measure = coverage !== undefined && interpreter.coverage;
  if (measure) {
    await fsp.writeFile(configFile, coverageConfig(path.join(workDir, "coverage-data")), "utf8");
  }

  const tests = await run(
    measure && coverage
      ? ["-m", "coverage", "run", `--rcfile=${configFile}`, `--include=${nativePath(coverage.filePath)}`, ...pytestArgs]
      : pytestArgs
  );

  // Si no arrancó o se cortó, un informe que haya llegado a escribir no vale.
  const interrupted = runBlocker(tests, RUN_TESTS, timeoutMs);
  if (interrupted) {
    return notRun(interrupted, tests.output);
  }

  const exitCode = tests.exitCode ?? -1;
  const report = await readIfPresent(reportFile);
  if (exitCode === 2 || isCollectionFailure(report)) {
    return notRun(
      {
        code: "python.tests-not-importable",
        message: "pytest no pudo importar la prueba, así que no se ejecutó.",
        remediation: "Volvé a intentar la comprobación de importabilidad para ver los errores.",
      },
      tests.output
    );
  }

  const parsed = report === "" ? undefined : parseJUnitReport(report);
  if (exitCode === 5 || (parsed && parsed.total === 0)) {
    return notRun(
      {
        code: "python.no-tests-found",
        message: `pytest no encontró ninguna prueba en ${spec.directory}/${spec.fileName}${spec.extension}.`,
        remediation: "pytest solo corre las funciones cuyo nombre empieza con test_. Revisá la prueba y volvé a intentar la ejecución.",
      },
      tests.output
    );
  }

  if (!parsed) {
    return notRun(
      {
        code: "python.test-report-missing",
        message: `pytest terminó con el código ${exitCode} sin dejar el informe de resultados.`,
        remediation: `${savedOutputHint("test-run")} Probá ejecutar la prueba con «python -m pytest» en una terminal abierta en la raíz.`,
      },
      tests.output
    );
  }

  const rawCoverage =
    coverage === undefined
      ? undefined
      : JSON.stringify(
          measure
            ? await coverageReport(run, configFile, path.join(workDir, "coverage.json"))
            : { missing: "module", commandLine: interpreter.commandLine }
        );

  return {
    status: parsed.failed > 0 ? "failed" : "passed",
    ...parsed,
    exitCode,
    rawReport: report,
    ...(rawCoverage === undefined ? {} : { rawCoverage }),
  };
}

/** `coverage json` sobre los datos de la corrida. */
async function coverageReport(
  run: (args: readonly string[]) => Promise<PythonRunResult>,
  configFile: string,
  jsonFile: string
): Promise<RawPythonCoverage> {
  const result = await run(["-m", "coverage", "json", `--rcfile=${configFile}`, "-o", jsonFile]);
  const json = await readIfPresent(jsonFile);
  return result.exitCode === 0 && json !== "" ? { json } : { missing: "report", output: result.output };
}

/** coverage compara rutas del sistema: con «\» en Windows (así se comprobó). */
function nativePath(relative: string): string {
  return path.join(...relative.split("/"));
}

async function readIfPresent(file: string): Promise<string> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return "";
  }
}

function notRun(blocker: PreconditionViolation, rawOutput: string): TestExecutionResult {
  return { status: "notRun", blocker, rawOutput };
}
