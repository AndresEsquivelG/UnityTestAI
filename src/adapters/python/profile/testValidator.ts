import type { PythonFragments } from "./fragments";

/**
 * Fragmentos del validador de pruebas (`testValidatorPrompt.txt`).
 *
 * Cada uno es un punto de la lista que el validador recorre con veredicto, y
 * lleva su número dentro: si un adaptador no aportara el punto, la lista se
 * saltearía el número en vez de quedar con uno suelto.
 *
 * En Python el validador es la última revisión antes de ejecutar: no hay
 * compilador, y la comprobación de importabilidad solo atrapa lo que falla al
 * importar el archivo. Por eso insiste en lo que falla al correr: argumentos,
 * nombres y atributos que no existen.
 */
export const TEST_VALIDATOR_FRAGMENTS = {
  /** Un módulo con funciones de prueba, que es lo que recolecta pytest. */
  validatorStructure: `1. STRUCTURE: One Python module with plain module-level test functions — no test class (no \`class Test...\`, no unittest.TestCase)`,

  /**
   * La importación de la clase bajo prueba es la que deja a pytest sin poder
   * recolectar el archivo entero; la ficha trae la línea exacta.
   */
  validatorImports: `2. IMPORTS: \`import pytest\` is present when pytest.raises, pytest.approx or @pytest.fixture is used, and the class under test is
   imported EXACTLY as the CLASS FACTS line "Import it in the test exactly like this" says (when the reference context has that block).
   ALSO: every other name the test uses — project classes, functions and enums, standard library modules (math, decimal,
   datetime, asyncio…) — is imported or defined in the module.
   Missing import → NameError when the test runs; wrong module path → ModuleNotFoundError and pytest collects NO test of the file — mark FAIL.`,

  /**
   * Lo que pytest exige de una función para tomarla por prueba. Un nombre sin
   * `test_` o un `async def` sin complemento no corren, y no avisan.
   */
  validatorTestMethods: `3. TEST FUNCTIONS: Every test is a module-level \`def test_...\` (plain def, not async def), takes no parameters other than pytest
   fixtures (monkeypatch, capsys, tmp_path, or fixtures defined in the module), and is not decorated with parametrize, skip or xfail`,

  /**
   * pytest no trae un límite de tiempo sin un complemento. Lo que puede colgar
   * una prueba es lo que espera algo de afuera, y eso se reemplaza.
   */
  validatorTimeout: `4. NO HANGING: no test can block — every input(), sys.stdin read, time.sleep and network call the method makes is patched, and no test drives an unbounded \`while True\` loop`,

  /**
   * `assert x is not None` es la excepción habitual a la regla de una sola
   * aserción, y `pytest.raises` es una aserción sin la palabra `assert`.
   */
  validatorAssertionNotes: `RULE: \`assert x is not None\` counts as 1. Paired with any other assert → FAIL.
A test whose only check is a \`with pytest.raises(...)\` block counts as 1 → PASS, even though none of its lines contains "assert";
a test with pytest.raises AND an assert → FAIL.
\`assert a and b\` checks two things in one statement → FAIL.
When fixing: remove the extra check or move it to its own test function; split combined asserts into separate test functions.`,

  /**
   * Pruebas que siempre pasan, y las que dicen probar una rama que una prueba
   * no puede alcanzar.
   */
  validatorFakeTests: `a) assert True / assert 1 — fake assertions that always pass
b) assert x == x with the same expression on both sides — same problem
c) Tests whose only assertion is trivially true regardless of the code under test (e.g., assert Order() is not None)
d) Tests that claim to exercise code under \`if __name__ == "__main__":\` or a branch that reaches os._exit
   (the first never runs on import, and os._exit kills the test process)
FIX: remove the entire test function — do NOT replace the fake assertion with a different assertion.
These branches are untestable in a unit test and must be omitted entirely.`,

  /**
   * Lo que en Python no se llama directamente: una clase abstracta y una
   * enumeración. Las dos dan error al ejecutar, no antes.
   */
  validatorInstantiation: `8. NO CALLS ON CLASSES THAT CANNOT BE INSTANTIATED — scan every \`ClassName(\` call in the file:
   For each, find the declaration of ClassName in the reference context.
   If ClassName is abstract (declares @abstractmethod methods, or is a Protocol) and is called directly → FAIL
   (TypeError: Can't instantiate abstract class).
   If ClassName is an Enum and is called to create a member → FAIL (use ClassName.MEMBER).
   WRONG: Shape()  when \`class Shape(ABC)\` declares \`@abstractmethod def area(self)\`
   CORRECT: a helper \`class _Square(Shape):\` that implements area, then _Square()
   FIX: use a concrete subclass from the context, or a helper subclass in the test module implementing EVERY abstract method.
   If the reference context ends with a CLASS FACTS block, it was read from the source code and is exact:
   a method of the class under test that the test calls or overrides and that is missing from its method list → FAIL (that method does not exist).`,

  /** La llamada con argumentos de menos, con el mensaje de Python. */
  validatorConstructorArgs: `9. NO MISSING CONSTRUCTOR ARGS — scan every \`ClassName(...)\` call:
   Find the __init__ of ClassName in the reference context, or its fields if it is a dataclass.
   If the call does not pass every parameter without a default, or passes a keyword that does not exist → FAIL
   ("TypeError: __init__() missing 1 required positional argument").
   WRONG: OrderService()  when \`def __init__(self, repository)\`
   CORRECT: OrderService(repository)`,

  /**
   * Una propiedad calculada no se asigna ni se llama: las dos cosas fallan al
   * ejecutar.
   */
  validatorComputedProperties: `10. NO ASSIGNMENT TO COMPUTED PROPERTIES — scan every \`obj.name = ...\` and every \`obj.name()\`:
    Find \`name\` in \`<class-name>\`. If it is a @property without a setter and the test assigns it → FAIL
    (AttributeError: property has no setter). If the test calls a @property with parentheses → FAIL (TypeError: not callable).
    FIX: find the underlying attribute(s) the property reads from and set those instead; read the property without parentheses.`,

  /**
   * Levantar una aplicación convierte la prueba unitaria en una de
   * integración: lenta, y dependiente de una configuración que la prueba no
   * controla.
   */
  validatorLifecycleCalls: `11. NO FRAMEWORK BOOTSTRAP: no Django or Flask test clients, application factories, database sessions, servers or dependency-injection containers — plain pytest unit tests only`,

  /** Las mismas ramas de `validatorFakeTests`, fuera de la cobertura exigible. */
  validatorUntestableBranches: `(skip branches that are only reachable under \`if __name__ == "__main__":\`, through os._exit, or with a real network, device or GUI event loop — those are untestable; input(), environment variables and sys.exit ARE testable with monkeypatch and pytest.raises)`,

  /** Lo que en Python rompe el archivo antes de correr una sola prueba. */
  validatorSyntax: `14. SYNTAX: No obvious Python errors (inconsistent indentation, missing colons, unclosed brackets or strings, names used before they are defined or imported, \`self\` in a module-level function)`,

  /** Todo lo que está a nivel de módulo corre al importar el archivo. */
  validatorFileStructure: `15. MODULE STRUCTURE ("error during collection" prevention):
    Order: imports → helper classes and fixtures → test functions, all at module level.
    A statement at module level that calls project code, an \`if __name__ == "__main__":\` block or a test class → FAIL.
    A helper class whose name starts with Test → FAIL (pytest tries to collect it as a test class).`,

  /** Un archivo de prueba de pytest empieza por sus importaciones. */
  validatorOutputStart: `CRITICAL FORMAT RULE: correctedCode must start directly with \`import pytest\` (or with another import line).`,
} satisfies PythonFragments;
