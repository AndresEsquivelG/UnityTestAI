/**
 * Los modelos que ofrece el panel.
 *
 * Los de la nube son una lista fija, decidido por Andrés el 2026-10-23: así la
 * comparación de modelos usa siempre los mismos y no se elige sin querer uno
 * que no se probó. Los de Ollama no están aquí: se le preguntan a Ollama
 * (`ollamaModels.ts`).
 *
 * Sin dependencias de los SDK, para que las pruebas lo carguen sin ellos.
 */

export interface ModelChoice {
  /** Lo que se le pasa a la API. */
  readonly id: string;
  /** Lo que se muestra en el menú. */
  readonly label: string;
}

/**
 * El primero es el que se usa si no se elige otro: Haiku 4.5, el de la
 * comparación de modelos (contexto de Java, sección 15). La configuración del
 * razonamiento de cada uno la decide `thinkingFor`, en `claude.ts`.
 */
export const CLAUDE_MODELS: readonly ModelChoice[] = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
];

/** Los de la página de modelos de OpenAI al 2026-10-23, del más barato al más capaz. */
export const OPENAI_MODELS: readonly ModelChoice[] = [
  { id: "gpt-6-luna", label: "GPT-6 Luna" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
  { id: "gpt-6-astra", label: "GPT-6 Astra" },
];

/**
 * Cómo aparece cada proveedor en el nombre de la prueba. La clave es la que
 * mandan el panel y la configuración JSON, que no cambia.
 */
const PROVIDER_TAGS: Readonly<Record<string, string>> = {
  claude: "anthropic",
  chatgpt: "openai",
  llamaLocal: "ollama",
};

/**
 * El modelo tal como entra en el nombre de la prueba: proveedor y modelo, para
 * que dos modelos del mismo proveedor no se pisen (los dos qwen escribían
 * `UTIA_llamaLocal_…`). `baseArtifactName` lo vuelve un identificador:
 * `ollama/qwen2.5:14b` queda `ollama_qwen2_5_14b`.
 */
export function artifactModelId(provider: string, model: string): string {
  return `${PROVIDER_TAGS[provider] ?? provider}/${model}`;
}
