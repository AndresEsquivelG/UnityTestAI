import * as fsp from "fs/promises";
import type { DependencyResolution, ProjectModel, SourceFile } from "../../../core/contracts";
import { PROJECT_ROOT, SOURCE_EXTENSION, absolutePath, moduleNameOf } from "../discovery/layout";
import { importRootOf } from "../discovery/projectModel";
import { findClasses, moduleFunctions, outlinePython } from "../source/declarations";

/**
 * OP-07 — Resolución de una referencia de dependencia a su archivo.
 *
 * El agente resolutor puede nombrar una dependencia de tres maneras, como en
 * Java, y las tres se admiten:
 *
 *   · con la ruta que vio en el árbol: `tienda/modelo.py`;
 *   · con el nombre con puntos de un módulo, como se escribe en un `import`:
 *     `tienda.modelo`, que es `tienda/modelo.py` o el paquete
 *     `tienda/modelo/__init__.py`. Si además nombra algo de adentro,
 *     `tienda.modelo.Item`, se va acortando hasta dar con el módulo;
 *   · con un nombre a secas: `Item`. En Python el archivo no se llama como la
 *     clase, así que se busca el módulo con ese nombre y, si no hay, el
 *     archivo que declara una clase o una función de módulo con ese nombre. Si
 *     son dos, no se elige uno al azar: se informa como no resuelto, con las
 *     dos rutas.
 *
 * La búsqueda es contra el modelo del proyecto, no contra el disco a ciegas.
 */
export async function resolvePythonDependency(
  project: ProjectModel,
  reference: string
): Promise<DependencyResolution> {
  const normalized = reference
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    // Los argumentos de una anotación no cambian el archivo: list[Item] es list.
    .replace(/\[.*$/, "")
    // Una importación relativa (`.modelo`) se busca por el nombre que sigue.
    .replace(/^\.+/, "");

  const triedPaths: string[] = [];

  // Una ruta del árbol, también la de un archivo de la raíz, que no lleva «/».
  if (normalized.includes("/") || normalized.endsWith(SOURCE_EXTENSION)) {
    const path = normalized.endsWith(SOURCE_EXTENSION) ? normalized : `${normalized}${SOURCE_EXTENSION}`;
    triedPaths.push(path);
    const match = findByPath(project, path);
    if (match) {
      return readResolved(project, match.relativePath);
    }
  }

  if (!normalized.includes("/")) {
    const dotted = normalized.endsWith(SOURCE_EXTENSION)
      ? normalized.slice(0, -SOURCE_EXTENSION.length)
      : normalized;
    const segments = dotted.split(".").filter((segment) => segment.length > 0);

    if (segments.length > 1) {
      for (let length = segments.length; length > 0; length--) {
        const moduleName = segments.slice(0, length).join(".");
        triedPaths.push(...modulePaths(project, moduleName));
        const matches = findByModule(project, moduleName);
        if (matches.length === 1) {
          return readResolved(project, matches[0].relativePath);
        }
      }
    }

    const name = segments[segments.length - 1] ?? dotted;
    if (name) {
      return resolveByName(project, reference, name, triedPaths);
    }
  }

  return { resolved: false, reference, triedPaths };
}

/** Un nombre a secas: primero el módulo que se llama así, después lo que se declara con ese nombre. */
async function resolveByName(
  project: ProjectModel,
  reference: string,
  name: string,
  triedPaths: string[]
): Promise<DependencyResolution> {
  const modules = project.sources.filter((source) => lastModuleSegment(project, source) === name);
  triedPaths.push(`**/${name}${SOURCE_EXTENSION}`, `**/${name}/__init__${SOURCE_EXTENSION}`);
  if (modules.length === 1) {
    return readResolved(project, modules[0].relativePath);
  }
  if (modules.length > 1) {
    return { resolved: false, reference, triedPaths: modules.map((source) => source.relativePath) };
  }

  const declaring: string[] = [];
  for (const source of project.sources) {
    const content = await readOrNull(project, source.relativePath);
    if (content === null || !content.includes(name)) {
      continue;
    }
    const outline = outlinePython(content);
    const declares =
      findClasses(outline, name).some((block) => block.parent === null) ||
      moduleFunctions(outline).some((block) => block.name === name);
    if (declares) {
      declaring.push(source.relativePath);
    }
  }
  triedPaths.push(`class ${name} | def ${name}`);

  if (declaring.length === 1) {
    return readResolved(project, declaring[0]);
  }
  if (declaring.length > 1) {
    return { resolved: false, reference, triedPaths: declaring };
  }
  return { resolved: false, reference, triedPaths };
}

function findByPath(project: ProjectModel, relativePath: string): SourceFile | undefined {
  return project.sources.find(
    (source) => source.relativePath.toLowerCase() === relativePath.toLowerCase()
  );
}

/** Los archivos del modelo cuyo nombre de módulo es ese, desde la raíz de importación o desde la del proyecto. */
function findByModule(project: ProjectModel, moduleName: string): SourceFile[] {
  const importRoot = importRootOf(project);
  return project.sources.filter(
    (source) =>
      moduleNameOf(source.relativePath, importRoot) === moduleName ||
      (importRoot !== PROJECT_ROOT && moduleNameOf(source.relativePath, PROJECT_ROOT) === moduleName)
  );
}

/** Las rutas que corresponden a un nombre de módulo, para el diagnóstico. */
function modulePaths(project: ProjectModel, moduleName: string): string[] {
  const relative = moduleName.split(".").join("/");
  const importRoot = importRootOf(project);
  const prefix = importRoot === PROJECT_ROOT ? "" : `${importRoot}/`;
  return [`${prefix}${relative}${SOURCE_EXTENSION}`, `${prefix}${relative}/__init__${SOURCE_EXTENSION}`];
}

function lastModuleSegment(project: ProjectModel, source: SourceFile): string {
  const segments = moduleNameOf(source.relativePath, importRootOf(project)).split(".");
  return segments[segments.length - 1];
}

async function readOrNull(project: ProjectModel, relativePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(absolutePath(project.rootPath, relativePath), "utf8");
  } catch {
    return null;
  }
}

async function readResolved(
  project: ProjectModel,
  relativePath: string
): Promise<DependencyResolution> {
  const content = await readOrNull(project, relativePath);
  return content === null
    ? { resolved: false, reference: relativePath, triedPaths: [relativePath] }
    : { resolved: true, relativePath, content };
}
