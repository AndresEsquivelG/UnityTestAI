import type { PromptVocabulary } from "../../../core/contracts";

/**
 * Vocabulario obligatorio: las palabras que caen dentro de las frases de las
 * plantillas y que comparten varias de ellas.
 *
 * `ecosystem` es «Python 3» y no «pytest» ni «Python»: las plantillas ya
 * nombran el lenguaje y el marco al lado, y «a Python pytest test assistant for
 * Python 3» repite menos que las otras dos. A diferencia de Java, no depende
 * del proyecto: lo que cambia de un proyecto a otro —dónde está el código— se
 * dice en la ficha de la clase, que es la que lleva la línea de `import`.
 *
 * `assertionPrefix` es `assert` porque en pytest la aserción es la instrucción
 * del lenguaje. Una prueba de excepción no tiene ninguna, y lo aclaran los
 * fragmentos que cuentan aserciones.
 *
 * `controlFlowKeywords` incluye las expresiones condicionales y las
 * comprensiones con `if`, porque esconden una rama en una línea.
 */
export function pythonVocabulary(): PromptVocabulary {
  return {
    ecosystem: "Python 3",
    language: "Python",
    testFramework: "pytest",
    importStatements: "import statements",
    typeKinds: "class, function, or module",
    assertionPrefix: "assert",
    controlFlowKeywords:
      "if/elif/else, match/case, for, while, try/except, conditional expressions (x if c else y) or comprehensions with if",
    loopKeywords: "for/while",
  };
}
