import * as fsp from "fs/promises";
import * as path from "path";
import type { ProjectModel, UnitTarget } from "../../core/contracts";
import { NOT_A_TYPE_NAME, findMethodExtents, findTypeBodies, maskCommentsAndStrings } from "./csharpSource";
import { isProjectCode } from "./projectTypes";

/**
 * OP-17 — Archivos del proyecto que declaran los tipos que usa un código.
 *
 * Complementa al agente resolutor, que con varios modelos no pidió el tipo de
 * un parámetro aunque el método accedía a sus miembros. Aquí no se le
 * pregunta a nadie: se cruzan los nombres que aparecen en el código con los
 * tipos que declara cada fuente del proyecto.
 *
 * Es léxico, como el resto de la lectura de C# del adaptador, y eso define lo
 * que alcanza:
 *
 *   · Puede sobrar: un nombre que coincide con el de un tipo del proyecto sin
 *     referirse a él trae un archivo de más. Sobra contexto, no falta.
 *   · No ve los tipos que no se escriben: `var x = Crear();` no nombra el
 *     tipo de `x`. Para eso sigue estando el agente.
 *   · No distingue espacios de nombres: si dos archivos declaran un tipo con
 *     el mismo nombre, devuelve los dos.
 */

/**
 * Declaración de un tipo. El segundo `class` o `struct` opcional cubre
 * `record class` y `record struct`, que si no se leerían como un tipo llamado
 * `class`.
 */
const TYPE_DECLARATION =
  /\b(?:class|struct|interface|enum|record)\s+(?:(?:class|struct)\s+)?([A-Za-z_]\w*)/g;

const IDENTIFIER = /[A-Za-z_]\w*/g;

export async function detectUnityDependencies(
  project: ProjectModel,
  code: string,
  focus?: UnitTarget
): Promise<readonly string[]> {
  const masked = maskCommentsAndStrings(code);
  const used = new Set(focusedText(masked, code, focus).match(IDENTIFIER) ?? []);
  // La clase de la unidad no es una dependencia de sí misma, ni lo es un
  // tipo que el propio código declara. Se miran las declaraciones de todo el
  // código y no solo del foco: un método que llama a otro de su misma clase
  // nombra la clase, y el archivo ya está en el contexto.
  for (const name of declaredTypeNames(masked)) {
    used.delete(name);
  }
  if (used.size === 0) {
    return [];
  }

  const dependencies: string[] = [];
  for (const source of project.sources) {
    // Una prueba no es dependencia del código que prueba, y el agente resolutor
    // tiene la orden de ignorar los tipos de terceros: aquí, la misma regla.
    if (!isProjectCode(source)) {
      continue;
    }
    let content: string;
    try {
      content = await fsp.readFile(path.join(project.rootPath, source.relativePath), "utf8");
    } catch {
      // Se borró desde que se armó el modelo: no es una dependencia posible.
      continue;
    }
    const declared = declaredTypeNames(maskCommentsAndStrings(content));
    if (declared.some((name) => used.has(name))) {
      dependencies.push(source.relativePath);
    }
  }
  return dependencies;
}

/**
 * El texto donde se buscan los nombres usados.
 *
 * Con foco, solo las declaraciones de ese método: el código es el archivo
 * entero, y sus otros métodos usan tipos que la unidad no necesita. Medido en
 * el proyecto de prueba: el archivo entero de `ShapesManager` nombra ocho
 * archivos del proyecto, que irían completos al contexto. Si el método no
 * aparece, se usa todo el código antes que no detectar nada.
 */
function focusedText(masked: string, original: string, focus: UnitTarget | undefined): string {
  if (!focus) {
    return masked;
  }
  const whole = { start: 0, end: masked.length };
  const scopes = focus.className === null ? [whole] : findTypeBodies(masked, focus.className);
  // Sin clase, dos niveles de llaves cubren el espacio de nombres y el tipo,
  // como en la localización de la unidad.
  const depth = focus.className === null ? 2 : 0;
  const extents = scopes.flatMap((scope) =>
    findMethodExtents(masked, original, scope, focus.methodName, depth)
  );
  if (extents.length === 0) {
    return masked;
  }
  return extents.map((extent) => masked.slice(extent.start, extent.end)).join("\n");
}

/** Nombres de los tipos declarados en un código ya enmascarado. */
export function declaredTypeNames(masked: string): string[] {
  const names: string[] = [];
  for (const match of masked.matchAll(TYPE_DECLARATION)) {
    const name = match[1];
    if (!NOT_A_TYPE_NAME.has(name)) {
      names.push(name);
    }
  }
  return names;
}
