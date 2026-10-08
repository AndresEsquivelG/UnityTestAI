import type {
  ArtifactSpec,
  Diagnostic,
  EcosystemAdapter,
  ProjectModel,
  VerificationKind,
} from "../contracts";
import { artifactRelativePath, readArtifact, writeArtifact } from "../project";
import {
  plural,
  presentVerification,
  runVerificationStage,
  type VerificationOutcome,
  type VerificationPresentation,
} from "./stage";

/**
 * Corrección automática a partir de los diagnósticos de la verificación.
 *
 * Cuando la verificación rechaza la prueba, los errores que caen dentro de la
 * prueba se le pasan al agente de corrección, la corrección se escribe y se
 * vuelve a verificar. Antes, la persona usuaria tenía que copiar los errores
 * del panel y pegarlos en el chat.
 *
 * Vive fuera del panel para que se pueda probar sin el editor, y no conoce al
 * agente: lo recibe como función. Tampoco nombra ninguna tecnología: trabaja
 * con los diagnósticos normalizados de OP-13, que tienen la misma forma en
 * todos los ecosistemas.
 */

/**
 * Ciclos de corrección como máximo por verificación.
 *
 * Más de uno porque una herramienta no siempre informa todos los errores de
 * una vez: hay compiladores que callan algunos hasta que se arreglan los que
 * los tapan, y una comprobación de importabilidad se detiene en el primero.
 * Pocos, porque cada ciclo cuesta una llamada al modelo que devuelve el
 * archivo entero más una verificación completa. Si una corrección deja los
 * mismos errores, el ciclo se corta antes (`noProgress`).
 */
export const MAX_REPAIR_CYCLES = 3;

/**
 * Errores que se le pasan al corrector como máximo. Un archivo roto de raíz
 * puede producir cientos de errores en cascada que no le agregan nada.
 */
const MAX_FED_ERRORS = 20;

/** Por qué terminó la corrección automática. */
export type RepairStop =
  /** La prueba pasó la verificación, con o sin correcciones. */
  | "passed"
  /** La herramienta no llegó a correr: no hay diagnósticos que realimentar. */
  | "notRun"
  /** El ecosistema no ofrece verificación. */
  | "notApplicable"
  /** Quedan errores, pero ninguno dentro de la prueba: corregirla no los arregla. */
  | "outsideArtifact"
  /** El corrector no devolvió una corrección, o falló al pedírsela. */
  | "notFixed"
  /** El corrector devolvió la prueba tal como estaba. */
  | "unchanged"
  /** Después de corregir, la verificación dio los mismos errores. */
  | "noProgress"
  /** Se agotaron los ciclos. */
  | "limit";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Lo que recibe el agente de corrección en cada ciclo. */
export interface RepairRequest {
  /** Número de ciclo, desde 1. */
  readonly cycle: number;
  /** La prueba tal como se verificó, leída del disco. */
  readonly code: string;
  /** Los errores redactados para el modelo (ver `describeForFixer`). */
  readonly feedback: string;
}

export type RepairReply =
  | {
      readonly status: "fixed";
      /** El archivo completo corregido, todavía sin normalizar. */
      readonly code: string;
      readonly summary?: string;
      readonly usage?: TokenUsage;
    }
  | {
      readonly status: "notFixed";
      readonly reason: string;
      readonly usage?: TokenUsage;
    };

/** Registro de un ciclo, para la presentación y para medir. */
export interface RepairCycle {
  readonly cycle: number;
  /** Errores de la prueba que se le pasaron al corrector. */
  readonly errors: readonly Diagnostic[];
  readonly fixer: "fixed" | "notFixed" | "unchanged";
  /** Resumen de la corrección, o por qué no la hubo. */
  readonly detail?: string;
  /** Estado de la verificación que siguió; ausente si no se escribió nada. */
  readonly verification?: VerificationOutcome["status"];
  readonly fixMs: number;
  readonly verifyMs?: number;
  readonly usage?: TokenUsage;
}

export interface RepairResult {
  /** Estado de la primera verificación, antes de corregir nada. */
  readonly initialStatus: VerificationOutcome["status"];
  /** La última verificación. Describe la prueba que quedó en disco. */
  readonly outcome: VerificationOutcome;
  readonly stop: RepairStop;
  readonly cycles: readonly RepairCycle[];
  readonly maxCycles: number;
}

/** Avisos para que la interfaz muestre el avance mientras el ciclo corre. */
export type RepairEvent =
  | { readonly kind: "verifying"; readonly cycle: number }
  | {
      readonly kind: "fixing";
      readonly cycle: number;
      readonly maxCycles: number;
      /** La verificación cuyos errores se van a corregir. */
      readonly outcome: VerificationOutcome;
    }
  | { readonly kind: "fixed"; readonly cycle: number; readonly code: string; readonly summary?: string }
  | { readonly kind: "notFixed"; readonly cycle: number; readonly reason: string };

export interface RepairOptions {
  readonly adapter: EcosystemAdapter;
  readonly project: ProjectModel;
  readonly spec: ArtifactSpec;
  /** El agente de corrección. Si lanza, el ciclo termina como `notFixed`. */
  readonly fix: (request: RepairRequest) => Promise<RepairReply>;
  readonly onEvent?: (event: RepairEvent) => void;
  readonly maxCycles?: number;
}

/**
 * Verifica el artefacto escrito y, mientras la verificación lo rechace con
 * errores dentro de la prueba, se los pasa al corrector y vuelve a verificar.
 *
 * Cada corrección pasa por OP-11 antes de escribirse, igual que el código del
 * generador: si el modelo renombró la clase, el archivo y la unidad dejarían
 * de llamarse igual.
 */
export async function verifyAndRepair(options: RepairOptions): Promise<RepairResult> {
  const { adapter, project, spec, fix } = options;
  const onEvent = options.onEvent ?? (() => undefined);
  const maxCycles = options.maxCycles ?? MAX_REPAIR_CYCLES;
  const kind = adapter.capabilities.verification;
  const cycles: RepairCycle[] = [];

  onEvent({ kind: "verifying", cycle: 0 });
  let outcome = await runVerificationStage(adapter, project, spec);
  const initialStatus = outcome.status;
  let previousErrors: readonly Diagnostic[] | undefined;

  const finish = (stop: RepairStop): RepairResult => ({
    initialStatus,
    outcome,
    stop,
    cycles,
    maxCycles,
  });

  for (let cycle = 1; ; cycle++) {
    if (outcome.status !== "failed") {
      return finish(outcome.status);
    }
    const errors = artifactErrors(outcome.diagnostics, spec);
    if (errors.length === 0) {
      return finish("outsideArtifact");
    }
    if (previousErrors && sameErrors(errors, previousErrors)) {
      return finish("noProgress");
    }
    if (cycle > maxCycles) {
      return finish("limit");
    }

    onEvent({ kind: "fixing", cycle, maxCycles, outcome });
    const code = await readArtifact(project, spec);
    const fixStart = Date.now();
    const reply = await askFixer(fix, {
      cycle,
      code,
      feedback: describeForFixer(kind, errors, code),
    });
    const fixMs = Date.now() - fixStart;

    if (reply.status === "notFixed") {
      cycles.push({ cycle, errors, fixer: "notFixed", detail: reply.reason, fixMs, usage: reply.usage });
      onEvent({ kind: "notFixed", cycle, reason: reply.reason });
      return finish("notFixed");
    }

    const corrected = adapter.normalizeGeneratedCode(reply.code, spec);
    if (sameText(corrected, code)) {
      cycles.push({ cycle, errors, fixer: "unchanged", detail: reply.summary, fixMs, usage: reply.usage });
      onEvent({ kind: "notFixed", cycle, reason: "devolvió la prueba sin cambios" });
      return finish("unchanged");
    }

    await writeArtifact(project, spec, corrected);
    onEvent({ kind: "fixed", cycle, code: corrected, summary: reply.summary });

    onEvent({ kind: "verifying", cycle });
    const verifyStart = Date.now();
    outcome = await runVerificationStage(adapter, project, spec);
    cycles.push({
      cycle,
      errors,
      fixer: "fixed",
      detail: reply.summary,
      verification: outcome.status,
      fixMs,
      verifyMs: Date.now() - verifyStart,
      usage: reply.usage,
    });
    previousErrors = errors;
  }
}

async function askFixer(
  fix: RepairOptions["fix"],
  request: RepairRequest
): Promise<RepairReply> {
  try {
    return await fix(request);
  } catch (error) {
    // La prueba ya está escrita y verificada: que falle la llamada al modelo
    // no justifica perder la corrida.
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "notFixed", reason: `falló la llamada al corrector: ${reason}` };
  }
}

/**
 * Errores que caen dentro de la prueba generada, los únicos que el corrector
 * puede arreglar. Los del resto del proyecto también impiden verificar, pero
 * reescribir la prueba no los toca.
 */
export function artifactErrors(
  diagnostics: readonly Diagnostic[],
  spec: ArtifactSpec
): Diagnostic[] {
  const artifactPath = artifactRelativePath(spec);
  return diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error" && samePath(diagnostic.filePath, artifactPath)
  );
}

const TOOL_BY_KIND: Record<VerificationKind, string> = {
  compile: "compiler",
  importCheck: "import check",
  none: "verification",
};

/**
 * Los errores redactados para el agente de corrección.
 *
 * Cada error lleva debajo la línea de código a la que apunta: los modelos
 * cuentan mal las líneas, y sin ella tendrían que ubicar el error contando.
 * El texto va en inglés, como las plantillas.
 */
export function describeForFixer(
  kind: VerificationKind,
  errors: readonly Diagnostic[],
  code: string
): string {
  const sourceLines = code.split(/\r?\n/);
  const shown = errors.slice(0, MAX_FED_ERRORS).map((diagnostic) => {
    const column = diagnostic.column === undefined ? "" : `:${diagnostic.column}`;
    const errorCode = diagnostic.code ? ` ${diagnostic.code}` : "";
    const header = `${diagnostic.filePath}:${diagnostic.line}${column}: error${errorCode}: ${diagnostic.message}`;
    const source = sourceLines[diagnostic.line - 1];
    return source === undefined ? header : `${header}\n  ${diagnostic.line} | ${source.trimEnd()}`;
  });

  const hidden = errors.length - shown.length;
  if (hidden > 0) {
    shown.push(`(${hidden} more ${hidden === 1 ? "error" : "errors"} not shown)`);
  }

  return [
    `The ${TOOL_BY_KIND[kind]} rejected the test file with ${countErrors(errors.length)}. ` +
      "Line and column numbers refer to the current test code.",
    shown.join("\n\n"),
    "Fix every error listed above and return the complete corrected file.",
  ].join("\n\n");
}

function countErrors(count: number): string {
  return `${count} ${count === 1 ? "error" : "errors"}`;
}

/** Resultado intermedio: la verificación que se está corrigiendo. */
export function presentRepairProgress(
  kind: VerificationKind,
  outcome: VerificationOutcome,
  cycle: number,
  maxCycles: number
): VerificationPresentation {
  return {
    ...presentVerification(kind, outcome),
    note: `Corrigiendo automáticamente: intento ${cycle} de ${maxCycles}…`,
    inProgress: true,
  };
}

/** Resultado final, con lo que hizo la corrección automática. */
export function presentRepairResult(
  kind: VerificationKind,
  result: RepairResult
): VerificationPresentation {
  const presented = presentVerification(kind, result.outcome);
  const note = repairNote(result);
  const remediation = presented.remediation ?? repairRemediation(result.stop);
  return {
    ...presented,
    ...(note === undefined ? {} : { note }),
    ...(remediation === undefined ? {} : { remediation }),
  };
}

function repairNote(result: RepairResult): string | undefined {
  const applied = result.cycles.filter((cycle) => cycle.fixer === "fixed").length;
  const corrections = plural(applied, "corrección automática", "correcciones automáticas");
  const last = result.cycles[result.cycles.length - 1];

  switch (result.stop) {
    case "passed":
      return applied === 0 ? undefined : `Pasó después de ${corrections}.`;
    case "notRun":
      return applied === 0 ? undefined : "La última corrección automática quedó escrita sin verificar.";
    case "notApplicable":
      return undefined;
    case "outsideArtifact":
      return "Los errores que quedan están fuera de la prueba generada, y la corrección automática solo modifica la prueba.";
    case "notFixed":
      return `El corrector no devolvió una corrección: ${last?.detail ?? "sin motivo"}`;
    case "unchanged":
      return "El corrector devolvió la prueba sin cambios.";
    case "noProgress":
      return "La última corrección automática no resolvió estos errores.";
    case "limit":
      return applied === 0 ? undefined : `Siguen quedando errores después de ${corrections}.`;
  }
}

function repairRemediation(stop: RepairStop): string | undefined {
  switch (stop) {
    case "outsideArtifact":
      return "Corregí esos errores en el proyecto y volvé a intentar.";
    case "notFixed":
    case "unchanged":
    case "noProgress":
    case "limit":
      return "Describí el problema en el chat o corregí la prueba a mano, y volvé a intentar.";
    default:
      return undefined;
  }
}

/** La misma lista de errores, sin mirar la línea: una corrección los mueve de lugar. */
function sameErrors(a: readonly Diagnostic[], b: readonly Diagnostic[]): boolean {
  const key = (diagnostics: readonly Diagnostic[]) =>
    diagnostics
      .map((diagnostic) => `${diagnostic.code ?? ""}|${diagnostic.message}`)
      .sort()
      .join("\n");
  return key(a) === key(b);
}

/** El mismo texto, sin mirar los finales de línea ni los espacios de los extremos. */
function sameText(a: string, b: string): boolean {
  const canonical = (text: string) => text.replace(/\r\n/g, "\n").trim();
  return canonical(a) === canonical(b);
}

/**
 * En Windows y macOS el sistema de archivos no distingue mayúsculas, y hay
 * herramientas que no las respetan al informar la ruta.
 */
function samePath(a: string, b: string): boolean {
  if (process.platform === "win32" || process.platform === "darwin") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}
