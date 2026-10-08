import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectEcosystem } from "../core/adapters";
import type { DetectionContext } from "../core/contracts";
import { applicable, createStubAdapter } from "./support/stubAdapter";

const CONTEXT: DetectionContext = { rootPath: "/proyecto" };

describe("selección del ecosistema", () => {
  it("elige la candidata de mayor confianza", async () => {
    const flojo = createStubAdapter({ id: "flojo", detect: applicable(0.4) });
    const seguro = createStubAdapter({ id: "seguro", detect: applicable(0.9, ["marcador"]) });

    const selection = await selectEcosystem([flojo, seguro], CONTEXT);

    assert.ok(selection.selected);
    assert.equal(selection.active.adapter.descriptor.id, "seguro");
    assert.equal(selection.ambiguous, false);
    assert.deepEqual(
      selection.candidates.map((candidate) => candidate.adapter.descriptor.id),
      ["seguro", "flojo"]
    );
  });

  it("a igual confianza gana el registrado primero, y lo señala como ambiguo", async () => {
    const primero = createStubAdapter({ id: "primero", detect: applicable(0.6) });
    const segundo = createStubAdapter({ id: "segundo", detect: applicable(0.6) });

    const selection = await selectEcosystem([primero, segundo], CONTEXT);

    assert.ok(selection.selected);
    assert.equal(selection.active.adapter.descriptor.id, "primero");
    assert.equal(selection.ambiguous, true);
  });

  it("conserva la raíz con la que se detectó, para pasarla a OP-04", async () => {
    const adapter = createStubAdapter({ id: "unico", detect: applicable(0.5) });

    const selection = await selectEcosystem([adapter], { rootPath: "/otro/sitio" });

    assert.ok(selection.selected);
    assert.equal(selection.active.rootPath, "/otro/sitio");
  });

  it("no elige nada cuando ningún adaptador reclama el proyecto", async () => {
    const ajeno = createStubAdapter({ id: "ajeno" });

    const selection = await selectEcosystem([ajeno], CONTEXT);

    if (selection.selected) {
      assert.fail("no debería haber elegido un ecosistema");
    }
    assert.deepEqual(
      selection.rejected.map((entry) => entry.adapter.descriptor.id),
      ["ajeno"]
    );
  });

  it("no elige nada cuando no hay adaptadores registrados", async () => {
    const selection = await selectEcosystem([], CONTEXT);

    if (selection.selected) {
      assert.fail("no debería haber elegido un ecosistema");
    }
    assert.deepEqual(selection.rejected, []);
  });

  it("descarta al adaptador que lanza sin perder a los demás", async () => {
    const roto = createStubAdapter({ id: "roto", detect: new Error("disco ilegible") });
    const sano = createStubAdapter({ id: "sano", detect: applicable(0.7) });

    const selection = await selectEcosystem([roto, sano], CONTEXT);

    assert.ok(selection.selected);
    assert.equal(selection.active.adapter.descriptor.id, "sano");
    assert.deepEqual(
      selection.rejected.map((entry) => ({
        id: entry.adapter.descriptor.id,
        error: entry.error,
      })),
      [{ id: "roto", error: "disco ilegible" }]
    );
  });

  it("conserva la evidencia de quien se declaró no aplicable", async () => {
    const casi = createStubAdapter({
      id: "casi",
      detect: {
        applicable: false,
        confidence: 0,
        evidence: ["encontró la carpeta pero no el manifiesto"],
      },
    });

    const selection = await selectEcosystem([casi], CONTEXT);

    if (selection.selected) {
      assert.fail("no debería haber elegido un ecosistema");
    }
    assert.deepEqual(selection.rejected[0].evidence, [
      "encontró la carpeta pero no el manifiesto",
    ]);
  });
});
