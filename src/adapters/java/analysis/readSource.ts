import * as fsp from "fs/promises";
import type { ProjectModel, SourceText, SymbolCandidate } from "../../../core/contracts";
import { absolutePath } from "../discovery/layout";

/**
 * OP-06 — Lectura del archivo que contiene la declaración elegida.
 *
 * Se lee el archivo entero: recortarlo a lo que usa el método es trabajo del
 * agente recortador, y solo cuando la persona pide reducir el contexto.
 */
export async function readJavaSource(
  project: ProjectModel,
  location: SymbolCandidate
): Promise<SourceText> {
  const content = await fsp.readFile(absolutePath(project.rootPath, location.filePath), "utf8");
  return { filePath: location.filePath, content };
}
