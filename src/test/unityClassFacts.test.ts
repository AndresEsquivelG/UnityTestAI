import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeUnityUnit } from "../adapters/unity/classFacts";
import { findEnclosingNamespace, maskCommentsAndStrings } from "../adapters/unity/csharpSource";
import type { SymbolCandidate } from "../core/contracts";

/**
 * Ficha de la clase en Unity (OP-18). El caso que la originó es
 * `NodeReader.GetAreaIdFromIndexes`, de SanAndreasUnity: el recortador quitó el
 * espacio de nombres, ningún agente lo vio y la prueba no compiló.
 */

/** La posición de `text`, como la devolvería OP-05. */
function locationOf(code: string, text: string): SymbolCandidate {
  const before = code.slice(0, code.indexOf(text)).split("\n");
  return {
    filePath: "Assets/Scripts/Archivo.cs",
    line: before.length,
    column: before[before.length - 1].length + 1,
    signature: text,
  };
}

function namespaceAt(code: string, text: string): string {
  const { line, column } = locationOf(code, text);
  return findEnclosingNamespace(maskCommentsAndStrings(code), line, column);
}

const NODE_FILE = [
  "using System;",
  "using UGameCore.Utilities;",
  "using UnityEngine;",
  "",
  "namespace SanAndreasUnity.Importing.Paths",
  "{",
  "    public static class NodeReader",
  "    {",
  "        public static int GetAreaIdFromIndexes(Vector2Int areaIndexes)",
  "        {",
  "            return areaIndexes.y * 8 + areaIndexes.x;",
  "        }",
  "    }",
  "}",
].join("\n");

const TARGET = { className: "NodeReader", methodName: "GetAreaIdFromIndexes" };

describe("ficha de la clase en Unity (OP-18)", () => {
  describe("espacio de nombres que envuelve una posición", () => {
    it("lee uno compuesto", () => {
      assert.equal(namespaceAt(NODE_FILE, "GetAreaIdFromIndexes"), "SanAndreasUnity.Importing.Paths");
    });

    it("une los anidados", () => {
      const code = "namespace A\n{\n  namespace B.C\n  {\n    class D { void M() { } }\n  }\n}\n";
      assert.equal(namespaceAt(code, "M()"), "A.B.C");
    });

    it("con dos en el archivo, elige el que envuelve la posición", () => {
      const code = "namespace A\n{\n  class X { void M() { } }\n}\nnamespace B\n{\n  class Y { void N() { } }\n}\n";
      assert.equal(namespaceAt(code, "M()"), "A");
      assert.equal(namespaceAt(code, "N()"), "B");
    });

    it("funciona con todo en una sola línea", () => {
      assert.equal(namespaceAt("namespace A { class B { void M() { } } }", "M()"), "A");
    });

    it("una posición fuera de todo bloque no tiene espacio de nombres", () => {
      const code = "namespace A\n{\n  class X { }\n}\nclass Y { void M() { } }\n";
      assert.equal(namespaceAt(code, "M()"), "");
    });

    it("no se confunde con uno escrito en un comentario", () => {
      const code = "// namespace Viejo {\nclass X { void M() { } }\n// }\n";
      assert.equal(namespaceAt(code, "M()"), "");
    });

    it("no se confunde con uno escrito en una cadena", () => {
      const code = 'class X { string a = "namespace Texto {"; void M() { } string b = "}"; }';
      assert.equal(namespaceAt(code, "M()"), "");
    });

    it("cuenta bien las líneas de un archivo con saltos de Windows", () => {
      assert.equal(
        namespaceAt(NODE_FILE.replace(/\n/g, "\r\n"), "GetAreaIdFromIndexes"),
        "SanAndreasUnity.Importing.Paths"
      );
    });
  });

  describe("texto de la ficha", () => {
    it("da el espacio de nombres y la línea que necesita la prueba", () => {
      const facts = describeUnityUnit(NODE_FILE, TARGET, locationOf(NODE_FILE, "GetAreaIdFromIndexes"));

      assert.match(facts, /`NodeReader` is declared inside `namespace SanAndreasUnity\.Importing\.Paths \{ \}`\./);
      assert.match(facts, /^The test file needs: using SanAndreasUnity\.Importing\.Paths;$/m);
      assert.match(facts, /GetType\("NodeReader"\) finds nothing/);
    });

    it("no copia los demás using del archivo, que pueden volver ambiguo un nombre", () => {
      const facts = describeUnityUnit(NODE_FILE, TARGET, locationOf(NODE_FILE, "GetAreaIdFromIndexes"));
      assert.ok(!facts.includes("UGameCore.Utilities"));
    });

    it("una clase sin espacio de nombres no tiene ficha (MatchThreeGame)", () => {
      const code = [
        "using UnityEngine;",
        "",
        "public static class Utilities",
        "{",
        "    public static bool AreVerticalOrHorizontalNeighbors(Shape s1, Shape s2) { return true; }",
        "}",
      ].join("\n");
      const target = { className: "Utilities", methodName: "AreVerticalOrHorizontalNeighbors" };

      assert.equal(describeUnityUnit(code, target, locationOf(code, target.methodName)), "");
    });

    it("un espacio de nombres escrito en un comentario no genera ficha", () => {
      const code = "// namespace Viejo {\nclass X { void M() { } }\n// }\n";
      const target = { className: "X", methodName: "M" };

      assert.equal(describeUnityUnit(code, target, locationOf(code, "M()")), "");
    });

    it("sin clase no hay nada que decir", () => {
      const target = { className: null, methodName: "GetAreaIdFromIndexes" };
      assert.equal(describeUnityUnit(NODE_FILE, target, locationOf(NODE_FILE, target.methodName)), "");
    });
  });
});
