import * as fsp from "fs/promises";
import * as path from "path";
import type { ApplicabilityResult, DetectionContext } from "../../../core/contracts";
import {
  MAIN_ROOT,
  SOURCE_EXTENSION,
  absolutePath,
  findBuildDescriptor,
  isDirectory,
  isSupportedBuildTool,
} from "../discovery/layout";

/**
 * OP-02 — Detección de aplicabilidad del ecosistema Java.
 *
 * El marcador que no puede faltar es la carpeta `src/main/java`: sin ella el
 * adaptador no sabría dónde están las fuentes ni dónde va la prueba. Con el
 * descriptor de Maven o de Gradle al lado, el proyecto es de los que el
 * adaptador sabe compilar y ejecutar.
 *
 * Sin ese descriptor también se reclama, si hay fuentes: un proyecto de Ant,
 * de Bazel o sin herramienta que siga la convención. La prueba se genera
 * igual, y la compilación avisa que solo sabe hacerlo con Maven o Gradle. Con
 * menos confianza, porque una carpeta así sola no dice tanto como un
 * descriptor. Un descriptor sin `src/main/java` no alcanza: el proyecto puede
 * ser de varios módulos o de otro lenguaje de la JVM, como Kotlin.
 */

const CONFIDENCE = {
  /** Descriptor y al menos un archivo `.java` en la jerarquía principal. */
  withSources: 0.95,
  /** Descriptor y jerarquía principal todavía vacía: un proyecto recién creado. */
  emptyMainRoot: 0.8,
  /** Fuentes en la jerarquía principal sin descriptor de Maven ni de Gradle. */
  withoutSupportedDescriptor: 0.7,
};

const NOT_APPLICABLE: ApplicabilityResult = { applicable: false, confidence: 0, evidence: [] };

export async function detectJavaProject(context: DetectionContext): Promise<ApplicabilityResult> {
  const { rootPath } = context;

  const mainRoot = absolutePath(rootPath, MAIN_ROOT);
  if (!(await isDirectory(mainRoot))) {
    return NOT_APPLICABLE;
  }

  const descriptor = await findBuildDescriptor(rootPath);
  const hasSources = await containsSourceFile(mainRoot);

  let confidence: number;
  if (descriptor && isSupportedBuildTool(descriptor.tool)) {
    confidence = hasSources ? CONFIDENCE.withSources : CONFIDENCE.emptyMainRoot;
  } else if (hasSources) {
    confidence = CONFIDENCE.withoutSupportedDescriptor;
  } else {
    return NOT_APPLICABLE;
  }

  const evidence = descriptor ? [descriptor.file, `${MAIN_ROOT}/`] : [`${MAIN_ROOT}/`];

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
