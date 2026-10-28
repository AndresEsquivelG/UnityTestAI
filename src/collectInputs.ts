// src/collectInputs.ts
import * as vscode from 'vscode';

/** `className` es `null` cuando se dejó vacía: una función sin clase. */
export type NameInputs = { className: string | null; methodName: string };

/**
 * La clase como la manda el panel: vacía es una función sin clase. Si el
 * ecosistema no las acepta, lo dice el pipeline (`locateUnit`), con el motivo.
 */
export function classNameOf(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
}

/**
 * Solicita al usuario el nombre de una clase y un método a través de la webview asociada a un panel.
 * Envía un mensaje a la webview para pedir los datos y espera la respuesta del usuario.
 *
 * @async
 * @function collectClassAndMethod
 * @param {vscode.WebviewPanel} panel - Panel de la extensión que contiene la webview desde donde se obtendrán los datos.
 * @returns {Promise<NameInputs>} Promesa que se resuelve con un objeto que incluye `className` y `methodName`.
 * @throws {Error} Lanza un error si el usuario cancela la entrada o si el método está vacío.
 *
 * @fires requestInputs - Se envía a la webview para solicitar los valores de clase y método.
 * @listens inputsProvided - Evento recibido cuando el usuario proporciona los valores.
 * @listens inputsCancelled - Evento recibido cuando el usuario cancela la entrada.
 */
export async function collectClassAndMethod(panel: vscode.WebviewPanel): Promise<NameInputs> {
  panel.webview.postMessage({ command: 'requestInputs' });

  return new Promise<NameInputs>((resolve, reject) => {
    const sub = panel.webview.onDidReceiveMessage((msg) => {
      if (!msg) return;

      if (msg.command === 'inputsProvided') {
        const { className, methodName } = msg;
        sub.dispose();

        if (!methodName?.trim()) {
          return reject(new Error('El nombre del método es obligatorio.'));
        }
        resolve({ className: classNameOf(className), methodName: String(methodName).trim() });
      }

      if (msg.command === 'inputsCancelled') {
        sub.dispose();
        reject(new Error('Entrada cancelada por el usuario.'));
      }
    });
  });
}
