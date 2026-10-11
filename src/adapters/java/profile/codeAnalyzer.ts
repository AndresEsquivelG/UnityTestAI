import type { JavaFragments } from "./fragments";

/**
 * Fragmentos del analizador de código (`codeAnalyzerPrompt.txt`).
 *
 * Varios describen campos del análisis que solo existen en Java —los campos
 * inyectados, las importaciones de otro paquete y las decisiones de
 * instanciación—. Esos campos los declara la extensión del esquema
 * (`analysisSchema.ts`, OP-09): sin ella, lo que el modelo calcula se
 * descartaría al validar la respuesta y no llegaría al generador.
 */
export const CODE_ANALYZER_FRAGMENTS = {
  /**
   * Mismo conocimiento que `ignoredTypes`, enunciado como qué no entra en la
   * lista de dependencias.
   */
  analyzerIgnoredTypes: `- Include Java standard library types (java.*, javax.*: String, List, Optional, BigDecimal, etc.) in the dependencies list
- Include third-party library and framework types (org.springframework.*, jakarta.*, org.apache.*, lombok.*, etc.) in the dependencies list`,

  /** Java tiene cuatro formas de bucle; el for-each es la de las colecciones. */
  analyzerLoopKinds: `- \`for\` / for-each (\`for (Item item : items)\`) / \`while\` / \`do-while\` → add ONE entry to loops`,

  /**
   * Qué es la condición de cada bucle. Un `stream()` no es un bucle de la
   * tabla, pero sus lambdas sí tienen condiciones que probar.
   */
  analyzerLoops: `3. LOOPS — List every \`for\`, for-each, \`while\` and \`do-while\`:
   - For for-each (\`for (Item item : items)\`): condition = collection being iterated
   - For \`for\`/\`while\`/\`do-while\`: condition = loop condition expression
   - Stream pipelines (\`items.stream().filter(...)\`) are NOT loops — put the conditions of their lambdas in the decision table`,

  /**
   * Lo que una prueba unitaria no puede controlar. Es el equivalente de la
   * entrada de Unity en PlayMode: si el analizador no lo marca, el generador
   * escribe una prueba que siempre pasa.
   */
  analyzerUntestableBranches: `4.5. UNTESTABLE BRANCHES — Scan the method for conditions a plain unit test can NEVER control:
   - Values read from System.in (Scanner(System.in), BufferedReader on System.in) → no console input in a test
   - System.getenv(...) → fixed by the machine, not by the test
   - Branches that call System.exit(...) → terminating the JVM kills the whole test run

   For each branch guarded SOLELY by one of the above, add it to untestableBranches with a reason.
   The test generator will skip these entirely — no placeholder tests, no assertTrue(true).`,

  /**
   * Las cuatro clases de miembro que la prueba alcanza por reflexión. Solo
   * cuentan los `private`: la prueba vive en el mismo paquete y ve el resto.
   */
  analyzerPrivateMemberKinds: `A. Fields declared \`private\` that the target method reads or writes:
   kind = "field"
   Example: \`private final List<Item> items\` → { name: "items", kind: "field", type: "List<Item>" }

B. Methods declared \`private\` that COMPUTE a value the target method reads (e.g., \`private BigDecimal getTotal()\`):
   kind = "getter"
   CRITICAL: there is NO field with the getter's name — \`getDeclaredField("total")\` throws NoSuchFieldException.
   In the notes field, record the underlying field(s) the getter reads from so the test generator
   knows what to manipulate instead (e.g., "sums price of every element of items — set items").

C. Nested types (enum, record, class, interface) declared \`private\` INSIDE \`<class-name>\`:
   kind = "nestedType"
   List ALL constants if it is an enum.
   Example: \`private enum State { WAITING, RUNNING }\` → { name: "State", kind: "nestedType", type: "enum", nestedValues: ["WAITING","RUNNING"] }

D. \`<method-name>\` itself, if it is declared \`private\`:
   kind = "method"
   The test cannot call it directly — it must invoke it via reflection.
   Example: \`private int clamp(int value)\` → { name: "clamp", kind: "method", type: "int" }`,

  /**
   * En Java un miembro sin modificador es del paquete, y `protected` también
   * se ve dentro del paquete. Como la prueba está en el mismo, no los
   * necesita por reflexión.
   */
  analyzerDefaultVisibility: `- In Java, a member with NO access modifier is package-private, and \`protected\` members are also visible inside the package: the test lives in the SAME package, so do NOT list them — only \`private\` members go here`,

  /**
   * El equivalente Java de `Start` y `Awake`: lo que llena un contenedor de
   * inyección y no el constructor. Con `new`, en una prueba, queda en nulo.
   */
  analyzerLifecycleFields: `7. INJECTED FIELDS — Scan \`<class-name>\` for fields that a framework fills in instead of the constructor:
   fields annotated @Autowired, @Inject, @Resource, @Value or @PersistenceContext, and fields assigned
   only inside a @PostConstruct method — that the target method also reads or calls.
   These are NULL when the test creates the object with \`new\`, so the test must set them.

   RULES for injectedFields:
   - Include only fields the target method uses
   - initBy = the annotation or mechanism that normally fills it (e.g., "@Autowired", "@PostConstruct")
   - notes = how to provide it in tests (e.g., "pass a hand-written stub implementing OrderRepository")
   - If there are none, return []`,

  /**
   * Los paquetes de Java se declaran con `package` y se alcanzan con
   * `import`, pero solo hace falta importar lo que está en otro.
   */
  analyzerNamespaces: `8. PACKAGES — Read the \`package\` line of \`<class-name>\` and of every project type the tests will need to reference.
   List the fully qualified name of every project type that lives in a DIFFERENT package than \`<class-name>\`:
   the test is in the same package as \`<class-name>\`, so only those need an import.

   If all referenced project types are in the same package, return [].`,

  /**
   * Cómo se instancia cada tipo. En Java la trampa no es la herencia de un
   * motor sino lo que no admite `new`: interfaces, clases abstractas y clases
   * con todos sus constructores privados.
   */
  analyzerPreFlight: `A. TYPE INSTANTIATIONS — For EVERY type that the test will need to create
   (target class AND all helper types: dependencies, collaborators, value objects, etc.):

   For each type, find its declaration in the assembled context and determine:
     pattern = "new"      for concrete classes and records with an accessible constructor
     pattern = "factory"  when every constructor is private (singletons, static of/create/getInstance/builder methods)
     pattern = "subclass" for interfaces and abstract classes → lambda, anonymous class or a concrete subclass from the context

   WRONG: \`new PaymentGateway()\` if PaymentGateway is an interface
   CORRECT: \`PaymentGateway gateway = amount -> true;\` or \`new PaymentGateway() { ... }\`

   For "new" types, copy the EXACT constructor signature from the context:
     - If the constructor requires parameters, note them ALL
     - "parameterless": true only if an explicit no-argument constructor exists or the class declares no constructor at all
     - "parameterless": false if only parameterized constructors exist → MUST provide arguments
     - Records: the canonical constructor takes ALL components, in declaration order

   constructorNotes: describe how to build the minimum valid argument
     e.g., "Order(String id, List<Item> items) rejects a blank id — use A-1 and an empty list"

B. COMPUTED GETTERS — For every getter the target method reads that computes its value:
   Identify the underlying field(s) its body reads from.
   The test cannot use getDeclaredField on it — it must set the underlying fields instead.`,

  /** Las comprobaciones finales que dependen del ecosistema. */
  analyzerVerification: `2. Count every \`for\` / for-each / \`while\` / \`do-while\` = N_loops → loops array must have exactly N_loops entries
3. For each field in the method body: is it declared \`private\`? → add to privateMembers
4. Is \`<method-name>\` declared \`private\`? → add it to privateMembers with kind = "method"
5. Look for @Autowired/@Inject/@Value/@Resource fields and @PostConstruct assignments the target method uses → add to injectedFields
6. For EVERY type used in tests: is it concrete, a record, abstract, an interface, or does it only have private constructors? → determine new, factory or subclass
7. For EVERY "new" type: copy its exact constructor signature → set parameterless correctly`,

  /** Las clases de tipo de Java, más la de lo que no es del proyecto. */
  analyzerDependencyKinds: `class | interface | enum | record | external`,

  /** Los mismos bucles del apartado 3, ahora como valores del esquema. */
  analyzerLoopTypeValues: `for | forEach | while | doWhile`,

  /** Las cuatro clases de `analyzerPrivateMemberKinds`. */
  analyzerMemberKinds: `field | getter | nestedType | method`,

  /** El campo `injectedFields` de la extensión del esquema. */
  analyzerLifecycleFieldsSchema: `"injectedFields": [
  { "name": "", "type": "", "initBy": "@Autowired | @Inject | @Value | @Resource | @PostConstruct", "notes": "" }
],`,

  /**
   * El campo `requiredImports` de la extensión del esquema: nombres
   * calificados, que es lo que va detrás de `import`.
   */
  analyzerRequiredUsingsSchema: `"requiredImports": ["com.example.model.Item", "com.example.util.Money"],`,

  /** Ejemplo de rama inalcanzable con una llamada real de la biblioteca estándar. */
  analyzerUntestableBranchExample: `{ "condition": "scanner.nextLine().isBlank()", "reason": "reads System.in — there is no console input in a unit test" }`,

  /** Las tres formas de instanciar de `analyzerPreFlight`. */
  analyzerInstantiationPatterns: `new | factory | subclass`,

  /** Qué anotar sobre el constructor, con el ejemplo en la forma de Java. */
  analyzerConstructorSignatureNote: `"constructorSignature": "null if factory or subclass, else exact signature e.g. OrderService(OrderRepository repository)",`,

  /** Por qué se eligió esa forma de instanciar. */
  analyzerInstantiationReason: `"reason": "concrete class | record | private constructors | interface | abstract class"`,

  /** Ejemplo de un valor calculado y de cómo controlarlo. */
  analyzerComputedPropertyExample: `"propertyName": "getTotal()",
"getterSummary": "sums price times quantity of every element of items",
"controlVia": "items (List<Item>) — add Items with known prices"`,
} satisfies JavaFragments;
