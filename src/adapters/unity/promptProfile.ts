import type { ProjectModel, PromptProfile } from "../../core/contracts";

/**
 * OP-08 — Perfil de prompt del ecosistema Unity.
 *
 * Vacío a propósito. Todo el conocimiento de Unity y de C# sigue viviendo hoy
 * dentro de las plantillas de `prompts/`, y sacarlo de ahí es un trabajo
 * aparte: hay que separar cada plantilla en una parte neutra y un fragmento del
 * ecosistema, comprobando que el prompt resultante no cambia.
 *
 * Mientras tanto, un perfil sin fragmentos es la declaración honesta de dónde
 * está el conocimiento. Devolver fragmentos a medias haría creer que la
 * separación ya ocurrió.
 *
 * Recibe el proyecto porque el perfil depende de él: la versión del editor
 * viaja en `adapterData` y de ella dependerán, por ejemplo, las APIs que se
 * pueden usar en las pruebas generadas.
 */
export function unityPromptProfile(_project: ProjectModel): PromptProfile {
  return { fragments: {} };
}
