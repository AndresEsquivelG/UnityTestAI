import type { PythonFragments } from "./fragments";

/**
 * Fragmentos del generador de pruebas (`testGeneratorPrompt.txt`).
 *
 * Es la plantilla más larga y la que más conocimiento del ecosistema pide. En
 * Python las tres causas que más pesan son la importación equivocada del
 * módulo bajo prueba, que deja a pytest sin poder recolectar ninguna prueba del
 * archivo; la llamada con argumentos de menos, y el atributo que el objeto
 * todavía no tiene. Las dos últimas solo aparecen al ejecutar, donde ya no hay
 * corrección automática: por eso se insiste en copiar de la ficha.
 *
 * Las pruebas son funciones sueltas con `assert`, la forma de pytest, y no una
 * clase de `unittest`. La plantilla habla de «test methods» y de «test class»;
 * los fragmentos dicen qué es cada cosa aquí.
 */
export const TEST_GENERATOR_FRAGMENTS = {
  /** El marco sin variante: en pytest no hay motores que elegir, como Jupiter en JUnit 5. */
  generatorTestFramework: `pytest`,

  /**
   * Lo que el analizador deja resuelto, cada asunto en términos de Python. La
   * ficha de la clase va primero: la plantilla dice que el checklist manda, y
   * la ficha es lo único que manda sobre él (OP-18).
   */
  generatorPreFlightItems: `• CLASS FACTS block at the end of the context → read from the source code by the tool, so it outranks this checklist.
  Where they disagree — for example, the checklist says "direct" and the facts say "abstract class" — follow the facts,
  import the class exactly as its "Import it in the test exactly like this" line says,
  and create the instance exactly as its "How to create an instance" line says
• Type Instantiations → direct call vs helper subclass vs dataclass fields vs Enum member for EVERY class, including helpers
• Computed Properties → which underlying attributes to set instead of assigning a @property
• Untestable Branches → branches to OMIT entirely (no assert True, no placeholder tests)
• Required Imports → exact import lines for project modules
• Attributes set outside __init__ and Patch Targets → what to prepare before calling the method`,

  /**
   * Cómo decidir la forma de crear la clase bajo prueba y cada auxiliar.
   * Equivocarse no da un error antes de ejecutar: da `TypeError` al correr.
   */
  generatorInstantiationCheck: `Find the exact declaration of \`<class-name>\` in the context, and its CLASS FACTS block if there is one. It looks like one of:
  (a)  class <class-name>:  /  class <class-name>(Base):        ← regular class → <class-name>(arguments matching __init__)
  (b)  a class with @abstractmethod methods, or a Protocol       ← cannot be instantiated → helper subclass in the test
  (c)  @dataclass class <class-name>:  /  class <class-name>(NamedTuple):  ← one argument per field
  (d)  class <class-name>(Enum):                                 ← never call it → use a member, <class-name>.MEMBER

DECISION:
  Regular class → sut = <class-name>(arguments for __init__, without self)
  Abstract class → at module level, \`class _Concrete<class-name>(<class-name>):\` implementing EVERY abstract method minimally, then _Concrete<class-name>(...)
  Dataclass / NamedTuple → <class-name>(field1, field2, ...) in declaration order; fields with a default are optional
  Enum → <class-name>.MEMBER

If \`<method-name>\` is a @staticmethod or a @classmethod → call it as <class-name>.<method-name>(...) — no instance needed.

THIS SAME CHECK APPLIES TO EVERY CLASS YOU INSTANTIATE IN TESTS — not only the target class.
For every helper object you create in a fixture or in a test (collaborators, arguments, expected values):
  - Find its declaration in the assembled context
  - Abstract class or Protocol → a helper class in the test module with exactly the methods the target method calls
  - Regular class, dataclass or NamedTuple → ClassName(...) with arguments that match its __init__ or its fields
NEVER call an abstract class or an Enum directly.

Write your answer before continuing:
  "<class-name> declaration: [copy exact line] → [direct / subclass / dataclass fields / enum member / static call]"
  For each helper class used: "[ClassName] declaration: [copy exact line] → [direct / subclass / member]"`,

  /**
   * Las importaciones de la prueba. En Java declarar el paquete de la clase
   * evitaba importarla; en Python la prueba es otro módulo y lo importa todo,
   * empezando por la clase bajo prueba con la línea exacta de la ficha.
   */
  generatorNamespaceStep: `━━ STEP 0.1 — IMPORT CHECK (mandatory) ━━

The test is a SEPARATE module in the project's tests folder: it sees NOTHING of the project unless it imports it.

1. The class under test: copy EXACTLY the line "Import it in the test exactly like this" of the CLASS FACTS block.
   Never shorten it and never derive it from the file name alone.
2. For every other project class, function or enum you will reference (dependencies, helper types, enums):
   import it from the module that DECLARES it. Module path = the file path without the import root and without \`.py\`,
   with \`/\` replaced by \`.\` — the CLASS FACTS block says which import root this project uses.
3. Standard library: import every module you use (\`import math\`, \`from decimal import Decimal\`, \`import asyncio\`).

WRONG: \`from abstract_factory import PetShop\` for patterns/creational/abstract_factory.py
       → ModuleNotFoundError: No module named 'abstract_factory' — pytest cannot collect ANY test of the file
CORRECT: \`from patterns.creational.abstract_factory import PetShop\`

Rule: EVERY name the test uses and does not define → one import. A missing one → NameError when the test runs.
Write down the imports before continuing.`,

  /**
   * Python no tiene modificadores: todo se ve desde la prueba. Lo único que no
   * se alcanza con el nombre escrito es lo que Python renombra.
   */
  generatorDefaultVisibility: `Python has NO access modifiers: every attribute and method can be used DIRECTLY from the test.
A leading \`_\` is only a convention ("internal"): call \`sut._helper()\` and read \`sut._items\` directly.
Only names with TWO leading underscores and none at the end (\`__secret\`) are renamed by Python — see below.`,

  /**
   * Lo que en Java era el recetario de reflexión: aquí alcanza con el nombre,
   * salvo el de dos guiones bajos. Y las propiedades calculadas, que en Python
   * se rompen al asignarlas y no al buscarlas.
   */
  generatorReflection: `Renamed members (\`__name\` without trailing underscores, declared inside class ClassName):
  Python stores them as \`_ClassName__name\`:
    sut._ClassName__balance = 100       # set
    value = sut._ClassName__balance     # read
    sut._ClassName__recalculate()       # call
  WRONG: sut.__balance → AttributeError: 'ClassName' object has no attribute '__balance'
  ClassName is the class that DECLARES the member, even when the test uses a subclass.

Single-underscore members → use them directly: sut._cache = {}  /  sut._helper(3)

Class attributes (assigned in the class body, shared by every instance):
  read and set them through the class: ClassName.counter = 0
  change them only with monkeypatch.setattr(ClassName, "counter", 0) — it restores the original value after the test.

Do NOT use getattr/setattr with string names or the inspect module when a plain attribute access works.

COMPUTED PROPERTIES — a @property computes its value, it stores nothing:
  \`@property def total(self): return sum(i.price for i in self.items)\`
  \`sut.total = 5\` → AttributeError: property 'total' of 'Cart' object has no setter

  WRONG:  sut.total = 5
  CORRECT: Find the underlying attribute(s) the property reads from (here: \`items\`).
           Set those instead.`,

  /**
   * Lo que en Unity eran los mensajes del motor: métodos que no se llaman por
   * su nombre sino a través de una operación del lenguaje.
   */
  generatorEngineMessages: `B. METHODS PYTHON CALLS FOR YOU — special (dunder) methods run through an operation, not by name:
   __enter__ / __exit__ → \`with sut as value:\`       __iter__ / __next__ → \`for x in sut\` or \`next(iter(sut))\`
   __len__ → len(sut)        __eq__ / __lt__ → == / <        __str__ / __repr__ → str(sut) / repr(sut)
   __getitem__ → sut[key]    __contains__ → \`x in sut\`      __call__ → sut(...)
   __del__ → \`del sut\` does NOT guarantee that it runs: call sut.__del__() directly
   Test them through that operation. Call one by name only when the operation would hide the branch to test
   (for example __exit__ receiving an exception).

   WRONG: calling pool.__enter__() and then asserting on pool.item when the code is meant to be used in a \`with\`
   CORRECT:
     def test_enter_returns_the_first_item(pool):
         with pool as item:
             assert item == "first"`,

  /**
   * Cómo se nombra una clase o una enumeración anidada, y el error de Python
   * si se la nombra como si fuera del módulo.
   */
  generatorNestedEnums: `C. NESTED CLASSES AND ENUM MEMBERS — read the actual declaration before referencing:
   If Order declares \`class Status(Enum): NEW = 1; PAID = 2\` inside it,
   the correct access from the test is:
     CORRECT: status = Order.Status.PAID        (import only Order)
     WRONG:   status = Status.PAID              ← NameError: name 'Status' is not defined
   A module-level Enum is imported from its own module: \`from shop.models import Status\`.
   Rule: compare Enum members with \`is\` or \`==\` (\`assert result is Order.Status.PAID\`); \`.value\` is the raw value.`,

  /**
   * El equivalente de `Start` y `Awake`: un atributo que crea otro método. En
   * un objeto recién creado no existe, y la prueba revienta con
   * `AttributeError` al ejecutar, no antes.
   */
  generatorLifecycleFields: `D. ATTRIBUTES CREATED OUTSIDE __init__ — Python creates an attribute the first time it is assigned.
   An attribute that the target method reads but __init__ does NOT create (another method creates it — setup(), connect(),
   load() —, a framework does, or code outside the class) does NOT exist on a new instance: reading it raises AttributeError.
   The CLASS FACTS block lists them.

   For every such attribute that the target method uses:
   1. If the method that creates it is simple and has no side effects → call it in the fixture
   2. Else assign it directly: sut.attribute = value
   3. Collaborator objects → a minimal hand-written stub class with ONLY the methods the target method calls
   4. Plain values (str, int, bool, list…) → a valid test value of the type the method expects

   EXAMPLE (generalized):
     @pytest.fixture
     def sut():
         service = OrderService()
         # connect() would create it from a real database
         service.repository = StubRepository(known_order)
         return service`,

  /**
   * Confirmar la firma de `__init__` antes de escribir la llamada, y deducir
   * el tipo de cada argumento, que en Python no está declarado (HU-26). Una
   * colección que el código modifica tiene que ser nueva en cada prueba: el
   * mismo error que `Map.of` en Java, que solo aparece al ejecutar.
   */
  generatorConstructorParams: `E. CONSTRUCTOR PARAMETERS — MANDATORY PRE-FLIGHT before writing any setup code:

   List every class you plan to instantiate.
   For each: find its __init__ in the CLASS FACTS block or in the assembled context and COPY its signature.
   No __init__ in the class → it inherits the one of its base class: check that one. A dataclass → one parameter per field.
   Only after confirming the signature, write the call.

   WRONG:  OrderService()        ← TypeError: __init__() missing 1 required positional argument: 'repository'
   CORRECT: OrderService(stub_repository)

   WRONG:  Point(1, 2)           ← TypeError if the signature is \`__init__(self, *, x, y)\` (keyword-only after *)
   CORRECT: Point(x=1, y=2)

   INFER THE TYPES — Python declares none. Read how the method uses each value:
   - \`qty * price\` → numbers; \`items.append(x)\` → a list; \`name.strip()\` → a str; \`for k, v in data.items()\` → a dict
   - Default values, type hints and the docstring tell the expected type when they exist — use them
   - Build the minimum valid argument — only what the code's checks need (\`if not name: raise ValueError\` → a non-empty str)

   MUTABLE ARGUMENTS — a list, dict or set that the code modifies (append, update, add, pop — directly or through a method
   the test calls) MUST be a NEW object in every test: \`[]\`, \`{}\`, \`set()\` created inside the test or the fixture.
   A tuple, frozenset or str cannot be modified: \`.append\` on a tuple → AttributeError when the test runs.
     WRONG:  Catalog(items=())           ← Catalog.add calls self.items.append → AttributeError
     CORRECT: Catalog(items=[])
   Never share one mutable object between tests through a module-level variable.`,

  /** El cierre nombra lo que el apartado pidió anotar. */
  generatorScanClosing: `Write down the underscore members, the renamed (\`__name\`) members and the attributes created outside __init__ before continuing.`,

  /** Las palabras de bucle, con la forma que usa este apartado. */
  generatorLoopKeywords: `\`for\` / \`while\``,

  /**
   * Lo que una prueba unitaria nunca alcanza, y lo que en otros ecosistemas
   * no se controla pero en pytest sí: así el generador no omite ramas que se
   * pueden probar.
   */
  generatorUntestableBranches: `The following can NEVER be reached by a unit test — branches guarded ONLY by these can NEVER be taken:
  code under \`if __name__ == "__main__":\`   → it never runs when the test imports the module
  os._exit(...)                              → it kills the test process immediately
  a real network, device or GUI event loop   → not available in a unit test

These ARE testable — do NOT skip them:
  input() / sys.stdin       → monkeypatch.setattr("builtins.input", lambda *args: "value")
  os.environ / os.getenv    → monkeypatch.setenv("NAME", "value")  /  monkeypatch.delenv("NAME", raising=False)
  sys.exit(...)             → with pytest.raises(SystemExit):
  print(...) output         → the capsys fixture: capsys.readouterr().out
  time, random, datetime    → monkeypatch, where the module under test looks them up (see section 7)

RULE: Do NOT write a test for any branch that is only reachable through the first list.
      Do NOT use \`assert True\` or an empty test as a placeholder — these are INVALID.
      OMIT those test functions entirely. Untested branches of this kind are a known limitation.

If the ENTIRE method body is unreachable without them, note this and generate zero tests.`,

  /**
   * La forma del archivo: un módulo con funciones de prueba, que empieza por
   * `import pytest` y por la línea de la ficha. El nombre del archivo lo
   * decide OP-10; el de cada función solo tiene que empezar con `test_`.
   */
  generatorTestClassRules: `- Exactly ONE Python test module with plain module-level test FUNCTIONS — NO test class, NO unittest.TestCase
- First line: \`import pytest\`
- Then the import of the class under test, copied EXACTLY from the CLASS FACTS line "Import it in the test exactly like this"
- Then every other import identified in STEP 0.1 (project modules and the standard library)
- Test function names: test_<method-name>_<what it verifies>, in snake_case
- A wrong module path gives ModuleNotFoundError and pytest cannot run ANY test of the file;
  a missing import gives NameError when the test runs
- Write Python 3.8 compatible code unless the context already uses newer syntax (match, X | Y unions, ...)`,

  /**
   * Qué hace que pytest tome una función por prueba, y lo que la deja fuera
   * sin avisar: un nombre sin `test_`, o un `async def` sin el complemento.
   */
  generatorAttributeRules: `2. pytest test functions — RULES (read carefully)
   - Every test is a module-level function whose name starts with \`test_\` — pytest silently ignores any other name
   - Test functions take NO parameters except pytest fixtures: monkeypatch, capsys, tmp_path, or a fixture
     defined in this module with @pytest.fixture
   - Test functions are plain \`def\`, NEVER \`async def\`: pytest does not run them without a plugin.
     Run a coroutine with \`asyncio.run(sut.method(...))\` inside a plain test function
   - Do NOT use @pytest.mark.parametrize, skip or xfail — one plain test function per case
   - CORRECT:
       def test_buy_pet_returns_a_pet_with_that_name(shop):
           assert shop.buy_pet("Rex").name == "Rex"
   - WRONG (not collected, or not run):
       class TestShop(unittest.TestCase): ...   /   def check_buy_pet(): ...   /   async def test_buy(): ...`,

  /**
   * La regla de una sola aserción es neutra y se quedó en la plantilla; lo que
   * va aquí es cómo se escribe en pytest y la excepción de `pytest.raises`,
   * que comprueba sin tener ningún `assert`.
   */
  generatorAssertionRules: `- Each test function contains EXACTLY ONE assert statement — count it before writing
- \`with pytest.raises(ExpectedError):\` IS the assertion of an exception test: that test has ONLY the call inside the block, and NO assert
- \`assert a and b\`, or comparing a tuple to check two unrelated values, checks two things at once = INVALID
- \`assert x is not None\` IS an assertion — pairing it with any other assert gives 2 = INVALID
- If you need to verify two things, write two SEPARATE test functions, one assertion each
- Floats: compare with pytest.approx → assert result == pytest.approx(0.3)
- NO branching or loops inside test functions (no if/else, match, for, while, try/except, conditional expressions,
  comprehensions with if)
- Branching/loops allowed ONLY in fixtures and helper functions or classes
- WRONG:
    assert result is not None
    assert result.name == "Rex" ← TWO assertions = will be rejected
- RIGHT:
    assert result.name == "Rex" ← ONE assertion = valid`,

  /**
   * Lo que en Java era invocar por reflexión: cómo se llama lo renombrado, lo
   * estático y una propiedad, y cómo se comprueba una excepción sin aceptar
   * cualquiera.
   */
  generatorReflectionCalls: `4. Calling renamed, static and property members (read carefully)

   - Renamed methods: sut._ClassName__method(args) — ClassName is the class that DECLARES the method
   - @staticmethod / @classmethod: call them on the class: ClassName.method(args)
   - @property: read it WITHOUT parentheses: sut.total
     \`sut.total()\` → TypeError: 'int' object is not callable
   - To test that a method raises:
       CORRECT:
         with pytest.raises(ValueError):
             sut.withdraw(-1)
       WRONG:
         with pytest.raises(Exception):
             sut.withdraw(-1)
         ← too broad: it also passes when the call itself is wrong (TypeError, AttributeError)
   - Use the most specific exception class the code raises; add match="..." only when the message is part of the behavior`,

  /**
   * Cómo se prepara cada prueba sin tocar nada real. Los valores límite van
   * explícitos: en las corridas de Unity el generador elegía valores lejos del
   * límite y la prueba no distinguía `<= 1` de `<= 2`.
   */
  generatorSetupRules: `- Use a @pytest.fixture for repeated initialization — no duplicated code; use \`yield\` in the fixture when something must be undone after the test
- Do NOT touch real resources: no network, no database, no files outside tmp_path, no real sleeping (patch time.sleep)
- Prepare ALL attributes created outside __init__ identified in STEP 0.5 (call the method that creates them, or assign them)
- For empty-collection tests: create the empty collection in the test, NOT in the fixture
- For numeric inputs, include both positive and negative values where relevant, and the exact boundary of every comparison
  (for \`x <= 1\`: test 1 and 2, not 1 and 5)
- Temporary files only through the tmp_path fixture

SHARED STATE RESET — class attributes, module-level variables and shared state (singletons, the Borg pattern) survive between tests:
- If the method reads or writes them, set them with monkeypatch.setattr in the test or the fixture: it restores the original
  value after each test, so one test cannot change the result of another`,

  /** El punto de la lista de cobertura que nombra un bucle por su palabra. */
  generatorCoverageLoopItem: `□ Every \`for\` / \`while\`: one test with an empty iterable, one with a matching item, one where the loop exhausts without a match (and the loop's \`else\`, if it has one)`,

  /**
   * Qué se puede reemplazar y qué no (decisión de Andrés del 2026-10-24):
   * `monkeypatch` y `unittest.mock` solo para lo que la prueba no controla de
   * otra forma, como `System.in` en Java. Nunca la clase bajo prueba: la prueba
   * tiene que correr su código real.
   */
  generatorStubRules: `- monkeypatch (a pytest fixture) or unittest.mock are allowed ONLY for what the test cannot control otherwise:
  input(), sys.stdin, the clock (time.time, time.sleep, datetime.now), random numbers, environment variables,
  and files or network connections the code opens by itself
- Patch the name WHERE THE MODULE UNDER TEST LOOKS IT UP:
  the module does \`import random\` → monkeypatch.setattr(random, "randint", lambda a, b: 3)
  the module shop/dice.py does \`from random import randint\` → monkeypatch.setattr("shop.dice.randint", lambda a, b: 3)
- NEVER mock, patch or replace the class under test or any of its methods: the test must run its real code
- Do NOT use third-party mocking libraries (pytest-mock's mocker, flexmock, mockito): the project may not have them
- For project collaborators, write a minimal hand-made stub class (only the methods the target method calls) or use a real
  instance. Its name must NOT start with Test: pytest would try to collect it as a test class`,

  /** Lo que la prueba no debe tocar del código de producción para alcanzarlo. */
  generatorEncapsulationRule: `- Do NOT change production code from the test: no assigning methods on the class, no adding attributes the code does not use, no subclassing to change behavior (only to implement abstract methods)`,

  /** `try/except` es la construcción de Python; pytest trae `pytest.raises`. */
  generatorExceptionRule: `- Do NOT use try/except in test functions — use \`with pytest.raises(ExpectedError):\` for expected exceptions`,

  /**
   * Qué puede haber a nivel de módulo. Todo lo que está ahí corre cuando
   * pytest importa el archivo: un error en una de esas líneas deja a pytest sin
   * ninguna prueba del archivo.
   */
  generatorFileStructure: `11. MODULE STRUCTURE — "error during collection" and "collected 0 items" prevention
    Order: imports → helper stub classes and fixtures → test functions, ALL at module level.
    Nothing else at module level: no statement that calls project code (it runs when pytest imports the file, and an
    error there stops EVERY test of the file), no \`if __name__ == "__main__":\` block, no print.
    No test class: do NOT wrap the tests in \`class Test...:\` and do NOT subclass unittest.TestCase.
    VERIFY before outputting: scan from top to bottom and confirm that every line at column 0 is an import, a decorator,
    a \`def\`, a \`class\` of a helper whose name does not start with Test, a constant or a blank line, and that the
    indentation is 4 spaces everywhere.`,

  /** `pytest.raises` es la aserción que no tiene `assert`. */
  generatorAssertCountNote: `3. A test that checks an exception has ZERO assert lines: its \`with pytest.raises(...)\` block is its single assertion — do not add an assert to it`,

  /** Cuántos archivos admite la salida, y con qué empieza. */
  generatorOutputStructure: `- Exactly ONE Python module with plain test functions and no test class, starting with \`import pytest\``,
} satisfies PythonFragments;
