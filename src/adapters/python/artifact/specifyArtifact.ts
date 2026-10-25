import * as path from "path";
import type { ArtifactRequest, ArtifactSpec } from "../../../core/contracts";
import { baseArtifactName } from "../../shared/artifactName";
import { SOURCE_EXTENSION } from "../discovery/layout";
import { testRootOf } from "../discovery/projectModel";

/**
 * OP-10 — Especificación del artefacto.
 *
 * **Carpeta.** La carpeta de pruebas de la raíz (`tests/`, o `test/` si el
 * proyecto usa esa), sin repetir adentro las carpetas de los paquetes. En
 * Python la prueba no necesita estar en el paquete de la clase, como en Java:
 * la importa por su nombre, y pytest la encuentra en cualquier carpeta.
 *
 * **Nombre.** La base común a todos los adaptadores más `_test`. pytest
 * recolecta por defecto solo los archivos que empiezan con `test_` o terminan
 * en `_test.py`; sin el final, `pytest` a secas no correría la prueba, sin
 * ningún aviso. Es el mismo motivo del `_Test` de Java. La base ya es un
 * identificador válido (`toIdentifier`), y eso también importa aquí: con un
 * punto en el nombre, como el de `qwen2.5`, pytest no podría importar el
 * archivo.
 *
 * **Unidad.** Las pruebas son funciones sueltas, sin una clase que las
 * agrupe: la unidad de prueba es el módulo, que se llama como el archivo.
 */

const TEST_SUFFIX = "_test";

export function specifyPythonArtifact(request: ArtifactRequest): ArtifactSpec {
  const { project, target, targetLocation, modelId } = request;

  const owner =
    target.className ?? path.posix.basename(targetLocation.filePath, SOURCE_EXTENSION);
  const name = `${baseArtifactName(modelId, owner, target.methodName)}${TEST_SUFFIX}`;

  return {
    directory: testRootOf(project),
    fileName: name,
    extension: SOURCE_EXTENSION,
    unitName: name,
  };
}
