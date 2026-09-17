import type { ZodRawShape } from "zod";

/**
 * Bloque Generación de la interfaz de adaptación — OP-08 y OP-09.
 */

/**
 * Puntos de extensión que las plantillas neutras del núcleo exponen y que el
 * perfil del adaptador rellena.
 *
 * LISTA PROVISIONAL E INCOMPLETA. Cada punto se derivó de conocimiento
 * incrustado hoy en prompts/testGeneratorPrompt.txt, que es una de las ocho
 * plantillas que el pipeline carga (src/prompts/promptBuilder.ts). Las otras
 * siete también contienen conocimiento del ecosistema —p. ej.
 * prompts/chatFixerPrompt.txt:1, prompts/testValidatorPrompt.txt:14-75,
 * prompts/codeAnalyzerPrompt.txt:116-126 y prompts/contextBuilderPrompt.txt:26—
 * y de ellas saldrán al menos el acceso a miembros privados por reflexión y la
 * lista de comprobaciones del validador.
 *
 * La lista se completa al extraer las plantillas y no antes: el reparto entre
 * plantilla neutra y perfil solo se conoce al separarlas. Entre paréntesis, las
 * líneas de las que se derivó cada punto.
 *
 * prompts/basePrompt.txt no se cita aunque contiene las mismas reglas: esa
 * plantilla no se carga en ninguna parte, es código muerto.
 */
export type PromptExtensionPoint =
  /** Framework de pruebas, aserciones y parametrización admitidas.
   *  (testGeneratorPrompt.txt:5) */
  | "testFramework"
  /** Importaciones obligatorias del archivo de prueba y su resolución.
   *  (testGeneratorPrompt.txt:65-80,235-245) */
  | "requiredImports"
  /** Atributos o decoradores que debe llevar cada prueba y sus restricciones.
   *  (testGeneratorPrompt.txt:247-258) */
  | "testAttributes"
  /** Reglas de instanciación de los tipos bajo prueba y de sus auxiliares.
   *  (testGeneratorPrompt.txt:35-63,146-176,295-309) */
  | "instantiation"
  /** Reglas propias del lenguaje: visibilidad por defecto, métodos especiales.
   *  (testGeneratorPrompt.txt:86-144) */
  | "languageRules"
  /** Librerías permitidas y prohibidas en el artefacto generado.
   *  (testGeneratorPrompt.txt:318-321) */
  | "libraryConstraints"
  /** Estructura exigida al archivo generado: cuántas unidades, cuántas clases.
   *  (testGeneratorPrompt.txt:233,336-341) */
  | "artifactStructure"
  /** Ramas que el ecosistema hace inalcanzables y que deben omitirse.
   *  (testGeneratorPrompt.txt:211-224) */
  | "untestableBranches"
  /** Ejemplos de código propios del ecosistema. */
  | "examples";

/**
 * OP-08 — Perfil de prompt.
 *
 * El mapa es parcial de forma deliberada: la plantilla neutra tiene que seguir
 * funcionando cuando un punto de extensión no viene relleno, porque un
 * adaptador puede no aportarlos todos. Un punto ausente se resuelve como cadena
 * vacía, nunca como error.
 *
 * El perfil no es un valor fijo del adaptador sino el resultado de
 * `getPromptProfile(project)`, porque depende del proyecto concreto: la
 * variante del marco de pruebas —JUnit 4 o 5, pytest o unittest, PlayMode o
 * EditMode— y la herramienta de construcción solo se conocen después del
 * descubrimiento. Con un perfil fijo, esa decisión volvería al núcleo en forma
 * de condición por ecosistema o forzaría un adaptador por variante.
 */
export interface PromptProfile {
  readonly fragments: Readonly<Partial<Record<PromptExtensionPoint, string>>>;
}

/**
 * OP-09 — Extensión del esquema de análisis. Operación OPCIONAL.
 *
 * El esquema común del análisis lo define el núcleo con Zod; por eso esta es la
 * única operación de la interfaz cuyo valor de retorno incluye un tipo de Zod y
 * no un tipo propio: el fragmento tiene que poder fusionarse con ese esquema.
 *
 * Hoy la relación está invertida. Los campos propios de Unity viven dentro del
 * esquema del núcleo, en src/agents/codeAnalyzer.ts: el valor "unityMessage"
 * de `kind` (línea 34), `startAwakeFields` con `initIn: "Awake" | "Start"`
 * (líneas 41-44 y 63) y el patrón "AddComponent" (línea 75). Son los campos que
 * esta operación debe sacar del núcleo.
 */
export interface AnalysisSchemaExtension {
  /** Campos que se fusionan con el esquema común del análisis. */
  readonly fields: ZodRawShape;
  /** Texto que describe esos campos y que el núcleo inyecta en el prompt del analizador. */
  readonly promptFragment: string;
  /**
   * Convierte los valores que el analizador devolvió para esos campos en el
   * texto que el núcleo inyecta en el prompt de generación.
   *
   * Sin esta operación la extensión solo funciona de ida: el núcleo recibiría
   * campos que no sabe presentar. Hoy los presenta él mismo, en
   * `formatCodeAnalysis` (src/webview/webviewManager.ts:141-187), que conoce
   * `startAwakeFields` y el patrón "AddComponent"; ese es exactamente el código
   * que esta operación saca del núcleo.
   *
   * `data` son los valores ya validados contra `fields`; el adaptador los
   * estrecha a su propio tipo y el núcleo no los interpreta. Devuelve la cadena
   * vacía cuando no hay nada que añadir al prompt.
   */
  format(data: unknown): string;
}
