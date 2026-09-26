import type { EcosystemAdapter, ProjectModel } from "../contracts";

/**
 * Lectura de las dependencias que pidió el agente resolutor y de las que
 * detectó el adaptador — consume OP-07.
 *
 * Sustituye a `readDependencyFiles`, que probaba cada ruta en el disco con el
 * prefijo "Assets/" y sin él. Aquí el núcleo solo recorre las referencias y
 * concatena lo que el adaptador haya podido resolver.
 */

/** Resultado de resolver una referencia, en el orden en que la pidió el agente. */
export interface ResolvedDependency {
  /** Referencia lógica tal como la emitió el agente o la detectó el adaptador. */
  readonly reference: string;
  /**
   * La detectó el adaptador (OP-17) y el agente no la había pedido. Sirve
   * para medir cuánto aporta la detección, además de para mostrarlo.
   */
  readonly detected: boolean;
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

/**
 * Resuelve primero lo que pidió el agente y después lo que detectó el
 * adaptador (OP-17), sin repetir un archivo: el agente puede nombrar por la
 * ruta lo mismo que el adaptador detecta, o pedir dos veces el mismo archivo
 * con dos nombres, y el contexto lo recibiría duplicado.
 */
export async function resolveDependencies(
  adapter: EcosystemAdapter,
  project: ProjectModel,
  requested: readonly string[],
  detected: readonly string[] = []
): Promise<ResolvedDependencies> {
  const files: ResolvedDependency[] = [];
  const blocks: string[] = [];
  const included = new Set<string>();

  const references = [
    ...requested.map((reference) => ({ reference, detected: false })),
    ...detected.map((reference) => ({ reference, detected: true })),
  ];

  for (const { reference, detected: isDetected } of references) {
    const resolution = await adapter.resolveDependency(project, reference);

    if (resolution.resolved) {
      if (included.has(resolution.relativePath)) {
        continue;
      }
      included.add(resolution.relativePath);
      files.push({
        reference,
        detected: isDetected,
        found: true,
        relativePath: resolution.relativePath,
        content: resolution.content,
      });
      blocks.push(`\n\n// File: ${resolution.relativePath}\n${resolution.content}`);
      continue;
    }

    files.push({
      reference,
      detected: isDetected,
      found: false,
      triedPaths: resolution.triedPaths,
    });
  }

  return { code: blocks.join(""), files };
}
