import type { PythonFragments } from "./fragments";

/**
 * Fragmentos del recortador de métodos (`methodSlicerPrompt.txt`).
 */
export const METHOD_SLICER_FRAGMENTS = {
  /**
   * Las importaciones que usan los decoradores y las anotaciones también
   * cuentan: sin ellas, el recorte nombra tipos que no se sabe de dónde salen.
   */
  sliceImportRule: `Import statements: only the \`import\` and \`from ... import\` lines required by names used inside the target method body or signature (decorators and type hints included)`,

  /**
   * Ejemplo del recorte esperado, con lo que más aparece en una clase Python:
   * una clase base, un atributo de clase, el `__init__` que crea el atributo
   * que usa el método y el método objetivo. Sin comillas adentro, porque va
   * dentro de un arreglo de textos JSON.
   */
  sliceExample: `"from decimal import Decimal",
"",
"from shop.models import Item",
"",
"class ClassName(BaseClass):",
"    tax_rate = Decimal(13)",
"",
"    def __init__(self, items):",
"        self.items = items",
"",
"    def target_method(self, value):",
"        # exact method body"`,
} satisfies PythonFragments;
