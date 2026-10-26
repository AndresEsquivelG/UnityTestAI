import { scanPythonSource, type ScannedSource, type SourceLine } from "./masking";

/**
 * Declaraciones de clases y funciones en código Python.
 *
 * No es un analizador sintáctico: reconoce un `class` o un `def` al principio
 * de una instrucción, sobre el código ya enmascarado, y ubica su final por la
 * sangría. Un bloque termina antes de la primera instrucción que empieza en su
 * misma columna o más a la izquierda. Las líneas en blanco, los comentarios y
 * las que continúan una instrucción no cuentan, igual que para Python.
 *
 * Cada bloque sabe dentro de cuál está. De eso sale lo que en Java salía de las
 * llaves: un método es un `def` cuyo padre es la clase; una función de módulo
 * no tiene padre; y una función definida dentro de otra tiene por padre esa
 * función, así que no se confunde con ninguna de las dos (lo pide HU-24).
 *
 * Un `def` dentro de un `if` o de un `try` del módulo sigue siendo del módulo:
 * esas instrucciones no son bloques de esta lista, y no cambian el ámbito.
 */

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export type BlockKind = "class" | "def";

export interface PythonBlock {
  readonly kind: BlockKind;
  readonly name: string;
  /** `async def`. */
  readonly isAsync: boolean;
  /** Línea del `def` o del `class`, base 1. */
  readonly line: number;
  /** Columna del nombre, base 1. */
  readonly column: number;
  /** Sangría del encabezado, con el tabulador a la columna múltiplo de 8 como Python. */
  readonly indent: number;
  /** Cada decorador sin la `@`, con los espacios colapsados: `staticmethod`, `dataclass(frozen=True)`. */
  readonly decorators: readonly string[];
  /**
   * Desde el `def` o el `class` hasta antes de los dos puntos, con los
   * espacios colapsados y sin comentarios: `def agregar(self, item: Item) -> None`.
   */
  readonly signature: string;
  /** Lo que va entre los paréntesis del encabezado: los parámetros, o las clases base. */
  readonly parameters: string;
  /** La anotación de retorno de un `def`, sin la flecha, si la tiene. */
  readonly returns?: string;
  /** Desde el principio de la línea del primer decorador, o del encabezado, hasta el final del cuerpo. */
  readonly range: SourceRange;
  /** Desde después de los dos puntos hasta el final del cuerpo. */
  readonly body: SourceRange;
  /** Sangría de las instrucciones del cuerpo, o `null` si el cuerpo va en la misma línea. */
  readonly bodyIndent: number | null;
  readonly parent: PythonBlock | null;
  readonly children: readonly PythonBlock[];
}

export interface PythonOutline {
  readonly source: string;
  readonly scanned: ScannedSource;
  /** Todos los bloques del archivo, en orden de aparición, a cualquier profundidad. */
  readonly blocks: readonly PythonBlock[];
}

/** Una instrucción: su primera línea y todas las que la continúan. */
export interface Statement {
  readonly start: number;
  readonly end: number;
  readonly indent: number;
  /** Primera línea, base 1. */
  readonly line: number;
}

const NAME = String.raw`[\p{L}_][\p{L}\p{N}_]*`;
const DEF_HEADER = new RegExp(String.raw`^([ \t]*)(?:(async)[ \t]+)?def[ \t]+(${NAME})[ \t]*[(\[]`, "u");
const CLASS_HEADER = new RegExp(String.raw`^([ \t]*)class[ \t]+(${NAME})[ \t]*[(\[:]`, "u");

export function outlinePython(source: string): PythonOutline {
  const scanned = scanPythonSource(source);
  const statements = statementsOf(scanned);
  const blocks: MutableBlock[] = [];
  const open: MutableBlock[] = [];

  statements.forEach((statement, index) => {
    const block = readHeader(scanned, statements, index);
    if (!block) {
      return;
    }
    while (open.length > 0 && open[open.length - 1].range.end < statement.start) {
      open.pop();
    }
    const parent = open[open.length - 1] ?? null;
    block.parent = parent;
    parent?.children.push(block);
    open.push(block);
    blocks.push(block);
  });

  return { source, scanned, blocks };
}

/**
 * Las instrucciones del archivo: cada línea que no está en blanco ni continúa
 * otra, con las que la continúan. Un comentario solo queda en blanco al
 * enmascararlo, así que no es una instrucción.
 */
export function statementsOf(scanned: ScannedSource): Statement[] {
  const { masked, lines } = scanned;
  const statements: Statement[] = [];
  let current: { first: SourceLine; last: SourceLine; line: number } | null = null;

  const close = () => {
    if (current) {
      statements.push({
        start: current.first.start,
        end: current.last.end,
        indent: indentationOf(masked, current.first),
        line: current.line,
      });
    }
  };

  lines.forEach((line, index) => {
    const blankLine = masked.slice(line.start, line.end).trim() === "";
    if (line.continuation && current) {
      if (!blankLine) {
        current.last = line;
      }
      return;
    }
    if (blankLine) {
      return;
    }
    close();
    current = { first: line, last: line, line: index + 1 };
  });
  close();

  return statements;
}

/** Las instrucciones que están directamente en el cuerpo de un bloque, sin entrar a los anidados. */
export function bodyStatements(outline: PythonOutline, block: PythonBlock): Statement[] {
  if (block.bodyIndent === null) {
    return [];
  }
  return statementsOf(outline.scanned).filter(
    (statement) =>
      statement.start >= block.body.start &&
      statement.end <= block.body.end &&
      statement.indent === block.bodyIndent
  );
}

/** Texto de una parte del código sin comentarios, con los espacios colapsados. */
export function collapsed(scanned: ScannedSource, start: number, end: number): string {
  return scanned.code.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Los antecesores de un bloque, del más cercano al módulo. */
export function ancestorsOf(block: PythonBlock): PythonBlock[] {
  const ancestors: PythonBlock[] = [];
  for (let parent = block.parent; parent; parent = parent.parent) {
    ancestors.push(parent);
  }
  return ancestors;
}

/**
 * Las clases con ese nombre que se pueden alcanzar desde afuera: las del
 * módulo y las anidadas en otra clase. Una clase definida dentro de una
 * función solo existe mientras esa función corre, y no se puede importar.
 */
export function findClasses(outline: PythonOutline, name: string): PythonBlock[] {
  return outline.blocks.filter(
    (block) =>
      block.kind === "class" &&
      block.name === name &&
      ancestorsOf(block).every((ancestor) => ancestor.kind === "class")
  );
}

/** Los métodos de una clase: los `def` que están directamente en su cuerpo. */
export function methodsOf(owner: PythonBlock): PythonBlock[] {
  return owner.children.filter((child) => child.kind === "def");
}

/** Las funciones de módulo: los `def` que no están dentro de ninguna clase ni función. */
export function moduleFunctions(outline: PythonOutline): PythonBlock[] {
  return outline.blocks.filter((block) => block.kind === "def" && block.parent === null);
}

/** El nombre de un decorador sin su llamada ni su módulo: `abc.abstractmethod` → `abstractmethod`. */
export function decoratorName(decorator: string): string {
  const call = decorator.indexOf("(");
  const dotted = call === -1 ? decorator : decorator.slice(0, call);
  const segments = dotted.trim().split(".");
  return segments[segments.length - 1];
}

/** Sangría de una línea: un tabulador lleva a la siguiente columna múltiplo de 8. */
function indentationOf(text: string, line: SourceLine): number {
  let width = 0;
  for (let index = line.start; index < line.end; index++) {
    const character = text[index];
    if (character === " ") {
      width++;
    } else if (character === "\t") {
      width = width - (width % 8) + 8;
    } else if (character === "\f") {
      width = 0;
    } else {
      break;
    }
  }
  return width;
}

type MutableBlock = Omit<PythonBlock, "parent" | "children"> & {
  parent: PythonBlock | null;
  children: PythonBlock[];
};

function readHeader(
  scanned: ScannedSource,
  statements: readonly Statement[],
  index: number
): MutableBlock | null {
  const { masked } = scanned;
  const statement = statements[index];
  const text = masked.slice(statement.start, statement.end);

  const def = DEF_HEADER.exec(text);
  const cls = def ? null : CLASS_HEADER.exec(text);
  if (!def && !cls) {
    return null;
  }

  const kind: BlockKind = def ? "def" : "class";
  const name = def ? def[3] : cls![2];
  const keywordStart = statement.start + (def ? def[1].length : cls![1].length);
  const nameStart = masked.indexOf(name, keywordStart + (def?.[2] ? 5 : 0) + (kind === "def" ? 3 : 5));

  const colon = headerColon(masked, nameStart + name.length, statement.end);
  if (colon === -1) {
    return null;
  }

  const { parameters, afterParameters } = readParameters(scanned, nameStart + name.length, colon);
  const returns =
    kind === "def" ? /^\s*->\s*([\s\S]*)$/.exec(scanned.code.slice(afterParameters, colon))?.[1] : undefined;

  const inlineBody = masked.slice(colon + 1, statement.end).trim() !== "";
  const end = inlineBody ? statement.end : blockEnd(statements, index);
  const following = statements[index + 1];
  const bodyIndent =
    !inlineBody && following && following.start < end && following.indent > statement.indent
      ? following.indent
      : null;

  const decorators = decoratorsBefore(scanned, statements, index);
  const line = lineOf(scanned, nameStart);

  return {
    kind,
    name,
    isAsync: Boolean(def?.[2]),
    line,
    column: nameStart - scanned.lines[line - 1].start + 1,
    indent: statement.indent,
    decorators: decorators.map((decorator) => decorator.text),
    signature: collapsed(scanned, keywordStart, colon),
    parameters,
    ...(returns ? { returns: returns.replace(/\s+/g, " ").trim() } : {}),
    range: { start: decorators[0]?.start ?? statement.start, end },
    body: { start: colon + 1, end },
    bodyIndent,
    parent: null,
    children: [],
  };
}

/**
 * Los dos puntos que cierran el encabezado: los primeros fuera de todo
 * paréntesis. Los de una anotación o una lambda en un valor por defecto
 * (`clave=lambda x: x`) están dentro de los paréntesis de los parámetros.
 */
function headerColon(masked: string, from: number, limit: number): number {
  let depth = 0;
  for (let index = from; index < limit; index++) {
    const character = masked[index];
    if (character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (character === ")" || character === "]" || character === "}") {
      depth--;
    } else if (character === ":" && depth === 0) {
      return index;
    }
  }
  return -1;
}

/**
 * Lo que va entre los paréntesis del encabezado. Salta los parámetros de tipo
 * que puede llevar el nombre desde Python 3.12 (`def primero[T](valores)`).
 */
function readParameters(
  scanned: ScannedSource,
  from: number,
  colon: number
): { parameters: string; afterParameters: number } {
  const { masked } = scanned;
  let index = from;
  while (index < colon && /\s/.test(masked[index])) {
    index++;
  }
  if (masked[index] === "[") {
    index = matching(masked, index, colon) + 1;
    while (index < colon && /\s/.test(masked[index])) {
      index++;
    }
  }
  if (masked[index] !== "(") {
    return { parameters: "", afterParameters: index };
  }
  const close = matching(masked, index, colon);
  return { parameters: collapsed(scanned, index + 1, close), afterParameters: close + 1 };
}

/** Posición del paréntesis o corchete que cierra el que está en `open`. */
function matching(masked: string, open: number, limit: number): number {
  let depth = 0;
  for (let index = open; index < limit; index++) {
    const character = masked[index];
    if (character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (character === ")" || character === "]" || character === "}") {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return limit;
}

/** Final del cuerpo: el de la última instrucción antes de la primera que no está más adentro. */
function blockEnd(statements: readonly Statement[], index: number): number {
  const header = statements[index];
  let last = header;
  for (let next = index + 1; next < statements.length; next++) {
    if (statements[next].indent <= header.indent) {
      break;
    }
    last = statements[next];
  }
  return last.end;
}

/** Los decoradores que preceden al encabezado, en su misma columna. */
function decoratorsBefore(
  scanned: ScannedSource,
  statements: readonly Statement[],
  index: number
): { text: string; start: number }[] {
  const header = statements[index];
  const decorators: { text: string; start: number }[] = [];
  for (let previous = index - 1; previous >= 0; previous--) {
    const statement = statements[previous];
    const text = scanned.masked.slice(statement.start, statement.end).trimStart();
    if (statement.indent !== header.indent || !text.startsWith("@")) {
      break;
    }
    const at = scanned.masked.indexOf("@", statement.start);
    decorators.unshift({ text: collapsed(scanned, at + 1, statement.end), start: statement.start });
  }
  return decorators;
}

/** La línea, base 1, en la que está una posición del texto. */
export function lineOf(scanned: ScannedSource, position: number): number {
  const { lines } = scanned;
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lines[middle].start <= position) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low + 1;
}
