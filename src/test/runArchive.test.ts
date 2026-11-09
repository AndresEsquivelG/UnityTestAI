import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { archiveRun } from "../pipeline";

describe("copia de cada corrida", () => {
  let root: string;
  const AHORA = Date.UTC(2026, 10, 10, 18, 30, 5);

  const escribir = (relativo: string, contenido: string, fecha = AHORA) => {
    const archivo = path.join(root, "AgentOutputs", relativo);
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, contenido, "utf8");
    fs.utimesSync(archivo, new Date(fecha), new Date(fecha));
    return archivo;
  };
  const leer = (carpeta: string, relativo: string) =>
    fs.readFileSync(path.join(carpeta, relativo), "utf8");
  const corridas = () =>
    fs.readdirSync(path.join(root, "AgentOutputs", "corridas")).sort();
  const pedido = (extra: object = {}) => ({
    outputRoot: root,
    startedAt: AHORA,
    modelId: "ollama_qwen2_5",
    className: "ItemBase",
    methodName: "GetUnityVec3",
    ...extra,
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "utia-corridas-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("copia lo de la corrida a una carpeta con fecha, modelo, clase y método", () => {
    escribir("test-generator/test-generator-prompt.txt", "el prompt");
    escribir("verification/verification-output.json", "{}");

    const carpeta = archiveRun(pedido());

    assert.ok(carpeta);
    assert.match(
      path.basename(carpeta),
      /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_ollama_qwen2_5_ItemBase_GetUnityVec3$/
    );
    assert.equal(leer(carpeta, "test-generator/test-generator-prompt.txt"), "el prompt");
    assert.equal(leer(carpeta, "verification/verification-output.json"), "{}");
  });

  it("una corrida cortada no se lleva lo que dejó la anterior", () => {
    escribir("method-slicer/method-slicer-output.json", "de esta corrida");
    escribir("test-generator/test-generator-output.json", "de la anterior", AHORA - 60_000);

    const carpeta = archiveRun(pedido());

    assert.ok(carpeta);
    assert.ok(fs.existsSync(path.join(carpeta, "method-slicer/method-slicer-output.json")));
    assert.equal(fs.existsSync(path.join(carpeta, "test-generator")), false);
  });

  it("guarda la prueba sin la extensión de su lenguaje", () => {
    escribir("test-generator/test-generator-output.json", "{}");
    const prueba = path.join(root, "UTIA_algo_test.py");
    fs.writeFileSync(prueba, "def test_x(): pass", "utf8");

    const carpeta = archiveRun(pedido({ testFile: prueba }));

    assert.ok(carpeta);
    assert.equal(leer(carpeta, "generated-test.txt"), "def test_x(): pass");
    assert.equal(fs.existsSync(path.join(carpeta, "UTIA_algo_test.py")), false);
  });

  it("no falla si la corrida no llegó a escribir la prueba", () => {
    escribir("method-slicer/method-slicer-output.json", "{}");

    const carpeta = archiveRun(pedido({ testFile: path.join(root, "no-existe.cs") }));

    assert.ok(carpeta);
    assert.equal(fs.existsSync(path.join(carpeta, "generated-test.txt")), false);
  });

  it("sin nada nuevo no crea ninguna carpeta", () => {
    escribir("test-generator/test-generator-output.json", "vieja", AHORA - 60_000);

    assert.equal(archiveRun(pedido()), undefined);
    assert.equal(fs.existsSync(path.join(root, "AgentOutputs", "corridas")), false);
  });

  it("sin AgentOutputs no hace nada", () => {
    assert.equal(archiveRun(pedido()), undefined);
  });

  it("dos corridas seguidas de la misma unidad se conservan, y la primera no cambia", () => {
    const salida = "test-generator/test-generator-output.json";
    escribir(salida, "primera");
    const primera = archiveRun(pedido());

    // En el mismo segundo, que es lo que obliga a no reutilizar el nombre.
    escribir(salida, "segunda");
    const segunda = archiveRun(pedido());

    assert.ok(primera);
    assert.ok(segunda);
    assert.notEqual(primera, segunda);
    assert.equal(leer(primera, salida), "primera");
    assert.equal(leer(segunda, salida), "segunda");
    assert.equal(corridas().length, 2);
  });

  it("no mete las copias anteriores dentro de la nueva", () => {
    escribir("test-generator/test-generator-output.json", "primera");
    archiveRun(pedido());

    // En el mismo instante: la fecha no alcanza a dejar afuera a la copia anterior.
    escribir("test-generator/test-generator-output.json", "segunda");
    const segunda = archiveRun(pedido());

    assert.ok(segunda);
    assert.equal(fs.existsSync(path.join(segunda, "corridas")), false);
    assert.equal(fs.readdirSync(segunda).join(), "test-generator");
  });

  it("una función sin clase no deja un hueco en el nombre", () => {
    escribir("test-generator/test-generator-output.json", "{}");

    const carpeta = archiveRun(pedido({ className: null, methodName: "strip_whitespaces" }));

    assert.ok(carpeta);
    assert.match(path.basename(carpeta), /_ollama_qwen2_5_strip_whitespaces$/);
  });
});
