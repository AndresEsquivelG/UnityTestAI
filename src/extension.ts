import * as vscode from 'vscode';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createWebviewPanel } from './webview/webviewManager';
import { AdapterRegistry, selectEcosystem } from './core/adapters';
import type { DetectionContext } from './core/contracts';
import { UnityAdapter } from './adapters/unity/unityAdapter';

dotenv.config({ path: path.join(__dirname, "..", ".env") });

/**
 * Composición del registro de adaptadores.
 *
 * Este es el único archivo que importa un adaptador concreto. El resto del
 * núcleo trabaja contra la interfaz y recibe la lista ya compuesta, así que
 * incorporar un ecosistema nuevo se reduce a una línea aquí.
 *
 * El orden de alta es la preferencia: si dos adaptadores reclaman el mismo
 * proyecto con la misma confianza, gana el primero.
 */
function createRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new UnityAdapter());
  return registry;
}

export function activate(context: vscode.ExtensionContext) {
  const registry = createRegistry();

  const disposable = vscode.commands.registerCommand('UnityTestIA.generateTest', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No hay ningún editor activo.');
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No hay un workspace abierto.');
      return;
    }

    const document = editor.document;

    const detection: DetectionContext = {
      rootPath: workspaceFolder.uri.fsPath,
      activeFile: { path: document.uri.fsPath, languageId: document.languageId },
    };

    const selection = await selectEcosystem(registry.list(), detection);

    // Sin ecosistema reconocido no se abre el panel. Antes sí se abría: el
    // árbol del proyecto salía vacío, el pipeline gastaba todas las llamadas al
    // modelo y la corrida moría al final, al no encontrar dónde escribir la
    // prueba. Fallar antes de la primera llamada cuesta menos y se explica
    // mejor.
    if (!selection.selected) {
      const consulted = selection.rejected
        .map((entry) => entry.adapter.descriptor.displayName)
        .join(', ');
      vscode.window.showErrorMessage(
        `No se reconoció el ecosistema del proyecto en "${detection.rootPath}". ` +
        `Se consultó: ${consulted || 'ningún adaptador registrado'}.`
      );
      return;
    }

    if (selection.ambiguous) {
      // Se elige de todos modos, por orden de registro, pero conviene saberlo:
      // este es el caso que justifica el selector manual de ecosistema.
      vscode.window.showWarningMessage(
        `Más de un ecosistema reclama el proyecto con la misma confianza. ` +
        `Se usará "${selection.active.adapter.descriptor.displayName}".`
      );
    }

    await createWebviewPanel(
      context,
      { code: document.getText(), path: document.uri.fsPath },
      selection.active
    );
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
