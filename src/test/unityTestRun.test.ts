import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import { parseNUnitReport, testFilter, testPlatform } from "../adapters/unity/testRun";
import type { EditorRunResult, UnityEditorToolchain } from "../adapters/unity/editor";
import type { ArtifactSpec, ProjectModel } from "../core/contracts";
import { createUnityFixture, type UnityFixture } from "./support/unityFixture";

/**
 * Ejecución de la prueba con el Test Runner de Unity (OP-14).
 *
 * Los informes son extractos de corridas reales de Unity 2021.3.19f1 con una
 * clase sonda que tenía una prueba de cada clase de resultado, acortados sin
 * cambiar su forma: los contadores, los CDATA con saltos y sangría, la salida
 * de otro paquete dentro de una prueba que pasa. El editor se reemplaza por
 * uno de mentira que escribe el log y el informe donde los dejaría Unity.
 */

const SPEC: ArtifactSpec = {
  directory: "Assets/Tests",
  fileName: "UTIA_probe_Sonda",
  extension: ".cs",
  unitName: "UTIA_probe_Sonda",
};

/** Seis pruebas: dos pasan, dos fallan, una omitida y una no concluyente. */
const REPORT_MIXED = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="2" testcasecount="6" result="Failed(Child)" total="6" passed="2" failed="2" inconclusive="1" skipped="1" asserts="0" engine-version="3.5.0.0">
  <test-suite type="TestSuite" id="1023" name="CandyCrushClone" fullname="CandyCrushClone" result="Failed" total="6" passed="2" failed="2" inconclusive="1" skipped="1">
    <failure>
      <message><![CDATA[One or more child tests had errors]]></message>
    </failure>
    <test-suite type="TestFixture" id="1013" name="UTIA_probe_Sonda" fullname="UTIA_probe_Sonda" classname="UTIA_probe_Sonda" result="Failed">
      <failure>
        <message><![CDATA[One or more child tests had errors]]></message>
      </failure>
      <test-case id="1018" name="Dudosa" fullname="UTIA_probe_Sonda.Dudosa" methodname="Dudosa" classname="UTIA_probe_Sonda" runstate="Runnable" result="Inconclusive">
        <reason>
          <message><![CDATA[no se sabe]]></message>
        </reason>
      </test-case>
      <test-case id="1015" name="Falla" fullname="UTIA_probe_Sonda.Falla" methodname="Falla" classname="UTIA_probe_Sonda" runstate="Runnable" result="Failed" duration="0.026671">
        <failure>
          <message><![CDATA[  suma mal
  Expected: 3
  But was:  2
]]></message>
          <stack-trace><![CDATA[at UTIA_probe_Sonda.Falla () [0x00001] in D:\\Juego\\Assets\\Tests\\UTIA_probe_Sonda.cs:8
]]></stack-trace>
        </failure>
      </test-case>
      <test-case id="1019" name="Lanza" fullname="UTIA_probe_Sonda.Lanza" methodname="Lanza" classname="UTIA_probe_Sonda" runstate="Runnable" result="Failed" label="Error">
        <failure>
          <message><![CDATA[System.InvalidOperationException : boom <T>]]></message>
          <stack-trace><![CDATA[  at UTIA_probe_Sonda.Lanza () [0x00001] in D:\\Juego\\Assets\\Tests\\UTIA_probe_Sonda.cs:12
]]></stack-trace>
        </failure>
      </test-case>
      <test-case id="1016" name="Omitida" fullname="UTIA_probe_Sonda.Omitida" methodname="Omitida" classname="UTIA_probe_Sonda" runstate="Ignored" result="Skipped" label="Ignored">
        <reason>
          <message><![CDATA[omitida a propósito]]></message>
        </reason>
      </test-case>
      <test-case id="1014" name="Pasa" fullname="UTIA_probe_Sonda.Pasa" methodname="Pasa" classname="UTIA_probe_Sonda" runstate="Runnable" result="Passed" duration="0.001599">
      </test-case>
      <test-case id="1017" name="PasaEnCuadros" fullname="UTIA_probe_Sonda.PasaEnCuadros" methodname="PasaEnCuadros" classname="UTIA_probe_Sonda" runstate="Runnable" result="Passed">
        <output><![CDATA[NullReferenceException: Object reference not set to an instance of an object
UnityEditor.TestTools.CodeCoverage.Utils.CoverageUtils.GetFilteringLogParams (...)
]]></output>
      </test-case>
    </test-suite>
  </test-suite>
</test-run>`;

const REPORT_ALL_PASSED = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="2" testcasecount="5" result="Passed" total="5" passed="5" failed="0" inconclusive="0" skipped="0" asserts="0" engine-version="3.5.0.0">
</test-run>`;

/** Lo que deja un filtro que no encuentra ninguna prueba: código 0. */
const REPORT_EMPTY = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="2" testcasecount="0" result="Passed" total="0" passed="0" failed="0" inconclusive="0" skipped="0" asserts="0" engine-version="3.5.0.0">
</test-run>`;

/** El proyecto no compila: sale con 1 y no deja informe. */
const LOG_COMPILE_ERRORS = `Assets\\Tests\\UTIA_probe_Sonda.cs(7,59): error CS1002: ; expected
Scripts have compiler errors.
Exiting without the bug reporter. Application will terminate with return code 1`;

const LOG_PROJECT_OPEN = `It looks like another Unity instance is running with this project open.`;

interface FakeEditor extends UnityEditorToolchain {
  readonly runs: (readonly string[])[];
}

function fakeEditor(options: {
  projectOpen?: boolean;
  log?: string;
  report?: string;
  result?: EditorRunResult;
}): FakeEditor {
  const runs: (readonly string[])[] = [];
  return {
    runs,
    findEditor: async (version) => `C:/Unity/${version}/Unity.exe`,
    isProjectOpen: async () => options.projectOpen ?? false,
    run: async (_executable, args) => {
      runs.push(args);
      await fsp.writeFile(args[args.indexOf("-logFile") + 1], options.log ?? "", "utf8");
      if (options.report !== undefined) {
        await fsp.writeFile(args[args.indexOf("-testResults") + 1], options.report, "utf8");
      }
      return options.result ?? { exitCode: 0, timedOut: false };
    },
  };
}

describe("ejecución de la prueba en Unity (OP-14)", () => {
  let fixture: UnityFixture;
  let project: ProjectModel;

  before(async () => {
    fixture = await createUnityFixture();
    await fsp.writeFile(
      path.join(fixture.testsDir, "Tests.asmdef"),
      JSON.stringify({ name: "Tests", includePlatforms: [] }),
      "utf8"
    );
    project = await new UnityAdapter().buildProjectModel(fixture.projectRoot);
  });

  after(async () => {
    await fixture.dispose();
  });

  const run = (editor: UnityEditorToolchain) =>
    new UnityAdapter({ toolchain: editor }).runTests(project, SPEC);

  describe("lectura del informe", () => {
    it("cuenta las no concluyentes como omitidas, para que el total cierre", () => {
      const report = parseNUnitReport(REPORT_MIXED);

      assert.ok(report);
      assert.deepEqual(
        [report.total, report.passed, report.failed, report.skipped],
        [6, 2, 2, 2]
      );
    });

    it("devuelve cada prueba, no las suites, con su resultado y en el orden del informe", () => {
      const report = parseNUnitReport(REPORT_MIXED);

      assert.ok(report);
      assert.deepEqual(
        report.cases.map((testCase) => [testCase.testName, testCase.outcome]),
        [
          ["UTIA_probe_Sonda.Dudosa", "skipped"],
          ["UTIA_probe_Sonda.Falla", "failed"],
          ["UTIA_probe_Sonda.Lanza", "failed"],
          ["UTIA_probe_Sonda.Omitida", "skipped"],
          ["UTIA_probe_Sonda.Pasa", "passed"],
          ["UTIA_probe_Sonda.PasaEnCuadros", "passed"],
        ]
      );
    });

    it("las fallidas llevan su mensaje y su traza; las omitidas, su motivo", () => {
      const report = parseNUnitReport(REPORT_MIXED);

      assert.ok(report);
      const byName = new Map(report.cases.map((testCase) => [testCase.testName, testCase]));
      assert.equal(byName.get("UTIA_probe_Sonda.Falla")?.message, "suma mal\n  Expected: 3\n  But was:  2");
      assert.match(byName.get("UTIA_probe_Sonda.Falla")?.stackTrace ?? "", /UTIA_probe_Sonda\.cs:8$/);
      assert.equal(byName.get("UTIA_probe_Sonda.Lanza")?.message, "System.InvalidOperationException : boom <T>");
      assert.equal(byName.get("UTIA_probe_Sonda.Omitida")?.message, "omitida a propósito");
      assert.equal(byName.get("UTIA_probe_Sonda.Dudosa")?.message, "no se sabe");
      assert.equal(byName.get("UTIA_probe_Sonda.Dudosa")?.stackTrace, undefined);
    });

    it("una que pasa no toma como motivo la salida de otro paquete", () => {
      const report = parseNUnitReport(REPORT_MIXED);

      assert.ok(report);
      const withOutput = report.cases.find((testCase) => testCase.testName.endsWith("PasaEnCuadros"));
      assert.deepEqual(withOutput, { testName: "UTIA_probe_Sonda.PasaEnCuadros", outcome: "passed" });
    });

    it("una que pasa con Assert.Pass conserva el mensaje con el que pasó", () => {
      // Extracto de una corrida real: `Assert.Pass("…")` queda como Passed con
      // el mensaje en `reason`.
      const report = parseNUnitReport(`<test-run total="1" passed="1" failed="0">
        <test-case id="1015" name="Inalcanzable" fullname="UTIA_probe_Pass.Inalcanzable" methodname="Inalcanzable" classname="UTIA_probe_Pass" runstate="Runnable" result="Passed">
          <properties>
            <property name="retryIteration" value="0" />
          </properties>
          <reason>
            <message><![CDATA[rama inalcanzable desde una prueba]]></message>
          </reason>
        </test-case>
</test-run>`);

      assert.ok(report);
      assert.deepEqual(report.cases, [
        {
          testName: "UTIA_probe_Pass.Inalcanzable",
          outcome: "passed",
          message: "rama inalcanzable desde una prueba",
        },
      ]);
    });

    it("pasa la duración a milisegundos, con punto o con coma decimal", () => {
      const report = parseNUnitReport(REPORT_MIXED);
      const comma = parseNUnitReport(`<test-run total="1" passed="1" failed="0">
  <test-case fullname="UTIA_x.Caso" result="Passed" duration="0,1257387"></test-case>
</test-run>`);

      assert.ok(report && comma);
      assert.deepEqual(
        report.cases.map((testCase) => testCase.durationMs),
        [undefined, 27, undefined, undefined, 2, undefined]
      );
      assert.equal(comma.cases[0].durationMs, 126);
    });

    it("decodifica las entidades fuera de CDATA, en atributos y en texto", () => {
      const report = parseNUnitReport(`<test-run total="1" passed="0" failed="1">
  <test-case fullname="UTIA_x.Caso(&quot;a&lt;b&quot;)" result="Failed">
    <failure><message>esperaba &lt;T&gt; &amp; &#233;</message></failure>
  </test-case>
</test-run>`);

      assert.ok(report);
      assert.deepEqual(report.cases, [
        { testName: 'UTIA_x.Caso("a<b")', outcome: "failed", message: "esperaba <T> & é" },
      ]);
    });

    it("sin el elemento de la corrida no hay informe", () => {
      assert.equal(parseNUnitReport("<html>no</html>"), undefined);
    });
  });

  describe("clasificación del resultado", () => {
    it("con fallos: `failed` con los cuatro contadores y el informe crudo", async () => {
      const result = await run(fakeEditor({ report: REPORT_MIXED, result: { exitCode: 2, timedOut: false } }));

      assert.ok(result.status === "failed");
      assert.deepEqual([result.total, result.passed, result.failed, result.skipped], [6, 2, 2, 2]);
      assert.equal(result.exitCode, 2);
      assert.equal(result.rawReport, REPORT_MIXED);
    });

    it("sin fallos: `passed`", async () => {
      const result = await run(fakeEditor({ report: REPORT_ALL_PASSED }));

      assert.ok(result.status === "passed");
      assert.equal(result.total, 5);
      assert.deepEqual(result.cases, []);
    });

    it("un informe con cero pruebas no es un éxito, aunque el código sea 0", async () => {
      const result = await run(fakeEditor({ report: REPORT_EMPTY }));

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.no-tests-found");
      assert.match(result.blocker.message, /UTIA_probe_Sonda/);
    });

    it("si el proyecto no compila, no hay informe y lo dice", async () => {
      const result = await run(
        fakeEditor({ log: LOG_COMPILE_ERRORS, result: { exitCode: 1, timedOut: false } })
      );

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.tests-not-compiled");
    });

    it("sin informe y sin errores de compilación, informa el código de salida", async () => {
      const result = await run(fakeEditor({ log: "otra cosa", result: { exitCode: 3, timedOut: false } }));

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.test-report-missing");
      assert.match(result.blocker.message, /código 3/);
    });

    it("con el editor abierto no lanza nada y pide cerrarlo", async () => {
      const editor = fakeEditor({ projectOpen: true });
      const result = await run(editor);

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.project-open");
      assert.match(result.blocker.remediation, /la ejecución/);
      assert.equal(editor.runs.length, 0);
    });

    it("si el bloqueo no se detectó antes, lo reconoce en el log", async () => {
      const result = await run(fakeEditor({ log: LOG_PROJECT_OPEN, result: { exitCode: 21, timedOut: false } }));

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.project-open");
    });

    it("si se agota el tiempo, no es un fallo de la prueba", async () => {
      const result = await run(fakeEditor({ result: { exitCode: null, timedOut: true } }));

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.test-run-timeout");
    });
  });

  describe("invocación", () => {
    it("ejecuta solo la clase generada, sin -quit, y borra la carpeta temporal", async () => {
      const editor = fakeEditor({ report: REPORT_ALL_PASSED });
      await run(editor);

      const [args] = editor.runs;
      assert.ok(args.includes("-runTests"));
      assert.ok(!args.includes("-quit"), "con -quit el editor se cierra antes de ejecutar");
      assert.equal(args[args.indexOf("-projectPath") + 1], fixture.projectRoot);
      assert.equal(args[args.indexOf("-testPlatform") + 1], "PlayMode");
      assert.equal(args[args.indexOf("-testFilter") + 1], "(^|\\.)UTIA_probe_Sonda\\.");

      const report = args[args.indexOf("-testResults") + 1];
      assert.equal(path.dirname(path.dirname(report)), os.tmpdir());
      await assert.rejects(fsp.stat(path.dirname(report)));
    });

    it("el filtro toma la clase exacta, con o sin espacio de nombres", () => {
      const filter = new RegExp(testFilter({ ...SPEC, unitName: "UTIA_m_A_B" }));

      assert.ok(filter.test("UTIA_m_A_B.Caso"));
      assert.ok(filter.test("Juego.Pruebas.UTIA_m_A_B.Caso"));
      assert.ok(!filter.test("UTIA_m_A_Bc.Caso"), "una clase que empieza igual no entra");
      assert.ok(!filter.test("XUTIA_m_A_B.Caso"));
    });

    it("elige EditMode solo si el ensamblado de pruebas se limita al editor", async () => {
      const definition = path.join(fixture.testsDir, "Tests.asmdef");
      const original = await fsp.readFile(definition, "utf8");
      try {
        assert.equal(await testPlatform(project, SPEC), "PlayMode");

        await fsp.writeFile(definition, JSON.stringify({ includePlatforms: ["Editor"] }), "utf8");
        assert.equal(await testPlatform(project, SPEC), "EditMode");

        await fsp.writeFile(definition, "{ no es json", "utf8");
        assert.equal(await testPlatform(project, SPEC), "PlayMode");
      } finally {
        await fsp.writeFile(definition, original, "utf8");
      }
    });
  });
});
