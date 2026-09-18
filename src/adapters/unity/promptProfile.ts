import type { ProjectModel, PromptProfile, PromptVocabulary } from "../../core/contracts";

/**
 * OP-08 — Perfil de prompt del ecosistema Unity.
 *
 * Es el conocimiento de Unity y de C# que las plantillas neutras del núcleo ya
 * no contienen. Cada fragmento salió literalmente de la plantilla que lo tenía
 * incrustado, sin reescribirlo: el prompt que se arma tiene que ser el mismo
 * carácter por carácter, y la foto de `src/test/snapshots/prompts/` lo
 * comprueba. Mejorar la redacción es un trabajo posterior, que ya cambia el
 * prompt y hay que medir.
 *
 * Cubre las ocho plantillas. Ninguna nombra ya una tecnología: todo lo que
 * decía Unity, C# o NUnit está aquí.
 *
 * Hay conocimiento repetido a propósito entre agentes: el mismo hecho —que un
 * `MonoBehaviour` no se construye con `new`— aparece en el validador, en el
 * corrector y en el analizador, porque cada uno lo enuncia de otra manera.
 * Unificarlos cambia el texto del prompt, así que es trabajo de la pasada
 * posterior, con la línea base ya medida.
 *
 * Los fragmentos del analizador que describen campos del esquema son los que
 * deberían vivir en OP-09 y no aquí. Están aquí porque OP-09 todavía no se
 * implementó y porque su forma actual no alcanza para expresarlos; la deuda
 * está anotada en el documento de traspaso.
 *
 * Recibe el proyecto porque el perfil depende de él: la versión del editor viaja
 * en `adapterData` y de ella dependerán, por ejemplo, las APIs admitidas. Hoy
 * ningún valor la usa todavía.
 */

/**
 * Vocabulario obligatorio.
 *
 * `testFramework` dice "NUnit PlayMode" y no solo "NUnit" porque la variante
 * importa: una prueba de PlayMode corre dentro del ciclo del motor y una de
 * EditMode no. Cuando el adaptador sepa distinguirlas, este valor saldrá del
 * proyecto y no de una constante.
 */
const VOCABULARY: PromptVocabulary = {
  ecosystem: "Unity",
  language: "C#",
  testFramework: "NUnit PlayMode",
  importStatements: "using statements",
  typeKinds: "type, class, enum, or struct",
  assertionPrefix: "Assert.",
  controlFlowKeywords: "if/else, for, foreach, while, or try/catch",
  loopKeywords: "foreach/for/while",
};

/** Bloques de reglas y ejemplos, tal como estaban en las plantillas. */
const FRAGMENTS = {
  // ── Cortador de métodos ─────────────────────────────────────────────────

  /**
   * En C# la declaración de importación es `using` y va antes del espacio de
   * nombres.
   */
  sliceImportRule: `Using statements: only those required by types used inside the target method body or signature`,

  /**
   * Ejemplo del recorte esperado. Lleva `MonoBehaviour` porque el componente
   * es la forma habitual de una clase de Unity, y el arreglo de `GameObject`
   * porque los campos serializados son lo que más se referencia.
   */
  sliceExample: `"using UnityEngine;",
"using System.Linq;",
"",
"public class ClassName : MonoBehaviour",
"{",
"    public GameObject[] SomeField;",
"",
"    public ClassName() { ... }",
"",
"    private void TargetMethod()",
"    {",
"        // exact method body",
"    }",
"}"`,

  // ── Resolutor de dependencias ───────────────────────────────────────────

  /**
   * Tipos que nunca son una dependencia del proyecto: los del motor, los de
   * la biblioteca estándar de .NET y los de paquetes de terceros. Sin esta
   * regla el agente pide el archivo de `MonoBehaviour`, que no existe en el
   * proyecto.
   */
  ignoredTypes: `- IGNORE Unity built-in types (MonoBehaviour, GameObject, Transform, Vector3, etc.)
- IGNORE standard .NET types (System.*, Collections.*, Linq.*)
- IGNORE third-party types (DG.Tweening.*, UnityEngine.UI.*, etc.)`,

  /**
   * `GetComponent<T>()` es la forma de Unity de nombrar un tipo sin
   * instanciarlo.
   */
  dependencyEvidence: `- Generic type usage (e.g., GetComponent<Shape>())`,

  /**
   * Las rutas del proyecto siempre cuelgan de `Assets` y los fuentes son
   * `.cs`.
   */
  sourcePathExample: `"Assets/.../File.cs"`,

  // ── Constructor de contexto ─────────────────────────────────────────────

  /**
   * Qué se conserva de cada clase de tipo. `struct` aparece porque en C# es
   * un tipo de valor con miembros propios, cosa que no existe en todos los
   * lenguajes.
   */
  dependencySliceRules: `- ALWAYS include the class/struct/enum declaration line (name, base class, interfaces)
- For enums: include the FULL enum body if ANY value name appears in the target method body
- For classes/structs: include ONLY the fields/properties/methods whose identifier appears in the target method body`,

  /** En C# un bloque se cierra con llave; en un lenguaje por sangría, no. */
  dependencySliceSyntax: `IMPORTANT: The relevantSlice must be valid C# — close every opened block with \`}\`.`,

  /** Ejemplo del recorte de una dependencia, con su ruta y su contenido. */
  dependencySliceExample: `"filePath": "Assets/.../File.cs",
"relevantSlice": "using UnityEngine;\\n\\npublic class SomeClass\\n{\\n    public string SomeProp { get; set; }\\n}"`,

  // ── Validador de pruebas ────────────────────────────────────────────────

  /** `[TestFixture]` es el atributo con el que NUnit reconoce la clase. */
  validatorStructure: `1. STRUCTURE: Has [TestFixture] attribute, exactly ONE public class`,

  /**
   * Los cinco espacios de nombres sin los cuales la prueba no compila, más
   * la regla de agregar los del propio proyecto: sin ellos, el compilador no
   * encuentra los tipos bajo prueba.
   */
  validatorImports: `2. USINGS: All mandatory usings present — NUnit.Framework, UnityEngine, UnityEngine.TestTools, System.Collections, System.Reflection
   ALSO: scan the reference context for \`namespace XYZ { }\` blocks. For every namespace found,
   verify \`using XYZ;\` is present in the test file.
   Missing project namespace using → CS0246 "type not found" — mark FAIL.`,

  /**
   * `[UnityTest]` con `IEnumerator` es la prueba que corre dentro del ciclo
   * del motor; `[Test]` a secas no esperaría ni un cuadro.
   */
  validatorTestMethods: `3. TEST METHODS: Every test method uses [UnityTest] and returns IEnumerator`,

  /**
   * Sin límite de tiempo, una prueba que espera un cuadro que no llega
   * cuelga la corrida entera del editor.
   */
  validatorTimeout: `4. TIMEOUT: Each [UnityTest] method has a separate [Timeout(1000)] line immediately after [UnityTest]`,

  /**
   * `Assert.IsNotNull` es la excepción habitual a la regla de una sola
   * aserción, y por eso hay que nombrarla aparte.
   */
  validatorAssertionNotes: `RULE: Assert.IsNotNull counts as 1. IsNotNull paired with any other Assert → FAIL.
When fixing: remove IsNotNull or move it to its own test method.`,

  /**
   * Formas concretas de prueba que siempre pasa. Las de entrada son propias
   * del motor: en PlayMode `Input` no recibe nada, así que la rama que
   * dependa de una tecla no se ejercita nunca.
   */
  validatorFakeTests: `a) Assert.Pass() in any test method — this is a fake assertion that always passes
b) Assert.IsTrue(true) — same problem
c) Tests whose only assertion is trivially true regardless of the code under test
d) Tests that attempt to simulate keyboard input (Input.GetKeyDown/GetKey/GetButton/GetAxis
   always return false/0 in PlayMode — such tests never exercise the branch they claim to test)
FIX: remove the entire test method — do NOT replace Assert.Pass() with a different assertion.
These branches are untestable in PlayMode and must be omitted entirely.`,

  /**
   * Un `MonoBehaviour` no se construye con `new`: hay que agregarlo a un
   * objeto de escena. Construirlo directamente compila y revienta al
   * ejecutar.
   */
  validatorInstantiation: `8. NO new ON MONOBEHAVIOURS — scan every \`new XYZ(\` call in the file:
   For each, find \`class XYZ\` in the reference context. Trace its inheritance chain.
   If it leads to MonoBehaviour/Component/Behaviour → FAIL.
   WRONG: new TetriminoView()  when TetriminoView : PoolingObject : MonoBehaviour
   CORRECT: go.SetActive(false); go.AddComponent<TetriminoView>()
   FIX: replace \`new XYZ()\` with AddComponent on a new inactive GameObject.`,

  /** CS1729 es el error de C# por llamar a un constructor que no existe. */
  validatorConstructorArgs: `9. NO MISSING CONSTRUCTOR ARGS — scan every \`new XYZ(\` call:
   Find the constructor of XYZ in the reference context.
   If the constructor requires parameters and the call passes none → FAIL (CS1729).
   WRONG: new Playfield()  when only \`public Playfield(GameSettings gs)\` exists
   CORRECT: new Playfield(gameSettings)`,

  /**
   * `GetField` devuelve nulo ante una propiedad, así que el fallo aparece
   * recién al ejecutar y como una excepción de referencia nula.
   */
  validatorComputedProperties: `10. NO GetField ON COMPUTED PROPERTIES — scan every GetField("name", ...) call:
    Find \`name\` in \`<class-name>\`. If it is declared as a property with \`{ get { ... } }\` → FAIL.
    GetField returns null for properties — the test will throw NullReferenceException at runtime.
    FIX: find the underlying field(s) the property getter reads from and set those instead.`,

  /**
   * Activar el objeto dispara `Awake` y `Start`, que pisan lo que la prueba
   * acaba de preparar por reflexión.
   */
  validatorLifecycleCalls: `11. NO SetActive(true) in [SetUp] or test methods`,

  /**
   * Las ramas que dependen de `Input` quedan fuera de la cobertura exigible,
   * porque en PlayMode no hay forma de alcanzarlas.
   */
  validatorUntestableBranches: `(skip branches that are only reachable via Input.GetKeyDown/GetKey/GetAxis — those are untestable)`,

  /**
   * Llaves y punto y coma son de C#; un lenguaje por sangría tendría otra
   * lista, y uno interpretado no hablaría de compilación.
   */
  validatorSyntax: `14. SYNTAX: No obvious compilation errors (unmatched braces, missing semicolons, undeclared variables)`,

  /** CS0116 es el error de C# por declarar algo fuera de una clase. */
  validatorFileStructure: `15. NO CODE OUTSIDE THE CLASS (CS0116 prevention):
    All fields, methods, and statements must be INSIDE the [TestFixture] class body.
    File structure must be: usings → [TestFixture] → public class → { ... }
    If any declaration exists before [TestFixture] or after the closing } → FAIL`,

  /** Un archivo de C# empieza por sus `using` o por el atributo de la clase. */
  validatorOutputStart: `CRITICAL FORMAT RULE: correctedCode must start directly with \`using\` or \`[TestFixture]\`.`,

  // ── Corrector por chat ──────────────────────────────────────────────────

  /**
   * Mismo conocimiento que `validatorImports`, enunciado como instrucción y
   * no como punto de una lista con veredicto. Son dos textos distintos
   * porque los dos agentes piden cosas distintas; unificarlos es trabajo de
   * la pasada de deduplicación, que ya cambia el prompt.
   */
  fixerImports: `0. NAMESPACE USINGS — CS0246 prevention:
   If the code under test (or any type it uses) is declared inside \`namespace XYZ { }\`,
   the test file MUST have \`using XYZ;\` at the top.
   Missing project namespace \`using\` → CS0246 "type not found" for every type in that namespace.
   VERIFY: scan the reference context for \`namespace\` declarations → add a \`using\` for each one
   that contains a type referenced in the test.`,

  /**
   * Cómo controlar una propiedad calculada: llegar al campo que lee el
   * captador en lugar de intentar escribir la propiedad.
   */
  fixerComputedProperties: `0.5. COMPUTED PROPERTIES — never use GetField on a property:
   A member declared as \`private T Name { get { return expr; } }\` is a property, not a field.
   \`typeof(C).GetField("Name", NonPublic|Instance)\` returns null.
   CORRECT approach: inspect the getter body → find the underlying field(s) it reads from → set THOSE.
   Example: \`private Tetrimino Current { get { return _list.Last(); } }\`
            → set \`_list\` (a List<TetriminoView> field) via Reflection, not "Current".`,

  /**
   * Las dos causas de prueba imposible en Unity juntas: la entrada, que en
   * PlayMode no responde, y los componentes, que no se construyen con `new`.
   */
  fixerUntestableBranches: `0.6. UNTESTABLE INPUT BRANCHES:
   Input.GetKeyDown / GetKey / GetButton → always false in PlayMode.
   Input.GetAxis / GetAxisRaw → always 0 in PlayMode.
   Branches reachable ONLY via these calls can NEVER be exercised.
   CORRECT fix: remove the test entirely.
   WRONG fix: keep the test with Assert.Pass() or Assert.IsTrue(true) — that is a fake test.

   ALSO — helper MonoBehaviours:
   Any type that extends MonoBehaviour (directly or via base class) must use AddComponent, not \`new\`.
   \`new TetriminoView()\` when TetriminoView is a MonoBehaviour → crash.
   CORRECT: go.SetActive(false); var tv = go.AddComponent<TetriminoView>();`,

  /** CS1729 otra vez, aquí como instrucción de corrección. */
  fixerConstructorArgs: `0.75. CONSTRUCTOR PARAMETERS:
   Before writing \`new DependencyType()\`, check its constructor in the reference context.
   If only a parameterized constructor exists, you MUST provide all required arguments.
   WRONG:  new Playfield()   ← CS1729 if only \`Playfield(GameSettings)\` exists
   CORRECT: new Playfield(gameSettings)`,

  /** CS0116 otra vez, con la lista de qué va dentro de la clase. */
  fixerFileStructure: `1. ALL code must be inside the [TestFixture] class body:
   - private fields, [SetUp], [TearDown], helper methods, [UnityTest] methods — ALL inside { }
   - NEVER place any declaration (field, method, property) before [TestFixture] or after the closing }
   - The first non-comment, non-using line must be [TestFixture] or the class declaration
   - CS0116 ("A namespace cannot directly contain members") is caused by code outside the class
   - VERIFY: scan the entire output and confirm there is exactly ONE class, and no code outside it`,

  /** Un archivo de C# empieza por sus `using` o por el atributo de la clase. */
  fixerOutputStart: `4. correctedCode must start with \`using\` or \`[TestFixture]\``,

  /** Ejemplo del resumen de una corrección, con un error concreto de C#. */
  fixerSummaryExample: `Fixed CS0116: moved field declarations inside the TestFixture class`,

  // ── Analizador de código ────────────────────────────────────────────────

  /**
   * Mismo conocimiento que `ignoredTypes`, enunciado como qué no entra en la
   * lista de dependencias en vez de qué se ignora al leer.
   */
  analyzerIgnoredTypes: `- Include standard .NET types (System.*, Collections.*, Linq.*) in the dependencies list
- Include Unity built-in types (MonoBehaviour, GameObject, Transform, GetComponent, etc.) in the dependencies list
- Include third-party types (DG.Tweening.*, etc.) in the dependencies list`,

  /**
   * `foreach` no existe en todos los lenguajes; la lista de palabras que
   * abren un bucle cambia con cada uno.
   */
  analyzerLoopKinds: `- \`foreach\` / \`for\` / \`while\` → add ONE entry to loops`,

  /**
   * Qué se considera la condición de cada clase de bucle. En `foreach` es la
   * colección que se recorre, no una expresión booleana.
   */
  analyzerLoops: `3. LOOPS — List every \`foreach\`, \`for\`, \`while\`:
   - For \`foreach\`: condition = collection being iterated
   - For \`for\`/\`while\`: condition = loop condition expression`,

  /**
   * En PlayMode `Input` no recibe nada, así que toda rama que dependa de una
   * tecla o de un eje es inalcanzable. Es el conocimiento que después evita
   * que el generador escriba una prueba que siempre pasa.
   */
  analyzerUntestableBranches: `4.5. UNTESTABLE BRANCHES — Scan the method for conditions that can NEVER be true in PlayMode:
   - Input.GetKeyDown / Input.GetKey / Input.GetButton → always false in PlayMode
   - Input.GetAxis / Input.GetAxisRaw → always 0 in PlayMode
   - Input.GetMouseButton → always false in PlayMode

   For each branch guarded SOLELY by one of the above, add it to untestableBranches with a reason.
   The test generator will skip these entirely — no placeholder tests, no Assert.Pass().`,

  /**
   * Las cuatro clases de miembro que la prueba tiene que alcanzar por
   * reflexión. La cuarta son los mensajes del motor —`Update`, `Awake`,
   * `OnTriggerEnter`— que Unity invoca aunque no sean públicos.
   */
  analyzerPrivateMemberKinds: `A. Fields without \`public\` access modifier that the target method reads or writes:
   kind = "field"
   Example: \`private Queue<Vector3> waypoints\` → { name: "waypoints", kind: "field", type: "Queue<Vector3>" }

B. Properties without \`public\` that the target method reads or writes:
   kind = "property"
   CRITICAL: a property declared as \`private T Name { get { return expr; } }\` has NO backing field.
   \`GetField("Name", NonPublic|Instance)\` returns null — it cannot be set via Reflection.
   In the notes field, record the underlying field(s) the getter reads from so the test generator
   knows what to manipulate instead (e.g., "computed from mTetriminos list — set mTetriminos").

C. Nested types (enum, struct, class) declared INSIDE \`<class-name>\` without \`public\`:
   kind = "nestedType"
   List ALL values if it is an enum.
   Example: \`enum State { Wait, Init }\` → { name: "State", kind: "nestedType", type: "enum", nestedValues: ["Wait","Init"] }

D. Unity MonoBehaviour message methods if \`<method-name>\` IS one of them:
   These are ALWAYS considered private regardless of their declaration:
   Update, FixedUpdate, LateUpdate, Awake, Start, OnEnable, OnDisable,
   OnTriggerEnter2D, OnTriggerExit2D, OnCollisionEnter2D, OnCollisionExit2D,
   OnTriggerEnter, OnTriggerExit, OnCollisionEnter, OnCollisionExit, OnDestroy
   kind = "unityMessage"
   Example: \`void FixedUpdate()\` → { name: "FixedUpdate", kind: "unityMessage", type: "void" }`,

  /**
   * En C# un miembro sin modificador es privado. En otros lenguajes el valor
   * por omisión es otro, o no existe el concepto.
   */
  analyzerDefaultVisibility: `- In C#, a member with NO access modifier defaults to \`private\``,

  /**
   * `Start` y `Awake` son del ciclo de vida del motor y no corren en una
   * prueba que instancia el componente a mano, así que lo que inicializan
   * hay que reponerlo.
   */
  analyzerLifecycleFields: `7. START/AWAKE FIELDS — Scan Start() and Awake() in the context.
   List every field initialized (assigned, newed, or fetched) inside Start() or Awake()
   that the target method also reads or writes.
   These MUST be manually initialized in test SetUp when Start/Awake are bypassed.

   RULES for startAwakeFields:
   - Include collections (Queue, List, Stack, Dictionary) initialized inside Start/Awake
   - Include component references assigned via GetComponent or Find inside Start/Awake
   - Include float/int/bool values assigned in Start/Awake that affect the method's branches
   - notes = brief description of what value to use in tests (e.g., "initialize with one entry")`,

  /**
   * Los espacios de nombres de C# se declaran con `namespace` y se alcanzan
   * con `using`.
   */
  analyzerNamespaces: `8. NAMESPACES — Scan the assembled context for \`namespace XYZ { }\` blocks.
   List every namespace that wraps the target class or any type the tests will need to reference.

   If no project namespaces exist, return [].`,

  /**
   * El bloque más largo del perfil: cómo se instancia cada tipo. Un
   * `MonoBehaviour` se agrega a un objeto de escena y el resto se construye
   * normal, y distinguirlos obliga a recorrer la cadena de herencia.
   */
  analyzerPreFlight: `A. TYPE INSTANTIATIONS — For EVERY type that the test will need to create
   (target class AND all helper types: dependencies, view objects, data classes, etc.):

   For each type, find its declaration in the assembled context and determine:
     pattern = "AddComponent" if the type's declaration chain includes MonoBehaviour/Component/Behaviour
     pattern = "new"          for plain C# classes and structs

   To check the inheritance chain:
     - Find \`class TypeName : BaseClass\`
     - If BaseClass is MonoBehaviour/Component/Behaviour → AddComponent
     - If BaseClass is another class (e.g., PoolingObject) → find THAT class's declaration and repeat
     - Keep tracing until you reach a root class or MonoBehaviour

   WRONG: \`new TetriminoView()\` if TetriminoView extends PoolingObject extends MonoBehaviour
   CORRECT: \`go.AddComponent<TetriminoView>()\`

   For "new" types, copy the EXACT constructor signature from the context:
     - If the constructor requires parameters, note them ALL
     - "parameterless": true only if an explicit \`public TypeName() {}\` or no constructor at all exists
     - "parameterless": false if only parameterized constructors exist → MUST provide arguments

   constructorNotes: describe how to build the minimum valid argument
     e.g., "TetriminoSpecs requires serializedBlockPositions with exactly 100 ints (4×5×5), each 0 or 1"

B. COMPUTED PROPERTIES — For every private property (kind = "property") in privateMembers:
   Identify the underlying field(s) its getter reads from.
   The test cannot use GetField on the property — it must set the underlying fields instead.`,

  /**
   * Las seis comprobaciones finales que dependen del ecosistema. La primera
   * de la lista, contar condiciones, se quedó en la plantilla porque vale
   * para cualquier lenguaje.
   */
  analyzerVerification: `2. Count every \`foreach\`/\`for\`/\`while\` = N_loops → loops array must have exactly N_loops entries
3. For each field in the method body: is it declared as private/protected or with no modifier? → add to privateMembers
4. Is \`<method-name>\` a Unity message method? → add to privateMembers with kind = "unityMessage"
5. Look at Start() and Awake(): every field they assign that the target method also uses → add to startAwakeFields
6. For EVERY type used in tests: trace the full inheritance chain → determine AddComponent or new
7. For EVERY "new" type: copy its exact constructor signature → set parameterless correctly`,

  /**
   * `struct` es de C#; en otros lenguajes la lista de clases de tipo es
   * otra.
   */
  analyzerDependencyKinds: `class | struct | enum | external`,

  /** Los mismos bucles del apartado 3, ahora como valores del esquema. */
  analyzerLoopTypeValues: `for | while | foreach`,

  /**
   * `unityMessage` es el valor que hoy obliga al esquema del núcleo a
   * conocer a Unity. Debería mudarse a OP-09 y hoy no puede: está dentro de
   * una enumeración anidada, y `AnalysisSchemaExtension.fields` solo agrega
   * campos de primer nivel.
   */
  analyzerMemberKinds: `field | property | nestedType | unityMessage`,

  /**
   * El campo `startAwakeFields` del esquema, con `Awake` y `Start` dentro.
   * Es del ecosistema entero, nombre incluido, y es el candidato más claro a
   * mudarse a OP-09.
   */
  analyzerLifecycleFieldsSchema: `"startAwakeFields": [
  { "name": "", "type": "", "initIn": "Awake | Start", "notes": "" }
],`,

  /**
   * `requiredUsings` nombra la palabra de C#. El campo entero es del
   * ecosistema, no solo su contenido.
   */
  analyzerRequiredUsingsSchema: `"requiredUsings": ["TetrisEngine", "TetrisEngine.TetriminosPiece"],`,

  /** Ejemplo de rama inalcanzable, con una llamada real del motor. */
  analyzerUntestableBranchExample: `{ "condition": "Input.GetKeyDown(rotateRightKey)", "reason": "Input always false in PlayMode" }`,

  /** Las dos formas de instanciar que admite Unity. */
  analyzerInstantiationPatterns: `AddComponent | new`,

  /** Qué anotar sobre el constructor, con el ejemplo en la forma de C#. */
  analyzerConstructorSignatureNote: `"constructorSignature": "null if AddComponent, else exact signature e.g. Playfield(GameSettings gs)",`,

  /** La justificación se enuncia en términos de la jerarquía del motor. */
  analyzerInstantiationReason: `"reason": "extends MonoBehaviour | plain C# class"`,

  /** Ejemplo de propiedad calculada tomado de un proyecto de Unity real. */
  analyzerComputedPropertyExample: `"propertyName": "mCurrentTetrimino",
"getterSummary": "returns last element of mTetriminos if not locked",
"controlVia": "mTetriminos (List<TetriminoView>) — add a TetriminoView with isLocked=false"`,

  // ── Generador de pruebas ────────────────────────────────────────────────

  /**
   * El objetivo nombra el marco completo, con motor y variante, y no solo
   * NUnit.
   */
  generatorTestFramework: `Unity Test Framework (NUnit 3.x) PlayMode`,

  /**
   * Los cuatro asuntos que el analizador deja resueltos, cada uno en el
   * vocabulario de Unity y C#.
   */
  generatorPreFlightItems: `• Type Instantiations → exact \`new\` vs \`AddComponent\` pattern for EVERY type, including helpers
• Computed Properties → which underlying fields to set instead of using GetField on the property
• Untestable Branches → branches to OMIT entirely (no Assert.Pass, no placeholder tests)
• Required Usings → exact \`using XYZ;\` directives to add`,

  /**
   * El apartado más delicado: distinguir un componente del motor de una
   * clase normal mirando la cadena de herencia. Equivocarse no da un error
   * de compilación claro sino una excepción al ejecutar, y la advertencia
   * sobre `GameObject` como tipo de campo está porque el modelo se
   * equivocaba justo ahí.
   */
  generatorInstantiationCheck: `Find the exact declaration of \`<class-name>\` in the context. It looks like one of:
  (a)  public class <class-name>                       ← no inheritance
  (b)  public class <class-name> : MonoBehaviour       ← Unity component
  (c)  public class <class-name> : SomeOtherClass      ← check if SomeOtherClass extends MonoBehaviour

DECISION:
  Declaration has \`: MonoBehaviour\` / \`: Component\` / \`: Behaviour\` anywhere → AddComponent pattern
  Declaration has NOTHING after the class name, or only non-Unity base classes → new ClassName()

CRITICAL WARNING: A class that uses GameObject as a FIELD TYPE or METHOD PARAMETER is NOT
necessarily a MonoBehaviour. Only \`: MonoBehaviour\` in the declaration makes it one.
  WRONG assumption: "ShapesArray has GameObject[,] fields → must be MonoBehaviour" ← FALSE
  CORRECT reading:  \`public class ShapesArray\` (no colon) → plain C# class → new ShapesArray()

Using AddComponent on a plain C# class → CS0311 compile error → tests will not compile.
Using new on a MonoBehaviour → MissingMethodException at runtime → tests will fail.

THIS SAME CHECK APPLIES TO EVERY TYPE YOU INSTANTIATE IN TESTS — not only the target class.
For every helper type you create in [SetUp] or test methods (e.g., TetriminoView, EnemyBase, Projectile):
  - Find its declaration in the assembled context
  - If it inherits from MonoBehaviour (directly or through a base class) → AddComponent on a NEW inactive GameObject
  - If it is a plain C# class/struct → new ClassName(...)
NEVER call \`new\` on a MonoBehaviour, even if it is just a helper type, not the class under test.

Write your answer before continuing:
  "<class-name> declaration: [copy exact line] → [new / AddComponent]"
  For each helper type used: "[TypeName] declaration: [copy exact line] → [new / AddComponent]"`,

  /**
   * Cómo se declara y se alcanza un espacio de nombres en C#, con el error
   * que sale cuando falta.
   */
  generatorNamespaceStep: `━━ STEP 0.1 — NAMESPACE & USING CHECK (mandatory) ━━

Scan the assembled context for every \`namespace XYZ { }\` block that wraps any type you will reference
in the test (target class, its dependencies, helper structs, enums, etc.).

For each such type:
  1. Find its declaration in the context
  2. If it is wrapped in \`namespace XYZ { ... }\`, add \`using XYZ;\` at the top of the test file
  3. Repeat for nested namespaces: \`namespace A.B { ... }\` → \`using A.B;\`

WRONG: using \`GameLogic\` when it is declared inside \`namespace TetrisEngine { }\` with no \`using TetrisEngine;\`
       → CS0246: "The type or namespace name 'GameLogic' could not be found"
CORRECT: add \`using TetrisEngine;\` before [TestFixture]

Rule: EVERY namespace in the context that wraps a type you reference → one \`using XYZ;\` in the file.
Write down the namespace(s) found before continuing.`,

  /**
   * En C# un miembro sin modificador es privado. Es lo que obliga a casi
   * toda la reflexión que viene después.
   */
  generatorDefaultVisibility: `In C#, a member with NO explicit access modifier is PRIVATE by default.`,

  /**
   * El recetario de reflexión de C#: campo, campo estático, método, tipo
   * anidado y propiedad calculada. Otro lenguaje tiene reflexión pero con
   * otros nombres y otras trampas.
   */
  generatorReflection: `Private/protected field → NEVER access as \`obj.field\` → use FieldInfo:
  FieldInfo f = typeof(ClassName).GetField("fieldName",
      BindingFlags.NonPublic | BindingFlags.Instance);
  f.SetValue(instance, value);
  var val = f.GetValue(instance);

Private static field:
  FieldInfo f = typeof(ClassName).GetField("fieldName",
      BindingFlags.NonPublic | BindingFlags.Static);

Private/protected method → NEVER call as \`obj.Method()\` → use MethodInfo.Invoke:
  MethodInfo m = typeof(ClassName).GetMethod("MethodName",
      BindingFlags.NonPublic | BindingFlags.Instance, null,
      new Type[] { typeof(Param1Type), typeof(Param2Type) }, null);
  m.Invoke(instance, new object[] { param1, param2 });

Private nested type (enum/struct/class declared inside the target class):
  NEVER reference it as \`State.Wait\` from outside — it is inaccessible
  Type stateType = typeof(ClassName).GetNestedType("State", BindingFlags.NonPublic);
  FieldInfo stateField = typeof(ClassName).GetField("state",
      BindingFlags.NonPublic | BindingFlags.Instance);
  stateField.SetValue(instance, Enum.Parse(stateType, "Wait"));

Cache ALL FieldInfo / MethodInfo / Type lookups in [SetUp] private fields — never inline in tests.

COMPUTED PROPERTIES — a property with \`{ get { return ...; } }\` has NO backing field:
  \`private Tetrimino Current { get { return _list.Last(); } }\`  ← property, no field
  \`typeof(C).GetField("Current", NonPublic | Instance)\` → returns NULL → NullReferenceException

  WRONG:  GetField("Current", ...).SetValue(instance, value)  ← null ref
  CORRECT: Find the underlying field(s) the property reads from (here: \`_list\`).
           Set/populate those fields instead.

  RULE: If a member declaration contains \`{ get { ... } }\` or \`{ get; set; }\` → it is a PROPERTY.
        A property with no explicit setter backing field CANNOT be written via GetField.
        Inspect the getter body → identify what field(s) it reads → set THOSE fields.`,

  /**
   * Los métodos que Unity invoca por su cuenta. No son públicos, así que la
   * prueba solo los alcanza por reflexión.
   */
  generatorEngineMessages: `B. UNITY MESSAGE METHODS — always private regardless of declaration:
   Update, FixedUpdate, LateUpdate, Awake, Start, OnEnable, OnDisable, OnDestroy,
   OnTriggerEnter2D, OnTriggerExit2D, OnCollisionEnter2D, OnCollisionExit2D,
   OnTriggerEnter, OnTriggerExit, OnCollisionEnter, OnCollisionExit

   WRONG: sut.FixedUpdate();   ← CS1061 compile error
   CORRECT:
     MethodInfo fu = typeof(ClassName).GetMethod("FixedUpdate",
         BindingFlags.NonPublic | BindingFlags.Instance, null, Type.EmptyTypes, null);
     fu.Invoke(sut, null);`,

  /**
   * Cómo se califica el valor de una enumeración anidada, con el error de C#
   * que sale si se omite el nombre del tipo.
   */
  generatorNestedEnums: `C. STATIC NESTED ENUMS — read the actual declaration before referencing:
   If GameManager has \`public enum GameState { Init, Game, Dead }\` and a static field
   \`public static GameState gameState\`, the correct access is:
     CORRECT: GameManager.gameState = GameManager.GameState.Game;
     WRONG:   GameManager.gameState = GameManager.Game;    ← CS0117 compile error
   Rule: Always qualify enum values as \`ClassName.EnumTypeName.Value\``,

  /**
   * `Start` y `Awake` no corren cuando la prueba arma el componente a mano,
   * así que lo que ellos inicializan hay que reponerlo. Incluye el ejemplo
   * de preparación, que es la parte del prompt que más forma le da al código
   * generado.
   */
  generatorLifecycleFields: `D. START/AWAKE FIELDS — fields initialized inside Start() or Awake() are NOT initialized
   when using go.SetActive(false) + AddComponent, because Start/Awake do NOT run.

   For every field initialized in Start() or Awake() that the target method uses:
   1. Get its FieldInfo in [SetUp]
   2. Initialize it via SetValue with a valid test value
   3. Collections (Queue, List, Stack, Dictionary) → new them and add at least one entry
      unless the specific test case requires an empty collection
   4. Component references → AddComponent to the test GameObject instead of FindObjectOfType
   5. Timer floats (e.g., timeToEndWait, timeToEndScatter) set to Time.time + X in Start →
      set to float.MaxValue in [SetUp] to prevent unwanted state transitions during tests

   EXAMPLE (generalized):
     [SetUp]
     void SetUp() {
       _go = new GameObject();
       _go.SetActive(false);
       _sut = _go.AddComponent<TargetClass>();

       // Initialize Queue that Start() would have filled
       var queueField = typeof(TargetClass).GetField("items",
           BindingFlags.NonPublic | BindingFlags.Instance);
       var q = new Queue<SomeType>();
       q.Enqueue(someValidItem);
       queueField.SetValue(_sut, q);

       // Prevent time-based transitions
       typeof(TargetClass).GetField("timeToEndPhase",
           BindingFlags.NonPublic | BindingFlags.Instance)
           ?.SetValue(_sut, float.MaxValue);
     }`,

  /**
   * Confirmar la firma del constructor antes de escribir la llamada. CS1729
   * es el error de C# por no hacerlo.
   */
  generatorConstructorParams: `E. CONSTRUCTOR PARAMETERS — MANDATORY PRE-FLIGHT before writing any SetUp code:

   List every type you plan to instantiate with \`new\` (non-MonoBehaviour only).
   For each: find its class/struct definition in the assembled context and COPY its constructor signature.
   Only after confirming the constructor signature, write the \`new\` call.

   WRONG:  new Playfield()          ← CS1729 if only \`public Playfield(GameSettings gs)\` exists
   CORRECT: new Playfield(gameSettings)

   WRONG:  new Tetrimino()          ← CS1729 if only \`public Tetrimino(TetriminoSpecs specs)\` exists
   CORRECT: new Tetrimino(new TetriminoSpecs { serializedBlockPositions = minimal100List, ... })

   Rules for complex constructor arguments:
   - Build the minimum valid argument — only assign fields needed to prevent exceptions
   - If the constructor validates a List count (e.g., must be exactly 100 elements), fill it exactly
   - If the constructor reads a nullable reference, provide a non-null minimal value`,

  /** El cierre nombra los campos del ciclo de vida, así que se va con ellos. */
  generatorScanClosing: `Write down the list of private members and Start/Awake fields before continuing.`,

  /** Las mismas palabras de bucle, ahora con la forma que usa este apartado. */
  generatorLoopKeywords: `\`foreach\` / \`for\` / \`while\``,

  /**
   * Las llamadas de entrada del motor que en PlayMode devuelven siempre lo
   * mismo, y la orden de omitir esas pruebas en lugar de rellenarlas con una
   * aserción falsa.
   */
  generatorUntestableBranches: `The following ALWAYS return false/0 in PlayMode — branches guarded ONLY by these can NEVER be taken:
  Input.GetKeyDown(...)   → always false
  Input.GetKey(...)       → always false
  Input.GetButton(...)    → always false
  Input.GetAxis(...)      → always 0
  Input.GetMouseButton(…) → always false

RULE: Do NOT write a test for any branch that is only reachable via Unity Input calls.
      Do NOT use Assert.Pass() or Assert.IsTrue(true) as placeholder tests — these are INVALID.
      OMIT those test methods entirely. Untested input branches are a known PlayMode limitation.

If the ENTIRE method body is unreachable without user input, note this and generate zero tests.`,

  /**
   * Nombre del archivo, de la clase y las ocho importaciones obligatorias.
   * El nombre que se pide aquí, `Test_<clase>_<método>`, no es el que
   * termina teniendo el archivo: OP-10 decide el definitivo y OP-11 renombra
   * la clase. Se conserva tal cual porque cambiarlo cambia el prompt.
   */
  generatorTestClassRules: `- Exactly ONE C# file, exactly ONE [TestFixture] class
- Class name: Test_<class-name>_<method-name>
- MANDATORY using statements — ALL must be present in every generated file, no exceptions:
    using NUnit.Framework;
    using UnityEngine;
    using UnityEngine.TestTools;
    using System;
    using System.Collections;
    using System.Collections.Generic;
    using System.Linq;
    using System.Reflection;
- ADDITIONALLY: add \`using XYZ;\` for every project namespace identified in STEP 0.1.
  A missing project namespace using causes CS0246 ("type not found") for every type in that namespace.`,

  /**
   * Qué atributos lleva cada prueba, en qué orden y cuál no admite
   * parámetros. Es conocimiento de NUnit y del marco de Unity a la vez.
   */
  generatorAttributeRules: `2. PlayMode tests — ATTRIBUTE RULES (read carefully)
   - All tests MUST use [UnityTest] and return IEnumerator
   - [UnityTest] takes NO named parameters — it has NO Description property
   - CORRECT:
       [UnityTest]
       [Description("what this test verifies")]
       [Timeout(1000)]
       public IEnumerator SomeTest() { ... }
   - WRONG (WILL NOT COMPILE):
       [UnityTest(Description = "...")] ← UnityTestAttribute has no Description property
   - Each test MUST have [Timeout(1000)] on its own line AFTER [UnityTest]
   - [Description("...")] is from NUnit.Framework — place it as a separate line between [UnityTest] and [Timeout]`,

  /**
   * La regla de una sola aserción es neutra y se quedó en la plantilla; lo
   * que se va es cómo se llama la aserción y qué construcciones no pueden
   * aparecer en el cuerpo.
   */
  generatorAssertionRules: `- Each test method contains EXACTLY ONE Assert statement — count it before writing
- Assert.IsNotNull IS an Assert — using it alongside any other Assert gives 2 asserts = INVALID
- If you need to verify two things, write two SEPARATE test methods, one Assert each
- NO branching or loops inside test methods (no if/else, switch, for/foreach/while, try/catch)
- Branching/loops allowed ONLY in [SetUp], [TearDown], and private helper methods
- WRONG:
    Assert.IsNotNull(result);
    Assert.IsFalse(((IEnumerable<X>)result).Any()); ← TWO asserts = will be rejected
- RIGHT:
    Assert.IsFalse(((IEnumerable<X>)result).Any()); ← ONE assert = valid`,

  /**
   * Cómo invocar un método por reflexión sin caer en la sobrecarga ambigua,
   * y cómo llega envuelta la excepción que lanza.
   */
  generatorReflectionCalls: `4. Calling methods via Reflection — GetMethod rules (read carefully)

   ALWAYS use the parameter-types overload of GetMethod:
       public method:  typeof(ClassName).GetMethod("MethodName", new Type[] { typeof(ParamType) })
       private method: typeof(ClassName).GetMethod("MethodName",
           BindingFlags.NonPublic | BindingFlags.Instance, null,
           new Type[] { typeof(ParamType) }, null)
       no-parameter:   typeof(ClassName).GetMethod("MethodName",
           BindingFlags.NonPublic | BindingFlags.Instance, null, Type.EmptyTypes, null)

   WHY: if the class has ANY other method with the same name (overload), using GetMethod without
   parameter types throws System.Reflection.AmbiguousMatchException at runtime.

   - Store the MethodInfo in [SetUp] to avoid repetition
   - CRITICAL — exception wrapping: when a method throws, Reflection.Invoke wraps it inside
     TargetInvocationException. The original exception becomes .InnerException
   - To test that a method throws:
       CORRECT:
         var ex = Assert.Throws<TargetInvocationException>(() => method.Invoke(obj, args));
       WRONG:
         Assert.That(() => method.Invoke(...), Throws.TypeOf<System.Exception>())
         ← Fails because Invoke wraps in TargetInvocationException, not the original type`,

  /**
   * Cómo se prepara el objeto de escena y por qué nunca se activa. Activarlo
   * dispara el ciclo de vida y pisa lo que la prueba acaba de preparar.
   */
  generatorSetupRules: `- Use [SetUp] / [TearDown] for repeated initialization — no duplicated code
- Instantiate GameObjects at runtime — do NOT use prefabs
- When using AddComponent (MonoBehaviour only): ALWAYS call go.SetActive(false) first
- ✗ NEVER call go.SetActive(true) anywhere — triggers Awake/Start → NullReferenceException
- Initialize ALL Start/Awake fields identified in STEP 0.5 via Reflection
- For empty-collection tests: initialize with empty collections in the test, NOT in [SetUp]
- For numeric inputs, include both positive and negative values where relevant
- Add components required by the method under test (e.g., Rigidbody2D, Animator) to the
  test GameObject before AddComponent<TargetClass>

STATIC STATE RESET — Always clean up static fields in [TearDown]:
- If the method reads or writes static fields (e.g., GameManager.gameState),
  reset them to their default/initial value in [TearDown] to prevent test pollution`,

  /** El punto de la lista de cobertura que nombra un bucle por su palabra. */
  generatorCoverageLoopItem: `□ Every \`foreach\`: one test with empty collection, one with matching item, one where loop exhausts without match`,

  /**
   * Qué no se puede sustituir por un doble: los tipos del motor y los de
   * terceros. La restricción de IL2CPP es de la cadena de compilación de
   * Unity.
   */
  generatorStubRules: `- Do NOT redefine UnityEngine or third-party engine types (e.g., DG.Tweening)
- Implement only the minimal stubs necessary to isolate non-engine collaborators
- All test doubles must be IL2CPP compatible (no dynamic proxies, no Reflection.Emit)`,

  /** `protected internal` es un nivel de visibilidad que solo existe en C#. */
  generatorEncapsulationRule: `- Protected/protected internal methods must never be exposed or wrapped`,

  /**
   * `try/catch` es la construcción de C#; en otro lenguaje se llama
   * distinto.
   */
  generatorExceptionRule: `- Do NOT use try/catch in test methods`,

  /** CS0116 otra vez, aquí como requisito del archivo entero. */
  generatorFileStructure: `11. ALL code must be inside the [TestFixture] class — CS0116 prevention
    The only content allowed OUTSIDE the class is \`using\` statements.
    Structure: usings → [TestFixture] → public class Test_... { ALL code here }
    NEVER place field declarations, methods, or any statement before [TestFixture] or after the closing }.
    VERIFY before outputting: scan from top to bottom and confirm there is exactly ONE class and
    zero declarations outside it. A single misplaced field causes CS0116 and the entire file fails.`,

  /**
   * `Assert.IsNotNull` cuenta como aserción, que es la excepción que el
   * modelo suele pasar por alto.
   */
  generatorAssertCountNote: `3. Assert.IsNotNull counts as 1 — if you pair it with another Assert you already have 2`,

  /**
   * Cuántos archivos y cuántas clases admite la salida, en el vocabulario
   * del ecosistema.
   */
  generatorOutputStructure: `- Exactly ONE file, exactly ONE [TestFixture] class`,
} as const;

export function unityPromptProfile(_project: ProjectModel): PromptProfile {
  return { vocabulary: VOCABULARY, fragments: FRAGMENTS };
}
