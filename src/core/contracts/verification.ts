/**
 * Bloque Verificación de la interfaz de adaptación — OP-13, OP-14 y OP-15
 * (Tabla 10). Las tres operaciones son OPCIONALES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIRMAS PROVISIONALES
 *
 * Estos tres tipos son los únicos de la interfaz que no se derivaron de código
 * existente: en el pipeline actual no hay ninguna invocación de compilación,
 * de ejecución de pruebas ni de recolección de cobertura. Se derivaron de los
 * criterios de aceptación de HU-12, HU-13 y HU-14, que describen la salida
 * esperada pero no su forma.
 *
 * HU-41 (caracterización manual de las cadenas de herramientas de Java y
 * Python) es la historia que debe respaldarlos con observaciones reales de
 * Maven, Gradle, JaCoCo y pytest. Hasta entonces, este archivo es el que debe
 * revisarse primero ante cualquier discrepancia.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type DiagnosticSeverity = "error" | "warning";

/**
 * Diagnóstico normalizado de compilación.
 *
 * HU-12 exige presentar el resultado "con los diagnósticos normalizados por
 * archivo y línea", y HU-35 exige realimentar los errores reales de
 * compilación al agente de corrección: el mensaje crudo no basta, hace falta
 * la ubicación.
 */
export interface Diagnostic {
  /** Ruta relativa a `ProjectModel.rootPath`. */
  readonly filePath: string;
  /** Línea del diagnóstico, base 1. */
  readonly line: number;
  /** Columna, base 1, cuando la herramienta la reporta. */
  readonly column?: number;
  readonly severity: DiagnosticSeverity;
  /** Código de la herramienta cuando existe. Ej.: "CS0311". */
  readonly code?: string;
  readonly message: string;
}

/** OP-13 — Resultado de compilación. */
export interface CompilationResult {
  readonly succeeded: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly exitCode: number;
  /** Salida cruda de la herramienta, conservada para diagnóstico y trazabilidad. */
  readonly rawOutput: string;
}

/** Prueba individual que no pasó. */
export interface TestFailure {
  /** Nombre de la prueba tal como lo reporta el ejecutor. */
  readonly testName: string;
  readonly message: string;
  /** Traza de pila cuando el ejecutor la produce. */
  readonly stackTrace?: string;
}

/**
 * OP-14 — Resultado de ejecución.
 *
 * Los cuatro contadores son los que HU-13 exige mostrar en la interfaz:
 * "el total de pruebas, exitosas, fallidas y omitidas".
 */
export interface TestExecutionResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failures: readonly TestFailure[];
  readonly exitCode: number;
  /** Ruta del informe crudo producido por el ejecutor, si lo hubo. */
  readonly rawReportPath?: string;
}

/** Porcentaje cubierto junto con los conteos que lo sustentan. */
export interface CoverageMetric {
  readonly covered: number;
  readonly total: number;
  /** Porcentaje en el intervalo [0, 100]. */
  readonly percentage: number;
}

/** Cobertura de un archivo concreto. */
export interface FileCoverage {
  /** Ruta relativa a `ProjectModel.rootPath`. */
  readonly filePath: string;
  readonly line: CoverageMetric;
  readonly decision?: CoverageMetric;
}

/**
 * OP-15 — Informe de cobertura.
 *
 * HU-14 exige el porcentaje "de línea y de decisión, global y por archivo".
 * La cobertura de decisión es opcional porque HU-29 —cobertura de decisión en
 * Python— está declarada como holgura de la épica E4 y es la primera historia
 * que se sacrifica si el cronograma se ajusta: el tipo tiene que admitir un
 * adaptador que entregue solo cobertura de línea.
 */
export interface CoverageReport {
  readonly line: CoverageMetric;
  readonly decision?: CoverageMetric;
  readonly byFile: readonly FileCoverage[];
}
