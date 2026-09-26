/**
 * Contrato de adaptación del núcleo.
 *
 * Punto de entrada único: el núcleo importa de "core/contracts" y nunca de un
 * módulo de adaptador.
 *
 * Correspondencia entre las operaciones de la interfaz y sus tipos:
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
 *   OP-13  Resultado de verificación(op) → VerificationResult         verification.ts
 *   OP-14  Resultado de ejecución   (op) → TestExecutionResult        verification.ts
 *   OP-15  Informe de cobertura     (op) → CoverageReport             verification.ts
 *   OP-16  Ciclo de vida            (op) → void                       ecosystemAdapter.ts
 *   OP-17  Dependencias detectadas  (op) → string[]                   ecosystemAdapter.ts
 *
 * (op) = operación opcional: el adaptador puede no implementarla.
 *
 * OP-17 no está en la tabla de operaciones original: allí la identificación de
 * las dependencias es del agente resolutor, y el adaptador solo las traduce a
 * rutas (OP-07). Se agregó porque el agente omite tipos del proyecto; ver la
 * justificación en `EcosystemAdapter.detectDependencies`.
 *
 * OP-13 se nombra verificación y no compilación porque en un ecosistema
 * interpretado la etapa equivalente comprueba sintaxis e importabilidad; qué
 * clase de verificación ofrece cada adaptador lo declara
 * `CapabilityMap.verification`.
 */

export type {
  AdapterDescriptor,
  ApplicabilityResult,
  CapabilityMap,
  DetectionContext,
  OptionalOperation,
  VerificationKind,
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
  PromptVocabulary,
} from "./generation";

export type {
  ArtifactRequest,
  ArtifactSpec,
  PreconditionViolation,
} from "./materialization";

export type {
  CoverageMetric,
  CoverageReport,
  Diagnostic,
  DiagnosticSeverity,
  FileCoverage,
  TestExecutionResult,
  TestFailure,
  VerificationFailed,
  VerificationNotRun,
  VerificationPassed,
  VerificationResult,
} from "./verification";

export type { UnitTarget } from "./target";

export type {
  CoverageAdapter,
  DependencyDetectingAdapter,
  EcosystemAdapter,
  SchemaExtendingAdapter,
  TestRunningAdapter,
  VerifyingAdapter,
} from "./ecosystemAdapter";

export {
  supportsCoverage,
  supportsDependencyDetection,
  supportsSchemaExtension,
  supportsTestRun,
  supportsVerification,
} from "./ecosystemAdapter";
