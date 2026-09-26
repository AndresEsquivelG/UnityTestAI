import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdapterRegistry, findCapabilityMismatches } from "../core/adapters";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import { createStubAdapter } from "./support/stubAdapter";

describe("registro de adaptadores", () => {
  it("conserva el orden de alta, que es la preferencia declarada", () => {
    const registry = new AdapterRegistry();
    registry.register(createStubAdapter({ id: "primero" }));
    registry.register(createStubAdapter({ id: "segundo" }));

    assert.deepEqual(
      registry.list().map((adapter) => adapter.descriptor.id),
      ["primero", "segundo"]
    );
  });

  it("recupera un adaptador por su identificador", () => {
    const registry = new AdapterRegistry();
    const adapter = createStubAdapter({ id: "java" });
    registry.register(adapter);

    assert.equal(registry.get("java"), adapter);
    assert.equal(registry.get("python"), undefined);
  });

  it("rechaza dos adaptadores con el mismo identificador", () => {
    const registry = new AdapterRegistry();
    registry.register(createStubAdapter({ id: "unity" }));

    assert.throws(
      () => registry.register(createStubAdapter({ id: "unity", displayName: "Otro" })),
      /ya hay un adaptador registrado/i
    );
  });

  it("rechaza un descriptor sin identificador", () => {
    const registry = new AdapterRegistry();

    assert.throws(
      () => registry.register(createStubAdapter({ id: "  " })),
      /no tiene identificador/i
    );
  });

  describe("invariante entre OP-03 y las operaciones opcionales", () => {
    it("rechaza una capacidad declarada sin la operación", () => {
      const registry = new AdapterRegistry();
      const adapter = createStubAdapter({
        id: "mentiroso",
        capabilities: { runTests: true },
      });

      assert.throws(() => registry.register(adapter), /no implementa runTests\(\)/);
    });

    it("rechaza una operación implementada sin declarar la capacidad", () => {
      const adapter = createStubAdapter({
        id: "callado",
        optional: { collectCoverage: async () => ({ line: { covered: 0, total: 0, percentage: 0 }, byFile: [] }) },
      });

      assert.deepEqual(findCapabilityMismatches(adapter), [
        'implementa collectCoverage() pero no declara la capacidad "coverage"',
      ]);
    });

    it("trata cualquier verificación distinta de none como promesa de OP-13", () => {
      const sinOperacion = createStubAdapter({
        id: "interpretado",
        capabilities: { verification: "importCheck" },
      });

      assert.deepEqual(findCapabilityMismatches(sinOperacion), [
        'declara la capacidad "verification" pero no implementa verifyArtifact()',
      ]);
    });

    it("exige las dos mitades del ciclo de vida", () => {
      const aMedias = createStubAdapter({
        id: "a-medias",
        capabilities: { lifecycle: true },
        optional: { prepare: async () => undefined },
      });

      assert.deepEqual(findCapabilityMismatches(aMedias), [
        'declara la capacidad "lifecycle" pero no implementa cleanup()',
      ]);
    });

    it("ata la detección de dependencias a OP-17 en los dos sentidos", () => {
      const sinOperacion = createStubAdapter({
        id: "promete",
        capabilities: { dependencyDetection: true },
      });
      const sinDeclarar = createStubAdapter({
        id: "calla",
        optional: { detectDependencies: async () => [] },
      });

      assert.deepEqual(findCapabilityMismatches(sinOperacion), [
        'declara la capacidad "dependencyDetection" pero no implementa detectDependencies()',
      ]);
      assert.deepEqual(findCapabilityMismatches(sinDeclarar), [
        'implementa detectDependencies() pero no declara la capacidad "dependencyDetection"',
      ]);
    });

    it("acepta un adaptador coherente", () => {
      const coherente = createStubAdapter({
        id: "coherente",
        capabilities: { verification: "compile" },
        optional: {
          verifyArtifact: async () => ({
            status: "passed",
            diagnostics: [],
            exitCode: 0,
            rawOutput: "",
          }),
        },
      });

      assert.deepEqual(findCapabilityMismatches(coherente), []);
    });
  });

  it("el adaptador de Unity declara capacidades coherentes con lo que implementa", () => {
    // Es lo mínimo de la futura suite de contrato: sin esto, un adaptador que
    // declara una capacidad que no tiene solo falla al invocarla.
    assert.deepEqual(findCapabilityMismatches(new UnityAdapter()), []);
  });
});
