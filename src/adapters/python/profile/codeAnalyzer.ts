import type { PythonFragments } from "./fragments";

/**
 * Fragmentos del analizador de código (`codeAnalyzerPrompt.txt`).
 *
 * Varios describen campos del análisis que solo existen en Python —los
 * atributos que `__init__` no crea, lo que hay que reemplazar con
 * `monkeypatch` y las líneas de `import`—. Esos campos los declara la
 * extensión del esquema (`analysisSchema.ts`, OP-09): sin ella, lo que el
 * modelo calcula se descartaría al validar la respuesta y no llegaría al
 * generador.
 *
 * Python no declara tipos, así que el analizador también los deduce: del uso,
 * de los valores por defecto, de las anotaciones y de la documentación del
 * método. Es lo que pide HU-26.
 */
export const CODE_ANALYZER_FRAGMENTS = {
  /**
   * Mismo conocimiento que `ignoredTypes`, enunciado como qué no entra en la
   * lista de dependencias.
   */
  analyzerIgnoredTypes: `- Include Python built-in and standard library types (str, int, list, dict, datetime, Decimal, pathlib.Path, collections.*, etc.) in the dependencies list
- Include third-party library types (requests, numpy, pandas, django.*, etc.) in the dependencies list`,

  /**
   * Python tiene dos bucles, y los dos admiten un `else` que corre cuando el
   * bucle termina sin `break`: es una rama más.
   */
  analyzerLoopKinds: `- \`for\` (\`for item in items\`) / \`while\` → add ONE entry to loops; a loop \`else\` (it runs when the loop ends WITHOUT \`break\`) adds TWO rows`,

  /**
   * Qué es la condición de cada bucle. Una comprensión no es un bucle de la
   * tabla, pero sus `if` sí son condiciones que probar.
   */
  analyzerLoops: `3. LOOPS — List every \`for\` and \`while\`:
   - For \`for item in iterable\`: condition = the iterable being iterated
   - For \`while\`: condition = the loop condition expression
   - Comprehensions and generator expressions (\`[x for x in items if x.ok]\`) are NOT loops — put their \`if\` conditions in the decision table`,

  /**
   * Lo que una prueba unitaria no puede alcanzar. A diferencia de Java, la
   * entrada de la consola y las variables de entorno sí se controlan con
   * `monkeypatch`, y `sys.exit` se prueba con `pytest.raises`: se dice para que
   * el analizador no las descarte.
   */
  analyzerUntestableBranches: `4.5. UNTESTABLE BRANCHES — Scan the method for conditions a unit test can NEVER reach:
   - Code under \`if __name__ == "__main__":\` → it never runs when the test imports the module
   - Branches that call os._exit(...) → it kills the test process
   - Branches that need a real network, a device or a GUI event loop (sockets, serial ports, tkinter mainloop)

   NOT untestable — do NOT list them: input(), sys.stdin, os.environ, time, random and print output are controlled with pytest's
   monkeypatch and capsys fixtures, and sys.exit(...) is tested with pytest.raises(SystemExit).

   For each branch guarded SOLELY by one of the untestable cases, add it to untestableBranches with a reason.
   The test generator will skip these entirely — no placeholder tests, no assert True.`,

  /**
   * Python no tiene modificadores de acceso: lo «privado» es una convención
   * del nombre. Se listan los nombres con `_` porque el generador tiene que
   * saber que los usa directamente, y los de `__` porque Python les cambia el
   * nombre.
   */
  analyzerPrivateMemberKinds: `A. Attributes the target method reads or writes whose name starts with \`_\` (instance attributes \`self._x\` and class attributes):
   kind = "attribute"
   Example: \`self._items\` → { name: "_items", kind: "attribute", type: "list[Item]" }   ← infer the type from how the code uses it

B. @property methods that COMPUTE a value the target method reads:
   kind = "property"
   CRITICAL: a property stores nothing — assigning it raises AttributeError when it has no setter.
   In the notes field, record the underlying attribute(s) the property reads from so the test generator
   knows what to set instead (e.g., "sums price of every element of self.items — set items").

C. Nested classes and enums declared INSIDE \`<class-name>\`:
   kind = "nestedType"
   List ALL members if it is an Enum.
   Example: \`class State(Enum): WAITING = 1; RUNNING = 2\` → { name: "State", kind: "nestedType", type: "Enum", nestedValues: ["WAITING","RUNNING"] }

D. \`<method-name>\` itself, if its name starts with \`_\`:
   kind = "method"
   With one \`_\` the test calls it directly; with two (and none at the end) Python renames it to \`_<class-name>__name\`.
   Example: \`def __clamp(self, value)\` → { name: "__clamp", kind: "method", type: "int", notes: "call as sut._<class-name>__clamp(value)" }`,

  /** Sin modificadores, solo cuentan los nombres con `_`. */
  analyzerDefaultVisibility: `- Python has NO access modifiers: list here ONLY names that start with \`_\` (the test still uses them directly; a \`__name\` needs the renamed form \`_<class-name>__name\`). Do NOT list names without a leading underscore`,

  /**
   * El equivalente Python de los campos que llenan `Start` y `Awake`: un
   * atributo que crea otro método y no `__init__`. En un objeto recién creado
   * no existe, y leerlo lanza `AttributeError`. Junto con eso, lo que la prueba
   * tiene que reemplazar para controlarlo.
   */
  analyzerLifecycleFields: `7. STATE THE TEST MUST PREPARE — Scan \`<class-name>\` and the target method for:
   a) attributes the target method reads that __init__ does NOT create — another method creates them (setup(), connect(), load()),
      a framework does, or code outside the class. On a new instance they do not exist: reading them raises AttributeError.
   b) calls the test must replace because it cannot control them otherwise: input(), sys.stdin, time.time/time.sleep/datetime.now,
      random.*, os.environ/os.getenv, open() of a fixed path, network calls.

   RULES for lateAttributes:
   - Include only attributes the target method uses
   - setBy = the method that creates it, or "outside the class"
   - notes = how to provide it in tests (e.g., "assign a StubRepository to sut.repository before the call")
   RULES for patchTargets:
   - call = the call as the method writes it (e.g., "random.randint(1, 6)")
   - target = the dotted name to patch WHERE THE MODULE UNDER TEST LOOKS IT UP:
     "random.randint" if the module does \`import random\`; "shop.dice.randint" if the module shop/dice.py does \`from random import randint\`
   - If there are none, return []`,

  /**
   * En Python la prueba es otro módulo y lo importa todo. La línea de la
   * clase bajo prueba la da la ficha; las demás se arman con la misma regla.
   */
  analyzerNamespaces: `8. IMPORTS — The test is a separate module and must import every project name it uses.
   For the class under test and every project class, function or enum the tests will reference, write the exact import line.
   Module path = the file path without the import root (\`src/\` when the project keeps its code there) and without \`.py\`,
   with \`/\` replaced by \`.\` (e.g., \`patterns/creational/pool.py\` declaring ObjectPool → \`from patterns.creational.pool import ObjectPool\`).
   If the context ends with a CLASS FACTS block, copy its import line for the class under test exactly.

   If no project name needs an import, return [].`,

  /**
   * Cómo se instancia cada clase. En Python la trampa no es un operador sino
   * lo que no se puede llamar: una clase abstracta y una enumeración. Y los
   * tipos de los argumentos se deducen, porque no están declarados.
   *
   * La regla del nombre de la clase auxiliar está también aquí, y no solo en
   * el generador y el validador: en la primera prueba con Ctrl+F5
   * (`PetShop.buy_pet`, 2026-10-24) el analizador sugirió `class TestPet(Pet)`,
   * el generador lo copió porque toma la lista previa como autoridad, y lo
   * tuvo que corregir el validador.
   */
  analyzerPreFlight: `A. TYPE INSTANTIATIONS — For EVERY class that the test will need to create
   (target class AND all helper types: collaborators, value objects, etc.):

   For each class, find its declaration in the assembled context and determine:
     pattern = "direct"    for regular classes, dataclasses and NamedTuples → ClassName(arguments)
     pattern = "factory"   when the class is meant to be created through a @classmethod or a module function (from_dict, create, get_instance)
     pattern = "subclass"  for abstract classes (@abstractmethod methods, Protocol) → a helper subclass in the test implementing every abstract method
     pattern = "member"    for Enum classes → use one of their members, never call the class

   WRONG: \`Shape()\` if Shape declares \`@abstractmethod def area(self)\`
   CORRECT: \`class _Square(Shape): def area(self): return 1.0\` and \`_Square()\`

   A helper class that the test defines must NOT have a name that starts with Test — pytest would try to collect it
   as a test class. Name it _Concrete<Type> or Stub<Type>, here and in constructorNotes:
   WRONG: "provide a subclass like class TestPet(Pet)"   CORRECT: "provide a subclass like class _ConcretePet(Pet)"

   For "direct" classes, copy the EXACT __init__ signature from the context:
     - Note ALL parameters without a default value; parameters after a bare \`*\` are keyword-only
     - "parameterless": true only if __init__ takes only self, or the class declares no __init__ and has no base class
     - "parameterless": false if any parameter has no default → MUST provide arguments
     - Dataclasses and NamedTuples: one parameter per field, in declaration order; fields with a default are optional

   constructorNotes: how to build the minimum valid argument, and its type INFERRED from how the class uses it,
     from default values, type hints and docstrings — Python declares no types
     e.g., "Order(order_id, items): order_id is a non-empty str (it is checked with \`if not order_id\`), items a list of Item — use 'A-1' and []"

B. COMPUTED PROPERTIES — For every @property the target method reads:
   Identify the underlying attribute(s) its body reads from.
   The test cannot assign the property — it must set the underlying attributes instead.`,

  /** Las comprobaciones finales que dependen del ecosistema. */
  analyzerVerification: `2. Count every \`for\` / \`while\` = N_loops → loops array must have exactly N_loops entries
3. For each attribute or method in the method body: does its name start with \`_\`? → add to privateMembers
4. Does \`<method-name>\` start with \`_\`? → add it to privateMembers with kind = "method"
5. Look for attributes the method reads that __init__ does not create → add to lateAttributes; and for input()/time/random/os.environ calls → add to patchTargets
6. For EVERY class used in tests: is it regular, a dataclass, abstract or an Enum? → determine direct, factory, subclass or member
7. For EVERY "direct" class: copy its exact __init__ signature → set parameterless correctly
8. For every input of the method: infer its type from how the method uses it when it has no type hint`,

  /** Lo que puede ser una dependencia en Python, más lo que no es del proyecto. */
  analyzerDependencyKinds: `class | dataclass | enum | function | module | external`,

  /** Los mismos bucles del apartado 3, ahora como valores del esquema. */
  analyzerLoopTypeValues: `for | while`,

  /** Las cuatro clases de `analyzerPrivateMemberKinds`. */
  analyzerMemberKinds: `attribute | property | nestedType | method`,

  /** Los campos `lateAttributes` y `patchTargets` de la extensión del esquema. */
  analyzerLifecycleFieldsSchema: `"lateAttributes": [
  { "name": "", "setBy": "method that creates it | outside the class", "notes": "" }
],
"patchTargets": [
  { "call": "", "target": "dotted name to patch where the module looks it up", "notes": "" }
],`,

  /**
   * El campo `requiredImports` de la extensión del esquema: las líneas
   * enteras, porque en Python la importación es una instrucción.
   */
  analyzerRequiredUsingsSchema: `"requiredImports": ["from shop.models import Item", "from shop.money import Money"],`,

  /** Ejemplo de rama inalcanzable con una llamada real de la biblioteca estándar. */
  analyzerUntestableBranchExample: `{ "condition": "config is None → os._exit(1)", "reason": "os._exit kills the test process" }`,

  /** Las cuatro formas de instanciar de `analyzerPreFlight`. */
  analyzerInstantiationPatterns: `direct | factory | subclass | member`,

  /** Qué anotar sobre el constructor, con el ejemplo en la forma de Python. */
  analyzerConstructorSignatureNote: `"constructorSignature": "null if factory, subclass or member, else exact signature e.g. __init__(self, repository, retries=3)",`,

  /** Por qué se eligió esa forma de instanciar. */
  analyzerInstantiationReason: `"reason": "regular class | dataclass | factory classmethod | abstract class | enum"`,

  /** Ejemplo de un valor calculado y de cómo controlarlo. */
  analyzerComputedPropertyExample: `"propertyName": "total",
"getterSummary": "sums price times quantity of every element of self.items",
"controlVia": "self.items (list of Item) — set items with known prices"`,
} satisfies PythonFragments;
