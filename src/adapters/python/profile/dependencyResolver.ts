import type { PythonFragments } from "./fragments";

/**
 * Fragmentos del resolutor de dependencias (`dependencyResolverPrompt.txt`).
 */
export const DEPENDENCY_RESOLVER_FRAGMENTS = {
  /**
   * Lo que nunca es un archivo del proyecto: lo que trae Python, lo que se
   * instala aparte y las bibliotecas de pruebas. Sin esta regla el agente pide
   * el archivo de `datetime` o de `requests`, que no está en el árbol.
   */
  ignoredTypes: `- IGNORE Python built-ins and standard library modules (str, int, list, dict, os, sys, re, math, datetime, decimal, collections, typing, dataclasses, abc, enum, pathlib, etc.)
- IGNORE third-party packages (requests, numpy, pandas, django, flask, pydantic, etc.) — anything that is not in the projectTree
- IGNORE test libraries (pytest, unittest, unittest.mock)`,

  /**
   * En Python el código no declara tipos: lo que delata una dependencia son
   * las importaciones del archivo y, cuando las hay, las anotaciones. Los
   * parámetros van explícitos porque es lo que el agente omitía con Unity.
   */
  dependencyEvidence: `- Names the file imports with \`from module import Name\` or \`import package.module\` and that the target method uses
- Type hints of the target method's parameters and return value (e.g., \`def total(self, items: list[Item]) -> Money\`)`,

  /** Una ruta del árbol, con la extensión de Python. */
  sourcePathExample: `"package/subpackage/module.py"`,
} satisfies PythonFragments;
