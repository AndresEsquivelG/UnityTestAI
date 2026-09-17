/**
 * Bloque Descubrimiento de la interfaz de adaptación — OP-04.
 *
 * Hoy la operación existe como `getFilteredAssetsTree`, en el núcleo, y devuelve
 * un `string` con un árbol ASCII —no un modelo—, con la carpeta `Assets` y la
 * extensión `.cs` incrustadas. Convertir el modelo a texto para inyectarlo en el
 * prompt sigue siendo responsabilidad del núcleo y no del adaptador: el formato
 * del árbol es idéntico en los tres ecosistemas.
 */

/** Naturaleza de una jerarquía de fuentes dentro del proyecto. */
export type SourceRootKind = "main" | "test";

/** Jerarquía de fuentes declarada por el adaptador. */
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
 * relevantes y qué carpetas se excluyen son decisiones del ecosistema. En
 * Python hay que descartar los entornos virtuales y las carpetas de caché, y el
 * núcleo no puede conocer esa regla.
 */
export interface ProjectModel {
  /** Raíz absoluta desde la que se resuelven todas las rutas relativas del modelo. */
  readonly rootPath: string;
  /** `AdapterDescriptor.id` del adaptador que construyó el modelo. */
  readonly ecosystemId: string;
  readonly sourceRoots: readonly SourceRoot[];
  readonly sources: readonly SourceFile[];
  /**
   * Datos que el adaptador averiguó al recorrer el proyecto y que necesita
   * después, en las operaciones que reciben este mismo modelo. El núcleo los
   * transporta sin leerlos ni interpretarlos.
   *
   * Existe porque el modelo es la única memoria del descubrimiento: sin él, el
   * adaptador tendría que volver a recorrer el proyecto en cada operación para
   * recordar lo que ya sabía, como si el proyecto declara Maven o Gradle —de lo
   * que dependen la verificación y la ejecución— o dónde está el archivo de
   * definición de ensamblado que hay que comprobar antes de escribir.
   *
   * Es el único punto del modelo donde caben conceptos de un ecosistema, y por
   * eso su contenido es opaco: en cuanto el núcleo leyera una de estas claves,
   * volvería a depender de una tecnología concreta.
   */
  readonly adapterData?: Readonly<Record<string, unknown>>;
}
