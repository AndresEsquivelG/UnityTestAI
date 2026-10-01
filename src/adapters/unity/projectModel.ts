import * as fsp from "fs/promises";
import * as path from "path";
import type { ProjectModel, SourceFile, SourceRoot } from "../../core/contracts";

/**
 * OP-04 — Modelo del proyecto Unity.
 *
 * Sustituye a `getFilteredAssetsTree`, que devolvía un árbol ASCII ya
 * formateado. Aquí se devuelve el modelo y el núcleo decide cómo presentarlo.
 *
 * La raíz del modelo es siempre la raíz del proyecto Unity, la carpeta que
 * contiene `Assets`, aunque en el editor se haya abierto `Assets`
 * directamente. Así las rutas relativas empiezan por `Assets/` en ambos casos,
 * que es la forma en la que los agentes ya nombran los archivos y la que hoy
 * obliga a `readDependencyFiles` a probar la ruta con el prefijo y sin él.
 */

const ASSETS = "Assets";
const TESTS = "Tests";
const SOURCE_EXTENSION = ".cs";

/**
 * Carpetas que se excluyen del recorrido. Unity regenera `Library`, `Temp`,
 * `obj` y `Logs` en cada compilación, y sus contenidos no son fuentes del
 * proyecto.
 */
const EXCLUDED_DIRECTORIES = new Set([
  "Library",
  "Temp",
  "Logs",
  "obj",
  "Build",
  "Builds",
  "node_modules",
]);

export async function buildUnityProjectModel(
  rootPath: string,
  ecosystemId: string
): Promise<ProjectModel> {
  const openedInsideAssets = path.basename(rootPath).toLowerCase() === ASSETS.toLowerCase();
  const projectRoot = openedInsideAssets ? path.dirname(rootPath) : rootPath;
  const assetsDir = openedInsideAssets ? rootPath : path.join(rootPath, ASSETS);

  const testsRelative = `${ASSETS}/${TESTS}`;
  const sourceRoots: SourceRoot[] = [
    { relativePath: ASSETS, kind: "main" },
    { relativePath: testsRelative, kind: "test" },
  ];

  const sources = await collectSources(assetsDir, ASSETS, testsRelative);
  const unityVersion = await readEditorVersion(projectRoot);

  return {
    rootPath: projectRoot,
    ecosystemId,
    sourceRoots,
    sources,
    adapterData: unityVersion ? { unityVersion } : undefined,
  };
}

async function collectSources(
  directory: string,
  relativePrefix: string,
  testsRelative: string
): Promise<SourceFile[]> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const sources: SourceFile[] = [];
  for (const entry of entries) {
    const relativePath = `${relativePrefix}/${entry.name}`;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      sources.push(
        ...(await collectSources(path.join(directory, entry.name), relativePath, testsRelative))
      );
      continue;
    }

    if (!entry.name.toLowerCase().endsWith(SOURCE_EXTENSION)) {
      continue;
    }

    sources.push({
      relativePath,
      name: entry.name,
      sourceRoot: relativePath.startsWith(`${testsRelative}/`) ? "test" : "main",
    });
  }

  return sources;
}

/**
 * Versión del editor con la que se abrió el proyecto. Se conserva en el modelo
 * porque el perfil de prompt y el registro de cada corrida la necesitan, y
 * volver a leerla en cada operación obligaría al adaptador a recordar dónde
 * estaba la raíz.
 */
async function readEditorVersion(projectRoot: string): Promise<string | undefined> {
  try {
    const content = await fsp.readFile(
      path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
      "utf8"
    );
    return content.match(/m_EditorVersion:\s*(\S+)/)?.[1];
  } catch {
    return undefined;
  }
}
