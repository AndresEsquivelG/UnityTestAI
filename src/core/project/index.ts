/**
 * Operaciones del núcleo sobre el modelo del proyecto.
 *
 * Todo lo que hay aquí es neutro: recibe el modelo que construyó el adaptador y
 * la especificación que decidió el adaptador, y no nombra ninguna tecnología.
 */

export { renderProjectTree } from "./projectTree";

export {
  artifactAbsolutePath,
  artifactRelativePath,
  describeViolations,
  readArtifact,
  writeArtifact,
} from "./artifact";

export { dependencyLabel, resolveDependencies } from "./dependencies";
export type { ResolvedDependencies, ResolvedDependency } from "./dependencies";
