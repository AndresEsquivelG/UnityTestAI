import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findMethodDeclarations,
  findTypeBodies,
  maskCommentsAndStrings,
} from "../adapters/unity/csharpSource";

describe("lectura léxica de C#", () => {
  describe("enmascarado de comentarios y cadenas", () => {
    it("conserva la longitud y los saltos de línea", () => {
      const source = 'var a = "hola";\n// comentario\nvar b = 1;\n';

      const masked = maskCommentsAndStrings(source);

      assert.equal(masked.length, source.length);
      assert.equal(masked.split("\n").length, source.split("\n").length);
    });

    it("borra el contenido de comentarios y cadenas, y deja el código", () => {
      const masked = maskCommentsAndStrings('var a = "texto"; // nota\nvar b = 2;');

      assert.ok(!masked.includes("texto"));
      assert.ok(!masked.includes("nota"));
      assert.ok(masked.includes("var a ="));
      assert.ok(masked.includes("var b = 2;"));
    });

    it("no se confunde con las llaves que viven dentro de una cadena", () => {
      const source = 'class C { string s = "} class D {"; void M() { } }';

      const bodies = findTypeBodies(maskCommentsAndStrings(source), "C");

      assert.equal(bodies.length, 1);
      assert.equal(source.slice(bodies[0].start, bodies[0].end).includes("void M()"), true);
    });
  });

  describe("declaraciones de método", () => {
    const declare = (body: string) => {
      const source = `class C\n{\n${body}\n}\n`;
      const masked = maskCommentsAndStrings(source);
      const [range] = findTypeBodies(masked, "C");
      return (methodName: string) => findMethodDeclarations(masked, source, range, methodName);
    };

    it("reconoce una declaración con cuerpo", () => {
      const find = declare("    public void Run(int times)\n    {\n    }");

      assert.deepEqual(
        find("Run").map((declaration) => declaration.signature),
        ["public void Run(int times)"]
      );
    });

    it("reconoce un tipo de retorno con genéricos", () => {
      const find = declare("    public Dictionary<string, int> Tally(List<int> values) { return null; }");

      assert.equal(find("Tally").length, 1);
    });

    it("descarta las invocaciones", () => {
      const find = declare("    void Caller()\n    {\n        Run(1);\n        return;\n    }");

      assert.deepEqual(find("Run"), []);
    });

    it("descarta las funciones locales", () => {
      const find = declare(
        "    void Caller()\n    {\n        void Run(int times)\n        {\n        }\n    }"
      );

      assert.deepEqual(find("Run"), []);
    });

    it("ubica la declaración en su línea y columna", () => {
      const find = declare("    public void Run()\n    {\n    }");
      const [declaration] = find("Run");

      assert.equal(declaration.line, 3);
      assert.equal(declaration.column, 17);
    });
  });
});
