import type { JavaFragments } from "./fragments";

/**
 * Fragmentos del recortador de métodos (`methodSlicerPrompt.txt`).
 */
export const METHOD_SLICER_FRAGMENTS = {
  /**
   * La línea `package` entra en el recorte aunque no sea una importación: los
   * agentes siguientes la necesitan para saber en qué paquete va la prueba y
   * qué tipos se ven sin importarlos.
   */
  sliceImportRule: `Package and import statements: keep the \`package\` line, and only the imports required by types used inside the target method body or signature`,

  /**
   * Ejemplo del recorte esperado, con lo que más aparece en una clase Java:
   * herencia e interfaces en la declaración, un campo inyectado por el
   * constructor y el método objetivo.
   */
  sliceExample: `"package com.example.orders;",
"",
"import java.util.List;",
"",
"public class ClassName extends BaseClass implements SomeInterface {",
"    private final List<Item> items;",
"",
"    public ClassName(List<Item> items) { ... }",
"",
"    public int targetMethod(int value) {",
"        // exact method body",
"    }",
"}"`,
} satisfies JavaFragments;
