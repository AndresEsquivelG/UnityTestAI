import * as fsp from "fs/promises";
import * as path from "path";
import type { ApplicabilityResult, DetectionContext } from "../../core/contracts";

/**
 * OP-02 — Detección de aplicabilidad del ecosistema Unity.
 *
 * Hoy esta decisión no existe como tal: `getFilteredAssetsTree` da por hecho
 * que el proyecto es Unity y se limita a buscar la carpeta `Assets`.
 *
 * Se admiten las dos disposiciones con las que se abre el proyecto en el
 * editor: la raíz del proyecto Unity, que contiene `Assets`, y la propia
 * carpeta `Assets`.
 */

const ASSETS = "Assets";
const PROJECT_VERSION = "ProjectSettings/ProjectVersion.txt";
const PACKAGE_MANIFEST = "Packages/manifest.json";
const SOURCE_EXTENSION = ".cs";

/** Carpetas que Unity genera y que nunca contienen fuentes del proyecto. */
const GENERATED_DIRECTORIES = new Set(["Library", "Temp", "Logs", "obj", "Build", "Builds"]);

/**
 * Grados de confianza. El orden no es arbitrario: `ProjectVersion.txt` es el
 * único marcador que ningún otro ecosistema produce, mientras que una carpeta
 * llamada `Assets` con archivos `.cs` puede aparecer en proyectos .NET que no
 * son Unity.
 */
const CONFIDENCE = {
  editorVersion: 0.95,
  packageManifest: 0.8,
  assetsWithSources: 0.5,
  openedInsideAssets: 0.4,
};

export async function detectUnityProject(
  context: DetectionContext
): Promise<ApplicabilityResult> {
  const { rootPath } = context;
  const evidence: string[] = [];

  const openedInsideAssets = path.basename(rootPath).toLowerCase() === ASSETS.toLowerCase();
  // Cuando se abre la carpeta Assets, los marcadores del proyecto quedan en su
  // carpeta madre.
  const projectRoot = openedInsideAssets ? path.dirname(rootPath) : rootPath;
  const assetsDir = openedInsideAssets ? rootPath : path.join(rootPath, ASSETS);

  const hasAssets = await isDirectory(assetsDir);
  if (!hasAssets) {
    return { applicable: false, confidence: 0, evidence: [] };
  }
  evidence.push(openedInsideAssets ? "Assets (carpeta abierta)" : "Assets/");

  let confidence = openedInsideAssets
    ? CONFIDENCE.openedInsideAssets
    : CONFIDENCE.assetsWithSources;

  if (await isFile(path.join(projectRoot, ...PROJECT_VERSION.split("/")))) {
    evidence.push(PROJECT_VERSION);
    confidence = CONFIDENCE.editorVersion;
  } else if (await isFile(path.join(projectRoot, ...PACKAGE_MANIFEST.split("/")))) {
    evidence.push(PACKAGE_MANIFEST);
    confidence = CONFIDENCE.packageManifest;
  } else if (!(await containsSourceFile(assetsDir))) {
    // Una carpeta `Assets` vacía de fuentes, sin ningún otro marcador, no basta
    // para reclamar el proyecto.
    return { applicable: false, confidence: 0, evidence: [] };
  }

  // El archivo abierto se registra pero no altera la confianza: el mismo
  // lenguaje puede pertenecer a ecosistemas distintos, así que el veredicto lo
  // dan los marcadores del proyecto.
  const { activeFile } = context;
  if (activeFile && activeFile.path.toLowerCase().endsWith(SOURCE_EXTENSION)) {
    evidence.push(`archivo abierto: ${path.basename(activeFile.path)} (${activeFile.languageId})`);
  }

  return { applicable: true, confidence, evidence };
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isFile();
  } catch {
    return false;
  }
}

/** Recorrido con salida temprana: basta con encontrar una fuente. */
async function containsSourceFile(directory: string): Promise<boolean> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }

  const subdirectories: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(SOURCE_EXTENSION)) {
      return true;
    }
    if (entry.isDirectory() && !GENERATED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
      subdirectories.push(path.join(directory, entry.name));
    }
  }

  for (const subdirectory of subdirectories) {
    if (await containsSourceFile(subdirectory)) {
      return true;
    }
  }
  return false;
}
