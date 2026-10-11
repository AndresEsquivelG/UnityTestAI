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
import { locateJavaSymbol } from "./analysis/locateSymbol";
import { readJavaSource } from "./analysis/readSource";
import { resolveJavaDependency } from "./analysis/resolveDependency";
import { checkJavaPreconditions } from "./artifact/preconditions";
import { normalizeJavaCode } from "./artifact/normalizeCode";
import { specifyJavaArtifact } from "./artifact/specifyArtifact";
import { buildJavaProjectModel } from "./discovery/projectModel";
import { detectJavaProject } from "./identity/detection";
import { javaAnalysisSchema } from "./profile/analysisSchema";
import { javaPromptProfile } from "./profile";

/**
 * Adaptador del ecosistema Java: Maven o Gradle, con JUnit 5.
 *
 * Esta clase solo dice quién es el adaptador y qué ofrece, y le pasa cada
 * operación al componente que la resuelve. Cada carpeta es un componente con
 * una sola responsabilidad:
 *
 *   · `identity/`  — si el proyecto es Java (OP-02);
 *   · `discovery/` — dónde está cada cosa: convenciones y modelo (OP-04);
 *   · `source/`    — cómo se lee Java, para los demás componentes;
 *   · `analysis/`  — la unidad, su código y sus dependencias (OP-05 a OP-07);
 *   · `profile/`   — lo que se le dice al modelo: el perfil, un archivo por
 *                    prompt (OP-08), y la extensión del análisis (OP-09);
 *   · `artifact/`  — dónde va la prueba, cómo queda y qué hace falta antes de
 *                    escribirla (OP-10 a OP-12).
 *
 * Compilar, ejecutar y medir la cobertura (OP-13 a OP-15) todavía no están:
 * se declaran ausentes y el núcleo informa esas etapas como «no aplica». La
 * detección de dependencias sin modelo (OP-17) y el ciclo de vida (OP-16)
 * tampoco.
 *
 * Nada de aquí depende del editor de código: recibe rutas y devuelve datos.
 */
export class JavaAdapter implements EcosystemAdapter {
  readonly descriptor: AdapterDescriptor = {
    id: "java",
    displayName: "Java (Maven / Gradle)",
    version: "0.1.0",
    languageIds: ["java"],
  };

  readonly capabilities: CapabilityMap = {
    verification: "none",
    runTests: false,
    coverage: false,
    analysisSchemaExtension: true,
    lifecycle: false,
    dependencyDetection: false,
  };

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
}
