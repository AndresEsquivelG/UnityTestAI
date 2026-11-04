import * as fsp from "fs/promises";
import * as path from "path";
import type {
  ArtifactSpec,
  PreconditionViolation,
  ProjectModel,
  SymbolCandidate,
} from "../../core/contracts";
import { EXCLUDED_DIRECTORIES } from "./projectModel";

/**
 * OP-12 — Precondiciones de Unity: el ensamblado de pruebas.
 *
 * Unity compila las pruebas en un ensamblado propio, definido por un `.asmdef`
 * en su carpeta, y ese ensamblado solo ve lo que lista en `references`. Una
 * prueba compila si se cumplen tres cosas, y las tres se pueden saber leyendo
 * archivos, antes de gastar una llamada al modelo:
 *
 *   · el `.asmdef` de las pruebas existe y es JSON válido;
 *   · la clase bajo prueba está en un ensamblado propio: `Assembly-CSharp`, el
 *     ensamblado por defecto, no se puede referenciar desde un `.asmdef`;
 *   · ese ensamblado está en `references`.
 *
 * El ensamblado de una clase lo decide el `.asmdef` o `.asmref` más cercano,
 * subiendo desde su carpeta hasta `Assets`.
 *
 * Si falta el `.asmdef` de las pruebas y nada impide compilar, el incumplimiento
 * trae el archivo listo para crearlo. El contenido es fijo y no sale de la
 * plantilla de Unity: la de 2018 a 2021 tiene otro formato, y en Unity 6 no está
 * en la misma carpeta. Este es el que compila en 2020.3, 2021.3, 6000.2 y 6000.5.
 */

const DEFINITION_EXTENSION = ".asmdef";
const REFERENCE_EXTENSION = ".asmref";
const TEST_FRAMEWORK = "com.unity.test-framework";
const TEST_ASSEMBLY_FILE = `Tests${DEFINITION_EXTENSION}`;
const TEST_ASSEMBLY_NAME = "Tests";
/** Por si `Tests` ya es el nombre de otro ensamblado: Unity no admite repetidos. */
const FALLBACK_TEST_ASSEMBLY_NAME = "UTIA.Tests";
const TEST_RUNNER_REFERENCES = ["UnityEngine.TestRunner", "UnityEditor.TestRunner"];
const EDITOR_PLATFORM = "Editor";
/** El ensamblado que se le propone a un proyecto que no tiene ninguno. */
const PROJECT_ASSEMBLY_NAME = "ProjectScripts";

interface AssemblyDefinition {
  /** Ruta relativa a la raíz del proyecto, con separador "/". */
  readonly file: string;
  readonly name: string;
  /** El de su `.meta`, si lo tiene: las referencias pueden escribirse `GUID:<guid>`. */
  readonly guid?: string;
  readonly references: readonly string[];
  readonly includePlatforms: readonly string[];
}

/** Un `.asmdef` que no se pudo leer como JSON. */
interface BrokenDefinition {
  readonly broken: PreconditionViolation;
}

type ReadDefinition = AssemblyDefinition | BrokenDefinition;

function isBroken(definition: ReadDefinition): definition is BrokenDefinition {
  return "broken" in definition;
}

export async function checkUnityPreconditions(
  project: ProjectModel,
  spec: ArtifactSpec,
  location?: SymbolCandidate
): Promise<readonly PreconditionViolation[]> {
  const directory = path.join(project.rootPath, ...spec.directory.split("/"));

  let entries: string[] | undefined;
  try {
    entries = await fsp.readdir(directory);
  } catch {
    entries = undefined;
  }

  const definitionFiles = (entries ?? []).filter(hasExtension(DEFINITION_EXTENSION));
  if (definitionFiles.length > 0) {
    return checkExistingAssembly(project, spec, definitionFiles, location);
  }

  const missing = entries === undefined ? testDirectoryMissing(spec) : assemblyDefinitionMissing(spec);
  return location
    ? checkMissingAssembly(project, spec, location, missing)
    : [missing];
}

/** Hay `.asmdef` de pruebas: tiene que leerse y alcanzar la clase bajo prueba. */
async function checkExistingAssembly(
  project: ProjectModel,
  spec: ArtifactSpec,
  files: readonly string[],
  location: SymbolCandidate | undefined
): Promise<readonly PreconditionViolation[]> {
  const definitions = await Promise.all(
    files.map((file) => readDefinition(project.rootPath, `${spec.directory}/${file}`))
  );
  const broken = definitions.filter(isBroken).map((definition) => definition.broken);
  if (broken.length > 0) {
    return broken;
  }
  if (!location) {
    return [];
  }

  const assemblies = definitions as readonly AssemblyDefinition[];
  const owner = await findClassAssembly(project, location);
  if (owner === undefined) {
    return [classInDefaultAssembly(location, "Después volvé a generar.")];
  }
  if (isBroken(owner)) {
    return [owner.broken];
  }
  // La clase vive en el mismo ensamblado que las pruebas: no hay nada que referenciar.
  if (assemblies.some((assembly) => assembly.file === owner.file)) {
    return [];
  }
  if (isEditorOnly(owner) && !assemblies.some(isEditorOnly)) {
    return [classInEditorAssembly(owner)];
  }
  if (assemblies.some((assembly) => references(assembly, owner))) {
    return [];
  }
  return [referenceMissing(assemblies[0], owner)];
}

/**
 * No hay `.asmdef` de pruebas. Crearlo solo sirve si después la prueba puede
 * compilar, así que el arreglo se ofrece únicamente si no queda nada más por
 * resolver, y si no le cambia el ensamblado a ningún script que ya exista.
 */
async function checkMissingAssembly(
  project: ProjectModel,
  spec: ArtifactSpec,
  location: SymbolCandidate,
  missing: PreconditionViolation
): Promise<readonly PreconditionViolation[]> {
  const blocking: PreconditionViolation[] = [];

  const owner = await findClassAssembly(project, location);
  if (owner === undefined) {
    blocking.push(
      classInDefaultAssembly(
        location,
        `Después volvé a generar: la extensión te va a ofrecer crear ${TEST_ASSEMBLY_FILE}.`
      )
    );
  } else if (isBroken(owner)) {
    blocking.push(owner.broken);
  } else if (isEditorOnly(owner)) {
    blocking.push(classInEditorAssembly(owner));
  }
  if (!(await testFrameworkInstalled(project.rootPath))) {
    blocking.push(testFrameworkMissing());
  }
  if (blocking.length > 0 || owner === undefined || isBroken(owner)) {
    return blocking;
  }

  const scripts = project.sources.filter((source) => source.sourceRoot === "test");
  if (scripts.length > 0) {
    return [scriptsInTestDirectory(spec, scripts.length)];
  }

  const taken = (await listDefinitions(project)).some(
    (definition) => !isBroken(definition) && definition.name === TEST_ASSEMBLY_NAME
  );
  const name = taken ? FALLBACK_TEST_ASSEMBLY_NAME : TEST_ASSEMBLY_NAME;
  const assemblyReferences = testAssemblyReferences(owner);
  const relativePath = `${spec.directory}/${TEST_ASSEMBLY_FILE}`;

  return [
    {
      ...missing,
      remediation: `Se puede crear "${relativePath}" con estas referencias: ${assemblyReferences
        .slice(TEST_RUNNER_REFERENCES.length)
        .join(", ")}.`,
      fix: {
        label: `Crear ${TEST_ASSEMBLY_FILE}`,
        relativePath,
        content: testAssemblyContent(name, assemblyReferences),
      },
    },
  ];
}

/**
 * Lo que necesita la prueba: el motor de pruebas, el ensamblado de la clase y lo
 * que ese ensamblado usa. Lo último se copia tal cual porque Unity acepta las dos
 * formas, nombre y `GUID:`, y una firma pública puede exponer esos tipos (CS0012).
 */
function testAssemblyReferences(owner: AssemblyDefinition): string[] {
  return [...new Set([...TEST_RUNNER_REFERENCES, owner.name, ...owner.references])];
}

function testAssemblyContent(name: string, assemblyReferences: readonly string[]): string {
  return `${JSON.stringify(
    {
      name,
      rootNamespace: "",
      references: assemblyReferences,
      includePlatforms: [],
      excludePlatforms: [],
      allowUnsafeCode: false,
      overrideReferences: true,
      precompiledReferences: ["nunit.framework.dll"],
      autoReferenced: false,
      defineConstraints: ["UNITY_INCLUDE_TESTS"],
      versionDefines: [],
      noEngineReferences: false,
    },
    null,
    4
  )}\n`;
}

// ── Lectura de los archivos de ensamblado ────────────────────────────────────

/** El ensamblado de la clase, o `undefined` si es el ensamblado por defecto. */
async function findClassAssembly(
  project: ProjectModel,
  location: SymbolCandidate
): Promise<ReadDefinition | undefined> {
  const folders = location.filePath.split(/[\\/]/).slice(0, -1);

  while (folders.length > 0) {
    const relativeFolder = folders.join("/");
    const entries = await fsp
      .readdir(path.join(project.rootPath, ...folders))
      .catch((): string[] => []);

    const definition = entries.find(hasExtension(DEFINITION_EXTENSION));
    if (definition) {
      return readDefinition(project.rootPath, `${relativeFolder}/${definition}`);
    }

    const reference = entries.find(hasExtension(REFERENCE_EXTENSION));
    if (reference) {
      return followReference(project, `${relativeFolder}/${reference}`);
    }

    folders.pop();
  }
  return undefined;
}

/** Un `.asmref` suma su carpeta a un ensamblado definido en otro lugar. */
async function followReference(project: ProjectModel, file: string): Promise<ReadDefinition> {
  const parsed = await readJson(project.rootPath, file);
  if ("broken" in parsed) {
    return parsed;
  }
  const reference = typeof parsed.value.reference === "string" ? parsed.value.reference : "";
  const target = (await listDefinitions(project)).find(
    (definition): definition is AssemblyDefinition =>
      !isBroken(definition) && matchesReference(definition, reference)
  );
  // Sin el `.asmdef` a la vista, la referencia sigue siendo lo que hay que agregar.
  return target ?? { file, name: reference, references: [], includePlatforms: [] };
}

async function readDefinition(rootPath: string, file: string): Promise<ReadDefinition> {
  const parsed = await readJson(rootPath, file);
  if ("broken" in parsed) {
    return parsed;
  }
  return {
    file,
    name: typeof parsed.value.name === "string" ? parsed.value.name : "",
    guid: await readGuid(rootPath, file),
    references: stringsOf(parsed.value.references),
    includePlatforms: stringsOf(parsed.value.includePlatforms),
  };
}

async function readJson(
  rootPath: string,
  file: string
): Promise<{ readonly value: Record<string, unknown> } | BrokenDefinition> {
  // Unity admite el BOM (`SanAndreasUnity.Importing.Audio.asmdef` lo trae) y
  // `JSON.parse` no.
  const content = (await fsp.readFile(path.join(rootPath, ...file.split("/")), "utf8")).replace(
    /^\uFEFF/,
    ""
  );
  try {
    const value: unknown = JSON.parse(content);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { broken: definitionInvalid(file) };
    }
    return { value: value as Record<string, unknown> };
  } catch (error) {
    return { broken: definitionInvalid(file, lineOfJsonError(content, error)) };
  }
}

/** La línea del error, si el mensaje de `JSON.parse` trae la posición. */
function lineOfJsonError(content: string, error: unknown): number | undefined {
  const position = /position (\d+)/.exec(error instanceof Error ? error.message : "")?.[1];
  return position === undefined
    ? undefined
    : content.slice(0, Number(position)).split("\n").length;
}

async function readGuid(rootPath: string, file: string): Promise<string | undefined> {
  try {
    const meta = await fsp.readFile(path.join(rootPath, ...`${file}.meta`.split("/")), "utf8");
    return /^guid:\s*(\S+)/m.exec(meta)?.[1];
  } catch {
    return undefined;
  }
}

/** Todos los `.asmdef` de `Assets`. Unity ignora las carpetas ocultas y las que terminan en `~`. */
async function listDefinitions(project: ProjectModel): Promise<readonly ReadDefinition[]> {
  const found: ReadDefinition[] = [];

  const walk = async (relativeFolder: string): Promise<void> => {
    const entries = await fsp
      .readdir(path.join(project.rootPath, ...relativeFolder.split("/")), { withFileTypes: true })
      .catch(() => []);

    for (const entry of entries) {
      const relativePath = `${relativeFolder}/${entry.name}`;
      if (entry.isDirectory()) {
        const ignored =
          EXCLUDED_DIRECTORIES.has(entry.name) ||
          entry.name.startsWith(".") ||
          entry.name.endsWith("~");
        if (!ignored) {
          await walk(relativePath);
        }
      } else if (hasExtension(DEFINITION_EXTENSION)(entry.name)) {
        found.push(await readDefinition(project.rootPath, relativePath));
      }
    }
  };

  await walk("Assets");
  return found;
}

/** Instalado directamente, como dependencia de otro paquete o embebido en el proyecto. */
async function testFrameworkInstalled(rootPath: string): Promise<boolean> {
  for (const file of ["Packages/manifest.json", "Packages/packages-lock.json"]) {
    const parsed = await readJson(rootPath, file).catch(() => undefined);
    if (parsed && "value" in parsed) {
      const dependencies = parsed.value.dependencies as Record<string, unknown> | undefined;
      if (dependencies?.[TEST_FRAMEWORK] !== undefined) {
        return true;
      }
    }
  }
  return fsp.access(path.join(rootPath, "Packages", TEST_FRAMEWORK)).then(
    () => true,
    () => false
  );
}

function references(assembly: AssemblyDefinition, target: AssemblyDefinition): boolean {
  return assembly.references.some((reference) => matchesReference(target, reference));
}

function matchesReference(definition: AssemblyDefinition, reference: string): boolean {
  return (
    reference === definition.name ||
    (definition.guid !== undefined && reference.toLowerCase() === `guid:${definition.guid}`.toLowerCase())
  );
}

function isEditorOnly(definition: AssemblyDefinition): boolean {
  return definition.includePlatforms.length === 1 && definition.includePlatforms[0] === EDITOR_PLATFORM;
}

function hasExtension(extension: string): (name: string) => boolean {
  return (name) => name.toLowerCase().endsWith(extension);
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// ── Avisos ───────────────────────────────────────────────────────────────────

/**
 * El menú *Tests Assembly Folder* crea una carpeta `Tests` nueva dentro de la que
 * esté seleccionada (`TestListGuiHelper.cs` del paquete), así que hay que usarlo
 * desde la carpeta de arriba.
 */
function testDirectoryMissing(spec: ArtifactSpec): PreconditionViolation {
  return {
    code: "unity.test-directory-missing",
    message: `La carpeta de pruebas "${spec.directory}" no existe en el proyecto.`,
    remediation:
      `En el editor, seleccioná la carpeta "${path.posix.dirname(spec.directory)}" y usá ` +
      `Create > Testing > Tests Assembly Folder: crea "${spec.directory}" con su archivo ${DEFINITION_EXTENSION}.`,
  };
}

function assemblyDefinitionMissing(spec: ArtifactSpec): PreconditionViolation {
  return {
    code: "unity.assembly-definition-missing",
    message: `La carpeta "${spec.directory}" no tiene un archivo ${DEFINITION_EXTENSION}, así que Unity no reconocerá las pruebas.`,
    remediation:
      `En el editor, borrá la carpeta "${spec.directory}" si está vacía, seleccioná ` +
      `"${path.posix.dirname(spec.directory)}" y usá Create > Testing > Tests Assembly Folder: ` +
      `crea la carpeta de nuevo con su archivo ${DEFINITION_EXTENSION}.`,
  };
}

function scriptsInTestDirectory(spec: ArtifactSpec, count: number): PreconditionViolation {
  return {
    code: "unity.assembly-definition-missing",
    message:
      `La carpeta "${spec.directory}" no tiene un archivo ${DEFINITION_EXTENSION} y ya contiene ` +
      `${count === 1 ? "un script" : `${count} scripts`}: al crearlo dejarían de estar en ` +
      `Assembly-CSharp, y eso puede romper el proyecto.`,
    remediation: `Mové esos scripts a otra carpeta y volvé a generar: entonces se podrá crear el archivo.`,
  };
}

function definitionInvalid(file: string, line?: number): PreconditionViolation {
  return {
    code: "unity.assembly-definition-invalid",
    message: `"${file}" tiene un error de formato${line === undefined ? "" : ` en la línea ${line}`}, así que Unity no puede compilar el proyecto.`,
    remediation: "Corregí el JSON del archivo (suele faltar una comilla o una coma) y volvé a generar.",
  };
}

/**
 * Propone el `.asmdef` en `Assets` y no en la carpeta de los scripts: medido en
 * una copia de RedRunner, en `Assets/Scripts` rompe la compilación porque esos
 * scripts usan otros de `Assets/SaveGameFree` y `Assets/Standard Assets`, que
 * quedarían afuera; en `Assets` compila sin errores y la prueba corre. Se escribe
 * como un archivo, y no con el menú del editor, porque se puede hacer desde
 * VS Code sin depender de cómo se llama el menú en cada versión.
 */
function classInDefaultAssembly(location: SymbolCandidate, nextStep: string): PreconditionViolation {
  return {
    code: "unity.class-in-default-assembly",
    message:
      `Las pruebas todavía no pueden usar "${location.filePath}". Ese archivo no pertenece a ningún ` +
      `${DEFINITION_EXTENSION}, así que Unity lo compila en Assembly-CSharp, y las pruebas no tienen acceso a ese ensamblado.`,
    remediation:
      `Creá el archivo "Assets/${PROJECT_ASSEMBLY_NAME}${DEFINITION_EXTENSION}" con este texto: ` +
      `{ "name": "${PROJECT_ASSEMBLY_NAME}" }. ${nextStep} Ese archivo junta en un solo ensamblado ` +
      `los scripts del proyecto que no tienen su propio ${DEFINITION_EXTENSION}; si Unity muestra errores o falla una build, ` +
      `borralo y todo queda como estaba.`,
  };
}

function classInEditorAssembly(owner: AssemblyDefinition): PreconditionViolation {
  return {
    code: "unity.class-in-editor-assembly",
    message: `La clase está en "${owner.name}", un ensamblado solo para el editor, y una prueba de PlayMode no puede usarlo.`,
    remediation: `Elegí una clase de otro ensamblado, o dejá el ensamblado de pruebas solo para el editor ("includePlatforms": ["${EDITOR_PLATFORM}"]).`,
  };
}

function referenceMissing(tests: AssemblyDefinition, owner: AssemblyDefinition): PreconditionViolation {
  const others = owner.references.filter((reference) => !tests.references.includes(reference));
  const alsoNeeded =
    others.length === 0
      ? ""
      : ` También conviene agregar lo que ese ensamblado usa: ${others.join(", ")}.`;
  return {
    code: "unity.assembly-reference-missing",
    message: `"${tests.file}" no referencia "${owner.name}", el ensamblado de la clase, así que la prueba no compilaría.`,
    remediation: `Agregá "${owner.name}" a "references" en ese archivo y volvé a generar.${alsoNeeded}`,
  };
}

function testFrameworkMissing(): PreconditionViolation {
  return {
    code: "unity.test-framework-missing",
    message: `El proyecto no tiene instalado Test Framework (${TEST_FRAMEWORK}), que hace falta para compilar y ejecutar las pruebas.`,
    remediation: "Instalalo desde Window > Package Manager y volvé a generar.",
  };
}
