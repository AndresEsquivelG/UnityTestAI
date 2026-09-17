/**
 * Bloque Identidad de la interfaz de adaptación — OP-01, OP-02 y OP-03 (Tabla 10).
 *
 * Ninguna de estas tres operaciones existe hoy en el código. La aplicabilidad
 * (OP-02) está implícita y codificada en el núcleo: `getFilteredAssetsTree`
 * asume la carpeta `Assets` y aborta si no la encuentra.
 */

/**
 * OP-01 — Descriptor del adaptador.
 *
 * `id` es la clave con la que el gestor de HU-02 registra y recupera el
 * adaptador, y la etiqueta que HU-03 muestra en la interfaz.
 */
export interface AdapterDescriptor {
  /** Identificador estable y único, en minúsculas. Ej.: "unity", "java", "python". */
  readonly id: string;
  /** Nombre legible para la interfaz de usuario. Ej.: "Unity / C#". */
  readonly displayName: string;
  /** Versión del adaptador, independiente de la del framework. */
  readonly version: string;
}

/**
 * OP-02 — Resultado de la detección de aplicabilidad.
 *
 * `confidence` existe porque HU-04 resuelve la ambigüedad entre dos adaptadores
 * aplicables por grado de confianza. `evidence` existe porque HU-03 exige una
 * detección correcta en nueve de cada diez proyectos del conjunto de prueba:
 * sin registrar qué marcadores se encontraron, un fallo de detección no es
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
 * Operaciones opcionales de la interfaz, según la columna "Oblig." de la Tabla 10.
 * Son las únicas que un adaptador puede no implementar.
 */
export type OptionalOperation =
  | "analysisSchemaExtension" // OP-09
  | "compile"                 // OP-13
  | "runTests"                // OP-14
  | "coverage"                // OP-15
  | "lifecycle";              // OP-16

/**
 * OP-03 — Mapa de capacidades.
 *
 * El mapa es total: un adaptador declara explícitamente `false` en lugar de
 * omitir la clave, para que la ausencia de una capacidad sea una decisión
 * declarada y no un olvido. HU-05 exige que el núcleo omita la etapa
 * correspondiente y la reporte como no aplicable; HU-42 exige un adaptador
 * ficticio que declare deliberadamente `false` en `compile` y `coverage`.
 */
export type CapabilityMap = Readonly<Record<OptionalOperation, boolean>>;
