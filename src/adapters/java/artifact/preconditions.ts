import type { ArtifactSpec, PreconditionViolation, ProjectModel } from "../../../core/contracts";
import { TEST_ROOT, absolutePath, isDirectory } from "../discovery/layout";

/**
 * OP-12 — Precondiciones antes de escribir la prueba.
 *
 * La única es que exista la carpeta del paquete dentro de la jerarquía de
 * pruebas. El núcleo no crea carpetas, a propósito, así que una prueba para un
 * paquete que todavía no tiene ninguna se detiene aquí, antes de la primera
 * llamada al modelo, con la carpeta exacta que hay que crear.
 */
export async function checkJavaPreconditions(
  project: ProjectModel,
  spec: ArtifactSpec
): Promise<readonly PreconditionViolation[]> {
  if (await isDirectory(absolutePath(project.rootPath, spec.directory))) {
    return [];
  }

  return [
    {
      code: "java.test-package-directory-missing",
      message: `La carpeta de la prueba, "${spec.directory}", no existe en el proyecto.`,
      remediation:
        `Creá la carpeta "${spec.directory}" y volvé a generar. La prueba va dentro de ` +
        `${TEST_ROOT}, en la misma ruta de paquete que la clase bajo prueba.`,
    },
  ];
}
