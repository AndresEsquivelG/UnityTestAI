import type { JavaFragments } from "./fragments";

/**
 * Fragmentos del resolutor de dependencias (`dependencyResolverPrompt.txt`).
 */
export const DEPENDENCY_RESOLVER_FRAGMENTS = {
  /**
   * Tipos que nunca son un archivo del proyecto: la biblioteca estándar, las
   * bibliotecas de terceros y las de pruebas. Sin esta regla el agente pide el
   * archivo de `List` o de un `@Service` de Spring, que no existe en el árbol.
   */
  ignoredTypes: `- IGNORE Java standard library types (java.*, javax.*: String, List, Map, Optional, BigDecimal, LocalDate, etc.)
- IGNORE third-party library and framework types (org.springframework.*, jakarta.*, org.apache.*, com.fasterxml.*, lombok.*, etc.)
- IGNORE test library types (org.junit.*, org.mockito.*, org.assertj.*)`,

  /**
   * Las formas de nombrar un tipo sin construirlo. Los tipos de los parámetros
   * van explícitos porque es justo lo que el agente omitía con Unity: con
   * varios modelos no pidió el tipo de un parámetro que estaba en el árbol.
   */
  dependencyEvidence: `- Generic type arguments (e.g., List<Order>, Optional<Customer>, Map<String, Item>)
- Parameter, local variable and return types of the target method (e.g., \`Order order\`, \`Customer find(...)\`)`,

  /** Las fuentes de un proyecto Java cuelgan de `src/main/java`. */
  sourcePathExample: `"src/main/java/com/example/.../File.java"`,
} satisfies JavaFragments;
