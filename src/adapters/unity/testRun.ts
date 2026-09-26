import * as fsp from "fs/promises";
import * as path from "path";
import type {
  ArtifactSpec,
  PreconditionViolation,
  ProjectModel,
  TestCaseOutcome,
  TestCaseResult,
  TestExecutionResult,
} from "../../core/contracts";
import {
  BATCH_TIMEOUT_MS,
  COMPILER_ERRORS_MESSAGE,
  batchBlocker,
  prepareEditor,
  readIfPresent,
  runInBatch,
  type BatchActivity,
} from "./batch";
import { escapeForRegExp } from "./csharpSource";
import type { EditorRunResult, UnityEditorToolchain } from "./editor";

/**
 * OP-14 — Ejecución de la prueba generada con el Test Runner de Unity, en
 * modo batch.
 *
 * Medido con Unity 2021.3.19f1 y com.unity.test-framework 1.4.5 (la versión
 * que resolvió el proyecto; su manifiesto pide 1.1.31), con `Library` ya
 * construida: 12 a 17 s por corrida, casi todo arranque del editor. Lo que
 * dejó cada caso:
 *
 *   · Pasan todas: código 0 e informe NUnit 3.
 *   · Falla alguna: código 2 e informe.
 *   · El filtro no encuentra ninguna: código 0 e informe con total 0. Por
 *     eso el código de salida no alcanza para decir que pasó.
 *   · No compila: código 1, sin informe, y el mismo aviso de la compilación.
 *
 * `-runTests` cierra el editor al terminar: con `-quit` se cerraría antes de
 * ejecutar nada.
 */

const RUN_TESTS: BatchActivity = {
  doing: "ejecutar las pruebas",
  retry: "la ejecución",
  timeoutCode: "unity.test-run-timeout",
};

const REPORT_FILE = "results.xml";

export interface TestRunOptions {
  readonly toolchain: UnityEditorToolchain;
  readonly timeoutMs?: number;
}

export async function runUnityTests(
  project: ProjectModel,
  spec: ArtifactSpec,
  options: TestRunOptions
): Promise<TestExecutionResult> {
  const { toolchain } = options;

  const editor = await prepareEditor(project, toolchain, RUN_TESTS);
  if ("blocker" in editor) {
    return { status: "notRun", blocker: editor.blocker };
  }

  const platform = await testPlatform(project, spec);
  return runInBatch(
    toolchain,
    editor.executable,
    (workDir, logFile) => [
      "-batchmode",
      "-nographics",
      "-projectPath",
      project.rootPath,
      "-runTests",
      "-testPlatform",
      platform,
      "-testFilter",
      testFilter(spec),
      "-testResults",
      path.join(workDir, REPORT_FILE),
      "-logFile",
      logFile,
    ],
    options.timeoutMs ?? BATCH_TIMEOUT_MS,
    async (run, log, workDir) =>
      classifyTestRun(run, log, await readIfPresent(path.join(workDir, REPORT_FILE)), spec, platform)
  );
}

/**
 * Solo las pruebas de la clase generada. Unity lee el filtro como expresión
 * regular sobre el nombre completo de cada prueba, y lo busca en cualquier
 * parte: sin anclarlo, pedir `UTIA_m_A_B` ejecutaría también `UTIA_m_A_Bc`
 * (comprobado). El punto final exige que siga un método, y el comienzo admite
 * un espacio de nombres delante.
 */
export function testFilter(spec: ArtifactSpec): string {
  return `(^|\\.)${escapeForRegExp(spec.unitName)}\\.`;
}

/**
 * Plataforma en la que corren las pruebas: la decide el archivo de
 * definición de ensamblado de la carpeta de pruebas. Si solo incluye el
 * editor, son de EditMode; si no, de PlayMode, que es como está el proyecto
 * de prueba (`includePlatforms` vacío).
 */
export async function testPlatform(
  project: ProjectModel,
  spec: ArtifactSpec
): Promise<"EditMode" | "PlayMode"> {
  const directory = path.join(project.rootPath, ...spec.directory.split("/"));
  let entries: string[];
  try {
    entries = await fsp.readdir(directory);
  } catch {
    return "PlayMode";
  }

  for (const entry of entries.filter((name) => name.toLowerCase().endsWith(".asmdef"))) {
    try {
      const definition: unknown = JSON.parse(await fsp.readFile(path.join(directory, entry), "utf8"));
      const platforms = (definition as { includePlatforms?: unknown }).includePlatforms;
      if (Array.isArray(platforms) && platforms.length === 1 && platforms[0] === "Editor") {
        return "EditMode";
      }
      return "PlayMode";
    } catch {
      // Ilegible: se prueba con el siguiente, y si no hay otro, PlayMode.
    }
  }
  return "PlayMode";
}

function classifyTestRun(
  run: EditorRunResult,
  log: string,
  report: string,
  spec: ArtifactSpec,
  platform: string
): TestExecutionResult {
  const blocker = batchBlocker(run, log, RUN_TESTS);
  if (blocker) {
    return notRun(blocker, log);
  }

  const exitCode = run.exitCode ?? -1;
  if (report.trim() === "") {
    return notRun(
      log.includes(COMPILER_ERRORS_MESSAGE)
        ? {
            code: "unity.tests-not-compiled",
            message: "El proyecto no compila, así que no se pudo ejecutar la prueba.",
            remediation: "Volvé a intentar la compilación para ver los errores.",
          }
        : {
            code: "unity.test-report-missing",
            message: `Unity terminó con el código ${exitCode} sin dejar el informe de resultados.`,
            remediation: "Revisá la salida del editor guardada con la corrida.",
          },
      log
    );
  }

  const parsed = parseNUnitReport(report);
  if (!parsed) {
    return notRun(
      {
        code: "unity.test-report-unreadable",
        message: "Unity dejó un informe de resultados que no se pudo leer.",
        remediation: "Revisá el informe guardado con la corrida y volvé a intentar la ejecución.",
      },
      log
    );
  }

  if (parsed.total === 0) {
    return notRun(
      {
        code: "unity.no-tests-found",
        message: `Unity no encontró ninguna prueba de "${spec.unitName}" en ${platform}.`,
        remediation:
          "Comprobá que la clase tenga métodos marcados como prueba y que su ensamblado de pruebas corra en esa plataforma.",
      },
      log
    );
  }

  return {
    status: parsed.failed > 0 ? "failed" : "passed",
    ...parsed,
    exitCode,
    rawReport: report,
  };
}

export interface ParsedReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cases: readonly TestCaseResult[];
}

/**
 * Contadores y pruebas del informe NUnit 3 que escribe el Test Runner.
 *
 * Se lee con expresiones y no con un lector de XML para no sumar una
 * dependencia: el formato es fijo y solo hacen falta los atributos de
 * `test-run` y los `test-case`. Las omitidas se derivan del total, así que
 * incluyen las no concluyentes, que NUnit cuenta aparte.
 */
export function parseNUnitReport(report: string): ParsedReport | undefined {
  const runElement = /<test-run\b([^>]*)>/.exec(report);
  if (!runElement) {
    return undefined;
  }
  const attributes = readAttributes(runElement[1]);
  const total = Number(attributes["total"]);
  const passed = Number(attributes["passed"]);
  const failed = Number(attributes["failed"]);
  if (![total, passed, failed].every(Number.isInteger)) {
    return undefined;
  }

  const cases: TestCaseResult[] = [];
  for (const testCase of report.matchAll(/<test-case\b([^>]*?)(?:\/>|>([\s\S]*?)<\/test-case>)/g)) {
    const caseAttributes = readAttributes(testCase[1]);
    const body = testCase[2] ?? "";
    const outcome = caseOutcome(caseAttributes["result"]);
    const message = caseMessage(body);
    const stackTrace = outcome === "failed" ? elementText(body, "stack-trace") : undefined;
    const durationMs = secondsToMs(caseAttributes["duration"]);

    cases.push({
      testName: caseAttributes["fullname"] ?? caseAttributes["name"] ?? "(sin nombre)",
      outcome,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(message ? { message } : {}),
      ...(stackTrace ? { stackTrace } : {}),
    });
  }

  return { total, passed, failed, skipped: total - passed - failed, cases };
}

/** `Passed` y `Failed` son lo que dicen; el resto no pasó ni falló. */
function caseOutcome(result: string | undefined): TestCaseOutcome {
  switch (result) {
    case "Passed":
      return "passed";
    case "Failed":
      return "failed";
    default:
      return "skipped";
  }
}

/**
 * El mensaje con el que terminó la prueba: el de la falla, el motivo de la
 * omisión o, si pasó con `Assert.Pass("…")`, el que dio al pasar. NUnit lo
 * pone antes que la salida de la prueba, así que es el primer `message`; la
 * salida de otros paquetes va en `output` y no cuenta.
 *
 * El de una que pasa también importa: el perfil pide `Assert.Pass` para las
 * ramas que no se pueden probar, y esa prueba pasa sin comprobar nada.
 */
function caseMessage(body: string): string | undefined {
  return elementText(body, "message");
}

/**
 * La duración viene en segundos. Los elementos internos la escriben con
 * punto, pero la raíz del mismo informe la escribió con coma (configuración
 * regional de la máquina), así que se aceptan las dos.
 */
function secondsToMs(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const seconds = Number(value.replace(",", "."));
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeEntities(match[2]);
  }
  return attributes;
}

/** Contenido crudo de la primera aparición de un elemento. */
function elementContent(body: string, name: string): string | undefined {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1];
}

/** Texto de la primera aparición de un elemento, con CDATA o con entidades. */
function elementText(body: string, name: string): string | undefined {
  const content = elementContent(body, name);
  if (content === undefined) {
    return undefined;
  }
  const text = content
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) =>
      part.startsWith("<![CDATA[") ? part.slice("<![CDATA[".length, -"]]>".length) : decodeEntities(part)
    )
    .join("");
  return text.trim();
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (entity, code: string) => {
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

function notRun(blocker: PreconditionViolation, rawOutput: string): TestExecutionResult {
  return { status: "notRun", blocker, rawOutput };
}
