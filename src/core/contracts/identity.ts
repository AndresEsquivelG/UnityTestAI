/**
 * Bloque Identidad de la interfaz de adaptación — OP-01, OP-02 y OP-03.
 *
 * Ninguna de las tres existe hoy en el código. La aplicabilidad está implícita
 * en `getFilteredAssetsTree`, que asume la carpeta `Assets` y, cuando no la
 * encuentra, devuelve la cadena vacía y deja que el pipeline siga adelante con
 * "(Project structure not available)" (src/prompts/promptBuilder.ts:59).
 */

/**
 * OP-01 — Descriptor del adaptador.
 *
 * `id` es la clave con la que el registro da de alta y recupera el adaptador, y
 * la etiqueta con la que la interfaz lo presenta.
 *
 * `languageIds` no decide nada: el ecosistema lo determinan los marcadores de
 * raíz del proyecto (OP-02), no el archivo abierto. Existe para que el núcleo
 * pueda resaltar el artefacto generado y avisar cuando el archivo abierto no
 * pertenece al ecosistema activo sin preguntar por `id`; en cuanto el núcleo
 * ramifica según el `id`, vuelve a quedar acoplado a un ecosistema concreto.
 */
export interface AdapterDescriptor {
  /** Identificador estable y único, en minúsculas. Ej.: "unity", "java", "python". */
  readonly id: string;
  /** Nombre legible para la interfaz de usuario. Ej.: "Unity / C#". */
  readonly displayName: string;
  /** Versión del adaptador, independiente de la del framework. */
  readonly version: string;
  /** Identificadores de lenguaje del editor que abarca el ecosistema. Ej.: ["csharp"]. */
  readonly languageIds: readonly string[];
}

/**
 * Entrada de OP-02.
 *
 * No es solo una ruta porque el núcleo no puede asumir que el proyecto ocupe la
 * primera carpeta del espacio de trabajo —hoy sí lo asume, en
 * src/webview/webviewManager.ts:234— ni que la ocupe entera: puede colgar de
 * una subcarpeta.
 *
 * `activeFile` es una pista secundaria y nunca decisiva. Dos ecosistemas
 * distintos pueden compartir lenguaje, como C# en Unity y C# en .NET con xUnit,
 * así que el veredicto lo siguen dando los marcadores de raíz.
 */
export interface DetectionContext {
  /** Raíz desde la que el adaptador busca sus marcadores. */
  readonly rootPath: string;
  /** Archivo abierto en el editor, cuando lo hay. */
  readonly activeFile?: {
    /** Ruta absoluta del archivo abierto. */
    readonly path: string;
    /** Identificador de lenguaje del editor. Ej.: "csharp", "java", "python". */
    readonly languageId: string;
  };
}

/**
 * OP-02 — Resultado de la detección de aplicabilidad.
 *
 * `confidence` permite ordenar a dos adaptadores que se declaren aplicables
 * sobre el mismo proyecto y proponer el más probable. `evidence` registra qué
 * marcadores sustentan el veredicto: sin ellos, una detección equivocada no es
 * diagnosticable.
 */
export interface ApplicabilityResult {
  readonly applicable: boolean;
  /** Grado de confianza en el intervalo [0, 1]. Debe ser 0 si `applicable` es false. */
  readonly confidence: number;
  /** Marcadores de raíz que sustentan el veredicto. Ej.: ["Assets/", "ProjectSettings/ProjectVersion.txt"]. */
  readonly evidence: readonly string[];
}

/**
 * Naturaleza de la verificación previa del artefacto que ofrece el ecosistema
 * (OP-13).
 *
 * No es un booleano porque un ecosistema interpretado no compila, pero sí puede
 * comprobar que el artefacto es sintácticamente válido y se puede importar. Es
 * la misma etapa con otro mecanismo, y la interfaz tiene que poder distinguir
 * ambas sin que el núcleo pregunte de qué ecosistema se trata.
 */
export type VerificationKind =
  /** El ecosistema compila de verdad. Unity, Java. */
  | "compile"
  /** Comprobación de validez sintáctica e importabilidad. Python. */
  | "importCheck"
  /** El adaptador no ofrece verificación previa a la ejecución. */
  | "none";

/**
 * OP-03 — Mapa de capacidades.
 *
 * El mapa es total: el adaptador declara explícitamente la ausencia de una
 * capacidad en lugar de omitir la clave, para que sea una decisión declarada y
 * no un olvido. Con esa declaración el núcleo omite la etapa, la reporta como
 * no aplicable y continúa, en vez de abortar la corrida.
 */
export interface CapabilityMap {
  /** OP-13 — qué verificación previa ofrece el ecosistema, si ofrece alguna. */
  readonly verification: VerificationKind;
  /** OP-14 — ejecución de las pruebas generadas. */
  readonly runTests: boolean;
  /** OP-15 — recolección del informe de cobertura. */
  readonly coverage: boolean;
  /** OP-09 — extensión del esquema de análisis. */
  readonly analysisSchemaExtension: boolean;
  /** OP-16 — preparación previa y limpieza posterior. */
  readonly lifecycle: boolean;
}

/**
 * Operaciones opcionales de la interfaz. Se derivan del mapa de capacidades
 * para que ambas listas no puedan divergir.
 */
export type OptionalOperation = keyof CapabilityMap;
