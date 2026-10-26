import * as fsp from "fs/promises";
import type {
  CompletedTestRun,
  CoverageResult,
  PreconditionViolation,
  ProjectModel,
  CoverageTarget,
} from "../../../core/contracts";
import { absolutePath } from "../discovery/layout";
import { coverageMissing } from "./blockers";
import { readCoverageJson } from "./coverageReport";
import type { RawPythonCoverage } from "./testRun";

/**
 * OP-15 — Cobertura con coverage, a partir de lo que dejó la ejecución.
 *
 * No lanza nada: la misma corrida que ejecutó la prueba la midió y dejó el
 * informe (o el motivo por el que no lo hay) en `rawCoverage`. Lee además el
 * archivo de la unidad, para saber qué líneas son de cada método.
 *
 * coverage mide línea y rama; la rama se informa como decisión. La
 * instrucción no la mide.
 */

export async function collectPythonCoverage(
  project: ProjectModel,
  execution: CompletedTestRun,
  target: CoverageTarget
): Promise<CoverageResult> {
  const raw = readRawCoverage(execution.rawCoverage);
  if (!raw) {
    return notRun({
      code: "python.coverage-data-missing",
      message: "La ejecución no dejó datos de cobertura.",
      remediation: "Volvé a intentar la ejecución.",
    });
  }

  if ("missing" in raw) {
    return notRun(
      raw.missing === "module"
        ? coverageMissing(raw.commandLine)
        : {
            code: "python.coverage-report-missing",
            message: "La prueba se ejecutó, pero coverage no dejó su informe.",
            remediation:
              "La salida de coverage quedó en AgentOutputs/test-run/test-run-output.json, dentro de rawCoverage. Volvé a intentar la ejecución.",
          }
    );
  }

  let source: string;
  try {
    source = await fsp.readFile(absolutePath(project.rootPath, target.filePath), "utf8");
  } catch {
    return notRun({
      code: "python.coverage-source-missing",
      message: `No se pudo leer "${target.filePath}" para ubicar sus métodos.`,
      remediation: "Comprobá que el archivo siga en su lugar y volvé a intentar la ejecución.",
    });
  }

  const reading = readCoverageJson(raw.json, target, source);
  switch (reading.kind) {
    case "measured":
      return { status: "measured", ...reading.report };
    case "fileMissing":
      return notRun({
        code: "python.coverage-file-missing",
        message: `coverage no midió "${target.filePath}": la prueba no llegó a importarlo.`,
        remediation: "Comprobá que la prueba importe la clase bajo prueba desde su módulo y volvé a intentar la ejecución.",
      });
    case "unreadable":
      return notRun({
        code: "python.coverage-unreadable",
        message: "coverage dejó un informe que no se pudo leer.",
        remediation: "Volvé a intentar la ejecución.",
      });
  }
}

function readRawCoverage(rawCoverage: string | undefined): RawPythonCoverage | undefined {
  if (rawCoverage === undefined) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(rawCoverage);
    if (value && typeof value === "object" && ("json" in value || "missing" in value)) {
      return value as RawPythonCoverage;
    }
  } catch {
    // No lo dejó este adaptador.
  }
  return undefined;
}

function notRun(blocker: PreconditionViolation): CoverageResult {
  return { status: "notRun", blocker };
}
