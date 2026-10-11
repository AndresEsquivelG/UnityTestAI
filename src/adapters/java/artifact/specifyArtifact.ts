import * as path from "path";
import type { ArtifactRequest, ArtifactSpec, SourceRoot } from "../../../core/contracts";
import { baseArtifactName } from "../../shared/artifactName";
import { SOURCE_EXTENSION, TEST_ROOT } from "../discovery/layout";

/**
 * OP-10 — Especificación del artefacto.
 *
 * **Carpeta.** La prueba va en la jerarquía de pruebas, en la misma ruta de
 * paquete que la clase bajo prueba: la de `src/main/java/com/tienda/Carrito.java`
 * va en `src/test/java/com/tienda/`. Así la prueba queda en el mismo paquete y
 * ve los miembros sin modificador y los `protected`, y la construcción la
 * encuentra donde la busca. El paquete se toma de la carpeta del archivo, que
 * en Java coincide con su línea `package` por convención.
 *
 * **Nombre.** La base común a todos los adaptadores más `_Test`. Maven ejecuta
 * por defecto solo las clases cuyo nombre empieza con `Test` o termina en
 * `Test`, `Tests` o `TestCase`; sin el final, `mvn test` compilaría la prueba y
 * no la correría, sin ningún aviso. El archivo y la clase se llaman igual
 * porque Java lo exige a una clase pública.
 */

const TEST_SUFFIX = "_Test";

export function specifyJavaArtifact(request: ArtifactRequest): ArtifactSpec {
  const { project, target, targetLocation, modelId } = request;

  const testRoot =
    project.sourceRoots.find((root) => root.kind === "test")?.relativePath ?? TEST_ROOT;
  const packageDirectory = packageDirectoryOf(targetLocation.filePath, project.sourceRoots);

  const owner =
    target.className ?? path.posix.basename(targetLocation.filePath, SOURCE_EXTENSION);
  const name = `${baseArtifactName(modelId, owner, target.methodName)}${TEST_SUFFIX}`;

  return {
    directory: packageDirectory ? `${testRoot}/${packageDirectory}` : testRoot,
    fileName: name,
    extension: SOURCE_EXTENSION,
    unitName: name,
  };
}

/**
 * Carpeta del paquete relativa a la raíz de fuentes que contiene el archivo.
 * Vacía si el archivo está en la raíz misma, que es el paquete por omisión, o
 * fuera de toda raíz declarada.
 */
function packageDirectoryOf(filePath: string, roots: readonly SourceRoot[]): string {
  const directory = path.posix.dirname(filePath);
  for (const root of roots) {
    if (directory.startsWith(`${root.relativePath}/`)) {
      return directory.slice(root.relativePath.length + 1);
    }
  }
  return "";
}
