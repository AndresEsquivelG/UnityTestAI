import type { JavaFragments } from "./fragments";

/**
 * Fragmentos del validador de pruebas (`testValidatorPrompt.txt`).
 *
 * Cada uno es un punto de la lista que el validador recorre con veredicto, y
 * lleva su número dentro: si un adaptador no aportara el punto, la lista se
 * saltearía el número en vez de quedar con uno suelto.
 */
export const TEST_VALIDATOR_FRAGMENTS = {
  /**
   * El paquete va primero porque es el error que no se ve leyendo la clase:
   * una prueba en otro paquete compila igual, pero no ve los miembros sin
   * modificador.
   */
  validatorStructure: `1. STRUCTURE: Declares the same \`package\` as the class under test, and exactly ONE top-level test class`,

  /**
   * Las importaciones de JUnit 5 sin las cuales la prueba no compila, y la
   * regla de Java para las del proyecto: solo hace falta importar lo que está
   * en otro paquete.
   */
  validatorImports: `2. IMPORTS: All mandatory imports present — org.junit.jupiter.api.Test, org.junit.jupiter.api.Timeout and
   \`import static org.junit.jupiter.api.Assertions.*;\`, plus the import of every other JUnit annotation used
   (BeforeEach, AfterEach, DisplayName, TempDir).
   ALSO: read the \`package\` line of every project type the test uses. A type from a DIFFERENT package than
   the test needs its own \`import com.example.other.TypeName;\` — types of the SAME package and java.lang types do not.
   Missing import → "cannot find symbol" compile error — mark FAIL.`,

  /**
   * Lo que JUnit 5 exige de un método para tomarlo por prueba. Un método
   * `private` o `static` con `@Test` no se ejecuta, y no avisa.
   */
  validatorTestMethods: `3. TEST METHODS: Every test method is annotated with @Test from org.junit.jupiter.api (NOT org.junit.Test), returns void, takes no parameters, and is neither private nor static`,

  /**
   * Sin límite de tiempo, un método bajo prueba que no termina cuelga la
   * construcción entera. Va en la clase, una sola vez, para todas las pruebas.
   */
  validatorTimeout: `4. TIMEOUT: The test class is annotated with @Timeout(2), so a test stuck in a loop cannot hang the build`,

  /**
   * `assertNotNull` es la excepción habitual a la regla de una sola aserción,
   * y `assertAll` es la forma de JUnit 5 de esconder varias en una.
   */
  validatorAssertionNotes: `RULE: assertNotNull counts as 1. assertNotNull paired with any other assertion → FAIL.
assertAll(...) hides several assertions in one statement → FAIL.
When fixing: remove assertNotNull or move it to its own test method; split assertAll into separate test methods.`,

  /**
   * Pruebas que siempre pasan. Las de la última letra no fallan por la
   * aserción sino por el entorno: sin consola ni variables que la prueba
   * controle, la rama no se ejercita, y `System.exit` termina la máquina
   * virtual que corre las pruebas.
   */
  validatorFakeTests: `a) assertTrue(true) / assertFalse(false) — fake assertions that always pass
b) assertEquals(x, x) with the same expression on both sides — same problem
c) Tests whose only assertion is trivially true regardless of the code under test (e.g., assertNotNull(new Order()))
d) Tests that depend on console input (System.in), on environment variables (System.getenv) or that reach System.exit
   (they never exercise the branch they claim to test, and System.exit terminates the test JVM)
FIX: remove the entire test method — do NOT replace the fake assertion with a different assertion.
These branches are untestable in a plain unit test and must be omitted entirely.`,

  /**
   * Lo que en Java no se construye con `new`: una interfaz, una clase
   * abstracta sin cuerpo anónimo y una clase con todos sus constructores
   * privados. Las tres dan error de compilación.
   */
  validatorInstantiation: `8. NO new ON TYPES THAT CANNOT BE INSTANTIATED — scan every \`new XYZ(\` call in the file:
   For each, find the declaration of XYZ in the reference context.
   If XYZ is an interface or an abstract class and the call has NO anonymous class body → FAIL.
   If every constructor of XYZ is private → FAIL (it must be created through its static factory method).
   WRONG: new Shape()  when \`public abstract class Shape\`
   CORRECT: new Shape() { @Override public double area() { return 1.0; } }  or a concrete subclass from the context
   FIX: use a concrete subclass, an anonymous class, a lambda (functional interface) or the static factory.`,

  /**
   * El constructor que no existe es un error de compilación, con este mensaje
   * de `javac`.
   */
  validatorConstructorArgs: `9. NO MISSING CONSTRUCTOR ARGS — scan every \`new XYZ(\` call:
   Find the constructors of XYZ in the reference context.
   If no constructor matches the number and types of the arguments → FAIL ("constructor XYZ in class XYZ cannot be applied to given types").
   WRONG: new OrderService()  when only \`public OrderService(OrderRepository repository)\` exists
   CORRECT: new OrderService(repository)`,

  /**
   * Java no tiene propiedades: un valor calculado es un método, y pedirle a
   * la reflexión un campo con su nombre lanza `NoSuchFieldException`.
   */
  validatorComputedProperties: `10. NO getDeclaredField ON COMPUTED VALUES — scan every getDeclaredField("name") call:
    Find \`name\` in \`<class-name>\`. If there is no FIELD with that exact name (only a getter such as \`getName()\`
    that computes its value) → FAIL. getDeclaredField throws NoSuchFieldException for anything that is not a field.
    FIX: find the underlying field(s) the getter reads from and set those instead.`,

  /**
   * Arrancar un contenedor convierte la prueba unitaria en una de
   * integración: lenta, y dependiente de una configuración que la prueba no
   * controla.
   */
  validatorLifecycleCalls: `11. NO FRAMEWORK BOOTSTRAP: no @SpringBootTest, @ExtendWith, @RunWith, application contexts or dependency-injection containers — plain JUnit 5 unit tests only`,

  /** Las mismas ramas de `validatorFakeTests`, fuera de la cobertura exigible. */
  validatorUntestableBranches: `(skip branches that are only reachable via System.in input, System.getenv values or a call to System.exit — those are untestable)`,

  /**
   * Además de llaves y punto y coma, la excepción comprobada sin declarar:
   * con reflexión es el error de compilación más común.
   */
  validatorSyntax: `14. SYNTAX: No obvious compilation errors (unmatched braces, missing semicolons, undeclared variables, checked exceptions neither caught nor declared with \`throws\`)`,

  /** El mensaje de `javac` cuando hay código fuera de la clase. */
  validatorFileStructure: `15. NO CODE OUTSIDE THE CLASS ("class, interface, enum, or record expected" prevention):
    All fields, methods, and statements must be INSIDE the test class body.
    File structure must be: package → imports → @Timeout(2) → class → { ... }
    If any declaration exists before the class (other than package and imports) or after the closing } → FAIL`,

  /** Un archivo de prueba Java empieza por su línea `package`. */
  validatorOutputStart: `CRITICAL FORMAT RULE: correctedCode must start directly with \`package\` (or with \`import\` when the class under test has no package).`,
} satisfies JavaFragments;
