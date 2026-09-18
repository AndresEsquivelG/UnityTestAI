import { z } from "zod";
import type { AnalysisSchemaExtension } from "../../core/contracts";

/**
 * OP-09 — Extensión del esquema de análisis del ecosistema Unity.
 *
 * Saca del núcleo los tres campos que solo tienen sentido en Unity y en C#, y la
 * presentación de los cuatro apartados cuyo texto nombra una herramienta
 * concreta. Todo salió tal cual estaba en `formatCodeAnalysis`, sin reescribir
 * una coma: ese texto entra en el prompt del generador y la foto de
 * `src/test/snapshots/prompts/codeAnalysis.txt` comprueba que no cambió.
 */

/** Campo que `Start` o `Awake` inicializan y la prueba tiene que reponer. */
const startAwakeFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  initIn: z.enum(["Awake", "Start"]),
  notes: z.string().optional(),
});

/**
 * Decisiones que el analizador deja resueltas para el generador: cómo se
 * instancia cada tipo y cómo se controla cada propiedad calculada.
 */
const preFlightSchema = z.object({
  typeInstantiations: z.array(z.object({
    typeName: z.string(),
    pattern: z.enum(["AddComponent", "new"]),
    constructorSignature: z.string().nullable(),
    parameterless: z.boolean(),
    constructorNotes: z.string(),
    reason: z.string(),
  })),
  computedProperties: z.array(z.object({
    propertyName: z.string(),
    getterSummary: z.string(),
    controlVia: z.string(),
  })),
});

/**
 * Lo que este adaptador lee del análisis.
 *
 * `untestableBranches` es un campo del núcleo y aun así aparece aquí: su
 * concepto vale para cualquier ecosistema, pero su redacción nombra
 * herramientas de este. El análisis ya pasó por el esquema fusionado, así que
 * estrecharlo es seguro.
 */
interface UnityAnalysis {
  readonly startAwakeFields?: readonly z.infer<typeof startAwakeFieldSchema>[];
  readonly requiredUsings?: readonly string[];
  readonly untestableBranches?: readonly { condition: string; reason: string }[];
  readonly preFlightChecklist?: z.infer<typeof preFlightSchema>;
}

export function unityAnalysisSchema(): AnalysisSchemaExtension {
  return {
    fields: {
      startAwakeFields: z.array(startAwakeFieldSchema).optional(),
      requiredUsings: z.array(z.string()).optional(),
      preFlightChecklist: preFlightSchema.optional(),
    },
    format: formatUnityAnalysis,
  };
}

function formatUnityAnalysis(analysis: unknown): string {
  const { startAwakeFields, requiredUsings, untestableBranches, preFlightChecklist } =
    analysis as UnityAnalysis;
  const lines: string[] = [];

  if (startAwakeFields && startAwakeFields.length > 0) {
    lines.push("\nFields initialized in Start/Awake (must init via Reflection in SetUp):");
    for (const f of startAwakeFields) {
      const note = f.notes ? ` — ${f.notes}` : "";
      lines.push(`  ${f.type} ${f.name} [${f.initIn}]${note}`);
    }
  }

  if (requiredUsings && requiredUsings.length > 0) {
    lines.push("\nRequired project namespace usings (add to test file):");
    for (const ns of requiredUsings) {
      lines.push(`  using ${ns};`);
    }
  }

  if (untestableBranches && untestableBranches.length > 0) {
    lines.push("\nUNTESTABLE BRANCHES — OMIT these entirely, do NOT write Assert.Pass() placeholders:");
    for (const b of untestableBranches) {
      lines.push(`  SKIP: ${b.condition} — ${b.reason}`);
    }
  }

  if (preFlightChecklist) {
    lines.push("\n━━ PRE-FLIGHT CHECKLIST — use as ground truth, do NOT re-derive ━━");

    if (preFlightChecklist.typeInstantiations.length > 0) {
      lines.push("\nType Instantiations:");
      for (const t of preFlightChecklist.typeInstantiations) {
        if (t.pattern === "AddComponent") {
          lines.push(`  ${t.typeName} → go.SetActive(false); go.AddComponent<${t.typeName}>()  [${t.reason}]`);
        } else if (t.parameterless) {
          lines.push(`  ${t.typeName} → new ${t.typeName}()  [${t.reason}]`);
        } else {
          const note = t.constructorNotes ? `  NOTE: ${t.constructorNotes}` : "";
          lines.push(`  ${t.typeName} → new ${t.constructorSignature}  [${t.reason}]${note}`);
        }
      }
    }

    if (preFlightChecklist.computedProperties.length > 0) {
      lines.push("\nComputed Properties (GetField returns null — set underlying data instead):");
      for (const p of preFlightChecklist.computedProperties) {
        lines.push(`  ${p.propertyName}: ${p.getterSummary}`);
        lines.push(`    → Control via: ${p.controlVia}`);
      }
    }
  }

  return lines.join("\n");
}
