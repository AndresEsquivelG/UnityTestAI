import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ChatMessage } from "./sessionManager";
import type { LLMResult } from "./index";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: "http://localhost:11434/v1",
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
 */
export async function generateWithOllama(
  messages: ChatMessage[],
  model: string = "qwen2.5:14b",
): Promise<LLMResult> {
  // streamText reports failures through onError and rejects its promises with
  // a generic "no output" error; keep the real one so the panel shows it.
  let failure: unknown;
  const result = streamText({
    model: ollama.chatModel(model),
    messages,
    temperature: 0,
    providerOptions: {
      ollama: { options: { num_ctx: 8192 } },
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
