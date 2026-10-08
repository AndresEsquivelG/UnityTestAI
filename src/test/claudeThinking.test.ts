import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { thinkingFor } from "../llm/claude";

/**
 * Configuración de razonamiento según el modelo de Claude.
 *
 * Con Haiku 4.5 como modelo por defecto, pedir razonamiento adaptativo hacía
 * fallar la primera llamada del pipeline con un 400: ese modelo solo acepta un
 * presupuesto fijo.
 */
describe("razonamiento de Claude según el modelo", () => {
  it("Haiku 4.5 recibe un presupuesto fijo, menor que el máximo de salida", () => {
    const thinking = thinkingFor("claude-haiku-4-5");

    assert.equal(thinking.type, "enabled");
    assert.ok(thinking.type === "enabled" && thinking.budget_tokens < 32000);
  });

  it("también con el identificador fechado de un modelo anterior a la familia 4.6", () => {
    assert.equal(thinkingFor("claude-sonnet-4-5-20250929").type, "enabled");
  });

  it("los modelos con razonamiento adaptativo lo siguen usando", () => {
    for (const model of ["claude-opus-4-8", "claude-sonnet-5", "claude-opus-5", "claude-fable-5-1"]) {
      assert.deepEqual(thinkingFor(model), { type: "adaptive" }, model);
    }
  });
});
