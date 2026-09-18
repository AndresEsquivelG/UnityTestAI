import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { buildTestGeneratorPrompt } from "../prompts/promptBuilder";
import { JsonSanitizer } from "../utils/jsonSanitizer";

// ── Output schema ──────────────────────────────────────────────────────────────

export const testGeneratorOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("SUCCESS"),
    testCode: z.string(),
  }),
  z.object({
    status: z.literal("ERROR"),
    message: z.string(),
  }),
]);

export type TestGeneratorOutput = z.infer<typeof testGeneratorOutputSchema>;

// ── Input ──────────────────────────────────────────────────────────────────────

export interface TestGeneratorInput {
  assembledContext: string;
  codeAnalysis?: string;
  className: string;
  methodName: string;
  workspaceRoot: string;
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Agent 3 — Test Generator
 *
 * Receives the fully assembled context from the Context Builder and generates
 * the test code with the minimum tests needed for 100% decision coverage.
 *
 * Returns the model's answer as it came. Where the file goes, how it is named
 * and how the code is adjusted to the naming convention are decisions of the
 * ecosystem adapter (OP-10 and OP-11), so they no longer live here.
 *
 * Saves:
 *  - test-generator-prompt.txt    → prompt sent to LLM
 *  - test-generator-output.txt    → raw LLM response
 */
export async function runTestGenerator(
  input: TestGeneratorInput,
  llmHandler: (prompt: string) => Promise<string>
): Promise<TestGeneratorOutput> {
  const dumpDir = path.join(input.workspaceRoot, "AgentOutputs", "test-generator");
  fs.mkdirSync(dumpDir, { recursive: true });

  const prompt = buildTestGeneratorPrompt(
    input.methodName,
    input.className,
    input.assembledContext,
    input.codeAnalysis
  );

  fs.writeFileSync(path.join(dumpDir, "test-generator-prompt.txt"), prompt, "utf8");

  const raw = await llmHandler(prompt);

  fs.writeFileSync(path.join(dumpDir, "test-generator-output.txt"), raw, "utf8");

  const failure = readFailureEnvelope(raw);
  if (failure) {
    return { status: "ERROR", message: failure };
  }

  return { status: "SUCCESS", testCode: raw };
}

/**
 * The model sometimes answers with an error envelope instead of code. Detecting
 * that is this agent's job and does not depend on the ecosystem; the fences are
 * stripped only to look inside, not to clean up the answer, which is what OP-11
 * does with the adapter's own conventions.
 */
function readFailureEnvelope(raw: string): string | null {
  const unfenced = raw
    .trim()
    .replace(/^```[a-z#+]*\s*/i, "")
    .replace(/```$/, "")
    .trim();

  if (!unfenced.startsWith("{")) {
    return null;
  }

  try {
    const json = JSON.parse(JsonSanitizer.sanitize(unfenced));
    if (json.status === "GENERATION_FAILED" || json.status === "INVALID_INPUT") {
      return json.issues?.join("; ") || "Test generation failed";
    }
  } catch {
    // Not JSON — treat as code
  }

  return null;
}
