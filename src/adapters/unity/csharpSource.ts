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
 * Espacio de nombres que envuelve una posición, ya enmascarado el código, con
 * los anidados unidos: dentro de `namespace A { namespace B.C { ... } }` da
 * `A.B.C`. La cadena vacía significa que no hay ninguno.
 *
 * `line` y `column` son base 1, como en `MethodDeclaration`.
 */
export function findEnclosingNamespace(masked: string, line: number, column: number): string {
  const position = computeLineOffsets(masked)[line - 1] + column - 1;
  const declaration = /\bnamespace\s+([^\s{;]+)\s*\{/g;

  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(masked)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(masked, open, "{", "}");
    if (open < position && position < close) {
      names.push(match[1]);
    }
  }
  return names.join(".");
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

/** Desplazamiento de una posición con línea y columna base 1. */
export function offsetOfPosition(source: string, line: number, column: number): number {
  return computeLineOffsets(source)[line - 1] + column - 1;
}

// ── Forma de los tipos ─────────────────────────────────────────────────────

export type TypeKind = "class" | "struct" | "interface" | "enum" | "record";

export interface TypeDeclaration {
  readonly name: string;
  readonly kind: TypeKind;
  readonly modifiers: readonly string[];
  /** Lo que hereda o implementa, sin genéricos ni calificación. */
  readonly bases: readonly string[];
  /** Comienzo de la declaración, en sus modificadores. */
  readonly start: number;
  readonly body: SourceRange;
  /** Tipos que pide con `[RequireComponent]`, sin calificación. */
  readonly requiredComponents: readonly string[];
}

export interface ConstructorDeclaration {
  readonly signature: string;
  readonly extent: SourceRange;
}

export interface MethodMatch {
  readonly declaration: MethodDeclaration;
  readonly extent: SourceRange;
}

/**
 * Palabras que pueden seguir a `class` o `struct` sin ser un nombre, como en
 * las restricciones `where T : class` seguidas de otra cláusula `where`.
 */
export const NOT_A_TYPE_NAME: ReadonlySet<string> = new Set(["where", "new", "unmanaged", "notnull"]);

const TYPE_HEADER = new RegExp(
  String.raw`(?<![\w.])((?:(?:public|private|protected|internal|static|sealed|abstract|partial|unsafe|new)\s+)*)` +
    String.raw`(class|struct|interface|enum|record)\s+(?:(?:class|struct)\s+)?([A-Za-z_]\w*)`,
  "g"
);

/** Todos los tipos declarados en un código ya enmascarado, también los anidados. */
export function findTypeDeclarations(masked: string): TypeDeclaration[] {
  const declarations: TypeDeclaration[] = [];
  for (const match of masked.matchAll(TYPE_HEADER)) {
    const [text, modifiers, kind, name] = match;
    if (NOT_A_TYPE_NAME.has(name)) {
      continue;
    }
    const start = match.index ?? 0;
    const afterName = start + text.length;
    const open = masked.indexOf("{", afterName);
    if (open === -1) {
      continue;
    }
    // Un `;` antes de la llave es un `record` sin cuerpo, no una declaración con él.
    const header = masked.slice(afterName, open);
    const close = header.includes(";") ? -1 : findClosing(masked, open, "{", "}");
    if (close === -1) {
      continue;
    }
    declarations.push({
      name,
      kind: kind as TypeKind,
      modifiers: modifiers.trim().split(/\s+/).filter(Boolean),
      bases: readBases(header),
      start,
      body: { start: open + 1, end: close },
      requiredComponents: readRequiredComponents(masked, start),
    });
  }
  return declarations;
}

function readBases(header: string): string[] {
  const clause = header.replace(/\bwhere\b[\s\S]*$/, "");
  const colon = clause.indexOf(":");
  if (colon === -1) {
    return [];
  }
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of clause.slice(colon + 1)) {
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    depth += character === "<" || character === "(" ? 1 : character === ">" || character === ")" ? -1 : 0;
    current += character;
  }
  parts.push(current);
  return parts.map(unqualified).filter(Boolean);
}

/** `A.B<C>` da `B`; también corta los argumentos de un constructor primario. */
function unqualified(type: string): string {
  const name = type.replace(/[<(][\s\S]*$/, "").trim();
  return name.slice(name.lastIndexOf(".") + 1);
}

/** Los atributos están entre el final de la sentencia anterior y la declaración. */
function readRequiredComponents(masked: string, start: number): string[] {
  const from =
    Math.max(
      masked.lastIndexOf(";", start),
      masked.lastIndexOf("{", start),
      masked.lastIndexOf("}", start)
    ) + 1;
  const attributes = masked.slice(from, start);

  const required: string[] = [];
  for (const attribute of attributes.matchAll(/RequireComponent\s*\(((?:[^()]|\([^()]*\))*)\)/g)) {
    for (const type of attribute[1].matchAll(/typeof\s*\(\s*([\w.]+)\s*\)/g)) {
      required.push(unqualified(type[1]));
    }
  }
  return required;
}

/** Constructores de instancia de un tipo: el estático no lo llama nadie. */
export function findConstructors(
  masked: string,
  original: string,
  body: SourceRange,
  typeName: string
): ConstructorDeclaration[] {
  const pattern = new RegExp(
    String.raw`^\s*(?:\[[^\]]*\]\s*)*((?:(?:public|private|protected|internal|static|unsafe|extern)\s+)*)` +
      `${escapeForRegExp(typeName)}` +
      String.raw`\s*\(`
  );

  const constructors: ConstructorDeclaration[] = [];
  for (const line of splitLines(masked, body)) {
    if (line.depth > 0) {
      continue;
    }
    const text = masked.slice(line.start, line.end);
    const match = pattern.exec(text);
    if (!match || /\bstatic\b/.test(match[1])) {
      continue;
    }
    const parenClose = findClosing(masked, line.start + match[0].length - 1, "(", ")");
    if (parenClose === -1) {
      continue;
    }

    const rest = masked.slice(parenClose + 1, parenClose + 256);
    const after = rest.trimStart();
    if (!after.startsWith("{") && !after.startsWith(":") && !after.startsWith("=>")) {
      continue;
    }

    // Lo que se le pasa a `base(...)` puede traer llaves: el cuerpo va después.
    let beforeBody = parenClose;
    if (after.startsWith(":")) {
      const initializer = masked.indexOf("(", parenClose + 1);
      const initializerClose = initializer === -1 ? -1 : findClosing(masked, initializer, "(", ")");
      beforeBody = initializerClose === -1 ? parenClose : initializerClose;
    }

    const start = line.start + (text.length - text.trimStart().length);
    constructors.push({
      signature: original.slice(start, parenClose + 1).replace(/\s+/g, " ").trim(),
      extent: { start, end: bodyEnd(masked, beforeBody) },
    });
  }
  return constructors;
}

/** Las declaraciones `abstract` directas de un tipo, tal como están escritas. */
export function findAbstractMembers(masked: string, body: SourceRange): string[] {
  const members: string[] = [];
  let depth = 0;
  let statementStart = body.start;

  const close = (end: number) => {
    const statement = masked
      .slice(statementStart, end)
      .replace(/^\s*#.*$/gm, "")
      .replace(/^(?:\s*\[[^\]]*\])+/, "")
      .replace(/\s+/g, " ")
      .trim();
    const head = statement.split("{")[0];
    if (/\babstract\b/.test(head) && !/\b(?:class|struct|interface|record)\b/.test(head)) {
      members.push(statement);
    }
    statementStart = end;
  };

  for (let index = body.start; index < body.end; index++) {
    const character = masked[index];
    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0) {
        close(index + 1);
      }
    } else if (character === ";" && depth === 0) {
      close(index + 1);
    }
  }
  return members;
}

const MEMBER_DECLARATION =
  /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|readonly|const|volatile|virtual|override|sealed|abstract|new|unsafe)\s+)*([A-Za-z_][\w.]*(?:<[^;=(){}]*>)?(?:\[[,\s]*\])*\??)\s+([A-Za-z_]\w*)\s*(?:=|;|\{|,)/;

/** El tipo declarado de cada campo y propiedad directa de un tipo. */
export function findMemberTypes(masked: string, body: SourceRange): Map<string, string> {
  const types = new Map<string, string>();
  for (const line of splitLines(masked, body)) {
    if (line.depth > 0) {
      continue;
    }
    const match = MEMBER_DECLARATION.exec(masked.slice(line.start, line.end));
    if (match) {
      types.set(match[2], match[1]);
    }
  }
  return types;
}

/** Cada declaración de un método, con su firma y su extensión. */
export function findMethods(
  masked: string,
  original: string,
  range: SourceRange,
  methodName: string
): MethodMatch[] {
  return scanMethods(masked, original, range, methodName, 0);
}

/** Métodos estáticos que devuelven el tipo: la manera de crearlo si no hay `new`. */
export function findStaticFactories(
  masked: string,
  original: string,
  body: SourceRange,
  typeName: string
): string[] {
  const pattern = new RegExp(
    String.raw`^\s*(?:(?:public|private|protected|internal|unsafe)\s+)*static\s+(?:(?:unsafe|async)\s+)*` +
      `${escapeForRegExp(typeName)}` +
      String.raw`\s+[A-Za-z_]\w*\s*\(`
  );

  const factories: string[] = [];
  for (const line of splitLines(masked, body)) {
    const text = masked.slice(line.start, line.end);
    const match = line.depth === 0 ? pattern.exec(text) : null;
    if (!match) {
      continue;
    }
    const parenClose = findClosing(masked, line.start + match[0].length - 1, "(", ")");
    if (parenClose !== -1) {
      const start = line.start + (text.length - text.trimStart().length);
      factories.push(original.slice(start, parenClose + 1).replace(/\s+/g, " ").trim());
    }
  }
  return factories;
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
