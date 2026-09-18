import type { CapabilityMap, EcosystemAdapter } from "../contracts";

/**
 * Comprobación del invariante entre OP-03 y las operaciones opcionales.
 *
 * La interfaz declara cada operación opcional dos veces: como miembro opcional
 * del objeto y como clave del mapa de capacidades. El sistema de tipos no puede
 * exigir que ambas coincidan, así que la divergencia solo aparece en ejecución,
 * y de dos formas igual de malas: una capacidad declarada sin la operación hace
 * que el núcleo invoque `undefined`, y una operación presente sin declarar hace
 * que el núcleo omita una etapa que sí estaba disponible.
 *
 * El momento de comprobarlo es el alta en el registro, que es el único punto
 * donde el objeto y su declaración están los dos a la vista. Esto no sustituye a
 * la futura suite de contrato: esa comprueba lo que cada adaptador promete, esta
 * solo impide que un adaptador incoherente llegue a la selección.
 */

/** Correspondencia entre una clave del mapa y las operaciones que promete. */
interface CapabilityBinding {
  readonly capability: keyof CapabilityMap;
  readonly declared: (capabilities: CapabilityMap) => boolean;
  readonly operations: readonly (keyof EcosystemAdapter)[];
}

const BINDINGS: readonly CapabilityBinding[] = [
  {
    capability: "verification",
    // No es un booleano: cualquier clase de verificación distinta de "none"
    // obliga a implementar OP-13.
    declared: (capabilities) => capabilities.verification !== "none",
    operations: ["verifyArtifact"],
  },
  {
    capability: "runTests",
    declared: (capabilities) => capabilities.runTests,
    operations: ["runTests"],
  },
  {
    capability: "coverage",
    declared: (capabilities) => capabilities.coverage,
    operations: ["collectCoverage"],
  },
  {
    capability: "analysisSchemaExtension",
    declared: (capabilities) => capabilities.analysisSchemaExtension,
    operations: ["extendAnalysisSchema"],
  },
  {
    // Una sola capacidad que promete las dos mitades del ciclo de vida: sin
    // ambas, el núcleo no puede garantizar la limpieza tras un fallo.
    capability: "lifecycle",
    declared: (capabilities) => capabilities.lifecycle,
    operations: ["prepare", "cleanup"],
  },
];

/**
 * Devuelve una descripción por cada divergencia encontrada, y la lista vacía
 * cuando el adaptador es coherente.
 */
export function findCapabilityMismatches(adapter: EcosystemAdapter): readonly string[] {
  const mismatches: string[] = [];

  for (const binding of BINDINGS) {
    const declared = binding.declared(adapter.capabilities);

    for (const operation of binding.operations) {
      const implemented = typeof adapter[operation] === "function";
      if (declared === implemented) {
        continue;
      }
      mismatches.push(
        declared
          ? `declara la capacidad "${binding.capability}" pero no implementa ${operation}()`
          : `implementa ${operation}() pero no declara la capacidad "${binding.capability}"`
      );
    }
  }

  return mismatches;
}
