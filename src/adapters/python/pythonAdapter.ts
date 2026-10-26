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
import { describePythonUnit } from "./analysis/classFacts";
import { locatePythonSymbol } from "./analysis/locateSymbol";
import { readPythonSource } from "./analysis/readSource";
import { resolvePythonDependency } from "./analysis/resolveDependency";
import { normalizePythonCode } from "./artifact/normalizeCode";
import { checkPythonPreconditions } from "./artifact/preconditions";
import { specifyPythonArtifact } from "./artifact/specifyArtifact";
import { collectPythonCoverage } from "./build/coverage";
import { checkPythonImports } from "./build/importCheck";
import { systemPythonRuntime, type PythonRuntime } from "./build/runtime";
import { runPythonTests } from "./build/testRun";
import { buildPythonProjectModel } from "./discovery/projectModel";
import { detectPythonProject } from "./identity/detection";
import { pythonPromptProfile } from "./profile";
import { pythonAnalysisSchema } from "./profile/analysisSchema";

export interface PythonAdapterOptions {
  /** El Python con el que comprobar, ejecutar y medir. Por defecto, el de la máquina. */
  readonly runtime?: PythonRuntime;
}

/**
 * Adaptador del ecosistema Python con pytest.
 *
 * Reconoce el proyecto, ubica la clase y el método, le enseña pytest al
 * modelo, le pasa a cada agente la ficha de la clase y escribe la prueba en la
 * carpeta de pruebas. Después comprueba que la prueba se pueda importar, la
 * ejecuta con pytest y la mide con coverage, con el Python del proyecto: su
 * entorno virtual si lo tiene, y si no, el de la máquina.
 *
 * Esta clase solo dice quién es el adaptador y qué ofrece, y le pasa cada
 * operación al componente que la resuelve. Cada carpeta es un componente con
 * una sola responsabilidad, las mismas que en Java:
 *
 *   · `identity/`  — si el proyecto es Python (OP-02);
 *   · `discovery/` — dónde está cada cosa: convenciones y modelo (OP-04);
 *   · `source/`    — cómo se lee Python, para los demás componentes;
 *   · `analysis/`  — la unidad, su código y sus dependencias (OP-05 a OP-07),
 *                    y la ficha de la clase (OP-18);
 *   · `profile/`   — lo que se le dice al modelo: el perfil, un archivo por
 *                    prompt (OP-08), y la extensión del análisis (OP-09);
 *   · `artifact/`  — dónde va la prueba, cómo queda y qué hace falta antes de
 *                    escribirla (OP-10 a OP-12);
 *   · `build/`     — comprobar, ejecutar y medir con el Python del proyecto
 *                    (OP-13 a OP-15).
 *
 * La detección de dependencias sin modelo (OP-17) y el ciclo de vida (OP-16)
 * no están.
 *
 * Nada de aquí depende del editor de código: recibe rutas y devuelve datos.
 * Para generar no hace falta tener Python instalado; para comprobar, ejecutar
 * y medir, sí, con pytest y coverage.
 */
export class PythonAdapter implements EcosystemAdapter {
  readonly descriptor: AdapterDescriptor = {
    id: "python",
    displayName: "Python",
    version: "0.2.0",
    languageIds: ["python"],
  };

  readonly capabilities: CapabilityMap = {
    verification: "importCheck",
    runTests: true,
    coverage: true,
    analysisSchemaExtension: true,
    lifecycle: false,
    dependencyDetection: false,
    unitFacts: true,
  };

  private readonly runtime: PythonRuntime;

  constructor(options: PythonAdapterOptions = {}) {
    this.runtime = options.runtime ?? systemPythonRuntime;
  }

  detectApplicability(context: DetectionContext): Promise<ApplicabilityResult> {
    return detectPythonProject(context);
  }

  buildProjectModel(rootPath: string): Promise<ProjectModel> {
    return buildPythonProjectModel(rootPath, this.descriptor.id);
  }

  locateSymbol(project: ProjectModel, target: UnitTarget): Promise<SymbolLocation> {
    return locatePythonSymbol(project, target);
  }

  readSource(project: ProjectModel, location: SymbolCandidate): Promise<SourceText> {
    return readPythonSource(project, location);
  }

  resolveDependency(project: ProjectModel, reference: string): Promise<DependencyResolution> {
    return resolvePythonDependency(project, reference);
  }

  describeUnit(
    code: string,
    target: UnitTarget,
    location: SymbolCandidate,
    project: ProjectModel
  ): string {
    return describePythonUnit(code, target, location, project);
  }

  /** No depende del proyecto: la carpeta desde la que se importa la dice la ficha. */
  getPromptProfile(_project: ProjectModel): PromptProfile {
    return pythonPromptProfile();
  }

  extendAnalysisSchema(): AnalysisSchemaExtension {
    return pythonAnalysisSchema();
  }

  specifyArtifact(request: ArtifactRequest): ArtifactSpec {
    return specifyPythonArtifact(request);
  }

  normalizeGeneratedCode(code: string, spec: ArtifactSpec): string {
    return normalizePythonCode(code, spec);
  }

  checkPreconditions(
    project: ProjectModel,
    spec: ArtifactSpec
  ): Promise<readonly PreconditionViolation[]> {
    return checkPythonPreconditions(project, spec);
  }

  verifyArtifact(project: ProjectModel, spec: ArtifactSpec): Promise<VerificationResult> {
    return checkPythonImports(project, spec, { runtime: this.runtime });
  }

  runTests(
    project: ProjectModel,
    spec: ArtifactSpec,
    coverage?: CoverageTarget
  ): Promise<TestExecutionResult> {
    return runPythonTests(project, spec, { runtime: this.runtime }, coverage);
  }

  collectCoverage(
    project: ProjectModel,
    execution: CompletedTestRun,
    target: CoverageTarget
  ): Promise<CoverageResult> {
    return collectPythonCoverage(project, execution, target);
  }
}
