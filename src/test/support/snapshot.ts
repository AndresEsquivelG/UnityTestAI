import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

/**
 * Comparación contra una foto guardada en disco.
 *
 * Existe para lo que viene: al separar cada plantilla en parte neutra y
 * fragmentos del adaptador, el núcleo tiene que volver a armar exactamente el
 * mismo texto. Un espacio de más no rompe la compilación ni falla ninguna otra
 * prueba; solo empeora en silencio lo que genera el modelo. La foto convierte
 * ese riesgo invisible en una diferencia que se ve.
 *
 * La foto se guarda en el repositorio, no en la carpeta de compilación: la
 * gracia es que el cambio aparezca en el diff y alguien lo mire.
 */

const UPDATE = process.env.UPDATE_PROMPT_SNAPSHOTS === "1";

const SNAPSHOT_DIRECTORY = ["src", "test", "snapshots", "prompts"];

/**
 * Los finales de línea se normalizan a "\n" en los dos lados.
 *
 * Es la única excepción a comparar letra por letra, y es necesaria: las
 * plantillas viven en el repositorio y `core.autocrlf` decide con qué final de
 * línea quedan al descargarlas. Sin normalizar, la misma foto pasaría en una
 * máquina y fallaría en otra sin que nada hubiera cambiado. Al modelo esa
 * diferencia no le cambia nada.
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Raíz del repositorio, deducida desde la ubicación de este módulo ya
 * compilado: out-test/test/support → out-test/test → out-test → raíz.
 *
 * Se comprueba en lugar de confiar, porque si la compilación cambiara de
 * disposición, las fotos se escribirían en un sitio cualquiera y la prueba
 * pasaría sin comparar nada.
 */
function repositoryRoot(): string {
  const root = path.resolve(__dirname, "..", "..", "..");
  if (!fs.existsSync(path.join(root, "package.json"))) {
    throw new Error(
      `No se encontró la raíz del repositorio desde ${__dirname}. ` +
      `Cambió la disposición de la compilación de pruebas.`
    );
  }
  return root;
}

function snapshotPath(name: string): string {
  return path.join(repositoryRoot(), ...SNAPSHOT_DIRECTORY, `${name}.txt`);
}

/**
 * Compara el texto con su foto. Con UPDATE_PROMPT_SNAPSHOTS=1 la reescribe en
 * lugar de comparar, que es lo que hace `npm run snapshot:prompts`.
 */
export function assertPromptSnapshot(name: string, actual: string): void {
  const file = snapshotPath(name);
  const normalized = normalize(actual);

  if (UPDATE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, normalized, "utf8");
    return;
  }

  if (!fs.existsSync(file)) {
    assert.fail(
      `Falta la foto "${name}". Generala con \`npm run snapshot:prompts\` y ` +
      `revisá la diferencia antes de aceptarla.`
    );
  }

  const expected = normalize(fs.readFileSync(file, "utf8"));

  assert.equal(
    normalized,
    expected,
    `El prompt "${name}" ya no coincide con su foto. Si el cambio es ` +
    `deliberado, regenerala con \`npm run snapshot:prompts\` y revisá el diff.`
  );
}
