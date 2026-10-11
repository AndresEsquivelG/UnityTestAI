import type { PromptExtensionPoint } from "../../../core/contracts";

/**
 * Forma de los fragmentos de cada archivo del perfil: puntos de extensión que
 * existen en el contrato, con su texto. Sirve para que un nombre mal escrito no
 * compile, en lugar de quedar como un fragmento que ninguna plantilla pide.
 */
export type JavaFragments = Partial<Record<PromptExtensionPoint, string>>;
