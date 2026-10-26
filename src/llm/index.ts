export { generateWithChatGPT } from "./chatgpt";
export { generateWithOllama } from "./llamaLocal";
export { generateWithClaude } from "./claude";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LLMResult = {
  text: string;
  usage: TokenUsage;
};

/** Cómo se pide una respuesta, además del prompt. */
export type AskOptions = {
  /**
   * La respuesta tiene que ser un objeto JSON: la piden los agentes que la
   * leen con `JSON.parse`. Ollama la restringe para que lo sea (ver
   * `generateWithOllama`); Claude y ChatGPT lo ignoran, porque ya lo cumplen.
   */
  json?: boolean;
};
