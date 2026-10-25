import type { ArtifactSpec, PreconditionViolation, ProjectModel } from "../../../core/contracts";
import { absolutePath, isDirectory } from "../discovery/layout";

/**
 * OP-12 — Precondiciones antes de escribir la prueba.
 *
 * La única es que exista la carpeta de pruebas, por la misma decisión que en
 * Java: el núcleo no crea carpetas, a propósito. Un proyecto sin `tests/` se
 * detiene aquí, antes de la primera llamada al modelo, con la carpeta que hay
 * que crear. A diferencia de Java, se crea una sola vez por proyecto y no una
 * por paquete.
 */
export async function checkPythonPreconditions(
  project: ProjectModel,
  spec: ArtifactSpec
): Promise<readonly PreconditionViolation[]> {
  if (await isDirectory(absolutePath(project.rootPath, spec.directory))) {
    return [];
  }

  return [
    {
      code: "python.test-directory-missing",
      message: `La carpeta de las pruebas, "${spec.directory}", no existe en el proyecto.`,
      remediation:
        `Creá la carpeta "${spec.directory}" en la raíz del proyecto y volvé a generar. ` +
        `Ahí van las pruebas generadas, y pytest las encuentra sin configuración.`,
    },
  ];
}
