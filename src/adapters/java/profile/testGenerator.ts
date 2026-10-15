import type { JavaFragments } from "./fragments";

/**
 * Fragmentos del generador de pruebas (`testGeneratorPrompt.txt`).
 *
 * Es la plantilla más larga y la que más conocimiento del ecosistema pide.
 * Las tres causas de que una prueba Java no compile que más pesan aquí son la
 * importación que falta, la excepción comprobada que no se declara y el
 * `new` sobre algo que no se puede construir.
 */
export const TEST_GENERATOR_FRAGMENTS = {
  /** El marco con su motor: JUnit 5 corre sobre la plataforma Jupiter. */
  generatorTestFramework: `JUnit 5 (Jupiter)`,

  /**
   * Lo que el analizador deja resuelto, cada asunto en términos de Java. La
   * ficha de la clase va primero: la plantilla dice que el checklist manda, y
   * la ficha es lo único que manda sobre él (OP-18).
   */
  generatorPreFlightItems: `• CLASS FACTS block at the end of the context → read from the source code by the tool, so it outranks this checklist.
  Where they disagree — for example, the checklist says "concrete class" and the facts say "abstract class" — follow the facts,
  and create the instance exactly as its "How to create an instance" line says
• Type Instantiations → exact \`new\` vs static factory vs lambda/anonymous subclass for EVERY type, including helpers
• Computed Getters → which underlying fields to set instead of using getDeclaredField on a getter
• Untestable Branches → branches to OMIT entirely (no assertTrue(true), no placeholder tests)
• Required Imports → exact \`import ...;\` lines for project types from other packages
• Injected Fields → fields a framework would fill that must be set before calling the method`,

  /**
   * Cómo decidir la forma de construir el tipo bajo prueba y cada auxiliar.
   * Equivocarse da un error de compilación: `new` sobre una interfaz o sobre
   * una clase con los constructores privados.
   */
  generatorInstantiationCheck: `Find the exact declaration of \`<class-name>\` in the context. It looks like one of:
  (a)  public class <class-name>                ← concrete class → new <class-name>(...)
  (b)  public abstract class <class-name>       ← cannot be instantiated → anonymous subclass
  (c)  a class whose constructors are ALL private ← use its static factory method
  (d)  public record <class-name>(...)          ← canonical constructor with ALL components

DECISION:
  Concrete class with an accessible constructor → new <class-name>(arguments matching one of its constructors)
  Abstract class → new <class-name>(...) { /* implement EVERY abstract method minimally */ }
  Only private constructors → the static factory declared in the class (getInstance(), of(...), create(...), builder())
  Record → new <class-name>(component1, component2, ...)

If \`<method-name>\` is static → call it as <class-name>.<method-name>(...) — no instance needed.

THIS SAME CHECK APPLIES TO EVERY TYPE YOU INSTANTIATE IN TESTS — not only the target class.
For every helper type you create in @BeforeEach or in test methods (collaborators, arguments, expected values):
  - Find its declaration in the assembled context
  - Interface → a lambda if it has exactly one abstract method, otherwise an anonymous class
  - Abstract class → an anonymous subclass implementing EVERY abstract method
  - Concrete class or record → new TypeName(...) with arguments that match one of its constructors
NEVER call \`new\` on an interface or an abstract class without a class body.

Write your answer before continuing:
  "<class-name> declaration: [copy exact line] → [new / factory / subclass / static call]"
  For each helper type used: "[TypeName] declaration: [copy exact line] → [new / factory / subclass]"`,

  /**
   * El paquete de la prueba y sus importaciones. Declarar el mismo paquete
   * que la clase es lo que hace innecesaria la reflexión para casi todo.
   */
  generatorNamespaceStep: `━━ STEP 0.1 — PACKAGE & IMPORT CHECK (mandatory) ━━

The test file MUST declare the SAME package as \`<class-name>\` — copy its \`package\` line exactly.
That gives the test direct access to package-private and protected members, and makes imports
unnecessary for the types of that package.

For every other type you will reference in the test (dependencies, helper types, enums, records):
  1. Find its declaration in the context and read the \`package\` line of its file
  2. If it is in a DIFFERENT package, add \`import that.package.TypeName;\`
  3. Nested types are imported through their outer class: \`import com.example.Order.Status;\`

WRONG: using \`Money\` declared in \`package com.example.util;\` from a test in \`package com.example.orders;\` with no import
       → error: cannot find symbol  class Money
CORRECT: add \`import com.example.util.Money;\` after the package line

Rule: EVERY referenced project type from another package → one \`import ...;\` line. java.lang types need no import.
Write down the package and the imports before continuing.`,

  /**
   * En Java un miembro sin modificador es del paquete. Como la prueba está en
   * el mismo, solo lo `private` pide reflexión.
   */
  generatorDefaultVisibility: `In Java, a member with NO access modifier is PACKAGE-PRIVATE, and protected members are visible to the whole package:
the test is in the same package, so it uses both DIRECTLY. Only \`private\` members need reflection.`,

  /**
   * El recetario de reflexión de Java: campo, campo estático, método y tipo
   * anidado privado, y la regla que más pruebas salva de no compilar: la
   * reflexión lanza excepciones comprobadas.
   */
  generatorReflection: `Private field → NEVER access as \`obj.field\` → use java.lang.reflect.Field:
  Field f = ClassName.class.getDeclaredField("fieldName");
  f.setAccessible(true);
  f.set(instance, value);
  Object val = f.get(instance);

Private static field:
  Field f = ClassName.class.getDeclaredField("fieldName");
  f.setAccessible(true);
  f.set(null, value);
  NEVER modify a \`static final\` field via reflection — it fails; avoid changing \`final\` fields at all.

Private method → NEVER call as \`obj.method()\` → use java.lang.reflect.Method:
  Method m = ClassName.class.getDeclaredMethod("methodName", Param1Type.class, int.class);
  m.setAccessible(true);
  Object result = m.invoke(instance, param1, 42);   // instance = null for static methods

Private nested type (enum/class declared \`private\` inside the target class):
  NEVER reference it as \`ClassName.State\` from the test — it does not compile
  Class<?> stateType = Class.forName("com.example.ClassName$State");
  @SuppressWarnings({"unchecked", "rawtypes"})
  Object waiting = Enum.valueOf((Class) stateType, "WAITING");

Reflection throws CHECKED exceptions (NoSuchFieldException, IllegalAccessException, NoSuchMethodException,
InvocationTargetException, ClassNotFoundException): EVERY method that uses reflection — @BeforeEach, helpers
and @Test methods — MUST declare \`throws Exception\`.

Cache Field / Method lookups in fields set in @BeforeEach — never repeat them inline in every test.

COMPUTED GETTERS — a getter that computes its value has NO field with its name:
  \`public BigDecimal getTotal() { return items.stream()...; }\`  ← no field called total
  \`Order.class.getDeclaredField("total")\` → NoSuchFieldException

  WRONG:  getDeclaredField("total").set(order, value)  ← throws
  CORRECT: Find the underlying field(s) the getter reads from (here: \`items\`).
           Set/populate those fields instead.`,

  /**
   * Lo que en Unity eran los mensajes del motor: métodos que en producción
   * llama otro, y que en una prueba unitaria no llama nadie.
   */
  generatorEngineMessages: `B. METHODS A FRAMEWORK WOULD CALL — @PostConstruct methods, event listeners, \`run()\` of a Runnable:
   in a unit test NOTHING calls them automatically.
   If the target method depends on state that a @PostConstruct method prepares, call that method yourself
   in @BeforeEach (directly if it is not private, via reflection if it is).

   WRONG: assuming \`init()\` already ran because it is annotated @PostConstruct
   CORRECT:
     @BeforeEach
     void setUp() throws Exception {
       sut = new CatalogService(stubRepository);
       sut.init();
     }`,

  /**
   * Cómo se nombra la constante de una enumeración anidada desde otra clase,
   * con el error de `javac` si se omite el tipo exterior.
   */
  generatorNestedEnums: `C. NESTED ENUMS — read the actual declaration before referencing:
   If Order declares \`public enum Status { NEW, PAID, SHIPPED }\` inside it,
   the correct access from the test is:
     CORRECT: Order.Status status = Order.Status.PAID;
     WRONG:   Status status = PAID;            ← cannot find symbol
   Rule: Always qualify nested enum constants as \`OuterClass.EnumName.CONSTANT\`, unless the nested enum is imported`,

  /**
   * El equivalente de `Start` y `Awake`: lo que llena un contenedor de
   * inyección. Incluye el ejemplo de preparación, que es la parte del prompt
   * que más forma le da al código generado.
   */
  generatorLifecycleFields: `D. INJECTED FIELDS — fields annotated @Autowired, @Inject, @Resource or @Value, and fields assigned only in a
   @PostConstruct method, are NULL when the test creates the object with \`new\`: no container runs in a unit test.

   For every such field that the target method uses:
   1. If the class receives it through a constructor parameter → pass it to the constructor
   2. Else if it has a setter → call the setter in @BeforeEach
   3. Else set it via reflection in @BeforeEach (Field.setAccessible(true) + set)
   4. Provide a minimal hand-written stub: a lambda or an anonymous class implementing EVERY abstract method
      of the field's type — check its declaration in the context
   5. @Value fields (String, int, boolean…) → set them to a valid test value

   EXAMPLE (generalized):
     @BeforeEach
     void setUp() throws Exception {
       sut = new TargetClass();

       // Provide the repository the container would have injected
       Field repository = TargetClass.class.getDeclaredField("repository");
       repository.setAccessible(true);
       repository.set(sut, (OrderRepository) id -> Optional.of(knownOrder));
     }`,

  /**
   * Confirmar la firma del constructor antes de escribir la llamada. En Java
   * la versión del lenguaje también importa: `List.of` no existe en Java 8.
   */
  generatorConstructorParams: `E. CONSTRUCTOR PARAMETERS — MANDATORY PRE-FLIGHT before writing any setup code:

   List every type you plan to instantiate with \`new\`.
   For each: find its class or record definition in the assembled context and COPY its constructor signature.
   Only after confirming the constructor signature, write the \`new\` call.

   WRONG:  new OrderService()        ← compile error if only \`public OrderService(OrderRepository repository)\` exists
   CORRECT: new OrderService(stubRepository)

   WRONG:  new Item("pen")           ← compile error if the record is \`record Item(String name, BigDecimal price)\`
   CORRECT: new Item("pen", new BigDecimal("1.50"))

   Rules for complex constructor arguments:
   - Build the minimum valid argument — only what the constructor's validations need
   - If the constructor checks its arguments (Objects.requireNonNull, if (...) throw), satisfy those checks
   - Build collections with \`new ArrayList<>(Arrays.asList(...))\` — use \`List.of(...)\` only if the context already does (it needs Java 9+)`,

  /** El cierre nombra los campos inyectados, así que se va con ellos. */
  generatorScanClosing: `Write down the list of private members and injected fields before continuing.`,

  /** Las palabras de bucle, con la forma que usa este apartado. */
  generatorLoopKeywords: `\`for\` / for-each / \`while\``,

  /**
   * Lo que una prueba unitaria nunca controla, y la orden de omitir esas
   * pruebas en lugar de rellenarlas con una aserción falsa.
   */
  generatorUntestableBranches: `The following can NEVER be controlled by a plain unit test — branches guarded ONLY by these can NEVER be taken:
  System.in reads (Scanner, BufferedReader)  → there is no console input during a test
  System.getenv(...)                         → fixed by the machine, not by the test
  System.exit(...)                           → terminates the JVM and aborts the whole test run

RULE: Do NOT write a test for any branch that is only reachable via these calls.
      Do NOT use assertTrue(true) or an empty test as a placeholder — these are INVALID.
      OMIT those test methods entirely. Untested branches of this kind are a known limitation.

If the ENTIRE method body is unreachable without them, note this and generate zero tests.`,

  /**
   * Paquete, nombre de la clase e importaciones obligatorias. El nombre que se
   * pide, `Test_<clase>_<método>`, no es el definitivo: OP-10 decide el del
   * archivo y OP-11 renombra la clase y corrige el paquete.
   */
  generatorTestClassRules: `- Exactly ONE Java file, exactly ONE top-level test class
- First line: the SAME \`package\` declaration as \`<class-name>\` (omit it only if \`<class-name>\` has no package line)
- Class name: Test_<class-name>_<method-name>, annotated with @Timeout(2)
- MANDATORY imports — ALL must be present in every generated file, no exceptions:
    import org.junit.jupiter.api.AfterEach;
    import org.junit.jupiter.api.BeforeEach;
    import org.junit.jupiter.api.DisplayName;
    import org.junit.jupiter.api.Test;
    import org.junit.jupiter.api.Timeout;
    import static org.junit.jupiter.api.Assertions.*;
- ADDITIONALLY: add \`import ...;\` for every project type from another package identified in STEP 0.1,
  and for every JDK type outside java.lang (java.util.List, java.math.BigDecimal, java.lang.reflect.Field…).
  A missing import causes "cannot find symbol" and the whole file fails to compile.
- Write Java 8 compatible code unless the context already uses newer syntax (var, records, text blocks, List.of)`,

  /**
   * Qué marca a un método como prueba en JUnit 5 y qué lo deja fuera sin
   * avisar: la anotación de JUnit 4 no se ejecuta en la plataforma Jupiter.
   */
  generatorAttributeRules: `2. JUnit 5 tests — ANNOTATION RULES (read carefully)
   - Every test method MUST be annotated with @Test from org.junit.jupiter.api — NOT org.junit.Test (JUnit 4)
   - Test methods return void, take no parameters, and are NOT private and NOT static
   - CORRECT:
       @Test
       @DisplayName("what this test verifies")
       void returnsZeroWhenCartIsEmpty() throws Exception { ... }
   - WRONG (JUnit 4 — the JUnit 5 platform silently ignores these tests):
       @org.junit.Test  /  @Before  /  @After  /  @RunWith(...)
   - Use @BeforeEach / @AfterEach (not @Before / @After); @BeforeAll / @AfterAll only on static methods
   - @Timeout(2) goes ONCE on the class — do NOT repeat it on each method`,

  /**
   * La regla de una sola aserción es neutra y se quedó en la plantilla; lo que
   * se va es cómo se llaman las aserciones de JUnit 5 y cuáles agrupan varias.
   */
  generatorAssertionRules: `- Each test method contains EXACTLY ONE assertion — count it before writing
- assertNotNull IS an assertion — using it alongside any other assertion gives 2 assertions = INVALID
- assertAll(...) groups several assertions — it is NOT allowed
- If you need to verify two things, write two SEPARATE test methods, one assertion each
- To verify an exception, the single assertion is assertThrows(ExpectedException.class, () -> sut.method(args))
- NO branching or loops inside test methods (no if/else, switch, for, while, try/catch)
- Branching/loops allowed ONLY in @BeforeEach, @AfterEach, and private helper methods
- WRONG:
    assertNotNull(result);
    assertTrue(result.isEmpty()); ← TWO assertions = will be rejected
- RIGHT:
    assertTrue(result.isEmpty()); ← ONE assertion = valid`,

  /**
   * Cómo invocar un método privado sin caer en la sobrecarga equivocada, y
   * cómo llega envuelta la excepción que lanza.
   */
  generatorReflectionCalls: `4. Calling private methods via reflection — getDeclaredMethod rules (read carefully)

   ALWAYS pass the exact parameter types to getDeclaredMethod:
       Method m = ClassName.class.getDeclaredMethod("methodName", ParamType.class, int.class);
       m.setAccessible(true);
       no-parameter:   ClassName.class.getDeclaredMethod("methodName")

   WHY: getDeclaredMethod matches the parameter types exactly, and that is how overloads are told apart.
   A wrong type (Integer.class instead of int.class) throws NoSuchMethodException at runtime.

   - Store the Method in a field during @BeforeEach to avoid repetition
   - Only private methods need this: package-private, protected and public methods are called directly
   - CRITICAL — exception wrapping: when the invoked method throws, Method.invoke wraps it inside
     InvocationTargetException. The original exception is its getCause()
   - To test that a private method throws:
       CORRECT:
         assertThrows(InvocationTargetException.class, () -> method.invoke(sut, args));
       WRONG:
         assertThrows(IllegalArgumentException.class, () -> method.invoke(sut, args))
         ← Fails because invoke wraps the exception in InvocationTargetException`,

  /**
   * Cómo se prepara cada prueba sin arrancar nada. Los valores límite van
   * explícitos: en las corridas de Unity el generador elegía valores lejos del
   * límite y la prueba no distinguía `<= 1` de `<= 2`.
   */
  generatorSetupRules: `- Use @BeforeEach / @AfterEach for repeated initialization — no duplicated code
- Do NOT start frameworks or containers: no Spring context, no database, no network, no file paths outside @TempDir
- Initialize ALL injected fields identified in STEP 0.5 (constructor, setter or reflection)
- For empty-collection tests: create the empty collection in the test, NOT in @BeforeEach
- For numeric inputs, include both positive and negative values where relevant, and the exact boundary of every comparison
  (for \`x <= 1\`: test 1 and 2, not 1 and 5)
- Temporary files only through @TempDir (org.junit.jupiter.api.io.TempDir)

STATIC STATE RESET — Always clean up static fields in @AfterEach:
- If the method reads or writes static fields (e.g., a counter or a cache), reset them to their
  initial value in @AfterEach to prevent test pollution`,

  /** El punto de la lista de cobertura que nombra un bucle por su palabra. */
  generatorCoverageLoopItem: `□ Every \`for\` / for-each / \`while\`: one test with an empty collection, one with a matching item, one where the loop exhausts without a match`,

  /**
   * Sin bibliotecas de dobles: el proyecto puede no tenerlas, y entonces la
   * prueba no compila. Los dobles se escriben a mano.
   */
  generatorStubRules: `- Do NOT use mocking libraries (Mockito, EasyMock, JMockit): the project may not have them, and the file would not compile
- Do NOT redefine JDK or third-party types (java.*, org.springframework.*, etc.)
- Write minimal hand-made stubs only for project collaborators: a lambda for a functional interface,
  otherwise an anonymous class implementing EVERY abstract method
- final classes cannot be subclassed — use a real instance of them`,

  /** Lo que la prueba no debe tocar del código de producción para alcanzarlo. */
  generatorEncapsulationRule: `- Do NOT add getters, setters or constructors to production classes, and do NOT widen visibility to make them testable`,

  /** `try/catch` es la construcción de Java; JUnit 5 trae `assertThrows`. */
  generatorExceptionRule: `- Do NOT use try/catch in test methods — use assertThrows for expected exceptions and declare \`throws Exception\` for checked ones`,

  /** El mensaje de `javac` cuando hay código fuera de la clase. */
  generatorFileStructure: `11. ALL code must be inside the test class — "class, interface, enum, or record expected" prevention
    The only content allowed OUTSIDE the class is the \`package\` line and \`import\` lines.
    Structure: package → imports → @Timeout(2) → class Test_... { ALL code here }
    NEVER place field declarations, methods, or any statement before the class declaration or after its closing }.
    VERIFY before outputting: scan from top to bottom and confirm there is exactly ONE top-level class and
    zero declarations outside it. A single misplaced method makes the entire file fail to compile.`,

  /** `assertNotNull` cuenta como aserción: el modelo suele pasarlo por alto. */
  generatorAssertCountNote: `3. assertNotNull counts as 1 — if you pair it with another assertion you already have 2`,

  /** Cuántos archivos y clases admite la salida, y con qué empieza. */
  generatorOutputStructure: `- Exactly ONE file, exactly ONE top-level test class, starting with its \`package\` line`,
} satisfies JavaFragments;
