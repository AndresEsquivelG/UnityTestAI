import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArtifactSpec, ProjectModel, TestExecutionResult } from "../core/contracts";
import { presentTestRun, runTestStage } from "../core/verification";
import { createStubAdapter } from "./support/stubAdapter";

/**
 * Etapa de ejecución del núcleo (OP-14).
 *
 * Con adaptadores de mentira: el camino en el que el ecosistema no ejecuta
 * pruebas no lo recorre ningún adaptador real, y la condición de haber
 * pasado la verificación es del núcleo, no de Unity.
 */

const PROJECT: ProjectModel = {
  rootPath: "/proyecto",
  ecosystemId: "mentira",
  sourceRoots: [],
  sources: [],
};

const SPEC: ArtifactSpec = {
  directory: "tests",
  fileName: "prueba",
  extension: ".x",
  unitName: "prueba",
};

const PASSED: TestExecutionResult = {
  status: "passed",
  total: 3,
  passed: 3,
  failed: 0,
  skipped: 0,
  cases: [
    { testName: "prueba.Suma", outcome: "passed" },
    { testName: "prueba.Resta", outcome: "passed" },
    { testName: "prueba.Divide", outcome: "passed" },
  ],
  exitCode: 0,
  rawReport: "",
};

function runner(result: TestExecutionResult | Error) {
  const calls: unknown[] = [];
  const adapter = createStubAdapter({
    id: "ejecuta",
    capabilities: { runTests: true },
    optional: {
      runTests: async (project, spec) => {
        calls.push(project, spec);
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
    },
  });
  return { adapter, calls };
}

describe("etapa de ejecución", () => {
  it("si el adaptador no ejecuta pruebas, la etapa no aplica", async () => {
    const adapter = createStubAdapter({ id: "sin-ejecucion" });

    assert.deepEqual(await runTestStage(adapter, PROJECT, SPEC, "passed"), {
      status: "notApplicable",
    });
  });

  for (const verification of ["failed", "notRun"] as const) {
    it(`con la verificación en ${verification} no ejecuta nada`, async () => {
      const { adapter, calls } = runner(PASSED);

      const outcome = await runTestStage(adapter, PROJECT, SPEC, verification);

      assert.ok(outcome.status === "notRun");
      assert.equal(outcome.blocker.code, "core.test-run-needs-verification");
      assert.equal(calls.length, 0);
    });
  }

  for (const verification of ["passed", "notApplicable"] as const) {
    it(`con la verificación en ${verification} ejecuta y devuelve el resultado tal cual`, async () => {
      const { adapter, calls } = runner(PASSED);

      assert.equal(await runTestStage(adapter, PROJECT, SPEC, verification), PASSED);
      assert.deepEqual(calls, [PROJECT, SPEC]);
    });
  }

  it("si el adaptador lanza, la corrida sigue y la etapa queda sin ejecutar", async () => {
    const { adapter } = runner(new Error("se cayó"));

    const outcome = await runTestStage(adapter, PROJECT, SPEC, "passed");

    assert.ok(outcome.status === "notRun");
    assert.equal(outcome.blocker.code, "core.test-run-crashed");
    assert.match(outcome.blocker.message, /se cayó/);
  });

  describe("presentación", () => {
    it("muestra siempre los cuatro contadores, también los que son cero", () => {
      const presented = presentTestRun(PASSED);

      assert.equal(presented.stageName, "Ejecución");
      assert.equal(presented.summary, "3 pruebas: 3 exitosas, 0 fallidas, 0 omitidas.");
      assert.equal(presented.remediation, undefined);
    });

    it("muestra cada prueba, las fallidas primero y sin la clase en el nombre", () => {
      const presented = presentTestRun(
        {
          ...PASSED,
          status: "failed",
          total: 4,
          passed: 1,
          failed: 1,
          skipped: 2,
          cases: [
            { testName: "Juego.Clase.Pasa", outcome: "passed", durationMs: 2 },
            { testName: "Juego.Clase.Omitida", outcome: "skipped", message: "a propósito" },
            { testName: "Juego.Clase.Falla", outcome: "failed", message: "suma mal\n  Expected: 3\n  But was:  2" },
            { testName: 'Juego.Clase.Caso("a.b")', outcome: "skipped" },
          ],
        },
        "Clase"
      );

      assert.equal(presented.summary, "4 pruebas: 1 exitosa, 1 fallida, 2 omitidas.");
      assert.deepEqual(presented.cases, [
        { outcome: "failed", name: "Falla", detail: "suma mal · Expected: 3 · But was:  2" },
        { outcome: "skipped", name: "Omitida", detail: "a propósito" },
        // Los puntos dentro de los paréntesis no cortan el nombre.
        { outcome: "skipped", name: 'Caso("a.b")' },
        { outcome: "passed", name: "Pasa" },
      ]);
      assert.deepEqual(presented.diagnostics, []);
      // Una prueba que falla no se corrige sola: se avisa que puede ser el código.
      assert.match(presented.remediation ?? "", /defecto del código/);
    });

    it("sin el nombre de la clase, deja el nombre completo", () => {
      const presented = presentTestRun(PASSED);

      assert.deepEqual(
        presented.cases?.map((testCase) => testCase.name),
        ["prueba.Suma", "prueba.Resta", "prueba.Divide"]
      );
    });

    it("sin verificación aprobada no ofrece reintentar solo la ejecución", async () => {
      const { adapter } = runner(PASSED);
      const presented = presentTestRun(await runTestStage(adapter, PROJECT, SPEC, "failed"));

      assert.equal(presented.retryable, false);
    });

    it("un resultado sin ejecutar del adaptador sí se puede reintentar", () => {
      const presented = presentTestRun({
        status: "notRun",
        blocker: { code: "x", message: "El proyecto está tomado.", remediation: "Liberalo." },
      });

      assert.equal(presented.summary, "No se ejecutó. El proyecto está tomado.");
      assert.equal(presented.retryable, undefined);
    });
  });
});
