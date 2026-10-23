/**
 * Los modelos instalados en Ollama, para el menú del panel.
 *
 * Es la misma dirección local con la que se genera: no pide permiso ni sale de
 * la computadora. Sin dependencias de los SDK, para que las pruebas lo carguen
 * sin ellos.
 */

export const OLLAMA_URL = "http://localhost:11434";

/** El que se usa si no se elige otro, como antes del menú. */
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:14b";

/** Lo que se espera a Ollama antes de darlo por cerrado: el panel no se queda colgado. */
const TIMEOUT_MS = 3000;

export type OllamaModels =
  | { readonly ok: true; readonly models: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Los nombres de los modelos que generan texto, ordenados: Ollama los devuelve
 * del más reciente al más viejo, y así no cambian de lugar en el menú. Uno de
 * embeddings no escribe pruebas. Si Ollama no dice para qué sirve un modelo
 * (versiones viejas), se ofrece igual.
 */
export async function listOllamaModels(baseUrl = OLLAMA_URL, timeoutMs = TIMEOUT_MS): Promise<OllamaModels> {
  let body: { models?: { name?: unknown; capabilities?: unknown }[] };
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { ok: false, reason: `Ollama respondió con el código ${response.status}.` };
    }
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, reason: "Ollama no responde: abrilo y volvé a abrir el panel." };
  }

  const models = (body.models ?? [])
    .filter((model) => !Array.isArray(model.capabilities) || model.capabilities.includes("completion"))
    .map((model) => model.name)
    .filter((name): name is string => typeof name === "string")
    .sort();

  return models.length > 0
    ? { ok: true, models }
    : { ok: false, reason: `Ollama no tiene modelos instalados: bajá uno con «ollama pull ${DEFAULT_OLLAMA_MODEL}».` };
}
