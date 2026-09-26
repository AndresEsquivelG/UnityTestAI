/**
 * Etapa de verificación del núcleo: invoca OP-13 si el adaptador la ofrece,
 * realimenta sus errores al agente de corrección y prepara el resultado para
 * mostrarlo. No nombra ninguna tecnología.
 */

export {
  presentVerification,
  runVerificationStage,
  verificationStageName,
} from "./stage";

export type {
  PresentedDiagnostic,
  VerificationOutcome,
  VerificationPresentation,
} from "./stage";

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
