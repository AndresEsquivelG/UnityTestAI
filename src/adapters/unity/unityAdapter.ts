import type {
  AdapterDescriptor,
  AnalysisSchemaExtension,
  ApplicabilityResult,
  ArtifactRequest,
  ArtifactSpec,
  CapabilityMap,
  DependencyResolution,
  DetectionContext,
  EcosystemAdapter,
  PreconditionViolation,
  ProjectModel,
  PromptProfile,
  SourceText,
  SymbolCandidate,
  SymbolLocation,
  UnitTarget,
} from "../../core/contracts";
import { detectUnityProject } from "./detection";
import { buildUnityProjectModel } from "./projectModel";
import { locateUnitSymbol, readUnitSource, resolveUnityDependency } from "./symbols";
import { unityPromptProfile } from "./promptProfile";
import { unityAnalysisSchema } from "./analysisSchema";
import { checkUnityPreconditions, normalizeUnityCode, specifyUnityArtifact } from "./artifact";

/**
 * Adaptador del ecosistema Unity / C#.
 *
 * Primera implementación de la interfaz de adaptación. Cubre las once
 * operaciones obligatorias y una de las cinco opcionales, OP-09.
 *
 * Las otras cuatro se declaran en falso porque hoy es cierto: en el proyecto no
 * hay una sola invocación de compilación, de ejecución de pruebas ni de
 * recolección de cobertura. Cuando se implementen, esta declaración cambia aquí
 * y el núcleo no se entera.
 *
 * Nada de este archivo depende del editor: el adaptador recibe rutas y devuelve
 * datos, de modo que se puede ejercitar sin abrir el entorno.
 */
export class UnityAdapter implements EcosystemAdapter {
  readonly descriptor: AdapterDescriptor = {
    id: "unity",
    displayName: "Unity / C#",
    version: "0.1.0",
    languageIds: ["csharp"],
  };

  readonly capabilities: CapabilityMap = {
    verification: "none",
    runTests: false,
    coverage: false,
    analysisSchemaExtension: true,
    lifecycle: false,
  };

  detectApplicability(context: DetectionContext): Promise<ApplicabilityResult> {
    return detectUnityProject(context);
  }

  buildProjectModel(rootPath: string): Promise<ProjectModel> {
    return buildUnityProjectModel(rootPath, this.descriptor.id);
  }

  locateSymbol(project: ProjectModel, target: UnitTarget): Promise<SymbolLocation> {
    return locateUnitSymbol(project, target);
  }

  readSource(project: ProjectModel, location: SymbolCandidate): Promise<SourceText> {
    return readUnitSource(project, location);
  }

  resolveDependency(project: ProjectModel, reference: string): Promise<DependencyResolution> {
    return resolveUnityDependency(project, reference);
  }

  getPromptProfile(project: ProjectModel): PromptProfile {
    return unityPromptProfile(project);
  }

  extendAnalysisSchema(): AnalysisSchemaExtension {
    return unityAnalysisSchema();
  }

  specifyArtifact(request: ArtifactRequest): ArtifactSpec {
    return specifyUnityArtifact(request);
  }

  normalizeGeneratedCode(code: string, spec: ArtifactSpec): string {
    return normalizeUnityCode(code, spec);
  }

  checkPreconditions(
    project: ProjectModel,
    spec: ArtifactSpec
  ): Promise<readonly PreconditionViolation[]> {
    return checkUnityPreconditions(project, spec);
  }
}
