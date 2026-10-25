import type { ArtifactSpec } from "../../../core/contracts";

/**
 * OP-11 — Normalización del código generado.
 *
 * Un solo ajuste: quitar el cercado de markdown con el que el modelo suele
 * envolver la respuesta. A diferencia de Java, no hay nada que el nombre del
 * archivo obligue a cambiar adentro: no hay línea `package`, y las funciones
 * de prueba se llaman como quieran mientras empiecen con `test_`.
 *
 * La línea que importa la clase bajo prueba no se reescribe aquí. La da la
 * ficha de la clase (OP-18), y si el modelo se equivoca, la comprobación de
 * importabilidad lo va a decir con el error de Python.
 *
 * Aplicarla dos veces da lo mismo que una: el pipeline vuelve a normalizar las
 * correcciones de los agentes, que ya pasaron por aquí.
 */
export function normalizePythonCode(code: string, _spec: ArtifactSpec): string {
  return code
    .trim()
    .replace(/^```(?:python|py)?[ \t]*\r?\n?/i, "")
    .replace(/\r?\n?```\s*$/i, "")
    .trim();
}
