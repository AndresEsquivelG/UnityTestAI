import * as fsp from "fs/promises";
import * as path from "path";
import type {
  DependencyResolution,
  ProjectModel,
  SourceText,
  SymbolCandidate,
  SymbolLocation,
  UnitTarget,
} from "../../core/contracts";
import { findMethodDeclarations, findTypeBodies, maskCommentsAndStrings } from "./csharpSource";

/**
 * Operaciones de análisis del adaptador Unity — OP-05, OP-06 y OP-07.
 */

const SOURCE_EXTENSION = ".cs";

/**
 * OP-05 — Localización de la unidad bajo prueba.
 *
 * Busca la declaración en todo el proyecto y no solo en el archivo abierto en
 * el editor, que es lo único que mira hoy `checkSymbols`.
 *
 * Devolver varias candidatas significa sobrecarga: el mismo nombre declarado
 * más de una vez con firmas distintas. Es quien llama el que elige.
 */
export async function locateUnitSymbol(
  project: ProjectModel,
  target: UnitTarget
): Promise<SymbolLocation> {
  const { className, methodName } = target;
  const candidates: SymbolCandidate[] = [];
  let typeDeclared = false;

  for (const source of project.sources) {
    let content: string;
    try {
      content = await fsp.readFile(path.join(project.rootPath, source.relativePath), "utf8");
    } catch {
      continue;
    }

    if (className === null) {
      // Sin clase, se admite cualquier miembro de un tipo de primer nivel: dos
      // de profundidad cubren el espacio de nombres y el tipo.
      if (!content.includes(methodName)) {
        continue;
      }
      const masked = maskCommentsAndStrings(content);
      const declarations = findMethodDeclarations(
        masked,
        content,
        { start: 0, end: masked.length },
        methodName,
        2
      );
      candidates.push(...declarations.map((d) => ({ filePath: source.relativePath, ...d })));
      continue;
    }

    // Se examina todo archivo que nombre la clase, aunque no nombre el método.
    // Es lo que después permite distinguir "esa clase no existe" de "la clase
    // existe pero no declara ese método", que son dos avisos distintos.
    if (!content.includes(className)) {
      continue;
    }

    const masked = maskCommentsAndStrings(content);
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
      `Puede estar invocado pero no declarado, o ser un constructor.`,
  };
}

/** OP-06 — Lectura del código fuente en la ubicación determinada. */
export async function readUnitSource(
  project: ProjectModel,
  location: SymbolCandidate
): Promise<SourceText> {
  const content = await fsp.readFile(
    path.join(project.rootPath, location.filePath),
    "utf8"
  );
  return { filePath: location.filePath, content };
}

/**
 * OP-07 — Resolución de una referencia de dependencia a su ruta física.
 *
 * Los agentes nombran las dependencias de dos maneras: con la ruta que vieron
 * en el árbol del proyecto, que empieza por `Assets/`, o con el nombre del tipo
 * a secas. Se admiten ambas, y la búsqueda se hace contra el modelo del
 * proyecto en lugar de probar rutas en el disco a ciegas, que es lo que hace
 * hoy `readDependencyFiles`.
 */
export async function resolveUnityDependency(
  project: ProjectModel,
  reference: string
): Promise<DependencyResolution> {
  const normalized = reference
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");

  const triedPaths: string[] = [];
  const withExtension = normalized.toLowerCase().endsWith(SOURCE_EXTENSION)
    ? normalized
    : `${normalized}${SOURCE_EXTENSION}`;

  // Rutas, tal como pudo escribirlas el agente.
  for (const candidate of unique([
    withExtension,
    withExtension.startsWith("Assets/") ? withExtension.slice("Assets/".length) : `Assets/${withExtension}`,
  ])) {
    triedPaths.push(candidate);
    const match = project.sources.find(
      (source) => source.relativePath.toLowerCase() === candidate.toLowerCase()
    );
    if (match) {
      return readResolved(project, match.relativePath);
    }
  }

  // Nombre del tipo o del archivo, sin ruta.
  const fileName = withExtension.slice(withExtension.lastIndexOf("/") + 1);
  const byName = project.sources.filter(
    (source) => source.name.toLowerCase() === fileName.toLowerCase()
  );

  if (byName.length === 1) {
    return readResolved(project, byName[0].relativePath);
  }
  if (byName.length > 1) {
    // Ambiguo: se informa como no resuelto con las opciones encontradas, en
    // lugar de elegir una al azar.
    return { resolved: false, reference, triedPaths: byName.map((s) => s.relativePath) };
  }

  return { resolved: false, reference, triedPaths };
}

async function readResolved(
  project: ProjectModel,
  relativePath: string
): Promise<DependencyResolution> {
  try {
    const content = await fsp.readFile(path.join(project.rootPath, relativePath), "utf8");
    return { resolved: true, relativePath, content };
  } catch {
    return { resolved: false, reference: relativePath, triedPaths: [relativePath] };
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
