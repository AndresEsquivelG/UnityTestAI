/**
 * Pipeline de generación: la secuencia que encadena el adaptador, los agentes
 * y las etapas del núcleo, sin depender del editor.
 *
 * Quien lo muestra —el panel, o una prueba automática— le pasa la llamada al
 * modelo y escucha sus avisos. Punto de entrada único.
 */

export { generateTest } from "./generate";
export type { EditorSelection, GeneratedTest, GenerationRequest } from "./generate";

export { checkGeneratedTest, runAndMeasure } from "./check";
export type { CheckRequest, RunRequest } from "./check";

export type {
  AgentStatus,
  Ask,
  CheckStage,
  CoverageReportFile,
  DependencyFileView,
  PipelineEvent,
} from "./events";
