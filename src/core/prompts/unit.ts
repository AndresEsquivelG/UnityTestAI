/**
 * Cómo se nombra la unidad bajo prueba en los prompts y en los avisos.
 *
 * Las plantillas dicen `<unit>` donde antes decían «`<method-name>` in class
 * `<class-name>`», y `<unit-scope>` donde decían «class `<class-name>`». Las
 * llena el núcleo: con clase sale el mismo texto de antes, letra por letra;
 * sin clase lo dice, para que ningún agente busque una clase que no existe.
 * Es la decisión P1 de la tercera parte de Python (2026-10-26).
 */

/**
 * Lo que va en `<class-name>` sin clase. Ninguna plantilla ni ningún perfil
 * debería pedirlo en ese caso; si uno lo pide, el modelo lee que no hay clase
 * en lugar de un hueco.
 */
export const NO_CLASS = "(no class)";

/** Los marcadores de la unidad, con su valor, en el orden en que se sustituyen. */
export function unitPlaceholders(methodName: string, className: string | null): Record<string, string> {
  return {
    "<unit>":
      className === null
        ? `\`${methodName}\` (a function declared at module level, outside any class)`
        : `\`${methodName}\` in class \`${className}\``,
    "<unit-scope>":
      className === null ? `the module that declares \`${methodName}\`` : `class \`${className}\``,
    "<method-name>": methodName,
    "<class-name>": className ?? NO_CLASS,
  };
}

/** `Clase.método`, o solo el nombre de una función sin clase. */
export function unitLabel(className: string | null, methodName: string): string {
  return className === null ? methodName : `${className}.${methodName}`;
}
