import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCodeAnalyzerSchema } from "../agents/codeAnalyzer";
import { unityAnalysisSchema } from "../adapters/unity/analysisSchema";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import { supportsSchemaExtension } from "../core/contracts";
import { createStubAdapter } from "./support/stubAdapter";
import { FULL_ANALYSIS, NEUTRAL_ANALYSIS } from "./support/analysisFixture";

/**
 * OP-09 — fusión del esquema del análisis.
 *
 * El núcleo define los apartados comunes y el adaptador agrega los suyos. Lo que
 * se comprueba aquí es que la fusión sirva de verdad: que el esquema resultante
 * acepte lo que el adaptador declaró, que sin adaptador esos campos no pasen, y
 * que el núcleo no valide valores que no puede conocer.
 */
describe("extensión del esquema de análisis", () => {
  const extension = unityAnalysisSchema();

  describe("con la extensión del adaptador", () => {
    const schema = buildCodeAnalyzerSchema(extension.fields);

    it("acepta el análisis completo", () => {
      const parsed = schema.parse(FULL_ANALYSIS) as typeof FULL_ANALYSIS;

      assert.deepEqual(parsed.startAwakeFields, FULL_ANALYSIS.startAwakeFields);
      assert.deepEqual(parsed.requiredUsings, FULL_ANALYSIS.requiredUsings);
      assert.equal(parsed.preFlightChecklist.typeInstantiations.length, 3);
    });

    it("sigue validando los campos que agregó el adaptador", () => {
      // La extensión no afloja el esquema: `initIn` es una enumeración cerrada
      // del adaptador, y un valor fuera de ella se rechaza.
      const roto = {
        ...FULL_ANALYSIS,
        startAwakeFields: [{ name: "speed", type: "float", initIn: "OnEnable" }],
      };

      assert.throws(() => schema.parse(roto));
    });
  });

  describe("sin extensión", () => {
    const schema = buildCodeAnalyzerSchema();

    it("descarta los campos del ecosistema en lugar de fallar", () => {
      // Es el camino de la capacidad ausente: el adaptador no los declaró, así
      // que el núcleo no los conoce y no los transporta. La corrida sigue.
      const parsed = schema.parse(FULL_ANALYSIS) as Record<string, unknown>;

      assert.equal(parsed.startAwakeFields, undefined);
      assert.equal(parsed.requiredUsings, undefined);
      assert.equal(parsed.preFlightChecklist, undefined);
    });

    it("conserva los apartados comunes", () => {
      const parsed = schema.parse(NEUTRAL_ANALYSIS) as Record<string, any>;

      assert.equal(parsed.methodSummary.name, "Move");
      assert.equal(parsed.decisionTable.length, 2);
      // `untestableBranches` se quedó en el núcleo: es opcional y este análisis
      // no lo trae, pero el esquema lo admite igual.
      assert.equal(parsed.untestableBranches, undefined);
    });
  });

  it("admite una clase de miembro que el núcleo no puede conocer", () => {
    // `unityMessage` es de Unity y el núcleo ya no lo enumera. Es el motivo por
    // el que `kind` pasó a texto libre.
    const parsed = buildCodeAnalyzerSchema().parse(NEUTRAL_ANALYSIS) as typeof NEUTRAL_ANALYSIS;

    assert.deepEqual(
      parsed.privateMembers.map((member) => member.kind),
      ["field", "nestedType", "unityMessage"]
    );
  });

  describe("guarda de capacidad", () => {
    it("reconoce al adaptador que extiende el esquema", () => {
      assert.equal(supportsSchemaExtension(new UnityAdapter()), true);
    });

    it("no reclama la operación a quien no la declara", () => {
      assert.equal(supportsSchemaExtension(createStubAdapter({ id: "pelado" })), false);
    });
  });
});
