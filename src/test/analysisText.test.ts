import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCodeAnalysis } from "../agents/analysisText";
import type { CodeAnalyzerOutput } from "../agents/codeAnalyzer";
import { unityAnalysisSchema } from "../adapters/unity/analysisSchema";
import { assertPromptSnapshot } from "./support/snapshot";
import { FULL_ANALYSIS, NEUTRAL_ANALYSIS } from "./support/analysisFixture";

/**
 * Foto de la presentación del análisis.
 *
 * Este texto entra en el prompt del generador por el marcador `{codeAnalysis}`,
 * y la foto de los prompts **no lo cubre**: aquella usa un análisis ya
 * formateado, escrito a mano. Sin esta foto, repartir la presentación entre
 * núcleo y adaptador cambiaría lo que ve el modelo sin que nada fallara.
 */
describe("presentación del análisis", () => {
  it("presenta un análisis completo, núcleo más adaptador", () => {
    // La foto se tomó cuando esto era una función sola. Que siga igual después
    // de repartirla entre el núcleo y OP-09 es la prueba de que el reparto fue
    // exacto.
    assertPromptSnapshot(
      "codeAnalysis",
      formatCodeAnalysis(FULL_ANALYSIS as CodeAnalyzerOutput, unityAnalysisSchema().format)
    );
  });

  it("se sostiene sin adaptador que extienda el esquema", () => {
    // Es el camino de la capacidad ausente: sin OP-09 no hay quien presente los
    // cuatro apartados del ecosistema, y el texto tiene que seguir siendo
    // válido igual.
    assertPromptSnapshot(
      "codeAnalysis.soloNeutro",
      formatCodeAnalysis(NEUTRAL_ANALYSIS as CodeAnalyzerOutput)
    );
  });

  it("devuelve la cadena vacía cuando el análisis falló", () => {
    const failed = { status: "ERROR", message: "no se pudo analizar" };

    assert.equal(formatCodeAnalysis(failed as CodeAnalyzerOutput), "");
  });
});
