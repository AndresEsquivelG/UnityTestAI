import type { PythonFragments } from "./fragments";

/**
 * Lo que cambia del perfil cuando la unidad bajo prueba es una función de
 * módulo, sin clase (HU-24, tercera parte).
 *
 * Cada fragmento reemplaza al del mismo nombre de los otros archivos, y solo
 * esos: cómo crear el objeto bajo prueba, los nombres que Python cambia dentro
 * de una clase, los atributos que `__init__` no crea y el nombre del bloque de
 * la ficha, que sin clase es FUNCTION FACTS. Todo lo demás —pytest, una
 * aserción por prueba, las clases auxiliares, `monkeypatch`— vale igual para
 * una función. Con clase no se usa ninguno, así que el prompt de un método no
 * cambia ni una letra (decidido por Andrés el 2026-10-26).
 */
export const MODULE_FUNCTION_FRAGMENTS = {
  // ── Analizador ─────────────────────────────────────────────────────────────

  /** Sin clase no hay atributos de instancia: lo propio del módulo con `_`. */
  analyzerPrivateMemberKinds: `A. Module-level variables the target function reads or writes whose name starts with \`_\` (\`_CACHE\`, \`_suffixes\`):
   kind = "attribute"
   Example: \`_SUFFIXES = ("kB", "MB")\` read by the function → { name: "_SUFFIXES", kind: "attribute", type: "tuple[str, ...]" }

B. Module-level functions the target function calls whose name starts with \`_\`:
   kind = "method"
   They are part of the unit under test: the test reaches them through the target function and never replaces them.

C. \`<method-name>\` itself, if its name starts with \`_\`:
   kind = "method"
   The test imports and calls it directly. A module-level function is never renamed by Python, even with two leading underscores.`,

  /** Fuera de una clase, Python no le cambia el nombre a nada. */
  analyzerDefaultVisibility: `- Python has NO access modifiers: list here ONLY module-level names that start with \`_\` (the test still uses them directly). Do NOT list names without a leading underscore`,

  /**
   * Lo que la prueba tiene que preparar: sin instancia, es el estado del
   * módulo, que comparten todas las pruebas, y lo que no controla.
   */
  analyzerLifecycleFields: `7. STATE THE TEST MUST PREPARE — Scan the target function and the module that declares it for:
   a) module-level variables the function reads or changes (constants, caches, registries, configuration). They are shared by
      every test: a test that changes one must restore it, with monkeypatch.setattr on the module.
   b) calls the test must replace because it cannot control them otherwise: input(), sys.stdin, time.time/time.sleep/datetime.now,
      random.*, os.environ/os.getenv, open() of a fixed path, network calls.

   RULES for lateAttributes:
   - A module-level function has no instance: list here only the module-level variables of (a) that a test must set or restore
   - setBy = "module level"
   - notes = how to control it in tests (e.g., "monkeypatch.setattr(shop.config, 'RATE', 0.1)")
   RULES for patchTargets:
   - call = the call as the function writes it (e.g., "random.randint(1, 6)")
   - target = the dotted name to patch WHERE THE MODULE UNDER TEST LOOKS IT UP:
     "random.randint" if the module does \`import random\`; "shop.dice.randint" if the module shop/dice.py does \`from random import randint\`
   - If there are none, return []`,

  /** La línea de la función bajo prueba la da su ficha. */
  analyzerNamespaces: `8. IMPORTS — The test is a separate module and must import every project name it uses.
   For the function under test and every project class, function or enum the tests will reference, write the exact import line.
   Module path = the file path without the import root (\`src/\` when the project keeps its code there) and without \`.py\`,
   with \`/\` replaced by \`.\` (e.g., \`humanize/filesize.py\` declaring naturalsize → \`from humanize.filesize import naturalsize\`).
   If the context ends with a FUNCTION FACTS block, copy its import line for the function under test exactly.

   If no project name needs an import, return [].`,

  // ── Generador ──────────────────────────────────────────────────────────────

  /** La ficha manda sobre la lista previa, como con una clase. */
  generatorPreFlightItems: `• FUNCTION FACTS block at the end of the context → read from the source code by the tool, so it outranks this checklist.
  Where they disagree, follow the facts and import the function exactly as its "Import it in the test exactly like this" line says.
  The function under test belongs to no class: there is no instance to create — call it directly
• Type Instantiations → direct call vs helper subclass vs dataclass fields vs Enum member for EVERY class the test creates (arguments, collaborators)
• Computed Properties → which underlying attributes to set instead of assigning a @property
• Untestable Branches → branches to OMIT entirely (no assert True, no placeholder tests)
• Required Imports → exact import lines for project modules
• Module-level state and Patch Targets → what to prepare or replace before calling the function`,

  /** No hay objeto bajo prueba: el control queda para las clases auxiliares. */
  generatorInstantiationCheck: `\`<method-name>\` is a module-level function: it belongs to no class. There is NO instance to create and no \`self\`:
call it directly as \`<method-name>(arguments)\`, imported exactly as the FUNCTION FACTS block says.
NEVER wrap it in a class, and never call it on an object.

THE INSTANTIATION CHECK APPLIES TO EVERY CLASS YOU CREATE IN TESTS — arguments, collaborators, expected values:
  - Find its declaration in the assembled context
  - Abstract class or Protocol → a helper class in the test module with exactly the methods the function calls on it
  - Regular class, dataclass or NamedTuple → ClassName(...) with arguments that match its __init__ or its fields
  - Enum → use a member, ClassName.MEMBER
NEVER call an abstract class or an Enum directly.

Write your answer before continuing:
  "<method-name> declaration: [copy exact line] → direct call, no instance"
  For each class used: "[ClassName] declaration: [copy exact line] → [direct / subclass / member]"`,

  /** La importación de la función, con la línea de la ficha. */
  generatorNamespaceStep: `━━ STEP 0.1 — IMPORT CHECK (mandatory) ━━

The test is a SEPARATE module in the project's tests folder: it sees NOTHING of the project unless it imports it.

1. The function under test: copy EXACTLY the line "Import it in the test exactly like this" of the FUNCTION FACTS block.
   Never shorten it and never derive it from the file name alone.
2. For every other project class, function or enum you will reference (dependencies, helper types, enums):
   import it from the module that DECLARES it. Module path = the file path without the import root and without \`.py\`,
   with \`/\` replaced by \`.\` — the FUNCTION FACTS block says which import root this project uses.
3. Standard library: import every module you use (\`import math\`, \`from decimal import Decimal\`, \`import asyncio\`).

WRONG: \`from filesize import naturalsize\` for src/humanize/filesize.py
       → ModuleNotFoundError: No module named 'filesize' — pytest cannot collect ANY test of the file
CORRECT: \`from humanize.filesize import naturalsize\`

Rule: EVERY name the test uses and does not define → one import. A missing one → NameError when the test runs.
Write down the imports before continuing.`,

  /** La forma del archivo, con la importación de la función en lugar de la de la clase. */
  generatorTestClassRules: `- Exactly ONE Python test module with plain module-level test FUNCTIONS — NO test class, NO unittest.TestCase
- First line: \`import pytest\`
- Then the import of the function under test, copied EXACTLY from the FUNCTION FACTS line "Import it in the test exactly like this"
- Then every other import identified in STEP 0.1 (project modules and the standard library)
- Test function names: test_<method-name>_<what it verifies>, in snake_case
- A wrong module path gives ModuleNotFoundError and pytest cannot run ANY test of the file;
  a missing import gives NameError when the test runs
- Write Python 3.8 compatible code unless the context already uses newer syntax (match, X | Y unions, ...)`,

  /** El estado del módulo es el equivalente de los atributos que no crea `__init__`. */
  generatorLifecycleFields: `D. MODULE-LEVEL STATE — a module-level function has no instance, but it can read or change variables of its module
   (constants, caches, registries, configuration). They are shared by EVERY test of the run. The FUNCTION FACTS block lists the
   ones the function reads and the ones it changes.

   For every such variable that the function uses:
   1. To control its value in one test → monkeypatch.setattr(module, "NAME", value): pytest restores it after the test
   2. If the function changes it → never rely on its value from another test; reset it with monkeypatch in the test that needs it
   3. Collaborator objects passed as arguments → a minimal hand-written stub class with ONLY the methods the function calls
   4. Plain values (str, int, bool, list…) → a valid test value of the type the function expects

   EXAMPLE (generalized):
     import shop.pricing

     def test_price_uses_the_configured_rate(monkeypatch):
         monkeypatch.setattr(shop.pricing, "RATE", 0.5)
         assert shop.pricing.price(10) == 5`,

  // ── Validador ──────────────────────────────────────────────────────────────

  /** La importación de la función, que deja a pytest sin recolectar si falla. */
  validatorImports: `2. IMPORTS: \`import pytest\` is present when pytest.raises, pytest.approx or @pytest.fixture is used, and the function under test is
   imported EXACTLY as the FUNCTION FACTS line "Import it in the test exactly like this" says (when the reference context has that block).
   It is called directly, never on an instance: it belongs to no class.
   ALSO: every other name the test uses — project classes, functions and enums, standard library modules (math, decimal,
   datetime, asyncio…) — is imported or defined in the module.
   Missing import → NameError when the test runs; wrong module path → ModuleNotFoundError and pytest collects NO test of the file — mark FAIL.`,

  /** Las propiedades son de las clases que usa la prueba, no de la unidad. */
  validatorComputedProperties: `10. NO ASSIGNMENT TO COMPUTED PROPERTIES — scan every \`obj.name = ...\` and every \`obj.name()\`:
    Find \`name\` in the declaration of the class of \`obj\` in the reference context. If it is a @property without a setter and the test assigns it → FAIL
    (AttributeError: property has no setter). If the test calls a @property with parentheses → FAIL (TypeError: not callable).
    FIX: find the underlying attribute(s) the property reads from and set those instead; read the property without parentheses.`,

  // ── Corrector ──────────────────────────────────────────────────────────────

  /** Cada error de importación, con la línea de la ficha de la función. */
  fixerImports: `0. IMPORTS — ModuleNotFoundError, ImportError and NameError prevention:
   The test is a separate module: every project class, function or enum it uses MUST be imported.
   The function under test: copy EXACTLY the line "Import it in the test exactly like this" of the FUNCTION FACTS block, when the reference context has one.
   Other project names: import them from the module that DECLARES them (module path = the file path without the import root and without \`.py\`, \`/\` → \`.\`).
   "No module named 'x'" → the module path is wrong: use the FUNCTION FACTS line, never a shortened path.
   "cannot import name 'X' from 'm'" → X is not declared in m: import it from the module that declares it.
   "name 'X' is not defined" → add the missing import (the standard library too: import math, from decimal import Decimal).
   Always keep \`import pytest\` as the first line.`,
} satisfies PythonFragments;
