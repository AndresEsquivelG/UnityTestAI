import * as fsp from "fs/promises";
import type { DependencyResolution, ProjectModel } from "../../../core/contracts";
import { SOURCE_EXTENSION, absolutePath } from "../discovery/layout";

/**
 * OP-07 — Resolución de una referencia de dependencia a su archivo.
 *
 * El agente resolutor puede nombrar una dependencia de tres maneras, y las tres
 * se admiten:
 *
 *   · con la ruta que vio en el árbol: `src/main/java/com/tienda/Item.java`;
 *   · con el nombre calificado: `com.tienda.modelo.Item`. En Java el paquete
 *     es una jerarquía de carpetas, así que se traduce a
 *     `<raíz>/com/tienda/modelo/Item.java` en cada raíz de fuentes. Un tipo
 *     anidado, `com.tienda.Pedido.Estado`, está en el archivo de su tipo
 *     exterior;
 *   · con el nombre del tipo a secas: `Item`. Si dos paquetes tienen un
 *     `Item.java`, no se elige uno al azar: se informa como no resuelto, con
 *     las dos rutas.
 *
 * La búsqueda es contra el modelo del proyecto, no contra el disco a ciegas.
 */
export async function resolveJavaDependency(
  project: ProjectModel,
  reference: string
): Promise<DependencyResolution> {
  const normalized = reference
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    // Argumentos de tipo y arreglos no cambian el archivo: List<Item> es List.
    .replace(/<.*$/, "")
    .replace(/(\[\])+$/, "");

  const base = normalized.endsWith(SOURCE_EXTENSION)
    ? normalized.slice(0, -SOURCE_EXTENSION.length)
    : normalized;

  const triedPaths: string[] = [];
  const roots = project.sourceRoots.map((root) => root.relativePath);

  for (const candidate of candidatePaths(base, roots)) {
    triedPaths.push(candidate);
    const match = project.sources.find(
      (source) => source.relativePath.toLowerCase() === candidate.toLowerCase()
    );
    if (match) {
      return readResolved(project, match.relativePath);
    }
  }

  // Sin ruta que coincida, se busca el tipo por el nombre de su archivo.
  const fileName = `${outermostTypeName(base)}${SOURCE_EXTENSION}`;
  triedPaths.push(...roots.map((root) => `${root}/**/${fileName}`));
  const byName = project.sources.filter(
    (source) => source.name.toLowerCase() === fileName.toLowerCase()
  );

  if (byName.length === 1) {
    return readResolved(project, byName[0].relativePath);
  }
  if (byName.length > 1) {
    return { resolved: false, reference, triedPaths: byName.map((source) => source.relativePath) };
  }

  return { resolved: false, reference, triedPaths };
}

/** Rutas posibles de una referencia que trae ruta o paquete. */
function candidatePaths(base: string, roots: readonly string[]): string[] {
  if (base.includes("/")) {
    return unique([
      `${base}${SOURCE_EXTENSION}`,
      ...roots.map((root) => `${root}/${base}${SOURCE_EXTENSION}`),
    ]);
  }

  if (!base.includes(".")) {
    return [];
  }

  // Nombre calificado. Los últimos segmentos en mayúscula pueden ser tipos
  // anidados: se prueba primero el más largo y se va acortando.
  const segments = base.split(".");
  const paths: string[] = [];
  for (let length = segments.length; length > 0 && startsUppercase(segments[length - 1]); length--) {
    const relative = segments.slice(0, length).join("/");
    paths.push(...roots.map((root) => `${root}/${relative}${SOURCE_EXTENSION}`));
  }
  return unique(paths);
}

/**
 * Nombre del tipo de primer nivel al que se refiere una referencia: el
 * archivo de Java se llama como él.
 */
function outermostTypeName(base: string): string {
  const segments = base.split(/[/.]/).filter((segment) => segment.length > 0);
  if (base.includes("/")) {
    return segments[segments.length - 1] ?? base;
  }
  return segments.find(startsUppercase) ?? segments[segments.length - 1] ?? base;
}

function startsUppercase(segment: string): boolean {
  return /^[A-Z]/.test(segment);
}

async function readResolved(
  project: ProjectModel,
  relativePath: string
): Promise<DependencyResolution> {
  try {
    const content = await fsp.readFile(absolutePath(project.rootPath, relativePath), "utf8");
    return { resolved: true, relativePath, content };
  } catch {
    return { resolved: false, reference: relativePath, triedPaths: [relativePath] };
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
