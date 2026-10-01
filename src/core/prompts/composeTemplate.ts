import type { PromptProfile } from "../contracts";

/**
 * Composición de una plantilla neutra con el perfil del adaptador — consume
 * OP-08.
 *
 * La plantilla es del núcleo y dice qué se le pide al modelo; el perfil es del
 * adaptador y dice cómo se llaman las cosas en su ecosistema. Aquí se juntan.
 *
 * Un marcador se escribe `{{nombre}}` y se resuelve de dos maneras según dónde
 * esté, sin que la plantilla tenga que declararlo:
 *
 *   · **solo en su línea** — es un bloque. Se sustituye por las líneas del
 *     fragmento, respetando la sangría que tenía el marcador. Si el perfil no
 *     trae ese punto, la línea entera desaparece, que es lo que permite a una
 *     plantilla funcionar con un adaptador que no aporta ese bloque;
 *   · **dentro de una línea** — es una palabra. Se sustituye en el sitio, y si
 *     no viene, queda la cadena vacía.
 *
 * Las dos mitades del perfil se buscan en el mismo espacio de nombres: primero
 * el vocabulario, que es obligatorio, y después los fragmentos. Para la
 * plantilla son todos marcadores iguales; la diferencia entre obligatorio y
 * opcional es del contrato, no de la sintaxis.
 */

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;
const BLOCK_LINE = /^([ \t]*)\{\{([A-Za-z][A-Za-z0-9]*)\}\}[ \t]*$/;

export function composeTemplate(template: string, profile: PromptProfile): string {
  const lineEnding = detectLineEnding(template);
  const lines = template.split(/\r?\n/);
  const composed: string[] = [];

  for (const line of lines) {
    const block = BLOCK_LINE.exec(line);

    if (block) {
      const [, indent, name] = block;
      const value = lookUp(profile, name);
      // Ausente o vacío: la línea no se emite. Emitirla dejaría un renglón en
      // blanco que el original no tenía.
      if (!value) {
        continue;
      }
      composed.push(...indentAll(value, indent));
      continue;
    }

    const replaced = line.replace(PLACEHOLDER, (_match, name: string) => lookUp(profile, name));
    // Se reparte en líneas aunque casi siempre sea una sola: un valor con
    // saltos metería "\n" dentro de una plantilla CRLF y el prompt saldría con
    // los dos finales de línea mezclados.
    composed.push(...replaced.split(/\r?\n/));
  }

  return composed.join(lineEnding);
}

/**
 * Nombres de marcador que la plantilla usa. Sirve para comprobar, sin ejecutar
 * el pipeline, que el perfil de un adaptador cubre lo que la plantilla pide.
 */
export function templatePlaceholders(template: string): readonly string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    names.add(match[1]);
  }
  return [...names];
}

function lookUp(profile: PromptProfile, name: string): string {
  const vocabulary = profile.vocabulary as unknown as Record<string, string | undefined>;
  if (typeof vocabulary[name] === "string") {
    return vocabulary[name] as string;
  }

  const fragments = profile.fragments as Record<string, string | undefined>;
  return fragments[name] ?? "";
}

/**
 * Sangra cada línea del fragmento como estaba sangrado el marcador.
 *
 * Las líneas vacías se dejan vacías en lugar de rellenarlas con espacios: un
 * espacio al final de un renglón en blanco es invisible al leer y rompe la
 * comparación contra la foto.
 */
function indentAll(value: string, indent: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `${indent}${line}` : line));
}

/**
 * Final de línea de la plantilla.
 *
 * Los fragmentos se escriben en TypeScript y ahí los saltos son "\n", mientras
 * que las plantillas viven en el repositorio y pueden estar en CRLF. Rearmar
 * todo con el final de línea de la plantilla evita que el prompt salga con los
 * dos mezclados.
 */
function detectLineEnding(template: string): string {
  return template.includes("\r\n") ? "\r\n" : "\n";
}
