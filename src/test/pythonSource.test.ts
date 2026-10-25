import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bodyStatements,
  collapsed,
  findClasses,
  methodsOf,
  moduleFunctions,
  outlinePython,
  type PythonBlock,
} from "../adapters/python/source/declarations";
import { scanPythonSource } from "../adapters/python/source/masking";
import { CARRITO } from "./support/pythonFixture";

/** Cada bloque como «padre.nombre», en orden. */
function names(blocks: readonly PythonBlock[]): string[] {
  return blocks.map((block) => (block.parent ? `${block.parent.name}.${block.name}` : block.name));
}

/** Texto de un bloque, del primer decorador al final del cuerpo. */
function textOf(source: string, block: PythonBlock): string {
  return source.slice(block.range.start, block.range.end);
}

describe("lectura de Python", () => {
  describe("enmascarado", () => {
    it("conserva la longitud y los saltos de línea", () => {
      const code = 'a = 1  # comentario\nb = """uno\ndos"""\nc = "x\\"y"\r\n';
      const { code: withoutComments, masked } = scanPythonSource(code);

      for (const copy of [withoutComments, masked]) {
        assert.equal(copy.length, code.length);
        assert.equal(copy.split("\n").length, code.split("\n").length);
      }
    });

    it("tapa los comentarios en las dos copias, y el interior de los textos solo en una", () => {
      const code = ['x = "def a():"  # def b():', "y = 'class C:'"].join("\n");
      const scanned = scanPythonSource(code);

      assert.ok(!scanned.code.includes("def b"), scanned.code);
      assert.ok(scanned.code.includes('"def a():"'), "la copia sin comentarios conserva los textos");
      assert.ok(!/def a|def b|class C/.test(scanned.masked), scanned.masked);
      assert.ok(scanned.masked.includes(`x = "${" ".repeat("def a():".length)}"`), "conserva las comillas del texto");
    });

    it("reconoce los prefijos y los textos de triple comilla, también crudos", () => {
      const code = [
        'a = r"\\"def a():"',
        "b = rb'def b():'",
        "c = '''",
        "def c():",
        "'''",
        'd = f"{x} def d(): {{y}}"',
        "nombre_r = 1",
      ].join("\n");
      const { masked } = scanPythonSource(code);

      assert.ok(!/def [a-d]/.test(masked), masked);
      assert.ok(masked.includes("nombre_r = 1"), "un nombre que termina en r no es un prefijo");
    });

    it("un texto con formato puede tener adentro textos con las mismas comillas", () => {
      const code = ['a = f"{datos["clave"]} def a(): {\'#\'}"', "def real(): pass"].join("\n");
      const { masked } = scanPythonSource(code);

      assert.ok(!masked.includes("def a"), masked);
      assert.ok(masked.includes("def real(): pass"), "el # de adentro no se tomó por comentario");
    });

    it("un texto de una comilla que sigue en la línea de abajo, también con saltos de Windows", () => {
      // Hallado al comparar con `ast` sobre la biblioteca de Python: con «\r\n»
      // la barra saltaba solo el «\r» y el texto se cerraba en el «\n».
      const code = ['x = "uno\\', 'def falso(): dos"', "def real(): pass"].join("\r\n");
      const outline = outlinePython(code);

      assert.deepEqual(names(outline.blocks), ["real"]);
      assert.equal(outline.blocks[0].line, 3);
    });

    it("en un texto con formato crudo, la barra no escapa la llave", () => {
      const code = ["x = fr'\\{{'", "def real(): pass"].join("\n");
      assert.deepEqual(names(outlinePython(code).blocks), ["real"]);
    });

    it("marca las líneas que continúan una instrucción: textos, paréntesis y barra invertida", () => {
      const code = ['x = """', "  dentro", '"""', "y = (1,", "     2)", "z = 1 + \\", "    2", "w = 3"].join("\n");
      const { lines } = scanPythonSource(code);

      assert.deepEqual(
        lines.map((line) => line.continuation),
        [false, true, true, false, true, false, true, false]
      );
    });
  });

  describe("bloques", () => {
    const outline = outlinePython(CARRITO);

    it("encuentra cada clase y cada def con su padre, y nada de los textos ni de los comentarios", () => {
      assert.deepEqual(names(outline.blocks), [
        "Carrito",
        "Carrito.__init__",
        "Carrito.agregar",
        "agregar.validar",
        "Carrito.total",
        "Carrito._recalcular",
        "Carrito.__privado",
        "Carrito.con_cupon",
        "Carrito.redondear",
        "Carrito.sincronizar",
        "Carrito.vaciar",
        "Carrito.Linea",
        "Linea.agregar",
        "agregar",
      ]);
    });

    it("separa el método, la función anidada, el método de la clase anidada y la función de módulo", () => {
      const [carrito] = findClasses(outline, "Carrito");
      assert.deepEqual(
        methodsOf(carrito).filter((block) => block.name === "agregar").map((block) => block.line),
        [22]
      );
      assert.deepEqual(moduleFunctions(outline).map((block) => block.line), [68]);
      assert.deepEqual(findClasses(outline, "Linea").map((block) => block.parent?.name), ["Carrito"]);
    });

    it("ubica el final de cada bloque por la sangría", () => {
      const agregar = outline.blocks.find((block) => block.name === "agregar" && block.parent?.name === "Carrito")!;
      const text = textOf(CARRITO, agregar);

      assert.ok(text.startsWith("    def agregar(self, item: Item"), text.slice(0, 40));
      assert.ok(text.endsWith("self.ultimo_aviso = aviso"), text.slice(-40));
      assert.equal(agregar.bodyIndent, 8);
    });

    it("lee firma, decoradores, parámetros, retorno y si es asíncrono", () => {
      const byName = (name: string) => outline.blocks.find((block) => block.name === name)!;

      assert.equal(byName("vaciar").signature, 'def vaciar(self, confirmar=True, motivo=("a", "b"))');
      assert.equal(byName("vaciar").line, 57);
      assert.deepEqual(byName("total").decorators, ["property"]);
      assert.ok(textOf(CARRITO, byName("total")).startsWith("    @property\n"));
      assert.equal(byName("redondear").parameters, "valor");
      assert.equal(byName("sincronizar").isAsync, true);
      assert.equal(byName("sincronizar").signature, "async def sincronizar(self, cliente)");
      const agregar = outline.blocks.find((block) => block.name === "agregar")!;
      assert.equal(agregar.returns, "None");
      assert.equal(agregar.column, 9);
    });

    it("un cuerpo que es solo un texto, con su cierre en la columna 0, no corta el bloque", () => {
      const code = ["class A:", "    def m(self):", '        """Doc', '"""', "", "    def n(self):", "        return 1"].join(
        "\n"
      );
      const blocks = outlinePython(code).blocks;

      assert.deepEqual(names(blocks), ["A", "A.m", "A.n"]);
      assert.ok(textOf(code, blocks[1]).endsWith('"""'));
    });

    it("un cuerpo en la misma línea, un def condicional y un comentario a otra sangría", () => {
      const code = [
        "class Error(Exception): pass",
        "if True:",
        "    def condicional():",
        "# un comentario en la columna 0 no cierra nada",
        "        return 1",
        "def despues(): return 2",
      ].join("\n");
      const outline2 = outlinePython(code);

      assert.deepEqual(names(outline2.blocks), ["Error", "condicional", "despues"]);
      assert.equal(outline2.blocks[0].bodyIndent, null);
      assert.ok(textOf(code, outline2.blocks[1]).endsWith("return 1"));
    });

    it("las instrucciones del cuerpo de una clase, sin entrar a sus métodos", () => {
      const [carrito] = findClasses(outline, "Carrito");
      const statements = bodyStatements(outline, carrito).map((statement) =>
        collapsed(outline.scanned, statement.start, statement.end)
      );

      assert.equal(statements[0], '"""Un carrito. class Falsa: tampoco cuenta."""');
      assert.equal(statements[1], 'impuesto = Decimal("0.13")');
      assert.ok(statements.every((text) => !text.startsWith("self.")), statements.join(" | "));
    });

    it("una clase definida dentro de una función no se puede alcanzar desde afuera", () => {
      const code = ["def fabrica():", "    class Local:", "        def m(self): pass", "    return Local"].join("\n");
      assert.deepEqual(findClasses(outlinePython(code), "Local"), []);
    });
  });
});
