import {
  supportsCoverage,
  type CoverageMetric,
  type CoverageResult,
  type CoverageTarget,
  type EcosystemAdapter,
  type ProjectModel,
} from "../contracts";
import type { TestRunOutcome } from "./execution";
import type { VerificationPresentation } from "./stage";

/**
 * Etapa de cobertura (OP-15).
 *
 * Mide sobre la ejecución que acaba de terminar: los datos los deja la misma
 * corrida, así que sin ejecución no hay nada que medir, y reintentar solo la
 * cobertura no tendría de dónde sacarlos. Por eso no ofrece reintento propio:
 * el de la ejecución vuelve a medir.
 *
 * Una prueba que falla también se mide: recorre código igual, y saber qué
 * recorrió ayuda a decidir si el defecto está en la prueba o en el código.
 */

/** Resultado de la etapa: el de OP-15, o que la etapa no aplica. */
export type CoverageOutcome = CoverageResult | { readonly status: "notApplicable" };

export const COVERAGE_STAGE_NAME = "Cobertura";

/** La etapa no corrió porque la prueba no llegó a ejecutarse. */
const NEEDS_RUN = "core.coverage-needs-run";

export async function runCoverageStage(
  adapter: EcosystemAdapter,
  project: ProjectModel,
  execution: TestRunOutcome,
  target: CoverageTarget
): Promise<CoverageOutcome> {
  if (!supportsCoverage(adapter)) {
    return { status: "notApplicable" };
  }

  if (execution.status !== "passed" && execution.status !== "failed") {
    return {
      status: "notRun",
      blocker: {
        code: NEEDS_RUN,
        message: "La prueba no se ejecutó.",
        remediation: "Cuando la ejecución corra, la cobertura se mide con ella.",
      },
    };
  }

  try {
    return await adapter.collectCoverage(project, execution, target);
  } catch (error) {
    // La ejecución ya terminó y su resultado se muestra igual: perder la
    // cobertura no justifica perder la corrida.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: "notRun",
      blocker: {
        code: "core.coverage-crashed",
        message: `La medición se interrumpió por un error del adaptador: ${reason}`,
        remediation: "Volvé a intentar la ejecución; si se repite, el error es del adaptador.",
      },
    };
  }
}

/**
 * El resultado listo para mostrar. El resumen es la cobertura de la unidad
 * bajo prueba, que es la que habla de la prueba generada; la del archivo va
 * como contexto. El detalle línea por línea queda para el informe HTML.
 */
export function presentCoverage(
  outcome: CoverageOutcome,
  target: CoverageTarget
): VerificationPresentation {
  const stageName = COVERAGE_STAGE_NAME;

  switch (outcome.status) {
    case "notApplicable":
      return {
        stageName,
        status: outcome.status,
        summary: "El ecosistema no ofrece cobertura: la etapa no aplica.",
        diagnostics: [],
      };

    case "notRun":
      return {
        stageName,
        status: outcome.status,
        summary: `No se midió. ${outcome.blocker.message}`,
        remediation: outcome.blocker.remediation,
        diagnostics: [],
        retryable: false,
      };

    case "measured": {
      const unit = target.unit.methodName;
      const details = outcome.byFile.map(
        (file) => `Archivo ${file.filePath}: ${describeMetric(file.line)}.`
      );
      details.push(
        outcome.decision
          ? `Decisión: ${describeMetric(outcome.decision, "decisiones")}.`
          : "Decisión: no disponible."
      );
      details.push(...(outcome.notes ?? []));

      return {
        stageName,
        status: outcome.status,
        summary: outcome.target
          ? `método ${unit}, ${describeMetric(outcome.target.line)}.`
          : `no se encontró código medible de ${unit} en el archivo.`,
        diagnostics: [],
        details,
        retryable: false,
      };
    }
  }
}

/** «66,7 % de líneas (2 de 3)», con coma decimal. */
export function describeMetric(metric: CoverageMetric, counted = "líneas"): string {
  return `${formatPercentage(metric.percentage)} de ${counted} (${metric.covered} de ${metric.total})`;
}

export function formatPercentage(percentage: number): string {
  return `${String(Math.round(percentage * 10) / 10).replace(".", ",")} %`;
}
