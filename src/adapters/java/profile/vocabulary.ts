import type { ProjectModel, PromptVocabulary } from "../../../core/contracts";
import { BUILD_TOOL_NAMES, type BuildTool } from "../discovery/layout";

/**
 * Vocabulario obligatorio: las palabras que caen dentro de las frases de las
 * plantillas y que comparten varias de ellas.
 *
 * `ecosystem` es la herramienta de construcción y no «Java», porque las
 * plantillas ya nombran el lenguaje al lado: «a Java JUnit 5 test assistant
 * for Maven» se lee bien, y «… for Java» repetiría la palabra. Por eso el
 * vocabulario depende del proyecto, que es lo que OP-08 prevé.
 *
 * `assertionPrefix` es `assert` porque las aserciones de JUnit 5 se importan de
 * forma estática y se escriben sin clase delante: `assertEquals(...)`.
 */
export function javaVocabulary(project: ProjectModel): PromptVocabulary {
  return {
    ecosystem: buildToolName(project),
    language: "Java",
    testFramework: "JUnit 5",
    importStatements: "import statements",
    typeKinds: "type, class, interface, enum, or record",
    assertionPrefix: "assert",
    controlFlowKeywords: "if/else, switch, for, while, do/while, or try/catch",
    loopKeywords: "for/for-each/while",
  };
}

/** Sin herramienta reconocida queda «Java»: «… test assistant for Java». */
function buildToolName(project: ProjectModel): string {
  const tool = project.adapterData?.buildTool;
  return typeof tool === "string" && Object.prototype.hasOwnProperty.call(BUILD_TOOL_NAMES, tool)
    ? BUILD_TOOL_NAMES[tool as BuildTool]
    : "Java";
}
