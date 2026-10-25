import type { TestCaseOutcome, TestCaseResult } from "../../../core/contracts";
import { elementText, readAttributes } from "./xml";

/**
 * El informe JUnit XML que dejan Surefire (Maven) y Gradle: una `testsuite`
 * por clase, con un `testcase` por prueba.
 *
 * Es el mismo formato en las dos, con diferencias que se emparejan aquí
 * (comprobadas con Surefire 3.6.0 y Gradle 9.8.0):
 *
 *   · Surefire nombra la prueba por su método (`falla`); Gradle, por el
 *     nombre que se muestra, con «()» si no tiene otro (`falla()`). Se quita
 *     el «()» final.
 *   · Surefire separa las que fallan una aserción (`failure`) de las que
 *     lanzan una excepción (`error`); Gradle las pone todas en `failure`.
 *     Las dos cuentan como fallidas.
 *   · Gradle antepone la clase de la excepción al mensaje; Surefire no. Se
 *     quita, para que el mensaje sea el mismo.
 *   · Las omitidas (`@Disabled`) y las que abandonan por un supuesto que no
 *     se cumple (`assumeTrue`) quedan las dos en `skipped`.
 */

export interface ParsedJUnitReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cases: readonly TestCaseResult[];
}

export function parseJUnitReport(report: string): ParsedJUnitReport | undefined {
  if (!/<testsuite\b/.test(report)) {
    return undefined;
  }

  const cases: TestCaseResult[] = [];
  for (const testCase of report.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attributes = readAttributes(testCase[1]);
    const body = testCase[2] ?? "";
    const problem = /<(failure|error|skipped)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);

    const outcome: TestCaseOutcome = !problem ? "passed" : problem[1] === "skipped" ? "skipped" : "failed";
    const problemAttributes = problem ? readAttributes(problem[2]) : {};
    const problemText = problem?.[3] ? elementText(problem[3]) : "";
    const message = caseMessage(outcome, problemAttributes, problemText);
    const durationMs = secondsToMs(attributes["time"]);
    const name = (attributes["name"] ?? "(sin nombre)").replace(/\(\)$/, "");
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
  return {
    total: cases.length,
    passed: cases.length - failed - skipped,
    failed,
    skipped,
    cases,
  };
}

/**
 * El motivo: el `message` si lo hay, y si no, la primera línea del texto (un
 * supuesto que no se cumple lo deja solo ahí en Surefire). Sin la clase de la
 * excepción delante. Una excepción sin mensaje queda con el nombre de su clase.
 */
function caseMessage(
  outcome: TestCaseOutcome,
  attributes: Record<string, string>,
  text: string
): string | undefined {
  if (outcome === "passed") {
    return undefined;
  }
  const type = attributes["type"];
  const raw = attributes["message"] ?? text.split(/\r?\n/)[0] ?? "";
  const message = withoutExceptionType(raw.trim(), type);
  if (message !== "") {
    return message;
  }
  return type && outcome === "failed" ? type : undefined;
}

function withoutExceptionType(message: string, type: string | undefined): string {
  if (type && message.startsWith(`${type}: `)) {
    return message.slice(type.length + 2);
  }
  return type && message === type ? "" : message;
}

function secondsToMs(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const seconds = Number(value.replace(",", "."));
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}
