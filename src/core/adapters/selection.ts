import type {
  ApplicabilityResult,
  DetectionContext,
  EcosystemAdapter,
} from "../contracts";

/**
 * Selección del ecosistema activo — consume OP-02.
 *
 * Recibe la lista de adaptadores como parámetro y no un registro, para que se
 * pueda ejercitar con adaptadores inventados sin dar nada de alta.
 *
 * No consulta un solo identificador de ecosistema: pregunta a cada adaptador si
 * reconoce el proyecto y ordena las respuestas por confianza. Añadir un
 * ecosistema no toca este archivo.
 */

/** Adaptador que reclamó el proyecto, con la evidencia que lo sustenta. */
export interface EcosystemCandidate {
  readonly adapter: EcosystemAdapter;
  readonly applicability: ApplicabilityResult;
}

/** Adaptador que no reclamó el proyecto, con el motivo, para diagnóstico. */
export interface RejectedEcosystem {
  readonly adapter: EcosystemAdapter;
  /** Marcadores que sí encontró, cuando encontró alguno. */
  readonly evidence: readonly string[];
  /** Mensaje del fallo cuando la detección lanzó en lugar de responder. */
  readonly error?: string;
}

/** Ecosistema elegido y raíz desde la que se detectó. */
export interface ActiveEcosystem {
  readonly adapter: EcosystemAdapter;
  readonly applicability: ApplicabilityResult;
  /**
   * Raíz con la que se detectó el ecosistema. Viaja con la elección porque es
   * la misma que hay que pasar a OP-04: el adaptador puede reanclar el modelo
   * a partir de ella, y el núcleo no debe recalcularla por su cuenta.
   */
  readonly rootPath: string;
}

export type EcosystemSelection =
  | {
      readonly selected: true;
      readonly active: ActiveEcosystem;
      /** Todas las candidatas aplicables, de mayor a menor confianza. */
      readonly candidates: readonly [EcosystemCandidate, ...EcosystemCandidate[]];
      /**
       * Dos candidatas o más empataron en la confianza más alta. La elección
       * sigue siendo determinista, pero es el caso en el que corresponde
       * preguntar a la persona usuaria en lugar de decidir por ella.
       */
      readonly ambiguous: boolean;
      readonly rejected: readonly RejectedEcosystem[];
    }
  | {
      readonly selected: false;
      /** Todos los adaptadores consultados, ninguno aplicable. */
      readonly rejected: readonly RejectedEcosystem[];
    };

export async function selectEcosystem(
  adapters: readonly EcosystemAdapter[],
  context: DetectionContext
): Promise<EcosystemSelection> {
  const candidates: EcosystemCandidate[] = [];
  const rejected: RejectedEcosystem[] = [];

  for (const adapter of adapters) {
    let applicability: ApplicabilityResult;
    try {
      applicability = await adapter.detectApplicability(context);
    } catch (error) {
      // El contrato pide que OP-02 no lance, pero el registro es un punto de
      // extensión: un adaptador que incumple se descarta y se anota, en lugar
      // de tumbar la detección de los demás.
      rejected.push({
        adapter,
        evidence: [],
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (applicability.applicable) {
      candidates.push({ adapter, applicability });
    } else {
      rejected.push({ adapter, evidence: applicability.evidence });
    }
  }

  if (candidates.length === 0) {
    return { selected: false, rejected };
  }

  // Orden estable: a igual confianza gana el que se registró primero, que es la
  // preferencia que declaró quien compuso el registro.
  const ordered = [...candidates].sort(
    (a, b) => b.applicability.confidence - a.applicability.confidence
  );

  const [best, ...rest] = ordered;
  const ambiguous =
    rest.length > 0 && rest[0].applicability.confidence === best.applicability.confidence;

  return {
    selected: true,
    active: {
      adapter: best.adapter,
      applicability: best.applicability,
      rootPath: context.rootPath,
    },
    candidates: [best, ...rest],
    ambiguous,
    rejected,
  };
}
