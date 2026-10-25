import * as fsp from "fs/promises";
import * as path from "path";
import type { ProjectModel, SourceFile, SourceRoot, SourceRootKind } from "../../../core/contracts";
import {
  DEFAULT_TEST_ROOT,
  PROJECT_ROOT,
  SOURCE_EXTENSION,
  SRC_ROOT,
  findTestRoot,
  isExcludedDirectory,
  usesSrcLayout,
} from "./layout";

/**
 * OP-04 — Modelo del proyecto Python.
 *
 * A diferencia de Java, el código no cuelga de una carpeta fija: en la forma
 * plana los paquetes están en la raíz, junto a todo lo demás. Por eso se
 * recorre el proyecto entero y lo que no es del proyecto se excluye: los
 * entornos virtuales, las cachés y lo que deja la construcción
 * (`layout.ts`). Es lo que pide HU-23.
 *
 * La carpeta de pruebas se declara aunque todavía no exista: es donde va a ir
 * la prueba generada, y el adaptador la necesita para ubicarla.
 */

export async function buildPythonProjectModel(
  rootPath: string,
  ecosystemId: string
): Promise<ProjectModel> {
  const srcLayout = await usesSrcLayout(rootPath);
  const importRoot = srcLayout ? SRC_ROOT : PROJECT_ROOT;
  const testRoot = await findTestRoot(rootPath);

  const sourceRoots: SourceRoot[] = [
    { relativePath: importRoot, kind: "main" },
    { relativePath: testRoot, kind: "test" },
  ];

  const classify = (relativePath: string): SourceRootKind | null => {
    if (relativePath.startsWith(`${testRoot}/`)) {
      return "test";
    }
    if (!srcLayout || relativePath.startsWith(`${SRC_ROOT}/`)) {
      return "main";
    }
    // En la forma con `src/`, un script de la raíz o la documentación no son
    // de ninguna de las dos.
    return null;
  };

  // La raíz de importación la necesitan la ficha, para escribir la línea que
  // importa la clase, y la resolución de dependencias, para traducir un nombre
  // con puntos a su archivo.
  return {
    rootPath,
    ecosystemId,
    sourceRoots,
    sources: await collectSources(rootPath, "", classify),
    adapterData: { layout: srcLayout ? "src" : "flat", importRoot, testRoot },
  };
}

/**
 * Raíz de importación que se averiguó al armar el modelo: `src` o la del
 * proyecto. Un modelo que no la trae, como el de una prueba, es de la forma
 * plana.
 */
export function importRootOf(project: ProjectModel): string {
  const importRoot = project.adapterData?.importRoot;
  return typeof importRoot === "string" ? importRoot : PROJECT_ROOT;
}

/** Carpeta de pruebas que se averiguó al armar el modelo. */
export function testRootOf(project: ProjectModel): string {
  const declared = project.sourceRoots.find((root) => root.kind === "test")?.relativePath;
  return declared ?? DEFAULT_TEST_ROOT;
}

async function collectSources(
  directory: string,
  prefix: string,
  classify: (relativePath: string) => SourceRootKind | null
): Promise<SourceFile[]> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const sources: SourceFile[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!(await isExcludedDirectory(absolute, entry.name))) {
        sources.push(...(await collectSources(absolute, relativePath, classify)));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(SOURCE_EXTENSION)) {
      sources.push({ relativePath, name: entry.name, sourceRoot: classify(relativePath) });
    }
  }

  return sources;
}
