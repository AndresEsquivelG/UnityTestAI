import type { PythonFragments } from "./fragments";

/**
 * Fragmentos del corrector por chat (`chatFixerPrompt.txt`).
 *
 * Cuentan lo mismo que algunos puntos del validador, pero como instrucción
 * para corregir y no como punto con veredicto: son textos distintos porque los
 * dos agentes piden cosas distintas.
 *
 * La corrección automática le pasa al corrector los errores de la
 * comprobación de importabilidad, así que los mensajes que se nombran son los
 * de importar un archivo de Python: `ModuleNotFoundError`, `ImportError` y el
 * `NameError` de una línea a nivel de módulo.
 */
export const CHAT_FIXER_FRAGMENTS = {
  /** Cada error de importación, con lo que quiere decir y cómo se arregla. */
  fixerImports: `0. IMPORTS — ModuleNotFoundError, ImportError and NameError prevention:
   The test is a separate module: every project class, function or enum it uses MUST be imported.
   The class under test: copy EXACTLY the line "Import it in the test exactly like this" of the CLASS FACTS block, when the reference context has one.
   Other project names: import them from the module that DECLARES them (module path = the file path without the import root and without \`.py\`, \`/\` → \`.\`).
   "No module named 'x'" → the module path is wrong: use the CLASS FACTS line, never a shortened path.
   "cannot import name 'X' from 'm'" → X is not declared in m: import it from the module that declares it.
   "name 'X' is not defined" → add the missing import (the standard library too: import math, from decimal import Decimal).
   Always keep \`import pytest\` as the first line.`,

  /** Cómo controlar un valor calculado: llegar al atributo que lee la propiedad. */
  fixerComputedProperties: `0.5. COMPUTED PROPERTIES — never assign or call a @property:
   \`@property def total(self): return sum(i.price for i in self.items)\` stores nothing.
   \`sut.total = 5\` → AttributeError: property 'total' of 'Cart' object has no setter; \`sut.total()\` → TypeError: 'int' object is not callable.
   CORRECT approach: inspect the property body → find the underlying attribute(s) it reads → set THOSE.
   Example: \`total\` sums \`items\` → set sut.items to items with known prices.`,

  /**
   * Las dos causas de prueba imposible en Python juntas: lo que una prueba no
   * alcanza, y las clases que no se llaman directamente. El cierre repite la
   * lección de Java: el corrector no copia el código de la clase en la prueba.
   */
  fixerUntestableBranches: `0.6. UNTESTABLE BRANCHES:
   Code under \`if __name__ == "__main__":\`, code that calls os._exit(...) and code that needs a real network, device or
   GUI event loop cannot be exercised by a unit test.
   CORRECT fix: remove the test entirely.
   WRONG fix: keep the test with assert True or an empty body — that is a fake test.
   input(), sys.stdin and environment variables are NOT untestable: patch them with monkeypatch; sys.exit is tested with pytest.raises(SystemExit).

   ALSO — classes that cannot be called directly:
   Abstract classes (@abstractmethod, Protocol) → a helper subclass in the test module implementing EVERY abstract method.
   Enums → use a member (Color.RED), never Color(...) to create one.
   "TypeError: Can't instantiate abstract class X with abstract method m" → implement exactly m in the helper subclass.
   If the reference context ends with a CLASS FACTS block, it was read from the source code: import the class and create the
   instance exactly as it says, and never call, patch or override a method of that class that its method list does not contain.
   "AttributeError: 'X' object has no attribute 'm'" means m does not exist with that name: use a name from the method list,
   or prepare the attribute as the CLASS FACTS block says — do not invent another one.
   Do NOT copy code of the class under test into the test: call its real methods.`,

  /** La llamada con argumentos de menos, ahora como instrucción de corrección. */
  fixerConstructorArgs: `0.75. CONSTRUCTOR PARAMETERS:
   Before writing \`ClassName(...)\`, check its __init__ (or its dataclass fields) in the reference context.
   "missing 1 required positional argument" → pass every parameter without a default.
   "got an unexpected keyword argument" → that parameter does not exist: use the names of __init__.
   WRONG:  OrderService()   ← TypeError if only \`__init__(self, repository)\` exists
   CORRECT: OrderService(repository)`,

  /** Qué puede haber a nivel de módulo, con lo que pasa si no. */
  fixerFileStructure: `1. MODULE STRUCTURE:
   - imports first, then helper classes and @pytest.fixture functions, then the \`def test_...\` functions — all at module level
   - NO test class, NO unittest.TestCase, NO \`if __name__ == "__main__":\` block
   - nothing at module level that calls project code: it runs when pytest imports the file, and an error there stops every test
   - helper class names must not start with Test
   - VERIFY: 4-space indentation everywhere, and every line that opens a block ends with a colon`,

  /** Un archivo de prueba de pytest empieza por sus importaciones. */
  fixerOutputStart: `4. correctedCode must start with \`import pytest\` (or with another import line)`,

  /**
   * Ejemplo del resumen de una corrección, con un error concreto de Python.
   * Va dentro de un ejemplo entre comillas simples, así que no lleva comillas.
   */
  fixerSummaryExample: `Fixed ModuleNotFoundError: imported PetShop from patterns.creational.abstract_factory`,
} satisfies PythonFragments;
