import type { CodeAnalyzerOutput } from "./codeAnalyzer";

/**
 * Presentación del análisis para el prompt del generador.
 *
 * Presenta los apartados comunes a cualquier ecosistema. Lo que sigue —los
 * campos que repone el ciclo de vida, las importaciones, las ramas inalcanzables
 * y las decisiones de instanciación— lo presenta el adaptador por OP-09, porque
 * su redacción nombra herramientas concretas.
 *
 * El texto entra en el prompt del generador, así que cambiarlo cambia lo que
 * genera el modelo: la foto de `codeAnalysis.txt` lo vigila.
 */
export function formatCodeAnalysis(
  analysis: CodeAnalyzerOutput,
  formatEcosystem?: (analysis: unknown) => string
): string {
  if (analysis.status !== "READY") return "";

  const { methodSummary, decisionTable, loops, sideEffects, dependencies, privateMembers } = analysis;
  const lines: string[] = [];

  const params = methodSummary.inputs.map(i => `${i.type} ${i.name}`).join(", ");
  lines.push(`Method: ${methodSummary.name}(${params}) → ${methodSummary.output}`);

  if (decisionTable.length > 0) {
    lines.push("\nDecision Table:");
    for (const row of decisionTable) {
      lines.push(`  [${row.branch.toUpperCase()}] ${row.conditions.join(" && ")} → ${row.expectedBehavior}`);
    }
  }

  if (loops.length > 0) {
    lines.push("\nLoops:");
    for (const loop of loops) {
      lines.push(`  ${loop.type}(${loop.condition})`);
    }
  }

  if (sideEffects.length > 0) {
    lines.push("\nSide Effects: " + sideEffects.join("; "));
  }

  if (dependencies.length > 0) {
    lines.push("\nDependencies:");
    for (const dep of dependencies) {
      lines.push(`  ${dep.type} ${dep.name}: [${dep.membersUsed.join(", ")}]`);
    }
  }

  if (privateMembers && privateMembers.length > 0) {
    lines.push("\nPrivate Members (require Reflection):");
    for (const m of privateMembers) {
      if (m.kind === "nestedType" && m.nestedValues && m.nestedValues.length > 0) {
        lines.push(`  [${m.kind}] ${m.type} ${m.name} — values: ${m.nestedValues.join(", ")}`);
      } else {
        lines.push(`  [${m.kind}] ${m.type} ${m.name}`);
      }
    }
  }

  const common = lines.join("\n");
  const ecosystem = formatEcosystem?.(analysis) ?? "";

  // Se concatena con un solo salto porque cada apartado ya trae el suyo
  // delante. Así el texto sale idéntico al de cuando esto era una función
  // sola, que es lo que comprueba la foto.
  return ecosystem ? `${common}\n${ecosystem}` : common;
}
