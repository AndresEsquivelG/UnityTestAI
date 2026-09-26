import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { buildChatFixerPrompt } from "../prompts/promptBuilder";
import type { PromptProfile } from "../core/contracts";
import { JsonSanitizer } from "../utils/jsonSanitizer";
import { readCodeField } from "../utils/codeField";

// ── Output schema ──────────────────────────────────────────────────────────────

export const chatFixerOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("FIXED"),
    correctedCode: z.string(),
    summary: z.string().optional(),
  }),
  z.object({ status: z.literal("INFO"),  answer: z.string() }),
  z.object({ status: z.literal("ERROR"), message: z.string() }),
]);

export type ChatFixerOutput = z.infer<typeof chatFixerOutputSchema>;

// ── Input ──────────────────────────────────────────────────────────────────────

export interface ChatFixerInput {
  /** Perfil del ecosistema con el que se compone la plantilla (OP-08). */
  profile: PromptProfile;
  testCode: string;
  assembledContext: string;
  userMessage: string;
  className: string;
  methodName: string;
  workspaceRoot: string;
  /**
   * Carpeta de los volcados dentro de `AgentOutputs`. La corrección automática
   * usa una por ciclo para que un ciclo no pise el prompt del anterior.
   */
  dumpDir?: string;
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Chat Fixer — stateless per-message agent
 *
 * Routes every chat message through an LLM that has full context of both the
 * generated test and the source code under test. Handles two cases:
 *   FIXED  → user reported an error; returns the complete corrected C# file
 *   INFO   → user asked a question; returns a text answer
 *   ERROR  → cannot fix (ambiguous or missing context)
 *
 * Saves:
 *  - chat-fixer-prompt.txt    → prompt sent to LLM
 *  - chat-fixer-output.txt    → raw LLM response
 *  - chat-fixer-output.json   → parsed/validated JSON
 */
export async function runChatFixer(
  input: ChatFixerInput,
  llmHandler: (prompt: string) => Promise<string>
): Promise<ChatFixerOutput> {
  const dumpDir = path.join(input.workspaceRoot, "AgentOutputs", input.dumpDir ?? "chat-fixer");
  fs.mkdirSync(dumpDir, { recursive: true });

  const prompt = buildChatFixerPrompt(
    input.profile,
    input.methodName,
    input.className,
    input.assembledContext,
    input.testCode,
    input.userMessage
  );
  fs.writeFileSync(path.join(dumpDir, "chat-fixer-prompt.txt"), prompt, "utf8");

  const raw = await llmHandler(prompt);
  fs.writeFileSync(path.join(dumpDir, "chat-fixer-output.txt"), raw, "utf8");

  const clean = raw.trim().replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);

  let result: ChatFixerOutput;
  try {
    if (!jsonMatch) {
      throw new Error("No JSON object found in chat fixer response");
    }
    const parsed = chatFixerOutputSchema.parse(JSON.parse(JsonSanitizer.sanitize(jsonMatch[0])));
    if (parsed.status === "FIXED") {
      const fixed = readCodeField(parsed.correctedCode);
      result = fixed.ok
        ? { ...parsed, correctedCode: fixed.code }
        : { status: "ERROR", message: `Discarded the fixer's correction: ${fixed.reason}` };
    } else {
      result = parsed;
    }
  } catch (err: any) {
    result = { status: "ERROR", message: `Failed to parse fixer response: ${err.message}` };
  }

  fs.writeFileSync(
    path.join(dumpDir, "chat-fixer-output.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );

  return result;
}
