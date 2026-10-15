import * as fsp from "fs/promises";
import * as path from "path";
import type { ProjectModel, SourceFile, SourceRoot } from "../../../core/contracts";
import {
  MAIN_ROOT,
  NON_TYPE_FILES,
  SOURCE_EXTENSION,
  TEST_ROOT,
  absolutePath,
  findBuildDescriptor,
} from "./layout";

/**
 * OP-04 — Modelo del proyecto Java.
 *
 * Recorre solo las dos jerarquías de la convención, `src/main/java` y
 * `src/test/java`. Lo que genera la construcción (`target/`, `build/`) y los
 * recursos quedan fuera sin tener que enumerarlos, porque no cuelgan de ellas.
 *
 * La jerarquía de pruebas se declara aunque todavía no exista: es donde va a
 * ir la prueba generada, y el adaptador la necesita para ubicarla.
 */

export async function buildJavaProjectModel(
  rootPath: string,
  ecosystemId: string
): Promise<ProjectModel> {
  const sourceRoots: SourceRoot[] = [
    { relativePath: MAIN_ROOT, kind: "main" },
    { relativePath: TEST_ROOT, kind: "test" },
  ];

  const sources: SourceFile[] = [];
  for (const root of sourceRoots) {
    sources.push(...(await collectSources(absolutePath(rootPath, root.relativePath), root)));
  }

  // De la herramienta de construcción dependen la compilación, la ejecución
  // y la cobertura, y el perfil la nombra. Averiguarla aquí evita volver a
  // mirar la raíz en cada operación. Sin ninguna queda `"none"`, para que la
  // compilación pueda decir que el proyecto no usa ninguna.
  const descriptor = await findBuildDescriptor(rootPath);

  return {
    rootPath,
    ecosystemId,
    sourceRoots,
    sources,
    adapterData: descriptor
      ? { buildTool: descriptor.tool, buildFile: descriptor.file }
      : { buildTool: "none" },
  };
}

async function collectSources(directory: string, root: SourceRoot, prefix = root.relativePath): Promise<SourceFile[]> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const sources: SourceFile[] = [];
  for (const entry of entries) {
    const relativePath = `${prefix}/${entry.name}`;

    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) {
        sources.push(...(await collectSources(path.join(directory, entry.name), root, relativePath)));
      }
      continue;
    }

    if (!entry.name.endsWith(SOURCE_EXTENSION) || NON_TYPE_FILES.has(entry.name)) {
      continue;
    }

    sources.push({ relativePath, name: entry.name, sourceRoot: root.kind });
  }

  return sources;
}
