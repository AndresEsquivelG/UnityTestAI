import type { ZodRawShape } from "zod";

/**
 * Bloque Generación de la interfaz de adaptación — OP-08 y OP-09.
 */

/**
 * Vocabulario obligatorio del perfil.
 *
 * Son las palabras sueltas que las plantillas neutras necesitan a mitad de una
 * frase y que ningún adaptador puede dejar sin responder: si faltara una, el
 * prompt quedaría con un hueco en medio de una oración. Por eso es un tipo
 * cerrado con miembros requeridos, y no un mapa parcial como los fragmentos.
 *
 * La regla para decidir si algo es vocabulario o fragmento: vocabulario cuando
 * es un sustantivo o una enumeración que se inserta dentro de una frase neutra;
 * fragmento cuando es una regla, un apartado o un ejemplo enteros, porque otro
 * ecosistema los redactaría de otra manera y no solo con otra palabra.
 *
 * La lista crece a medida que se reparten las plantillas. Hoy están las cuatro
 * que necesitan las plantillas de los cuatro primeros agentes; las del generador
 * y el analizador aparecerán al repartir esas dos.
 */
export interface PromptVocabulary {
  /** Nombre del ecosistema tal como se nombra en el prompt. Ej.: "Unity". */
  readonly ecosystem: string;
  /** Nombre del lenguaje. Ej.: "C#", "Java", "Python". */
  readonly language: string;
  /** Marco de pruebas con su variante. Ej.: "NUnit PlayMode", "JUnit 5", "pytest". */
  readonly testFramework: string;
  /**
   * Cómo se llaman, en plural y en minúscula, las declaraciones de importación.
   * Ej.: "using statements", "import statements".
   */
  readonly importStatements: string;
  /**
   * Enumeración de lo que cuenta como tipo en el lenguaje, tal como se lee
   * dentro de una frase. Ej.: "type, class, enum, or struct".
   */
  readonly typeKinds: string;
  /**
   * Con qué empieza una línea de aserción, para poder contarlas.
   * Ej.: "Assert.", "assert".
   */
  readonly assertionPrefix: string;
  /**
   * Palabras que introducen una bifurcación, tal como se enumeran dentro de una
   * frase. Ej.: "if/else, for, foreach, while, or try/catch".
   */
  readonly controlFlowKeywords: string;
  /** Palabras que introducen un bucle. Ej.: "foreach/for/while". */
  readonly loopKeywords: string;
}

/**
 * Puntos de extensión que las plantillas neutras exponen y que el perfil del
 * adaptador rellena.
 *
 * Un punto ocupa una línea entera de la plantilla, o se inserta dentro de una
 * línea. Cuando el perfil no lo trae, la línea que lo contenía desaparece: esa
 * es la forma de que una plantilla siga funcionando con un adaptador que no
 * aporta ese bloque.
 *
 * Los nombres llevan por delante el agente que los consume porque el mismo
 * conocimiento se redacta distinto en cada plantilla: el validador lo enuncia
 * como un punto de una lista con veredicto, y el corrector como una regla que
 * hay que aplicar. Son textos distintos y por eso son puntos distintos.
 *
 * Los que numeran un punto de una lista se llevan el número dentro del
 * fragmento. Así, si un adaptador no aporta ese bloque, la lista se saltea el
 * número en vez de quedar con un número suelto y nada detrás.
 *
 * Las ocho plantillas están repartidas, así que todos los puntos de esta lista
 * están en uso. Entre paréntesis, la línea del original de la que salió cada
 * uno: son las del archivo antes de cortarlo, que es donde se puede ir a
 * comprobar que el fragmento se movió tal cual.
 */
export type PromptExtensionPoint =
  // Cortador de métodos
  /** Qué importaciones entran en el recorte y por qué.
   *  (methodSlicerPrompt.txt:20) */
  | "sliceImportRule"
  /** Ejemplo del recorte que se espera, en la forma del lenguaje.
   *  (methodSlicerPrompt.txt:38-51) */
  | "sliceExample"

  // Resolutor de dependencias
  /** Tipos que no cuentan como dependencia: los del motor, los de la biblioteca
   *  estándar y los de terceros.
   *  (dependencyResolverPrompt.txt:12-14) */
  | "ignoredTypes"
  /** Formas de uso que delatan una dependencia y son propias del lenguaje.
   *  (dependencyResolverPrompt.txt:16) */
  | "dependencyEvidence"
  /** Ejemplo de una ruta de archivo fuente del proyecto.
   *  (dependencyResolverPrompt.txt:39) */
  | "sourcePathExample"

  // Constructor de contexto
  /** Qué se conserva de cada clase de tipo al recortar una dependencia.
   *  (contextBuilderPrompt.txt:20-22) */
  | "dependencySliceRules"
  /** Qué hace válido sintácticamente al recorte de una dependencia.
   *  (contextBuilderPrompt.txt:26) */
  | "dependencySliceSyntax"
  /** Ejemplo del recorte de una dependencia, con su ruta.
   *  (contextBuilderPrompt.txt:53-54) */
  | "dependencySliceExample"

  // Validador de pruebas
  /** Estructura exigida al archivo de prueba. (testValidatorPrompt.txt:14) */
  | "validatorStructure"
  /** Importaciones obligatorias y las del proyecto. (testValidatorPrompt.txt:16-19) */
  | "validatorImports"
  /** Qué marca a un método como prueba y qué devuelve. (testValidatorPrompt.txt:21) */
  | "validatorTestMethods"
  /** Límite de tiempo por prueba, si el marco lo admite. (testValidatorPrompt.txt:23) */
  | "validatorTimeout"
  /** Aserciones que cuentan aparte al aplicar la regla de una sola.
   *  (testValidatorPrompt.txt:30-31) */
  | "validatorAssertionNotes"
  /** Formas concretas de prueba falsa y qué hacer con ellas.
   *  (testValidatorPrompt.txt:36-42) */
  | "validatorFakeTests"
  /** Cómo se instancia un tipo del ecosistema y cómo no.
   *  (testValidatorPrompt.txt:44-49) */
  | "validatorInstantiation"
  /** Argumentos de constructor que el lenguaje exige.
   *  (testValidatorPrompt.txt:51-55) */
  | "validatorConstructorArgs"
  /** Qué falla al acceder por reflexión a una propiedad calculada.
   *  (testValidatorPrompt.txt:57-60) */
  | "validatorComputedProperties"
  /** Llamadas del ciclo de vida del ecosistema que no deben aparecer.
   *  (testValidatorPrompt.txt:62) */
  | "validatorLifecycleCalls"
  /** Ramas que el ecosistema hace inalcanzables y se excluyen de la cobertura.
   *  (testValidatorPrompt.txt:65) */
  | "validatorUntestableBranches"
  /** Qué cuenta como error de sintaxis en el lenguaje.
   *  (testValidatorPrompt.txt:70) */
  | "validatorSyntax"
  /** Dónde tiene que estar cada declaración dentro del archivo.
   *  (testValidatorPrompt.txt:72-75) */
  | "validatorFileStructure"
  /** Con qué empieza un archivo de prueba corregido.
   *  (testValidatorPrompt.txt:99) */
  | "validatorOutputStart"

  // Corrector por chat
  /** Importaciones que hay que agregar y qué falla sin ellas.
   *  (chatFixerPrompt.txt:31-36) */
  | "fixerImports"
  /** Cómo se controla una propiedad calculada. (chatFixerPrompt.txt:38-43) */
  | "fixerComputedProperties"
  /** Ramas inalcanzables y tipos que no se instancian con el operador normal.
   *  (chatFixerPrompt.txt:45-55) */
  | "fixerUntestableBranches"
  /** Argumentos de constructor que el lenguaje exige. (chatFixerPrompt.txt:57-61) */
  | "fixerConstructorArgs"
  /** Dónde tiene que estar cada declaración dentro del archivo.
   *  (chatFixerPrompt.txt:63-68) */
  | "fixerFileStructure"
  /** Con qué empieza un archivo de prueba corregido. (chatFixerPrompt.txt:74) */
  | "fixerOutputStart"
  /** Ejemplo del resumen de una corrección. (chatFixerPrompt.txt:83) */
  | "fixerSummaryExample"

  // Analizador de código
  //
  // Es la plantilla donde el ecosistema aparece más veces, porque describe el
  // esquema del análisis y ese esquema hoy tiene campos propios de Unity. Varios
  // de estos puntos son candidatos a migrar a OP-09 cuando esa operación se
  // implemente: ver la deuda anotada en el documento de traspaso.

  /** Tipos que no cuentan como dependencia del proyecto.
   *  (codeAnalyzerPrompt.txt:10-12) */
  | "analyzerIgnoredTypes"
  /** Qué palabras introducen un bucle, al armar la tabla de decisión.
   *  (codeAnalyzerPrompt.txt:32) */
  | "analyzerLoopKinds"
  /** Apartado de bucles: cuáles hay y qué es su condición.
   *  (codeAnalyzerPrompt.txt:36-38) */
  | "analyzerLoops"
  /** Ramas que el ecosistema hace inalcanzables y cómo reconocerlas.
   *  (codeAnalyzerPrompt.txt:43-49) */
  | "analyzerUntestableBranches"
  /** Qué clases de miembro privado existen y cómo se describen.
   *  (codeAnalyzerPrompt.txt:61-83) */
  | "analyzerPrivateMemberKinds"
  /** Visibilidad que asume el lenguaje cuando no se declara ninguna.
   *  (codeAnalyzerPrompt.txt:86) */
  | "analyzerDefaultVisibility"
  /** Campos que inicializa el ciclo de vida del motor y hay que reponer.
   *  (codeAnalyzerPrompt.txt:91-100) */
  | "analyzerLifecycleFields"
  /** Cómo se agrupan los tipos y qué hay que declarar para alcanzarlos.
   *  (codeAnalyzerPrompt.txt:102-105) */
  | "analyzerNamespaces"
  /** Decisiones de instanciación que se calculan por adelantado.
   *  (codeAnalyzerPrompt.txt:112-138) */
  | "analyzerPreFlight"
  /** Comprobaciones finales que dependen del ecosistema.
   *  (codeAnalyzerPrompt.txt:144-149) */
  | "analyzerVerification"
  /** Valores admitidos para la clase de una dependencia.
   *  (codeAnalyzerPrompt.txt:169) */
  | "analyzerDependencyKinds"
  /** Valores admitidos para la clase de un bucle.
   *  (codeAnalyzerPrompt.txt:175) */
  | "analyzerLoopTypeValues"
  /** Valores admitidos para la clase de un miembro privado.
   *  (codeAnalyzerPrompt.txt:181) */
  | "analyzerMemberKinds"
  /** Campo del esquema con los valores que repone el ciclo de vida.
   *  (codeAnalyzerPrompt.txt:187-189) */
  | "analyzerLifecycleFieldsSchema"
  /** Campo del esquema con las declaraciones de importación del proyecto.
   *  (codeAnalyzerPrompt.txt:190) */
  | "analyzerRequiredUsingsSchema"
  /** Ejemplo de una rama inalcanzable. (codeAnalyzerPrompt.txt:192) */
  | "analyzerUntestableBranchExample"
  /** Valores admitidos para la forma de instanciar un tipo.
   *  (codeAnalyzerPrompt.txt:198) */
  | "analyzerInstantiationPatterns"
  /** Qué anotar sobre la firma del constructor. (codeAnalyzerPrompt.txt:199) */
  | "analyzerConstructorSignatureNote"
  /** Qué justifica la forma de instanciar elegida. (codeAnalyzerPrompt.txt:202) */
  | "analyzerInstantiationReason"
  /** Ejemplo de una propiedad calculada y cómo controlarla.
   *  (codeAnalyzerPrompt.txt:207-209) */
  | "analyzerComputedPropertyExample"

  // Generador de pruebas
  //
  // La plantilla más larga, y la que más se desdobló: los siete puntos que se
  // habían anticipado al diseñar el contrato resultaron ser veinticinco. Se
  // separan por concepto y no por apartado para que un adaptador pueda omitir lo
  // que su ecosistema no tiene —los mensajes del motor, los campos que repone el
  // ciclo de vida— y conservar lo que sí —la reflexión, los constructores—.

  /** Nombre del marco de pruebas con su variante, tal como lo enuncia el
   *  objetivo. (testGeneratorPrompt.txt:5) */
  | "generatorTestFramework"
  /** Qué trae la lista precalculada del analizador.
   *  (testGeneratorPrompt.txt:27-30) */
  | "generatorPreFlightItems"
  /** Cómo se decide la forma de instanciar el tipo bajo prueba.
   *  (testGeneratorPrompt.txt:37-63) */
  | "generatorInstantiationCheck"
  /** Apartado de espacios de nombres e importaciones que hay que declarar.
   *  (testGeneratorPrompt.txt:65-80) */
  | "generatorNamespaceStep"
  /** Visibilidad que asume el lenguaje cuando no se declara ninguna.
   *  (testGeneratorPrompt.txt:88) */
  | "generatorDefaultVisibility"
  /** Cómo se alcanza por reflexión lo que no es público.
   *  (testGeneratorPrompt.txt:91-126) */
  | "generatorReflection"
  /** Métodos que el motor invoca y que nunca son públicos.
   *  (testGeneratorPrompt.txt:128-137) */
  | "generatorEngineMessages"
  /** Cómo se nombra un tipo anidado desde fuera.
   *  (testGeneratorPrompt.txt:139-144) */
  | "generatorNestedEnums"
  /** Campos que repone el ciclo de vida y hay que inicializar a mano.
   *  (testGeneratorPrompt.txt:146-176) */
  | "generatorLifecycleFields"
  /** Argumentos de constructor que el lenguaje exige.
   *  (testGeneratorPrompt.txt:178-193) */
  | "generatorConstructorParams"
  /** Cierre del apartado de exploración. (testGeneratorPrompt.txt:195) */
  | "generatorScanClosing"
  /** Palabras que introducen un bucle, al enumerar los casos de prueba.
   *  (testGeneratorPrompt.txt:204) */
  | "generatorLoopKeywords"
  /** Llamadas que el ecosistema deja siempre en falso y las ramas que eso
   *  vuelve inalcanzables. (testGeneratorPrompt.txt:213-224) */
  | "generatorUntestableBranches"
  /** Estructura, nombre e importaciones obligatorias del archivo generado.
   *  (testGeneratorPrompt.txt:233-245) */
  | "generatorTestClassRules"
  /** Qué marca a un método como prueba y qué restricciones tienen esas marcas.
   *  (testGeneratorPrompt.txt:247-258) */
  | "generatorAttributeRules"
  /** Cómo se cuentan las aserciones y qué no puede haber en el cuerpo.
   *  (testGeneratorPrompt.txt:261-270) */
  | "generatorAssertionRules"
  /** Cómo se invoca un método por reflexión y cómo llega su excepción.
   *  (testGeneratorPrompt.txt:272-293) */
  | "generatorReflectionCalls"
  /** Cómo se prepara y se limpia cada prueba.
   *  (testGeneratorPrompt.txt:297-309) */
  | "generatorSetupRules"
  /** Punto de la lista de cobertura que nombra un bucle.
   *  (testGeneratorPrompt.txt:314) */
  | "generatorCoverageLoopItem"
  /** Qué se puede sustituir por un doble y qué no.
   *  (testGeneratorPrompt.txt:319-321) */
  | "generatorStubRules"
  /** Niveles de visibilidad que no se pueden tocar.
   *  (testGeneratorPrompt.txt:325) */
  | "generatorEncapsulationRule"
  /** Construcción del lenguaje para capturar excepciones, prohibida en el
   *  cuerpo de una prueba. (testGeneratorPrompt.txt:328) */
  | "generatorExceptionRule"
  /** Dónde tiene que estar cada declaración dentro del archivo.
   *  (testGeneratorPrompt.txt:336-341) */
  | "generatorFileStructure"
  /** Aserción que cuenta aparte al aplicar la regla de una sola.
   *  (testGeneratorPrompt.txt:349) */
  | "generatorAssertCountNote"
  /** Cuántas unidades y cuántas clases admite el archivo generado.
   *  (testGeneratorPrompt.txt:358) */
  | "generatorOutputStructure";

/**
 * OP-08 — Perfil de prompt.
 *
 * Dos mitades con reglas distintas, que es la división que se había anticipado
 * al diseñar el contrato y que el reparto de las plantillas confirmó:
 *
 *   · `vocabulary` es obligatorio y completo, porque sus valores caen dentro de
 *     frases que no se sostienen sin ellos;
 *   · `fragments` es parcial, porque un adaptador puede no tener nada que decir
 *     en un punto y la plantilla tiene que seguir siendo válida. Un punto
 *     ausente no es un error: la línea que lo contenía simplemente no se emite.
 *
 * El perfil no es un valor fijo del adaptador sino el resultado de
 * `getPromptProfile(project)`, porque depende del proyecto concreto: la
 * variante del marco de pruebas —JUnit 4 o 5, pytest o unittest, PlayMode o
 * EditMode— y la herramienta de construcción solo se conocen después del
 * descubrimiento. Con un perfil fijo, esa decisión volvería al núcleo en forma
 * de condición por ecosistema o forzaría un adaptador por variante.
 */
export interface PromptProfile {
  readonly vocabulary: PromptVocabulary;
  readonly fragments: Readonly<Partial<Record<PromptExtensionPoint, string>>>;
}

/**
 * OP-09 — Extensión del esquema de análisis. Operación OPCIONAL.
 *
 * El esquema común del análisis lo define el núcleo con Zod; por eso esta es la
 * única operación de la interfaz cuyo valor de retorno incluye un tipo de Zod y
 * no un tipo propio: el fragmento tiene que poder fusionarse con ese esquema.
 *
 * No tiene un campo de texto para el prompt del analizador, aunque el diseño
 * inicial lo preveía. Al repartir `prompts/codeAnalyzerPrompt.txt` quedó a la
 * vista que ese conocimiento no cae en un solo sitio sino en nueve, y que los
 * puntos de extensión de OP-08 ya saben repartirse por la plantilla. Un único
 * bloque de texto habría obligado a reordenar el prompt para juntarlo todo.
 */
export interface AnalysisSchemaExtension {
  /**
   * Campos que se fusionan con el esquema común del análisis.
   *
   * Solo entran los que **únicamente existen en este ecosistema**. Un campo cuyo
   * concepto vale para los tres —una rama inalcanzable, por ejemplo— se queda en
   * el núcleo aunque su presentación sea propia del ecosistema; para eso está
   * `format`.
   */
  readonly fields: ZodRawShape;
  /**
   * Presenta la parte del análisis que el núcleo no sabe presentar sin nombrar
   * una tecnología, para inyectarla en el prompt de generación.
   *
   * Recibe el análisis **entero** y no solo los campos de `fields`, porque la
   * frontera entre los dos no coincide: hay campos del núcleo cuya redacción
   * nombra una herramienta concreta. El adaptador estrecha lo que recibe a su
   * propio tipo; el núcleo no interpreta nada.
   *
   * El texto se concatena después del que arma el núcleo, así que el adaptador
   * decide sus propios encabezados y su propia separación. Devuelve la cadena
   * vacía cuando no hay nada que añadir.
   */
  format(analysis: unknown): string;
}
