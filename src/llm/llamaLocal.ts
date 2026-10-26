import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ChatMessage } from "./sessionManager";
import type { AskOptions, LLMResult } from "./index";
import { DEFAULT_OLLAMA_MODEL, OLLAMA_URL } from "./ollamaModels";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: `${OLLAMA_URL}/v1`,
  // Without it Ollama sends no token counts when streaming.
  includeUsage: true,
});

/**
 * Generates a completion with a local model served by Ollama.
 *
 * Streaming is required, not an optimization: without it Ollama sends nothing
 * until the whole answer is written, and Node's fetch gives up waiting for the
 * response headers after 5 minutes (undici's `headersTimeout`). A 14B model on
 * CPU writes about 2 tokens per second, so any answer longer than ~600 tokens
 * (a whole test file) was cut and retried from scratch, failing every time.
 * While streaming, that limit only applies between chunks.
 *
 * With `json`, Ollama is asked for a JSON object (`response_format`) and only
 * lets the model write tokens that keep the answer valid JSON. Without it,
 * qwen2.5-coder:14b copied a Python docstring into the method slicer's answer
 * with its triple quotes unescaped (`"    """A pet shop""""`), and the
 * generation stopped; with it, the same prompt came back as valid JSON, with
 * the quotes escaped and no markdown fence (checked on 2026-10-26).
 */
export async function generateWithOllama(
  messages: ChatMessage[],
  model: string = DEFAULT_OLLAMA_MODEL,
  options: AskOptions = {},
): Promise<LLMResult> {
  // streamText reports failures through onError and rejects its promises with
  // a generic "no output" error; keep the real one so the panel shows it.
  let failure: unknown;
  const result = streamText({
    model: ollama.chatModel(model),
    messages,
    temperature: 0,
    providerOptions: {
      // The OpenAI-compatible provider copies these fields into the request
      // body, after its own `response_format`.
      ollama: {
        options: { num_ctx: 8192 },
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      },
    },
    onError: ({ error }) => {
      failure = error;
    },
  });

  try {
    const [text, usage] = await Promise.all([result.text, result.usage]);
    return {
      text,
      usage: {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      },
    };
  } catch (error) {
    throw failure ?? error;
  }
}
