import type { EcosystemAdapter, ProjectModel } from "../contracts";

/**
 * Lectura de las dependencias que pidió el agente resolutor — consume OP-07.
 *
 * Sustituye a `readDependencyFiles`, que probaba cada ruta en el disco con el
 * prefijo "Assets/" y sin él. Aquí el núcleo solo recorre las referencias y
 * concatena lo que el adaptador haya podido resolver.
 */

/** Resultado de resolver una referencia, en el orden en que la pidió el agente. */
export interface ResolvedDependency {
  /** Referencia lógica tal como la emitió el agente. */
  readonly reference: string;
  readonly found: boolean;
  /** Ruta relativa con la que el adaptador la resolvió. */
  readonly relativePath?: string;
  readonly content?: string;
  /** Rutas que el adaptador intentó, cuando no la resolvió. */
  readonly triedPaths?: readonly string[];
}

export interface ResolvedDependencies {
  /** Contenido de las dependencias encontradas, concatenado para el prompt. */
  readonly code: string;
  readonly files: readonly ResolvedDependency[];
}

/** Nombre con el que presentar una dependencia: el que resolvió el adaptador. */
export function dependencyLabel(dependency: ResolvedDependency): string {
  return dependency.relativePath ?? dependency.reference;
}

export async function resolveDependencies(
  adapter: EcosystemAdapter,
  project: ProjectModel,
  references: readonly string[]
): Promise<ResolvedDependencies> {
  const files: ResolvedDependency[] = [];
  const blocks: string[] = [];

  for (const reference of references) {
    const resolution = await adapter.resolveDependency(project, reference);

    if (resolution.resolved) {
      files.push({
        reference,
        found: true,
        relativePath: resolution.relativePath,
        content: resolution.content,
      });
      blocks.push(`\n\n// File: ${resolution.relativePath}\n${resolution.content}`);
      continue;
    }

    files.push({ reference, found: false, triedPaths: resolution.triedPaths });
  }

  return { code: blocks.join(""), files };
}
