import type { PromptProfile } from "../../../core/contracts";
import { CHAT_FIXER_FRAGMENTS } from "./chatFixer";
import { CODE_ANALYZER_FRAGMENTS } from "./codeAnalyzer";
import { CONTEXT_BUILDER_FRAGMENTS } from "./contextBuilder";
import { DEPENDENCY_RESOLVER_FRAGMENTS } from "./dependencyResolver";
import { METHOD_SLICER_FRAGMENTS } from "./methodSlicer";
import { TEST_GENERATOR_FRAGMENTS } from "./testGenerator";
import { TEST_VALIDATOR_FRAGMENTS } from "./testValidator";
import { pythonVocabulary } from "./vocabulary";

/**
 * OP-08 — Perfil de prompt del ecosistema Python, con pytest.
 *
 * Junta el vocabulario, que comparten varias plantillas, y los fragmentos de
 * cada una, que viven en un archivo por plantilla y en el orden del pipeline,
 * como en Java. Cada fragmento lo pide una sola plantilla, así que repartirlos
 * así no duplica nada.
 *
 * El validador de contexto no tiene archivo: su plantilla solo usa el
 * vocabulario.
 *
 * No depende del proyecto, a diferencia del de Java: lo que cambia de un
 * proyecto a otro, la carpeta desde la que se importa, lo dice la ficha de la
 * clase, porque la línea de `import` es de cada unidad.
 */
export function pythonPromptProfile(): PromptProfile {
  return {
    vocabulary: pythonVocabulary(),
    fragments: {
      ...METHOD_SLICER_FRAGMENTS,
      ...DEPENDENCY_RESOLVER_FRAGMENTS,
      ...CONTEXT_BUILDER_FRAGMENTS,
      ...CODE_ANALYZER_FRAGMENTS,
      ...TEST_GENERATOR_FRAGMENTS,
      ...TEST_VALIDATOR_FRAGMENTS,
      ...CHAT_FIXER_FRAGMENTS,
    },
  };
}
