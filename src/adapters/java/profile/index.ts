import type { ProjectModel, PromptProfile } from "../../../core/contracts";
import { CHAT_FIXER_FRAGMENTS } from "./chatFixer";
import { CODE_ANALYZER_FRAGMENTS } from "./codeAnalyzer";
import { CONTEXT_BUILDER_FRAGMENTS } from "./contextBuilder";
import { DEPENDENCY_RESOLVER_FRAGMENTS } from "./dependencyResolver";
import { METHOD_SLICER_FRAGMENTS } from "./methodSlicer";
import { TEST_GENERATOR_FRAGMENTS } from "./testGenerator";
import { TEST_VALIDATOR_FRAGMENTS } from "./testValidator";
import { javaVocabulary } from "./vocabulary";

/**
 * OP-08 — Perfil de prompt del ecosistema Java, con JUnit 5.
 *
 * Junta el vocabulario, que comparten varias plantillas, y los fragmentos de
 * cada una, que viven en un archivo por plantilla y en el orden del pipeline.
 * Cada fragmento lo pide una sola plantilla, así que repartirlos así no
 * duplica nada.
 *
 * El validador de contexto no tiene archivo: su plantilla solo usa el
 * vocabulario.
 */
export function javaPromptProfile(project: ProjectModel): PromptProfile {
  return {
    vocabulary: javaVocabulary(project),
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
