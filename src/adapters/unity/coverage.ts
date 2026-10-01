import * as fsp from "fs/promises";
import * as path from "path";
import type {
  CompletedTestRun,
  CoverageMetric,
  CoverageResult,
  CoverageTarget,
  LineCoverage,
  LineCoverageStatus,
  PreconditionViolation,
  ProjectModel,
  UnitCoverage,
} from "../../core/contracts";
import {
  BATCH_TIMEOUT_MS,
  batchBlocker,
  prepareEditor,
  readIfPresent,
  runInBatch,
  type BatchActivity,
} from "./batch";
import type { UnityEditorToolchain } from "./editor";

/**
 * OP-15 — Cobertura con el paquete Code Coverage de Unity
 * (`com.unity.testtools.codecoverage`), medido con la versión 1.3.0 y Unity
 * 2021.3.19f1.
 *
 * Hacen falta dos informes, porque el de la ejecución no alcanza:
 *
 *   · El de la ejecución lo deja la misma corrida que ejecuta la prueba
 *     (`runTests` agrega los argumentos de `coverageArguments`). Solo trae
 *     los métodos que la prueba ejecutó: los que no tocó no aparecen, así que
 *     por sí solo siempre da cerca del 100 %.
 *   · El mapa completo, con todo lo medible del archivo en cero, lo escribe
 *     el paquete al empezar una corrida de pruebas. En PlayMode no sobrevive:
 *     lo pisa el de la ejecución, que usa el mismo nombre (medido). Por eso se
 *     abre el editor una segunda vez, en EditMode, con un filtro que no
 *     encuentra ninguna prueba y la opción que lo deja con nombre propio.
 *     Tarda unos 9 s, casi todo arranque del editor.
 *
 * Los dos se limitan al archivo de la unidad bajo prueba, así que no
 * incluyen la prueba, ni los complementos de terceros, ni el resto del juego.
 *
 * El paquete no registra puntos de decisión: los deja vacíos siempre
 * (`OpenCover/Model/Method.cs`), así que la decisión no se informa. Y no
 * mide líneas sino puntos de secuencia del código compilado, que acá se
 * agrupan por línea: un `foreach` tiene tres puntos en una línea, y la
 * condición de cuatro líneas de `AreVerticalOrHorizontalNeighbors` es un solo
 * punto, en la primera, así que cuenta como una línea.
 */

export const COVERAGE_PACKAGE = "com.unity.testtools.codecoverage";

/** Nombre con el que el paquete escribe el mapa completo en la raíz de resultados. */
const FULL_MAP_FILE = "TestCoverageResults_fullEmpty.xml";

/** Lo que el log dice cuando la prueba no ejecutó nada del archivo. */
const NOTHING_VISITED_MESSAGE = "Visited sequence points not found";

const MEASURE: BatchActivity = {
  doing: "medir la cobertura",
  // No hay reintento propio: sin ejecutar no hay datos, así que se reintenta
  // la ejecución, que vuelve a medir.
  retry: "la ejecución",
  timeoutCode: "unity.coverage-timeout",
};

/** Versión del paquete de cobertura declarada en el proyecto, si lo tiene. */
export async function coveragePackageVersion(project: ProjectModel): Promise<string | undefined> {
  try {
    const manifest: unknown = JSON.parse(
      await fsp.readFile(path.join(project.rootPath, "Packages", "manifest.json"), "utf8")
    );
    const version = (manifest as { dependencies?: Record<string, unknown> }).dependencies?.[
      COVERAGE_PACKAGE
    ];
    if (typeof version === "string") {
      return version;
    }
  } catch {
    // Sin manifiesto legible se busca la copia embebida.
  }

  try {
    await fsp.access(path.join(project.rootPath, "Packages", COVERAGE_PACKAGE));
    return "embebida";
  } catch {
    return undefined;
  }
}

/**
 * Filtro del paquete para quedarse con un solo archivo. El paquete compara
 * con la ruta absoluta en minúsculas y lee el filtro como patrón: `**` delante
 * evita depender de dónde está el proyecto. Las opciones se separan con `;`
 * y `,`, y `*`, `?` y `[` son comodines: una ruta que los tenga no se puede
 * filtrar, y entonces no se mide.
 */
export function pathFilterFor(filePath: string): string | undefined {
  if (/[,;*?[\]]/.test(filePath)) {
    return undefined;
  }
  return `+**/${filePath.replace(/\\/g, "/")}`;
}

/**
 * Argumentos que piden cobertura del archivo a una corrida de pruebas. Solo
 * los ensamblados del proyecto (`<assets>`), y de ellos, el archivo.
 */
export function coverageArguments(
  resultsDir: string,
  pathFilter: string,
  options: { readonly fullMap?: boolean } = {}
): string[] {
  const coverageOptions = [
    ...(options.fullMap ? ["generateRootEmptyReport"] : []),
    "assemblyFilters:+<assets>",
    `pathFilters:${pathFilter}`,
  ].join(";");
  return ["-enableCodeCoverage", "-coverageResultsPath", resultsDir, "-coverageOptions", coverageOptions];
}

/**
 * Informe de la ejecución dentro de la carpeta de resultados. El paquete lo
 * deja en `<proyecto>-opencov/<plataforma>/TestCoverageResults_0000.xml`.
 *
 * Devuelve la cadena vacía si la corrida no ejecutó nada del archivo (el
 * paquete no escribe informe y lo dice en el log), y `undefined` si no hay
 * informe ni explicación.
 */
export async function readExecutionCoverage(
  resultsDir: string,
  log: string
): Promise<string | undefined> {
  for (const file of await listFiles(resultsDir)) {
    const name = path.basename(file);
    if (name.endsWith(".xml") && name !== FULL_MAP_FILE) {
      return readIfPresent(file);
    }
  }
  return log.includes(NOTHING_VISITED_MESSAGE) ? "" : undefined;
}

async function listFiles(dir: string): Promise<string[]> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files.sort();
}

export interface CoverageOptions {
  readonly toolchain: UnityEditorToolchain;
  readonly timeoutMs?: number;
}

export async function collectUnityCoverage(
  project: ProjectModel,
  execution: CompletedTestRun,
  target: CoverageTarget,
  options: CoverageOptions
): Promise<CoverageResult> {
  const packageVersion = await coveragePackageVersion(project);
  if (!packageVersion) {
    return notRun({
      code: "unity.coverage-package-missing",
      message: `El proyecto no tiene instalado el paquete de cobertura de Unity (${COVERAGE_PACKAGE}).`,
      remediation:
        "Instalá «Code Coverage» desde Window > Package Manager y volvé a intentar la ejecución.",
    });
  }

  const pathFilter = pathFilterFor(target.filePath);
  if (!pathFilter) {
    return notRun({
      code: "unity.coverage-path-unsupported",
      message: `La ruta "${target.filePath}" tiene caracteres que el paquete de cobertura lee como separadores o comodines.`,
      remediation: "Renombrá el archivo o su carpeta sin «, ; * ? [ ]» para poder medirlo.",
    });
  }

  if (execution.rawCoverage === undefined) {
    return notRun({
      code: "unity.coverage-data-missing",
      message: "La ejecución no dejó datos de cobertura.",
      remediation: "Volvé a intentar la ejecución; si se repite, revisá la salida del editor.",
    });
  }

  const executed = parseOpenCover(execution.rawCoverage);
  if (!executed) {
    return notRun({
      code: "unity.coverage-unreadable",
      message: "Unity dejó un informe de cobertura que no se pudo leer.",
      remediation: "Volvé a intentar la ejecución.",
    });
  }

  const editor = await prepareEditor(project, options.toolchain, MEASURE);
  if ("blocker" in editor) {
    return notRun(editor.blocker);
  }

  return runInBatch(
    options.toolchain,
    editor.executable,
    (workDir, logFile) => [
      "-batchmode",
      "-nographics",
      "-projectPath",
      project.rootPath,
      "-runTests",
      "-testPlatform",
      "EditMode",
      // Ninguna prueba tiene el nombre vacío: la corrida arranca, el paquete
      // escribe el mapa y no se ejecuta nada.
      "-testFilter",
      "^$",
      "-testResults",
      path.join(workDir, "results.xml"),
      "-logFile",
      logFile,
      ...coverageArguments(path.join(workDir, "coverage"), pathFilter, { fullMap: true }),
    ],
    options.timeoutMs ?? BATCH_TIMEOUT_MS,
    async (run, log, workDir) => {
      const blocker = batchBlocker(run, log, MEASURE);
      if (blocker) {
        return notRun(blocker, log);
      }

      const full = parseOpenCover(await readIfPresent(path.join(workDir, "coverage", FULL_MAP_FILE)));
      if (!full || full.length === 0) {
        return notRun(
          {
            code: "unity.coverage-map-missing",
            message: `Unity terminó con el código ${run.exitCode ?? -1} sin dejar el total de lo medible del archivo.`,
            remediation:
              "La cobertura solo mide los ensamblados de la carpeta Assets. Si el archivo está ahí, volvé a intentar la ejecución y, si se repite, revisá la salida del editor.",
          },
          log
        );
      }

      const report = mergeCoverage(full, executed, target);
      return {
        status: "measured",
        ...report,
        notes: [
          ...report.notes,
          `La cobertura de decisión no está disponible: el paquete de cobertura de Unity (${packageVersion}) no registra puntos de decisión.`,
        ],
      };
    }
  );
}

function notRun(blocker: PreconditionViolation, rawOutput?: string): CoverageResult {
  return rawOutput === undefined
    ? { status: "notRun", blocker }
    : { status: "notRun", blocker, rawOutput };
}

// ── Lectura del formato OpenCover ──────────────────────────────────────────

/** Un punto de secuencia: un tramo de código que la corrida ejecutó o no. */
export interface SequencePoint {
  /** Nombre completo del método, tal como lo escribe el paquete. */
  readonly method: string;
  /** Desplazamiento en el código compilado: identifica el punto dentro del método. */
  readonly offset: number;
  /** Línea donde empieza, base 1. */
  readonly line: number;
  readonly hits: number;
  /** Ruta absoluta, con «/». */
  readonly file: string;
}

/**
 * Los puntos de un informe OpenCover del paquete. Se lee con expresiones,
 * como el informe de NUnit, para no sumar una dependencia de XML. Devuelve
 * `undefined` si no es un informe. La cadena vacía es un informe sin puntos:
 * es lo que deja `readExecutionCoverage` cuando la corrida no ejecutó nada
 * del archivo.
 */
export function parseOpenCover(xml: string): SequencePoint[] | undefined {
  if (xml === "") {
    return [];
  }
  if (!/<CoverageSession\b/.test(xml)) {
    return undefined;
  }

  const points: SequencePoint[] = [];
  for (const module of xml.matchAll(/<Module\b[\s\S]*?<\/Module>/g)) {
    const files = new Map<string, string>();
    for (const file of module[0].matchAll(/<File\b([^>]*?)\/?>/g)) {
      const attributes = readAttributes(file[1]);
      if (attributes["uid"] && attributes["fullPath"]) {
        files.set(attributes["uid"], attributes["fullPath"].replace(/\\/g, "/"));
      }
    }

    for (const method of module[0].matchAll(/<Method\b[^>]*>([\s\S]*?)<\/Method>/g)) {
      const name = /<Name>([\s\S]*?)<\/Name>/.exec(method[1]);
      if (!name) {
        continue;
      }
      const methodName = decodeEntities(name[1]);
      for (const point of method[1].matchAll(/<SequencePoint\b([^>]*?)\/?>/g)) {
        const attributes = readAttributes(point[1]);
        const offset = Number(attributes["offset"]);
        const line = Number(attributes["sl"]);
        const hits = Number(attributes["vc"]);
        const file = files.get(attributes["fileid"] ?? "");
        if (!file || ![offset, line, hits].every(Number.isInteger)) {
          continue;
        }
        points.push({ method: methodName, offset, line, hits, file });
      }
    }
  }
  return points;
}

// ── Cruce de los dos informes ──────────────────────────────────────────────

interface MergedPoint {
  readonly method: string;
  readonly line: number;
  readonly covered: boolean;
}

/**
 * El total sale del mapa completo y lo cubierto, del informe de la
 * ejecución. Un punto se reconoce por su método y su desplazamiento: la
 * columna no sirve, porque el mapa la escribe en cero.
 */
export function mergeCoverage(
  full: readonly SequencePoint[],
  executed: readonly SequencePoint[],
  target: CoverageTarget
) {
  const inFile = (point: SequencePoint) => sameFile(point.file, target.filePath);
  const key = (point: SequencePoint) => `${point.method}@${point.offset}`;

  const hits = new Map<string, number>();
  for (const point of executed.filter(inFile)) {
    hits.set(key(point), (hits.get(key(point)) ?? 0) + point.hits);
  }

  // Un punto que solo está en la ejecución también cuenta: el mapa podría
  // omitir algo que la corrida sí recorrió.
  const all = new Map<string, SequencePoint>();
  for (const point of [...full, ...executed].filter(inFile)) {
    if (!all.has(key(point))) {
      all.set(key(point), point);
    }
  }

  const merged: MergedPoint[] = [...all.entries()].map(([pointKey, point]) => ({
    method: point.method,
    line: point.line,
    covered: (hits.get(pointKey) ?? 0) > 0,
  }));

  const units = unitsOf(merged);
  const targetUnit = units.find((unit) => isTargetUnit(unit, target));
  const fileLines = linesOf(merged);
  const fileLine = countLines(fileLines);
  const visited = merged.filter((point) => point.covered).length;

  return {
    line: fileLine,
    byFile: [
      {
        filePath: target.filePath,
        line: fileLine,
        units: units.map(toUnitCoverage),
        lines: fileLines,
      },
    ],
    ...(targetUnit ? { target: toUnitCoverage(targetUnit) } : {}),
    notes: [
      `Una línea cuenta como cubierta si la corrida ejecutó algo de ella; si ejecutó solo una parte, el código la marca como parcial. Unity no mide líneas sino puntos de secuencia del código compilado (la corrida ejecutó ${visited} de ${merged.length} en este archivo): una expresión repartida en varias líneas es un solo punto y cuenta solo en la primera.`,
    ],
  };
}

function sameFile(absolute: string, relative: string): boolean {
  const normalized = relative.replace(/\\/g, "/").toLowerCase();
  const file = absolute.toLowerCase();
  return file === normalized || file.endsWith(`/${normalized}`);
}

interface UnitPoints {
  readonly className: string;
  readonly methodName: string;
  readonly points: MergedPoint[];
}

/**
 * Agrupa los puntos por el método escrito en el archivo. El compilador
 * reparte algunos métodos en varios: un iterador queda en `MoveNext` de una
 * clase `<Metodo>d__0`, y una función anónima, en `<Metodo>b__0_0`. Ese
 * código está escrito dentro del método y se le atribuye.
 */
function unitsOf(points: readonly MergedPoint[]): UnitPoints[] {
  const units = new Map<string, UnitPoints>();
  for (const point of points) {
    const owner = sourceMethodOf(point.method);
    const unitKey = `${owner.className}.${owner.methodName}`;
    const unit = units.get(unitKey) ?? { ...owner, points: [] };
    unit.points.push(point);
    units.set(unitKey, unit);
  }
  return [...units.values()].sort((a, b) => firstLine(a.points) - firstLine(b.points));
}

/**
 * Clase y método del archivo a los que pertenece un método compilado, a
 * partir de nombres como estos:
 *
 *   static System.Boolean Utilities::AreVerticalOrHorizontalNeighbors(Shape, Shape)
 *   System.Boolean Utilities/<AnimatePotentialMatches>d__0::MoveNext()
 *   System.Boolean Juego.Tablero/<>c::<Buscar>b__3_0(Pieza)
 */
export function sourceMethodOf(name: string): { className: string; methodName: string } {
  const open = name.indexOf("(");
  const head = open === -1 ? name : name.slice(0, open);
  const separator = head.lastIndexOf("::");
  if (separator === -1) {
    return { className: "", methodName: head.trim() };
  }

  const typePath = head.slice(head.lastIndexOf(" ", separator) + 1, separator);
  const compiled = head.slice(separator + 2);
  const segments = typePath.split("/");

  // La clase escrita es el último tramo que no generó el compilador, sin el
  // espacio de nombres ni la aridad de los genéricos.
  const written = [...segments].reverse().find((segment) => !segment.startsWith("<")) ?? typePath;
  const className = written.slice(written.lastIndexOf(".") + 1).replace(/(`\d+|\[).*$/, "");

  const generatedFrom = (text: string) => /^<([^>]+)>/.exec(text)?.[1];
  const methodName =
    generatedFrom(compiled) ?? generatedFrom(segments[segments.length - 1]) ?? compiled;

  return { className, methodName };
}

function isTargetUnit(unit: UnitPoints, target: CoverageTarget): boolean {
  return (
    unit.methodName === target.unit.methodName &&
    (target.unit.className === null || unit.className === target.unit.className)
  );
}

function toUnitCoverage(unit: UnitPoints): UnitCoverage {
  return {
    name: unit.className ? `${unit.className}.${unit.methodName}` : unit.methodName,
    firstLine: firstLine(unit.points),
    line: countLines(linesOf(unit.points)),
  };
}

function firstLine(points: readonly MergedPoint[]): number {
  return Math.min(...points.map((point) => point.line));
}

/**
 * Cuenta líneas, no puntos: una línea con varios puntos cuenta una vez, y
 * como cubierta aunque haya quedado parcial, porque la corrida pasó por
 * ella. Así cuentan las líneas otras herramientas, como JaCoCo.
 */
function countLines(lines: readonly LineCoverage[]): CoverageMetric {
  const total = lines.length;
  const covered = lines.filter((line) => line.status !== "missed").length;
  return {
    covered,
    total,
    percentage: total === 0 ? 0 : Math.round((covered / total) * 1000) / 10,
  };
}

/** Una línea con varios puntos queda parcial si la corrida ejecutó solo algunos. */
function linesOf(points: readonly MergedPoint[]): LineCoverage[] {
  const byLine = new Map<number, boolean[]>();
  for (const point of points) {
    byLine.set(point.line, [...(byLine.get(point.line) ?? []), point.covered]);
  }
  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([line, covered]) => ({ line, status: lineStatus(covered) }));
}

function lineStatus(covered: readonly boolean[]): LineCoverageStatus {
  if (covered.every(Boolean)) {
    return "covered";
  }
  return covered.some(Boolean) ? "partial" : "missed";
}

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeEntities(match[2]);
  }
  return attributes;
}

/** `&amp;` va al final: si fuera primero, `&amp;lt;` terminaría en «<». */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}
