/**
 * Etapas de verificación y de ejecución del núcleo: invocan OP-13 y OP-14 si
 * el adaptador las ofrece, realimentan los errores de la verificación al
 * agente de corrección y preparan los resultados para mostrarlos. No nombran
 * ninguna tecnología.
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
