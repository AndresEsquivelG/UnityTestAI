/**
 * Registro y selección de adaptadores.
 *
 * Punto de entrada único: el resto del núcleo importa de "core/adapters" y la
 * composición del registro ocurre una sola vez, en el arranque de la extensión.
 */

export { AdapterRegistry } from "./registry";
export { findCapabilityMismatches } from "./capabilityConsistency";
export { selectEcosystem } from "./selection";

export type {
  ActiveEcosystem,
  EcosystemCandidate,
  EcosystemSelection,
  RejectedEcosystem,
} from "./selection";
