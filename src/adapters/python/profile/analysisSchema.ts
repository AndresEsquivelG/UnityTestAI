import { z } from "zod";
import type { AnalysisSchemaExtension } from "../../../core/contracts";

/**
 * OP-09 — Extensión del esquema de análisis del ecosistema Python.
 *
 * El prompt del analizador le pide al modelo cuatro cosas que solo existen en
 * Python (ver `codeAnalyzer.ts`): los atributos que `__init__` no crea, lo que
 * la prueba tiene que reemplazar con `monkeypatch`, las líneas de `import` y
 * cómo se crea cada clase. Sin esta extensión, el esquema común las
 * descartaría al validar la respuesta y el generador no las vería nunca: es el
 * mismo motivo por el que la tiene Java.
 *
 * Además presenta las ramas inalcanzables, que son un campo del núcleo pero
 * cuya redacción nombra construcciones de Python.
 *
 * La forma de instanciar es texto libre y no una enumeración cerrada, por la
 * misma razón que en Java: los valores se los dicta al modelo el perfil, y un
 * valor fuera de la lista no debería tirar el análisis entero.
 */

const lateAttributeSchema = z.object({
  name: z.string(),
  setBy: z.string(),
  notes: z.string().optional(),
});

const patchTargetSchema = z.object({
  call: z.string(),
  target: z.string(),
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
interface PythonAnalysis {
  readonly lateAttributes?: readonly z.infer<typeof lateAttributeSchema>[];
  readonly patchTargets?: readonly z.infer<typeof patchTargetSchema>[];
  readonly requiredImports?: readonly string[];
  readonly untestableBranches?: readonly { condition: string; reason: string }[];
  readonly preFlightChecklist?: z.infer<typeof preFlightSchema>;
}

export function pythonAnalysisSchema(): AnalysisSchemaExtension {
  return {
    fields: {
      lateAttributes: z.array(lateAttributeSchema).optional(),
      patchTargets: z.array(patchTargetSchema).optional(),
      requiredImports: z.array(z.string()).optional(),
      preFlightChecklist: preFlightSchema.optional(),
    },
    format: formatPythonAnalysis,
  };
}

function formatPythonAnalysis(analysis: unknown): string {
  const { lateAttributes, patchTargets, requiredImports, untestableBranches, preFlightChecklist } =
    analysis as PythonAnalysis;
  const lines: string[] = [];

  if (lateAttributes && lateAttributes.length > 0) {
    lines.push("\nAttributes created outside __init__ (missing on a new instance — prepare them before the call):");
    for (const attribute of lateAttributes) {
      const note = attribute.notes ? ` — ${attribute.notes}` : "";
      lines.push(`  self.${attribute.name.replace(/^self\./, "")} [created by ${attribute.setBy}]${note}`);
    }
  }

  if (patchTargets && patchTargets.length > 0) {
    lines.push("\nPatch targets (calls the test controls with monkeypatch, patched where the module looks them up):");
    for (const patch of patchTargets) {
      const note = patch.notes ? ` — ${patch.notes}` : "";
      lines.push(`  ${patch.call} → monkeypatch.setattr("${patch.target}", ...)${note}`);
    }
  }

  if (requiredImports && requiredImports.length > 0) {
    lines.push("\nRequired imports (exact lines):");
    for (const line of requiredImports) {
      lines.push(`  ${asImportLine(line)}`);
    }
  }

  if (untestableBranches && untestableBranches.length > 0) {
    lines.push("\nUNTESTABLE BRANCHES — OMIT these entirely, do NOT write assert True placeholders:");
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
      lines.push("\nComputed Properties (assigning them fails — set the underlying data instead):");
      for (const property of preFlightChecklist.computedProperties) {
        lines.push(`  ${property.propertyName}: ${property.getterSummary}`);
        lines.push(`    → Control via: ${property.controlVia}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Una importación como línea de Python. El modelo a veces devuelve solo el
 * nombre con puntos, como en Java: `tienda.modelo.Item` se escribe
 * `from tienda.modelo import Item`.
 */
function asImportLine(value: string): string {
  const trimmed = value.trim();
  if (/^(?:from|import)\s/.test(trimmed)) {
    return trimmed;
  }
  const lastDot = trimmed.lastIndexOf(".");
  return lastDot === -1 ? `import ${trimmed}` : `from ${trimmed.slice(0, lastDot)} import ${trimmed.slice(lastDot + 1)}`;
}

function describeInstantiation(type: z.infer<typeof preFlightSchema>["typeInstantiations"][number]): string {
  const note = type.constructorNotes ? `  NOTE: ${type.constructorNotes}` : "";
  switch (type.pattern) {
    case "factory":
      return `factory method or function, not a direct call${note}`;
    case "subclass":
      return `helper subclass in the test implementing every abstract method${note}`;
    case "member":
      return `an Enum member (${type.typeName}.MEMBER), never ${type.typeName}(...)${note}`;
    default:
      if (type.parameterless) {
        return `${type.typeName}()`;
      }
      return `${type.typeName}(${callParameters(type.constructorSignature)})${note}`;
  }
}

/** Los parámetros de `__init__(self, a, b=1)` como se pasan en la llamada: `a, b=1`. */
function callParameters(signature: string | null): string {
  if (!signature) {
    return "...";
  }
  const inside = /\(([\s\S]*)\)/.exec(signature)?.[1];
  if (inside === undefined) {
    return signature;
  }
  // Las comas de una anotación o de un valor por defecto (`dict[str, int]`,
  // `punto=(0, 0)`) no separan parámetros.
  const parameters: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of inside) {
    depth += "([{".includes(character) ? 1 : ")]}".includes(character) ? -1 : 0;
    if (character === "," && depth === 0) {
      parameters.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  parameters.push(current.trim());
  return parameters
    .filter((parameter) => parameter.length > 0 && parameter !== "self" && parameter !== "cls")
    .join(", ");
}
