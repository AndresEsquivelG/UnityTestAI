/**
 * Etapas de verificación, ejecución y cobertura del núcleo: invocan OP-13,
 * OP-14 y OP-15 si el adaptador las ofrece, realimentan los errores de la
 * verificación al agente de corrección y preparan los resultados para
 * mostrarlos. No nombran ninguna tecnología.
 */

export {
  presentVerification,
  runVerificationStage,
  verificationStageName,
} from "./stage";

export type {
  PresentedDiagnostic,
  PresentedTestCase,
  VerificationOutcome,
  VerificationPresentation,
} from "./stage";

export {
  TEST_RUN_STAGE_NAME,
  presentTestRun,
  runTestStage,
} from "./execution";

export type { TestRunOutcome } from "./execution";

export {
  COVERAGE_STAGE_NAME,
  describeMetric,
  formatPercentage,
  presentCoverage,
  runCoverageStage,
} from "./coverage";

export type { CoverageOutcome } from "./coverage";

export {
  COVERAGE_DATA_MARKER,
  buildCoverageDocument,
  renderCoverageDocument,
} from "./coverageDocument";

export type { CoverageDocument, CoverageDocumentFile } from "./coverageDocument";

export {
  MAX_REPAIR_CYCLES,
  artifactErrors,
  describeForFixer,
  presentRepairProgress,
  presentRepairResult,
  verifyAndRepair,
} from "./repair";

export type {
  RepairCycle,
  RepairEvent,
  RepairOptions,
  RepairReply,
  RepairRequest,
  RepairResult,
  RepairStop,
  TokenUsage,
} from "./repair";
