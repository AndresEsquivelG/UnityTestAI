import type { SymbolCandidate, UnitTarget } from "../../core/contracts";
import { findEnclosingNamespace, maskCommentsAndStrings } from "./csharpSource";

/**
 * OP-18 — Ficha de la clase bajo prueba, leída del código.
 *
 * En Unity dice una sola cosa: en qué espacio de nombres está la clase. Los
 * prompts de C# ya piden `using XYZ;` por cada `namespace XYZ { }` del
 * contexto, pero el recortador se queda con la declaración de la clase y ningún
 * agente llega a ver el espacio de nombres. Sin él la prueba no compila
 * (CS0246), y el corrector, que tampoco lo ve, puede cambiarla por una búsqueda
 * del tipo por nombre que falla al ejecutar.
 *
 * Una clase sin espacio de nombres no tiene nada que decir: la ficha queda
 * vacía y los prompts no cambian.
 *
 * No copia los demás `using` del archivo: un mismo nombre puede existir en dos
 * de ellos (`TextureDictionary`, en `Conversion` y en `RenderWareStream`), y con
 * los dos en la prueba el nombre queda ambiguo (CS0104). Va en inglés, como las
 * plantillas.
 */
export function describeUnityUnit(
  code: string,
  target: UnitTarget,
  location: SymbolCandidate
): string {
  if (target.className === null) {
    return "";
  }

  const namespace = findEnclosingNamespace(
    maskCommentsAndStrings(code),
    location.line,
    location.column
  );
  if (namespace === "") {
    return "";
  }

  return [
    "━━ CLASS FACTS — read from the source code by the tool, not by a language model ━━",
    `\`${target.className}\` is declared inside \`namespace ${namespace} { }\`.`,
    `The test file needs: using ${namespace};`,
    `A lookup by name must start with that namespace: GetType("${target.className}") finds nothing.`,
  ].join("\n");
}
