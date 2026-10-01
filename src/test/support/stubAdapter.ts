import type {
  ApplicabilityResult,
  CapabilityMap,
  EcosystemAdapter,
} from "../../core/contracts";

/**
 * Adaptador inventado para ejercitar el registro y la selección.
 *
 * Existe porque esas dos piezas tienen que poder probarse con más de un
 * ecosistema, y hoy solo hay uno de verdad. No imita a ninguno: implementa
 * únicamente lo que la pieza bajo prueba necesita —OP-01, OP-02 y OP-03— y el
 * resto de las operaciones lanzan, de modo que si alguna vez se invocan, la
 * prueba falla en voz alta en lugar de pasar con un valor inventado.
 *
 * No es el adaptador ficticio que hará falta cuando Unity declare capacidades
 * verdaderas: ese tendrá que responder de verdad a las diecisiete operaciones.
 */

/** Operaciones opcionales que el adaptador de mentira puede llegar a declarar. */
type OptionalOperations = Pick<
  EcosystemAdapter,
  | "verifyArtifact"
  | "runTests"
  | "collectCoverage"
  | "extendAnalysisSchema"
  | "prepare"
  | "cleanup"
  | "detectDependencies"
>;

export interface StubAdapterOptions {
  readonly id: string;
  readonly displayName?: string;
  /** Respuesta de OP-02, o el error que se lanza en su lugar. */
  readonly detect?: ApplicabilityResult | Error;
  /** Capacidades declaradas; lo que no se indique va en falso. */
  readonly capabilities?: Partial<CapabilityMap>;
  /**
   * Operaciones opcionales que sí se implementan. Se controla aparte de las
   * capacidades a propósito: así se puede construir un adaptador incoherente y
   * comprobar que el registro lo rechaza.
   */
  readonly optional?: Partial<OptionalOperations>;
  /**
   * Operaciones obligatorias que la prueba sí necesita que respondan. Las que
   * no se indiquen siguen lanzando.
   */
  readonly override?: Partial<EcosystemAdapter>;
}

const NO_CAPABILITIES: CapabilityMap = {
  verification: "none",
  runTests: false,
  coverage: false,
  analysisSchemaExtension: false,
  lifecycle: false,
  dependencyDetection: false,
};

const NOT_APPLICABLE: ApplicabilityResult = {
  applicable: false,
  confidence: 0,
  evidence: [],
};

export function createStubAdapter(options: StubAdapterOptions): EcosystemAdapter {
  const { id } = options;
  const detect = options.detect ?? NOT_APPLICABLE;

  const adapter: EcosystemAdapter = {
    descriptor: {
      id,
      displayName: options.displayName ?? id,
      version: "0.0.0",
      languageIds: [],
    },
    capabilities: { ...NO_CAPABILITIES, ...options.capabilities },

    detectApplicability: async () => {
      if (detect instanceof Error) {
        throw detect;
      }
      return detect;
    },

    buildProjectModel: () => notUsed(id, "buildProjectModel"),
    locateSymbol: () => notUsed(id, "locateSymbol"),
    readSource: () => notUsed(id, "readSource"),
    resolveDependency: () => notUsed(id, "resolveDependency"),
    getPromptProfile: () => notUsed(id, "getPromptProfile"),
    specifyArtifact: () => notUsed(id, "specifyArtifact"),
    normalizeGeneratedCode: () => notUsed(id, "normalizeGeneratedCode"),
    checkPreconditions: () => notUsed(id, "checkPreconditions"),

    ...options.optional,
    ...options.override,
  };

  return adapter;
}

/** Respuesta afirmativa de OP-02 con la confianza indicada. */
export function applicable(
  confidence: number,
  evidence: readonly string[] = []
): ApplicabilityResult {
  return { applicable: true, confidence, evidence };
}

function notUsed(id: string, operation: string): never {
  throw new Error(`El adaptador de mentira "${id}" no implementa ${operation}().`);
}
