import type { UnitTarget } from "../../../core/contracts";
import { findClosing, type SourceRange } from "../source/declarations";
import { maskCommentsAndLiterals } from "../source/masking";
import { outlineTypes, type TypeMember, type TypeOutline } from "../source/typeOutline";

/**
 * OP-18 — Ficha de la clase bajo prueba, leída del código.
 *
 * Existe porque los agentes deciden sobre lo que ven, y lo que ven puede venir
 * recortado o mal resumido por otro modelo. En la prueba de
 * `AbstractDocument.put` el recortador quitó todos los métodos menos `put`, el
 * analizador llamó «concreta» a una clase abstracta, el generador lo obedeció
 * y el corrector, al pasar a una subclase anónima, inventó un método para
 * sobrescribir. Nada de eso hace falta adivinarlo: está escrito en el archivo.
 *
 * La ficha dice tres cosas que un modelo no puede cambiar: cómo se crea una
 * instancia, la lista completa de métodos que la clase declara y qué métodos
 * de la clase llama el método bajo prueba, con el código de los privados
 * porque son parte de la unidad. Va en inglés, como las plantillas.
 */

/** Líneas de cuerpo que se muestran de un método no privado que el objetivo llama. */
const SHORT_BODY_LINES = 12;

/** Líneas de cuerpo que se muestran como máximo de cualquier método. */
const MAX_BODY_LINES = 40;

/** Métodos listados como máximo: una clase enorme no puede llenar el prompt. */
const MAX_LISTED_METHODS = 40;

/** Métodos privados que se siguen como máximo, contando los que llaman ellos. */
const MAX_FOLLOWED = 10;

/** Palabras seguidas de paréntesis que no son una llamada a un método. */
const NOT_A_CALL = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "synchronized",
  "return",
  "throw",
  "new",
  "super",
  "this",
  "assert",
  "else",
  "do",
  "try",
  "yield",
  "case",
  "instanceof",
]);

/**
 * La ficha de `target` en el archivo `code`, o la cadena vacía si en ese
 * archivo no está la clase o no declara el método con cuerpo.
 */
export function describeJavaUnit(code: string, target: UnitTarget): string {
  const { className, methodName } = target;
  if (className === null) {
    return "";
  }

  const masked = maskCommentsAndLiterals(code);
  // La misma elección que el pipeline: la primera declaración con cuerpo.
  for (const outline of outlineTypes(masked, code, className)) {
    const unit = outline.members.find(
      (member) => member.kind === "method" && member.name === methodName && member.body
    );
    if (unit) {
      return formatFacts(code, outline, unit, readCalls(masked, outline, unit));
    }
  }
  return "";
}

// ── Llamadas ───────────────────────────────────────────────────────────────

interface Calls {
  /** Métodos de la clase que llama la unidad, o un privado que ella llama. */
  readonly members: readonly TypeMember[];
  /** Nombres llamados sin calificar que la clase no declara. */
  readonly undeclared: readonly string[];
}

/**
 * Métodos de la clase que llama la unidad. Los privados se siguen: lo que ellos
 * llaman también es parte de lo que hace la unidad.
 */
function readCalls(masked: string, outline: TypeOutline, unit: TypeMember): Calls {
  const members: TypeMember[] = [];
  const undeclared: string[] = [];
  const seen = new Set<string>();
  const pending: SourceRange[] = [unit.body!];
  let followed = 0;

  while (pending.length > 0) {
    const body = pending.shift()!;
    for (const name of calledNames(masked, body, outline.name)) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);

      // Con el nombre de la unidad, lo que interesa son sus otras sobrecargas:
      // una llamada a sí misma no agrega nada.
      const declared = outline.members.filter(
        (member) => member.kind === "method" && member.name === name && member !== unit
      );
      if (declared.length === 0) {
        if (name !== unit.name) {
          undeclared.push(name);
        }
        continue;
      }
      for (const member of declared) {
        members.push(member);
        if (member.body && isPrivate(member) && followed < MAX_FOLLOWED) {
          followed++;
          pending.push(member.body);
        }
      }
    }
  }

  return { members, undeclared };
}

/**
 * Nombres que el cuerpo llama sin calificar, o calificados con `this` o con la
 * propia clase, en orden de aparición. Una llamada sobre otro objeto
 * (`items.add(x)`) es de ese objeto y no cuenta.
 */
function calledNames(masked: string, body: SourceRange, className: string): string[] {
  const text = masked.slice(body.start, body.end);
  const names: string[] = [];
  const call = /([A-Za-z_$][\w$]*)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = call.exec(text)) !== null) {
    const name = match[1];
    if (NOT_A_CALL.has(name)) {
      continue;
    }
    const before = text.slice(0, match.index).trimEnd();
    if (before.endsWith(".")) {
      const qualifier = /([A-Za-z_$][\w$]*)\s*$/.exec(before.slice(0, -1).trimEnd());
      if (qualifier?.[1] !== "this" && qualifier?.[1] !== className) {
        continue;
      }
    } else if (/(?:^|[^\w$])new$/.test(before)) {
      continue;
    }

    // Seguido de un cuerpo es la declaración de un método de una clase
    // anónima o local, no una llamada.
    const open = body.start + match.index + match[0].length - 1;
    const close = findClosing(masked, open, "(", ")");
    if (close !== -1 && /^\s*(?:throws\s[^;{}()]*)?\{/.test(masked.slice(close + 1, close + 256))) {
      continue;
    }
    names.push(name);
  }

  // Referencias a métodos: this::ayudante o Clase::ayudante.
  const reference = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*::\s*([A-Za-z_$][\w$]*)/g;
  while ((match = reference.exec(text)) !== null) {
    if (match[1] === "this" || match[1] === className) {
      names.push(match[2]);
    }
  }

  return [...new Set(names)];
}

// ── Formato ────────────────────────────────────────────────────────────────

function formatFacts(code: string, outline: TypeOutline, unit: TypeMember, calls: Calls): string {
  const className = outline.name;
  const methods = outline.members.filter((member) => member.kind === "method");
  const constructors = outline.members.filter((member) => member.kind === "constructor");
  const abstractMethods = methods.filter((member) => isAbstract(member, outline));

  const lines = [
    "━━ CLASS FACTS — read from the source code by the tool, not by a language model ━━",
    `These facts about \`${className}\` are exact. Where anything else in this prompt disagrees with them — the PRE-FLIGHT CHECKLIST, the code analysis or a sliced context — follow these facts.`,
    "",
    `Declaration: ${outline.declaration}`,
    `Kind: ${kindLabel(outline)}`,
  ];

  if (outline.kind === "class" || outline.kind === "interface") {
    lines.push(
      abstractMethods.length === 0
        ? `Abstract methods declared in ${className}: none.`
        : `Abstract methods declared in ${className}:`
    );
    lines.push(...abstractMethods.map((member) => `  ${member.signature}`));
  }

  if (outline.kind === "class") {
    if (constructors.length === 0) {
      lines.push("Constructors: none declared — Java provides an implicit no-argument constructor.");
    } else {
      lines.push("Constructors:", ...constructors.map((member) => `  ${member.signature}`));
    }
  }

  lines.push("", "How to create an instance:", `  ${instantiation(outline, unit, abstractMethods)}`);
  const heritage = /\b(?:extends|implements)\s.*$/.exec(outline.declaration)?.[0];
  if (heritage && outline.kind === "class" && outline.modifiers.includes("abstract")) {
    lines.push(
      `  Abstract methods that ${className} inherits (${heritage}) are not listed here: if the compiler reports one as not implemented, implement exactly that one.`
    );
  }

  lines.push("", `The method under test: ${unit.signature}`);
  if (isPrivate(unit)) {
    lines.push(
      `  It is private: call it through reflection — getDeclaredMethod("${unit.name}", <its exact parameter types>) and setAccessible(true).`
    );
  }

  lines.push(
    "",
    `Methods declared in ${className} — the complete list. ${className} declares no other methods: do not invent any.`
  );
  lines.push(...methods.slice(0, MAX_LISTED_METHODS).map((member) => `  ${member.signature}`));
  if (methods.length > MAX_LISTED_METHODS) {
    lines.push(`  … and ${methods.length - MAX_LISTED_METHODS} more.`);
  }

  lines.push("", ...describeCalls(code, outline, unit, calls));
  return lines.join("\n");
}

function kindLabel(outline: TypeOutline): string {
  if (outline.kind !== "class") {
    return outline.kind;
  }
  const qualifiers = outline.modifiers.filter((word) => word === "abstract" || word === "final");
  return [...qualifiers, "class"].join(" ");
}

/** La forma exacta de conseguir una instancia, o de no necesitarla. */
function instantiation(
  outline: TypeOutline,
  unit: TypeMember,
  abstractMethods: readonly TypeMember[]
): string {
  const className = outline.name;

  if (unit.modifiers.includes("static")) {
    return `\`${unit.name}\` is static: call it as \`${className}.${unit.name}(...)\` — no instance is needed.`;
  }

  switch (outline.kind) {
    case "enum":
      return `${className} is an enum: use one of its constants (${outline.enumConstants.join(", ")}). Never write \`new ${className}(...)\`.`;

    case "record": {
      const components = recordComponents(outline);
      return `new ${className}(...) with one argument per component, in this order: (${components}).`;
    }

    case "interface":
      return abstractMethods.length === 1
        ? `${className} is an interface: use a lambda or an anonymous class that implements its single abstract method.`
        : `${className} is an interface: use an anonymous class \`new ${className}() { ... }\` that implements exactly the abstract methods listed above.`;

    case "class":
      break;
  }

  const constructors = outline.members.filter((member) => member.kind === "constructor");
  const visible = constructors.filter((member) => !isPrivate(member));
  if (constructors.length > 0 && visible.length === 0) {
    const factories = outline.members.filter(
      (member) =>
        member.kind === "method" &&
        member.modifiers.includes("static") &&
        member.returnType === className
    );
    return factories.length > 0
      ? `All constructors of ${className} are private: do not use \`new\`. Use one of its static factory methods: ${factories.map((member) => member.signature).join("; ")}.`
      : `All constructors of ${className} are private: do not use \`new\`. Use the static factory method or singleton accessor it declares.`;
  }

  const creation =
    constructors.length === 0
      ? `new ${className}()`
      : `new ${className}(<arguments for one of the constructors above>)`;

  if (!outline.modifiers.includes("abstract")) {
    return `${creation}.`;
  }
  if (abstractMethods.length === 0) {
    return `${creation} { } — an anonymous subclass with an EMPTY body. ${className} declares no abstract methods, so there is nothing to implement: do not add @Override methods to it.`;
  }
  return `${creation} { ... } — an anonymous subclass that implements exactly the abstract methods listed above, and nothing else.`;
}

function recordComponents(outline: TypeOutline): string {
  const declaration = outline.declaration;
  const name = new RegExp(`record\\s+${outline.name}\\s*(?:<[^(]*>)?\\s*\\(`).exec(declaration);
  if (!name) {
    return "";
  }
  const open = name.index + name[0].length - 1;
  const close = findClosing(declaration, open, "(", ")");
  return close === -1 ? "" : declaration.slice(open + 1, close).trim();
}

function describeCalls(
  code: string,
  outline: TypeOutline,
  unit: TypeMember,
  calls: Calls
): string[] {
  const className = outline.name;
  const lines: string[] = [];

  if (calls.members.length === 0) {
    lines.push(`Methods of ${className} that \`${unit.name}\` calls: none.`);
  } else {
    lines.push(`Methods of ${className} that \`${unit.name}\` calls:`);
    for (const member of calls.members) {
      lines.push(...describeCalled(code, member, outline, unit));
    }
  }

  if (calls.undeclared.length > 0) {
    lines.push(
      `Called by \`${unit.name}\` but not declared in ${className} (inherited from a supertype or statically imported): ${calls.undeclared.map((name) => `${name}(...)`).join(", ")}.`
    );
  }
  return lines;
}

function describeCalled(
  code: string,
  member: TypeMember,
  outline: TypeOutline,
  unit: TypeMember
): string[] {
  if (isAbstract(member, outline)) {
    return [
      `  ${member.signature} — abstract: the anonymous subclass decides what it returns. Use that to reach each branch of \`${unit.name}\`.`,
    ];
  }

  const text = code.slice(member.range.start, member.range.end);
  if (isPrivate(member)) {
    return [
      `  ${member.signature} — private, so it is part of the unit under test. Reach it through \`${unit.name}\`; never call it directly or through reflection. Its code:`,
      ...indentBody(text),
    ];
  }

  // El código se muestra para que el modelo sepa qué devuelve, no para que lo
  // copie: en la prueba de `children` el generador lo pegó en la subclase
  // anónima, y `get` lee un campo privado que la prueba no puede tocar.
  const inherited = `already implemented in ${outline.name} and runs as is: do not override it or copy its code into the test`;
  if (text.split("\n").length <= SHORT_BODY_LINES) {
    return [
      `  ${member.signature} — ${inherited} (it can use private fields the test cannot reach). Its code, for reference only:`,
      ...indentBody(text),
    ];
  }
  return [`  ${member.signature} — ${inherited}.`];
}

/**
 * El código de un miembro, sangrado bajo su firma. La primera línea empieza en
 * la firma, sin sangría; las demás traen la del archivo, y la de la llave de
 * cierre es la del miembro: esa se les quita a todas.
 */
function indentBody(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const base = leadingSpace(lines[lines.length - 1]);
  const shown = lines
    .slice(0, MAX_BODY_LINES)
    .map((line, index) =>
      `      ${index === 0 ? line : line.slice(Math.min(base, leadingSpace(line)))}`.trimEnd()
    );
  if (lines.length > MAX_BODY_LINES) {
    shown.push(`      … (${lines.length - MAX_BODY_LINES} more lines)`);
  }
  return shown;
}

function leadingSpace(line: string): number {
  return /^[ \t]*/.exec(line)?.[0].length ?? 0;
}

function isPrivate(member: TypeMember): boolean {
  return member.modifiers.includes("private");
}

/**
 * Sin cuerpo y abstracto: declarado `abstract`, o en una interfaz sin ser
 * `static`, `default` ni `private`. Un método `native` tampoco tiene cuerpo y
 * no se implementa.
 */
function isAbstract(member: TypeMember, outline: TypeOutline): boolean {
  if (member.kind !== "method" || member.body) {
    return false;
  }
  if (member.modifiers.includes("abstract")) {
    return true;
  }
  return (
    outline.kind === "interface" &&
    !["static", "default", "private", "native"].some((word) => member.modifiers.includes(word))
  );
}
