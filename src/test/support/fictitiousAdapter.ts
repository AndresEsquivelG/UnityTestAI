import * as fsp from "fs/promises";
import * as path from "path";
import type {
  AdapterDescriptor,
  ApplicabilityResult,
  ArtifactRequest,
  ArtifactSpec,
  CapabilityMap,
  DependencyResolution,
  DetectionContext,
  EcosystemAdapter,
  PreconditionViolation,
  ProjectModel,
  PromptExtensionPoint,
  PromptProfile,
  PromptVocabulary,
  SourceFile,
  SourceRoot,
  SourceRootKind,
  SourceText,
  SymbolCandidate,
  SymbolLocation,
  UnitTarget,
} from "../../core/contracts";
import { FICTITIOUS_MARKER } from "./fictitiousFixture";

/**
 * Adaptador de un ecosistema que no existe, deliberadamente incompleto.
 *
 * Responde de verdad a las once operaciones obligatorias, sobre los archivos
 * de un lenguaje inventado (ver `fictitiousFixture.ts`), y declara ausentes
 * las seis opcionales: no verifica, no ejecuta, no mide cobertura, no extiende
 * el esquema del análisis, no tiene ciclo de vida ni detecta dependencias.
 *
 * Existe para comprobar que el núcleo tolera capacidades ausentes sin
 * preguntar de qué ecosistema se trata. Ningún ecosistema real recorre ese
 * camino entero: Unity y Java declaran compilación, ejecución y cobertura, y
 * Python declarará comprobación de importabilidad, no ausencia de
 * verificación.
 *
 * No es el adaptador de mentira de `stubAdapter.ts`. Aquel implementa solo lo
 * que la pieza bajo prueba necesita y lanza en todo lo demás; este es un
 * adaptador completo y coherente, que el registro acepta como cualquier otro.
 *
 * La extensión no lo da de alta: vive solo en las pruebas.
 */

const EXTENSION = ".fic";
const MAIN_ROOT = "fuentes";
const TEST_ROOT = "pruebas";

/** Carpeta de compilados del ecosistema, que nunca contiene fuentes. */
const EXCLUDED_DIRECTORIES = new Set(["salida"]);

const UNIT_DECLARATION = /^\s*unidad\s+([A-Za-z_]\w*)\s*\{/;
const FUNCTION_DECLARATION = /^\s*funcion\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/;

export class FictitiousAdapter implements EcosystemAdapter {
  readonly descriptor: AdapterDescriptor = {
    id: "ficticio",
    displayName: "Ficticio",
    version: "0.1.0",
    languageIds: ["ficticio"],
  };

  readonly capabilities: CapabilityMap = {
    verification: "none",
    runTests: false,
    coverage: false,
    analysisSchemaExtension: false,
    lifecycle: false,
    dependencyDetection: false,
  };

  /** OP-02 — Lo reclama el marcador en la raíz, y nada más. */
  async detectApplicability(context: DetectionContext): Promise<ApplicabilityResult> {
    if (await isFile(path.join(context.rootPath, FICTITIOUS_MARKER))) {
      return { applicable: true, confidence: 0.9, evidence: [FICTITIOUS_MARKER] };
    }
    return { applicable: false, confidence: 0, evidence: [] };
  }

  /**
   * OP-04 — Recorre la raíz entera. Un archivo fuera de `fuentes` y de
   * `pruebas` entra con `sourceRoot: null`, que Unity nunca produce.
   */
  async buildProjectModel(rootPath: string): Promise<ProjectModel> {
    const sourceRoots: SourceRoot[] = [
      { relativePath: MAIN_ROOT, kind: "main" },
      { relativePath: TEST_ROOT, kind: "test" },
    ];
    const sources = await collectSources(rootPath, "");
    sources.sort((a, b) => compareCodePoints(a.relativePath, b.relativePath));

    return { rootPath, ecosystemId: this.descriptor.id, sourceRoots, sources };
  }

  /**
   * OP-05 — Sin clase, la unidad es una función declarada fuera de toda
   * `unidad`: el caso de una función de módulo, que Unity no tiene.
   */
  async locateSymbol(project: ProjectModel, target: UnitTarget): Promise<SymbolLocation> {
    const { className, methodName } = target;
    const candidates: SymbolCandidate[] = [];
    let unitDeclared = false;

    for (const source of project.sources) {
      const content = await readOrNull(project, source.relativePath);
      if (content === null) {
        continue;
      }
      const declarations = scanDeclarations(content);
      if (className !== null && declarations.units.includes(className)) {
        unitDeclared = true;
      }
      for (const declaration of declarations.functions) {
        if (declaration.unit === className && declaration.name === methodName) {
          const { line, column, signature } = declaration;
          candidates.push({ filePath: source.relativePath, line, column, signature });
        }
      }
    }

    if (candidates.length > 0) {
      const [first, ...rest] = candidates;
      return { found: true, candidates: [first, ...rest] };
    }

    if (className !== null && !unitDeclared) {
      return { found: false, reason: `No se encontró la unidad "${className}" en el proyecto.` };
    }
    return {
      found: false,
      reason:
        className !== null
          ? `No se encontró la declaración de "${methodName}" dentro de "${className}".`
          : `No se encontró una función "${methodName}" declarada fuera de toda unidad.`,
    };
  }

  /** OP-06 */
  async readSource(project: ProjectModel, location: SymbolCandidate): Promise<SourceText> {
    const content = await fsp.readFile(path.join(project.rootPath, location.filePath), "utf8");
    return { filePath: location.filePath, content };
  }

  /**
   * OP-07 — Admite la ruta del árbol, el nombre del archivo y el nombre de la
   * unidad. Lo último es lo propio de este lenguaje: un archivo no tiene por
   * qué llamarse como la unidad que declara, así que el nombre de archivo no
   * alcanza para encontrarla.
   */
  async resolveDependency(project: ProjectModel, reference: string): Promise<DependencyResolution> {
    const normalized = reference.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
    const withExtension = normalized.toLowerCase().endsWith(EXTENSION)
      ? normalized
      : `${normalized}${EXTENSION}`;
    const triedPaths = [withExtension];

    const byPath = project.sources.find(
      (source) => source.relativePath.toLowerCase() === withExtension.toLowerCase()
    );
    if (byPath) {
      return readResolved(project, byPath.relativePath, reference);
    }

    const fileName = withExtension.slice(withExtension.lastIndexOf("/") + 1);
    const byFileName = project.sources.filter(
      (source) => source.name.toLowerCase() === fileName.toLowerCase()
    );
    if (byFileName.length === 1) {
      return readResolved(project, byFileName[0].relativePath, reference);
    }
    if (byFileName.length > 1) {
      return { resolved: false, reference, triedPaths: byFileName.map((s) => s.relativePath) };
    }

    const unitName = fileName.slice(0, -EXTENSION.length);
    const declaring: string[] = [];
    for (const source of project.sources) {
      const content = await readOrNull(project, source.relativePath);
      if (content !== null && scanDeclarations(content).units.includes(unitName)) {
        declaring.push(source.relativePath);
      }
    }
    if (declaring.length === 1) {
      return readResolved(project, declaring[0], reference);
    }
    if (declaring.length > 1) {
      return { resolved: false, reference, triedPaths: declaring };
    }

    return { resolved: false, reference, triedPaths };
  }

  /** OP-08 — Ver `FICTITIOUS_FRAGMENTS`. */
  getPromptProfile(_project: ProjectModel): PromptProfile {
    return { vocabulary: FICTITIOUS_VOCABULARY, fragments: FICTITIOUS_FRAGMENTS };
  }

  /**
   * OP-10 — El archivo y la unidad de prueba no se llaman igual
   * (`prueba_calculadora_sumar.fic` declara `PruebaCalculadoraSumar`), que el
   * contrato admite y Unity no ejercita. El modelo no entra en el nombre: nada
   * del núcleo debería depender de que entre.
   */
  specifyArtifact(request: ArtifactRequest): ArtifactSpec {
    const testRoot =
      request.project.sourceRoots.find((root) => root.kind === "test")?.relativePath ?? TEST_ROOT;
    const owner =
      request.target.className ?? path.posix.basename(request.targetLocation.filePath, EXTENSION);
    const words = [...splitWords(owner), ...splitWords(request.target.methodName)];

    return {
      directory: testRoot,
      fileName: ["prueba", ...words].join("_"),
      extension: EXTENSION,
      unitName: ["Prueba", ...words.map(capitalize)].join(""),
    };
  }

  /** OP-11 — Quita el cercado de markdown y renombra la primera unidad. */
  normalizeGeneratedCode(code: string, spec: ArtifactSpec): string {
    const withoutFences = code
      .trim()
      .replace(/^```(?:fic)?[ \t]*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/, "")
      .trim();
    return withoutFences.replace(/^(\s*)unidad\s+[A-Za-z_]\w*/m, `$1unidad ${spec.unitName}`);
  }

  /** OP-12 — La única precondición: que exista la carpeta de pruebas. */
  async checkPreconditions(
    project: ProjectModel,
    spec: ArtifactSpec
  ): Promise<readonly PreconditionViolation[]> {
    if (await isDirectory(path.join(project.rootPath, ...spec.directory.split("/")))) {
      return [];
    }
    return [
      {
        code: "ficticio.test-directory-missing",
        message: `La carpeta de pruebas "${spec.directory}" no existe en el proyecto.`,
        remediation: `Creá la carpeta "${spec.directory}" en la raíz del proyecto.`,
      },
    ];
  }
}

// ── Perfil de prompt ─────────────────────────────────────────────────────────

const FICTITIOUS_VOCABULARY: PromptVocabulary = {
  ecosystem: "Ficticio",
  language: "Fic",
  testFramework: "FicPrueba",
  importStatements: "usar statements",
  typeKinds: "unidad",
  assertionPrefix: "afirmar",
  controlFlowKeywords: "si/sino or mientras",
  loopKeywords: "mientras",
};

/**
 * Solo los nueve puntos que las plantillas insertan dentro de una frase. Sin
 * ellos la frase queda con un hueco, porque un marcador dentro de una línea se
 * sustituye por la cadena vacía (ver `composeTemplate`).
 *
 * Todos los bloques faltan a propósito: es el caso de un ecosistema que no
 * tiene nada que decir en esos puntos, y las plantillas tienen que seguir
 * siendo válidas así.
 */
const FICTITIOUS_FRAGMENTS: Readonly<Partial<Record<PromptExtensionPoint, string>>> = {
  sliceImportRule: "`usar` lines: only those naming a unit used inside the target function",
  sourcePathExample: `"fuentes/.../archivo.fic"`,
  fixerSummaryExample: "Added the missing usar line for Registro",
  analyzerDependencyKinds: "unidad | external",
  analyzerLoopTypeValues: "mientras",
  analyzerMemberKinds: "field | function",
  analyzerInstantiationPatterns: "direct",
  generatorTestFramework: "FicPrueba",
  generatorLoopKeywords: "`mientras`",
};

// ── Lectura del lenguaje ─────────────────────────────────────────────────────

interface FunctionDeclaration {
  /** Unidad que la declara, o `null` si se declara fuera de toda unidad. */
  readonly unit: string | null;
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly signature: string;
}

interface Declarations {
  readonly units: readonly string[];
  readonly functions: readonly FunctionDeclaration[];
}

/**
 * Declaraciones de un archivo, línea por línea. Las unidades solo se declaran
 * en el primer nivel; una función cuenta si está en el primer nivel o
 * directamente dentro de una unidad. Las que están dentro de otra función son
 * locales y no cuentan.
 */
function scanDeclarations(content: string): Declarations {
  const units: string[] = [];
  const functions: FunctionDeclaration[] = [];
  let openUnit: string | null = null;
  let depth = 0;

  content.split(/\r?\n/).forEach((raw, index) => {
    const line = maskCommentsAndStrings(raw);

    const unit = depth === 0 ? UNIT_DECLARATION.exec(line) : null;
    if (unit) {
      units.push(unit[1]);
      openUnit = unit[1];
    }

    const declared = FUNCTION_DECLARATION.exec(line);
    if (declared && (depth === 0 || (depth === 1 && openUnit !== null))) {
      functions.push({
        unit: depth === 0 ? null : openUnit,
        name: declared[1],
        line: index + 1,
        column: line.indexOf("funcion") + 1,
        signature: raw.trim().replace(/\s*\{\s*$/, ""),
      });
    }

    depth += count(line, "{") - count(line, "}");
    if (depth <= 0) {
      depth = 0;
      openUnit = null;
    }
  });

  return { units, functions };
}

/** Vacía las cadenas y corta el comentario, conservando las columnas. */
function maskCommentsAndStrings(line: string): string {
  const withoutStrings = line.replace(/"[^"]*"/g, (literal) => `"${" ".repeat(literal.length - 2)}"`);
  const comment = withoutStrings.indexOf("#");
  return comment === -1 ? withoutStrings : withoutStrings.slice(0, comment);
}

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

/** `prueba_registro`, `PruebaRegistro` o `pruebaRegistro` → `["prueba", "registro"]`. */
function splitWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ── Disco ────────────────────────────────────────────────────────────────────

async function collectSources(directory: string, relativePrefix: string): Promise<SourceFile[]> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const sources: SourceFile[] = [];
  for (const entry of entries) {
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
        sources.push(...(await collectSources(path.join(directory, entry.name), relativePath)));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(EXTENSION)) {
      sources.push({ relativePath, name: entry.name, sourceRoot: sourceRootOf(relativePath) });
    }
  }
  return sources;
}

function sourceRootOf(relativePath: string): SourceRootKind | null {
  if (relativePath.startsWith(`${TEST_ROOT}/`)) {
    return "test";
  }
  return relativePath.startsWith(`${MAIN_ROOT}/`) ? "main" : null;
}

/** Orden por punto de código, el mismo en cualquier máquina. */
function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function readOrNull(project: ProjectModel, relativePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(path.join(project.rootPath, relativePath), "utf8");
  } catch {
    return null;
  }
}

async function readResolved(
  project: ProjectModel,
  relativePath: string,
  reference: string
): Promise<DependencyResolution> {
  const content = await readOrNull(project, relativePath);
  return content === null
    ? { resolved: false, reference, triedPaths: [relativePath] }
    : { resolved: true, relativePath, content };
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isDirectory();
  } catch {
    return false;
  }
}
