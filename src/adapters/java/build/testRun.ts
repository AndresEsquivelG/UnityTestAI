import * as fsp from "fs/promises";
import * as path from "path";
import type {
  ArtifactSpec,
  CoverageTarget,
  PreconditionViolation,
  ProjectModel,
  TestExecutionResult,
} from "../../../core/contracts";
import { TEST_ROOT, absolutePath } from "../discovery/layout";
import { buildBlocker, prepareBuild, savedOutputHint, type BuildActivity } from "./blockers";
import type { BuildCommands } from "./commands";
import { BUILD_TIMEOUT_MS } from "./compilation";
import { parseJUnitReport } from "./junitReport";
import type { JavaBuildToolchain } from "./toolchain";

/**
 * OP-14 — Ejecución de la clase de la prueba generada, con la herramienta
 * del proyecto, y si se pide, la cobertura de esa misma corrida (ver
 * `commands.ts` para lo que se le pasa a cada una).
 *
 * El código de salida no alcanza para clasificar: Maven termina con 1 tanto si
 * falla una prueba como si no compila (medido), y con las pruebas que fallan
 * ignoradas, que es como se ejecuta para medir, termina con 0. Lo que manda es
 * el informe JUnit: si está, las pruebas corrieron. Antes de cada corrida se
 * borra el de la anterior, así que nunca se lee uno viejo.
 *
 * Medido sobre el proyecto de ejemplo: Maven 5 a 12 s, y 11 a 19 s midiendo;
 * Gradle 13 s sin proceso de fondo, midiendo o no.
 */

const RUN_TESTS: BuildActivity = { doing: "ejecutar las pruebas", retry: "la ejecución" };

/** La prueba no compila: Maven y Gradle lo dicen así antes de rendirse. */
const NOT_COMPILED = /COMPILATION ERROR|Compilation failure|Compilation failed|Execution failed for task ':compile\w*Java'/;

/** El filtro no encontró pruebas. Maven: «No tests matching pattern»; Gradle: «No tests found for given includes». */
const NO_TESTS = /No tests matching pattern|No tests were executed|No tests found for given includes/;

/** Maven, cuando JaCoCo no llegó a observar la ejecución y no hay datos. */
const COVERAGE_DATA_MISSING = /Skipping JaCoCo execution due to missing execution data file/;

/** El agente de JaCoCo no reconoce clases compiladas por un JDK más nuevo que él. */
const UNSUPPORTED_CLASS_VERSION = /Unsupported class file major version (\d+)/;

/**
 * Lo que la ejecución le deja a OP-15 en `rawCoverage`. Solo lo lee este
 * adaptador: el informe de JaCoCo, o por qué no lo hay, porque OP-15 no ve la
 * salida de la corrida. Sin informe va también la salida: una ejecución
 * completa no la guarda en ningún otro lado.
 */
export type RawJavaCoverage =
  | { readonly xml: string }
  | {
      readonly missing: "agent" | "report" | "unsupportedJdk";
      readonly classVersion?: string;
      readonly output: string;
    };

export interface JavaTestRunOptions {
  readonly toolchain: JavaBuildToolchain;
  readonly timeoutMs?: number;
}

export async function runJavaTests(
  project: ProjectModel,
  spec: ArtifactSpec,
  options: JavaTestRunOptions,
  coverage?: CoverageTarget
): Promise<TestExecutionResult> {
  const prepared = await prepareBuild(project, spec, options.toolchain);
  if ("blocker" in prepared) {
    return { status: "notRun", blocker: prepared.blocker };
  }
  const { commands, launcher } = prepared;
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;
  const testClass = testClassName(project, spec);
  const reportFile = absolutePath(project.rootPath, commands.reportPath(testClass));

  await prepareWorkDir(project.rootPath, commands, reportFile);
  const started = Date.now();
  const run = await options.toolchain.run(launcher, commands.testArgs(testClass, coverage !== undefined), {
    cwd: project.rootPath,
    timeoutMs,
  });

  // Si no arrancó o se cortó, un informe que haya llegado a escribir no vale.
  const interrupted = run.spawnError || run.timedOut ? buildBlocker(run, commands, RUN_TESTS, timeoutMs) : undefined;
  if (interrupted) {
    return notRun(interrupted, run.output);
  }

  const report = await readIfPresent(reportFile);
  const parsed = report === "" ? undefined : parseJUnitReport(report);
  if (parsed && parsed.total > 0) {
    const rawCoverage = coverage
      ? JSON.stringify(await rawCoverageOf(project.rootPath, commands, run.output, started))
      : undefined;
    return {
      status: parsed.failed > 0 ? "failed" : "passed",
      ...parsed,
      exitCode: run.exitCode ?? -1,
      rawReport: report,
      ...(rawCoverage === undefined ? {} : { rawCoverage }),
    };
  }

  const blocker = buildBlocker(run, commands, RUN_TESTS, timeoutMs);
  if (blocker) {
    return notRun(blocker, run.output);
  }

  if (NOT_COMPILED.test(run.output)) {
    return notRun(
      {
        code: "java.tests-not-compiled",
        message: "El proyecto no compila, así que no se pudo ejecutar la prueba.",
        remediation: "Volvé a intentar la compilación para ver los errores.",
      },
      run.output
    );
  }

  if ((parsed && parsed.total === 0) || NO_TESTS.test(run.output)) {
    return notRun(
      {
        code: "java.no-tests-found",
        message: `${commands.name} no encontró ninguna prueba en ${testClass}.`,
        remediation:
          commands.tool === "gradle"
            ? "Comprobá que la clase tenga métodos con @Test de org.junit.jupiter.api y que build.gradle (o build.gradle.kts) active JUnit 5 en la tarea de pruebas: test { useJUnitPlatform() }."
            : "Comprobá que la clase tenga métodos con @Test de org.junit.jupiter.api y que el pom.xml no fije una versión de maven-surefire-plugin anterior a la 2.22, que no ejecuta JUnit 5.",
      },
      run.output
    );
  }

  return notRun(
    {
      code: "java.test-report-missing",
      message: `${commands.name} terminó con el código ${run.exitCode ?? -1} sin dejar el informe de resultados.`,
      remediation: `${savedOutputHint("test-run")} Probá ejecutar la prueba con ${commands.name} en una terminal.`,
    },
    run.output
  );
}

/**
 * Nombre completo de la clase de la prueba: el paquete sale de su carpeta
 * dentro de la jerarquía de pruebas, igual que su línea `package`.
 */
export function testClassName(project: ProjectModel, spec: ArtifactSpec): string {
  const testRoot = project.sourceRoots.find((root) => root.kind === "test")?.relativePath ?? TEST_ROOT;
  const packagePath = spec.directory.startsWith(`${testRoot}/`) ? spec.directory.slice(testRoot.length + 1) : "";
  return packagePath ? `${packagePath.replace(/\//g, ".")}.${spec.unitName}` : spec.unitName;
}

/**
 * Vacía la carpeta de la extensión y escribe lo que la herramienta necesita.
 * El informe JUnit de Maven no se puede mover de su carpeta: se borra el de
 * la clase de la prueba, que también es de la extensión.
 */
async function prepareWorkDir(rootPath: string, commands: BuildCommands, reportFile: string): Promise<void> {
  const workDir = absolutePath(rootPath, commands.workDir);
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(workDir, { recursive: true });
  for (const [name, content] of Object.entries(commands.setupFiles)) {
    await fsp.writeFile(path.join(workDir, name), content, "utf8");
  }
  await fsp.rm(reportFile, { force: true });
}

/**
 * El informe de JaCoCo de esta corrida. El de Maven va a una carpeta que la
 * extensión no vacía, así que tiene que ser posterior al arranque.
 */
async function rawCoverageOf(
  rootPath: string,
  commands: BuildCommands,
  output: string,
  started: number
): Promise<RawJavaCoverage> {
  const reportFile = absolutePath(rootPath, commands.coverageReportPath);
  try {
    const stat = await fsp.stat(reportFile);
    if (stat.mtimeMs >= started - 1000) {
      return { xml: await fsp.readFile(reportFile, "utf8") };
    }
  } catch {
    // Sin informe: se averigua por qué.
  }

  const classVersion = UNSUPPORTED_CLASS_VERSION.exec(output)?.[1];
  if (classVersion) {
    return { missing: "unsupportedJdk", classVersion, output };
  }
  const dataFile = absolutePath(rootPath, commands.coverageDataPath);
  const hasData = await fsp.stat(dataFile).then(
    () => true,
    () => false
  );
  return { missing: !hasData || COVERAGE_DATA_MISSING.test(output) ? "agent" : "report", output };
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
