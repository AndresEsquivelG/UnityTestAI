import type { JavaFragments } from "./fragments";

/**
 * Fragmentos del constructor de contexto (`contextBuilderPrompt.txt`).
 */
export const CONTEXT_BUILDER_FRAGMENTS = {
  /**
   * Qué se conserva de cada clase de tipo. La línea `package` va siempre: de
   * ella sale si la prueba tiene que importar el tipo o no. Un `record` se
   * conserva con todos sus componentes porque son su constructor.
   */
  dependencySliceRules: `- ALWAYS include the \`package\` line and the type declaration line (name, type parameters, \`extends\`, \`implements\`)
- For enums: include the FULL list of constants if ANY constant name appears in the target method body
- For records: include the full record header with ALL its components — they are its canonical constructor
- For classes/interfaces: include ONLY the fields/methods whose identifier appears in the target method body`,

  /** En Java un bloque se cierra con llave y una sentencia con punto y coma. */
  dependencySliceSyntax: `IMPORTANT: The relevantSlice must be valid Java — close every opened block with \`}\` and end every statement with \`;\`.`,

  /** Ejemplo del recorte de una dependencia, con su ruta y su contenido. */
  dependencySliceExample: `"filePath": "src/main/java/com/example/.../File.java",
"relevantSlice": "package com.example.model;\\n\\npublic class SomeClass {\\n    private String someProp;\\n\\n    public String getSomeProp() { return someProp; }\\n}"`,
} satisfies JavaFragments;
