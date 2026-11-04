import * as path from "path";
import type { ArtifactRequest, ArtifactSpec } from "../../core/contracts";
import { baseArtifactName } from "../shared/artifactName";

/**
 * Operaciones de materialización del adaptador Unity — OP-10 y OP-11. OP-12, que
 * es sobre todo el ensamblado de pruebas, está en `testAssembly.ts`.
 *
 * Reúnen lo que hoy está repartido entre `testGenerator`: carpeta "Tests",
 * nombre `UTIA_<modelo>_<clase>_<método>`, extensión ".cs" y el renombrado de
 * la clase generada.
 */

const FALLBACK_TEST_DIRECTORY = "Assets/Tests";
const EXTENSION = ".cs";

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

  // NUnit reconoce las pruebas por sus atributos y no por el nombre, así que
  // la base común no necesita nada al final.
  const name = baseArtifactName(request.modelId, owner, request.target.methodName);

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
