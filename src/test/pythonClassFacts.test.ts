import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describePythonUnit } from "../adapters/python/analysis/classFacts";
import type { ProjectModel } from "../core/contracts";
import { CARRITO, MODELO } from "./support/pythonFixture";

/**
 * Ficha de la clase (OP-18) en Python: lo que se dice de la clase sin
 * preguntarle a un modelo. En Python pesa más que en Java, porque lo que la
 * ficha evita —un `import` equivocado, un argumento de menos, un atributo que
 * todavía no existe— no lo rechaza ningún compilador antes de ejecutar.
 */

const FLAT: ProjectModel = {
  rootPath: "/proyecto",
  ecosystemId: "python",
  sourceRoots: [],
  sources: [],
  adapterData: { layout: "flat", importRoot: ".", testRoot: "tests" },
};

const SRC: ProjectModel = { ...FLAT, adapterData: { layout: "src", importRoot: "src", testRoot: "tests" } };

function factsOf(
  code: string | string[],
  className: string,
  methodName: string,
  filePath = "tienda/carrito.py",
  project = FLAT
): string {
  const text = Array.isArray(code) ? code.join("\n") : code;
  return describePythonUnit(
    text,
    { className, methodName },
    { filePath, line: 1, column: 1, signature: "" },
    project
  );
}

/** Lo que la ficha dice sobre cómo crear la instancia, en una sola línea. */
function creationLine(facts: string): string {
  const lines = facts.split("\n");
  return lines[lines.indexOf("How to create an instance:") + 1].trim();
}

/** Las líneas que siguen a un encabezado, hasta la primera vacía. */
function section(facts: string, heading: string): string[] {
  const lines = facts.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  assert.ok(start !== -1, `la ficha no tiene «${heading}»:\n${facts}`);
  const end = lines.findIndex((line, index) => index > start && line.trim() === "");
  return lines.slice(start, end === -1 ? undefined : end);
}

describe("ficha de la clase en Python", () => {
  describe("la línea que importa la clase", () => {
    it("en la forma plana, el módulo es la ruta con puntos", () => {
      const facts = factsOf(CARRITO, "Carrito", "agregar");
      assert.match(facts, /^━━ CLASS FACTS/);
      assert.deepEqual(section(facts, "Import it in the test exactly like this").slice(0, 2), [
        "Import it in the test exactly like this:",
        "  from tienda.carrito import Carrito",
      ]);
    });

    it("con src/, el módulo no lleva esa carpeta", () => {
      const facts = factsOf(CARRITO, "Carrito", "agregar", "src/tienda/carrito.py", SRC);
      assert.match(facts, /\n {2}from tienda\.carrito import Carrito\n/);
      assert.match(facts, /the file path without `src\/`, without `\.py`/);
    });

    it("un script de la raíz se importa por su nombre, y el __init__.py de un paquete es el paquete", () => {
      assert.match(factsOf(CARRITO, "Carrito", "agregar", "carrito.py"), /from carrito import Carrito/);
      assert.match(factsOf(CARRITO, "Carrito", "agregar", "tienda/__init__.py"), /from tienda import Carrito/);
    });

    it("una clase anidada se importa por la de afuera", () => {
      const facts = factsOf(CARRITO, "Linea", "agregar");
      assert.match(facts, /from tienda\.carrito import Carrito\n {2}Linea is nested: refer to it as Carrito\.Linea\./);
    });

    it("un archivo cuyo nombre no es un módulo válido se carga con importlib", () => {
      const facts = factsOf(CARRITO, "Carrito", "agregar", "mi-tienda/carrito.py");
      assert.match(facts, /Carrito = importlib\.import_module\("mi-tienda\.carrito"\)\.Carrito/);
    });
  });

  describe("cómo crear la instancia", () => {
    it("una clase común: los argumentos de su __init__, y los que van después de * por nombre", () => {
      const facts = factsOf(CARRITO, "Carrito", "agregar");
      assert.match(facts, /__init__: def __init__\(self, items=None, \*, descuento=0\)/);
      assert.equal(
        creationLine(facts),
        "Carrito(<arguments for __init__ above, without self>). `descuento` comes after a bare `*`: it is keyword-only, pass it by name."
      );
    });

    it("sin un * solo en la firma, no habla de parámetros por nombre", () => {
      // En la primera prueba con Ctrl+F5 lo decía del __init__ de PetShop, que no tiene ninguno.
      const shop = ["class PetShop:", "    def __init__(self, animal_factory, *args, **kwargs):", "        self.pet_factory = animal_factory", "", "    def buy_pet(self, name):", "        return self.pet_factory(name)"];
      assert.equal(creationLine(factsOf(shop, "PetShop", "buy_pet")), "PetShop(<arguments for __init__ above, without self>).");

      const several = ["class Punto:", "    def __init__(self, *, x, y: int = 0, **extra):", "        self.x = x", "", "    def norma(self):", "        return self.x"];
      assert.match(creationLine(factsOf(several, "Punto", "norma")), /`x`, `y` come after a bare `\*`: they are keyword-only/);
    });

    it("una abstracta: una subclase de la prueba con los métodos abstractos", () => {
      const facts = factsOf(MODELO, "Forma", "describir", "tienda/modelo.py");
      assert.match(facts, /Kind: abstract class \(bases: ABC\)/);
      assert.deepEqual(section(facts, "Abstract methods declared in Forma").slice(0, 2), [
        "Abstract methods declared in Forma (@abstractmethod):",
        "  @abstractmethod def area(self) -> float",
      ]);
      assert.match(creationLine(facts), /class _ConcreteForma\(Forma\):.*Never call Forma\(\.\.\.\) directly\./);
    });

    it("una clase de datos: un argumento por campo, en orden", () => {
      const code = [
        "from dataclasses import dataclass",
        "",
        "@dataclass(frozen=True)",
        "class Item:",
        "    nombre: str",
        "    precio: float = 0.0",
        "",
        "    def etiqueta(self):",
        "        return self.nombre",
      ];
      const facts = factsOf(code, "Item", "etiqueta", "tienda/modelo.py");

      assert.match(facts, /Kind: dataclass/);
      assert.deepEqual(section(facts, "Fields, in order"), [
        "Fields, in order — they are the parameters of the constructor:",
        "  nombre: str",
        "  precio: float = 0.0",
      ]);
      assert.match(creationLine(facts), /^Item\(\.\.\.\) with one argument per field above/);
      assert.ok(!facts.includes("does not create"), "los campos los crea el __init__ de la clase de datos");
    });

    it("una enumeración: un miembro, nunca la clase", () => {
      const code = [MODELO, "", "class Turno(Enum):", "    MANANA = 1", "    TARDE = 2", "", "    def es_temprano(self):", "        return self is Turno.MANANA"].join("\n");
      const facts = factsOf(code, "Turno", "es_temprano", "tienda/modelo.py");

      assert.match(facts, /Kind: Enum \(bases: Enum\)\. Members: MANANA, TARDE\./);
      assert.match(creationLine(facts), /use one of its members \(Turno\.MANANA, Turno\.TARDE\)/);
    });

    it("una clase que se crea con __new__, como Fraction, recibe ahí los argumentos", () => {
      const code = [
        "class Fraccion(numbers.Rational):",
        "    def __new__(cls, numerador=0, denominador=None):",
        "        return super().__new__(cls)",
        "",
        "    def invertir(self):",
        "        return Fraccion(1, 2)",
      ];
      const facts = factsOf(code, "Fraccion", "invertir");

      assert.match(facts, /It creates its instances with __new__[^\n]*\n {2}def __new__\(cls, numerador=0, denominador=None\)/);
      assert.match(creationLine(facts), /^Fraccion\(<arguments for __new__ above, without cls>\)/);
    });

    it("sin __init__ ni clase base, sin argumentos", () => {
      const facts = factsOf(["class Contador:", "    def contar(self, valores):", "        return len(valores)"], "Contador", "contar");
      assert.match(facts, /__init__: not declared in Contador\./);
      assert.match(creationLine(facts), /^Contador\(\) — it declares no __init__ and has no base class/);
    });

    it("un método estático o de clase se llama sobre la clase", () => {
      assert.match(creationLine(factsOf(CARRITO, "Carrito", "redondear")), /^`redondear` is a @staticmethod: call it as `Carrito\.redondear\(\.\.\.\)`/);
      const classmethod = ["class Pedido:", "    @classmethod", "    def nuevo(cls, codigo):", "        return cls()"];
      assert.match(creationLine(factsOf(classmethod, "Pedido", "nuevo")), /@classmethod: call it as `Pedido\.nuevo\(\.\.\.\)`/);
    });
  });

  describe("el método bajo prueba", () => {
    it("una propiedad se lee sin paréntesis, y sin setter no se asigna", () => {
      const facts = factsOf(CARRITO, "Carrito", "total");
      assert.match(facts, /The method under test: @property def total\(self\)/);
      assert.match(facts, /read it as `sut\.total`, without parentheses\. It has no setter/);
    });

    it("uno asíncrono corre con asyncio.run dentro de una prueba común", () => {
      assert.match(factsOf(CARRITO, "Carrito", "sincronizar"), /asyncio\.run\(\.\.\.\)[\s\S]*Never write `async def test_\.\.\.`/);
    });

    it("uno con dos guiones bajos lleva el nombre que le pone Python", () => {
      assert.match(factsOf(CARRITO, "Carrito", "__privado"), /renames it to `_Carrito__privado`/);
    });

    it("uno con un guion bajo se llama directo", () => {
      assert.match(factsOf(CARRITO, "Carrito", "_recalcular"), /internal by convention only\. Call it directly as `sut\._recalcular\(\.\.\.\)`/);
    });

    it("uno especial se prueba por la operación que lo llama", () => {
      const code = ["class Pila:", "    def __init__(self):", "        self.datos = []", "", "    def __len__(self):", "        return len(self.datos)"];
      assert.match(factsOf(code, "Pila", "__len__"), /It is a special method: Python calls it through an operation/);
    });
  });

  describe("métodos, atributos y llamadas", () => {
    it("la lista completa de métodos, con sus decoradores, y las clases anidadas", () => {
      const facts = factsOf(CARRITO, "Carrito", "agregar");
      const methods = section(facts, "Methods declared in Carrito").filter((line) => line.startsWith("  "));

      assert.equal(methods.length, 9);
      assert.ok(methods.includes("  @property def total(self)"));
      assert.ok(methods.includes("  @staticmethod def redondear(valor)"));
      assert.ok(methods.includes("  async def sincronizar(self, cliente)"));
      assert.ok(!methods.some((line) => line.includes("validar")), "la función anidada no es un método");
      assert.match(facts, /Classes nested in Carrito: Carrito\.Linea\./);
    });

    it("los atributos que crea __init__ y los de la clase", () => {
      const facts = factsOf(CARRITO, "Carrito", "agregar");
      assert.match(facts, /Attributes that __init__ creates: self\.items, self\.descuento, self\._cache\./);
      assert.match(facts, /Class attributes of Carrito \(shared by every instance[^)]*\): impuesto\./);
    });

    it("avisa de los atributos que el método lee y __init__ no crea, y de quién los crea", () => {
      const facts = factsOf(CARRITO, "Carrito", "con_cupon");
      const late = section(facts, "Attributes that `con_cupon` reads but __init__ does not create");

      assert.deepEqual(late.slice(1), [
        "  self.cupon — not assigned anywhere in Carrito (inherited, or set from outside the class): assign `sut.cupon` directly.",
        "  self.cantidad — created by _recalcular(): call it first, or assign `sut.cantidad` directly.",
      ]);
    });

    it("lo que el método asigna él mismo no es un atributo faltante", () => {
      assert.ok(!factsOf(CARRITO, "Carrito", "agregar").includes("does not create"));
    });

    it("sigue los métodos con _ que llama, y muestra el código de las propiedades que leen", () => {
      const facts = factsOf(CARRITO, "Carrito", "agregar");
      const calls = facts.slice(facts.indexOf("Methods of Carrito that `agregar` calls:"));

      assert.match(calls, /def _recalcular\(self\) — its name starts with `_`, so it is part of the unit under test[^\n]*Its code:\n {6}def _recalcular\(self\):\n {10}self\._cache\["total"\] = self\.total/);
      assert.match(calls, /@property def total\(self\) — already implemented in Carrito and runs as is[^\n]*for reference only:\n {6}@property\n {6}def total\(self\):/);
      assert.ok(!calls.includes("validar"), "una función anidada no es un método de la clase");
    });

    it("lo que llama sobre self y la clase no declara es heredado", () => {
      const code = ["class Perro(Animal):", "    def ladrar(self):", "        return self.sonido() + self.volumen"];
      const facts = factsOf(code, "Perro", "ladrar");

      assert.match(facts, /Called by `ladrar` but not declared in Perro \(inherited from a base class\): sonido\(\.\.\.\)\./);
      assert.match(facts, /If Python reports "Can't instantiate abstract class Perro/);
      assert.match(facts, /self\.volumen — not assigned anywhere in Perro/);
    });

    it("una llamada sobre otro objeto no es de la clase", () => {
      const code = ["class Caja:", "    def sumar(self, otro):", "        return otro.total() + len(self.cosas)", "", "    def total(self):", "        return 1"];
      assert.match(factsOf(code, "Caja", "sumar"), /Methods of Caja that `sumar` calls: none\./);
    });
  });

  it("sin la clase o sin el método en el archivo, no dice nada", () => {
    assert.equal(factsOf(CARRITO, "Nada", "agregar"), "");
    assert.equal(factsOf(CARRITO, "Carrito", "validar"), "");
    assert.equal(
      describePythonUnit(CARRITO, { className: null, methodName: "agregar" }, { filePath: "tienda/carrito.py", line: 68, column: 5, signature: "" }, FLAT),
      ""
    );
  });
});
