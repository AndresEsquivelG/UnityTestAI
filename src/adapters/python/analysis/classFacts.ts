import type { ProjectModel, SymbolCandidate, UnitTarget } from "../../../core/contracts";
import { PROJECT_ROOT, isIdentifier, moduleNameOf } from "../discovery/layout";
import { importRootOf } from "../discovery/projectModel";
import {
  ancestorsOf,
  bodyStatements,
  collapsed,
  decoratorName,
  findClasses,
  methodsOf,
  outlinePython,
  type PythonBlock,
  type PythonOutline,
  type SourceRange,
} from "../source/declarations";

/**
 * OP-18 — Ficha de la clase bajo prueba, leída del código.
 *
 * Es la misma idea que en Java, y en Python pesa más: no hay compilador que
 * rechace la prueba antes de ejecutarla. Un método que no existe, un argumento
 * de menos o un atributo que el objeto todavía no tiene solo aparecen al
 * correr, y ahí la corrección automática ya no actúa. Lo único que los evita es
 * que los agentes no tengan que adivinarlos.
 *
 * Lo primero que dice es la línea que importa la clase. En Java la prueba vive
 * en el paquete de la clase y no la importa; en Python la prueba es otro
 * módulo, y la ruta del `import` sale de dónde está el archivo, que no está
 * escrito en el código ni lo ve ningún agente.
 *
 * Después, como en Java: cómo se crea una instancia, la lista completa de
 * métodos, qué métodos de la clase llama el método bajo prueba —con el código
 * de los que empiezan con `_`, que son parte de la unidad— y, propio de
 * Python, los atributos que el método lee y que `__init__` no crea. Va en
 * inglés, como las plantillas.
 */

/** Líneas de cuerpo que se muestran de un método que el objetivo llama y no empieza con `_`. */
const SHORT_BODY_LINES = 12;

/** Líneas de cuerpo que se muestran como máximo de cualquier método. */
const MAX_BODY_LINES = 40;

/** Métodos listados como máximo: una clase enorme no puede llenar el prompt. */
const MAX_LISTED_METHODS = 40;

/** Métodos con `_` que se siguen como máximo, contando los que llaman ellos. */
const MAX_FOLLOWED = 10;

const NAME = String.raw`[\p{L}_][\p{L}\p{N}_]*`;

/** Clases base que hacen de la clase una enumeración. */
const ENUM_BASES = new Set(["Enum", "IntEnum", "StrEnum", "Flag", "IntFlag"]);

/**
 * La ficha de `target` en el archivo `code`, o la cadena vacía si en ese
 * archivo no está la clase o no declara el método. Las funciones sin clase
 * todavía no tienen ficha: no se pueden pedir.
 */
export function describePythonUnit(
  code: string,
  target: UnitTarget,
  location: SymbolCandidate,
  project: ProjectModel
): string {
  const { className, methodName } = target;
  if (className === null) {
    return "";
  }

  const outline = outlinePython(code);
  for (const owner of findClasses(outline, className)) {
    const methods = methodsOf(owner).filter((method) => method.name === methodName);
    // La misma elección que la localización: la última declaración es la que vale.
    const unit = methods[methods.length - 1];
    if (unit) {
      return formatFacts(outline, readClass(outline, owner), unit, location.filePath, importRootOf(project));
    }
  }
  return "";
}

// ── La clase ───────────────────────────────────────────────────────────────

interface ClassInfo {
  readonly block: PythonBlock;
  /** Las clases base, como se escriben, sin `metaclass=`. */
  readonly bases: readonly string[];
  readonly kind: "class" | "abstract" | "dataclass" | "namedTuple" | "enum" | "protocol";
  readonly methods: readonly PythonBlock[];
  readonly abstractMethods: readonly PythonBlock[];
  /** Campos de una clase de datos, en orden: `nombre: str`, `precio: float = 0.0`. */
  readonly fields: readonly string[];
  /** Miembros de una enumeración. */
  readonly members: readonly string[];
  /** Atributos declarados en el cuerpo de la clase, que comparten todas las instancias. */
  readonly classAttributes: readonly string[];
  /** Cada método con los atributos de `self` que asigna. */
  readonly assignments: ReadonlyMap<PythonBlock, ReadonlySet<string>>;
}

function readClass(outline: PythonOutline, block: PythonBlock): ClassInfo {
  const parts = splitTopLevel(block.parameters);
  const metaclass = parts.find((part) => /^metaclass\s*=/.test(part));
  const bases = parts.filter((part) => !/^\w+\s*=/.test(part));
  const baseNames = bases.map(lastSegment);

  const methods = methodsOf(block);
  const abstractMethods = methods.filter((method) =>
    method.decorators.some((decorator) => /^abstract/.test(decoratorName(decorator)))
  );
  const isDataclass = block.decorators.some((decorator) => decoratorName(decorator) === "dataclass");

  const statements = bodyStatements(outline, block).map((statement) =>
    collapsed(outline.scanned, statement.start, statement.end)
  );
  const declarations = statements.filter((text) => !/^(?:@|def\s|async\s|class\s)/.test(text));

  const kind: ClassInfo["kind"] = baseNames.some((name) => ENUM_BASES.has(name))
    ? "enum"
    : baseNames.includes("Protocol")
      ? "protocol"
      : abstractMethods.length > 0
        ? "abstract"
        : isDataclass
          ? "dataclass"
          : baseNames.includes("NamedTuple")
            ? "namedTuple"
            : "class";

  const annotated = new RegExp(String.raw`^(${NAME})\s*:\s*(?!.*ClassVar)`, "u");
  const assigned = new RegExp(String.raw`^(${NAME})\s*(?::[^=]*)?=(?!=)`, "u");

  const assignments = new Map<PythonBlock, ReadonlySet<string>>();
  for (const method of methods) {
    assignments.set(method, selfAssignments(outline, method.body));
  }

  return {
    block,
    bases: metaclass ? [...bases, metaclass] : bases,
    kind,
    methods,
    abstractMethods,
    fields: kind === "dataclass" || kind === "namedTuple" ? declarations.filter((text) => annotated.test(text)) : [],
    members:
      kind === "enum"
        ? declarations.flatMap((text) => {
            const name = assigned.exec(text)?.[1];
            return name && !name.startsWith("_") ? [name] : [];
          })
        : [],
    // Una anotación sola (`total: int`) no crea nada: solo cuenta lo que tiene valor.
    classAttributes: declarations.flatMap((text) => {
      const name = assigned.exec(text)?.[1];
      return name ? [name] : [];
    }),
    assignments,
  };
}

/** Los atributos de `self` que asigna un cuerpo: `self.items = …`, `self.total += …`. */
function selfAssignments(outline: PythonOutline, body: SourceRange): Set<string> {
  const text = outline.scanned.masked.slice(body.start, body.end);
  const assignment = new RegExp(
    String.raw`\bself\s*\.\s*(${NAME})\s*(?::[^=\n]*)?(?:\*\*|//|>>|<<|[-+*/%@&|^])?=(?!=)`,
    "gu"
  );
  return new Set([...text.matchAll(assignment)].map((match) => match[1]));
}

// ── Llamadas ───────────────────────────────────────────────────────────────

interface Calls {
  /** Métodos de la clase que usa la unidad, o uno con `_` que ella usa. */
  readonly members: readonly PythonBlock[];
  /** Llamados sobre `self` que la clase no declara. */
  readonly undeclared: readonly string[];
}

/**
 * Métodos de la clase que usa la unidad: los que llama sobre `self`, `cls` o
 * la clase misma, y las propiedades que lee, porque leer una propiedad corre
 * su código. Los que empiezan con `_` se siguen: lo que ellos usan también es
 * parte de lo que hace la unidad.
 */
function readCalls(outline: PythonOutline, info: ClassInfo, unit: PythonBlock): Calls {
  const members: PythonBlock[] = [];
  const undeclared: string[] = [];
  const seen = new Set<string>();
  const pending: SourceRange[] = [unit.body];
  let followed = 0;

  while (pending.length > 0) {
    const body = pending.shift()!;
    for (const { name, called } of usedNames(outline, body, info.block.name)) {
      if (seen.has(name) || name === unit.name) {
        continue;
      }
      const declared = info.methods.filter((method) => method.name === name);
      if (declared.length === 0) {
        if (called) {
          seen.add(name);
          undeclared.push(name);
        }
        continue;
      }
      seen.add(name);
      const member = declared[declared.length - 1];
      if (!called && !isProperty(member)) {
        continue;
      }
      members.push(member);
      if (isInternal(member) && followed < MAX_FOLLOWED) {
        followed++;
        pending.push(member.body);
      }
    }
  }

  return { members, undeclared };
}

/** Nombres usados sobre `self`, `cls` o la clase, en orden, y si se llaman. */
function usedNames(
  outline: PythonOutline,
  body: SourceRange,
  className: string
): { name: string; called: boolean }[] {
  const text = outline.scanned.masked.slice(body.start, body.end);
  const access = new RegExp(String.raw`(?<![\p{L}\p{N}_.])(?:self|cls|${className})\s*\.\s*(${NAME})(\s*\()?`, "gu");
  return [...text.matchAll(access)].map((match) => ({ name: match[1], called: match[2] !== undefined }));
}

/** Atributos que la unidad lee y que `__init__` no crea, con quién los asigna. */
function lateAttributes(outline: PythonOutline, info: ClassInfo, unit: PythonBlock): { name: string; setBy: string[] }[] {
  const init = info.methods.find((method) => method.name === "__init__");
  // Los campos de una clase de datos los crea el __init__ que Python escribe.
  const createdByInit = new Set([
    ...(init ? info.assignments.get(init) ?? [] : []),
    ...info.fields.map((field) => field.split(":")[0].trim()),
  ]);
  const ownAssignments = info.assignments.get(unit) ?? new Set<string>();
  const memberNames = new Set(info.block.children.map((child) => child.name));

  const read = new Set(
    usedNames(outline, unit.body, "self")
      .filter(({ name, called }) => !called && !memberNames.has(name))
      .map(({ name }) => name)
  );

  const late: { name: string; setBy: string[] }[] = [];
  for (const name of read) {
    if (createdByInit.has(name) || ownAssignments.has(name) || info.classAttributes.includes(name)) {
      continue;
    }
    const setBy = info.methods
      .filter((method) => method !== init && info.assignments.get(method)?.has(name))
      .map((method) => method.name);
    late.push({ name, setBy });
  }
  return late;
}

// ── Formato ────────────────────────────────────────────────────────────────

function formatFacts(
  outline: PythonOutline,
  info: ClassInfo,
  unit: PythonBlock,
  filePath: string,
  importRoot: string
): string {
  const className = info.block.name;
  const lines = [
    "━━ CLASS FACTS — read from the source code by the tool, not by a language model ━━",
    `These facts about \`${className}\` are exact. Where anything else in this prompt disagrees with them — the PRE-FLIGHT CHECKLIST, the code analysis or a sliced context — follow these facts.`,
    "",
    ...importLines(info.block, filePath, importRoot),
    "",
    `Declaration: ${info.block.signature}:`,
    `Kind: ${kindLabel(info)}`,
  ];

  if (info.kind !== "enum") {
    lines.push(
      info.abstractMethods.length === 0
        ? `Abstract methods declared in ${className}: none.`
        : `Abstract methods declared in ${className} (@abstractmethod):`
    );
    lines.push(...info.abstractMethods.map((method) => `  ${methodLine(method)}`));
  }

  const init = info.methods.find((method) => method.name === "__init__");
  const creator = info.methods.find((method) => method.name === "__new__");
  if (info.kind !== "enum" && info.kind !== "dataclass" && info.kind !== "namedTuple") {
    if (init) {
      lines.push(`__init__: ${init.signature}`);
    } else if (creator) {
      lines.push(`__init__: not declared in ${className}. It creates its instances with __new__, which receives the constructor arguments:`, `  ${creator.signature}`);
    } else {
      lines.push(`__init__: not declared in ${className}.`);
    }
  }
  if (info.fields.length > 0) {
    lines.push("Fields, in order — they are the parameters of the constructor:", ...info.fields.map((field) => `  ${field}`));
  }

  lines.push("", "How to create an instance:", `  ${instantiation(info, unit)}`);
  if (info.kind === "class" && info.bases.length > 0) {
    lines.push(
      `  If Python reports "Can't instantiate abstract class ${className} with abstract method …", that method is inherited from ${info.bases.join(", ")}: implement exactly that one in a helper subclass.`
    );
  }

  lines.push("", `The method under test: ${methodLine(unit)}`, ...unitNotes(info, unit));

  lines.push(
    "",
    `Methods declared in ${className} — the complete list. ${className} declares no other methods: do not invent any.`
  );
  lines.push(...info.methods.slice(0, MAX_LISTED_METHODS).map((method) => `  ${methodLine(method)}`));
  if (info.methods.length > MAX_LISTED_METHODS) {
    lines.push(`  … and ${info.methods.length - MAX_LISTED_METHODS} more.`);
  }
  const nested = info.block.children.filter((child) => child.kind === "class");
  if (nested.length > 0) {
    lines.push(`Classes nested in ${className}: ${nested.map((child) => `${className}.${child.name}`).join(", ")}.`);
  }

  lines.push(...describeAttributes(outline, info, unit));
  lines.push("", ...describeCalls(outline, info, unit, readCalls(outline, info, unit)));
  return lines.join("\n");
}

/**
 * La línea que importa la clase. Una clase anidada se alcanza por la de
 * primer nivel, que es la que se puede importar. Un archivo cuyo nombre no se
 * puede escribir en un `import` (`mi-script.py`) se carga con `importlib`.
 */
function importLines(block: PythonBlock, filePath: string, importRoot: string): string[] {
  const moduleName = moduleNameOf(filePath, importRoot);
  const outermost = [block, ...ancestorsOf(block)].pop()!;
  const access = [...ancestorsOf(block).reverse(), block].map((owner) => owner.name).join(".");

  const lines = moduleName.split(".").every(isIdentifier)
    ? ["Import it in the test exactly like this:", `  from ${moduleName} import ${outermost.name}`]
    : [
        `Import it in the test exactly like this (the file name is not a valid module name, so a plain import cannot load it):`,
        "  import importlib",
        `  ${outermost.name} = importlib.import_module("${moduleName}").${outermost.name}`,
      ];
  if (outermost !== block) {
    lines.push(`  ${block.name} is nested: refer to it as ${access}.`);
  }

  const withoutRoot =
    importRoot !== PROJECT_ROOT && filePath.startsWith(`${importRoot}/`) ? ` without \`${importRoot}/\`,` : "";
  lines.push(
    `Other project modules are imported the same way: the file path${withoutRoot} without \`.py\` and with dots instead of slashes (\`${filePath}\` → \`${moduleName}\`).`
  );
  return lines;
}

function kindLabel(info: ClassInfo): string {
  const nested = info.block.parent ? `, nested in ${info.block.parent.name}` : "";
  const bases = info.bases.length > 0 ? ` (bases: ${info.bases.join(", ")})` : "";
  switch (info.kind) {
    case "enum":
      return `Enum${bases}${nested}. Members: ${info.members.join(", ") || "none"}.`;
    case "protocol":
      return `Protocol${bases}${nested} — it only describes methods.`;
    case "abstract":
      return `abstract class${bases}${nested}`;
    case "dataclass":
      return `dataclass${bases}${nested}`;
    case "namedTuple":
      return `NamedTuple${nested}`;
    case "class":
      return `class${bases}${nested}`;
  }
}

/** La forma exacta de conseguir una instancia, o de no necesitarla. */
function instantiation(info: ClassInfo, unit: PythonBlock): string {
  const className = info.block.name;
  const decorators = unit.decorators.map(decoratorName);

  if (decorators.includes("staticmethod")) {
    return `\`${unit.name}\` is a @staticmethod: call it as \`${className}.${unit.name}(...)\` — no instance is needed.`;
  }
  if (decorators.includes("classmethod")) {
    return `\`${unit.name}\` is a @classmethod: call it as \`${className}.${unit.name}(...)\` — no instance is needed (\`cls\` is ${className}).`;
  }

  const init = info.methods.find((method) => method.name === "__init__");
  const creator = info.methods.find((method) => method.name === "__new__");
  const creation = init
    ? `${className}(<arguments for __init__ above, without self>)`
    : creator
      ? `${className}(<arguments for __new__ above, without cls>)`
      : info.bases.length === 0
        ? `${className}()`
        : `${className}(<the arguments of the __init__ it inherits from ${info.bases.join(", ")}>)`;

  switch (info.kind) {
    case "enum":
      return `${className} is an Enum: use one of its members (${info.members.map((member) => `${className}.${member}`).join(", ")}). Never call ${className}(...) to create one.`;
    case "protocol":
      return `${className} is a Protocol: do not create it. Write a small helper class in the test module with the methods ${className} lists, and use an instance of that class.`;
    case "abstract":
      return `${className} is abstract: define a helper subclass at module level in the test — \`class _Concrete${className}(${className}):\` — that implements exactly the abstract methods listed above and nothing else, and create it like ${className}: ${creation.replace(className, `_Concrete${className}`)}. Never call ${className}(...) directly.`;
    case "dataclass":
    case "namedTuple":
      return `${className}(...) with one argument per field above, in that order; fields with a default value are optional.`;
    case "class":
      if (init || creator) {
        return `${creation}.${keywordOnlyNote((init ?? creator)!)}`;
      }
      return info.bases.length === 0
        ? `${creation} — it declares no __init__ and has no base class, so it takes no arguments.`
        : `${creation}. ${className} declares no __init__: check the base class in the context before calling it.`;
  }
}

/**
 * Los parámetros que van después de un `*` solo, que se pasan por nombre. Se
 * nombran solo si los hay: en la primera prueba con Ctrl+F5 la ficha lo decía
 * de un `__init__` que no tenía ninguno.
 */
function keywordOnlyNote(constructor: PythonBlock): string {
  const parameters = splitTopLevel(constructor.parameters);
  const star = parameters.indexOf("*");
  if (star === -1) {
    return "";
  }
  const names = parameters
    .slice(star + 1)
    .filter((parameter) => !parameter.startsWith("**"))
    .map((parameter) => `\`${parameter.split(/[:=]/)[0].trim()}\``);
  if (names.length === 0) {
    return "";
  }
  return names.length === 1
    ? ` ${names[0]} comes after a bare \`*\`: it is keyword-only, pass it by name.`
    : ` ${names.join(", ")} come after a bare \`*\`: they are keyword-only, pass them by name.`;
}

function unitNotes(info: ClassInfo, unit: PythonBlock): string[] {
  const className = info.block.name;
  const decorators = unit.decorators.map(decoratorName);
  const notes: string[] = [];

  if (unit.isAsync) {
    notes.push(
      `  It is a coroutine (\`async def\`): inside a plain \`def test_...\` function, run it with \`asyncio.run(...)\` and \`import asyncio\`. Never write \`async def test_...\`: pytest does not run it without a plugin.`
    );
  }
  if (decorators.includes("property")) {
    const setter = info.methods.some((method) =>
      method.decorators.some((decorator) => decorator === `${unit.name}.setter`)
    );
    notes.push(
      `  It is a @property: read it as \`sut.${unit.name}\`, without parentheses.` +
        (setter ? ` It also has a setter: \`sut.${unit.name} = value\` runs it.` : ` It has no setter: assigning it raises AttributeError.`)
    );
  }
  if (isMangled(unit.name)) {
    notes.push(
      `  Its name starts with two underscores: Python renames it to \`_${className}${unit.name}\`. Call it as \`sut._${className}${unit.name}(...)\`.`
    );
  } else if (isDunder(unit.name)) {
    notes.push(
      `  It is a special method: Python calls it through an operation (\`with\`, \`len()\`, \`str()\`, \`==\`, \`for\`, \`[]\`…). Test it through that operation; call it by name only when the operation would hide the branch to test.`
    );
  } else if (unit.name.startsWith("_")) {
    notes.push(`  Its name starts with \`_\`: it is internal by convention only. Call it directly as \`sut.${unit.name}(...)\`.`);
  }
  return notes;
}

function describeAttributes(outline: PythonOutline, info: ClassInfo, unit: PythonBlock): string[] {
  const lines: string[] = [];
  const init = info.methods.find((method) => method.name === "__init__");
  const created = init ? [...(info.assignments.get(init) ?? [])] : [];

  if (info.classAttributes.length > 0 && info.kind !== "enum") {
    lines.push(
      "",
      `Class attributes of ${info.block.name} (shared by every instance — restore them after a test that changes them): ${info.classAttributes.join(", ")}.`
    );
  }
  if (created.length > 0) {
    lines.push("", `Attributes that __init__ creates: ${created.map((name) => `self.${name}`).join(", ")}.`);
  }

  const late = lateAttributes(outline, info, unit);
  if (late.length > 0) {
    lines.push(
      "",
      `Attributes that \`${unit.name}\` reads but __init__ does not create — they do not exist on a new instance, and reading them raises AttributeError. Prepare them before calling it:`
    );
    for (const { name, setBy } of late) {
      lines.push(
        setBy.length > 0
          ? `  self.${name} — created by ${setBy.map((method) => `${method}()`).join(", ")}: call it first, or assign \`sut.${name}\` directly.`
          : `  self.${name} — not assigned anywhere in ${info.block.name} (inherited, or set from outside the class): assign \`sut.${name}\` directly.`
      );
    }
  }
  return lines;
}

function describeCalls(outline: PythonOutline, info: ClassInfo, unit: PythonBlock, calls: Calls): string[] {
  const className = info.block.name;
  const lines: string[] = [];

  if (calls.members.length === 0) {
    lines.push(`Methods of ${className} that \`${unit.name}\` calls: none.`);
  } else {
    lines.push(`Methods of ${className} that \`${unit.name}\` calls:`);
    for (const member of calls.members) {
      lines.push(...describeCalled(outline, info, member, unit));
    }
  }

  if (calls.undeclared.length > 0) {
    lines.push(
      `Called by \`${unit.name}\` but not declared in ${className} (inherited from a base class): ${calls.undeclared.map((name) => `${name}(...)`).join(", ")}.`
    );
  }
  return lines;
}

function describeCalled(outline: PythonOutline, info: ClassInfo, member: PythonBlock, unit: PythonBlock): string[] {
  if (info.abstractMethods.includes(member)) {
    return [
      `  ${methodLine(member)} — abstract: the helper subclass decides what it returns. Use that to reach each branch of \`${unit.name}\`.`,
    ];
  }

  const text = outline.source.slice(member.range.start, member.range.end);
  if (isInternal(member)) {
    return [
      `  ${methodLine(member)} — its name starts with \`_\`, so it is part of the unit under test. Reach it through \`${unit.name}\`; do not call it from the test or replace it. Its code:`,
      ...indentBody(text, member.indent),
    ];
  }

  // El código se muestra para que el modelo sepa qué devuelve, no para que lo
  // copie: en Java el generador lo pegó en la subclase de la prueba.
  const inherited = `already implemented in ${info.block.name} and runs as is: do not override it, patch it or copy its code into the test`;
  if (text.split("\n").length <= SHORT_BODY_LINES) {
    return [`  ${methodLine(member)} — ${inherited}. Its code, for reference only:`, ...indentBody(text, member.indent)];
  }
  return [`  ${methodLine(member)} — ${inherited}.`];
}

/** El código de un método, sin la sangría que trae del archivo, debajo de su firma. */
function indentBody(text: string, indent: number): string[] {
  const lines = text.split(/\r?\n/);
  const shown = lines
    .slice(0, MAX_BODY_LINES)
    .map((line) => `      ${dedent(line, indent)}`.trimEnd());
  if (lines.length > MAX_BODY_LINES) {
    shown.push(`      … (${lines.length - MAX_BODY_LINES} more lines)`);
  }
  return shown;
}

function dedent(line: string, indent: number): string {
  let removed = 0;
  let index = 0;
  while (index < line.length && removed < indent && (line[index] === " " || line[index] === "\t")) {
    removed += line[index] === "\t" ? 8 - (removed % 8) : 1;
    index++;
  }
  return line.slice(index);
}

/** Firma de un método con sus decoradores delante: `@staticmethod def redondear(valor)`. */
function methodLine(method: PythonBlock): string {
  const decorators = method.decorators.map((decorator) => `@${decorator} `).join("");
  return `${decorators}${method.signature}`;
}

function isProperty(method: PythonBlock): boolean {
  return method.decorators.some((decorator) => decoratorName(decorator) === "property");
}

/** Empieza con `_` y no es un método especial: interno por convención. */
function isInternal(method: PythonBlock): boolean {
  return method.name.startsWith("_") && !isDunder(method.name);
}

function isDunder(name: string): boolean {
  return name.length > 4 && name.startsWith("__") && name.endsWith("__");
}

/** Dos guiones bajos delante y no detrás: Python le cambia el nombre. */
function isMangled(name: string): boolean {
  return name.startsWith("__") && !name.endsWith("__");
}

/** Las partes de una lista separadas por comas fuera de todo paréntesis. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if ("([{".includes(character)) {
      depth++;
    } else if (")]}".includes(character)) {
      depth--;
    }
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/** `abc.ABC` → `ABC`, `Generic[T]` → `Generic`. */
function lastSegment(base: string): string {
  const withoutArguments = base.replace(/\[.*$/, "").trim();
  const segments = withoutArguments.split(".");
  return segments[segments.length - 1];
}
