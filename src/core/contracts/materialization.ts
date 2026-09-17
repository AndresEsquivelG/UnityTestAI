import type { ProjectModel } from "./discovery";
import type { SymbolCandidate } from "./analysis";
import type { UnitTarget } from "./target";

/**
 * Bloque Materialización de la interfaz de adaptación — OP-10, OP-11 y OP-12
 * (Tabla 10).
 */

/**
 * Entrada de OP-10.
 *
 * `targetLocation` viaja en la petición porque HU-17 exige replicar en la
 * jerarquía de pruebas el paquete de la clase objetivo: la carpeta destino
 * depende de dónde está declarada la unidad, no solo de su nombre.
 * `modelId` viaja porque hoy el identificador del modelo forma parte del
 * nombre del artefacto (src/agents/testGenerator.ts:96).
 */
export interface ArtifactRequest {
  readonly project: ProjectModel;
  readonly target: UnitTarget;
  /** Declaración seleccionada, tal como la devolvió OP-05. */
  readonly targetLocation: SymbolCandidate;
  /** Identificador del modelo de lenguaje que generó la prueba. */
  readonly modelId: string;
}

/**
 * OP-10 — Especificación del artefacto.
 *
 * `directory` se calcula por artefacto y no es una constante del adaptador:
 * HU-17 exige que en Java la prueba se escriba replicando el paquete de la
 * clase objetivo dentro de la jerarquía de pruebas. `fileName` y `unitName`
 * están separados porque no siempre coinciden: HU-25 exige que en Python el
 * archivo siga la convención de recolección de pytest, que aplica al nombre del
 * archivo y no al de la unidad.
 *
 * Hoy los cuatro campos son literales en el núcleo, en
 * src/agents/testGenerator.ts:89-103: la carpeta "Tests", el nombre
 * `UTIA_<modelo>_<clase>_<método>` y la extensión ".cs".
 */
export interface ArtifactSpec {
  /** Carpeta destino, relativa a `ProjectModel.rootPath`, con separador "/". */
  readonly directory: string;
  /** Nombre del archivo sin extensión. */
  readonly fileName: string;
  /** Extensión con punto inicial. Ej.: ".cs", ".java", ".py". */
  readonly extension: string;
  /** Nombre de la unidad de prueba dentro del archivo. */
  readonly unitName: string;
}

/**
 * OP-12 — Incumplimiento de una precondición del ecosistema.
 *
 * `remediation` es obligatorio porque HU-10 exige que el adaptador reporte el
 * incumplimiento "con una instrucción de subsanación concreta". Un mensaje sin
 * instrucción no cumple el criterio de aceptación.
 *
 * Hoy la única precondición verificada en el pipeline vivo es la existencia de
 * la carpeta Tests/ (src/agents/testGenerator.ts:89-93). La comprobación del
 * archivo .asmdef existe en src/utils/testSaver.ts:30-35, pero ese módulo es
 * código muerto: se importa en webviewManager y nunca se invoca.
 */
export interface PreconditionViolation {
  /** Código estable del incumplimiento, para trazarlo sin depender del mensaje. */
  readonly code: string;
  /** Descripción del incumplimiento, presentable a la persona usuaria. */
  readonly message: string;
  /** Instrucción concreta para subsanarlo. */
  readonly remediation: string;
}
