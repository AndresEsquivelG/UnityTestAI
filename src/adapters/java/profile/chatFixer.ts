import type { JavaFragments } from "./fragments";

/**
 * Fragmentos del corrector por chat (`chatFixerPrompt.txt`).
 *
 * Cuentan lo mismo que algunos puntos del validador, pero como instrucción
 * para corregir y no como punto con veredicto: son textos distintos porque los
 * dos agentes piden cosas distintas.
 */
export const CHAT_FIXER_FRAGMENTS = {
  /** «cannot find symbol» es el error de `javac` por una importación que falta. */
  fixerImports: `0. IMPORTS — "cannot find symbol" prevention:
   The test declares the SAME package as the class under test, so types of that package need no import.
   Every project type from ANOTHER package (read the \`package\` line of its declaration in the reference context)
   MUST have \`import com.example.other.TypeName;\` at the top.
   JUnit 5: import each annotation from org.junit.jupiter.api and use \`import static org.junit.jupiter.api.Assertions.*;\`.
   Missing import → "cannot find symbol" for that type or assertion.`,

  /**
   * Cómo controlar un valor calculado: llegar al campo que lee el método en
   * lugar de buscar un campo que no existe.
   */
  fixerComputedProperties: `0.5. COMPUTED GETTERS — never use getDeclaredField on something that is not a field:
   A getter like \`public BigDecimal getTotal() { return items.stream()...; }\` has NO field called \`total\`.
   \`Order.class.getDeclaredField("total")\` throws NoSuchFieldException.
   CORRECT approach: inspect the getter body → find the underlying field(s) it reads from → set THOSE.
   Example: \`getTotal()\` sums \`items\` → add Item objects with known prices to \`items\`.`,

  /**
   * Las dos causas de prueba imposible en Java juntas: lo que la prueba no
   * puede controlar, y los tipos que no se construyen con `new`. El cierre
   * nombra el «has private access» de la prueba de `children`: el corrector
   * creyó que sobrescribir `get` era el arreglo y devolvió el mismo archivo.
   */
  fixerUntestableBranches: `0.6. UNTESTABLE BRANCHES:
   Code that reads System.in, depends on System.getenv(...) or calls System.exit(...) cannot be exercised
   by a plain unit test (System.exit even terminates the test JVM).
   CORRECT fix: remove the test entirely.
   WRONG fix: keep the test with assertTrue(true) or an empty body — that is a fake test.

   ALSO — types that cannot be created with \`new\`:
   Interfaces and abstract classes → use a concrete subclass from the context, an anonymous class or a lambda.
   Classes whose constructors are all private → use their static factory method (e.g., \`Money.of(10)\`).
   \`new PaymentGateway()\` when PaymentGateway is an interface → compile error.
   CORRECT: PaymentGateway gateway = amount -> true;  (functional interface) or new PaymentGateway() { ... }
   If the reference context ends with a CLASS FACTS block, it was read from the source code: create the instance
   exactly as its "How to create an instance" line says, and never @Override or call a method of that class
   that its method list does not contain. "method does not override or implement a method from a supertype"
   means that method does not exist: remove it, do not rename it.
   When that line says EMPTY body, the anonymous subclass must stay empty: delete every method inside it.
   "<field> has private access" inside an anonymous subclass means the test copied code from the class:
   delete that method from the subclass, because the class already implements it. Only when it is one of the
   abstract methods that CLASS FACTS lists, keep it and rewrite its body without that field.
   Overriding the method again is NOT a fix: the same line fails again.`,

  /** El constructor que no existe, ahora como instrucción de corrección. */
  fixerConstructorArgs: `0.75. CONSTRUCTOR PARAMETERS:
   Before writing \`new DependencyType()\`, check its constructors in the reference context.
   If only parameterized constructors exist, you MUST provide all required arguments.
   WRONG:  new OrderService()   ← compile error if only \`OrderService(OrderRepository)\` exists
   CORRECT: new OrderService(repository)`,

  /** Qué va dentro de la clase, con el mensaje de `javac` cuando no. */
  fixerFileStructure: `1. ALL code must be inside the test class body:
   - private fields, @BeforeEach, @AfterEach, helper methods, @Test methods — ALL inside { }
   - Only the \`package\` line and \`import\` lines may appear before the class declaration
   - NEVER place any declaration (field, method) after the class's closing }
   - "class, interface, enum, or record expected" is caused by code outside the class
   - VERIFY: scan the entire output and confirm there is exactly ONE top-level class, and no code outside it`,

  /** Un archivo de prueba Java empieza por su línea `package`. */
  fixerOutputStart: `4. correctedCode must start with \`package\` (or with \`import\` when the class under test has no package)`,

  /**
   * Ejemplo del resumen de una corrección, con un error concreto de `javac`.
   * Va dentro de un ejemplo entre comillas simples, así que no lleva comillas.
   */
  fixerSummaryExample: `Fixed cannot find symbol: added import com.example.model.Item`,
} satisfies JavaFragments;
