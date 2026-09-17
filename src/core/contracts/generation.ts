import type { ZodRawShape } from "zod";

/**
 * Bloque Generación de la interfaz de adaptación — OP-08 y OP-09 (Tabla 10).
 */

/**
 * Puntos de extensión que las plantillas neutras del núcleo exponen y que el
 * perfil del adaptador rellena (HU-07).
 *
 * La lista no es arbitraria: cada punto corresponde a una categoría de
 * conocimiento específico que hoy está incrustada en prompts/*.txt. Entre
 * paréntesis, las líneas de las que se derivó cada uno.
 */
export type PromptExtensionPoint =
  /** Framework de pruebas, aserciones y parametrización admitidas.
   *  (basePrompt.txt:3,11,12,16,18 · testGeneratorPrompt.txt:5) */
  | "testFramework"
  /** Importaciones obligatorias del archivo de prueba.
   *  (testGeneratorPrompt.txt:236-238) */
  | "requiredImports"
  /** Atributos o decoradores que debe llevar cada prueba y sus restricciones.
   *  (testGeneratorPrompt.txt:247-258) */
  | "testAttributes"
  /** Reglas de instanciación de los tipos bajo prueba y de sus auxiliares.
   *  (testGeneratorPrompt.txt:39-63,154-163,298-305) */
  | "instantiation"
  /** Reglas propias del lenguaje: visibilidad por defecto, métodos especiales.
   *  (testGeneratorPrompt.txt:88,128) */
  | "languageRules"
  /** Librerías permitidas y prohibidas en el artefacto generado.
   *  (basePrompt.txt:20,45) */
  | "libraryConstraints"
  /** Estructura exigida al archivo generado: cuántas unidades, cuántas clases.
   *  (basePrompt.txt:59 · testGeneratorPrompt.txt:233) */
  | "artifactStructure"
  /** Ramas que el ecosistema hace inalcanzables y que deben omitirse.
   *  (testGeneratorPrompt.txt:213-222) */
  | "untestableBranches"
  /** Ejemplos propios del ecosistema, mencionados en la descripción de OP-08. */
  | "examples";

/**
 * OP-08 — Perfil de prompt.
 *
 * El mapa es parcial de forma deliberada: HU-07 exige que la plantilla del
 * núcleo funcione cuando un punto de extensión no viene relleno, y HU-42
 * requiere un adaptador con capacidades incompletas. Un punto ausente se
 * resuelve como cadena vacía, nunca como error.
 */
export interface PromptProfile {
  readonly fragments: Readonly<Partial<Record<PromptExtensionPoint, string>>>;
}

/**
 * OP-09 — Extensión del esquema de análisis. Operación OPCIONAL.
 *
 * El esquema común del análisis de código lo define el núcleo con Zod; por eso
 * esta es la única operación de la interfaz cuyo valor de retorno es un tipo de
 * Zod y no un tipo propio: el fragmento tiene que poder fusionarse con el
 * esquema común.
 *
 * Hoy la relación está invertida. Los campos propios de Unity viven dentro del
 * esquema del núcleo, en src/agents/codeAnalyzer.ts: el valor "unityMessage"
 * de `kind` (línea 34), `startAwakeFields` con `initIn: "Awake" | "Start"`
 * (líneas 41-44 y 63) y el patrón "AddComponent" (línea 75). Son los campos
 * que esta operación debe sacar del núcleo.
 */
export interface AnalysisSchemaExtension {
  /** Campos que se fusionan con el esquema común del análisis. */
  readonly fields: ZodRawShape;
  /** Texto que describe esos campos y que el núcleo inyecta en el prompt del analizador. */
  readonly promptFragment: string;
}
