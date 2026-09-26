import {
  supportsTestRun,
  type ArtifactSpec,
  type EcosystemAdapter,
  type ProjectModel,
  type TestCaseOutcome,
  type TestCaseResult,
  type TestExecutionResult,
} from "../contracts";
import {
  plural,
  type PresentedTestCase,
  type VerificationOutcome,
  type VerificationPresentation,
} from "./stage";

/**
 * Etapa de ejecución de la prueba escrita (OP-14).
 *
 * Corre solo si la prueba pasó la verificación, o si el ecosistema no la
 * ofrece: ejecutar algo que no compila solo repetiría el error con otras
 * palabras. Y si alguna prueba falla, no se corrige sola, a diferencia de la
 * verificación: una prueba que falla puede estar bien y haber encontrado un
 * defecto del código bajo prueba, y «corregirla» hasta que pase lo taparía.
 */

/** Resultado de la etapa: el de OP-14, o que la etapa no aplica. */
export type TestRunOutcome = TestExecutionResult | { readonly status: "notApplicable" };

export const TEST_RUN_STAGE_NAME = "Ejecución";

/** La etapa no corrió porque la prueba no pasó la verificación. */
const NEEDS_VERIFICATION = "core.test-run-needs-verification";

export async function runTestStage(
  adapter: EcosystemAdapter,
  project: ProjectModel,
  spec: ArtifactSpec,
  verification: VerificationOutcome["status"]
): Promise<TestRunOutcome> {
  if (!supportsTestRun(adapter)) {
    return { status: "notApplicable" };
  }

  if (verification !== "passed" && verification !== "notApplicable") {
    return {
      status: "notRun",
      blocker: {
        code: NEEDS_VERIFICATION,
        message: "La prueba no pasó la verificación.",
        remediation: "Cuando la verificación pase, la ejecución corre sola.",
      },
    };
  }

  try {
    return await adapter.runTests(project, spec);
  } catch (error) {
    // La prueba ya está escrita y verificada: que el adaptador falle no
    // justifica perder la corrida.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: "notRun",
      blocker: {
        code: "core.test-run-crashed",
        message: `La ejecución se interrumpió por un error del adaptador: ${reason}`,
        remediation: "Volvé a intentar la ejecución; si se repite, el error es del adaptador.",
      },
    };
  }
}

/**
 * El resultado listo para mostrar, con la misma forma que el de la
 * verificación. En lugar de diagnósticos lleva cada prueba, con las fallidas
 * primero: son las que hay que mirar, y en una lista larga quedarían abajo.
 *
 * `unitName` es el nombre de la clase de la prueba, para quitárselo a cada
 * nombre: es el mismo en todas y ocupa la línea entera.
 */
export function presentTestRun(outcome: TestRunOutcome, unitName?: string): VerificationPresentation {
  const stageName = TEST_RUN_STAGE_NAME;

  switch (outcome.status) {
    case "notApplicable":
      return {
        stageName,
        status: outcome.status,
        summary: "El ecosistema no ofrece ejecución automática: la etapa no aplica.",
        diagnostics: [],
      };

    case "notRun":
      return {
        stageName,
        status: outcome.status,
        summary: `No se ejecutó. ${outcome.blocker.message}`,
        remediation: outcome.blocker.remediation,
        diagnostics: [],
        // Reintentar solo la ejecución no arregla la verificación: se
        // reintenta desde la verificación, que corre la ejecución al pasar.
        ...(outcome.blocker.code === NEEDS_VERIFICATION ? { retryable: false } : {}),
      };

    case "passed":
    case "failed":
      return {
        stageName,
        status: outcome.status,
        summary: countsSummary(outcome),
        ...(outcome.status === "failed"
          ? {
              remediation:
                "Una prueba que falla puede estar mal escrita o haber encontrado un defecto del código bajo prueba: revisá cuál es antes de corregirla.",
            }
          : {}),
        diagnostics: [],
        cases: presentCases(outcome.cases, unitName),
      };
  }
}

const OUTCOME_ORDER: Record<TestCaseOutcome, number> = { failed: 0, skipped: 1, passed: 2 };

function presentCases(
  cases: readonly TestCaseResult[],
  unitName: string | undefined
): PresentedTestCase[] {
  return cases
    .map((testCase, index) => ({ testCase, index }))
    .sort(
      (a, b) =>
        OUTCOME_ORDER[a.testCase.outcome] - OUTCOME_ORDER[b.testCase.outcome] || a.index - b.index
    )
    .map(({ testCase }) => ({
      outcome: testCase.outcome,
      name: shortName(testCase.testName, unitName),
      ...(testCase.message ? { detail: oneLine(testCase.message) } : {}),
    }));
}

/**
 * El nombre sin la clase ni el espacio de nombres. Se corta por la clase y no
 * por el último punto: una prueba con parámetros puede llevar puntos dentro
 * de los paréntesis.
 */
function shortName(testName: string, unitName: string | undefined): string {
  if (!unitName) {
    return testName;
  }
  const marker = `${unitName}.`;
  const at = testName.indexOf(marker);
  return at === -1 ? testName : testName.slice(at + marker.length);
}

/** Los mensajes de las aserciones vienen en varias líneas con sangría. */
function oneLine(message: string): string {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" · ");
}

/** Los cuatro contadores, siempre, aunque alguno sea cero. */
function countsSummary(counts: {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}): string {
  return (
    `${plural(counts.total, "prueba", "pruebas")}: ` +
    `${plural(counts.passed, "exitosa", "exitosas")}, ` +
    `${plural(counts.failed, "fallida", "fallidas")}, ` +
    `${plural(counts.skipped, "omitida", "omitidas")}.`
  );
}
