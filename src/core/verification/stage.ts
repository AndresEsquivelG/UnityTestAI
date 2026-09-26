import {
  supportsVerification,
  type ArtifactSpec,
  type Diagnostic,
  type EcosystemAdapter,
  type ProjectModel,
  type VerificationKind,
  type VerificationResult,
} from "../contracts";

/**
 * Etapa de verificación del artefacto escrito (OP-13).
 *
 * Vive fuera del panel para que se pueda probar sin el editor, y en particular
 * el camino en el que el adaptador no ofrece verificación: si solo lo
 * recorriera un ecosistema que todavía no existe, un error ahí aparecería
 * recién cuando ese ecosistema llegue.
 */

/** Resultado de la etapa: el de OP-13, o que la etapa no aplica. */
export type VerificationOutcome = VerificationResult | { readonly status: "notApplicable" };

export async function runVerificationStage(
  adapter: EcosystemAdapter,
  project: ProjectModel,
  spec: ArtifactSpec
): Promise<VerificationOutcome> {
  if (!supportsVerification(adapter)) {
    return { status: "notApplicable" };
  }

  try {
    return await adapter.verifyArtifact(project, spec);
  } catch (error) {
    // Cuando se llega aquí la prueba ya está escrita. Que el adaptador falle
    // no justifica perder la corrida, pero tampoco se puede dar por verificada.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: "notRun",
      blocker: {
        code: "core.verification-crashed",
        message: `La verificación se interrumpió por un error del adaptador: ${reason}`,
        remediation: "Volvé a intentar la verificación; si se repite, el error es del adaptador.",
      },
    };
  }
}

/** Diagnóstico listo para mostrar, sin que la interfaz tenga que componerlo. */
export interface PresentedDiagnostic {
  readonly severity: Diagnostic["severity"];
  /** `ruta:línea:columna`, la forma que los editores reconocen como enlace. */
  readonly location: string;
  readonly code?: string;
  readonly message: string;
}

export interface VerificationPresentation {
  readonly stageName: string;
  readonly status: VerificationOutcome["status"];
  readonly summary: string;
  readonly remediation?: string;
  readonly diagnostics: readonly PresentedDiagnostic[];
}

/**
 * Nombre de la etapa según la clase de verificación declarada. Sale de la
 * declaración de OP-03, no del ecosistema: la interfaz dice «Compilación» sin
 * saber qué se compiló.
 */
export function verificationStageName(kind: VerificationKind): string {
  switch (kind) {
    case "compile":
      return "Compilación";
    case "importCheck":
      return "Comprobación de importabilidad";
    case "none":
      return "Verificación";
  }
}

export function presentVerification(
  kind: VerificationKind,
  outcome: VerificationOutcome
): VerificationPresentation {
  const stageName = verificationStageName(kind);

  switch (outcome.status) {
    case "notApplicable":
      return {
        stageName,
        status: outcome.status,
        summary: "El ecosistema no ofrece verificación previa: la etapa no aplica.",
        diagnostics: [],
      };

    case "notRun":
      return {
        stageName,
        status: outcome.status,
        summary: `No se pudo verificar. ${outcome.blocker.message}`,
        remediation: outcome.blocker.remediation,
        diagnostics: [],
      };

    case "passed": {
      const warnings = outcome.diagnostics.length;
      return {
        stageName,
        status: outcome.status,
        summary:
          warnings === 0
            ? "La prueba pasó la verificación."
            : `La prueba pasó la verificación con ${plural(warnings, "aviso", "avisos")}.`,
        diagnostics: outcome.diagnostics.map(presentDiagnostic),
      };
    }

    case "failed":
      return {
        stageName,
        status: outcome.status,
        summary: `La prueba no pasó la verificación: ${plural(outcome.diagnostics.length, "error", "errores")}.`,
        diagnostics: outcome.diagnostics.map(presentDiagnostic),
      };
  }
}

function presentDiagnostic(diagnostic: Diagnostic): PresentedDiagnostic {
  const column = diagnostic.column === undefined ? "" : `:${diagnostic.column}`;
  return {
    severity: diagnostic.severity,
    location: `${diagnostic.filePath}:${diagnostic.line}${column}`,
    code: diagnostic.code,
    message: diagnostic.message,
  };
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
