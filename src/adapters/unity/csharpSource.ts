/**
 * Lectura léxica de código C#.
 *
 * Es conocimiento del lenguaje y no del motor: todo lo que hay aquí vale igual
 * para un proyecto Unity que para cualquier otro proyecto C#. Vive dentro del
 * adaptador porque hoy Unity es el único que lo necesita; el día que exista un
 * segundo ecosistema C# se comparte sin tocar el núcleo.
 *
 * No es un analizador sintáctico: reconoce declaraciones por su forma. Lo que
 * sí garantiza es no confundir una declaración con una invocación, que es el
 * defecto de `checkSymbols`, donde `\b<método>\s*\(` con la bandera de
 * insensibilidad a mayúsculas casa también con cualquier llamada.
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
  /** Declaración completa hasta el paréntesis de cierre, con espacios colapsados. */
  readonly signature: string;
}

/** Palabras que pueden preceder al tipo de retorno en una declaración. */
const MODIFIERS =
  "public|private|protected|internal|static|virtual|override|sealed|abstract|async|extern|unsafe|new|partial|readonly";

/**
 * Devuelve una copia del código en la que los comentarios y los literales de
 * cadena están sustituidos por espacios, conservando la longitud total y los
 * saltos de línea.
 *
 * Con eso, las llaves y los identificadores que aparecen dentro de un texto o
 * de un comentario dejan de contarse como código, y las posiciones siguen
 * siendo válidas sobre el original.
 */
export function maskCommentsAndStrings(source: string): string {
  const characters = source.split("");

  const blank = (from: number, to: number) => {
    for (let index = from; index < to && index < characters.length; index++) {
      if (characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
      }
    }
  };

  let i = 0;
  while (i < source.length) {
    const current = source[i];
    const next = source[i + 1];

    if (current === "/" && next === "/") {
      let end = i + 2;
      while (end < source.length && source[end] !== "\n") {
        end++;
      }
      blank(i, end);
      i = end;
      continue;
    }

    if (current === "/" && next === "*") {
      let end = i + 2;
      while (end < source.length && !(source[end] === "*" && source[end + 1] === "/")) {
        end++;
      }
      end = Math.min(end + 2, source.length);
      blank(i, end);
      i = end;
      continue;
    }

    // Cadena textual: @"...", donde la comilla se escapa duplicándola.
    if (current === "@" && next === '"') {
      let end = i + 2;
      while (end < source.length) {
        if (source[end] === '"') {
          if (source[end + 1] === '"') {
            end += 2;
            continue;
          }
          break;
        }
        end++;
      }
      end = Math.min(end + 1, source.length);
      blank(i, end);
      i = end;
      continue;
    }

    if (current === '"' || current === "'") {
      let end = i + 1;
      while (end < source.length && source[end] !== current && source[end] !== "\n") {
        end += source[end] === "\\" ? 2 : 1;
      }
      end = Math.min(end + 1, source.length);
      blank(i, end);
      i = end;
      continue;
    }

    i++;
  }

  return characters.join("");
}

/**
 * Cuerpos de las declaraciones de un tipo, ya enmascarado el código.
 *
 * Devuelve más de uno cuando el tipo es parcial y está repartido en varias
 * declaraciones dentro del mismo archivo.
 */
export function findTypeBodies(masked: string, typeName: string): SourceRange[] {
  const declaration = new RegExp(
    String.raw`\b(?:class|struct|record|interface)\s+${escapeForRegExp(typeName)}\b`,
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
 * Declaraciones de un método dentro de un rango.
 *
 * `maxDepth` es la profundidad de llaves, relativa al rango, a la que se acepta
 * una declaración. Con 0 solo se aceptan los miembros directos del tipo, de
 * modo que una función local declarada dentro de otro método no se confunde con
 * un método de la clase.
 *
 * Quedan fuera, por ahora, los constructores —no llevan tipo de retorno— y las
 * declaraciones sin cuerpo de los métodos abstractos y de las interfaces.
 */
export function findMethodDeclarations(
  masked: string,
  original: string,
  range: SourceRange,
  methodName: string,
  maxDepth = 0
): MethodDeclaration[] {
  return scanMethods(masked, original, range, methodName, maxDepth).map(
    (method) => method.declaration
  );
}

/**
 * Extensión de cada declaración de un método, desde el comienzo de la
 * declaración hasta el final del cuerpo, con las mismas reglas que
 * `findMethodDeclarations`. Un cuerpo de expresión (`=>`) termina en el
 * primer `;`.
 */
export function findMethodExtents(
  masked: string,
  original: string,
  range: SourceRange,
  methodName: string,
  maxDepth = 0
): SourceRange[] {
  return scanMethods(masked, original, range, methodName, maxDepth).map(
    (method) => method.extent
  );
}

function scanMethods(
  masked: string,
  original: string,
  range: SourceRange,
  methodName: string,
  maxDepth: number
): { declaration: MethodDeclaration; extent: SourceRange }[] {
  const name = escapeForRegExp(methodName);
  const pattern = new RegExp(
    // Ni pegado a un punto ni a otro identificador: eso sería una invocación.
    String.raw`(?:^|[^\w.])` +
      String.raw`(?:(?:${MODIFIERS})\s+)*` +
      // Tipo de retorno, que puede llevar genéricos, arreglos y espacios.
      String.raw`[A-Za-z_@][\w.<>\[\],?\s]*?\s+` +
      `(${name})` +
      String.raw`\s*\(`
  );

  const declarations: { declaration: MethodDeclaration; extent: SourceRange }[] = [];
  const lineOffsets = computeLineOffsets(original);

  for (const line of splitLines(masked, range)) {
    if (line.depth > maxDepth) {
      continue;
    }

    const text = masked.slice(line.start, line.end);
    const match = pattern.exec(text);
    if (!match) {
      continue;
    }

    const nameIndex = line.start + match.index + match[0].lastIndexOf(methodName);
    const parenOpen = masked.indexOf("(", nameIndex + methodName.length);
    if (parenOpen === -1) {
      continue;
    }

    const parenClose = findClosing(masked, parenOpen, "(", ")");
    if (parenClose === -1) {
      continue;
    }

    // Una declaración continúa con el cuerpo, con una expresión o con una
    // restricción de tipo genérico. Una invocación termina en `;` o en otro
    // operador, y así queda descartada.
    const after = masked.slice(parenClose + 1, parenClose + 512).replace(/^\s+/, "");
    if (!(after.startsWith("{") || after.startsWith("=>") || /^where\b/.test(after))) {
      continue;
    }

    const declarationStart = line.start + (text.length - text.replace(/^\s+/, "").length);
    declarations.push({
      declaration: {
        line: lineNumberAt(lineOffsets, nameIndex),
        column: nameIndex - lineOffsets[lineNumberAt(lineOffsets, nameIndex) - 1] + 1,
        signature: original.slice(declarationStart, parenClose + 1).replace(/\s+/g, " ").trim(),
      },
      extent: { start: declarationStart, end: bodyEnd(masked, parenClose) },
    });
  }

  return declarations;
}

/** Final del cuerpo de un método cuya lista de parámetros cierra en `parenClose`. */
function bodyEnd(masked: string, parenClose: number): number {
  const open = masked.indexOf("{", parenClose + 1);
  const arrow = masked.indexOf("=>", parenClose + 1);

  if (arrow !== -1 && (open === -1 || arrow < open)) {
    const semicolon = masked.indexOf(";", arrow);
    return semicolon === -1 ? masked.length : semicolon + 1;
  }
  if (open === -1) {
    return parenClose + 1;
  }
  const close = findClosing(masked, open, "{", "}");
  return close === -1 ? masked.length : close + 1;
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

function findClosing(masked: string, openIndex: number, open: string, close: string): number {
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
