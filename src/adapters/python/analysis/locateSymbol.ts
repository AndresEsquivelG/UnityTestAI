import * as fsp from "fs/promises";
import type {
  ProjectModel,
  SymbolCandidate,
  SymbolLocation,
  UnitTarget,
} from "../../../core/contracts";
import { absolutePath } from "../discovery/layout";
import {
  findClasses,
  methodsOf,
  moduleFunctions,
  outlinePython,
  type PythonBlock,
} from "../source/declarations";

/** Archivos que nombra como máximo el aviso de una función sin clase. */
const MAX_LISTED_FILES = 3;

/**
 * OP-05 — Localización de la unidad bajo prueba.
 *
 * Busca la declaración en todo el proyecto, no solo en el archivo abierto.
 * Distingue el ámbito de cada `def`, como pide HU-24:
 *
 *   · con clase, solo cuentan los métodos de esa clase: ni una función de
 *     módulo con el mismo nombre, ni una función definida dentro de un
 *     método, ni el método de una clase anidada;
 *   · sin clase, solo cuentan las funciones de módulo.
 *
 * En Python no hay sobrecargas: la segunda declaración con el mismo nombre
 * reemplaza a la primera. Puede haber varias candidatas igual, si dos módulos
 * declaran una clase con el mismo nombre; elegir entre ellas es de quien llama.
 */
export async function locatePythonSymbol(
  project: ProjectModel,
  target: UnitTarget
): Promise<SymbolLocation> {
  const { className, methodName } = target;
  const candidates: SymbolCandidate[] = [];
  const moduleLevel: string[] = [];
  let classDeclared = false;

  for (const source of project.sources) {
    let content: string;
    try {
      content = await fsp.readFile(absolutePath(project.rootPath, source.relativePath), "utf8");
    } catch {
      continue;
    }

    // Se examina todo archivo que nombre la clase, aunque no nombre el método:
    // así se distingue «esa clase no existe» de «la clase no declara ese
    // método», que son dos avisos distintos.
    if (!content.includes(methodName) && (className === null || !content.includes(className))) {
      continue;
    }

    const outline = outlinePython(content);
    const toCandidate = (block: PythonBlock): SymbolCandidate => ({
      filePath: source.relativePath,
      line: block.line,
      column: block.column,
      signature: block.signature,
    });

    const functions = moduleFunctions(outline).filter((block) => block.name === methodName);

    if (className === null) {
      candidates.push(...functions.map(toCandidate));
      continue;
    }

    if (functions.length > 0) {
      moduleLevel.push(source.relativePath);
    }

    const classes = findClasses(outline, className);
    if (classes.length === 0) {
      continue;
    }
    classDeclared = true;

    for (const owner of classes) {
      const methods = methodsOf(owner).filter((block) => block.name === methodName);
      // Si la clase lo declara dos veces, la que vale es la última.
      const last = methods[methods.length - 1];
      if (last) {
        candidates.push(toCandidate(last));
      }
    }
  }

  if (candidates.length > 0) {
    const [first, ...rest] = candidates.sort(
      (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line
    );
    return { found: true, candidates: [first, ...rest] };
  }

  // Todavía no se puede pedir una función de módulo: el panel exige una clase.
  // Si la hay, se dice dónde, para que el aviso no parezca un error de nombre.
  // Un nombre como `main` puede estar en muchos archivos: se nombran algunos.
  const shown = moduleLevel.slice(0, MAX_LISTED_FILES).join(", ");
  const more = moduleLevel.length > MAX_LISTED_FILES ? ` y ${moduleLevel.length - MAX_LISTED_FILES} más` : "";
  const freeFunction =
    moduleLevel.length > 0
      ? ` Hay una función "${methodName}" fuera de toda clase en ${shown}${more}: ` +
        `las funciones sin clase todavía no se pueden pedir.`
      : "";

  if (className !== null && !classDeclared) {
    return {
      found: false,
      reason: `No se encontró la declaración de la clase "${className}" en el proyecto.${freeFunction}`,
    };
  }

  if (className === null) {
    return {
      found: false,
      reason: `No se encontró ninguna función "${methodName}" fuera de una clase.`,
    };
  }

  return {
    found: false,
    reason:
      `No se encontró el método "${methodName}" dentro de "${className}". ` +
      `Puede estar invocado pero no declarado, heredado de otra clase o definido dentro de otra función.` +
      freeFunction,
  };
}
