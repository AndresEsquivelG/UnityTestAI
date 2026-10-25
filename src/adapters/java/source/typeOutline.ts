import { escapeForRegExp, findClosing, type SourceRange } from "./declarations";

/**
 * Contorno de un tipo Java: su línea de declaración y sus miembros directos.
 *
 * Complementa a `declarations.ts`, que encuentra métodos con cuerpo por su
 * nombre y deja fuera, a propósito, los constructores y los métodos sin
 * cuerpo. La ficha de la clase necesita justo eso: con qué constructores se
 * crea, qué métodos abstractos hay que implementar y la lista completa de lo
 * que la clase declara.
 *
 * Igual que allí, no es un analizador sintáctico: reconoce cada miembro por su
 * forma, sobre el código ya enmascarado. Un miembro termina en el primer `;`
 * o en la llave que cierra su bloque, contando solo lo que está fuera de
 * paréntesis.
 */

export type TypeKind = "class" | "interface" | "enum" | "record";

export interface TypeMember {
  readonly kind: "constructor" | "method" | "field" | "other";
  readonly name: string;
  readonly modifiers: readonly string[];
  /**
   * Constructores y métodos: desde el primer modificador hasta el paréntesis
   * de cierre, sin anotaciones y con los espacios colapsados. Vacía en el
   * resto.
   */
  readonly signature: string;
  /** Último nombre del tipo de retorno, sin genéricos: `Stream<T>` es `Stream`. */
  readonly returnType?: string;
  /** Interior de las llaves. Ausente en un método sin cuerpo y en un campo. */
  readonly body?: SourceRange;
  /** El miembro entero, sin sus anotaciones, hasta su `}` o su `;`. */
  readonly range: SourceRange;
}

export interface TypeOutline {
  readonly kind: TypeKind;
  readonly name: string;
  readonly modifiers: readonly string[];
  /** Modificadores, nombre, parámetros de tipo, `extends` e `implements`, sin anotaciones. */
  readonly declaration: string;
  readonly body: SourceRange;
  readonly members: readonly TypeMember[];
  /** Constantes de una enumeración, en orden. */
  readonly enumConstants: readonly string[];
}

const MODIFIERS = new Set([
  "public",
  "protected",
  "private",
  "static",
  "final",
  "abstract",
  "synchronized",
  "native",
  "strictfp",
  "default",
  "transient",
  "volatile",
  "sealed",
  "non-sealed",
]);

/** `@interface` declara una anotación, no un tipo que se pruebe. */
const TYPE_KEYWORD = String.raw`(?<![\w$.@])(class|interface|enum|record)\s+`;

const NESTED_TYPE = new RegExp(`${TYPE_KEYWORD}[A-Za-z_$]`);

/** Contornos de cada declaración de un tipo con ese nombre, anidadas incluidas. */
export function outlineTypes(masked: string, original: string, typeName: string): TypeOutline[] {
  const declaration = new RegExp(`${TYPE_KEYWORD}${escapeForRegExp(typeName)}(?![\\w$])`, "g");
  const outlines: TypeOutline[] = [];

  let match: RegExpExecArray | null;
  while ((match = declaration.exec(masked)) !== null) {
    const open = masked.indexOf("{", match.index);
    const close = open === -1 ? -1 : findClosing(masked, open, "{", "}");
    if (close === -1) {
      continue;
    }

    const kind = match[1] as TypeKind;
    const headerStart = startOfDeclaration(masked, match.index);
    const body = { start: open + 1, end: close };
    const constants =
      kind === "enum" ? readEnumConstants(masked, body) : { names: [], end: body.start };

    outlines.push({
      kind,
      name: typeName,
      modifiers: modifiersIn(masked.slice(headerStart, match.index)),
      declaration: collapse(original.slice(headerStart, open)),
      body,
      members: readMembers(masked, original, { start: constants.end, end: body.end }, typeName),
      enumConstants: constants.names,
    });
  }

  return outlines;
}

// ── Interno ────────────────────────────────────────────────────────────────

/**
 * Principio de una declaración: después del `;` o la llave anterior y de las
 * anotaciones, que no cambian qué se declara.
 */
function startOfDeclaration(masked: string, keywordIndex: number): number {
  let start = keywordIndex;
  while (start > 0 && !";{}".includes(masked[start - 1])) {
    start--;
  }
  return skipAnnotations(masked, start, keywordIndex);
}

function skipAnnotations(masked: string, from: number, limit: number): number {
  let index = from;
  for (;;) {
    while (index < limit && /\s/.test(masked[index])) {
      index++;
    }
    if (masked[index] !== "@" || masked.startsWith("@interface", index)) {
      return index;
    }
    const name = /^@\s*[\w$.]+/.exec(masked.slice(index, limit));
    if (!name) {
      return index;
    }
    index += name[0].length;

    let after = index;
    while (after < limit && /\s/.test(masked[after])) {
      after++;
    }
    if (masked[after] === "(") {
      const close = findClosing(masked, after, "(", ")");
      if (close === -1) {
        return index;
      }
      index = close + 1;
    }
  }
}

/**
 * Las constantes van antes del primer `;` del cuerpo, separadas por comas que
 * no estén dentro de sus argumentos ni de sus cuerpos.
 */
function readEnumConstants(masked: string, body: SourceRange): { names: string[]; end: number } {
  let depth = 0;
  let end = body.end;
  for (let index = body.start; index < body.end; index++) {
    const character = masked[index];
    if (character === "{" || character === "(") {
      depth++;
    } else if (character === "}" || character === ")") {
      depth--;
    } else if (character === ";" && depth === 0) {
      end = index;
      break;
    }
  }

  const names: string[] = [];
  let partStart = body.start;
  depth = 0;
  for (let index = body.start; index <= end; index++) {
    const character = masked[index];
    if (character === "{" || character === "(") {
      depth++;
    } else if (character === "}" || character === ")") {
      depth--;
    }
    if (index === end || (character === "," && depth === 0)) {
      const start = skipAnnotations(masked, partStart, index);
      const name = /^[A-Za-z_$][\w$]*/.exec(masked.slice(start, index));
      if (name) {
        names.push(name[0]);
      }
      partStart = index + 1;
    }
  }

  return { names, end: end === body.end ? body.end : end + 1 };
}

function readMembers(
  masked: string,
  original: string,
  range: SourceRange,
  typeName: string
): TypeMember[] {
  const members: TypeMember[] = [];
  let index = range.start;

  while (index < range.end) {
    const start = skipAnnotations(masked, index, range.end);
    if (start >= range.end) {
      break;
    }
    if (masked[start] === ";") {
      index = start + 1;
      continue;
    }
    const end = memberEnd(masked, start, range.end);
    members.push(readMember(masked, original, { start, end }, typeName));
    index = end;
  }

  return members;
}

/**
 * Fin de un miembro. Un `=` fuera de paréntesis es el inicializador de un
 * campo, que puede traer llaves —un arreglo, una lambda, una clase anónima—
 * antes de su `;`.
 */
function memberEnd(masked: string, start: number, limit: number): number {
  let parens = 0;
  let initializer = false;
  let braces = 0;

  for (let index = start; index < limit; index++) {
    const character = masked[index];
    if (character === "(") {
      parens++;
    } else if (character === ")") {
      parens--;
    } else if (parens > 0) {
      continue;
    } else if (initializer) {
      if (character === "{") {
        braces++;
      } else if (character === "}") {
        braces--;
      } else if (character === ";" && braces === 0) {
        return index + 1;
      }
    } else if (character === "=") {
      initializer = true;
    } else if (character === ";") {
      return index + 1;
    } else if (character === "{") {
      const close = findClosing(masked, index, "{", "}");
      return close === -1 ? limit : close + 1;
    }
  }
  return limit;
}

function readMember(
  masked: string,
  original: string,
  range: SourceRange,
  typeName: string
): TypeMember {
  let parens = 0;
  let headerEnd = range.end;
  let terminator = "";
  for (let index = range.start; index < range.end; index++) {
    const character = masked[index];
    if (character === "(") {
      parens++;
    } else if (character === ")") {
      parens--;
    } else if (parens === 0 && (character === "{" || character === ";" || character === "=")) {
      headerEnd = index;
      terminator = character;
      break;
    }
  }

  const header = masked.slice(range.start, headerEnd);
  const paren = header.indexOf("(");
  const other = (name = ""): TypeMember => ({
    kind: "other",
    name,
    modifiers: [],
    signature: "",
    range,
  });

  if (NESTED_TYPE.test(header)) {
    return other();
  }

  // Un campo: sin paréntesis, o con un inicializador que puede llamar a algo.
  if (terminator === "=" || (terminator === ";" && paren === -1)) {
    const firstDeclarator = withoutGenerics(header).split(",")[0];
    const name = /([A-Za-z_$][\w$]*)\s*(?:\[\s*\]\s*)*$/.exec(firstDeclarator.trim());
    return {
      kind: "field",
      name: name?.[1] ?? "",
      modifiers: modifiersIn(firstDeclarator),
      signature: "",
      range,
    };
  }

  // Un bloque sin paréntesis es un inicializador o el constructor compacto de
  // un registro.
  if (paren === -1 || (terminator !== "{" && terminator !== ";")) {
    return other();
  }

  const beforeParen = header.slice(0, paren);
  const nameMatch = /([A-Za-z_$][\w$]*)\s*$/.exec(beforeParen);
  if (!nameMatch) {
    return other();
  }
  const name = nameMatch[1];
  const words = withoutGenerics(beforeParen.slice(0, nameMatch.index))
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const modifiers = words.filter((word) => MODIFIERS.has(word));
  const typeWords = words.filter((word) => !MODIFIERS.has(word));

  const parenOpen = range.start + paren;
  const parenClose = findClosing(masked, parenOpen, "(", ")");
  if (parenClose === -1) {
    return other(name);
  }

  const isConstructor = typeWords.length === 0 && name === typeName;
  return {
    kind: isConstructor ? "constructor" : "method",
    name,
    modifiers,
    signature: collapse(original.slice(range.start, parenClose + 1)),
    ...(isConstructor ? {} : { returnType: typeWords[typeWords.length - 1]?.replace(/\[\]/g, "") }),
    ...(terminator === "{" ? { body: { start: headerEnd + 1, end: range.end - 1 } } : {}),
    range,
  };
}

function modifiersIn(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => MODIFIERS.has(word));
}

/** Quita los argumentos de tipo, anidados o no: `Map<String, List<T>>` queda `Map`. */
function withoutGenerics(text: string): string {
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<[^<>]*>/g, "");
  } while (current !== previous);
  return current;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
