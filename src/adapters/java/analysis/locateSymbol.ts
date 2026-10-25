import * as fsp from "fs/promises";
import type {
  ProjectModel,
  SymbolCandidate,
  SymbolLocation,
  UnitTarget,
} from "../../../core/contracts";
import { absolutePath } from "../discovery/layout";
import { findMethodDeclarations, findTypeBodies } from "../source/declarations";
import { maskCommentsAndLiterals } from "../source/masking";

/**
 * OP-05 — Localización de la unidad bajo prueba.
 *
 * Busca la declaración en todo el proyecto, no solo en el archivo abierto, y
 * devuelve una candidata por cada sobrecarga: el mismo nombre declarado varias
 * veces con parámetros distintos. Elegir entre ellas es de quien llama.
 */
export async function locateJavaSymbol(
  project: ProjectModel,
  target: UnitTarget
): Promise<SymbolLocation> {
  const { className, methodName } = target;
  const candidates: SymbolCandidate[] = [];
  let typeDeclared = false;

  for (const source of project.sources) {
    let content: string;
    try {
      content = await fsp.readFile(absolutePath(project.rootPath, source.relativePath), "utf8");
    } catch {
      continue;
    }

    if (className === null) {
      // En Java todo método pertenece a un tipo. Sin clase, se acepta un
      // miembro de cualquier tipo de primer nivel del archivo.
      if (!content.includes(methodName)) {
        continue;
      }
      const masked = maskCommentsAndLiterals(content);
      const declarations = findMethodDeclarations(
        masked,
        content,
        { start: 0, end: masked.length },
        methodName,
        1
      );
      candidates.push(...declarations.map((d) => ({ filePath: source.relativePath, ...d })));
      continue;
    }

    // Se examina todo archivo que nombre la clase, aunque no nombre el método:
    // así se distingue «esa clase no existe» de «la clase no declara ese
    // método», que son dos avisos distintos.
    if (!content.includes(className)) {
      continue;
    }

    const masked = maskCommentsAndLiterals(content);
    const bodies = findTypeBodies(masked, className);
    if (bodies.length === 0) {
      continue;
    }
    typeDeclared = true;

    if (!content.includes(methodName)) {
      continue;
    }

    for (const body of bodies) {
      const declarations = findMethodDeclarations(masked, content, body, methodName);
      candidates.push(...declarations.map((d) => ({ filePath: source.relativePath, ...d })));
    }
  }

  if (candidates.length > 0) {
    const [first, ...rest] = candidates.sort(
      (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line
    );
    return { found: true, candidates: [first, ...rest] };
  }

  if (className !== null && !typeDeclared) {
    return {
      found: false,
      reason: `No se encontró la declaración de "${className}" en el proyecto.`,
    };
  }

  const where = className !== null ? ` dentro de "${className}"` : "";
  return {
    found: false,
    reason:
      `No se encontró la declaración de "${methodName}"${where}. ` +
      `Puede estar invocado pero no declarado, ser un constructor o ser un método sin cuerpo.`,
  };
}
