import * as fsp from "fs/promises";
import * as path from "path";
import type {
  ArtifactSpec,
  PreconditionFix,
  PreconditionViolation,
  ProjectModel,
} from "../contracts";

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
 * incumplimiento con instrucción de subsanación en un fallo silencioso. Quien
 * genera pese al aviso la crea aparte, con `ensureArtifactDirectory`.
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

/** Crea la carpeta del artefacto: la persona pidió generar aunque OP-12 avisó que faltaba. */
export async function ensureArtifactDirectory(
  project: ProjectModel,
  spec: ArtifactSpec
): Promise<void> {
  await fsp.mkdir(path.dirname(artifactAbsolutePath(project, spec)), { recursive: true });
}

/**
 * Lee el artefacto tal como está en disco.
 *
 * Lo que se verificó es el disco, no la última versión que el núcleo escribió:
 * la persona usuaria puede haber editado la prueba entre una verificación y la
 * siguiente, y los diagnósticos hablan de ese texto.
 */
export async function readArtifact(project: ProjectModel, spec: ArtifactSpec): Promise<string> {
  return fsp.readFile(artifactAbsolutePath(project, spec), "utf8");
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

/**
 * La generación no empezó porque OP-12 encontró incumplimientos. Se lanza con
 * los incumplimientos completos, y no solo con su texto, para que el panel pueda
 * ofrecer el arreglo que traiga alguno.
 */
export class UnmetPreconditions extends Error {
  constructor(
    readonly rootPath: string,
    readonly violations: readonly PreconditionViolation[]
  ) {
    super(describeViolations(violations));
    this.name = "UnmetPreconditions";
  }
}

/**
 * Crea el archivo de un arreglo, con su carpeta si falta, y devuelve su ruta
 * absoluta. A diferencia de `writeArtifact`, aquí crear la carpeta es parte de lo
 * que la persona pidió.
 *
 * Nunca sobrescribe: entre el aviso y el clic alguien pudo haber creado el
 * archivo, y lo suyo vale más que lo que propuso la herramienta.
 */
export async function applyPreconditionFix(
  rootPath: string,
  fix: PreconditionFix
): Promise<string> {
  const target = path.resolve(rootPath, ...fix.relativePath.split("/"));
  const inside = path.relative(rootPath, target);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error(`"${fix.relativePath}" queda fuera del proyecto.`);
  }

  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    await fsp.writeFile(target, fix.content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`"${fix.relativePath}" ya existe y no se sobrescribe.`);
    }
    throw error;
  }
  return target;
}
