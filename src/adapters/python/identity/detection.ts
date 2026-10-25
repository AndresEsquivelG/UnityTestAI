import * as fsp from "fs/promises";
import * as path from "path";
import type { ApplicabilityResult, DetectionContext } from "../../../core/contracts";
import { SOURCE_EXTENSION, containsSource, findMarkers, isDirectory } from "../discovery/layout";

/**
 * OP-02 — Detección de aplicabilidad del ecosistema Python.
 *
 * El marcador que manda es un archivo de la raíz que declara el proyecto,
 * como pide HU-23: uno de empaquetado (`pyproject.toml`, `setup.py`,
 * `setup.cfg`) o uno de dependencias (`requirements.txt`, `Pipfile`). Con
 * archivos `.py` al lado, el proyecto es Python con toda seguridad.
 *
 * Sin ningún marcador también se reclama si hay archivos `.py` directamente en
 * la raíz: una carpeta de scripts, que es como empieza buena parte del código
 * Python. Con la confianza más baja de los tres adaptadores, para que un
 * proyecto de Unity o de Java con un script suelto siga siendo de Unity o de
 * Java.
 */

const CONFIDENCE = {
  /** Archivo de empaquetado y código. */
  packagingWithSources: 0.9,
  /** Solo un archivo de dependencias, y código. */
  dependenciesWithSources: 0.8,
  /** Marcador sin ningún `.py` todavía: un proyecto recién creado. */
  markerWithoutSources: 0.5,
  /** Sin marcador, con `.py` en la raíz. */
  scriptsOnly: 0.45,
};

const NOT_APPLICABLE: ApplicabilityResult = { applicable: false, confidence: 0, evidence: [] };

export async function detectPythonProject(context: DetectionContext): Promise<ApplicabilityResult> {
  const { rootPath } = context;
  if (!(await isDirectory(rootPath))) {
    return NOT_APPLICABLE;
  }

  const markers = await findMarkers(rootPath);
  let confidence: number;
  let evidence: string[];

  if (markers.length > 0) {
    const hasSources = await containsSource(rootPath);
    const packaging = markers.some((marker) => marker.kind === "packaging");
    confidence = !hasSources
      ? CONFIDENCE.markerWithoutSources
      : packaging
        ? CONFIDENCE.packagingWithSources
        : CONFIDENCE.dependenciesWithSources;
    evidence = markers.map((marker) => marker.file);
    if (hasSources) {
      evidence.push(`archivos ${SOURCE_EXTENSION}`);
    }
  } else {
    const scripts = await rootScripts(rootPath);
    if (scripts.length === 0) {
      return NOT_APPLICABLE;
    }
    confidence = CONFIDENCE.scriptsOnly;
    evidence = [`${scripts.length} archivo(s) ${SOURCE_EXTENSION} en la raíz, sin pyproject.toml ni requirements.txt`];
  }

  // El archivo abierto se registra pero no cambia la confianza: el veredicto
  // lo dan los marcadores del proyecto.
  const { activeFile } = context;
  if (activeFile && activeFile.path.toLowerCase().endsWith(SOURCE_EXTENSION)) {
    evidence.push(`archivo abierto: ${path.basename(activeFile.path)} (${activeFile.languageId})`);
  }

  return { applicable: true, confidence, evidence };
}

/** Los `.py` que están directamente en la raíz. */
async function rootScripts(rootPath: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(SOURCE_EXTENSION))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
