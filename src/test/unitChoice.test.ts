import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as os from "os";
import * as path from "path";
import type { CapabilityMap, ProjectModel, SymbolCandidate, SymbolLocation } from "../core/contracts";
import { JavaAdapter } from "../adapters/java/javaAdapter";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import { locateUnit } from "../pipeline";
import { createStubAdapter } from "./support/stubAdapter";

/**
 * La declaración que se va a probar (`pipeline/unit.ts`): la eligen igual la
 * generación, «Ejecutar y medir» y el panel.
 *
 * Con un adaptador de mentira que devuelve las candidatas que se le dan, para
 * que lo único que se mida sea la elección del núcleo.
 */

const ROOT = path.resolve(os.tmpdir(), "proyecto-de-mentira");

const PROJECT: ProjectModel = {
  rootPath: ROOT,
  ecosystemId: "mentira",
  sourceRoots: [],
  sources: [],
};

function candidate(filePath: string, line = 1): SymbolCandidate {
  return { filePath, line, column: 5, signature: "def main()" };
}

function adapterWith(location: SymbolLocation, capabilities: Partial<CapabilityMap> = { moduleLevelUnits: true }) {
  const calls: unknown[] = [];
  const adapter = createStubAdapter({
    id: "mentira",
    displayName: "Mentira",
    capabilities,
    override: {
      locateSymbol: async (_project, target) => {
        calls.push(target);
        return location;
      },
    },
  });
  return { adapter, calls };
}

const opened = (relativePath: string) => path.join(ROOT, ...relativePath.split("/"));

describe("elección de la unidad", () => {
  it("sin clase, si el adaptador no declara funciones sueltas, la rechaza sin buscarla", async () => {
    const { adapter, calls } = adapterWith(
      { found: true, candidates: [candidate("A.java")] },
      { moduleLevelUnits: false }
    );

    const choice = await locateUnit(adapter, PROJECT, { className: null, methodName: "put" });

    assert.equal(choice.found, false);
    assert.match(!choice.found ? choice.reason : "", /En Mentira cada método pertenece a una clase: escribí el nombre de la clase\./);
    assert.equal(calls.length, 0);
  });

  it("Java y Unity no aceptan la clase vacía: todo método es de una clase", async () => {
    for (const adapter of [new JavaAdapter(), new UnityAdapter()]) {
      const choice = await locateUnit(adapter, PROJECT, { className: null, methodName: "put" });

      assert.equal(choice.found, false, adapter.descriptor.id);
      assert.match(!choice.found ? choice.reason : "", /cada método pertenece a una clase/, adapter.descriptor.id);
    }
  });

  it("con clase, toma la primera candidata aunque el archivo abierto tenga otra", async () => {
    const { adapter } = adapterWith({ found: true, candidates: [candidate("a/uno.py"), candidate("b/dos.py")] }, {});

    const choice = await locateUnit(adapter, PROJECT, { className: "Carrito", methodName: "agregar" }, opened("b/dos.py"));

    assert.deepEqual(choice, { found: true, location: candidate("a/uno.py") });
  });

  it("sin clase y en un solo archivo, la toma aunque el abierto sea otro", async () => {
    const { adapter } = adapterWith({ found: true, candidates: [candidate("a/uno.py")] });

    const choice = await locateUnit(adapter, PROJECT, { className: null, methodName: "main" }, opened("otro.py"));

    assert.deepEqual(choice, { found: true, location: candidate("a/uno.py") });
  });

  it("sin clase y en varios archivos, el abierto desempata", async () => {
    const { adapter } = adapterWith({
      found: true,
      candidates: [candidate("a/uno.py"), candidate("b/dos.py"), candidate("c/tres.py")],
    });

    const choice = await locateUnit(adapter, PROJECT, { className: null, methodName: "main" }, opened("b/dos.py"));

    assert.deepEqual(choice, { found: true, location: candidate("b/dos.py") });
  });

  it("sin clase y en varios archivos, si el abierto no tiene ninguna, pide abrir el correcto y dice dónde están", async () => {
    const { adapter } = adapterWith({ found: true, candidates: [candidate("a/uno.py"), candidate("b/dos.py")] });

    for (const editorPath of [opened("otro.py"), undefined]) {
      const choice = await locateUnit(adapter, PROJECT, { className: null, methodName: "main" }, editorPath);

      assert.equal(choice.found, false);
      assert.equal(
        !choice.found ? choice.reason : "",
        'Hay una función "main" fuera de toda clase en 2 archivos: a/uno.py, b/dos.py. ' +
          "Abrí el archivo de la que querés probar y volvé a pedirla."
      );
    }
  });

  it("si está en muchos archivos, nombra cinco y cuenta los demás", async () => {
    const [first, ...rest] = ["a", "b", "c", "d", "e", "f", "g"].map((name) => candidate(`${name}.py`));
    const { adapter } = adapterWith({ found: true, candidates: [first, ...rest] });

    const choice = await locateUnit(adapter, PROJECT, { className: null, methodName: "main" });

    assert.match(!choice.found ? choice.reason : "", /en 7 archivos: a\.py, b\.py, c\.py, d\.py, e\.py y 2 más\./);
  });

  it("dos declaraciones en el mismo archivo: vale la última", async () => {
    const { adapter } = adapterWith({
      found: true,
      candidates: [candidate("a/uno.py", 3), candidate("a/uno.py", 9), candidate("b/dos.py", 1)],
    });

    const choice = await locateUnit(adapter, PROJECT, { className: null, methodName: "main" }, opened("a/uno.py"));

    assert.deepEqual(choice, { found: true, location: candidate("a/uno.py", 9) });
  });

  it("si OP-05 no la encuentra, devuelve su motivo", async () => {
    const { adapter } = adapterWith({ found: false, reason: "No se encontró ninguna función." });

    const choice = await locateUnit(adapter, PROJECT, { className: null, methodName: "main" });

    assert.deepEqual(choice, { found: false, reason: "No se encontró ninguna función." });
  });
});
