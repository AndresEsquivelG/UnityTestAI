import type { EcosystemAdapter } from "../contracts";
import { findCapabilityMismatches } from "./capabilityConsistency";

/**
 * Registro de adaptadores de ecosistema.
 *
 * Es la única lista de adaptadores del sistema, y el orden en que se dan de
 * alta es significativo: la selección lo usa para desempatar cuando dos
 * adaptadores reclaman el mismo proyecto con la misma confianza. Quien compone
 * el registro decide así la preferencia, sin que la selección tenga que conocer
 * ningún ecosistema.
 *
 * El registro no detecta ni elige: eso es `selectEcosystem`, que recibe la
 * lista como parámetro para poder ejercitarse sin registro alguno.
 */
export class AdapterRegistry {
  private readonly adapters: EcosystemAdapter[] = [];

  /**
   * Da de alta un adaptador.
   *
   * Rechaza el alta en dos casos, los dos en el momento de composición y no en
   * medio de una corrida:
   *
   *   · identificador repetido, porque el segundo adaptador taparía al primero
   *     sin que nada lo indique, y el identificador es la clave con la que se
   *     recupera y se presenta;
   *   · capacidades incoherentes con las operaciones implementadas, porque el
   *     núcleo decide qué etapas omite leyendo esa declaración.
   */
  register(adapter: EcosystemAdapter): void {
    const { id } = adapter.descriptor;

    if (!id.trim()) {
      throw new Error("El descriptor del adaptador no tiene identificador.");
    }

    if (this.get(id)) {
      throw new Error(`Ya hay un adaptador registrado con el identificador "${id}".`);
    }

    const mismatches = findCapabilityMismatches(adapter);
    if (mismatches.length > 0) {
      throw new Error(
        `El adaptador "${id}" es incoherente: ${mismatches.join("; ")}.`
      );
    }

    this.adapters.push(adapter);
  }

  /** Recupera un adaptador por su identificador. */
  get(id: string): EcosystemAdapter | undefined {
    return this.adapters.find((adapter) => adapter.descriptor.id === id);
  }

  /** Adaptadores dados de alta, en orden de registro. */
  list(): readonly EcosystemAdapter[] {
    return [...this.adapters];
  }
}
