import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeTemplate, templatePlaceholders } from "../core/prompts";
import type { PromptProfile, PromptVocabulary } from "../core/contracts";

/**
 * Vocabulario de un ecosistema que no existe, a propósito: estas pruebas son
 * del compositor, no del adaptador de Unity, y con valores reales no se
 * distinguiría si el texto salió de la plantilla o del perfil.
 */
const VOCABULARY: PromptVocabulary = {
  ecosystem: "Cosmos",
  language: "Lenguaje",
  testFramework: "MarcoDePruebas 7",
  importStatements: "import statements",
  typeKinds: "type or class",
  assertionPrefix: "comprobar.",
  controlFlowKeywords: "si/si no, mientras",
  loopKeywords: "mientras/para",
};

function profileWith(
  fragments: Record<string, string>,
  vocabulary: PromptVocabulary = VOCABULARY
): PromptProfile {
  return { vocabulary, fragments } as PromptProfile;
}

describe("composición de una plantilla neutra", () => {
  describe("marcador dentro de una línea", () => {
    it("sustituye una palabra del vocabulario en su sitio", () => {
      const composed = composeTemplate(
        "Generá pruebas de {{testFramework}} para {{ecosystem}}.",
        profileWith({})
      );

      assert.equal(composed, "Generá pruebas de MarcoDePruebas 7 para Cosmos.");
    });

    it("sustituye todas las apariciones del mismo marcador", () => {
      const composed = composeTemplate(
        "Quitá {{importStatements}} y volvé a poner {{importStatements}}.",
        profileWith({})
      );

      assert.equal(composed, "Quitá import statements y volvé a poner import statements.");
    });

    it("deja la cadena vacía cuando el punto no viene en el perfil", () => {
      const composed = composeTemplate("antes {{ausente}} después", profileWith({}));

      assert.equal(composed, "antes  después");
    });
  });

  describe("marcador solo en su línea", () => {
    it("sustituye la línea por las del fragmento", () => {
      const composed = composeTemplate(
        ["REGLAS:", "{{reglas}}", "FIN"].join("\n"),
        profileWith({ reglas: "- una\n- otra" })
      );

      assert.equal(composed, ["REGLAS:", "- una", "- otra", "FIN"].join("\n"));
    });

    it("conserva la sangría del marcador en cada línea del fragmento", () => {
      const composed = composeTemplate(
        ["lista:", "    {{items}}"].join("\n"),
        profileWith({ items: '"uno",\n"dos"' })
      );

      assert.equal(composed, ['lista:', '    "uno",', '    "dos"'].join("\n"));
    });

    it("no sangra las líneas vacías del fragmento", () => {
      // Un espacio al final de un renglón en blanco no se ve y rompe la foto.
      const composed = composeTemplate(
        "  {{items}}",
        profileWith({ items: "uno\n\ndos" })
      );

      assert.equal(composed, ["  uno", "", "  dos"].join("\n"));
    });

    it("borra la línea entera cuando el punto no viene en el perfil", () => {
      // Es lo que permite que una plantilla funcione con un adaptador que no
      // aporta ese bloque: emitir la línea dejaría un renglón en blanco que el
      // original no tenía.
      const composed = composeTemplate(
        ["antes", "{{ausente}}", "después"].join("\n"),
        profileWith({})
      );

      assert.equal(composed, ["antes", "después"].join("\n"));
    });

    it("borra la línea también cuando el fragmento viene vacío", () => {
      const composed = composeTemplate(
        ["antes", "{{vacio}}", "después"].join("\n"),
        profileWith({ vacio: "" })
      );

      assert.equal(composed, ["antes", "después"].join("\n"));
    });
  });

  describe("finales de línea", () => {
    it("rearma con el final de línea de la plantilla", () => {
      // Los fragmentos se escriben en TypeScript, donde el salto es "\n"; las
      // plantillas viven en el repositorio y pueden estar en CRLF. Mezclarlos
      // dejaría el prompt con los dos.
      const composed = composeTemplate(
        "REGLAS:\r\n{{reglas}}\r\nFIN",
        profileWith({ reglas: "- una\n- otra" })
      );

      assert.equal(composed, "REGLAS:\r\n- una\r\n- otra\r\nFIN");
      assert.ok(!/[^\r]\n/.test(composed));
    });

    it("también cuando el fragmento se sustituye dentro de una línea", () => {
      const composed = composeTemplate(
        "1. {{regla}}\r\nFIN",
        profileWith({ regla: "primera\n   segunda" })
      );

      assert.equal(composed, "1. primera\r\n   segunda\r\nFIN");
      assert.ok(!/[^\r]\n/.test(composed));
    });
  });

  describe("lo que no es un marcador", () => {
    it("no toca las llaves simples de un ejemplo de JSON", () => {
      const template = '{\n  "status": "READY"\n}';

      assert.equal(composeTemplate(template, profileWith({})), template);
    });

    it("no toca los valores de la corrida, que se sustituyen después", () => {
      const template = "método `<method-name>`, código {code}, árbol ${projectTree}";

      assert.equal(composeTemplate(template, profileWith({})), template);
    });
  });

  describe("marcadores que usa una plantilla", () => {
    it("los enumera sin repetir", () => {
      const names = templatePlaceholders(
        "{{uno}} y {{dos}}\n{{uno}}"
      );

      assert.deepEqual([...names].sort(), ["dos", "uno"]);
    });

    it("no confunde una llave simple con un marcador", () => {
      assert.deepEqual(templatePlaceholders('{ "a": 1 }'), []);
    });
  });
});
