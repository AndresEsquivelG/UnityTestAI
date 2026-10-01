import * as fs from "fs";
import * as path from "path";
import { z, type ZodRawShape } from "zod";
import { buildCodeAnalyzerPrompt } from "../prompts/promptBuilder";
import type { PromptProfile } from "../core/contracts";
import { JsonSanitizer } from "../utils/jsonSanitizer";

// ── Output schema ──────────────────────────────────────────────────────────────

const methodInputSchema = z.object({
  name: z.string(),
  type: z.string(),
});

const dependencySchema = z.object({
  name: z.string(),
  type: z.enum(["class", "struct", "enum", "external"]),
  membersUsed: z.array(z.string()),
});

const decisionRowSchema = z.object({
  conditions: z.array(z.string()),
  branch: z.string(),
  expectedBehavior: z.string(),
});

const loopSchema = z.object({
  type: z.string(),
  condition: z.string(),
});

/**
 * Miembro que la prueba tiene que alcanzar sin pasar por su interfaz pública.
 *
 * `kind` es texto libre y no una enumeración cerrada: qué clases de miembro
 * existen depende del lenguaje, y el núcleo no puede enumerarlas sin nombrar
 * uno. Los valores válidos se los dicta al modelo el prompt, que sale del perfil
 * del adaptador (OP-08). Se pierde la validación de ese campo, y es aceptable:
 * un análisis que no valida ya es hoy un fallo blando —el pipeline sigue sin
 * análisis— y la alternativa era que el contrato supiera ensanchar
 * enumeraciones anidadas.
 */
const privateMemberSchema = z.object({
  name: z.string(),
  kind: z.string(),
  type: z.string(),
  // For nestedType kind: enum/struct value names
  nestedValues: z.array(z.string()).optional(),
});

/**
 * Apartados comunes a cualquier ecosistema.
 *
 * Lo que solo existe en uno —los campos que repone el ciclo de vida de un motor,
 * las declaraciones de importación de un lenguaje, las decisiones de
 * instanciación— lo aporta el adaptador por OP-09 y se fusiona aquí.
 */
const readyShape = {
  status: z.literal("READY"),
  methodSummary: z.object({
    name: z.string(),
    inputs: z.array(methodInputSchema),
    output: z.string(),
  }),
  dependencies: z.array(dependencySchema),
  decisionTable: z.array(decisionRowSchema),
  loops: z.array(loopSchema),
  sideEffects: z.array(z.string()),
  privateMembers: z.array(privateMemberSchema).optional(),
  // El concepto vale para los tres ecosistemas: siempre puede haber una rama que
  // el entorno de ejecución no deja alcanzar. Su presentación, en cambio, nombra
  // herramientas concretas, y de eso se encarga el adaptador.
  untestableBranches: z.array(z.object({
    condition: z.string(),
    reason: z.string(),
  })).optional(),
};

const errorShape = z.object({
  status: z.literal("ERROR"),
  message: z.string(),
});

/**
 * Esquema con el que se valida la respuesta del analizador.
 *
 * Se arma por corrida porque los campos del adaptador se conocen recién al
 * consultar OP-09. Sin extensión, el esquema es el común y nada más.
 */
export function buildCodeAnalyzerSchema(extraFields: ZodRawShape = {}) {
  return z.discriminatedUnion("status", [
    z.object({ ...readyShape, ...extraFields }),
    errorShape,
  ]);
}

const neutralSchema = buildCodeAnalyzerSchema();

/**
 * Vista del núcleo sobre el análisis: los apartados comunes y nada más. Los
 * campos que aportó el adaptador viajan en el objeto pero no en el tipo, que es
 * exactamente lo que el contrato pide: el núcleo los transporta sin leerlos.
 */
export type CodeAnalyzerOutput = z.infer<typeof neutralSchema>;

// ── Input ──────────────────────────────────────────────────────────────────────

export interface CodeAnalyzerInput {
  /** Perfil del ecosistema con el que se compone la plantilla (OP-08). */
  profile: PromptProfile;
  /**
   * Campos con los que el adaptador extiende el esquema (OP-09). Ausentes
   * cuando el adaptador no declara esa capacidad.
   */
  schemaFields?: ZodRawShape;
  assembledContext: string;
  className: string;
  methodName: string;
  workspaceRoot: string;
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Sends the code-analyzer prompt to the LLM and parses the strict JSON
 * response into a structured representation of the target method.
 *
 * Saves three files per run:
 *  - code-analyzer-prompt.txt    → prompt sent to LLM (debugging)
 *  - code-analyzer-output.txt    → raw LLM response (debugging)
 *  - code-analyzer-output.json   → parsed/validated JSON (for the next agent)
 */
export async function runCodeAnalyzer(
  input: CodeAnalyzerInput,
  llmHandler: (prompt: string) => Promise<string>
): Promise<CodeAnalyzerOutput> {
  const prompt = buildCodeAnalyzerPrompt(
    input.profile,
    input.methodName,
    input.className,
    input.assembledContext
  );

  // ── Save the prompt being sent (debugging) ────────────────────────────────
  const dumpDir = path.join(input.workspaceRoot, "AgentOutputs", "code-analyzer");
  fs.mkdirSync(dumpDir, { recursive: true });
  fs.writeFileSync(path.join(dumpDir, "code-analyzer-prompt.txt"), prompt, "utf8");

  const raw = await llmHandler(prompt);

  // ── Save raw LLM response (txt) ──────────────────────────────────────────
  fs.writeFileSync(path.join(dumpDir, "code-analyzer-output.txt"), raw, "utf8");

  // ── Parse JSON from response ─────────────────────────────────────────────
  const clean = raw.trim().replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);

  let parsed: CodeAnalyzerOutput;
  try {
    if (!jsonMatch) {
      throw new Error("No JSON object found in LLM response");
    }
    const json = JSON.parse(JsonSanitizer.sanitize(jsonMatch[0]));
    parsed = buildCodeAnalyzerSchema(input.schemaFields).parse(json) as CodeAnalyzerOutput;
  } catch (err: any) {
    parsed = {
      status: "ERROR",
      message: `Failed to parse LLM response as valid JSON: ${err.message}`,
    };
  }

  // ── Save validated JSON (for the next agent) ─────────────────────────────
  fs.writeFileSync(
    path.join(dumpDir, "code-analyzer-output.json"),
    JSON.stringify(parsed, null, 2),
    "utf8"
  );

  return parsed;
}
