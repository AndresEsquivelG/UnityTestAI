import type {
  CompletedTestRun,
  CoverageResult,
  CoverageTarget,
  PreconditionViolation,
  ProjectModel,
} from "../../../core/contracts";
import { MAIN_ROOT } from "../discovery/layout";
import { readJacocoReport } from "./jacocoReport";
import type { RawJavaCoverage } from "./testRun";

/**
 * OP-15 — Cobertura con JaCoCo, a partir de lo que dejó la ejecución.
 *
 * No lanza nada: la misma corrida que ejecutó la prueba pidió la cobertura y
 * dejó el informe (o el motivo por el que no lo hay) en `rawCoverage`. Una
 * prueba que falla también se mide, porque recorre código igual.
 *
 * JaCoCo mide línea, rama e instrucción. La rama se informa como decisión.
 */

export function collectJavaCoverage(
  project: ProjectModel,
  execution: CompletedTestRun,
  target: CoverageTarget
): CoverageResult {
  const tool = project.adapterData?.["buildTool"];
  const raw = readRawCoverage(execution.rawCoverage);
  if (!raw) {
    return notRun({
      code: "java.coverage-data-missing",
      message: "La ejecución no dejó datos de cobertura.",
      remediation: "Volvé a intentar la ejecución.",
    });
  }

  if ("missing" in raw) {
    return notRun(missingCoverage(raw, tool));
  }

  const mainRoot = project.sourceRoots.find((root) => root.kind === "main")?.relativePath ?? MAIN_ROOT;
  if (!target.filePath.startsWith(`${mainRoot}/`)) {
    return notRun({
      code: "java.coverage-outside-main",
      message: `"${target.filePath}" no está en ${mainRoot}, que es lo único que JaCoCo mide.`,
      remediation: `Mové la clase a ${mainRoot} para poder medirla.`,
    });
  }

  const reading = readJacocoReport(raw.xml, target, target.filePath.slice(mainRoot.length + 1));
  switch (reading.kind) {
    case "measured":
      return { status: "measured", ...reading.report };
    case "fileMissing":
      return notRun({
        code: "java.coverage-file-missing",
        message: `JaCoCo no midió "${target.filePath}": no está entre las clases compiladas del proyecto.`,
        remediation: "Comprobá que la línea package del archivo coincida con su carpeta y volvé a intentar la ejecución.",
      });
    case "unreadable":
      return notRun({
        code: "java.coverage-unreadable",
        message: "JaCoCo dejó un informe que no se pudo leer.",
        remediation: "Volvé a intentar la ejecución.",
      });
  }
}

function readRawCoverage(rawCoverage: string | undefined): RawJavaCoverage | undefined {
  if (rawCoverage === undefined) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(rawCoverage);
    if (value && typeof value === "object" && ("xml" in value || "missing" in value)) {
      return value as RawJavaCoverage;
    }
  } catch {
    // No lo dejó este adaptador.
  }
  return undefined;
}

function missingCoverage(
  raw: Extract<RawJavaCoverage, { missing: string }>,
  tool: unknown
): PreconditionViolation {
  switch (raw.missing) {
    case "agent":
      // Comprobado con Maven: un <argLine> propio en la configuración de
      // Surefire reemplaza el que agrega JaCoCo, y la corrida no deja datos.
      // Lo mismo, sin comprobar, si el pom.xml configura JaCoCo con su propio
      // archivo de datos: su configuración pisa la de la extensión.
      return {
        code: "java.coverage-agent-missing",
        message: "La prueba se ejecutó, pero JaCoCo no pudo observarla y no quedaron datos de cobertura.",
        remediation:
          tool === "maven"
            ? "Suele pasar cuando el pom.xml le da argumentos propios a las pruebas (<argLine> en maven-surefire-plugin) y así reemplaza los de JaCoCo: agregá @{argLine} al principio de ese <argLine>. También, si el pom.xml configura JaCoCo con su propio archivo de datos (<destFile>). Después volvé a intentar la ejecución."
            : "Suele pasar cuando el build.gradle reemplaza los argumentos de la máquina virtual de las pruebas (jvmArgs) o desactiva JaCoCo. Revisalo y volvé a intentar la ejecución.",
      };
    case "unsupportedJdk":
      return {
        code: "java.coverage-jdk-unsupported",
        message: `La prueba se ejecutó, pero JaCoCo no reconoce el código compilado con este JDK (versión de clase ${raw.classVersion ?? "desconocida"}).`,
        remediation: "Para medir la cobertura, usá un JDK anterior (por ejemplo, Java 21) y volvé a intentar la ejecución.",
      };
    case "report":
      return {
        code: "java.coverage-report-missing",
        message: "La prueba se ejecutó, pero JaCoCo no dejó su informe.",
        remediation:
          "La salida de la corrida quedó en AgentOutputs/test-run/test-run-output.json, dentro de rawCoverage. Volvé a intentar la ejecución.",
      };
  }
}

function notRun(blocker: PreconditionViolation): CoverageResult {
  return { status: "notRun", blocker };
}
