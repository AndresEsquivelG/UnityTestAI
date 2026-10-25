import type { PythonFragments } from "./fragments";

/**
 * Fragmentos del constructor de contexto (`contextBuilderPrompt.txt`).
 */
export const CONTEXT_BUILDER_FRAGMENTS = {
  /**
   * Qué se conserva de cada clase de tipo. Una clase de datos se conserva con
   * todos sus campos porque son su constructor, igual que un `record` en Java.
   */
  dependencySliceRules: `- ALWAYS include the import lines the included members need and the class declaration line (name and base classes)
- For enums (classes that inherit Enum): include the FULL list of members if ANY member name appears in the target method body
- For dataclasses and NamedTuples: include the decorator and ALL their annotated fields — they are the constructor
- For classes: include __init__ if the target method creates an instance, and ONLY the attributes/methods whose identifier appears in the target method body
- For module-level functions and constants: include only those the target method calls or reads`,

  /** En Python un bloque se define por su sangría y no puede quedar vacío. */
  dependencySliceSyntax: `IMPORTANT: The relevantSlice must be valid Python — keep the original indentation of every line, and give every block a body (write \`...\` for a method whose body is omitted).`,

  /** Ejemplo del recorte de una dependencia, con su ruta y su contenido. */
  dependencySliceExample: `"filePath": "package/models.py",
"relevantSlice": "class SomeClass:\\n    def __init__(self, some_prop):\\n        self.some_prop = some_prop\\n\\n    def get_some_prop(self):\\n        return self.some_prop"`,
} satisfies PythonFragments;
