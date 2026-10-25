import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findMethodDeclarations,
  findTopLevelType,
  findTypeBodies,
} from "../adapters/java/source/declarations";
import { maskCommentsAndLiterals } from "../adapters/java/source/masking";
import {
  packageForDirectory,
  readPackageName,
  withPackage,
} from "../adapters/java/source/packageName";

/** Declaraciones de un método en todo el cuerpo de una clase. */
function methodsOf(code: string, typeName: string, methodName: string): string[] {
  const masked = maskCommentsAndLiterals(code);
  const [body] = findTypeBodies(masked, typeName);
  assert.ok(body, `no encuentra el cuerpo de ${typeName}`);
  return findMethodDeclarations(masked, code, body, methodName).map((d) => d.signature);
}

describe("lectura de Java", () => {
  describe("enmascarado", () => {
    it("conserva la longitud y los saltos de línea", () => {
      const code = 'int a = 1; // comentario\n/* bloque\n */ String s = "x\\"y";\n';
      const masked = maskCommentsAndLiterals(code);

      assert.equal(masked.length, code.length);
      assert.equal(masked.split("\n").length, code.split("\n").length);
    });

    it("tapa comentarios, cadenas, caracteres y bloques de texto", () => {
      const code = [
        "// void a() {",
        "/* void b() { */",
        'String c = "void c() {";',
        "char d = '{';",
        "char e = '\\'';",
        'String f = """',
        '    void f() { "comillas" }',
        '    """;',
        "int g;",
      ].join("\n");
      const masked = maskCommentsAndLiterals(code);

      assert.ok(!masked.includes("{"), masked);
      assert.ok(!/void [a-f]/.test(masked), masked);
      assert.ok(masked.includes("int g;"));
    });

    it("una cadena sin cerrar termina con su línea", () => {
      const masked = maskCommentsAndLiterals('String s = "abierta\nint x = 1;');
      assert.ok(masked.includes("int x = 1;"));
    });
  });

  describe("métodos", () => {
    it("devuelve cada sobrecarga, aunque la firma ocupe varias líneas", () => {
      const code = [
        "class A {",
        "    public int sumar(int a) { return a; }",
        "    public int sumar(int a,",
        "                     int b) throws IllegalStateException {",
        "        return a + b;",
        "    }",
        "}",
      ].join("\n");

      assert.deepEqual(methodsOf(code, "A", "sumar"), [
        "public int sumar(int a)",
        "public int sumar(int a, int b)",
      ]);
    });

    it("da la línea y la columna del nombre", () => {
      const code = "class A {\n\n    void correr() { }\n}";
      const masked = maskCommentsAndLiterals(code);
      const [body] = findTypeBodies(masked, "A");
      const [declaration] = findMethodDeclarations(masked, code, body, "correr");

      assert.equal(declaration.line, 3);
      assert.equal(declaration.column, 10);
    });

    it("reconoce genéricos, arreglos, nombres calificados y la anotación en la misma línea", () => {
      const code = [
        "class A {",
        "    public static <T extends Comparable<T>> T mayor(java.util.List<T> v) { return null; }",
        "    int[] mayor(int x) { return null; }",
        "    @Override public String mayor() { return null; }",
        "}",
      ].join("\n");

      assert.deepEqual(methodsOf(code, "A", "mayor"), [
        "public static <T extends Comparable<T>> T mayor(java.util.List<T> v)",
        "int[] mayor(int x)",
        "public String mayor()",
      ]);
    });

    it("no toma por declaración una invocación, una clase anónima ni un return", () => {
      const code = [
        "class A {",
        "    void usar() {",
        "        tarea(1);",
        "        Object o = new Tarea(2) { };",
        "    }",
        "    Object crear() { return new Tarea(3) { }; }",
        "}",
      ].join("\n");

      assert.deepEqual(methodsOf(code, "A", "tarea"), []);
      assert.deepEqual(methodsOf(code, "A", "Tarea"), []);
    });

    it("no cuenta los métodos de una clase anónima ni de una anidada", () => {
      const code = [
        "class A {",
        "    void correr() { }",
        "    Runnable r = new Runnable() {",
        "        public void correr() { }",
        "    };",
        "    static class B {",
        "        void correr() { }",
        "    }",
        "}",
      ].join("\n");

      assert.deepEqual(methodsOf(code, "A", "correr"), ["void correr()"]);
      assert.deepEqual(methodsOf(code, "B", "correr"), ["void correr()"]);
    });

    it("deja fuera los métodos sin cuerpo", () => {
      const code = "abstract class A {\n    abstract void correr();\n    default void parar() { }\n}";

      assert.deepEqual(methodsOf(code, "A", "correr"), []);
      assert.deepEqual(methodsOf(code, "A", "parar"), ["default void parar()"]);
    });
  });

  describe("tipos", () => {
    it("encuentra clases, interfaces, enumeraciones y registros, pero no Foo.class", () => {
      const masked = maskCommentsAndLiterals(
        "record R(int x) { }\nenum E { A }\ninterface I { }\nObject o = R.class;"
      );

      assert.equal(findTypeBodies(masked, "R").length, 1);
      assert.equal(findTypeBodies(masked, "E").length, 1);
      assert.equal(findTypeBodies(masked, "I").length, 1);
    });

    it("el primer tipo de primer nivel es la clase de prueba, no uno anidado ni uno en un comentario", () => {
      const code = "// class Falsa { }\npackage p;\n\n@Timeout(2)\nclass Prueba {\n  static class Ayuda { }\n}\nclass Otra { }";
      const declaration = findTopLevelType(maskCommentsAndLiterals(code));

      assert.equal(declaration?.name, "Prueba");
      assert.equal(code.slice(declaration!.nameStart, declaration!.nameStart + 6), "Prueba");
    });
  });

  describe("paquete", () => {
    it("lee la línea package e ignora una comentada", () => {
      assert.equal(readPackageName("// package falso;\npackage com.tienda.modelo;\n"), "com.tienda.modelo");
      assert.equal(readPackageName("class A { }"), null);
    });

    it("pone, reemplaza o quita la línea, y aplicarlo dos veces da lo mismo", () => {
      const sinPaquete = "import x.Y;\n\nclass A { }";
      const conOtro = "package otro;\nimport x.Y;\n\nclass A { }";

      const agregado = withPackage(sinPaquete, "com.tienda");
      assert.equal(agregado, "package com.tienda;\n\nimport x.Y;\n\nclass A { }");
      assert.equal(withPackage(agregado, "com.tienda"), agregado);

      assert.equal(withPackage(conOtro, "com.tienda"), "package com.tienda;\nimport x.Y;\n\nclass A { }");
      assert.equal(withPackage(conOtro, null), "import x.Y;\n\nclass A { }");
      assert.equal(withPackage(sinPaquete, null), sinPaquete);
    });

    it("convierte una carpeta en paquete", () => {
      assert.equal(packageForDirectory("com/tienda/modelo"), "com.tienda.modelo");
      assert.equal(packageForDirectory(""), null);
    });
  });
});
