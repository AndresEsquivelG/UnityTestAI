import type {
  CoverageMetric,
  CoverageReport,
  CoverageTarget,
  LineCoverage,
  LineCoverageStatus,
  UnitCoverage,
} from "../../../core/contracts";
import { readAttributes } from "./xml";

/**
 * El informe XML de JaCoCo, limitado al archivo de la unidad bajo prueba.
 *
 * JaCoCo analiza todas las clases compiladas del proyecto, no solo las que la
 * prueba tocó, así que un solo informe trae lo cubierto y lo que faltó: no
 * hace falta una segunda corrida como en Unity. Las clases de prueba no
 * entran, porque solo mide `target/classes` (o su equivalente en Gradle).
 *
 * Lo que trae, comprobado con la versión 0.8.15:
 *
 *   · por archivo (`sourcefile`), cada línea con código: instrucciones
 *     ejecutadas y no ejecutadas (`ci`, `mi`) y ramas cubiertas y no
 *     cubiertas (`cb`, `mb`), y los totales por tipo de contador;
 *   · por clase, cada método con su firma, su primera línea y sus totales.
 *     Las clases anidadas son otras clases (`Externa$Interna`), las anónimas
 *     también (`Externa$1`), y cada lambda es un método aparte
 *     (`lambda$contarPares$0`).
 *
 * Lo que no trae es qué líneas son de cada método. Se deducen por orden: una
 * línea es del último método escrito que empieza antes que ella. Las lambdas
 * y las clases anónimas no cortan, porque están escritas dentro de un método,
 * y se le atribuyen; las sobrecargas se juntan, como pide `UnitCoverage`.
 */

export type JacocoReading =
  | { readonly kind: "measured"; readonly report: CoverageReport }
  | { readonly kind: "fileMissing" }
  | { readonly kind: "unreadable" };

interface LineEntry {
  readonly nr: number;
  readonly mi: number;
  readonly ci: number;
  readonly mb: number;
  readonly cb: number;
}

interface MethodEntry {
  /** Clase sin el paquete, con sus «$»: `Clasificador$Interna`. */
  readonly className: string;
  readonly name: string;
  readonly line: number;
}

/**
 * `sourcePath` es la ruta del archivo dentro de la jerarquía de fuentes,
 * con «/»: `com/example/project/Calculator.java`.
 */
export function readJacocoReport(xml: string, target: CoverageTarget, sourcePath: string): JacocoReading {
  if (!/<report\b/.test(xml)) {
    return { kind: "unreadable" };
  }

  const slash = sourcePath.lastIndexOf("/");
  const packageName = slash === -1 ? "" : sourcePath.slice(0, slash);
  const fileName = sourcePath.slice(slash + 1);

  const packageBody = elementBody(xml, "package", packageName);
  const sourceBody = packageBody === undefined ? undefined : elementBody(packageBody, "sourcefile", fileName);
  if (packageBody === undefined || sourceBody === undefined) {
    return { kind: "fileMissing" };
  }

  const lines = [...sourceBody.matchAll(/<line\b([^>]*?)\/?>/g)]
    .map((match) => readAttributes(match[1]))
    .map((attributes) => ({
      nr: Number(attributes["nr"]),
      mi: Number(attributes["mi"] ?? 0),
      ci: Number(attributes["ci"] ?? 0),
      mb: Number(attributes["mb"] ?? 0),
      cb: Number(attributes["cb"] ?? 0),
    }))
    .filter((entry) => [entry.nr, entry.mi, entry.ci, entry.mb, entry.cb].every(Number.isInteger))
    .sort((a, b) => a.nr - b.nr);

  const methods: MethodEntry[] = [];
  for (const klass of packageBody.matchAll(/<class\b([^>]*?)(?:\/>|>([\s\S]*?)<\/class>)/g)) {
    const attributes = readAttributes(klass[1]);
    if (attributes["sourcefilename"] !== fileName) {
      continue;
    }
    const className = (attributes["name"] ?? "").split("/").pop() ?? "";
    for (const method of (klass[2] ?? "").matchAll(/<method\b([^>]*?)>/g)) {
      const methodAttributes = readAttributes(method[1]);
      const line = Number(methodAttributes["line"]);
      if (methodAttributes["name"] && Number.isInteger(line)) {
        methods.push({ className, name: methodAttributes["name"], line });
      }
    }
  }

  const fileLines = lines.map(toLineCoverage);
  const units = unitsOf(lines, methods);
  const targetUnit = units.find(
    (unit) =>
      unit.methodName === target.unit.methodName &&
      (target.unit.className === null || unit.className === target.unit.className)
  );

  const fileCounters = {
    line: countLines(fileLines),
    decision: sumBranches(lines),
    instruction: sumInstructions(lines),
  };

  return {
    kind: "measured",
    report: {
      ...fileCounters,
      byFile: [
        {
          filePath: target.filePath,
          ...fileCounters,
          units: units.map(toUnitCoverage),
          lines: fileLines,
        },
      ],
      ...(targetUnit ? { target: toUnitCoverage(targetUnit) } : {}),
      notes: [
        "Una línea cuenta como cubierta si la corrida ejecutó al menos una instrucción de ella; si quedó alguna instrucción o rama sin ejecutar, el código la marca como parcial. Así cuenta las líneas JaCoCo.",
        "Decisión son las ramas que JaCoCo cuenta en cada condición: un if tiene dos, verdadera y falsa, y un switch una por caso. Instrucción son las instrucciones del código compilado.",
      ],
    },
  };
}

/** Cuerpo del elemento con ese nombre, o `undefined` si no está. */
function elementBody(xml: string, element: string, name: string): string | undefined {
  for (const match of xml.matchAll(new RegExp(`<${element}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${element}>)`, "g"))) {
    if (readAttributes(match[1])["name"] === name) {
      return match[2] ?? "";
    }
  }
  return undefined;
}

interface UnitLines {
  readonly className: string;
  readonly methodName: string;
  readonly label: string;
  readonly lines: LineEntry[];
}

/**
 * Las clases anónimas y locales (`Externa$1`, `Externa$1Local`) están
 * escritas dentro de un método; las lambdas y lo que genera el compilador
 * llevan «$» en el nombre del método. Nada de eso empieza un método escrito.
 */
function isWrittenMethod(method: MethodEntry): boolean {
  const insideMethod = method.className.split("$").some((segment) => /^\d/.test(segment));
  return !insideMethod && !method.name.includes("$");
}

function unitsOf(lines: readonly LineEntry[], methods: readonly MethodEntry[]): UnitLines[] {
  const starts = methods.filter(isWrittenMethod).sort((a, b) => a.line - b.line);
  const units = new Map<string, UnitLines>();

  for (const entry of lines) {
    let owner: MethodEntry | undefined;
    for (const start of starts) {
      if (start.line > entry.nr) {
        break;
      }
      owner = start;
    }
    if (!owner) {
      continue;
    }
    const className = owner.className.split("$").pop() ?? owner.className;
    const key = `${owner.className}.${owner.name}`;
    const unit = units.get(key) ?? {
      className,
      methodName: owner.name,
      label: unitLabel(className, owner.name),
      lines: [],
    };
    unit.lines.push(entry);
    units.set(key, unit);
  }

  return [...units.values()].sort((a, b) => a.lines[0].nr - b.lines[0].nr);
}

/** Los constructores y el bloque estático se llaman, en el código compilado, `<init>` y `<clinit>`. */
function unitLabel(className: string, methodName: string): string {
  if (methodName === "<init>") {
    return `${className} (constructor)`;
  }
  if (methodName === "<clinit>") {
    return `${className} (inicialización estática)`;
  }
  return `${className}.${methodName}`;
}

function toUnitCoverage(unit: UnitLines): UnitCoverage {
  return {
    name: unit.label,
    firstLine: unit.lines[0].nr,
    line: countLines(unit.lines.map(toLineCoverage)),
    decision: sumBranches(unit.lines),
    instruction: sumInstructions(unit.lines),
  };
}

function toLineCoverage(entry: LineEntry): LineCoverage {
  return { line: entry.nr, status: lineStatus(entry) };
}

function lineStatus(entry: LineEntry): LineCoverageStatus {
  if (entry.ci === 0) {
    return "missed";
  }
  return entry.mi > 0 || entry.mb > 0 ? "partial" : "covered";
}

function countLines(lines: readonly LineCoverage[]): CoverageMetric {
  return metric(
    lines.filter((line) => line.status !== "missed").length,
    lines.length
  );
}

function sumBranches(lines: readonly LineEntry[]): CoverageMetric {
  const covered = lines.reduce((sum, entry) => sum + entry.cb, 0);
  return metric(covered, covered + lines.reduce((sum, entry) => sum + entry.mb, 0));
}

function sumInstructions(lines: readonly LineEntry[]): CoverageMetric {
  const covered = lines.reduce((sum, entry) => sum + entry.ci, 0);
  return metric(covered, covered + lines.reduce((sum, entry) => sum + entry.mi, 0));
}

function metric(covered: number, total: number): CoverageMetric {
  return {
    covered,
    total,
    percentage: total === 0 ? 0 : Math.round((covered / total) * 1000) / 10,
  };
}
