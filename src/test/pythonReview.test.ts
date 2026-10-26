import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawnSync } from "child_process";
import * as fsp from "fs/promises";
import * as path from "path";
import { REVIEW_SCRIPT, parseReview } from "../adapters/python/build/review";
import { pythonEnvironment } from "../adapters/python/build/runtime";
import type { Diagnostic } from "../core/contracts";
import { createPythonFixture, type PythonFixture } from "./support/pythonFixture";

/**
 * El revisor de la prueba con Python de verdad, sobre el proyecto de ejemplo.
 * El revisor es un guion de Python: sin Python no hay forma de comprobarlo, y
 * estas pruebas se saltean en una máquina que no lo tiene. No necesitan
 * pytest: ninguna de las pruebas revisadas lo importa.
 */

const PYTHON = findPython();

function findPython(): readonly string[] | undefined {
  const candidates = process.platform === "win32" ? [["python"], ["py", "-3"]] : [["python3"], ["python"]];
  return candidates.find(([command, ...prefix]) => {
    const probe = spawnSync(command, [...prefix, "-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
    return probe.status === 0 && probe.stdout.trim() === "3";
  });
}

describe("el revisor de la prueba, con Python de verdad", { skip: PYTHON ? false : "no hay Python en esta máquina" }, () => {
  let fixture: PythonFixture;

  before(async () => {
    fixture = await createPythonFixture();
    const write = (relative: string, lines: readonly string[]) =>
      fsp.writeFile(path.join(fixture.projectRoot, ...relative.split("/")), lines.join("\n") + "\n", "utf8");

    await write("tests/UTIA_cuatro_test.py", [
      "from tienda.carrito import Carrito, Gato",
      "from tienda.nada import X",
      "import collections",
      "",
      "",
      "def armar():",
      "    return Carrito(Perro)",
      "",
      "",
      "def test_uno():",
      "    assert armar().items == Resultado",
      "",
      "",
      "def test_dos():",
      "    assert not collections.Counter()",
    ]);
    await write("tests/UTIA_estrella_test.py", [
      "from tienda.carrito import *",
      "",
      "",
      "def test_a():",
      "    assert Carrito and Gato",
    ]);
    await write("tests/UTIA_estrella_rota_test.py", ["from tienda.nada import *", "", "", "def test_a():", "    assert Algo"]);
    await write("tests/UTIA_relativo_test.py", ["from . import test_existente", "", "", "def test_a():", "    assert test_existente"]);
    await write("tienda/roto.py", ["import requests_que_no_existe", "", "", "class Roto:", "    pass"]);
    await write("tests/UTIA_proyecto_test.py", ["from tienda.roto import Roto", "", "", "def test_a():", "    assert Roto"]);
    await write("tienda/pide.py", ['nombre = input("Nombre: ")']);
    await write("tests/UTIA_entrada_test.py", ["from tienda.pide import nombre", "", "", "def test_a():", "    assert nombre"]);
    await write("tests/UTIA_sintaxis_test.py", ["from tienda.carrito import Carrito", "", "", "def test_a(:", "    assert Carrito"]);
    await write("tests/UTIA_bien_test.py", [
      "from tienda.carrito import Carrito",
      "from tienda.modelo import Item",
      "",
      "",
      "def test_agregar(capsys):",
      "    carrito = Carrito()",
      '    carrito.agregar(Item("lapiz", 1.5))',
      "    assert [i.nombre for i in carrito.items] == ['lapiz'] and len(carrito.items) == 1",
    ]);
  });
  after(async () => fixture.dispose());

  const review = (file: string): Diagnostic[] => {
    const [command, ...prefix] = PYTHON ?? [];
    const result = spawnSync(command, [...prefix, "-c", REVIEW_SCRIPT, path.join("tests", file)], {
      cwd: fixture.projectRoot,
      env: pythonEnvironment(process.env, ".", path.delimiter),
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    const diagnostics = parseReview(result.stdout);
    assert.ok(diagnostics, `el revisor no contestó: ${result.stderr}`);
    return diagnostics;
  };
  const summary = (diagnostics: readonly Diagnostic[]) => diagnostics.map((d) => `${d.filePath}:${d.line} ${d.code}`);

  it("encuentra los cuatro errores de una vez: dos de importación y dos nombres dentro de funciones", () => {
    const diagnostics = review("UTIA_cuatro_test.py");

    assert.deepEqual(summary(diagnostics), [
      "tests/UTIA_cuatro_test.py:1 ImportError",
      "tests/UTIA_cuatro_test.py:2 ModuleNotFoundError",
      "tests/UTIA_cuatro_test.py:7 NameError",
      "tests/UTIA_cuatro_test.py:11 NameError",
    ]);
    assert.equal(diagnostics[0].message, "cannot import name 'Gato' from 'tienda.carrito'");
    assert.equal(diagnostics[2].column, 20);
  });

  it("con import *, los nombres del módulo cuentan; si el módulo no existe, solo informa eso", () => {
    assert.deepEqual(summary(review("UTIA_estrella_test.py")), ["tests/UTIA_estrella_test.py:5 NameError"]);
    assert.deepEqual(summary(review("UTIA_estrella_rota_test.py")), ["tests/UTIA_estrella_rota_test.py:1 ModuleNotFoundError"]);
  });

  it("saltea los import relativos, que resuelve pytest, y cuenta sus nombres como definidos", () => {
    assert.deepEqual(review("UTIA_relativo_test.py"), []);
  });

  it("un error en el código del proyecto va con el archivo y la línea del proyecto", () => {
    assert.deepEqual(summary(review("UTIA_proyecto_test.py")), ["tienda/roto.py:1 ModuleNotFoundError"]);
    assert.deepEqual(summary(review("UTIA_entrada_test.py")), ["tienda/pide.py:1 EOFError"]);
  });

  it("un error de sintaxis, con su columna, y nada más", () => {
    const diagnostics = review("UTIA_sintaxis_test.py");

    assert.deepEqual(summary(diagnostics), ["tests/UTIA_sintaxis_test.py:4 SyntaxError"]);
    assert.equal(diagnostics[0].column, 12);
  });

  it("una prueba sin errores, con fixtures de pytest como parámetros, no da falsas alarmas", () => {
    assert.deepEqual(review("UTIA_bien_test.py"), []);
  });

  it("no deja código compilado (.pyc) en el proyecto, después de todas las revisiones", async () => {
    review("UTIA_bien_test.py");

    const entries = (await fsp.readdir(fixture.projectRoot, { recursive: true })).map(String);
    assert.deepEqual(entries.filter((entry) => entry.endsWith(".pyc")), []);
  });
});
