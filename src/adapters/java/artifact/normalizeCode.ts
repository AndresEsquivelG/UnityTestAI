import type { ArtifactSpec } from "../../../core/contracts";
import { TEST_ROOT } from "../discovery/layout";
import { escapeForRegExp, findTopLevelType, findTypeBodies } from "../source/declarations";
import { maskCommentsAndLiterals } from "../source/masking";
import { packageForDirectory, withPackage } from "../source/packageName";

/**
 * OP-11 — Normalización del código generado.
 *
 * Tres ajustes, para que el archivo compile donde OP-10 dijo que va:
 *
 *   1. quitar el cercado de markdown con el que el modelo suele envolver la
 *      respuesta;
 *   2. renombrar la clase de prueba como el archivo, que Java exige a una
 *      clase pública; también sus constructores, si declaró alguno;
 *   3. poner la línea `package` que corresponde a la carpeta. No se confía en
 *      la que haya escrito el modelo: el paquete sale de la ubicación física,
 *      y así los dos no pueden discrepar.
 *
 * Aplicarla dos veces da lo mismo que una: el pipeline vuelve a normalizar las
 * correcciones de los agentes, que ya pasaron por aquí.
 */
export function normalizeJavaCode(code: string, spec: ArtifactSpec): string {
  const withoutFences = code
    .trim()
    .replace(/^```(?:java)?[ \t]*\r?\n?/i, "")
    .replace(/\r?\n?```\s*$/i, "")
    .trim();

  const renamed = renameTestClass(withoutFences, spec.unitName);
  const packageName = packageOfTestDirectory(spec.directory);
  return packageName === undefined ? renamed : withPackage(renamed, packageName);
}

/**
 * Paquete de una carpeta de la jerarquía de pruebas: `null` para el paquete
 * por omisión, y `undefined` si la carpeta no cuelga de esa jerarquía y no hay
 * forma de deducirlo.
 */
function packageOfTestDirectory(directory: string): string | null | undefined {
  if (directory === TEST_ROOT) {
    return null;
  }
  if (directory.startsWith(`${TEST_ROOT}/`)) {
    return packageForDirectory(directory.slice(TEST_ROOT.length + 1));
  }
  return undefined;
}

/** Renombra el primer tipo de primer nivel, que es la clase de prueba. */
function renameTestClass(code: string, unitName: string): string {
  const declaration = findTopLevelType(maskCommentsAndLiterals(code));
  if (!declaration || declaration.name === unitName) {
    return code;
  }

  const renamed =
    code.slice(0, declaration.nameStart) +
    unitName +
    code.slice(declaration.nameStart + declaration.name.length);

  return renameConstructors(renamed, declaration.name, unitName);
}

/**
 * Los constructores llevan el nombre de la clase: si quedaran con el nombre
 * viejo, el compilador los leería como métodos sin tipo de retorno.
 */
function renameConstructors(code: string, oldName: string, unitName: string): string {
  const masked = maskCommentsAndLiterals(code);
  const [body] = findTypeBodies(masked, unitName);
  if (!body) {
    return code;
  }

  const constructor = new RegExp(
    String.raw`^([ \t]*(?:(?:public|protected|private)[ \t]+)?)${escapeForRegExp(oldName)}(?=\s*\()`,
    "gm"
  );

  const positions: number[] = [];
  let depth = 0;
  let scanned = body.start;
  for (const match of masked.slice(body.start, body.end).matchAll(constructor)) {
    const start = body.start + (match.index ?? 0);
    for (; scanned < start; scanned++) {
      depth += masked[scanned] === "{" ? 1 : masked[scanned] === "}" ? -1 : 0;
    }
    if (depth === 0) {
      positions.push(start + match[1].length);
    }
  }

  let result = code;
  for (const position of positions.reverse()) {
    result = result.slice(0, position) + unitName + result.slice(position + oldName.length);
  }
  return result;
}
