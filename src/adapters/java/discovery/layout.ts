import * as fsp from "fs/promises";
import * as path from "path";

/**
 * Convenciones de un proyecto Java de un solo módulo, las mismas en Maven y en
 * Gradle: dónde está el código, dónde van las pruebas y qué archivo declara la
 * herramienta de construcción.
 *
 * Las usan la detección, el modelo del proyecto, la resolución de
 * dependencias y la ubicación de la prueba. Están juntas para que esas cuatro
 * operaciones no puedan discrepar sobre dónde está cada cosa.
 *
 * Fuera de alcance, por ahora: los proyectos de varios módulos, con el código
 * en subcarpetas, y las carpetas de fuentes configuradas a mano en el
 * descriptor. Un proyecto así no tiene `src/main/java` en la raíz y la
 * detección no lo reclama.
 */

export const MAIN_ROOT = "src/main/java";
export const TEST_ROOT = "src/test/java";
export const SOURCE_EXTENSION = ".java";

/**
 * Archivos que terminan en `.java` pero no declaran ningún tipo: la
 * documentación de un paquete y la descripción de un módulo. No tienen nada
 * que probar ni que pedir como dependencia.
 */
export const NON_TYPE_FILES = new Set(["package-info.java", "module-info.java"]);

export type BuildTool = "maven" | "gradle";

export interface BuildDescriptor {
  readonly tool: BuildTool;
  /** Nombre del archivo que la declara, en la raíz del proyecto. */
  readonly file: string;
}

/**
 * Descriptores en orden de preferencia. Si un proyecto tiene `pom.xml` y un
 * `build.gradle` a la vez, manda Maven: es raro, y alguna de las dos hay que
 * elegir para compilar y ejecutar.
 */
const DESCRIPTORS: readonly BuildDescriptor[] = [
  { tool: "maven", file: "pom.xml" },
  { tool: "gradle", file: "build.gradle.kts" },
  { tool: "gradle", file: "build.gradle" },
];

/** Descriptor de construcción en la raíz del proyecto, o `null` si no hay. */
export async function findBuildDescriptor(rootPath: string): Promise<BuildDescriptor | null> {
  for (const descriptor of DESCRIPTORS) {
    if (await isFile(path.join(rootPath, descriptor.file))) {
      return descriptor;
    }
  }
  return null;
}

export async function isFile(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isFile();
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** Convierte una ruta relativa con «/» en una ruta del sistema bajo la raíz. */
export function absolutePath(rootPath: string, relativePath: string): string {
  return path.join(rootPath, ...relativePath.split("/"));
}
