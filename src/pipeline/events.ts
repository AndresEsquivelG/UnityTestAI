import type { VerificationOutcome, VerificationPresentation } from "../core/verification";

/** Llamada al modelo de lenguaje: recibe un prompt y devuelve la respuesta. */
export type Ask = (prompt: string) => Promise<string>;

export type AgentStatus = "running" | "done" | "error";

/** Etapas que corren después de escribir la prueba. */
export type CheckStage = "verification" | "testRun" | "coverage";

/** Dependencia resuelta, tal como se muestra. */
export interface DependencyFileView {
  readonly path: string;
  readonly found: boolean;
  readonly detected: boolean;
}

/** Informe HTML de cobertura escrito junto a la medición. */
export interface CoverageReportFile {
  readonly path: string;
  readonly title: string;
}

/**
 * Avisos del pipeline a quien lo muestra.
 *
 * El pipeline no sabe que hay un panel: avisa qué pasó y el panel decide cómo
 * mostrarlo. Así la misma secuencia corre dentro del editor y en una prueba
 * automática, que solo escucha los avisos.
 */
export type PipelineEvent =
  /** Empezó una generación: lo que mostraba la anterior ya no vale. */
  | { readonly kind: "generationStarted" }
  | {
      readonly kind: "agent";
      readonly agent: string;
      readonly status: AgentStatus;
      readonly detail?: string;
    }
  | { readonly kind: "dependencyFiles"; readonly files: readonly DependencyFileView[] }
  | { readonly kind: "contextSlices"; readonly slices: readonly { readonly filePath: string }[] }
  /** Una etapa va a correr de verdad. Una que no aplica no avisa. */
  | { readonly kind: "stageRunning"; readonly stage: CheckStage; readonly stageName: string }
  /** Resultado de la verificación: intermedio mientras corrige, o final. */
  | { readonly kind: "verification"; readonly presentation: VerificationPresentation }
  /** Estado final de la verificación, del que depende volver a ejecutar. */
  | { readonly kind: "verified"; readonly status: VerificationOutcome["status"] }
  /** La corrección automática reescribió la prueba. */
  | { readonly kind: "testCodeUpdated"; readonly code: string }
  | { readonly kind: "testRun"; readonly presentation: VerificationPresentation }
  | {
      readonly kind: "coverage";
      readonly presentation: VerificationPresentation;
      /** Ausente si no se midió o si no se pudo escribir el informe. */
      readonly report?: CoverageReportFile;
    };
