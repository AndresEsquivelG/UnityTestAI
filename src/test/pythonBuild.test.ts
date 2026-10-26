import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { parseCollectionErrors } from "../adapters/python/build/collection";
import { readCoverageJson } from "../adapters/python/build/coverageReport";
import { parseJUnitReport } from "../adapters/python/build/junitReport";
import { REVIEW_SCRIPT } from "../adapters/python/build/review";
import { pythonEnvironment } from "../adapters/python/build/runtime";
import { PythonAdapter } from "../adapters/python/pythonAdapter";
import type { ArtifactSpec, CompletedTestRun, CoverageTarget, ProjectModel } from "../core/contracts";
import { verifyAndRepair } from "../core/verification/repair";
import { CARRITO, createPythonFixture, type PythonFixture } from "./support/pythonFixture";
import {
  CARRITO_COVERAGE_JSON,
  COLLECTION_FAILURE_JUNIT,
  COLLECT_NOTHING,
  MIXED_JUNIT,
  collectImportError,
  collectInputError,
  collectProjectError,
  collectStandardLibraryError,
  collectSyntaxError,
  fakePythonRuntime,
  reviewAnswer,
  type FakeInterpreter,
  type FakePythonResponse,
  type PythonStep,
} from "./support/pythonRunOutputs";

/**
 * Comprobación de importabilidad, ejecución y cobertura del adaptador de
 * Python (OP-13 a OP-15), con un Python de mentira que contesta con salidas
 * reales y deja los informes donde los dejaría el de verdad.
 */

const SPEC: ArtifactSpec = {
  directory: "tests",
  fileName: "UTIA_prueba_Carrito_agregar_test",
  extension: ".py",
  unitName: "UTIA_prueba_Carrito_agregar_test",
};
const ARTIFACT = `${SPEC.directory}/${SPEC.fileName}${SPEC.extension}`;
const TEST_FILE = path.join("tests", `${SPEC.fileName}${SPEC.extension}`);

const TARGET: CoverageTarget = {
  filePath: "tienda/carrito.py",
  unit: { className: "Carrito", methodName: "agregar" },
};

describe("comprobación, ejecución y cobertura de Python (OP-13 a OP-15)", () => {
  let fixture: PythonFixture;
  let project: ProjectModel;

  beforeEach(async () => {
    fixture = await createPythonFixture();
    project = await new PythonAdapter().buildProjectModel(fixture.projectRoot);
  });
  afterEach(async () => fixture.dispose());

  const adapterWith = (
    respond?: (step: PythonStep, args: readonly string[]) => FakePythonResponse | undefined,
    interpreters?: Readonly<Record<string, FakeInterpreter>>
  ) => {
    const runtime = fakePythonRuntime({ ...(interpreters ? { interpreters } : {}), respond });
    return { adapter: new PythonAdapter({ runtime }), runtime };
  };

  /** Un entorno virtual en la raíz, con su ejecutable donde lo deja `venv`. */
  const createVirtualEnvironment = async (name: string) => {
    const relative = process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
    const executable = path.join(fixture.projectRoot, name, ...relative);
    await fsp.mkdir(path.dirname(executable), { recursive: true });
    await fsp.writeFile(path.join(fixture.projectRoot, name, "pyvenv.cfg"), "home = C:\\Python314\n", "utf8");
    await fsp.writeFile(executable, "", "utf8");
    return executable;
  };

  describe("qué Python usa", () => {
    it("el del entorno virtual del proyecto, aunque haya otro en el PATH", async () => {
      const executable = await createVirtualEnvironment("mi-entorno");
      const { adapter, runtime } = adapterWith(undefined, { venv: {}, python: {} });

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.equal(result.status, "passed");
      assert.ok(runtime.runs.every((run) => run.command === executable));
    });

    it("un entorno sin ejecutable, como el .venv del proyecto de ejemplo, no cuenta: usa el del PATH", async () => {
      const { adapter, runtime } = adapterWith();

      await adapter.verifyArtifact(project, SPEC);

      assert.ok(runtime.runs.every((run) => run.command === "python"));
    });

    it("si el entorno del proyecto no arranca, lo dice y no usa otro Python", async () => {
      await createVirtualEnvironment(".venv");
      const { adapter, runtime } = adapterWith(undefined, { venv: "broken", python: {} });

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "python.venv-broken");
      assert.match(result.blocker.message, /"\.venv"/);
      assert.ok(runtime.runs.every((run) => run.command !== "python"));
    });

    it("el atajo de la Tienda (código 9009) no es un Python: sigue con el siguiente", { skip: process.platform !== "win32" }, async () => {
      const { adapter, runtime } = adapterWith(undefined, { python: "storeAlias", py: {} });

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.equal(result.status, "passed");
      const used = runtime.runs.filter((run) => run.step !== "probe");
      assert.ok(used.every((run) => run.command === "py" && run.args[0] === "-3"));
    });

    it("sin ningún Python, dice que falta y nombra el atajo de la Tienda si lo encontró", async () => {
      const onlyStore: Record<string, FakeInterpreter> = { [process.platform === "win32" ? "python" : "python3"]: "storeAlias" };
      const { adapter } = adapterWith(undefined, onlyStore);

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "python.interpreter-missing");
      assert.match(result.blocker.message, /atajo de la Tienda/);
      assert.match(result.blocker.remediation, /python -m venv \.venv/);
    });

    it("sin pytest, lo dice con el comando para instalarlo en ese mismo Python, sin lanzar nada más", async () => {
      await createVirtualEnvironment(".venv");
      const { adapter, runtime } = adapterWith(undefined, { venv: { pytest: false } });

      const verification = await adapter.verifyArtifact(project, SPEC);
      const run = await adapter.runTests(project, SPEC, TARGET);

      for (const result of [verification, run]) {
        assert.ok(result.status === "notRun");
        assert.equal(result.blocker.code, "python.pytest-missing");
        assert.match(result.blocker.remediation, /\.venv[\\/](Scripts|bin)[\\/]python(\.exe)? -m pip install pytest coverage/);
      }
      assert.deepEqual(runtime.steps(), []);
    });
  });

  describe("el entorno de cada corrida", () => {
    it("pone la carpeta de importación delante de PYTHONPATH, pide UTF-8 y anula PYTEST_ADDOPTS", () => {
      const env = pythonEnvironment(
        { Path: "C:\\Windows", PythonPath: "C:\\otra", pytest_addopts: "--cov", PYTHONUTF8: "0" },
        "src",
        ";"
      );

      assert.equal(env["PYTHONPATH"], "src;C:\\otra");
      assert.equal(env["PythonPath"], undefined);
      assert.equal(env["pytest_addopts"], undefined);
      assert.equal(env["PYTHONUTF8"], "1");
      assert.equal(env["PYTHONDONTWRITEBYTECODE"], "1");
      assert.equal(env["Path"], "C:\\Windows");
    });

    it("con src/, cada corrida importa desde esa carpeta", async () => {
      await fixture.dispose();
      fixture = await createPythonFixture({ layout: "src" });
      project = await new PythonAdapter().buildProjectModel(fixture.projectRoot);
      const { adapter, runtime } = adapterWith();

      await adapter.verifyArtifact(project, SPEC);

      assert.ok(runtime.runs.every((run) => run.options.importRoot === "src" && run.options.cwd === fixture.projectRoot));
    });
  });

  describe("OP-13 · comprobación de importabilidad", () => {
    it("revisa y después recolecta, sin el addopts del proyecto ni su caché", async () => {
      const { adapter, runtime } = adapterWith();

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.equal(result.status, "passed");
      assert.deepEqual(runtime.steps(), ["review", "collect"]);
      const [review, collect] = runtime.runs.filter((run) => run.step !== "probe");
      assert.deepEqual(review.args, ["-c", REVIEW_SCRIPT, TEST_FILE]);
      assert.deepEqual(collect.args, ["-m", "pytest", "-q", "-o", "addopts=", "-p", "no:cacheprovider", "--collect-only", TEST_FILE]);
    });

    it("devuelve todos los errores del revisor, con su código, y no repite el que pytest también vio", async () => {
      const root = fixture.projectRoot;
      const { adapter } = adapterWith((step) =>
        step === "review"
          ? {
              stdout: reviewAnswer([
                { file: TEST_FILE, line: 1, code: "ImportError", message: "cannot import name 'Gato' from 'tienda.carrito'" },
                { file: TEST_FILE, line: 2, code: "ModuleNotFoundError", message: "No module named 'tienda.nada'" },
                { file: TEST_FILE, line: 9, column: 20, code: "NameError", message: "name 'Perro' is not defined" },
                { file: TEST_FILE, line: 13, column: 35, code: "NameError", message: "name 'Resultado' is not defined" },
              ]),
            }
          : step === "collect"
            ? { exitCode: 2, output: collectImportError(root, `${SPEC.fileName}.py`) }
            : undefined
      );

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.ok(result.status === "failed");
      assert.equal(result.exitCode, 2);
      assert.deepEqual(
        result.diagnostics.map((d) => `${d.filePath}:${d.line} ${d.code}`),
        [`${ARTIFACT}:1 ImportError`, `${ARTIFACT}:2 ModuleNotFoundError`, `${ARTIFACT}:9 NameError`, `${ARTIFACT}:13 NameError`]
      );
      assert.equal(result.diagnostics[2].column, 20);
      assert.match(result.rawOutput, /── revisor de la prueba ──[\s\S]*── pytest --collect-only ──/);
    });

    it("lo que solo ve pytest también cuenta, con la ruta de la prueba", async () => {
      const { adapter } = adapterWith((step) =>
        step === "collect" ? { exitCode: 2, output: collectSyntaxError(fixture.projectRoot, `${SPEC.fileName}.py`) } : undefined
      );

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.ok(result.status === "failed");
      assert.deepEqual(
        result.diagnostics.map((d) => [d.filePath, d.line, d.code, d.message]),
        [[ARTIFACT, 4, "SyntaxError", "invalid syntax"]]
      );
    });

    it("si el revisor no contesta, manda pytest", async () => {
      const { adapter } = adapterWith((step) =>
        step === "review" ? { exitCode: 1, output: "Traceback (most recent call last):\nSyntaxError" } : undefined
      );

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.equal(result.status, "passed");
    });

    it("un error en el código del proyecto lleva su archivo, y el núcleo no llama al corrector", async () => {
      const { adapter } = adapterWith((step) =>
        step === "review"
          ? {
              stdout: reviewAnswer([
                { file: "tienda\\roto.py", line: 1, code: "ModuleNotFoundError", message: "No module named 'requests_que_no_existe'" },
              ]),
            }
          : step === "collect"
            ? { exitCode: 2, output: collectProjectError(fixture.projectRoot, `${SPEC.fileName}.py`) }
            : undefined
      );
      let fixerCalls = 0;

      const repair = await verifyAndRepair({
        adapter,
        project,
        spec: SPEC,
        fix: async () => {
          fixerCalls++;
          return { status: "notFixed", reason: "no debería llamarse" };
        },
      });

      assert.equal(repair.stop, "outsideArtifact");
      assert.equal(fixerCalls, 0);
      assert.ok(repair.outcome.status === "failed");
      assert.deepEqual(
        repair.outcome.diagnostics.map((d) => `${d.filePath}:${d.line}`),
        ["tienda/roto.py:1"]
      );
    });

    it("cero pruebas en el archivo es un aviso, no un éxito", async () => {
      const { adapter } = adapterWith((step) => (step === "collect" ? { exitCode: 5, output: COLLECT_NOTHING } : undefined));

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "python.no-tests-found");
      assert.match(result.blocker.remediation, /test_/);
    });

    it("un fallo que no dice dónde está el error queda como aviso, con la salida guardada", async () => {
      const { adapter } = adapterWith((step) =>
        step === "collect" ? { exitCode: 4, output: "ImportError while loading conftest 'tests/conftest.py'." } : undefined
      );

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "python.collection-failed");
      assert.match(result.blocker.remediation, /AgentOutputs\/verification/);
      assert.match(result.rawOutput ?? "", /conftest/);
    });

    it("si se agota el tiempo, lo dice y no lee nada", async () => {
      const { adapter } = adapterWith((step) => (step === "review" ? { exitCode: null, timedOut: true } : undefined));

      const result = await adapter.verifyArtifact(project, SPEC);

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "python.timeout");
    });
  });

  describe("los errores de pytest --collect-only", () => {
    it("de una traza vale el último renglón del proyecto, no el de pytest ni el de Python", () => {
      const [entrada] = parseCollectionErrors(collectInputError("UTIA_x_test.py"), fixture.projectRoot);
      const [proyecto] = parseCollectionErrors(collectProjectError(fixture.projectRoot, "UTIA_x_test.py"), fixture.projectRoot);
      const [nombre] = parseCollectionErrors(collectImportError(fixture.projectRoot, "UTIA_x_test.py"), fixture.projectRoot);

      assert.deepEqual([entrada.filePath, entrada.line, entrada.code], ["tienda/pide.py", 1, "OSError"]);
      assert.deepEqual([proyecto.filePath, proyecto.line, proyecto.code], ["tienda/roto.py", 1, "ModuleNotFoundError"]);
      assert.deepEqual([nombre.filePath, nombre.line, nombre.code], ["tests/UTIA_x_test.py", 1, "ImportError"]);
      assert.match(nombre.message, /^cannot import name 'Gato' from 'tienda\.carrito'/);
    });

    it("los renglones de Python mismo, escritos subiendo con «..», no son del proyecto", () => {
      const [error] = parseCollectionErrors(collectStandardLibraryError("UTIA_x_test.py"), fixture.projectRoot);

      assert.deepEqual([error.filePath, error.line, error.code], ["tests/UTIA_x_test.py", 3, "json.decoder.JSONDecodeError"]);
    });

    it("un error de sintaxis toma la ruta absoluta de su línea, relativa a la raíz", () => {
      const [error] = parseCollectionErrors(collectSyntaxError(fixture.projectRoot, "UTIA_x_test.py"), fixture.projectRoot);

      assert.deepEqual([error.filePath, error.line, error.code, error.severity], ["tests/UTIA_x_test.py", 4, "SyntaxError", "error"]);
    });
  });

  describe("OP-14 · ejecución", () => {
    it("mide en la misma corrida: pytest dentro de coverage, con su configuración y solo el archivo de la unidad", async () => {
      let config = "";
      const { adapter, runtime } = adapterWith((step, args) => {
        if (step === "coverageRun") {
          const rcfile = args.find((arg) => arg.startsWith("--rcfile="))?.slice("--rcfile=".length) ?? "";
          config = fs.readFileSync(rcfile, "utf8");
        }
        return undefined;
      });

      const result = await adapter.runTests(project, SPEC, TARGET);

      assert.equal(result.status, "passed");
      assert.deepEqual(runtime.steps(), ["coverageRun", "coverageJson"]);
      const [coverageRun] = runtime.runs.filter((run) => run.step === "coverageRun");
      assert.deepEqual(coverageRun.args.slice(0, 3), ["-m", "coverage", "run"]);
      assert.ok(coverageRun.args.includes(`--include=${path.join("tienda", "carrito.py")}`));
      const pytestAt = coverageRun.args.indexOf("pytest");
      assert.deepEqual(coverageRun.args.slice(pytestAt - 1, pytestAt + 8), ["-m", "pytest", "-q", "-o", "addopts=", "-p", "no:cacheprovider", TEST_FILE, coverageRun.args[pytestAt + 7]]);
      assert.match(coverageRun.args[pytestAt + 7], /^--junitxml=/);
      assert.match(config, /branch = True/);
      assert.match(config, /data_file = /);
      assert.match(config, /exclude_also =\n {4}if __name__ == \.__main__\.:/);
      assert.ok(result.status === "passed" && result.rawCoverage && JSON.parse(result.rawCoverage).json);
    });

    it("lee cada prueba del informe JUnit: las excepciones y las fixtures rotas fallan, skip y xfail se omiten", () => {
      const parsed = parseJUnitReport(MIXED_JUNIT);

      assert.ok(parsed);
      assert.deepEqual([parsed.total, parsed.passed, parsed.failed, parsed.skipped], [8, 2, 4, 2]);
      const byName = new Map(parsed.cases.map((c) => [c.testName.replace("tests.UTIA_mezcla_test.", ""), c]));
      assert.equal(byName.get("test_falla_assert")?.message, "AssertionError: assert 'Rex' == 'Firulais'\n  \n  - Firulais\n  + Rex");
      assert.match(byName.get("test_falla_assert")?.stackTrace ?? "", /tests\\UTIA_mezcla_test\.py:20: AssertionError/);
      assert.equal(byName.get("test_error_en_fixture")?.outcome, "failed");
      assert.equal(byName.get("test_error_en_fixture")?.message, 'failed on setup with "RuntimeError: la fixture explota"');
      assert.equal(byName.get("test_omitida")?.message, "no aplica aquí");
      assert.equal(byName.get("test_xfail")?.message, "Se esperaba que fallara: se espera que falle");
      assert.equal(byName.get("test_imprime_é")?.outcome, "passed");
      assert.equal(byName.get("test_pasa")?.durationMs, 1);
    });

    it("con pruebas que fallan es una corrida completa, que también se mide", async () => {
      const { adapter } = adapterWith((step) => (step === "coverageRun" ? { exitCode: 1, junit: MIXED_JUNIT } : undefined));

      const result = await adapter.runTests(project, SPEC, TARGET);

      assert.ok(result.status === "failed");
      assert.equal(result.failed, 4);
      assert.equal(result.exitCode, 1);
      assert.ok(result.rawCoverage);
    });

    it("sin coverage, ejecuta igual con pytest solo, y la cobertura dice qué instalar", async () => {
      const { adapter, runtime } = adapterWith(undefined, { python: { coverage: false } });

      const result = await adapter.runTests(project, SPEC, TARGET);
      assert.ok(result.status === "passed");
      const coverage = await adapter.collectCoverage(project, result, TARGET);

      assert.deepEqual(runtime.steps(), ["run"]);
      assert.deepEqual(runtime.runs.find((run) => run.step === "run")?.args.slice(0, 2), ["-m", "pytest"]);
      assert.ok(coverage.status === "notRun");
      assert.equal(coverage.blocker.code, "python.coverage-missing");
      assert.match(coverage.blocker.remediation, /python -m pip install coverage/);
    });

    it("sin pedir cobertura, no la mide", async () => {
      const { adapter, runtime } = adapterWith();

      const result = await adapter.runTests(project, SPEC);

      assert.deepEqual(runtime.steps(), ["run"]);
      assert.ok(result.status === "passed" && result.rawCoverage === undefined);
    });

    it("una prueba que no se puede importar no es una corrida con una falla", async () => {
      const { adapter } = adapterWith((step) =>
        step === "coverageRun" ? { exitCode: 2, junit: COLLECTION_FAILURE_JUNIT } : undefined
      );

      const result = await adapter.runTests(project, SPEC, TARGET);

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "python.tests-not-importable");
    });

    it("cero pruebas, o ningún informe, son avisos", async () => {
      const none = adapterWith((step) => (step === "coverageRun" ? { exitCode: 5, output: COLLECT_NOTHING } : undefined));
      const missing = adapterWith((step) => (step === "coverageRun" ? { exitCode: 3, output: "INTERNALERROR>" } : undefined));

      const noTests = await none.adapter.runTests(project, SPEC, TARGET);
      const noReport = await missing.adapter.runTests(project, SPEC, TARGET);

      assert.ok(noTests.status === "notRun" && noReport.status === "notRun");
      assert.equal(noTests.blocker.code, "python.no-tests-found");
      assert.equal(noReport.blocker.code, "python.test-report-missing");
      assert.match(noReport.blocker.remediation, /AgentOutputs\/test-run/);
    });

    it("no deja nada en el proyecto ni en la carpeta temporal", async () => {
      const before = await listTree(fixture.projectRoot);
      const temporary = await fsp.readdir(os.tmpdir());
      const { adapter } = adapterWith();

      await adapter.runTests(project, SPEC, TARGET);

      assert.deepEqual(await listTree(fixture.projectRoot), before);
      const left = (await fsp.readdir(os.tmpdir())).filter(
        (name) => name.startsWith("unitytestia-pytest-") && !temporary.includes(name)
      );
      assert.deepEqual(left, []);
    });
  });

  describe("OP-15 · cobertura", () => {
    const measure = async () => {
      const { adapter } = adapterWith();
      const run = await adapter.runTests(project, SPEC, TARGET);
      assert.ok(run.status === "passed");
      return adapter.collectCoverage(project, run as CompletedTestRun, TARGET);
    };

    it("el método junta su cuerpo y la función anidada, sin el encabezado, y marca las líneas con una rama sin recorrer", async () => {
      const coverage = await measure();

      assert.ok(coverage.status === "measured");
      assert.ok(coverage.target);
      assert.equal(coverage.target.name, "Carrito.agregar");
      assert.equal(coverage.target.firstLine, 23);
      assert.deepEqual(coverage.target.line, { covered: 9, total: 10, percentage: 90 });
      assert.deepEqual(coverage.target.decision, { covered: 4, total: 6, percentage: 66.7 });
      assert.equal(coverage.target.instruction, undefined);

      const status = new Map(coverage.byFile[0].lines.map((line) => [line.line, line.status]));
      assert.equal(status.get(24), "partial");
      assert.equal(status.get(25), "missed");
      assert.equal(status.get(28), "covered");
      assert.equal(status.get(31), "partial");
      assert.equal(status.get(22), "covered", "el def es código del módulo, que corre al importarlo");
    });

    it("el archivo cuenta todas sus instrucciones y ramas; cada método por separado, en orden", async () => {
      const coverage = await measure();

      assert.ok(coverage.status === "measured");
      assert.deepEqual(coverage.line, { covered: 33, total: 42, percentage: 78.6 });
      assert.deepEqual(coverage.decision, { covered: 4, total: 8, percentage: 50 });
      assert.equal(coverage.instruction, undefined);
      assert.deepEqual(
        coverage.byFile[0].units.map((unit) => `${unit.name}@${unit.firstLine} ${unit.line.covered}/${unit.line.total}`),
        [
          "Carrito.__init__@18 3/3",
          "Carrito.agregar@23 9/10",
          "Carrito.total@38 1/1",
          "Carrito._recalcular@41 2/2",
          "Carrito.__privado@45 0/1",
          "Carrito.con_cupon@48 0/1",
          "Carrito.redondear@52 0/1",
          "Carrito.sincronizar@55 0/1",
          "Carrito.vaciar@60 0/2",
          "Carrito.Linea.agregar@65 0/1",
          "agregar@70 0/1",
        ]
      );
      assert.ok(coverage.notes?.some((note) => /coverage\.py/.test(note)));
    });

    it("el encabezado en varias líneas tampoco es del método, y la salida de la función es una rama", () => {
      const reading = readCoverageJson(CARRITO_COVERAGE_JSON, { ...TARGET, unit: { className: "Carrito", methodName: "vaciar" } }, CARRITO);

      assert.ok(reading.kind === "measured" && reading.report.target);
      assert.equal(reading.report.target.firstLine, 60);
      assert.deepEqual(reading.report.target.decision, { covered: 0, total: 2, percentage: 0 });
    });

    it("una función de módulo con el mismo nombre que el método es otra unidad", () => {
      const reading = readCoverageJson(CARRITO_COVERAGE_JSON, { ...TARGET, unit: { className: null, methodName: "agregar" } }, CARRITO);

      assert.ok(reading.kind === "measured");
      assert.equal(reading.report.target?.name, "agregar");
      assert.equal(reading.report.target?.firstLine, 70);
    });

    it("si coverage no midió el archivo, o el informe no se lee, lo dice", async () => {
      const otherFile = readCoverageJson(CARRITO_COVERAGE_JSON, { ...TARGET, filePath: "tienda/modelo.py" }, CARRITO);
      const broken = readCoverageJson("{", TARGET, CARRITO);
      const { adapter } = adapterWith((step) =>
        step === "coverageJson" ? { exitCode: 1, output: "No data to report." } : undefined
      );
      const run = await adapter.runTests(project, SPEC, TARGET);
      assert.ok(run.status === "passed");
      const noReport = await adapter.collectCoverage(project, run, TARGET);

      assert.equal(otherFile.kind, "fileMissing");
      assert.equal(broken.kind, "unreadable");
      assert.ok(noReport.status === "notRun");
      assert.equal(noReport.blocker.code, "python.coverage-report-missing");
    });
  });
});

async function listTree(root: string): Promise<string[]> {
  const entries = await fsp.readdir(root, { recursive: true });
  return entries.map((entry) => entry.toString()).sort();
}
