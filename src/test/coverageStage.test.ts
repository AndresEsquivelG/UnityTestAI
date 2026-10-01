import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vm from "vm";
import type {
  ArtifactSpec,
  CoverageMeasured,
  CoverageResult,
  CoverageTarget,
  ProjectModel,
  TestExecutionResult,
} from "../core/contracts";
import {
  COVERAGE_DATA_MARKER,
  buildCoverageDocument,
  presentCoverage,
  renderCoverageDocument,
  runCoverageStage,
  runTestStage,
  type CoverageDocument,
} from "../core/verification";
import { createStubAdapter } from "./support/stubAdapter";

/**
 * Etapa de cobertura del núcleo (OP-15) y su informe HTML.
 *
 * Con adaptadores de mentira: que la cobertura espere a una ejecución
 * completa, que la decisión ausente se lea «no disponible» y que el informe
 * no se rompa con el código fuente son reglas del núcleo, no de Unity.
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

const TARGET: CoverageTarget = {
  filePath: "src/calculo.x",
  unit: { className: "Calculo", methodName: "Divide" },
};

const PASSED: TestExecutionResult = {
  status: "passed",
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
  cases: [{ testName: "prueba.Divide", outcome: "passed" }],
  exitCode: 0,
  rawReport: "",
  rawCoverage: "datos",
};

const MEASURED: CoverageMeasured = {
  status: "measured",
  line: { covered: 2, total: 8, percentage: 25 },
  byFile: [
    {
      filePath: "src/calculo.x",
      line: { covered: 2, total: 8, percentage: 25 },
      units: [
        { name: "Calculo.Suma", firstLine: 2, line: { covered: 0, total: 5, percentage: 0 } },
        { name: "Calculo.Divide", firstLine: 8, line: { covered: 2, total: 3, percentage: 66.7 } },
      ],
      lines: [
        { line: 2, status: "missed" },
        { line: 8, status: "covered" },
        { line: 9, status: "partial" },
      ],
    },
  ],
  target: { name: "Calculo.Divide", firstLine: 8, line: { covered: 2, total: 3, percentage: 66.7 } },
  notes: ["La herramienta cuenta instrucciones, no líneas."],
};

function measurer(result: CoverageResult | Error) {
  const calls: unknown[][] = [];
  const adapter = createStubAdapter({
    id: "mide",
    capabilities: { runTests: true, coverage: true },
    optional: {
      runTests: async (...args) => {
        calls.push(["runTests", ...args]);
        return PASSED;
      },
      collectCoverage: async (...args) => {
        calls.push(["collectCoverage", ...args]);
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
    },
  });
  return { adapter, calls };
}

describe("etapa de cobertura", () => {
  it("si el adaptador no mide, la etapa no aplica", async () => {
    const adapter = createStubAdapter({ id: "sin-cobertura" });

    assert.deepEqual(await runCoverageStage(adapter, PROJECT, PASSED, TARGET), {
      status: "notApplicable",
    });
  });

  for (const execution of [
    { status: "notApplicable" } as const,
    {
      status: "notRun",
      blocker: { code: "x", message: "no compiló", remediation: "compilá" },
    } as const,
  ]) {
    it(`con la ejecución en ${execution.status} no mide nada`, async () => {
      const { adapter, calls } = measurer(MEASURED);

      const outcome = await runCoverageStage(adapter, PROJECT, execution, TARGET);

      assert.ok(outcome.status === "notRun");
      assert.equal(outcome.blocker.code, "core.coverage-needs-run");
      assert.equal(calls.length, 0);
    });
  }

  it("mide también una ejecución con fallos, con la corrida y el archivo pedidos", async () => {
    const { adapter, calls } = measurer(MEASURED);
    const failed: TestExecutionResult = { ...PASSED, status: "failed", passed: 0, failed: 1 };

    const outcome = await runCoverageStage(adapter, PROJECT, failed, TARGET);

    assert.equal(outcome, MEASURED);
    assert.deepEqual(calls, [["collectCoverage", PROJECT, failed, TARGET]]);
  });

  it("si el adaptador lanza, la etapa queda sin medir y no pierde la corrida", async () => {
    const { adapter } = measurer(new Error("se cayó"));

    const outcome = await runCoverageStage(adapter, PROJECT, PASSED, TARGET);

    assert.ok(outcome.status === "notRun");
    assert.equal(outcome.blocker.code, "core.coverage-crashed");
    assert.match(outcome.blocker.message, /se cayó/);
  });

  it("la ejecución pide la cobertura solo si el adaptador la declara", async () => {
    const { adapter, calls } = measurer(MEASURED);
    await runTestStage(adapter, PROJECT, SPEC, "passed", TARGET);
    assert.deepEqual(calls, [["runTests", PROJECT, SPEC, TARGET]]);

    const runOnly: unknown[][] = [];
    const withoutCoverage = createStubAdapter({
      id: "solo-ejecuta",
      capabilities: { runTests: true },
      optional: {
        runTests: async (...args) => {
          runOnly.push(args);
          return PASSED;
        },
      },
    });
    await runTestStage(withoutCoverage, PROJECT, SPEC, "passed", TARGET);
    assert.deepEqual(runOnly, [[PROJECT, SPEC, undefined]]);
  });
});

describe("presentación de la cobertura", () => {
  it("resume la unidad bajo prueba y deja el archivo, la decisión y las notas como detalle", () => {
    const presentation = presentCoverage(MEASURED, TARGET);

    assert.equal(presentation.stageName, "Cobertura");
    assert.equal(presentation.status, "measured");
    assert.equal(presentation.summary, "método Divide, 66,7 % de líneas (2 de 3).");
    assert.deepEqual(presentation.details, [
      "Archivo src/calculo.x: 25 % de líneas (2 de 8).",
      "Decisión: no disponible.",
      "La herramienta cuenta instrucciones, no líneas.",
    ]);
  });

  it("con decisión, la muestra con sus cifras", () => {
    const presentation = presentCoverage(
      { ...MEASURED, decision: { covered: 1, total: 4, percentage: 25 } },
      TARGET
    );

    assert.ok(presentation.details?.includes("Decisión: 25 % de decisiones (1 de 4)."));
  });

  it("si no encontró la unidad, lo dice en vez de mostrar la cifra del archivo como suya", () => {
    const { target: _omitted, ...withoutTarget } = MEASURED;
    const presentation = presentCoverage(withoutTarget, TARGET);

    assert.equal(presentation.summary, "no se encontró código medible de Divide en el archivo.");
  });

  it("nunca ofrece reintento propio: lo da la ejecución", () => {
    const notRun = presentCoverage(
      { status: "notRun", blocker: { code: "x", message: "Falta el paquete.", remediation: "Instalalo." } },
      TARGET
    );

    assert.equal(presentCoverage(MEASURED, TARGET).retryable, false);
    assert.equal(notRun.retryable, false);
    assert.equal(notRun.summary, "No se midió. Falta el paquete.");
    assert.equal(notRun.remediation, "Instalalo.");
  });
});

describe("informe HTML de la cobertura", () => {
  let root: string;
  let project: ProjectModel;
  const template = fs.readFileSync(
    path.join(__dirname, "..", "..", "ui", "coverage", "report.html"),
    "utf8"
  );

  before(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "utia-informe-"));
    await fsp.mkdir(path.join(root, "src"), { recursive: true });
    // Con BOM, finales de Windows y lo que rompería un HTML armado a mano.
    await fsp.writeFile(
      path.join(root, "src", "calculo.x"),
      "\uFEFFclase Calculo {\r\n  Suma(List<int> a) { }\r\n  // </script><b>$&</b>\r\n}\r\n",
      "utf8"
    );
    project = { ...PROJECT, rootPath: root };
  });

  after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  /** Los datos tal como los lee el script de la plantilla. */
  function embeddedData(html: string): CoverageDocument {
    const script = /<script id="coverage-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(script, "el bloque de datos sigue entero");
    return JSON.parse(script[1]);
  }

  it("lleva el archivo entero, con el estado solo en las líneas medibles", async () => {
    const document = await buildCoverageDocument(project, MEASURED, TARGET, "prueba", new Date("2026-10-01T12:00:00Z"));

    assert.equal(document.title, "Cobertura de Calculo.Divide");
    assert.equal(document.generatedAt, "2026-10-01T12:00:00.000Z");
    assert.equal(document.decision, undefined);
    const [file] = document.files;
    assert.deepEqual(file.source.slice(0, 3), [
      { number: 1, text: "clase Calculo {" },
      { number: 2, text: "  Suma(List<int> a) { }", status: "missed" },
      { number: 3, text: "  // </script><b>$&</b>" },
    ]);
    assert.deepEqual(
      file.units.map((unit) => [unit.name, unit.isTarget]),
      [
        ["Calculo.Suma", false],
        ["Calculo.Divide", true],
      ]
    );
  });

  it("si no puede leer el archivo, lo dice y arma el resto", async () => {
    const document = await buildCoverageDocument({ ...PROJECT, rootPath: path.join(root, "no-existe") }, MEASURED, TARGET, "prueba");

    assert.deepEqual(document.files[0].source, []);
    assert.match(document.files[0].sourceError ?? "", /No se pudo leer el archivo/);
  });

  it("el código fuente no cierra el bloque de datos ni se lee como patrón de reemplazo", async () => {
    const document = await buildCoverageDocument(project, MEASURED, TARGET, "prueba");
    const html = renderCoverageDocument(template, document);

    assert.ok(!html.includes(COVERAGE_DATA_MARKER));
    assert.equal((html.match(/<\/script>/g) ?? []).length, 2, "solo los dos cierres de la plantilla");
    assert.deepEqual(embeddedData(html), JSON.parse(JSON.stringify(document)));
  });

  it("la plantilla dibuja los datos sin interpretar el código como HTML", async () => {
    const document = await buildCoverageDocument(project, MEASURED, TARGET, "prueba");
    const html = renderCoverageDocument(template, document);
    const page = renderWithFakeDom(html);

    assert.equal(page.title, "Cobertura de Calculo.Divide");
    assert.ok(page.texts.includes("  // </script><b>$&</b>"), "el comentario llega como texto");
    assert.ok(page.texts.includes("No disponible"));
    assert.ok(page.texts.includes("Calculo.Divide (bajo prueba)"));
    assert.ok(page.classes.includes("missed") && page.classes.includes("is-target"));
  });

  it("una plantilla sin el lugar de los datos es un error, no un informe vacío", () => {
    assert.throws(() => renderCoverageDocument("<html></html>", {} as CoverageDocument), /lugar de los datos/);
  });
});

/**
 * Corre el script de la plantilla con un documento mínimo de mentira: no
 * hace falta un navegador para saber qué textos y clases arma, y que todo
 * entra por `textContent`.
 */
function renderWithFakeDom(html: string) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const data = scripts.find((script) => script[1].includes("coverage-data"));
  const code = scripts.find((script) => !script[1].includes("coverage-data"));
  assert.ok(data && code);

  const texts: string[] = [];
  const classes: string[] = [];
  const makeNode = (): Record<string, unknown> => {
    const node: Record<string, unknown> = {
      style: {},
      appendChild: () => undefined,
      replaceChildren: () => undefined,
    };
    Object.defineProperty(node, "textContent", {
      set: (value: string) => texts.push(value),
      get: () => data[2],
    });
    Object.defineProperty(node, "className", {
      set: (value: string) => classes.push(...value.split(" ").filter(Boolean)),
    });
    Object.defineProperty(node, "innerHTML", {
      set: () => assert.fail("la plantilla no debe usar innerHTML"),
    });
    return node;
  };
  const document = {
    title: "",
    getElementById: () => makeNode(),
    createElement: () => makeNode(),
  };
  vm.runInNewContext(code[2], { document, JSON, Math, String, Date });
  return { title: document.title, texts, classes };
}
