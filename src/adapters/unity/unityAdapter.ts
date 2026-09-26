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
  TestExecutionResult,
  UnitTarget,
  VerificationResult,
} from "../../core/contracts";
import { detectUnityProject } from "./detection";
import { buildUnityProjectModel } from "./projectModel";
import { locateUnitSymbol, readUnitSource, resolveUnityDependency } from "./symbols";
import { unityPromptProfile } from "./promptProfile";
import { unityAnalysisSchema } from "./analysisSchema";
import { checkUnityPreconditions, normalizeUnityCode, specifyUnityArtifact } from "./artifact";
import { compileUnityProject } from "./compilation";
import { runUnityTests } from "./testRun";
import { detectUnityDependencies } from "./dependencies";
import { systemEditorToolchain, type UnityEditorToolchain } from "./editor";

export interface UnityAdapterOptions {
  /**
   * Editor con el que se compila. Por defecto, el instalado en la máquina; las
   * pruebas lo reemplazan para no depender de una instalación de Unity.
   */
  readonly toolchain?: UnityEditorToolchain;
}

/**
 * Adaptador del ecosistema Unity / C#.
 *
 * Primera implementación de la interfaz de adaptación. Cubre las once
 * operaciones obligatorias y cuatro de las seis opcionales: OP-09; OP-13 y
 * OP-14, que compilan el proyecto y ejecutan la prueba con el editor de Unity
 * en modo batch, y OP-17, que detecta los tipos del proyecto que usa la
 * unidad.
 *
 * Cobertura y ciclo de vida se declaran en falso porque hoy es cierto. Cuando se implementen, esta declaración cambia aquí y el núcleo no se
 * entera.
 *
 * Nada de este archivo depende del editor de código: el adaptador recibe rutas
 * y devuelve datos, de modo que se puede ejercitar sin abrir el entorno.
 */
export class UnityAdapter implements EcosystemAdapter {
  private readonly toolchain: UnityEditorToolchain;

  constructor(options: UnityAdapterOptions = {}) {
    this.toolchain = options.toolchain ?? systemEditorToolchain;
  }

  readonly descriptor: AdapterDescriptor = {
    id: "unity",
    displayName: "Unity / C#",
    version: "0.1.0",
    languageIds: ["csharp"],
  };

  readonly capabilities: CapabilityMap = {
    verification: "compile",
    runTests: true,
    coverage: false,
    analysisSchemaExtension: true,
    lifecycle: false,
    dependencyDetection: true,
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

  detectDependencies(
    project: ProjectModel,
    code: string,
    focus?: UnitTarget
  ): Promise<readonly string[]> {
    return detectUnityDependencies(project, code, focus);
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

  verifyArtifact(project: ProjectModel, spec: ArtifactSpec): Promise<VerificationResult> {
    return compileUnityProject(project, spec, { toolchain: this.toolchain });
  }

  runTests(project: ProjectModel, spec: ArtifactSpec): Promise<TestExecutionResult> {
    return runUnityTests(project, spec, { toolchain: this.toolchain });
  }
}
