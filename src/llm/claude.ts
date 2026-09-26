import Anthropic from "@anthropic-ai/sdk";
import { ChatMessage } from "./sessionManager";
import type { LLMResult } from "./index";

// Lazily constructed so the client reads ANTHROPIC_API_KEY *after* extension.ts
// has run dotenv.config() — constructing at module load would race the env load
// and the SDK throws when the key is missing.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const MAX_TOKENS = 32000;

/**
 * Models that predate adaptive thinking: they reject `{ type: "adaptive" }`
 * with a 400 and only accept a fixed thinking budget. Every model from the
 * 4.6 family on uses adaptive thinking, so this list is closed and a newer
 * model needs no entry here.
 */
const FIXED_BUDGET_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"];

/** Thinking budget for those models. The API requires it to be below `max_tokens`. */
const THINKING_BUDGET = 16000;

export function thinkingFor(model: string): Anthropic.ThinkingConfigParam {
  return FIXED_BUDGET_MODELS.some((prefix) => model.startsWith(prefix))
    ? { type: "enabled", budget_tokens: THINKING_BUDGET }
    : { type: "adaptive" };
}

/**
 * Generates a completion with Claude using the official Anthropic SDK.
 *
 * Mirrors the signature of generateWithChatGPT / generateWithOllama: it takes
 * the accumulated ChatMessage[] history and returns the assistant's text.
 *
 * Notes:
 *  - The Anthropic Messages API keeps the system prompt out of `messages`, so
 *    any `system` role messages are collapsed into the top-level `system` field.
 *  - Streaming is used because generated tests / JSON can be large and would
 *    otherwise risk SDK HTTP timeouts at high max_tokens.
 *  - Thinking is enabled (adaptive, or a fixed budget where the model predates
 *    it); thinking blocks are ignored and only text blocks are returned (the
 *    agents downstream parse JSON/code from the text).
 */
export async function generateWithClaude(
  messages: ChatMessage[],
  model: string = "claude-haiku-4-5",
): Promise<LLMResult> {
  const systemPrompt = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const conversation = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const stream = getClient().messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    thinking: thinkingFor(model),
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: conversation,
  });

  const finalMessage = await stream.finalMessage();

  const text = finalMessage.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    text,
    usage: {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    },
  };
}
