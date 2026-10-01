/**
 * Copia las plantillas de prompt junto al constructor ya compilado.
 *
 * `promptBuilder` busca las plantillas en la carpeta hermana de la suya
 * (`src/prompts/promptBuilder.ts:4`). Empaquetado con webpack eso cae en la raíz
 * del proyecto y funciona; compilado para las pruebas, el módulo queda en
 * `out-test/prompts/` y ahí no hay ninguna plantilla.
 *
 * Copiarlas es preferible a cambiar cómo las busca el constructor: la foto tiene
 * que ejercitar el módulo de producción tal cual es, sin un camino especial para
 * las pruebas que después no se use nunca.
 *
 * No se usa `fs.cpSync`: con `recursive` termina el proceso con código 127 y sin
 * mensaje en esta combinación de Node y Windows. Copiar archivo por archivo es
 * aburrido y funciona en todas partes.
 */
const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "prompts");
const TARGET = path.join(__dirname, "..", "out-test", "prompts");

fs.mkdirSync(TARGET, { recursive: true });

let copied = 0;
for (const name of fs.readdirSync(SOURCE)) {
  if (!name.endsWith(".txt")) {
    continue;
  }
  fs.copyFileSync(path.join(SOURCE, name), path.join(TARGET, name));
  copied += 1;
}

if (copied === 0) {
  console.error(`No se copió ninguna plantilla desde ${SOURCE}.`);
  process.exit(1);
}
