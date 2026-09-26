/**
 * Etapa de verificación del núcleo: invoca OP-13 si el adaptador la ofrece y
 * prepara el resultado para mostrarlo. No nombra ninguna tecnología.
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
