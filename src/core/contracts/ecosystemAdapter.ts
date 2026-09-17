import type {
  AdapterDescriptor,
  ApplicabilityResult,
  CapabilityMap,
  DetectionContext,
} from "./identity";
import type { ProjectModel } from "./discovery";
import type { UnitTarget } from "./target";
import type {
  DependencyResolution,
  SourceText,
  SymbolCandidate,
  SymbolLocation,
} from "./analysis";
import type { AnalysisSchemaExtension, PromptProfile } from "./generation";
import type {
  ArtifactRequest,
  ArtifactSpec,
  PreconditionViolation,
} from "./materialization";
import type {
  CoverageReport,
  TestExecutionResult,
  VerificationResult,
} from "./verification";

/**
 * Interfaz de adaptación: las dieciséis operaciones comunes a todo ecosistema,
 * OP-01 a OP-16.
 *
 * DIVISIÓN OBLIGATORIA / OPCIONAL
 *
 * Las once operaciones obligatorias son miembros requeridos. Las cinco
 * opcionales —OP-09, OP-13, OP-14, OP-15 y OP-16— son miembros opcionales de la
 * interfaz, además de estar declaradas en `capabilities`. La doble declaración
 * es deliberada:
 *
 *   · el miembro opcional permite que un adaptador incompleto compile;
 *   · `capabilities` permite al núcleo decidir si omite una etapa sin invocar
 *     nada ni inspeccionar el objeto.
 *
 * Que ambas coincidan es un invariante de tiempo de ejecución que el sistema de
 * tipos no puede expresar; comprobarlo corresponde a las pruebas de contrato.
 *
 * El núcleo no debe consultar `descriptor.id` para decidir su comportamiento:
 * hacerlo reintroduce la condición por ecosistema que esta interfaz existe para
 * eliminar. El identificador es para registro, presentación y trazas.
 */
export interface EcosystemAdapter {
  // ── Identidad ────────────────────────────────────────────────────────────

  /** OP-01 — Metadatos del adaptador. */
  readonly descriptor: AdapterDescriptor;

  /** OP-03 — Capacidades opcionales que el adaptador declara soportar. */
  readonly capabilities: CapabilityMap;

  /**
   * OP-02 — Detección de aplicabilidad a partir de los marcadores de raíz.
   * No debe lanzar: un proyecto ajeno se reporta con `applicable: false`.
   */
  detectApplicability(context: DetectionContext): Promise<ApplicabilityResult>;

  // ── Descubrimiento ───────────────────────────────────────────────────────

  /** OP-04 — Construcción del modelo del proyecto, ya filtrado. */
  buildProjectModel(rootPath: string): Promise<ProjectModel>;

  // ── Análisis ─────────────────────────────────────────────────────────────

  /**
   * OP-05 — Localización de la unidad bajo prueba, distinguiendo la
   * declaración de la invocación.
   */
  locateSymbol(project: ProjectModel, target: UnitTarget): Promise<SymbolLocation>;

  /** OP-06 — Lectura del código fuente en la ubicación determinada. */
  readSource(project: ProjectModel, location: SymbolCandidate): Promise<SourceText>;

  /**
   * OP-07 — Resolución de una referencia lógica de dependencia a su ruta
   * física dentro del proyecto.
   */
  resolveDependency(project: ProjectModel, reference: string): Promise<DependencyResolution>;

  // ── Generación ───────────────────────────────────────────────────────────

  /**
   * OP-08 — Perfil de prompt con el conocimiento propio del ecosistema, ya
   * resuelto para este proyecto.
   *
   * Es una operación y no una propiedad porque el perfil depende del proyecto
   * descubierto y no solo del ecosistema; la justificación está en
   * `PromptProfile`. Es síncrona: todo lo que exija leer el disco se averigua en
   * OP-04 y viaja en `ProjectModel.adapterData`.
   */
  getPromptProfile(project: ProjectModel): PromptProfile;

  /**
   * OP-09 — Extensión del esquema de análisis. OPCIONAL.
   * Presente si y solo si `capabilities.analysisSchemaExtension` es true.
   */
  extendAnalysisSchema?(): AnalysisSchemaExtension;

  // ── Materialización ──────────────────────────────────────────────────────

  /** OP-10 — Especificación del artefacto a escribir. */
  specifyArtifact(request: ArtifactRequest): ArtifactSpec;

  /**
   * OP-11 — Normalización del código generado para ajustarlo a la convención
   * de nomenclatura del ecosistema, según la especificación de OP-10.
   */
  normalizeGeneratedCode(code: string, spec: ArtifactSpec): string;

  /**
   * OP-12 — Verificación de precondiciones antes de escribir el artefacto.
   * Devuelve la lista vacía cuando todas se satisfacen.
   */
  checkPreconditions(
    project: ProjectModel,
    spec: ArtifactSpec
  ): Promise<readonly PreconditionViolation[]>;

  // ── Verificación (firmas provisionales: ver verification.ts) ─────────────

  /**
   * OP-13 — Verificación previa del artefacto generado. OPCIONAL.
   * Presente si y solo si `capabilities.verification` no es "none".
   *
   * Es compilación cuando el ecosistema la contempla y comprobación de
   * importabilidad cuando no. El núcleo la invoca igual en ambos casos: la
   * diferencia se declara, no se programa.
   */
  verifyArtifact?(project: ProjectModel): Promise<VerificationResult>;

  /**
   * OP-14 — Ejecución de las pruebas generadas. OPCIONAL.
   * Presente si y solo si `capabilities.runTests` es true.
   */
  runTests?(project: ProjectModel, spec: ArtifactSpec): Promise<TestExecutionResult>;

  /**
   * OP-15 — Recolección del informe de cobertura de la ejecución. OPCIONAL.
   * Presente si y solo si `capabilities.coverage` es true.
   */
  collectCoverage?(
    project: ProjectModel,
    execution: TestExecutionResult
  ): Promise<CoverageReport>;

  // ── Ciclo de vida ────────────────────────────────────────────────────────

  /**
   * OP-16 — Preparación previa de los artefactos temporales del ecosistema.
   * OPCIONAL. Presente si y solo si `capabilities.lifecycle` es true.
   */
  prepare?(project: ProjectModel): Promise<void>;

  /**
   * OP-16 — Limpieza posterior. OPCIONAL.
   * Presente si y solo si `capabilities.lifecycle` es true. El núcleo debe
   * invocarla aunque una etapa anterior haya fallado.
   */
  cleanup?(project: ProjectModel): Promise<void>;
}

// ── Guardas de capacidad ───────────────────────────────────────────────────
//
// Permiten al núcleo estrechar el tipo del adaptador antes de invocar una
// operación opcional, sin escribir una sola condición por ecosistema.

/** Adaptador que sí verifica el artefacto antes de ejecutarlo (OP-13). */
export type VerifyingAdapter = EcosystemAdapter &
  Required<Pick<EcosystemAdapter, "verifyArtifact">>;

/** Adaptador que sí puede ejecutar pruebas (OP-14). */
export type TestRunningAdapter = EcosystemAdapter &
  Required<Pick<EcosystemAdapter, "runTests">>;

/** Adaptador que sí puede recolectar cobertura (OP-15). */
export type CoverageAdapter = EcosystemAdapter &
  Required<Pick<EcosystemAdapter, "collectCoverage">>;

/** Adaptador que sí extiende el esquema de análisis (OP-09). */
export type SchemaExtendingAdapter = EcosystemAdapter &
  Required<Pick<EcosystemAdapter, "extendAnalysisSchema">>;

/**
 * La guarda no distingue compilación de comprobación de importabilidad: para el
 * núcleo son la misma etapa. Esa diferencia es de presentación y se lee en
 * `capabilities.verification`.
 */
export function supportsVerification(a: EcosystemAdapter): a is VerifyingAdapter {
  return a.capabilities.verification !== "none" && typeof a.verifyArtifact === "function";
}

export function supportsTestRun(a: EcosystemAdapter): a is TestRunningAdapter {
  return a.capabilities.runTests && typeof a.runTests === "function";
}

export function supportsCoverage(a: EcosystemAdapter): a is CoverageAdapter {
  return a.capabilities.coverage && typeof a.collectCoverage === "function";
}

export function supportsSchemaExtension(
  a: EcosystemAdapter
): a is SchemaExtendingAdapter {
  return (
    a.capabilities.analysisSchemaExtension &&
    typeof a.extendAnalysisSchema === "function"
  );
}
