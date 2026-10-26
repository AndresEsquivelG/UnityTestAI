import * as path from "path";
import type { ArtifactSpec } from "../../../core/contracts";

/**
 * Qué se le pide a pytest y a coverage. Comprobado con pytest 9.1.1 y
 * coverage 7.17.0 sobre copias de `python-patterns` y `humanize`.
 */

/** Holgado: Python arranca en una décima de segundo, pero un módulo puede tardar en importarse. */
export const PYTHON_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Lo que va en cada corrida de pytest:
 *
 *   · `-m pytest` y no el ejecutable `pytest`: `-m` pone la raíz en el camino
 *     de búsqueda de módulos, y así la prueba importa los del proyecto haya o
 *     no `tests/__init__.py` (comprobado: con el ejecutable y sin ese archivo,
 *     «No module named 'patterns'»);
 *   · `-o addopts=` anula las opciones que el proyecto agrega a todas sus
 *     corridas. Decidido por Andrés el 2026-10-25: las de `python-patterns`
 *     piden dos complementos que no están instalados y pytest termina con el
 *     código 4 sin correr nada, y las de `humanize` llenan la salida de
 *     códigos de color. El resto de la configuración del proyecto sigue;
 *   · `-p no:cacheprovider`: que no quede `.pytest_cache` en el proyecto.
 */
export const PYTEST = ["-m", "pytest", "-q", "-o", "addopts=", "-p", "no:cacheprovider"];

/**
 * La configuración de coverage de la extensión, en lugar de la del proyecto.
 * Decidido por Andrés el 2026-10-25: con la de `python-patterns`, coverage
 * ignoró el archivo pedido y midió 59 («--include is ignored because --source
 * is set»), y le cambió el nombre al archivo de datos.
 *
 * Se pierden las exclusiones del proyecto, salvo la del bloque
 * `if __name__ == "__main__":`, que se devuelve: no se puede probar, y el
 * perfil ya se lo dice al modelo. `# pragma: no cover` sigue valiendo, porque
 * coverage lo excluye siempre.
 *
 * El archivo de datos va en la configuración y no en `--data-file`, que las
 * versiones viejas de coverage no tienen.
 */
export function coverageConfig(dataFile: string): string {
  return `# Escrito por la extensión UnityTestAI para medir la prueba generada.
[run]
branch = True
data_file = ${dataFile}

[report]
exclude_also =
    if __name__ == .__main__.:
`;
}

/** La prueba, relativa a la raíz y con el separador del sistema, como la escribe pytest. */
export function testFileArg(spec: ArtifactSpec): string {
  return path.join(...spec.directory.split("/"), `${spec.fileName}${spec.extension}`);
}

/** Ruta relativa a la raíz con «/», como las guarda el contrato. */
export function artifactPath(spec: ArtifactSpec): string {
  return `${spec.directory}/${spec.fileName}${spec.extension}`;
}
