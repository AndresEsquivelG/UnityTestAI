/**
 * Bloque Verificación de la interfaz de adaptación — OP-13, OP-14 y OP-15.
 * Las tres operaciones son OPCIONALES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIRMAS PROVISIONALES
 *
 * Estos tres tipos son los únicos de la interfaz que no se derivaron de código
 * existente: en el pipeline actual no hay ninguna invocación de compilación, de
 * ejecución de pruebas ni de recolección de cobertura. Se diseñaron a partir de
 * la salida que se espera de cada herramienta, no de su observación.
 *
 * Antes de darlos por buenos hay que contrastarlos con corridas reales de las
 * cadenas de herramientas de cada ecosistema —Maven, Gradle, JaCoCo, pytest—
 * y con los archivos estructurados que producen. Hasta entonces, este archivo
 * es el primero que debe revisarse ante cualquier discrepancia.
 *
 * `VerificationResult` y `TestExecutionResult` ya se contrastaron con una
 * herramienta real: Unity 2021.3 en modo batch. El de OP-15 sigue sin
 * contrastar.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PreconditionViolation } from "./materialization";

export type DiagnosticSeverity = "error" | "warning";

/**
 * Diagnóstico normalizado de la verificación.
 *
 * Lleva archivo y línea porque el mensaje crudo no basta para presentar el
 * resultado ni para realimentar el error al agente de corrección.
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

/**
 * OP-13 — Resultado de la verificación previa del artefacto.
 *
 * No se llama resultado de compilación porque no siempre hay compilación: en un
 * ecosistema interpretado la etapa equivalente comprueba que el artefacto sea
 * sintácticamente válido y se pueda importar. Qué clase de verificación se
 * ejecutó lo declara `CapabilityMap.verification`.
 *
 * La forma del resultado es la misma en los tres ecosistemas, y por eso los
 * diagnósticos se pueden realimentar al agente de corrección con el mismo
 * código, sin importar qué herramienta los produjo.
 *
 * Son tres estados y no un booleano. Que la herramienta no haya podido correr
 * no dice nada del artefacto: con el editor de Unity abierto sobre el mismo
 * proyecto, el modo batch termina con código 21 y sin un solo diagnóstico.
 * Si eso se informara como fallo, el agente de corrección recibiría una prueba
 * «que no compila» sin ningún error que corregir.
 */
export type VerificationResult = VerificationPassed | VerificationFailed | VerificationNotRun;

/** Lo que tienen en común los dos estados en los que la herramienta sí corrió. */
interface VerificationRun {
  /**
   * En `failed`, los errores que impidieron verificar. En `passed`, solo
   * avisos, si la herramienta los dio.
   */
  readonly diagnostics: readonly Diagnostic[];
  readonly exitCode: number;
  /** Salida cruda de la herramienta, conservada para diagnóstico y trazabilidad. */
  readonly rawOutput: string;
}

/** La herramienta corrió y el artefacto superó la verificación. */
export interface VerificationPassed extends VerificationRun {
  readonly status: "passed";
}

/** La herramienta corrió y rechazó el artefacto, con al menos un diagnóstico de error. */
export interface VerificationFailed extends VerificationRun {
  readonly status: "failed";
}

/**
 * La herramienta no llegó a verificar nada: no está instalada, otro proceso
 * tiene el proyecto tomado, se pasó del tiempo o terminó mal sin diagnósticos.
 *
 * Reusa la forma de un incumplimiento de OP-12 porque cumple el mismo papel:
 * decirle a la persona usuaria qué falta y cómo resolverlo.
 */
export interface VerificationNotRun {
  readonly status: "notRun";
  readonly blocker: PreconditionViolation;
  /** Salida cruda, cuando la herramienta llegó a arrancar. */
  readonly rawOutput?: string;
}

/**
 * Cómo terminó una prueba. `skipped` reúne lo que no pasó ni falló: las
 * omitidas y, en NUnit, las no concluyentes.
 */
export type TestCaseOutcome = "passed" | "failed" | "skipped";

/**
 * Una prueba individual de la corrida, haya pasado o no.
 *
 * Están todas y no solo las que fallan: para juzgar si la prueba generada
 * sirve hay que ver qué casos cubre, y un caso que pasa también puede fijar
 * como correcto un comportamiento dudoso del código.
 */
export interface TestCaseResult {
  /** Nombre completo de la prueba tal como lo reporta el ejecutor. */
  readonly testName: string;
  readonly outcome: TestCaseOutcome;
  /** Duración en milisegundos, cuando el ejecutor la reporta. */
  readonly durationMs?: number;
  /**
   * Por qué falló, por qué se omitió o, en una que pasó, el mensaje con el
   * que pasó. Ese último importa: una prueba que pasa declarándolo, sin
   * comprobar nada, pasa igual que una que comprueba algo.
   */
  readonly message?: string;
  /** Traza de pila de una prueba que falló, cuando el ejecutor la produce. */
  readonly stackTrace?: string;
}

/**
 * OP-14 — Resultado de ejecución.
 *
 * Contrastado con Unity 2021.3 (`-runTests`, informe NUnit 3). De ahí salieron
 * cuatro cambios respecto de la firma provisional:
 *
 *   · Tres estados, igual que la verificación. Con el editor abierto, o si el
 *     proyecto no compila, no hay informe: sin `notRun` eso se leería como una
 *     corrida con cero fallos.
 *   · El informe se conserva como texto y no como ruta: el ejecutor lo deja
 *     en una carpeta temporal que se borra al terminar.
 *   · `skipped` incluye las no concluyentes. NUnit las cuenta aparte, pero no
 *     pasaron ni fallaron, y la interfaz presenta cuatro contadores.
 *   · Cada prueba con su resultado, y no solo las que fallaron: con los
 *     contadores solos no se sabe qué casos cubre la prueba generada.
 */
export type TestExecutionResult = TestRunPassed | TestRunFailed | TestRunNotRun;

/** Lo que tienen en común los dos estados en los que las pruebas sí corrieron. */
interface TestRunCompleted {
  /** Siempre `passed + failed + skipped`. */
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  /** Cada prueba, en el orden del informe. */
  readonly cases: readonly TestCaseResult[];
  readonly exitCode: number;
  /** Informe crudo del ejecutor, conservado para diagnóstico y trazabilidad. */
  readonly rawReport: string;
}

/** Corrieron y ninguna falló. Puede haber omitidas. */
export interface TestRunPassed extends TestRunCompleted {
  readonly status: "passed";
}

/** Corrieron y al menos una falló. */
export interface TestRunFailed extends TestRunCompleted {
  readonly status: "failed";
}

/**
 * No se llegó a ejecutar ninguna prueba: la herramienta no está, otro proceso
 * tiene el proyecto, la prueba no compila, se agotó el tiempo o el filtro no
 * encontró ninguna prueba. Un informe con cero pruebas cae aquí y no en
 * `passed`: Unity termina con código 0 aunque no haya ejecutado nada.
 */
export interface TestRunNotRun {
  readonly status: "notRun";
  readonly blocker: PreconditionViolation;
  /** Salida cruda, cuando la herramienta llegó a arrancar. */
  readonly rawOutput?: string;
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
 * OP-15 — Informe de cobertura, global y por archivo.
 *
 * La cobertura de decisión es opcional porque no todas las herramientas la
 * entregan, y algunas solo si se activa expresamente: el tipo tiene que admitir
 * un adaptador que entregue únicamente cobertura de línea.
 */
export interface CoverageReport {
  readonly line: CoverageMetric;
  readonly decision?: CoverageMetric;
  readonly byFile: readonly FileCoverage[];
}
