/**
 * Contrato de adaptación del núcleo — HU-01.
 *
 * Punto de entrada único: el núcleo importa de "core/contracts" y nunca de un
 * módulo de adaptador, que es el criterio de aceptación de HU-01.
 *
 * Trazabilidad con la Tabla 10 del anteproyecto:
 *
 *   OP-01  Descriptor                    → AdapterDescriptor          identity.ts
 *   OP-02  Aplicabilidad                 → ApplicabilityResult        identity.ts
 *   OP-03  Mapa de capacidades           → CapabilityMap              identity.ts
 *   OP-04  Modelo de proyecto            → ProjectModel               discovery.ts
 *   OP-05  Ubicación del símbolo         → SymbolLocation             analysis.ts
 *   OP-06  Texto fuente                  → SourceText                 analysis.ts
 *   OP-07  Ruta o ausencia               → DependencyResolution       analysis.ts
 *   OP-08  Perfil de prompt              → PromptProfile              generation.ts
 *   OP-09  Fragmento de esquema     (op) → AnalysisSchemaExtension    generation.ts
 *   OP-10  Especificación de artefacto   → ArtifactSpec               materialization.ts
 *   OP-11  Código normalizado            → string                     materialization.ts
 *   OP-12  Lista de incumplimientos      → PreconditionViolation[]    materialization.ts
 *   OP-13  Resultado de compilación (op) → CompilationResult          verification.ts
 *   OP-14  Resultado de ejecución   (op) → TestExecutionResult        verification.ts
 *   OP-15  Informe de cobertura     (op) → CoverageReport             verification.ts
 *   OP-16  Ciclo de vida            (op) → void                       ecosystemAdapter.ts
 *
 * (op) = operación opcional según la columna "Oblig." de la Tabla 10.
 */

export type {
  AdapterDescriptor,
  ApplicabilityResult,
  CapabilityMap,
  OptionalOperation,
} from "./identity";

export type {
  ProjectModel,
  SourceFile,
  SourceRoot,
  SourceRootKind,
} from "./discovery";

export type {
  DependencyResolution,
  SourceText,
  SymbolCandidate,
  SymbolLocation,
} from "./analysis";

export type {
  AnalysisSchemaExtension,
  PromptExtensionPoint,
  PromptProfile,
} from "./generation";

export type {
  ArtifactRequest,
  ArtifactSpec,
  PreconditionViolation,
} from "./materialization";

export type {
  CompilationResult,
  CoverageMetric,
  CoverageReport,
  Diagnostic,
  DiagnosticSeverity,
  FileCoverage,
  TestExecutionResult,
  TestFailure,
} from "./verification";

export type { UnitTarget } from "./target";

export type {
  CompilingAdapter,
  CoverageAdapter,
  EcosystemAdapter,
  SchemaExtendingAdapter,
  TestRunningAdapter,
} from "./ecosystemAdapter";

export {
  supportsCompilation,
  supportsCoverage,
  supportsSchemaExtension,
  supportsTestRun,
} from "./ecosystemAdapter";
