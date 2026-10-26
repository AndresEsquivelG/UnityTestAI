import type { TestCaseOutcome, TestCaseResult } from "../../../core/contracts";

/**
 * El informe JUnit XML que deja pytest con `--junitxml`. Es la forma del de
 * Surefire, con lo propio de pytest (comprobado con pytest 9.1.1):
 *
 *   · `classname` es el módulo de la prueba (`tests.X_test`), y `name` la
 *     función;
 *   · una excepción dentro de la prueba, sea una aserción o no, es `failure`;
 *     una que salta al preparar una fixture es `error` («failed on setup
 *     with …»). Las dos cuentan como fallidas;
 *   · `pytest.skip` y las que se esperaba que fallaran (`xfail`) son
 *     `skipped`, con `type="pytest.skip"` o `type="pytest.xfail"`;
 *   · un archivo que no se pudo importar deja un solo `testcase` con
 *     `classname=""` y un `error` con «collection failure»: eso no es una
 *     corrida, y lo separa `isCollectionFailure`;
 *   · el informe está siempre en UTF-8, con `PYTHONUTF8` o sin él.
 */

export interface ParsedJUnitReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cases: readonly TestCaseResult[];
}

const TEST_CASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const PROBLEM = /<(failure|error|skipped)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/;

export function parseJUnitReport(report: string): ParsedJUnitReport | undefined {
  if (!/<testsuite\b/.test(report)) {
    return undefined;
  }

  const cases: TestCaseResult[] = [];
  for (const testCase of report.matchAll(TEST_CASE)) {
    const attributes = readAttributes(testCase[1]);
    const problem = PROBLEM.exec(testCase[2] ?? "");

    const outcome: TestCaseOutcome = !problem ? "passed" : problem[1] === "skipped" ? "skipped" : "failed";
    const problemAttributes = problem ? readAttributes(problem[2]) : {};
    const problemText = problem?.[3] ? decodeEntities(problem[3]).trim() : "";
    const message = caseMessage(outcome, problemAttributes, problemText);
    const durationMs = secondsToMs(attributes["time"]);
    const name = attributes["name"] ?? "(sin nombre)";
    const className = attributes["classname"];

    cases.push({
      testName: className ? `${className}.${name}` : name,
      outcome,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(message ? { message } : {}),
      ...(outcome === "failed" && problemText ? { stackTrace: problemText } : {}),
    });
  }

  const failed = cases.filter((testCase) => testCase.outcome === "failed").length;
  const skipped = cases.filter((testCase) => testCase.outcome === "skipped").length;
  return { total: cases.length, passed: cases.length - failed - skipped, failed, skipped, cases };
}

/** El informe de un archivo que no se pudo importar: ninguna prueba llegó a correr. */
export function isCollectionFailure(report: string): boolean {
  return /<error\b[^>]*\bmessage="collection failure"/.test(report);
}

/**
 * El motivo: el `message` si lo hay, y si no, la primera línea del texto. Una
 * que se esperaba que fallara lo dice, para no confundirla con una omitida.
 */
function caseMessage(
  outcome: TestCaseOutcome,
  attributes: Record<string, string>,
  text: string
): string | undefined {
  if (outcome === "passed") {
    return undefined;
  }
  const message = (attributes["message"] ?? text.split(/\r?\n/)[0] ?? "").trim();
  if (attributes["type"] === "pytest.xfail") {
    return message ? `Se esperaba que fallara: ${message}` : "Se esperaba que fallara.";
  }
  return message || undefined;
}

function secondsToMs(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeEntities(match[2]);
  }
  return attributes;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_entity, code: string) => {
    switch (code.toLowerCase()) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return String.fromCodePoint(
          code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        );
    }
  });
}
