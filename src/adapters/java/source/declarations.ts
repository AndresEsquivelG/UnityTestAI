/**
 * Declaraciones de tipos y de métodos en código Java.
 *
 * No es un analizador sintáctico: reconoce las declaraciones por su forma,
 * sobre el código ya enmascarado. Lo que sí garantiza es no confundir una
 * declaración con una invocación ni con una clase anónima: una declaración
 * sigue con su cuerpo, una invocación no.
 *
 * Límites, los mismos que el adaptador de Unity: no localiza constructores
 * —no tienen tipo de retorno— ni métodos sin cuerpo, como los abstractos y los
 * de una interfaz sin `default`.
 */

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export interface MethodDeclaration {
  /** Línea de la declaración, base 1. */
  readonly line: number;
  /** Columna del nombre del método, base 1. */
  readonly column: number;
  /**
   * Declaración desde el primer modificador hasta el paréntesis de cierre, con
   * los espacios colapsados. Las anotaciones quedan fuera aunque estén en la
   * misma línea: no distinguen una sobrecarga de otra.
   */
  readonly signature: string;
}

export interface TypeDeclaration {
  readonly name: string;
  /** Posición del nombre en el código. */
  readonly nameStart: number;
}

const MODIFIERS =
  "public|protected|private|static|final|abstract|synchronized|native|strictfp|default";

/**
 * Palabras que pueden quedar delante de un nombre seguido de paréntesis sin
 * que eso sea un tipo de retorno: `new Tarea(x) { … }` es una clase anónima, y
 * `return calcular(x)` una invocación.
 */
const NOT_A_RETURN_TYPE = new Set(["new", "return", "throw", "else", "case", "yield", "assert"]);

const TYPE_KEYWORD = String.raw`(?<![\w$.])(?:class|interface|enum|record)\s+`;

/**
 * Cuerpos de las declaraciones de un tipo: clase, interfaz, enumeración o
 * registro. Un tipo anidado se encuentra igual que uno de primer nivel.
 */
export function findTypeBodies(masked: string, typeName: string): SourceRange[] {
  const declaration = new RegExp(
    `${TYPE_KEYWORD}${escapeForRegExp(typeName)}(?![\\w$])`,
    "g"
  );

  const bodies: SourceRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(masked)) !== null) {
    const open = masked.indexOf("{", match.index);
    if (open === -1) {
      continue;
    }
    const close = findClosing(masked, open, "{", "}");
    if (close === -1) {
      continue;
    }
    bodies.push({ start: open + 1, end: close });
  }
  return bodies;
}

/**
 * Primer tipo declarado fuera de toda llave: en un archivo de prueba, la clase
 * de prueba. Los tipos anidados y las clases anónimas quedan dentro de alguna.
 */
export function findTopLevelType(masked: string): TypeDeclaration | null {
  const declaration = new RegExp(`${TYPE_KEYWORD}([A-Za-z_$][\\w$]*)`, "g");
  let depth = 0;
  let scanned = 0;

  let match: RegExpExecArray | null;
  while ((match = declaration.exec(masked)) !== null) {
    depth += braceBalance(masked, scanned, match.index);
    scanned = match.index;
    if (depth === 0) {
      return { name: match[1], nameStart: match.index + match[0].length - match[1].length };
    }
  }
  return null;
}

/**
 * Declaraciones de un método dentro de un rango, una por sobrecarga.
 *
 * `maxDepth` es la profundidad de llaves, relativa al rango, a la que se acepta
 * una declaración. Con 0 solo cuentan los miembros directos del tipo: un método
 * con el mismo nombre dentro de una clase anónima o de un tipo anidado no es
 * miembro de la clase pedida.
 */
export function findMethodDeclarations(
  masked: string,
  original: string,
  range: SourceRange,
  methodName: string,
  maxDepth = 0
): MethodDeclaration[] {
  const pattern = new RegExp(
    // Ni pegado a un punto ni a otro identificador, que sería una invocación,
    // ni a una arroba, que sería el nombre de una anotación.
    String.raw`(?:^|[^\w$.@])` +
      String.raw`((?:(?:${MODIFIERS})\s+)*` +
      // Parámetros de tipo de un método genérico: <T extends Comparable<T>>.
      String.raw`(?:<[^;{}()]*?>\s*)?` +
      // Tipo de retorno, con genéricos, arreglos y nombres calificados.
      String.raw`([A-Za-z_$][\w$.<>\[\],?\s]*?))\s+` +
      `(${escapeForRegExp(methodName)})` +
      String.raw`\s*\(`,
    "d"
  );

  const declarations: MethodDeclaration[] = [];
  const lineOffsets = computeLineOffsets(original);

  for (const line of splitLines(masked, range)) {
    if (line.depth > maxDepth) {
      continue;
    }

    const match = pattern.exec(masked.slice(line.start, line.end));
    if (!match?.indices) {
      continue;
    }

    const returnType = match[2].trim().split(/\s+/).pop() ?? "";
    if (NOT_A_RETURN_TYPE.has(returnType)) {
      continue;
    }

    const declarationStart = line.start + match.indices[1][0];
    const nameIndex = line.start + match.indices[3][0];
    const parenOpen = masked.indexOf("(", nameIndex + methodName.length);
    const parenClose = findClosing(masked, parenOpen, "(", ")");
    if (parenClose === -1) {
      continue;
    }

    // Una declaración sigue con su cuerpo, quizá después de `throws`. Una
    // invocación sigue con `;` o con un operador, y un método sin cuerpo
    // termina en `;`.
    const after = masked.slice(parenClose + 1, parenClose + 512).replace(/^\s+/, "");
    if (!/^(?:throws\s[^;{}()]*)?\{/.test(after)) {
      continue;
    }

    const lineNumber = lineNumberAt(lineOffsets, nameIndex);
    declarations.push({
      line: lineNumber,
      column: nameIndex - lineOffsets[lineNumber - 1] + 1,
      signature: original.slice(declarationStart, parenClose + 1).replace(/\s+/g, " ").trim(),
    });
  }

  return declarations;
}

export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Interno ────────────────────────────────────────────────────────────────

interface BodyLine {
  readonly start: number;
  readonly end: number;
  /** Profundidad de llaves al empezar la línea, relativa al rango. */
  readonly depth: number;
}

function splitLines(masked: string, range: SourceRange): BodyLine[] {
  const lines: BodyLine[] = [];
  let depth = 0;
  let lineStart = range.start;
  let lineDepth = 0;

  for (let index = range.start; index < range.end; index++) {
    const character = masked[index];
    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
    } else if (character === "\n") {
      lines.push({ start: lineStart, end: index, depth: lineDepth });
      lineStart = index + 1;
      lineDepth = depth;
    }
  }
  lines.push({ start: lineStart, end: range.end, depth: lineDepth });

  return lines;
}

/** Llaves abiertas menos cerradas entre dos posiciones. */
function braceBalance(masked: string, from: number, to: number): number {
  let balance = 0;
  for (let index = from; index < to; index++) {
    if (masked[index] === "{") {
      balance++;
    } else if (masked[index] === "}") {
      balance--;
    }
  }
  return balance;
}

function findClosing(masked: string, openIndex: number, open: string, close: string): number {
  if (openIndex === -1) {
    return -1;
  }
  let depth = 0;
  for (let index = openIndex; index < masked.length; index++) {
    if (masked[index] === open) {
      depth++;
    } else if (masked[index] === close) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** Desplazamiento en el que empieza cada línea, base 0. */
function computeLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

/** Número de línea, base 1, del desplazamiento dado. */
function lineNumberAt(lineOffsets: number[], offset: number): number {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineOffsets[middle] <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low + 1;
}
