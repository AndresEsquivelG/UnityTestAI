import * as fsp from "fs/promises";
import * as path from "path";

/**
 * Convenciones de un proyecto Python: qué archivo lo declara, dónde está el
 * código, dónde van las pruebas, qué carpetas no son del proyecto y cómo se
 * llama un módulo según dónde está su archivo.
 *
 * Las usan la detección, el modelo del proyecto, la localización, la
 * resolución de dependencias, la ficha y la ubicación de la prueba. Están
 * juntas para que esas operaciones no puedan discrepar sobre dónde está cada
 * cosa.
 *
 * Hay dos formas comunes de ordenar un proyecto, y las dos se reconocen:
 *
 *   · **plana**: los paquetes cuelgan de la raíz (`tienda/carrito.py`), y se
 *     importan desde ella: `tienda.carrito`;
 *   · **con `src/`**: los paquetes cuelgan de `src/` (`src/tienda/carrito.py`),
 *     y se importan sin esa carpeta: también `tienda.carrito`.
 */

export const SOURCE_EXTENSION = ".py";

/** Carpeta de la forma con `src/`. */
export const SRC_ROOT = "src";

/** Carpetas de pruebas que se reconocen en la raíz, en orden de preferencia. */
export const TEST_ROOTS = ["tests", "test"] as const;

/** Carpeta de pruebas cuando el proyecto no tiene ninguna. */
export const DEFAULT_TEST_ROOT = "tests";

/** Raíz de la forma plana en `SourceRoot.relativePath`. */
export const PROJECT_ROOT = ".";

/**
 * Qué declara un archivo de la raíz: cómo se empaqueta el proyecto, o solo
 * qué necesita instalado. Los dos marcan un proyecto Python; el primero, con
 * más seguridad.
 */
export type MarkerKind = "packaging" | "dependencies";

export interface ProjectMarker {
  readonly kind: MarkerKind;
  /** Nombre del archivo, en la raíz del proyecto. */
  readonly file: string;
}

/** Marcadores en orden de preferencia: los de empaquetado primero. */
const MARKERS: readonly ProjectMarker[] = [
  { kind: "packaging", file: "pyproject.toml" },
  { kind: "packaging", file: "setup.py" },
  { kind: "packaging", file: "setup.cfg" },
  { kind: "dependencies", file: "requirements.txt" },
  { kind: "dependencies", file: "Pipfile" },
];

/**
 * Carpetas que nunca son código del proyecto, por su nombre: cachés de
 * Python, paquetes instalados y lo que deja la construcción. `build/lib`, por
 * ejemplo, trae una copia de cada módulo, y sin esta regla cada clase
 * aparecería dos veces.
 *
 * Los entornos virtuales no están en la lista: se reconocen por su contenido
 * (`isVirtualEnvironment`), porque se llaman como cada uno quiere, y una
 * carpeta llamada `env` puede ser un paquete del proyecto.
 */
const EXCLUDED_NAMES = new Set([
  "__pycache__",
  "site-packages",
  "node_modules",
  "build",
  "dist",
  "htmlcov",
]);

/** Marcadores de la raíz, en orden de preferencia. */
export async function findMarkers(rootPath: string): Promise<ProjectMarker[]> {
  const found: ProjectMarker[] = [];
  for (const marker of MARKERS) {
    if (await isFile(path.join(rootPath, marker.file))) {
      found.push(marker);
    }
  }
  return found;
}

/**
 * Si una carpeta queda fuera del proyecto: las ocultas (`.venv`, `.git`,
 * `.tox`, `.pytest_cache`), las de `EXCLUDED_NAMES`, los metadatos de un
 * paquete instalado (`*.egg-info`) y los entornos virtuales.
 */
export async function isExcludedDirectory(directory: string, name: string): Promise<boolean> {
  return (
    name.startsWith(".") ||
    EXCLUDED_NAMES.has(name) ||
    name.endsWith(".egg-info") ||
    (await isVirtualEnvironment(directory))
  );
}

/**
 * Un entorno virtual se reconoce por lo que tiene adentro y no por su nombre:
 * `venv` y `virtualenv` dejan `pyvenv.cfg` en su raíz, y conda deja
 * `conda-meta/`.
 */
export async function isVirtualEnvironment(directory: string): Promise<boolean> {
  return (
    (await isFile(path.join(directory, "pyvenv.cfg"))) ||
    (await isDirectory(path.join(directory, "conda-meta")))
  );
}

/**
 * La forma del proyecto: con `src/` si esa carpeta existe, no es ella misma un
 * paquete (no tiene `__init__.py`) y tiene código. Si es un paquete, se
 * importa como `src.…` desde la raíz, que es la forma plana.
 */
export async function usesSrcLayout(rootPath: string): Promise<boolean> {
  const src = path.join(rootPath, SRC_ROOT);
  if (!(await isDirectory(src)) || (await isFile(path.join(src, "__init__.py")))) {
    return false;
  }
  return containsSource(src);
}

/** La primera carpeta de pruebas de `TEST_ROOTS` que exista, o la de siempre. */
export async function findTestRoot(rootPath: string): Promise<string> {
  for (const candidate of TEST_ROOTS) {
    if (await isDirectory(path.join(rootPath, candidate))) {
      return candidate;
    }
  }
  return DEFAULT_TEST_ROOT;
}

/**
 * Nombre con puntos del módulo de un archivo: la ruta sin la raíz de
 * importación ni `.py`, con «.» en lugar de «/». El `__init__.py` de un
 * paquete es el paquete mismo.
 *
 * La raíz de importación es `src/` en la forma con esa carpeta, y la del
 * proyecto en la plana. Un archivo de la forma con `src/` que no cuelga de esa
 * carpeta —un script de la raíz, una prueba— se importa desde la raíz del
 * proyecto.
 */
export function moduleNameOf(relativePath: string, importRoot: string): string {
  const withinRoot =
    importRoot !== PROJECT_ROOT && relativePath.startsWith(`${importRoot}/`)
      ? relativePath.slice(importRoot.length + 1)
      : relativePath;

  const segments = withinRoot.replace(/\.py$/, "").split("/");
  if (segments.length > 1 && segments[segments.length - 1] === "__init__") {
    segments.pop();
  }
  return segments.join(".");
}

/**
 * Si un nombre se puede escribir en una línea `import`: letras, dígitos y
 * guion bajo, sin empezar por un dígito. `mi-script.py` es un archivo válido,
 * pero `import mi-script` no.
 */
export function isIdentifier(name: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name);
}

/** Si hay al menos un `.py` debajo, sin entrar a lo que no es del proyecto. */
export async function containsSource(directory: string): Promise<boolean> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(SOURCE_EXTENSION)) {
      return true;
    }
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory() && !(await isExcludedDirectory(child, entry.name)) && (await containsSource(child))) {
      return true;
    }
  }
  return false;
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
