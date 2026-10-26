import type {
  ArtifactSpec,
  Diagnostic,
  PreconditionViolation,
  ProjectModel,
  VerificationResult,
} from "../../../core/contracts";
import { importRootOf } from "../discovery/projectModel";
import { pytestMissing, runBlocker, savedOutputHint, type PythonActivity } from "./blockers";
import { parseCollectionErrors } from "./collection";
import { PYTEST, PYTHON_TIMEOUT_MS, testFileArg } from "./commands";
import { argsFor, locateInterpreter } from "./interpreter";
import { REVIEW_SCRIPT, parseReview } from "./review";
import type { PythonRunResult, PythonRuntime } from "./runtime";

/**
 * OP-13 — Comprobación de importabilidad: que la prueba se lea y se pueda
 * importar, con todo lo que importa, antes de ejecutarla. Es el equivalente
 * de la compilación en un lenguaje que no compila.
 *
 * Dos pasos, los dos siempre:
 *
 *   1. **el revisor** (`review.ts`) junta todos los errores de importación y
 *      los nombres sin definir, también los de adentro de las funciones;
 *   2. **`pytest --collect-only`** importa la prueba como lo hará al
 *      ejecutarla, sin correr ninguna, y ve lo que el revisor no: un error al
 *      ejecutar el código del módulo que no sea un nombre, o un problema de la
 *      configuración de pytest. Es el que tiene la última palabra.
 *
 * Los errores se juntan sin repetir: el primero de pytest suele ser uno que el
 * revisor ya vio. Cada uno lleva el nombre de la excepción como código
 * (`ModuleNotFoundError`, `NameError`), que es lo que el criterio de HU-19 pide
 * y `javac` no da.
 *
 * Los códigos de salida de pytest, comprobados: 0 bien, 2 un archivo que no se
 * pudo importar, 4 mal llamado (el archivo no existe), 5 cero pruebas. Medido
 * en `python-patterns`: el revisor 0,3 s y pytest 0,6 s.
 */

const CHECK: PythonActivity = { doing: "comprobar la prueba", retry: "la comprobación" };

export interface PythonCheckOptions {
  readonly runtime: PythonRuntime;
  readonly timeoutMs?: number;
}

export async function checkPythonImports(
  project: ProjectModel,
  spec: ArtifactSpec,
  options: PythonCheckOptions
): Promise<VerificationResult> {
  const located = await locateInterpreter(project, options.runtime);
  if ("blocker" in located) {
    return notRun(located.blocker);
  }
  if (!located.pytest) {
    return notRun(pytestMissing(located));
  }

  const timeoutMs = options.timeoutMs ?? PYTHON_TIMEOUT_MS;
  const run = (args: readonly string[]) =>
    options.runtime.run(located.command, argsFor(located, args), {
      cwd: project.rootPath,
      timeoutMs,
      importRoot: importRootOf(project),
    });
  const testFile = testFileArg(spec);

  const review = await run(["-c", REVIEW_SCRIPT, testFile]);
  const reviewBlocker = runBlocker(review, CHECK, timeoutMs);
  if (reviewBlocker) {
    return notRun(reviewBlocker, review.output);
  }

  const collect = await run([...PYTEST, "--collect-only", testFile]);
  const rawOutput = joinOutputs(review, collect);
  const collectBlocker = runBlocker(collect, CHECK, timeoutMs);
  if (collectBlocker) {
    return notRun(collectBlocker, rawOutput);
  }

  const exitCode = collect.exitCode ?? -1;
  const errors = merge(parseReview(review.stdout) ?? [], parseCollectionErrors(collect.output, project.rootPath));
  if (errors.length > 0) {
    return { status: "failed", diagnostics: errors, exitCode, rawOutput };
  }

  switch (exitCode) {
    case 0:
      return { status: "passed", diagnostics: [], exitCode, rawOutput };
    case 5:
      return notRun(
        {
          code: "python.no-tests-found",
          message: `pytest no encontró ninguna prueba en ${spec.directory}/${spec.fileName}${spec.extension}.`,
          remediation:
            "pytest solo corre las funciones cuyo nombre empieza con test_ (y las clases que empiezan con Test). Revisá la prueba y volvé a intentar la comprobación.",
        },
        rawOutput
      );
    default:
      return notRun(
        {
          code: "python.collection-failed",
          message: `pytest terminó con el código ${exitCode} sin poder importar la prueba, y no dijo dónde está el error.`,
          remediation: `${savedOutputHint("verification")} Suele ser un problema de la configuración de pytest del proyecto (un conftest.py que no se puede importar, por ejemplo): probá «python -m pytest --collect-only» en una terminal abierta en la raíz.`,
        },
        rawOutput
      );
  }
}

/** Los errores del revisor y los de pytest, sin repetir el mismo error en la misma línea. */
function merge(review: readonly Diagnostic[], collection: readonly Diagnostic[]): Diagnostic[] {
  const key = (diagnostic: Diagnostic) =>
    `${diagnostic.filePath.toLowerCase()}:${diagnostic.line}:${diagnostic.code ?? ""}`;
  const seen = new Set(review.map(key));
  return [...review, ...collection.filter((diagnostic) => !seen.has(key(diagnostic)))];
}

function joinOutputs(review: PythonRunResult, collect: PythonRunResult): string {
  return `── revisor de la prueba ──\n${review.output.trimEnd()}\n── pytest --collect-only ──\n${collect.output}`;
}

function notRun(blocker: PreconditionViolation, rawOutput?: string): VerificationResult {
  return rawOutput === undefined ? { status: "notRun", blocker } : { status: "notRun", blocker, rawOutput };
}
