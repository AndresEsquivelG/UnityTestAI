import type { ProjectModel, SymbolCandidate, UnitTarget } from "../../../core/contracts";
import { isIdentifier, moduleNameOf } from "../discovery/layout";
import { importRootOf } from "../discovery/projectModel";
import {
  collapsed,
  moduleFunctions,
  outlinePython,
  statementsOf,
  type PythonBlock,
  type PythonOutline,
  type SourceRange,
} from "../source/declarations";
import {
  MAX_FOLLOWED,
  SHORT_BODY_LINES,
  importLines,
  indentBody,
  isInternal,
  keywordOnlyNote,
  methodLine,
  parameterNames,
} from "./classFacts";

/**
 * OP-18 — Ficha de una función de módulo, sin clase (HU-24, tercera parte).
 *
 * Es la ficha de la clase sin lo que solo tiene una clase: no hay instancia que
 * crear, ni atributos que `__init__` no crea, ni nombres que Python cambia. Lo
 * que queda pesa igual: la línea que la importa, que ningún agente puede
 * deducir; cómo se llama; las variables del módulo que lee o cambia, que
 * comparten todas las pruebas; y las funciones del módulo que llama, con el
 * código de las que empiezan con `_`, que son parte de la unidad.
 */

const NAME = String.raw`[\p{L}_][\p{L}\p{N}_]*`;

/** Una asignación de primer nivel o del cuerpo: `TASA = 0.13`, `total: int = 0`. */
const ASSIGNED = new RegExp(String.raw`^(${NAME})\s*(?::[^=]*)?=(?!=)`, "u");

/** Caracteres que se muestran como máximo de la asignación de una variable del módulo. */
const MAX_VALUE_LENGTH = 100;

/**
 * La ficha de la función de módulo `target.methodName` en el archivo `code`, o
 * la cadena vacía si el archivo no la declara o si `target` tiene clase.
 */
export function describePythonFunction(
  code: string,
  target: UnitTarget,
  location: SymbolCandidate,
  project: ProjectModel
): string {
  if (target.className !== null) {
    return "";
  }
  const outline = outlinePython(code);
  const functions = moduleFunctions(outline);
  // La misma elección que la localización: la última declaración es la que vale.
  const unit = functions.filter((block) => block.name === target.methodName).pop();
  if (!unit) {
    return "";
  }
  return formatFacts(outline, functions, unit, location.filePath, importRootOf(project));
}

// ── El módulo ──────────────────────────────────────────────────────────────

/** Las variables del módulo, cada una con el texto de su última asignación de primer nivel. */
function moduleVariables(outline: PythonOutline): Map<string, string> {
  const variables = new Map<string, string>();
  for (const statement of statementsOf(outline.scanned)) {
    if (statement.indent !== 0) {
      continue;
    }
    const text = collapsed(outline.scanned, statement.start, statement.end);
    const name = ASSIGNED.exec(text)?.[1];
    if (name) {
      variables.delete(name);
      variables.set(name, text);
    }
  }
  return variables;
}

/**
 * Las variables del módulo que la función lee, y las que cambia con `global`.
 * Un parámetro o una asignación sin `global` con el mismo nombre la tapan: ahí
 * la función usa la suya.
 */
function moduleState(
  outline: PythonOutline,
  unit: PythonBlock,
  variables: ReadonlyMap<string, string>
): { read: string[]; changed: string[] } {
  const body = outline.scanned.masked.slice(unit.body.start, unit.body.end);
  const changed = [...body.matchAll(/(?<![\p{L}\p{N}_.])global\s+([^\n;]+)/gu)].flatMap((match) =>
    match[1].split(",").map((name) => name.trim()).filter((name) => name !== "")
  );

  const local = new Set(parameterNames(unit));
  for (const statement of statementsOf(outline.scanned)) {
    if (statement.start >= unit.body.start && statement.end <= unit.body.end) {
      const name = ASSIGNED.exec(collapsed(outline.scanned, statement.start, statement.end))?.[1];
      if (name && !changed.includes(name)) {
        local.add(name);
      }
    }
  }

  const used = new Set(
    [...body.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}_.])(${NAME})`, "gu"))].map((match) => match[1])
  );
  const read = [...variables.keys()].filter(
    (name) => used.has(name) && !local.has(name) && !changed.includes(name)
  );
  return { read, changed: [...new Set(changed)] };
}

/**
 * Las funciones del módulo que llama la unidad. Las que empiezan con `_` se
 * siguen: lo que ellas llaman también es parte de lo que hace la unidad.
 */
function calledFunctions(
  outline: PythonOutline,
  functions: readonly PythonBlock[],
  unit: PythonBlock
): PythonBlock[] {
  // Con dos declaraciones del mismo nombre, el mapa se queda con la última.
  const byName = new Map(functions.map((block) => [block.name, block]));
  const call = new RegExp(String.raw`(?<![\p{L}\p{N}_.])(${NAME})\s*\(`, "gu");
  const called: PythonBlock[] = [];
  const seen = new Set([unit.name]);
  const pending: SourceRange[] = [unit.body];
  let followed = 0;

  while (pending.length > 0) {
    const body = pending.shift()!;
    const text = outline.scanned.masked.slice(body.start, body.end);
    for (const match of text.matchAll(call)) {
      const block = byName.get(match[1]);
      if (!block || seen.has(block.name)) {
        continue;
      }
      seen.add(block.name);
      called.push(block);
      if (isInternal(block) && followed < MAX_FOLLOWED) {
        followed++;
        pending.push(block.body);
      }
    }
  }
  return called;
}

// ── Formato ────────────────────────────────────────────────────────────────

function formatFacts(
  outline: PythonOutline,
  functions: readonly PythonBlock[],
  unit: PythonBlock,
  filePath: string,
  importRoot: string
): string {
  const name = unit.name;
  const lines = [
    "━━ FUNCTION FACTS — read from the source code by the tool, not by a language model ━━",
    `These facts about \`${name}\` are exact. Where anything else in this prompt disagrees with them — the PRE-FLIGHT CHECKLIST, the code analysis or a sliced context — follow these facts.`,
    "",
    ...importLines(unit, filePath, importRoot),
    "",
    `Declaration: ${methodLine(unit)}`,
    `Kind: function declared at module level in \`${filePath}\` — it belongs to no class.`,
    "",
    "How to call it:",
    `  ${name}(<arguments for the declaration above>) — directly, as imported: there is no instance to create and no \`self\`.${keywordOnlyNote(unit)}`,
    ...callNotes(unit),
  ];

  const variables = moduleVariables(outline);
  const state = moduleState(outline, unit, variables);
  const moduleName = moduleNameOf(filePath, importRoot);
  const patch = moduleName.split(".").every(isIdentifier)
    ? ` To give one a different value in a test, use \`monkeypatch.setattr("${moduleName}.NAME", value)\`: pytest restores it after the test.`
    : "";
  if (state.read.length > 0) {
    lines.push(
      "",
      `Module-level variables that \`${name}\` reads — shared by every test.${patch}`,
      ...state.read.map((variable) => `  ${shortened(variables.get(variable)!)}`)
    );
  }
  if (state.changed.length > 0) {
    lines.push(
      "",
      `Module-level variables that \`${name}\` changes (declared \`global\`) — the change stays for the next test, so never rely on their value from another test: ${state.changed.join(", ")}.${patch}`
    );
  }

  const called = calledFunctions(outline, functions, unit);
  lines.push("");
  if (called.length === 0) {
    lines.push(`Functions of this module that \`${name}\` calls: none.`);
  } else {
    lines.push(`Functions of this module that \`${name}\` calls:`);
    for (const block of called) {
      lines.push(...describeCalled(outline, block, unit));
    }
  }
  return lines.join("\n");
}

function callNotes(unit: PythonBlock): string[] {
  const notes: string[] = [];
  if (unit.isAsync) {
    notes.push(
      `  It is a coroutine (\`async def\`): inside a plain \`def test_...\` function, run it with \`asyncio.run(...)\` and \`import asyncio\`. Never write \`async def test_...\`: pytest does not run it without a plugin.`
    );
  }
  if (isInternal(unit)) {
    notes.push(
      `  Its name starts with \`_\`: it is internal by convention only. Import it and call it by that same name — outside a class, Python renames nothing.`
    );
  }
  return notes;
}

function describeCalled(outline: PythonOutline, block: PythonBlock, unit: PythonBlock): string[] {
  const text = outline.source.slice(block.range.start, block.range.end);
  if (isInternal(block)) {
    return [
      `  ${methodLine(block)} — its name starts with \`_\`, so it is part of the unit under test. Reach it through \`${unit.name}\`; do not call it from the test or replace it. Its code:`,
      ...indentBody(text, block.indent),
    ];
  }

  // El código se muestra para que el modelo sepa qué devuelve, no para que lo
  // copie, igual que en la ficha de la clase.
  const implemented = "already implemented in this module and runs as is: do not patch it or copy its code into the test";
  if (text.split("\n").length <= SHORT_BODY_LINES) {
    return [`  ${methodLine(block)} — ${implemented}. Its code, for reference only:`, ...indentBody(text, block.indent)];
  }
  return [`  ${methodLine(block)} — ${implemented}.`];
}

function shortened(text: string): string {
  return text.length <= MAX_VALUE_LENGTH ? text : `${text.slice(0, MAX_VALUE_LENGTH - 1)}…`;
}
