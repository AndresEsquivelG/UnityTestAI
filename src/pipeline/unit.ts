import * as path from "path";
import type {
  EcosystemAdapter,
  ProjectModel,
  SymbolCandidate,
  UnitTarget,
} from "../core/contracts";

/** Archivos que nombra como máximo el aviso de una función repetida. */
const MAX_LISTED_FILES = 5;

export type UnitChoice =
  | { readonly found: true; readonly location: SymbolCandidate }
  | { readonly found: false; readonly reason: string };

/**
 * OP-05, y la declaración que se va a probar entre las que encontró.
 *
 * Con clase, la primera candidata, como siempre: ante sobrecargas o una clase
 * repetida en dos módulos, elegir es de la interfaz (HU-16), y todavía no hay
 * dónde preguntarlo.
 *
 * Sin clase, solo si el adaptador declara `moduleLevelUnits`: en Java y en C#
 * todo método pertenece a una clase, y sus localizadores lo buscaban en
 * cualquiera. Y el archivo abierto desempata (decisión B, 2026-10-26): un
 * nombre como `main` está en 37 archivos de `python-patterns`. Si el abierto no
 * tiene ninguna, se pide abrir el correcto, nombrando dónde están.
 *
 * Lo usan la generación, «Ejecutar y medir» y el panel al validar los nombres:
 * los tres tienen que elegir la misma, o la prueba que se encuentra no sería
 * la que se generó.
 */
export async function locateUnit(
  adapter: EcosystemAdapter,
  project: ProjectModel,
  target: UnitTarget,
  editorPath?: string,
): Promise<UnitChoice> {
  if (target.className === null && !adapter.capabilities.moduleLevelUnits) {
    return {
      found: false,
      reason: `En ${adapter.descriptor.displayName} cada método pertenece a una clase: escribí el nombre de la clase.`,
    };
  }

  const location = await adapter.locateSymbol(project, target);
  if (!location.found) {
    return location;
  }
  const { candidates } = location;
  if (target.className !== null) {
    return { found: true, location: candidates[0] };
  }

  // Si un archivo la declara dos veces, vale la última, como en Python.
  const files = [...new Set(candidates.map((candidate) => candidate.filePath))];
  const lastIn = (filePath: string) =>
    candidates.filter((candidate) => candidate.filePath === filePath).pop()!;

  if (files.length === 1) {
    return { found: true, location: lastIn(files[0]) };
  }
  const opened =
    editorPath === undefined
      ? undefined
      : files.find((filePath) => samePath(absolutePath(project, filePath), editorPath));
  if (opened !== undefined) {
    return { found: true, location: lastIn(opened) };
  }

  const shown = files.slice(0, MAX_LISTED_FILES).join(", ");
  const more =
    files.length > MAX_LISTED_FILES ? ` y ${files.length - MAX_LISTED_FILES} más` : "";
  return {
    found: false,
    reason:
      `Hay una función "${target.methodName}" fuera de toda clase en ${files.length} archivos: ${shown}${more}. ` +
      `Abrí el archivo de la que querés probar y volvé a pedirla.`,
  };
}

/** Ruta absoluta de un archivo del modelo, que usa «/» en sus rutas relativas. */
export function absolutePath(project: ProjectModel, relativePath: string): string {
  return path.join(project.rootPath, ...relativePath.split("/"));
}

/**
 * Compara dos rutas absolutas del mismo sistema de archivos.
 *
 * En Windows y macOS el nombre no distingue mayúsculas, y la ruta que entrega el
 * editor puede diferir en la letra de unidad de la que se compone aquí. Un
 * empate de más solo haría usar el texto del editor en lugar del disco; un
 * empate de menos, al contrario.
 */
export function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  if (process.platform === "win32" || process.platform === "darwin") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}
