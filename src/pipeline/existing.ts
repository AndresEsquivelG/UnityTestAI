import * as fs from "fs";
import { supportsVerification } from "../core/contracts";
import type {
  ArtifactSpec,
  EcosystemAdapter,
  ProjectModel,
  SymbolCandidate,
  UnitTarget,
} from "../core/contracts";
import { artifactAbsolutePath, artifactRelativePath, readArtifact } from "../core/project";
import {
  presentVerification,
  runVerificationStage,
  verificationStageName,
} from "../core/verification";
import { saveAgentOutput } from "../agents/agentOutputSaver";
import { unitLabel } from "../core/prompts";
import { runAndMeasure } from "./check";
import type { PipelineEvent } from "./events";
import {
  buildFullContext,
  describeUnitOrNothing,
  withUnitFacts,
  type GeneratedTest,
} from "./generate";
import { locateUnit } from "./unit";

/**
 * Ejecutar y medir una prueba que ya está escrita, sin generarla de nuevo.
 *
 * Generar cuesta varias llamadas al modelo; compilar, ejecutar y medir no
 * cuesta ninguna. Esto sirve para volver a medir una prueba que se editó a
 * mano, o después de cambiar el código bajo prueba, o cuando el informe se
 * perdió porque otra generación lo pisó.
 *
 * Nada de aquí llama al modelo: si la prueba no compila, se muestran los
 * errores y no se corrige sola. Reintentar la compilación desde el panel sí
 * pasa por el corrector, igual que después de generar.
 */

export interface ExistingTestQuery {
  readonly adapter: EcosystemAdapter;
  /** Raíz desde la que el adaptador construye el modelo (OP-04). */
  readonly rootPath: string;
  /** `null` para una función sin clase, como en la generación. */
  readonly className: string | null;
  readonly methodName: string;
  /** El modelo de lenguaje entra en el nombre del archivo de la prueba. */
  readonly modelId: string;
  /** Archivo abierto: desempata entre funciones sin clase, como al generar. */
  readonly editorPath?: string;
}

export type ExistingTestLookup =
  | { readonly found: true; readonly test: GeneratedTest }
  | { readonly found: false; readonly reason: string };

/** Dónde está la prueba de esa unidad con ese modelo, si ya existe. */
export function locateExistingTest(
  adapter: EcosystemAdapter,
  project: ProjectModel,
  target: UnitTarget,
  targetLocation: SymbolCandidate,
  modelId: string,
): { readonly spec: ArtifactSpec; readonly relativePath: string } | undefined {
  // OP-10 da la misma ruta con la que se escribió al generar.
  const spec = adapter.specifyArtifact({ project, target, targetLocation, modelId });
  if (!fs.existsSync(artifactAbsolutePath(project, spec))) {
    return undefined;
  }
  return { spec, relativePath: artifactRelativePath(spec) };
}

/**
 * La prueba ya escrita de esa unidad, con lo mismo que deja una generación:
 * así el panel puede reintentar la ejecución, abrir el informe y corregir
 * desde el chat como si la acabara de generar.
 *
 * Como no hubo agentes, el contexto de referencia para el corrector es el
 * archivo entero de la unidad, con su ficha (OP-18) si el adaptador la ofrece.
 */
export async function findExistingTest(query: ExistingTestQuery): Promise<ExistingTestLookup> {
  const { adapter, className, methodName, modelId } = query;
  const target: UnitTarget = { className, methodName };

  const project = await adapter.buildProjectModel(query.rootPath);
  // La misma declaración que elige la generación.
  const choice = await locateUnit(adapter, project, target, query.editorPath);
  if (!choice.found) {
    return choice;
  }
  const targetLocation = choice.location;

  const existing = locateExistingTest(adapter, project, target, targetLocation, modelId);
  if (!existing) {
    return {
      found: false,
      reason: `No hay una prueba de ${unitLabel(className, methodName)} generada con ${modelId}: generala primero.`,
    };
  }

  const { spec } = existing;
  const testCode = await readArtifact(project, spec);
  const source = await adapter.readSource(project, targetLocation);
  const facts = describeUnitOrNothing(adapter, source.content, target, targetLocation, project).facts;

  return {
    found: true,
    test: {
      testCode,
      assembledContext: withUnitFacts(
        buildFullContext(className, methodName, source.content, []),
        facts,
      ),
      savedPath: artifactAbsolutePath(project, spec),
      project,
      spec,
      profile: adapter.getPromptProfile(project, target),
      coverageTarget: { filePath: targetLocation.filePath, unit: target },
    },
  };
}

export interface ExistingCheckRequest {
  readonly adapter: EcosystemAdapter;
  /** La prueba que encontró `findExistingTest`. */
  readonly test: GeneratedTest;
  /** Plantilla del informe HTML de cobertura. */
  readonly coverageTemplate: string;
  readonly onEvent?: (event: PipelineEvent) => void;
}

/**
 * Verifica la prueba (OP-13) sin corregirla y, si pasa, la ejecuta y mide su
 * cobertura (OP-14 y OP-15). Avisa lo mismo que `checkGeneratedTest`, así que
 * el panel lo muestra igual.
 *
 * No lanza: un fallo a mitad de camino se informa como verificación
 * interrumpida, porque la prueba sigue escrita.
 */
export async function checkExistingTest(request: ExistingCheckRequest): Promise<void> {
  const { adapter, test } = request;
  const emit = request.onEvent ?? (() => undefined);
  const kind = adapter.capabilities.verification;

  try {
    if (supportsVerification(adapter)) {
      emit({ kind: "stageRunning", stage: "verification", stageName: verificationStageName(kind) });
    }
    const outcome = await runVerificationStage(adapter, test.project, test.spec);
    saveAgentOutput(test.project.rootPath, "verification", outcome);
    emit({ kind: "verification", presentation: presentVerification(kind, outcome) });
    emit({ kind: "verified", status: outcome.status });

    await runAndMeasure({
      adapter,
      project: test.project,
      spec: test.spec,
      verification: outcome.status,
      coverageTarget: test.coverageTarget,
      coverageTemplate: request.coverageTemplate,
      onEvent: request.onEvent,
    });
  } catch (err: any) {
    emit({
      kind: "verification",
      presentation: {
        stageName: verificationStageName(kind),
        status: "notRun",
        summary: `La verificación se interrumpió: ${err.message}`,
        remediation: "Volvé a intentar la verificación.",
        diagnostics: [],
      },
    });
  }
}
