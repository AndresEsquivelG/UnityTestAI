import type { ProjectModel, SymbolCandidate, UnitTarget } from "../../core/contracts";
import {
  findAbstractMembers,
  findConstructors,
  findEnclosingNamespace,
  findMemberTypes,
  findMethods,
  findStaticFactories,
  findTypeDeclarations,
  maskCommentsAndStrings,
  offsetOfPosition,
  type SourceRange,
  type TypeDeclaration,
} from "./csharpSource";
import { ProjectTypes, uniqueNamespace, type ProjectType } from "./projectTypes";

/**
 * OP-18 — Ficha de la clase bajo prueba, leída del código.
 *
 * Los agentes deciden sobre lo que ven, y el recortador no deja pasar ni otros
 * métodos ni un constructor que no inicialice lo que usa la unidad. Así salieron
 * dos fallas de compilación: `NodeReader` sin su `using` (CS0246), e
 * `ItemBase.GetUnityVec3`, donde el generador inventó un `override` de un método
 * que no vio (CS0506). Y `Eye.SetupPupil`, con una dependencia abstracta de 28
 * miembros de la que solo llegó una propiedad (CS0534).
 *
 * Una clase sin nada que decir deja la ficha vacía y los prompts no cambian.
 *
 * No copia los `using` del archivo: un mismo nombre puede existir en dos de ellos
 * (`TextureDictionary`, en `Conversion` y en `RenderWareStream`), y con los dos en
 * la prueba el nombre queda ambiguo (CS0104). Da el espacio de nombres de los
 * tipos que nombra, solo si es uno y el archivo de origen lo ve. Va en inglés,
 * como las plantillas.
 */

/** Líneas que se muestran como máximo del código de un miembro. */
const MAX_CODE_LINES = 30;

/** Un método no privado muestra su código solo si es corto. */
const SHORT_CODE_LINES = 12;

const MAX_CALLED_METHODS = 12;
const MAX_ABSTRACT_DEPENDENCIES = 3;
const MAX_ABSTRACT_MEMBERS = 40;
const MAX_SUBCLASSES = 5;

const HEADER = "━━ CLASS FACTS — read from the source code by the tool, not by a language model ━━";

const NOT_A_CALL = new Set([
  "if", "for", "foreach", "while", "switch", "catch", "lock", "using", "return", "new",
  "typeof", "sizeof", "nameof", "default", "checked", "unchecked", "base", "this", "fixed",
  "when", "await", "yield", "throw", "in", "is", "as", "else", "do", "try", "case",
]);

/** Un nombre sin calificar: el de `UnityEngine.Vector3` ya dice dónde está. */
const UNQUALIFIED_IDENTIFIER = /(?<![\w.])[A-Za-z_]\w*/g;

interface Unit {
  readonly code: string;
  readonly masked: string;
  readonly declaration: TypeDeclaration;
  readonly method: SourceRange;
  readonly methodName: string;
  /** Los espacios de nombres que el archivo de la unidad alcanza a ver. */
  readonly visible: ReadonlySet<string>;
}

/** Un texto que la ficha muestra, con lo que se ve desde el archivo de donde salió. */
interface NamedText {
  readonly text: string;
  readonly visible: ReadonlySet<string>;
}

export function describeUnityUnit(
  code: string,
  target: UnitTarget,
  location: SymbolCandidate,
  project?: ProjectModel
): string {
  if (target.className === null) {
    return "";
  }

  const masked = maskCommentsAndStrings(code);
  const namespace = findEnclosingNamespace(masked, location.line, location.column);
  const unit = locateUnit(code, masked, target.className, target.methodName, location);

  const facts: string[] =
    namespace === ""
      ? []
      : [
          `\`${target.className}\` is declared inside \`namespace ${namespace} { }\`.`,
          `The test file needs: using ${namespace};`,
          `A lookup by name must start with that namespace: GetType("${target.className}") finds nothing.`,
        ];

  const details = unit ? describeUnitDetails(unit, namespace, project) : [];
  if (facts.length === 0 && details.length === 0) {
    return "";
  }
  if (details.length > 0) {
    facts.push(
      ...(facts.length > 0 ? [""] : []),
      "These facts are exact. Where a sliced context or the code analysis disagrees with them, follow these facts.",
      "",
      ...details
    );
  }
  return [HEADER, ...facts].join("\n");
}

function locateUnit(
  code: string,
  masked: string,
  className: string,
  methodName: string,
  location: SymbolCandidate
): Unit | undefined {
  const position = offsetOfPosition(code, location.line, location.column);
  const declarations = findTypeDeclarations(masked).filter((type) => type.name === className);
  const declaration =
    declarations.find((type) => type.body.start <= position && position < type.body.end) ??
    declarations[0];
  if (!declaration) {
    return undefined;
  }

  const methods = findMethods(masked, code, declaration.body, methodName);
  const method = methods.find((match) => match.extent.start <= position && position < match.extent.end) ?? methods[0];
  const namespace = findEnclosingNamespace(masked, location.line, location.column);
  return (
    method && {
      code,
      masked,
      declaration,
      method: method.extent,
      methodName,
      visible: visibleNamespaces(masked, namespace),
    }
  );
}

/**
 * Lo que un archivo alcanza a ver: sus `using` y su espacio de nombres con los que
 * lo contienen. Filtra los falsos amigos: una propiedad llamada `Block` no es la
 * clase `Block` de otro espacio que ese archivo ni importa.
 */
function visibleNamespaces(masked: string, namespace: string): Set<string> {
  const visible = new Set<string>();
  for (const match of masked.matchAll(/\busing\s+(?!static\b)([\w.]+)\s*;/g)) {
    visible.add(match[1]);
  }
  const parts = namespace.split(".");
  parts.forEach((_, index) => visible.add(parts.slice(0, index + 1).join(".")));
  return visible;
}

function describeUnitDetails(unit: Unit, namespace: string, project: ProjectModel | undefined): string[] {
  const named: NamedText[] = [];
  const sections = [describeCreation(unit, named), describeCalls(unit, named)];

  if (project) {
    const types = new ProjectTypes(project);
    const stated = new Set([namespace]);
    sections.push(describeAbstractDependencies(unit, types, named, stated));
    sections.push(describeNamespaces(unit, types, named, stated));
  }
  sections.push(requiredComponentLines(unit.declaration));

  return sections.filter((section) => section.length > 0).flatMap((section, index) =>
    index === 0 ? section : ["", ...section]
  );
}

// ── Cómo se crea ───────────────────────────────────────────────────────────

function describeCreation(unit: Unit, named: NamedText[]): string[] {
  const { code, masked, declaration, visible } = unit;
  const { name, body } = declaration;
  const isAbstract = declaration.modifiers.includes("abstract");
  const lines: string[] = [];

  if (isAbstract) {
    const members = findAbstractMembers(masked, body);
    lines.push(
      `\`${name}\` is abstract: \`new ${name}(...)\` does not compile. Declare a small concrete subclass inside the test file.`
    );
    if (members.length === 0) {
      lines.push(`It declares no abstract members: the subclass has nothing to override.`);
    } else {
      lines.push("The subclass must override these abstract members:", ...members.map((member) => `  ${member}`));
      named.push({ text: members.join(" "), visible });
    }
  }

  const constructors = findConstructors(masked, code, body, name);
  if (constructors.length > 0) {
    const allPrivate = constructors.every((constructor) => isPrivateMember(constructor.signature));
    lines.push(
      `Constructors of \`${name}\`:${isAbstract ? ` the subclass must call one of them with \`: base(...)\`.` : ""}`
    );
    for (const constructor of constructors) {
      lines.push(...codeLines(code, constructor.extent));
      named.push({ text: constructor.signature, visible });
    }
    if (allPrivate) {
      lines.push(`All constructors of \`${name}\` are private: \`new ${name}(...)\` does not compile from the test.`);
      const factories = findStaticFactories(masked, code, body, name);
      if (factories.length > 0) {
        lines.push("Static methods that create one:", ...factories.map((factory) => `  ${factory}`));
      }
    }
  }
  return lines;
}

// ── Qué llama la unidad ────────────────────────────────────────────────────

function describeCalls(unit: Unit, named: NamedText[]): string[] {
  const { code, masked, declaration, method, methodName, visible } = unit;
  const isAbstract = declaration.modifiers.includes("abstract");

  const called = calledNames(masked.slice(method.start, method.end), declaration.name, methodName)
    .flatMap((name) => findMethods(masked, code, declaration.body, name))
    .slice(0, MAX_CALLED_METHODS);
  if (called.length === 0) {
    return [];
  }

  const lines = [`Methods of \`${declaration.name}\` that \`${methodName}\` calls:`];
  for (const { declaration: found, extent } of called) {
    const { signature } = found;
    named.push({ text: signature, visible });

    const sealedForTest = isAbstract && !/\b(?:virtual|abstract|override|static)\b/.test(signature);
    const lineCount = code.slice(extent.start, extent.end).split("\n").length;
    const showCode = isPrivateMember(signature) || lineCount <= SHORT_CODE_LINES;
    const note = sealedForTest ? " — not virtual: a subclass cannot override it (CS0506), and it runs as written." : "";
    lines.push(...(showCode ? codeLines(code, extent, note) : [`  ${signature}${note}`]));
  }
  return lines;
}

/**
 * Nombres que el código llama sin calificar, o con `this`, `base` o la propia
 * clase. Una llamada sobre otro objeto es de ese objeto y no cuenta.
 */
function calledNames(text: string, className: string, methodName: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/([A-Za-z_]\w*)\s*(?:<[^()<>;]*>)?\s*\(/g)) {
    const name = match[1];
    if (NOT_A_CALL.has(name) || name === methodName) {
      continue;
    }
    const before = text.slice(0, match.index ?? 0).trimEnd();
    if (before.endsWith(".")) {
      const qualifier = /([A-Za-z_]\w*)\s*$/.exec(before.slice(0, -1).trimEnd())?.[1];
      if (qualifier !== "this" && qualifier !== "base" && qualifier !== className) {
        continue;
      }
    } else if (/(?:^|\W)new$/.test(before)) {
      continue;
    }
    names.add(name);
  }
  return [...names];
}

// ── Dependencias abstractas ────────────────────────────────────────────────

function describeAbstractDependencies(
  unit: Unit,
  types: ProjectTypes,
  named: NamedText[],
  stated: Set<string>
): string[] {
  const dependencies = usedTypeNames(unit)
    .flatMap((name) => types.find(name))
    .filter(
      (type) =>
        type.kind === "class" &&
        type.modifiers.includes("abstract") &&
        (type.namespace === "" || unit.visible.has(type.namespace))
    )
    .slice(0, MAX_ABSTRACT_DEPENDENCIES);

  const lines: string[] = [];
  for (const dependency of dependencies) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(...describeAbstractDependency(dependency, types, named, stated));
  }
  return lines;
}

/**
 * Los tipos que usa la unidad: los que nombra, los de los campos que toca y los
 * de los parámetros de sus constructores.
 */
function usedTypeNames(unit: Unit): string[] {
  const { code, masked, declaration, method } = unit;
  const used = new Set<string>();
  const memberTypes = findMemberTypes(masked, declaration.body);

  for (const identifier of unqualifiedIdentifiers(masked.slice(method.start, method.end))) {
    used.add(identifier);
    for (const typeName of unqualifiedIdentifiers(memberTypes.get(identifier) ?? "")) {
      used.add(typeName);
    }
  }
  for (const constructor of findConstructors(masked, code, declaration.body, declaration.name)) {
    for (const identifier of unqualifiedIdentifiers(constructor.signature)) {
      used.add(identifier);
    }
  }

  used.delete(declaration.name);
  return [...used];
}

function describeAbstractDependency(
  dependency: ProjectType,
  types: ProjectTypes,
  named: NamedText[],
  stated: Set<string>
): string[] {
  const { name, namespace, body, masked, bases } = dependency;
  const members = findAbstractMembers(masked, body);
  const using = namespace === "" ? "" : ` (needs: using ${namespace};)`;
  if (namespace !== "") {
    stated.add(namespace);
  }

  const lines = [
    `\`${name}\`${using} is abstract and the method under test uses it.`,
    members.length === 0
      ? "It declares no abstract members."
      : `A subclass written in the test must override all ${members.length} of its abstract members:`,
    ...members.slice(0, MAX_ABSTRACT_MEMBERS).map((member) => `  ${member}`),
  ];
  if (members.length > MAX_ABSTRACT_MEMBERS) {
    lines.push(`  … and ${members.length - MAX_ABSTRACT_MEMBERS} more.`);
  }
  named.push({ text: members.join(" "), visible: visibleNamespaces(masked, namespace) });

  if (bases.some((base) => types.find(base).length > 0)) {
    lines.push(`Abstract members that \`${name}\` inherits are not listed: if the compiler reports one, implement exactly that one.`);
  }

  const subclasses = types.concreteSubclassesOf(name).slice(0, MAX_SUBCLASSES);
  if (subclasses.length > 0) {
    lines.push(
      `Concrete subclasses already in the project: ${subclasses
        .map((type) => (type.namespace === "" ? type.name : `${type.name} (using ${type.namespace};)`))
        .join(", ")}.`
    );
  }
  lines.push(...requiredComponentLines(dependency));
  return lines;
}

function requiredComponentLines(declaration: TypeDeclaration): string[] {
  if (declaration.requiredComponents.length === 0) {
    return [];
  }
  return [
    `\`${declaration.name}\` has [RequireComponent] for: ${declaration.requiredComponents.join(", ")}.`,
    `Unity adds a required component by itself only if it is concrete. If one is abstract (Collider2D, Collider or Renderer, for example), first add a concrete subclass of it to the GameObject (BoxCollider2D, BoxCollider, MeshRenderer): otherwise AddComponent returns null.`,
  ];
}

// ── Espacios de nombres ────────────────────────────────────────────────────

function describeNamespaces(
  unit: Unit,
  types: ProjectTypes,
  named: readonly NamedText[],
  stated: ReadonlySet<string>
): string[] {
  const byNamespace = new Map<string, Set<string>>();
  for (const { text, visible } of named) {
    for (const name of unqualifiedIdentifiers(text)) {
      if (name === unit.declaration.name) {
        continue;
      }
      const namespace = uniqueNamespace(types.find(name).filter((type) => visible.has(type.namespace)));
      if (namespace && !stated.has(namespace)) {
        byNamespace.set(namespace, (byNamespace.get(namespace) ?? new Set<string>()).add(name));
      }
    }
  }
  if (byNamespace.size === 0) {
    return [];
  }
  return [
    "Other project types named above need these using lines if the test writes them:",
    ...[...byNamespace].map(([namespace, names]) => `  using ${namespace}; // ${[...names].join(", ")}`),
  ];
}

// ── Utilidades ─────────────────────────────────────────────────────────────

function unqualifiedIdentifiers(text: string): string[] {
  return text.match(UNQUALIFIED_IDENTIFIER) ?? [];
}

/** En C#, un miembro sin modificador de acceso es privado. */
function isPrivateMember(signature: string): boolean {
  return !/\b(?:public|protected|internal)\b/.test(signature);
}

/** El código de un miembro sin su sangría común. La nota va junto a su firma. */
function codeLines(code: string, extent: SourceRange, note = ""): string[] {
  const lines = code.slice(extent.start, extent.end).split(/\r?\n/);
  const base = lines.length > 1 ? leadingSpace(lines[lines.length - 1]) : 0;
  const shown = lines
    .slice(0, MAX_CODE_LINES)
    .map((line, index) => `  ${index === 0 ? `${line}${note}` : line.slice(Math.min(base, leadingSpace(line)))}`.trimEnd());
  if (lines.length > MAX_CODE_LINES) {
    shown.push(`  … (${lines.length - MAX_CODE_LINES} more lines)`);
  }
  return shown;
}

function leadingSpace(line: string): number {
  return /^[ \t]*/.exec(line)?.[0].length ?? 0;
}
