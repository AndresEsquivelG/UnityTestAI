import * as fsp from "fs/promises";
import * as path from "path";
import type { ArtifactSpec, PreconditionViolation, ProjectModel } from "../contracts";

/**
 * Escritura del artefacto especificado por OP-10.
 *
 * El núcleo compone la ruta y escribe; qué carpeta, qué nombre y qué extensión
 * lo decidió el adaptador. Hoy esa decisión está repartida en literales dentro
 * de `testGenerator`.
 */

/** Ruta del artefacto relativa a la raíz del modelo, con separador "/". */
export function artifactRelativePath(spec: ArtifactSpec): string {
  return `${spec.directory}/${spec.fileName}${spec.extension}`;
}

/** Ruta absoluta del artefacto, con el separador del sistema. */
export function artifactAbsolutePath(project: ProjectModel, spec: ArtifactSpec): string {
  return path.join(project.rootPath, ...artifactRelativePath(spec).split("/"));
}

/**
 * Escribe el artefacto y devuelve su ruta absoluta.
 *
 * No crea la carpeta destino a propósito: que exista es una precondición del
 * ecosistema (OP-12), y en Unity crearla al vuelo no serviría de nada porque le
 * faltaría el archivo de definición de ensamblado. Crearla aquí convertiría un
 * incumplimiento con instrucción de subsanación en un fallo silencioso.
 */
export async function writeArtifact(
  project: ProjectModel,
  spec: ArtifactSpec,
  content: string
): Promise<string> {
  const target = artifactAbsolutePath(project, spec);
  await fsp.writeFile(target, content, "utf8");
  return target;
}

/**
 * Presenta los incumplimientos de OP-12 como un solo texto.
 *
 * Cada uno va con su instrucción de subsanación, que es obligatoria en el
 * contrato justamente para que el aviso no se quede en un fallo genérico.
 */
export function describeViolations(
  violations: readonly PreconditionViolation[]
): string {
  return violations
    .map((violation) => `${violation.message}\n  → ${violation.remediation}`)
    .join("\n");
}
