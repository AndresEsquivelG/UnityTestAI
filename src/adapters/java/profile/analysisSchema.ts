import { z } from "zod";
import type { AnalysisSchemaExtension } from "../../../core/contracts";

/**
 * OP-09 — Extensión del esquema de análisis del ecosistema Java.
 *
 * El prompt del analizador le pide al modelo tres cosas que solo existen en
 * Java (ver `codeAnalyzer.ts`): los campos que llena un contenedor de
 * inyección, las importaciones de tipos de otro paquete y cómo se instancia
 * cada tipo. Sin esta extensión, el esquema común las descartaría al validar
 * la respuesta y el generador no las vería nunca.
 *
 * Además presenta las ramas inalcanzables, que son un campo del núcleo pero
 * cuya redacción nombra llamadas de Java.
 *
 * La forma de instanciar es texto libre y no una enumeración cerrada, por la
 * misma razón que las clases de miembro del núcleo: los valores se los dicta
 * al modelo el perfil, y un valor fuera de la lista no debería tirar el
 * análisis entero.
 */

const injectedFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  initBy: z.string(),
  notes: z.string().optional(),
});

const preFlightSchema = z.object({
  typeInstantiations: z.array(
    z.object({
      typeName: z.string(),
      pattern: z.string(),
      constructorSignature: z.string().nullable(),
      parameterless: z.boolean(),
      constructorNotes: z.string(),
      reason: z.string(),
    })
  ),
  computedProperties: z.array(
    z.object({
      propertyName: z.string(),
      getterSummary: z.string(),
      controlVia: z.string(),
    })
  ),
});

/** Lo que este adaptador lee del análisis, que ya pasó por el esquema fusionado. */
interface JavaAnalysis {
  readonly injectedFields?: readonly z.infer<typeof injectedFieldSchema>[];
  readonly requiredImports?: readonly string[];
  readonly untestableBranches?: readonly { condition: string; reason: string }[];
  readonly preFlightChecklist?: z.infer<typeof preFlightSchema>;
}

export function javaAnalysisSchema(): AnalysisSchemaExtension {
  return {
    fields: {
      injectedFields: z.array(injectedFieldSchema).optional(),
      requiredImports: z.array(z.string()).optional(),
      preFlightChecklist: preFlightSchema.optional(),
    },
    format: formatJavaAnalysis,
  };
}

function formatJavaAnalysis(analysis: unknown): string {
  const { injectedFields, requiredImports, untestableBranches, preFlightChecklist } =
    analysis as JavaAnalysis;
  const lines: string[] = [];

  if (injectedFields && injectedFields.length > 0) {
    lines.push("\nInjected fields (null when created with new — set them in @BeforeEach):");
    for (const field of injectedFields) {
      const note = field.notes ? ` — ${field.notes}` : "";
      lines.push(`  ${field.type} ${field.name} [${field.initBy}]${note}`);
    }
  }

  if (requiredImports && requiredImports.length > 0) {
    lines.push("\nRequired imports (project types from other packages):");
    for (const qualifiedName of requiredImports) {
      lines.push(`  import ${qualifiedName};`);
    }
  }

  if (untestableBranches && untestableBranches.length > 0) {
    lines.push("\nUNTESTABLE BRANCHES — OMIT these entirely, do NOT write assertTrue(true) placeholders:");
    for (const branch of untestableBranches) {
      lines.push(`  SKIP: ${branch.condition} — ${branch.reason}`);
    }
  }

  if (preFlightChecklist) {
    // La ficha de la clase (OP-18) sale del código y no de un modelo: si el
    // analizador se equivocó, es ella la que tiene razón.
    lines.push(
      "\n━━ PRE-FLIGHT CHECKLIST — use as ground truth, do NOT re-derive. Only the CLASS FACTS block outranks it ━━"
    );

    if (preFlightChecklist.typeInstantiations.length > 0) {
      lines.push("\nType Instantiations:");
      for (const type of preFlightChecklist.typeInstantiations) {
        lines.push(`  ${type.typeName} → ${describeInstantiation(type)}  [${type.reason}]`);
      }
    }

    if (preFlightChecklist.computedProperties.length > 0) {
      lines.push("\nComputed Getters (getDeclaredField fails — set the underlying data instead):");
      for (const getter of preFlightChecklist.computedProperties) {
        lines.push(`  ${getter.propertyName}: ${getter.getterSummary}`);
        lines.push(`    → Control via: ${getter.controlVia}`);
      }
    }
  }

  return lines.join("\n");
}

function describeInstantiation(type: z.infer<typeof preFlightSchema>["typeInstantiations"][number]): string {
  const note = type.constructorNotes ? `  NOTE: ${type.constructorNotes}` : "";
  switch (type.pattern) {
    case "factory":
      return `static factory method, not new${note}`;
    case "subclass":
      return `lambda or anonymous class implementing every abstract method${note}`;
    default:
      if (type.parameterless) {
        return `new ${type.typeName}()`;
      }
      return `new ${type.constructorSignature ?? `${type.typeName}(...)`}${note}`;
  }
}
