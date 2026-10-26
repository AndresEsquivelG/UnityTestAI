import type { PreconditionViolation } from "../../../core/contracts";
import type { PythonInterpreter } from "./interpreter";
import type { PythonRunResult } from "./runtime";

/**
 * Por qué no se pudo comprobar, ejecutar o medir, dicho de forma que la
 * persona sepa qué falta y cómo resolverlo.
 *
 * Cada caso sale de la prueba a mano del 2026-10-25 (Python 3.14.3, pytest
 * 9.1.1, coverage 7.17.0, Windows), provocado a propósito.
 */

/** Cómo se nombra, en los avisos, lo que la corrida iba a hacer. */
export interface PythonActivity {
  /** En infinitivo: «comprobar la prueba», «ejecutar las pruebas». */
  readonly doing: string;
  /** Lo que se vuelve a intentar: «la comprobación», «la ejecución». */
  readonly retry: string;
}

/** Recordatorio para todo lo que se arregla instalando o cambiando el PATH. */
const RESTART_VSCODE =
  "Si lo acabás de instalar o cambiar, cerrá VS Code entero y volvé a abrirlo: la extensión ve las variables de entorno de cuando arrancó.";

export function interpreterMissing(sawStoreAlias: boolean): PreconditionViolation {
  return {
    code: "python.interpreter-missing",
    message: sawStoreAlias
      ? "No se encontró Python: el proyecto no tiene un entorno virtual, y el python del PATH es el atajo de la Tienda de Windows, que no es un Python instalado."
      : "No se encontró Python: el proyecto no tiene un entorno virtual y no hay python en el PATH.",
    remediation: `Instalá Python (python.org), o creá un entorno virtual en la raíz del proyecto (python -m venv .venv), e instalá ahí pytest y coverage. ${RESTART_VSCODE}`,
  };
}

export function virtualEnvironmentBroken(name: string, detail: string): PreconditionViolation {
  return {
    code: "python.venv-broken",
    message: `El entorno virtual "${name}" del proyecto no arranca: ${detail}`,
    remediation: `Suele pasar cuando se desinstaló o se actualizó el Python con el que se creó. Volvé a crearlo (python -m venv ${name}) e instalá ahí las bibliotecas del proyecto, pytest y coverage.`,
  };
}

export function pytestMissing(interpreter: PythonInterpreter): PreconditionViolation {
  return {
    code: "python.pytest-missing",
    message: `pytest no está instalado en el Python que usa el proyecto (${interpreter.commandLine}, versión ${interpreter.version}).`,
    remediation: `Instalalo en una terminal abierta en la raíz del proyecto: ${interpreter.commandLine} -m pip install pytest coverage. coverage hace falta para medir.`,
  };
}

/** `commandLine` es el de `PythonInterpreter`: OP-15 no ve el intérprete, solo lo que dejó la ejecución. */
export function coverageMissing(commandLine: string): PreconditionViolation {
  return {
    code: "python.coverage-missing",
    message: `coverage no está instalado en el Python que usa el proyecto (${commandLine}), así que la prueba se ejecutó sin medir.`,
    remediation: `Instalalo en una terminal abierta en la raíz del proyecto: ${commandLine} -m pip install coverage, y volvé a intentar la ejecución.`,
  };
}

/**
 * Las formas de fallar que no dependen de lo que la corrida iba a hacer: no
 * arrancó o se agotó el tiempo. Devuelve `undefined` si no pasó ninguna.
 */
export function runBlocker(
  run: PythonRunResult,
  activity: PythonActivity,
  timeoutMs: number
): PreconditionViolation | undefined {
  if (run.spawnError) {
    return {
      code: "python.failed-to-start",
      message: `No se pudo lanzar Python para ${activity.doing}: ${run.spawnError}`,
      remediation: "Comprobá que Python funcione corriendo «python --version» en una terminal abierta en la raíz del proyecto.",
    };
  }
  if (run.timedOut) {
    return {
      code: "python.timeout",
      message: `Python no terminó de ${activity.doing} en ${Math.round(timeoutMs / 60000)} minutos y se detuvo.`,
      remediation: `Puede ser una prueba que no termina, o un módulo del proyecto que hace algo largo al importarse (leer la entrada, conectarse a la red). Revisalo y volvé a intentar ${activity.retry}.`,
    };
  }
  return undefined;
}

/** Dónde quedó la salida, para el aviso de un fallo que no se reconoció. */
export function savedOutputHint(stage: "verification" | "test-run"): string {
  return `La salida completa quedó en AgentOutputs/${stage}/${stage}-output.json.`;
}
