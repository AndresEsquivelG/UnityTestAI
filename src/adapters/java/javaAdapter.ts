import type {
  AdapterDescriptor,
  AnalysisSchemaExtension,
  ApplicabilityResult,
  ArtifactRequest,
  ArtifactSpec,
  CapabilityMap,
  CompletedTestRun,
  CoverageResult,
  CoverageTarget,
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
import { describeJavaUnit } from "./analysis/classFacts";
import { locateJavaSymbol } from "./analysis/locateSymbol";
import { readJavaSource } from "./analysis/readSource";
import { resolveJavaDependency } from "./analysis/resolveDependency";
import { checkJavaPreconditions } from "./artifact/preconditions";
import { compileJavaProject } from "./build/compilation";
import { collectJavaCoverage } from "./build/coverage";
import { runJavaTests } from "./build/testRun";
import { systemBuildToolchain, type JavaBuildToolchain } from "./build/toolchain";
import { normalizeJavaCode } from "./artifact/normalizeCode";
import { specifyJavaArtifact } from "./artifact/specifyArtifact";
import { buildJavaProjectModel } from "./discovery/projectModel";
import { detectJavaProject } from "./identity/detection";
import { javaAnalysisSchema } from "./profile/analysisSchema";
import { javaPromptProfile } from "./profile";

export interface JavaAdapterOptions {
  /** Maven y Gradle con los que compilar y ejecutar. Por defecto, los de la máquina. */
  readonly toolchain?: JavaBuildToolchain;
}

/**
 * Adaptador del ecosistema Java: proyectos de un solo módulo con JUnit 5.
 * Compila, ejecuta y mide con Maven o Gradle; un proyecto con otra
 * herramienta, o sin ninguna, se reconoce igual y la prueba se genera, pero
 * esas tres etapas avisan que solo saben hacerlo con esas dos.
 *
 * Esta clase solo dice quién es el adaptador y qué ofrece, y le pasa cada
 * operación al componente que la resuelve. Cada carpeta es un componente con
 * una sola responsabilidad:
 *
 *   · `identity/`  — si el proyecto es Java (OP-02);
 *   · `discovery/` — dónde está cada cosa: convenciones y modelo (OP-04);
 *   · `source/`    — cómo se lee Java, para los demás componentes;
 *   · `analysis/`  — la unidad, su código y sus dependencias (OP-05 a OP-07),
 *                    y la ficha de la clase (OP-18);
 *   · `profile/`   — lo que se le dice al modelo: el perfil, un archivo por
 *                    prompt (OP-08), y la extensión del análisis (OP-09);
 *   · `artifact/`  — dónde va la prueba, cómo queda y qué hace falta antes de
 *                    escribirla (OP-10 a OP-12);
 *   · `build/`     — compilar, ejecutar y medir con la herramienta del
 *                    proyecto (OP-13 a OP-15).
 *
 * La detección de dependencias sin modelo (OP-17) y el ciclo de vida (OP-16)
 * no están.
 *
 * Nada de aquí depende del editor de código: recibe rutas y devuelve datos.
 */
export class JavaAdapter implements EcosystemAdapter {
  readonly descriptor: AdapterDescriptor = {
    id: "java",
    displayName: "Java",
    version: "0.2.0",
    languageIds: ["java"],
  };

  readonly capabilities: CapabilityMap = {
    verification: "compile",
    runTests: true,
    coverage: true,
    analysisSchemaExtension: true,
    lifecycle: false,
    dependencyDetection: false,
    unitFacts: true,
    moduleLevelUnits: false,
  };

  private readonly toolchain: JavaBuildToolchain;

  constructor(options: JavaAdapterOptions = {}) {
    this.toolchain = options.toolchain ?? systemBuildToolchain;
  }

  detectApplicability(context: DetectionContext): Promise<ApplicabilityResult> {
    return detectJavaProject(context);
  }

  buildProjectModel(rootPath: string): Promise<ProjectModel> {
    return buildJavaProjectModel(rootPath, this.descriptor.id);
  }

  locateSymbol(project: ProjectModel, target: UnitTarget): Promise<SymbolLocation> {
    return locateJavaSymbol(project, target);
  }

  readSource(project: ProjectModel, location: SymbolCandidate): Promise<SourceText> {
    return readJavaSource(project, location);
  }

  resolveDependency(project: ProjectModel, reference: string): Promise<DependencyResolution> {
    return resolveJavaDependency(project, reference);
  }

  describeUnit(code: string, target: UnitTarget): string {
    return describeJavaUnit(code, target);
  }

  getPromptProfile(project: ProjectModel): PromptProfile {
    return javaPromptProfile(project);
  }

  extendAnalysisSchema(): AnalysisSchemaExtension {
    return javaAnalysisSchema();
  }

  specifyArtifact(request: ArtifactRequest): ArtifactSpec {
    return specifyJavaArtifact(request);
  }

  normalizeGeneratedCode(code: string, spec: ArtifactSpec): string {
    return normalizeJavaCode(code, spec);
  }

  checkPreconditions(
    project: ProjectModel,
    spec: ArtifactSpec
  ): Promise<readonly PreconditionViolation[]> {
    return checkJavaPreconditions(project, spec);
  }

  verifyArtifact(project: ProjectModel, spec: ArtifactSpec): Promise<VerificationResult> {
    return compileJavaProject(project, spec, { toolchain: this.toolchain });
  }

  runTests(
    project: ProjectModel,
    spec: ArtifactSpec,
    coverage?: CoverageTarget
  ): Promise<TestExecutionResult> {
    return runJavaTests(project, spec, { toolchain: this.toolchain }, coverage);
  }

  collectCoverage(
    project: ProjectModel,
    execution: CompletedTestRun,
    target: CoverageTarget
  ): Promise<CoverageResult> {
    return Promise.resolve(collectJavaCoverage(project, execution, target));
  }
}
