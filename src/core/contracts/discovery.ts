/**
 * Bloque Descubrimiento de la interfaz de adaptación — OP-04 (Tabla 10).
 *
 * Es la operación que ejercita el criterio de aceptación de HU-01: el núcleo
 * debe obtener "un modelo de proyecto normalizado sin conocer la tecnología
 * subyacente".
 *
 * Hoy la operación existe como `getFilteredAssetsTree`, en el núcleo, y
 * devuelve un `string` con un árbol ASCII —no un modelo—, con la carpeta
 * `Assets` y la extensión `.cs` incrustadas. La conversión del modelo a texto
 * para inyectarlo en el prompt es responsabilidad del núcleo y no del
 * adaptador: el formato del árbol es idéntico en los tres ecosistemas.
 */

/** Naturaleza de una jerarquía de fuentes dentro del proyecto. */
export type SourceRootKind = "main" | "test";

/**
 * Jerarquía de fuentes declarada por el adaptador.

 */
export interface SourceRoot {
  /** Ruta relativa a `ProjectModel.rootPath`, con separador "/". */
  readonly relativePath: string;
  readonly kind: SourceRootKind;
}

/** Archivo fuente relevante, ya filtrado por el adaptador. */
export interface SourceFile {
  /** Ruta relativa a `ProjectModel.rootPath`, con separador "/" en todos los sistemas. */
  readonly relativePath: string;
  /** Nombre del archivo con su extensión. */
  readonly name: string;
  /** Jerarquía a la que pertenece, o `null` si no cae bajo ninguna declarada. */
  readonly sourceRoot: SourceRootKind | null;
}

/**
 * OP-04 — Modelo del proyecto.
 *
 * El filtrado ya viene aplicado por el adaptador: qué extensiones son fuentes
 * relevantes y qué carpetas se excluyen son decisiones del ecosistema. HU-23
 * exige excluir entornos virtuales y cachés en Python; el núcleo no puede
 * conocer esa regla.
 */
export interface ProjectModel {
  /** Raíz absoluta desde la que se resuelven todas las rutas relativas del modelo. */
  readonly rootPath: string;
  /** `AdapterDescriptor.id` del adaptador que construyó el modelo. */
  readonly ecosystemId: string;
  readonly sourceRoots: readonly SourceRoot[];
  readonly sources: readonly SourceFile[];
}
