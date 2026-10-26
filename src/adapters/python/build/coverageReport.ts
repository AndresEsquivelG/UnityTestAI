import type {
  CoverageMetric,
  CoverageReport,
  CoverageTarget,
  LineCoverage,
  UnitCoverage,
} from "../../../core/contracts";
import { lineOf, outlinePython, type PythonBlock, type PythonOutline } from "../source/declarations";

/**
 * El informe JSON de coverage, limitado al archivo de la unidad bajo prueba.
 *
 * Lo que trae cada archivo, comprobado con coverage 7.17.0:
 *
 *   · `executed_lines` y `missing_lines`: las instrucciones, cada una contada
 *     en la línea donde empieza;
 *   · `executed_branches` y `missing_branches`: las ramas, como pares
 *     `[línea de la condición, línea a la que salta]`; un destino negativo es
 *     la salida de la función.
 *
 * También trae cada función, pero no se usa: no está en las versiones viejas, y
 * pone aparte las funciones anidadas, que el contrato quiere juntas con el
 * método donde están escritas (como las lambdas de Java). Las líneas de cada
 * método se sacan del lector propio del adaptador, que coincide con el módulo
 * `ast` en toda la biblioteca estándar: las del cuerpo, sin el encabezado,
 * porque coverage cuenta el `def` como código del módulo, que corre al
 * importarlo. Sobre `ConcreteHandler1.check_range` da lo mismo que coverage:
 * 3 de 4 líneas y 1 de 2 ramas.
 */

export type CoverageReading =
  | { readonly kind: "measured"; readonly report: CoverageReport }
  | { readonly kind: "fileMissing" }
  | { readonly kind: "unreadable" };

interface FileData {
  readonly executed: readonly number[];
  readonly missing: readonly number[];
  readonly executedBranches: readonly (readonly [number, number])[];
  readonly missingBranches: readonly (readonly [number, number])[];
}

interface UnitLines {
  readonly name: string;
  readonly className: string | null;
  readonly methodName: string;
  readonly lines: Set<number>;
}

export function readCoverageJson(json: string, target: CoverageTarget, source: string): CoverageReading {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { kind: "unreadable" };
  }
  const files = (data as { files?: unknown } | null)?.files;
  if (!files || typeof files !== "object") {
    return { kind: "unreadable" };
  }

  const wanted = normalize(target.filePath);
  const entry = Object.entries(files as Record<string, unknown>).find(([key]) => normalize(key) === wanted)?.[1];
  const file = entry ? readFileData(entry) : undefined;
  if (!file) {
    return { kind: "fileMissing" };
  }

  const partial = new Set(file.missingBranches.map(([from]) => from));
  const missed = new Set(file.missing);
  const statements = [...new Set([...file.executed, ...file.missing])].sort((a, b) => a - b);
  const fileLines: LineCoverage[] = statements.map((line) => ({
    line,
    status: missed.has(line) ? "missed" : partial.has(line) ? "partial" : "covered",
  }));

  const units = unitsOf(outlinePython(source), statements);
  const toUnit = (unit: UnitLines): UnitCoverage => {
    const lines = fileLines.filter((line) => unit.lines.has(line.line));
    return {
      name: unit.name,
      firstLine: lines[0].line,
      line: countLines(lines),
      decision: countBranches(file, (line) => unit.lines.has(line)),
    };
  };
  const measured = units.filter((unit) => unit.lines.size > 0);
  const targetUnit = measured.find(
    (unit) => unit.methodName === target.unit.methodName && unit.className === target.unit.className
  );

  const fileCounters = { line: countLines(fileLines), decision: countBranches(file, () => true) };
  return {
    kind: "measured",
    report: {
      ...fileCounters,
      byFile: [{ filePath: target.filePath, ...fileCounters, units: measured.map(toUnit), lines: fileLines }],
      ...(targetUnit ? { target: toUnit(targetUnit) } : {}),
      notes: [
        "Una línea es una instrucción de Python, contada en la línea donde empieza, como las cuenta coverage.py; si la corrida la ejecutó pero dejó sin recorrer alguna de sus ramas, el código la marca como parcial. El encabezado de un método (def) no cuenta como suyo: corre al importar el módulo.",
        "Decisión son las ramas que coverage.py cuenta en cada condición: un if tiene dos, verdadera y falsa, y un for, entrar al cuerpo o seguir de largo. La instrucción no está disponible: coverage.py no la mide.",
        'No cuenta el bloque if __name__ == "__main__":, que una prueba no puede ejecutar.',
      ],
    },
  };
}

/**
 * Cada método o función con sus líneas medibles. Una función escrita dentro de
 * otra es parte de esa otra; los métodos de una clase anidada, de esa clase.
 * Dos `def` con el mismo nombre en la misma clase (una propiedad y su
 * `setter`) se juntan, como las sobrecargas.
 */
function unitsOf(outline: PythonOutline, statements: readonly number[]): UnitLines[] {
  const units = new Map<string, UnitLines>();
  for (const block of outline.blocks) {
    if (block.kind !== "def" || hasFunctionAncestor(block)) {
      continue;
    }
    const classes = classChain(block);
    const name = [...classes, block.name].join(".");
    const unit = units.get(name) ?? {
      name,
      className: classes.length > 0 ? classes[classes.length - 1] : null,
      methodName: block.name,
      lines: new Set<number>(),
    };
    const header = lineOf(outline.scanned, block.body.start);
    const last = lineOf(outline.scanned, Math.max(block.body.start, block.body.end - 1));
    const inline = block.bodyIndent === null;
    for (const line of statements) {
      if ((line > header || (inline && line === header)) && line <= last) {
        unit.lines.add(line);
      }
    }
    units.set(name, unit);
  }
  return [...units.values()].sort((a, b) => Math.min(...a.lines) - Math.min(...b.lines));
}

function hasFunctionAncestor(block: PythonBlock): boolean {
  for (let parent = block.parent; parent; parent = parent.parent) {
    if (parent.kind === "def") {
      return true;
    }
  }
  return false;
}

/** Las clases que contienen al bloque, de la de afuera a la de adentro. */
function classChain(block: PythonBlock): string[] {
  const chain: string[] = [];
  for (let parent = block.parent; parent; parent = parent.parent) {
    chain.unshift(parent.name);
  }
  return chain;
}

function readFileData(entry: unknown): FileData | undefined {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const value = entry as Record<string, unknown>;
  const numbers = (list: unknown) => (Array.isArray(list) ? list.filter(Number.isInteger) : []) as number[];
  const arcs = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter(
      (arc): arc is [number, number] => Array.isArray(arc) && arc.length === 2 && arc.every(Number.isInteger)
    );
  if (!Array.isArray(value["executed_lines"]) || !Array.isArray(value["missing_lines"])) {
    return undefined;
  }
  return {
    executed: numbers(value["executed_lines"]),
    missing: numbers(value["missing_lines"]),
    executedBranches: arcs(value["executed_branches"]),
    missingBranches: arcs(value["missing_branches"]),
  };
}

function countLines(lines: readonly LineCoverage[]): CoverageMetric {
  return metric(lines.filter((line) => line.status !== "missed").length, lines.length);
}

function countBranches(file: FileData, inside: (line: number) => boolean): CoverageMetric {
  const covered = file.executedBranches.filter(([from]) => inside(from)).length;
  const missing = file.missingBranches.filter(([from]) => inside(from)).length;
  return metric(covered, covered + missing);
}

function metric(covered: number, total: number): CoverageMetric {
  return { covered, total, percentage: total === 0 ? 0 : Math.round((covered / total) * 1000) / 10 };
}

/** coverage escribe las rutas con el separador del sistema; se comparan sin distinguir mayúsculas. */
function normalize(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}
