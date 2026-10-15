import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as path from "path";
import { JavaAdapter } from "../adapters/java/javaAdapter";
import type { ArtifactSpec, CompletedTestRun, CoverageTarget, ProjectModel } from "../core/contracts";
import {
  GRADLE_NO_TESTS,
  JACOCO_REPORT,
  MAVEN_JACOCO_SKIPPED,
  MAVEN_NO_JAVA,
  MAVEN_NO_TESTS,
  MAVEN_OFFLINE,
  MAVEN_SUCCESS,
  MAVEN_TESTS_RAN,
  fakeBuildToolchain,
  gradleCompileErrors,
  gradleReport,
  mavenCompileErrors,
  mavenMainError,
  mavenWarnings,
  mavenWithoutJUnit,
  passingReport,
  surefireReport,
  type FakeBuildResponse,
} from "./support/javaBuildOutputs";
import { createJavaFixture, type JavaFixture, type JavaFixtureOptions } from "./support/javaFixture";

/**
 * Compilación, ejecución y cobertura del adaptador de Java (OP-13 a OP-15),
 * con un Maven o un Gradle de mentira que contesta con salidas reales y deja
 * los informes donde los dejaría el de verdad.
 */

const SPEC: ArtifactSpec = {
  directory: "src/test/java/com/tienda",
  fileName: "UTIA_prueba_Carrito_agregar_Test",
  extension: ".java",
  unitName: "UTIA_prueba_Carrito_agregar_Test",
};
const ARTIFACT = `${SPEC.directory}/${SPEC.fileName}${SPEC.extension}`;
const TEST_CLASS = "com.tienda.UTIA_prueba_Carrito_agregar_Test";
const MAVEN_REPORT = `target/surefire-reports/TEST-${TEST_CLASS}.xml`;
const GRADLE_TEST_REPORT = `build/utia-run/test-results/TEST-${TEST_CLASS}.xml`;

/** El informe de JaCoCo es de `Clasificador`: se mide esa clase. */
const COVERAGE_TARGET: CoverageTarget = {
  filePath: "src/main/java/com/example/project/Clasificador.java",
  unit: { className: "Clasificador", methodName: "clasificar" },
};

describe("compilación, ejecución y cobertura de Java (OP-13 a OP-15)", () => {
  let fixture: JavaFixture;
  let project: ProjectModel;

  const open = async (options: JavaFixtureOptions = {}) => {
    fixture = await createJavaFixture(options);
    project = await new JavaAdapter().buildProjectModel(fixture.projectRoot);
  };
  const adapterWith = (respond?: (args: readonly string[]) => FakeBuildResponse, launcherMissing = false) => {
    const toolchain = fakeBuildToolchain({ ...(launcherMissing ? { launcher: null } : {}), respond });
    return { adapter: new JavaAdapter({ toolchain }), toolchain };
  };
  const root = () => fixture.projectRoot;

  beforeEach(async () => open());
  afterEach(async () => fixture.dispose());

  describe("proyectos que no usan Maven ni Gradle", () => {
    it("con Ant, las tres etapas dicen que solo saben Maven o Gradle, sin lanzar nada", async () => {
      await fixture.dispose();
      await open({ descriptor: null });
      await fsp.writeFile(path.join(root(), "build.xml"), "<project/>", "utf8");
      project = await new JavaAdapter().buildProjectModel(root());
      const { adapter, toolchain } = adapterWith();

      const verification = await adapter.verifyArtifact(project, SPEC);
      const run = await adapter.runTests(project, SPEC, COVERAGE_TARGET);

      assert.ok(verification.status === "notRun" && run.status === "notRun");
      assert.equal(verification.blocker.code, "java.build-tool-unsupported");
      assert.equal(
        verification.blocker.message,
        "La extensión solo puede compilar, ejecutar y medir proyectos que usan Maven o Gradle, y este usa Ant (build.xml)."
      );
      assert.match(verification.blocker.remediation, new RegExp(`quedó escrita en ${ARTIFACT}`));
      assert.equal(run.blocker.code, "java.build-tool-unsupported");
      assert.equal(toolchain.runs.length, 0);
    });

    it("sin ninguna herramienta, lo dice", async () => {
      await fixture.dispose();
      await open({ descriptor: null });
      const verification = await adapterWith().adapter.verifyArtifact(project, SPEC);

      assert.ok(verification.status === "notRun");
      assert.match(verification.blocker.message, /este no usa ninguno: no tiene pom\.xml, build\.gradle ni build\.gradle\.kts/);
    });
  });

  describe("OP-13 · compilación", () => {
    it("sin wrapper ni Maven en el PATH, dice qué instalar y que hay que reiniciar VS Code", async () => {
      const verification = await adapterWith(undefined, true).adapter.verifyArtifact(project, SPEC);

      assert.ok(verification.status === "notRun");
      assert.equal(verification.blocker.code, "java.maven-missing");
      assert.match(verification.blocker.message, /no trae mvnw y mvn no está en el PATH/);
      assert.match(verification.blocker.remediation, /cerrá VS Code entero/);
    });

    it("lanza test-compile en la raíz del proyecto y, si compila, conserva solo los avisos de la prueba", async () => {
      const { adapter, toolchain } = adapterWith(() => ({ output: mavenWarnings(root(), ARTIFACT) }));
      const verification = await adapter.verifyArtifact(project, SPEC);

      assert.deepEqual(toolchain.runs[0].args, ["-B", "-ntp", "test-compile"]);
      assert.equal(toolchain.runs[0].cwd, root());
      assert.ok(verification.status === "passed");
      assert.deepEqual(
        verification.diagnostics.map((diagnostic) => [diagnostic.filePath, diagnostic.severity]),
        [[ARTIFACT, "warning"]]
      );
    });

    it("con errores en la prueba, falla con todos ellos", async () => {
      const verification = await adapterWith(() => ({
        exitCode: 1,
        output: mavenCompileErrors(root(), ARTIFACT),
      })).adapter.verifyArtifact(project, SPEC);

      assert.ok(verification.status === "failed");
      assert.equal(verification.diagnostics.length, 3);
      assert.equal(verification.exitCode, 1);
    });

    it("un error en el código del proyecto también la hace fallar, con su archivo", async () => {
      const verification = await adapterWith(() => ({
        exitCode: 1,
        output: mavenMainError(root()),
      })).adapter.verifyArtifact(project, SPEC);

      assert.ok(verification.status === "failed");
      assert.equal(verification.diagnostics[0].filePath, "src/main/java/com/tienda/Carrito.java");
    });

    it("sin JUnit 5 en el proyecto no culpa a la prueba: dice qué dependencia agregar", async () => {
      const verification = await adapterWith(() => ({
        exitCode: 1,
        output: mavenWithoutJUnit(root(), ARTIFACT),
      })).adapter.verifyArtifact(project, SPEC);

      assert.ok(verification.status === "notRun");
      assert.equal(verification.blocker.code, "java.junit-missing");
      assert.match(verification.blocker.remediation, /org\.junit\.jupiter:junit-jupiter con scope test al pom\.xml/);
    });

    it("lo que falta en la máquina se informa como «no se pudo», con la salida guardada", async () => {
      for (const [output, code] of [
        [MAVEN_NO_JAVA, "java.jdk-missing"],
        [MAVEN_OFFLINE, "java.dependencies-unavailable"],
      ]) {
        const verification = await adapterWith(() => ({ exitCode: 1, output })).adapter.verifyArtifact(project, SPEC);
        assert.ok(verification.status === "notRun");
        assert.equal(verification.blocker.code, code);
        assert.equal(verification.rawOutput, output);
      }
    });

    it("un código distinto de cero sin errores no se informa como prueba rota", async () => {
      const verification = await adapterWith(() => ({ exitCode: 1, output: "[ERROR] algo raro" })).adapter.verifyArtifact(
        project,
        SPEC
      );

      assert.ok(verification.status === "notRun");
      assert.equal(verification.blocker.code, "java.build-failed");
      assert.match(verification.blocker.remediation, /AgentOutputs\/verification/);
    });

    it("con Gradle lanza testClasses y lee el formato de javac", async () => {
      await fixture.dispose();
      await open({ descriptor: "build.gradle" });
      const { adapter, toolchain } = adapterWith(() => ({ exitCode: 1, output: gradleCompileErrors(root(), ARTIFACT) }));
      const verification = await adapter.verifyArtifact(project, SPEC);

      assert.deepEqual(toolchain.runs[0].args, ["--console=plain", "--no-daemon", "testClasses"]);
      assert.equal(toolchain.runs[0].launcher.command, "./gradlew");
      assert.ok(verification.status === "failed");
      assert.deepEqual(
        verification.diagnostics.map((diagnostic) => [diagnostic.line, diagnostic.column]),
        [
          [11, 31],
          [12, 28],
        ]
      );
    });
  });

  describe("OP-14 · ejecución", () => {
    it("ejecuta solo la clase de la prueba, con su paquete, y lee el informe de Surefire", async () => {
      const { adapter, toolchain } = adapterWith(() => ({
        output: MAVEN_TESTS_RAN,
        files: { [MAVEN_REPORT]: surefireReport(TEST_CLASS) },
      }));
      const run = await adapter.runTests(project, SPEC);

      assert.ok(toolchain.runs[0].args.includes(`-Dtest=${TEST_CLASS}`));
      assert.ok(!toolchain.runs[0].args.some((arg) => arg.includes("jacoco")));
      assert.ok(run.status === "failed");
      assert.deepEqual([run.total, run.passed, run.failed, run.skipped], [5, 1, 2, 2]);
      assert.equal(run.rawCoverage, undefined);
    });

    it("un informe que solo tiene pruebas que pasan da «pasó»", async () => {
      const run = await adapterWith(() => ({
        files: { [MAVEN_REPORT]: passingReport(TEST_CLASS) },
      })).adapter.runTests(project, SPEC);

      assert.ok(run.status === "passed");
      assert.equal(run.total, 2);
    });

    it("nunca lee el informe de una corrida anterior", async () => {
      const stale = path.join(root(), ...MAVEN_REPORT.split("/"));
      await fsp.mkdir(path.dirname(stale), { recursive: true });
      await fsp.writeFile(stale, passingReport(TEST_CLASS), "utf8");

      const run = await adapterWith(() => ({ exitCode: 1, output: MAVEN_NO_TESTS })).adapter.runTests(project, SPEC);

      assert.ok(run.status === "notRun");
      assert.equal(run.blocker.code, "java.no-tests-found");
      await assert.rejects(fsp.access(stale));
    });

    it("si el proyecto no compila, lo dice y manda a la compilación", async () => {
      const run = await adapterWith(() => ({
        exitCode: 1,
        output: mavenCompileErrors(root(), ARTIFACT),
      })).adapter.runTests(project, SPEC);

      assert.ok(run.status === "notRun");
      assert.equal(run.blocker.code, "java.tests-not-compiled");
    });

    it("lo que falta en la máquina se reconoce también al ejecutar", async () => {
      const run = await adapterWith(() => ({ exitCode: 1, output: MAVEN_OFFLINE })).adapter.runTests(project, SPEC);

      assert.ok(run.status === "notRun");
      assert.equal(run.blocker.code, "java.dependencies-unavailable");
    });

    it("con Gradle escribe su configuración aparte y lee el informe de la carpeta de la extensión", async () => {
      await fixture.dispose();
      await open({ descriptor: "build.gradle" });
      const { adapter, toolchain } = adapterWith(() => ({
        exitCode: 1,
        files: { [GRADLE_TEST_REPORT]: gradleReport(TEST_CLASS) },
      }));
      const run = await adapter.runTests(project, SPEC);

      const initScript = await fsp.readFile(path.join(root(), "build", "utia-run", "utia.gradle"), "utf8");
      assert.match(initScript, /reports\.junitXml\.outputLocation/);
      assert.deepEqual(toolchain.runs[0].args.slice(4, 7), ["test", "--tests", TEST_CLASS]);
      assert.ok(run.status === "failed");
      assert.deepEqual([run.total, run.failed, run.skipped], [4, 2, 1]);
    });

    it("con Gradle, sin pruebas, sugiere activar JUnit 5 en el build.gradle", async () => {
      await fixture.dispose();
      await open({ descriptor: "build.gradle" });
      const run = await adapterWith(() => ({ exitCode: 1, output: GRADLE_NO_TESTS })).adapter.runTests(project, SPEC);

      assert.ok(run.status === "notRun");
      assert.equal(run.blocker.code, "java.no-tests-found");
      assert.match(run.blocker.remediation, /useJUnitPlatform\(\)/);
    });

    it("si se agota el tiempo, no usa un informe a medias", async () => {
      const run = await adapterWith(() => ({
        exitCode: null,
        timedOut: true,
        files: { [MAVEN_REPORT]: passingReport(TEST_CLASS) },
      })).adapter.runTests(project, SPEC);

      assert.ok(run.status === "notRun");
      assert.equal(run.blocker.code, "java.build-timeout");
    });
  });

  describe("OP-15 · cobertura", () => {
    const measureWith = async (response: FakeBuildResponse) => {
      const { adapter, toolchain } = adapterWith(() => response);
      const run = await adapter.runTests(project, SPEC, COVERAGE_TARGET);
      assert.ok(run.status === "passed" || run.status === "failed", `la ejecución quedó en ${run.status}`);
      return { adapter, toolchain, run: run as CompletedTestRun };
    };

    it("la misma corrida pide JaCoCo y la cobertura sale de su informe, con decisión e instrucción", async () => {
      const { adapter, toolchain, run } = await measureWith({
        output: MAVEN_TESTS_RAN,
        files: {
          [MAVEN_REPORT]: surefireReport(TEST_CLASS),
          "target/site/jacoco/jacoco.xml": JACOCO_REPORT,
          "target/utia-run/jacoco.exec": "datos",
        },
      });

      assert.ok(toolchain.runs[0].args.includes("org.jacoco:jacoco-maven-plugin:prepare-agent"));
      const coverage = await adapter.collectCoverage(project, run, COVERAGE_TARGET);
      assert.ok(coverage.status === "measured");
      assert.deepEqual(coverage.target?.line, { covered: 4, total: 6, percentage: 66.7 });
      assert.deepEqual(coverage.decision, { covered: 11, total: 19, percentage: 57.9 });
      assert.deepEqual(coverage.instruction, { covered: 48, total: 82, percentage: 58.5 });
      assert.equal(toolchain.runs.length, 1, "medir no vuelve a ejecutar");
    });

    it("si el pom.xml no deja entrar a JaCoCo, dice cómo arreglar el argLine", async () => {
      const { adapter, run } = await measureWith({
        output: MAVEN_JACOCO_SKIPPED,
        files: { [MAVEN_REPORT]: surefireReport(TEST_CLASS) },
      });

      const coverage = await adapter.collectCoverage(project, run, COVERAGE_TARGET);
      assert.ok(coverage.status === "notRun");
      assert.equal(coverage.blocker.code, "java.coverage-agent-missing");
      assert.match(coverage.blocker.remediation, /@\{argLine\}/);
    });

    it("un informe de JaCoCo de antes de la corrida no cuenta", async () => {
      const old = path.join(root(), "target", "site", "jacoco", "jacoco.xml");
      await fsp.mkdir(path.dirname(old), { recursive: true });
      await fsp.writeFile(old, JACOCO_REPORT, "utf8");
      const lastWeek = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      await fsp.utimes(old, lastWeek, lastWeek);

      const { adapter, run } = await measureWith({ files: { [MAVEN_REPORT]: surefireReport(TEST_CLASS) } });
      const coverage = await adapter.collectCoverage(project, run, COVERAGE_TARGET);

      assert.ok(coverage.status === "notRun");
      assert.equal(coverage.blocker.code, "java.coverage-agent-missing");
    });

    it("si JaCoCo no midió el archivo, lo dice en lugar de dar 0 %", async () => {
      const { adapter, run } = await measureWith({
        files: {
          [MAVEN_REPORT]: surefireReport(TEST_CLASS),
          "target/site/jacoco/jacoco.xml": JACOCO_REPORT,
        },
      });

      const coverage = await adapter.collectCoverage(project, run, {
        filePath: "src/main/java/com/tienda/Carrito.java",
        unit: { className: "Carrito", methodName: "agregar" },
      });
      assert.ok(coverage.status === "notRun");
      assert.equal(coverage.blocker.code, "java.coverage-file-missing");
    });
  });
});
