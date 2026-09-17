import * as fsp from "fs/promises";
import * as path from "path";
import type {
  ArtifactRequest,
  ArtifactSpec,
  PreconditionViolation,
  ProjectModel,
} from "../../core/contracts";

/**
 * Operaciones de materialización del adaptador Unity — OP-10, OP-11 y OP-12.
 *
 * Reúnen lo que hoy está repartido entre `testGenerator` —carpeta "Tests",
 * nombre `UTIA_<modelo>_<clase>_<método>`, extensión ".cs" y el renombrado de
 * la clase generada— y `testSaver`, que comprueba el archivo de definición de
 * ensamblado pero nunca llega a ejecutarse.
 */

const FALLBACK_TEST_DIRECTORY = "Assets/Tests";
const EXTENSION = ".cs";
const ASSEMBLY_DEFINITION = ".asmdef";

/**
 * OP-10 — Especificación del artefacto.
 *
 * El destino sale de la jerarquía de pruebas declarada en el modelo, que en
 * Unity cuelga siempre de `Assets`: un archivo de prueba fuera de `Assets` no
 * lo compila el editor. Hoy el destino se calcula como "Tests" a partir de la
 * carpeta del espacio de trabajo, lo que solo acierta cuando esa carpeta es
 * `Assets`.
 */
export function specifyUnityArtifact(request: ArtifactRequest): ArtifactSpec {
  const testRoot =
    request.project.sourceRoots.find((root) => root.kind === "test")?.relativePath ??
    FALLBACK_TEST_DIRECTORY;

  const owner =
    request.target.className ??
    path.basename(request.targetLocation.filePath, EXTENSION);

  const name = [
    "UTIA",
    toIdentifier(request.modelId),
    toIdentifier(owner),
    toIdentifier(request.target.methodName),
  ].join("_");

  return {
    directory: testRoot,
    fileName: name,
    extension: EXTENSION,
    // En C# el archivo y la clase que contiene se llaman igual por convención,
    // y el renombrado de OP-11 depende de que así sea.
    unitName: name,
  };
}

/**
 * OP-11 — Normalización del código generado.
 *
 * Dos ajustes, los mismos que hace hoy el generador: quitar el cercado de
 * markdown con el que el modelo suele envolver la respuesta, y renombrar la
 * clase de prueba para que coincida con el nombre del archivo.
 *
 * Solo se renombra la primera clase, que es la de prueba; las auxiliares que el
 * modelo declare después se dejan como están.
 */
export function normalizeUnityCode(code: string, spec: ArtifactSpec): string {
  const withoutFences = code
    .trim()
    .replace(/^```(?:csharp|c#|cs)?[ \t]*\r?\n?/i, "")
    .replace(/\r?\n?```\s*$/i, "")
    .trim();

  return withoutFences.replace(
    /(?:public\s+|internal\s+)?(?:sealed\s+|partial\s+|static\s+|abstract\s+)*class\s+\w+/,
    `public class ${spec.unitName}`
  );
}

/**
 * OP-12 — Precondiciones del ecosistema antes de escribir el artefacto.
 *
 * Las dos son de Unity: sin carpeta de pruebas no hay dónde escribir, y sin
 * archivo de definición de ensamblado el editor no reconoce las pruebas ni
 * llega a compilarlas, de modo que el artefacto se escribiría para nada.
 */
export async function checkUnityPreconditions(
  project: ProjectModel,
  spec: ArtifactSpec
): Promise<readonly PreconditionViolation[]> {
  const violations: PreconditionViolation[] = [];
  const directory = path.join(project.rootPath, ...spec.directory.split("/"));

  let entries: string[];
  try {
    entries = await fsp.readdir(directory);
  } catch {
    return [
      {
        code: "unity.test-directory-missing",
        message: `La carpeta de pruebas "${spec.directory}" no existe en el proyecto.`,
        remediation:
          `Creá la carpeta "${spec.directory}" dentro del proyecto y agregale un archivo ` +
          `de definición de ensamblado de pruebas (${ASSEMBLY_DEFINITION}).`,
      },
    ];
  }

  if (!entries.some((entry) => entry.toLowerCase().endsWith(ASSEMBLY_DEFINITION))) {
    violations.push({
      code: "unity.assembly-definition-missing",
      message: `La carpeta "${spec.directory}" no tiene un archivo ${ASSEMBLY_DEFINITION}, así que Unity no reconocerá las pruebas.`,
      remediation:
        `En el editor, seleccioná la carpeta "${spec.directory}" y creá un Assembly Definition ` +
        `(Create > Testing > Tests Assembly Folder), que agrega las referencias a ` +
        `UnityEngine.TestRunner y NUnit.`,
    });
  }

  return violations;
}

/** Convierte un texto en un identificador válido de C#. */
function toIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}
