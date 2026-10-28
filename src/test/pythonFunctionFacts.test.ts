import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describePythonFunction } from "../adapters/python/analysis/functionFacts";
import type { ProjectModel } from "../core/contracts";
import { CARRITO } from "./support/pythonFixture";

/**
 * Ficha de una función de módulo (OP-18, tercera parte de Python): la de la
 * clase sin lo que solo tiene una clase. Lo que tiene que decir es la línea que
 * la importa, que se llama directo, el estado del módulo que comparten todas
 * las pruebas y las funciones del módulo que llama.
 */

const FLAT: ProjectModel = {
  rootPath: "/proyecto",
  ecosystemId: "python",
  sourceRoots: [],
  sources: [],
  adapterData: { layout: "flat", importRoot: ".", testRoot: "tests" },
};

const SRC: ProjectModel = { ...FLAT, adapterData: { layout: "src", importRoot: "src", testRoot: "tests" } };

const TAMANIOS = [
  '"""Tamaños. def falso(): no es una declaración."""',
  "import os",
  "",
  "SUFIJOS = (\"kB\", \"MB\", \"GB\")",
  "_cache = {}",
  "contador = 0",
  "BASE: int = 1000",
  "local = \"del módulo\"",
  "PREFIJO = \"UTIA\"",
  "",
  "",
  "def _formatear(valor, sufijo):",
  "    return f\"{valor:.1f} {sufijo}\" + _espacio()",
  "",
  "",
  "def _espacio():",
  "    return \" \"",
  "",
  "",
  "def publico(x):",
  "    return x",
  "",
  "",
  "def largo(x):",
  "    return x",
  "",
  "",
  "def tamanio(valor, binario=False, *, formato=\"%.1f\"):",
  "    global contador",
  "    contador += 1",
  "    local = publico(valor)",
  "    if valor in _cache:",
  "        return _cache[valor]",
  "    base = BASE * 2 if binario else BASE",
  "    valor = round(valor, 2)",
  "    os.environ.get(\"PREFIJO\")",
  "    return _formatear(valor / base, SUFIJOS[0])",
  "",
  "",
  "async def sincronizar(cliente):",
  "    await cliente.enviar()",
  "",
  "",
  "def _interna():",
  "    return 1",
  "",
].join("\n");

function factsOf(code: string, methodName: string, filePath = "tienda/tamanios.py", project = FLAT): string {
  return describePythonFunction(
    code,
    { className: null, methodName },
    { filePath, line: 1, column: 1, signature: "" },
    project
  );
}

describe("ficha de una función de módulo (OP-18)", () => {
  it("empieza por la línea que la importa", () => {
    const facts = factsOf(TAMANIOS, "tamanio");

    assert.ok(facts.startsWith("━━ FUNCTION FACTS — read from the source code by the tool"), facts.slice(0, 80));
    assert.match(facts, /Import it in the test exactly like this:\n {2}from tienda\.tamanios import tamanio\n/);
  });

  it("con src/, el módulo no lleva esa carpeta", () => {
    const facts = factsOf(TAMANIOS, "tamanio", "src/tienda/tamanios.py", SRC);

    assert.match(facts, /\n {2}from tienda\.tamanios import tamanio\n/);
    assert.match(facts, /the file path without `src\/`,/);
  });

  it("dice que se llama directo, sin instancia, con los parámetros que van por nombre", () => {
    const facts = factsOf(TAMANIOS, "tamanio");

    assert.match(facts, /Declaration: def tamanio\(valor, binario=False, \*, formato="%\.1f"\)\n/);
    assert.match(facts, /Kind: function declared at module level in `tienda\/tamanios\.py` — it belongs to no class\./);
    assert.match(
      facts,
      /tamanio\(<arguments for the declaration above>\) — directly, as imported: there is no instance to create and no `self`\. `formato` comes after a bare `\*`: it is keyword-only, pass it by name\./
    );
  });

  it("nombra las variables del módulo que lee, con su valor, y no las que tapa", () => {
    const facts = factsOf(TAMANIOS, "tamanio");
    const read = facts.split("\n\n").find((block) => block.startsWith("Module-level variables that `tamanio` reads")) ?? "";

    assert.match(read, /monkeypatch\.setattr\("tienda\.tamanios\.NAME", value\)/);
    // En el orden del módulo; `local` la tapa una asignación, `contador` la
    // cambia, y "PREFIJO" dentro de un texto no cuenta.
    assert.deepEqual(read.split("\n").slice(1), ['  SUFIJOS = ("kB", "MB", "GB")', "  _cache = {}", "  BASE: int = 1000"]);
  });

  it("avisa de las que cambia con global, que quedan cambiadas para la prueba siguiente", () => {
    assert.match(
      factsOf(TAMANIOS, "tamanio"),
      /Module-level variables that `tamanio` changes \(declared `global`\) — the change stays for the next test, so never rely on their value from another test: contador\./
    );
  });

  it("sigue las funciones del módulo que llama, con el código de las que empiezan con _", () => {
    const facts = factsOf(TAMANIOS, "tamanio");
    const calls = facts.slice(facts.indexOf("Functions of this module that `tamanio` calls:"));

    assert.deepEqual(
      calls.split("\n").filter((line) => line.startsWith("  def")),
      [
        "  def publico(x) — already implemented in this module and runs as is: do not patch it or copy its code into the test. Its code, for reference only:",
        "  def _formatear(valor, sufijo) — its name starts with `_`, so it is part of the unit under test. Reach it through `tamanio`; do not call it from the test or replace it. Its code:",
        // La llama `_formatear`, no `tamanio`: se sigue igual.
        "  def _espacio() — its name starts with `_`, so it is part of the unit under test. Reach it through `tamanio`; do not call it from the test or replace it. Its code:",
      ]
    );
    assert.match(calls, /\n {10}return f"\{valor:\.1f\} \{sufijo\}" \+ _espacio\(\)\n/);
    assert.ok(!calls.includes("def largo"), "nombra una función que no llama");
  });

  it("una llamada sobre otro objeto no es una función del módulo", () => {
    // `agregar` de módulo llama a `carrito.agregar(item)`, el método.
    const facts = factsOf(CARRITO, "agregar", "tienda/carrito.py");

    assert.match(facts, /from tienda\.carrito import agregar\n/);
    assert.match(facts, /Functions of this module that `agregar` calls: none\./);
    assert.ok(!facts.includes("Module-level variables"), facts);

    // Aunque el método se llame como otra función del módulo.
    const code = ["def contar(x):", "    return len(x)", "", "", "def total(carrito):", "    return carrito.contar(1)", ""].join("\n");
    assert.match(factsOf(code, "total", "tienda/total.py"), /Functions of this module that `total` calls: none\./);
  });

  it("una corrutina se corre con asyncio.run, y una con _ se importa por ese nombre", () => {
    assert.match(factsOf(TAMANIOS, "sincronizar"), /Declaration: async def sincronizar\(cliente\)\n[\s\S]*run it with `asyncio\.run\(\.\.\.\)`/);
    assert.match(factsOf(TAMANIOS, "_interna"), /Its name starts with `_`: it is internal by convention only\. Import it and call it by that same name/);
  });

  it("un archivo que no es un módulo válido se carga con importlib, y sin el consejo de monkeypatch", () => {
    const facts = factsOf(TAMANIOS, "tamanio", "mi-script.py");

    assert.match(facts, /tamanio = importlib\.import_module\("mi-script"\)\.tamanio/);
    assert.match(facts, /Module-level variables that `tamanio` reads — shared by every test\.\n/);
  });

  it("si el archivo la declara dos veces, vale la última", () => {
    const code = ["def doble(x):", "    return x * 2", "", "", "def doble(x, y=2):", "    return x * y", ""].join("\n");

    assert.match(factsOf(code, "doble", "tienda/doble.py"), /Declaration: def doble\(x, y=2\)\n/);
  });

  it("con clase, o sin la función de módulo en el archivo, no dice nada", () => {
    assert.equal(factsOf(CARRITO, "validar", "tienda/carrito.py"), "", "una función anidada no es de módulo");
    assert.equal(factsOf(CARRITO, "total", "tienda/carrito.py"), "", "un método no es de módulo");
    assert.equal(
      describePythonFunction(CARRITO, { className: "Carrito", methodName: "agregar" }, { filePath: "tienda/carrito.py", line: 1, column: 1, signature: "" }, FLAT),
      ""
    );
  });
});
