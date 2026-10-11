import * as fsp from "fs/promises";
import * as path from "path";
import type { ApplicabilityResult, DetectionContext } from "../../../core/contracts";
import {
  MAIN_ROOT,
  SOURCE_EXTENSION,
  absolutePath,
  findBuildDescriptor,
  isDirectory,
} from "../discovery/layout";

/**
 * OP-02 — Detección de aplicabilidad del ecosistema Java.
 *
 * Hacen falta dos marcadores: el descriptor de Maven o de Gradle en la raíz, y
 * la carpeta `src/main/java`. Con el descriptor solo, el proyecto puede ser de
 * varios módulos o de otro lenguaje de la JVM, como Kotlin, y el adaptador no
 * sabría dónde están las fuentes.
 */

const CONFIDENCE = {
  /** Descriptor y al menos un archivo `.java` en la jerarquía principal. */
  withSources: 0.95,
  /** Descriptor y jerarquía principal todavía vacía: un proyecto recién creado. */
  emptyMainRoot: 0.8,
};

const NOT_APPLICABLE: ApplicabilityResult = { applicable: false, confidence: 0, evidence: [] };

export async function detectJavaProject(context: DetectionContext): Promise<ApplicabilityResult> {
  const { rootPath } = context;

  const descriptor = await findBuildDescriptor(rootPath);
  if (!descriptor) {
    return NOT_APPLICABLE;
  }

  const mainRoot = absolutePath(rootPath, MAIN_ROOT);
  if (!(await isDirectory(mainRoot))) {
    return NOT_APPLICABLE;
  }

  const evidence = [descriptor.file, `${MAIN_ROOT}/`];
  const confidence = (await containsSourceFile(mainRoot))
    ? CONFIDENCE.withSources
    : CONFIDENCE.emptyMainRoot;

  // El archivo abierto se registra pero no cambia la confianza: el veredicto
  // lo dan los marcadores del proyecto.
  const { activeFile } = context;
  if (activeFile && activeFile.path.toLowerCase().endsWith(SOURCE_EXTENSION)) {
    evidence.push(`archivo abierto: ${path.basename(activeFile.path)} (${activeFile.languageId})`);
  }

  return { applicable: true, confidence, evidence };
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
    if (entry.isFile() && entry.name.endsWith(SOURCE_EXTENSION)) {
      return true;
    }
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
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
