/**
 * Enmascarado de comentarios y textos de Python.
 *
 * Es lo primero que hace cualquier lectura del adaptador, como en Java: sin
 * esto, un comentario o un texto con la forma de una declaración se tomaría
 * por una. Devuelve dos copias del código con la misma longitud y los mismos
 * saltos de línea, así que una posición encontrada en cualquiera de las dos
 * vale sobre el original:
 *
 *   · `code` tiene los comentarios tapados con espacios y los textos como
 *     están. De ella salen las firmas, que pueden tener un texto como valor
 *     por defecto (`sep=","`);
 *   · `masked` tiene además el interior de cada texto tapado, pero conserva sus
 *     comillas. Es donde se buscan las declaraciones y las llamadas.
 *
 * Las comillas se conservan porque en Python un texto puede ser una
 * instrucción entera: un método cuyo cuerpo es solo su documentación quedaría,
 * con todo tapado, sin ninguna línea, y su final no se podría ubicar.
 *
 * A diferencia de Java, un bloque no se cierra con una llave sino cuando la
 * sangría vuelve atrás. Para eso hay que saber qué líneas empiezan una
 * instrucción y cuáles continúan la anterior: las que empiezan dentro de un
 * texto de triple comilla, dentro de un paréntesis abierto o después de una
 * barra invertida. Su sangría no cuenta, y eso también sale de aquí.
 */

export interface SourceLine {
  /** Posición del primer carácter de la línea. */
  readonly start: number;
  /** Posición del final de la línea, sin el salto («\r\n» o «\n»). */
  readonly end: number;
  /** La línea continúa una instrucción anterior y su sangría no cuenta. */
  readonly continuation: boolean;
}

export interface ScannedSource {
  readonly code: string;
  readonly masked: string;
  readonly lines: readonly SourceLine[];
}

const OPENING = new Set(["(", "[", "{"]);
const CLOSING = new Set([")", "]", "}"]);

/** Prefijos de un texto: `r`, `b`, `u`, `f`, `t` y sus combinaciones de dos. */
const STRING_START = /^([rRbBuUfFtT]{0,2})(['"])/;

export function scanPythonSource(source: string): ScannedSource {
  const code = source.split("");
  const masked = source.split("");
  const continuations = new Set<number>();

  let depth = 0;
  let i = 0;

  const blank = (target: string[], from: number, to: number) => {
    for (let index = from; index < to && index < target.length; index++) {
      if (target[index] !== "\n" && target[index] !== "\r") {
        target[index] = " ";
      }
    }
  };

  // Toda línea que empieza dentro de un texto continúa la instrucción.
  const markInside = (from: number, to: number) => {
    for (let index = from; index < to; index++) {
      if (source[index] === "\n") {
        continuations.add(index + 1);
      }
    }
  };

  while (i < source.length) {
    const current = source[i];

    if (current === "#") {
      const end = endOfLine(source, i);
      blank(code, i, end);
      blank(masked, i, end);
      i = end;
      continue;
    }

    const literal = stringAt(source, i);
    if (literal) {
      blank(masked, literal.contentStart, literal.contentEnd);
      // El prefijo tampoco es código: `rb` delante de una comilla no es un nombre.
      blank(masked, i, i + literal.prefixLength);
      markInside(i, literal.end);
      i = literal.end;
      continue;
    }

    if (current === "\\" && isLineBreakAt(source, i + 1)) {
      const newline = source[i + 1] === "\r" ? i + 2 : i + 1;
      continuations.add(newline + 1);
      i = newline + 1;
      continue;
    }

    if (OPENING.has(current)) {
      depth++;
    } else if (CLOSING.has(current)) {
      depth = Math.max(0, depth - 1);
    } else if (current === "\n" && depth > 0) {
      continuations.add(i + 1);
    }
    i++;
  }

  return {
    code: code.join(""),
    masked: masked.join(""),
    lines: splitLines(source, continuations),
  };
}

interface StringLiteral {
  readonly prefixLength: number;
  /** Primer carácter después de las comillas de apertura. */
  readonly contentStart: number;
  /** Primer carácter de las comillas de cierre. */
  readonly contentEnd: number;
  /** Primer carácter después del texto. */
  readonly end: number;
}

/**
 * El texto que empieza en `index`, si empieza uno. Un prefijo solo cuenta si
 * no es el final de un nombre: en `nombre"…"`, que no es Python válido, `e` no
 * es un prefijo.
 */
function stringAt(source: string, index: number): StringLiteral | null {
  if (index > 0 && /[\p{L}\p{N}_]/u.test(source[index - 1])) {
    return null;
  }
  const start = STRING_START.exec(source.slice(index, index + 3));
  if (!start) {
    return null;
  }

  const prefix = start[1];
  const quote = start[2];
  const opening = index + prefix.length;
  const triple = source.startsWith(quote.repeat(3), opening);
  const delimiter = triple ? quote.repeat(3) : quote;
  const contentStart = opening + delimiter.length;
  const formatted = /[fFtT]/.test(prefix);

  const contentEnd = findClosingQuote(source, contentStart, delimiter, triple, formatted);
  const closed = source.startsWith(delimiter, contentEnd);
  return {
    prefixLength: prefix.length,
    contentStart,
    contentEnd,
    end: closed ? contentEnd + delimiter.length : contentEnd,
  };
}

/**
 * Dónde empiezan las comillas de cierre. Una barra invertida salta el carácter
 * siguiente, también en un texto crudo: `r"\""` es un texto de dos caracteres.
 * Al final de la línea salta el salto entero, que en Windows son dos
 * caracteres: sin eso, un texto que sigue en la línea de abajo (`"uno\` y
 * `dos"`) se cerraba en el `\n`, y todo lo que venía después quedaba al revés.
 * Un texto de una comilla sin cerrar termina con la línea, como lo trata
 * Python al dar el error.
 *
 * En un texto con formato, las llaves encierran código, y desde Python 3.12 ese
 * código puede tener sus propios textos con las mismas comillas:
 * `f"{datos["clave"]}"`. Se recorre como código hasta la llave que lo cierra.
 * Ahí una barra invertida no escapa una llave: `fr"\{{"` es una barra y una
 * llave literal.
 */
function findClosingQuote(
  source: string,
  from: number,
  delimiter: string,
  triple: boolean,
  formatted: boolean
): number {
  let i = from;
  while (i < source.length) {
    const current = source[i];

    if (current === "\\") {
      const next = source[i + 1];
      if (formatted && (next === "{" || next === "}")) {
        i += 1;
      } else if (next === "\r" && source[i + 2] === "\n") {
        i += 3;
      } else {
        i += 2;
      }
      continue;
    }
    if (source.startsWith(delimiter, i)) {
      return i;
    }
    if (!triple && current === "\n") {
      return i;
    }
    if (formatted && current === "{") {
      if (source[i + 1] === "{") {
        i += 2;
        continue;
      }
      i = endOfReplacementField(source, i + 1);
      continue;
    }
    i++;
  }
  return source.length;
}

/** Primer carácter después de la llave que cierra el código de un texto con formato. */
function endOfReplacementField(source: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < source.length) {
    const literal = stringAt(source, i);
    if (literal) {
      i = literal.end;
      continue;
    }
    const current = source[i];
    if (OPENING.has(current)) {
      depth++;
    } else if (CLOSING.has(current)) {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
    i++;
  }
  return source.length;
}

function splitLines(source: string, continuations: ReadonlySet<number>): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start <= source.length) {
    const newline = source.indexOf("\n", start);
    const lineEnd = newline === -1 ? source.length : newline;
    const end = lineEnd > start && source[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    lines.push({ start, end, continuation: continuations.has(start) });
    if (newline === -1) {
      break;
    }
    start = newline + 1;
  }
  return lines;
}

function endOfLine(source: string, from: number): number {
  const newline = source.indexOf("\n", from);
  const end = newline === -1 ? source.length : newline;
  return end > from && source[end - 1] === "\r" ? end - 1 : end;
}

function isLineBreakAt(source: string, index: number): boolean {
  return source[index] === "\n" || (source[index] === "\r" && source[index + 1] === "\n");
}
