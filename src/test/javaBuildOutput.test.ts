import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { buildBlocker } from "../adapters/java/build/blockers";
import { GRADLE, MAVEN } from "../adapters/java/build/commands";
import { parseCompilerOutput, toProjectRelative } from "../adapters/java/build/diagnostics";
import { readJacocoReport } from "../adapters/java/build/jacocoReport";
import { parseJUnitReport } from "../adapters/java/build/junitReport";
import { buildEnvironment, findOnPath, quoteForCmd, type BuildRunResult } from "../adapters/java/build/toolchain";
import type { CoverageTarget } from "../core/contracts";
import {
  GRADLE_JRE,
  GRADLE_NO_JAVA,
  GRADLE_OFFLINE,
  GRADLE_WRAPPER_OFFLINE,
  JACOCO_REPORT,
  MAVEN_JRE,
  MAVEN_NO_JAVA,
  MAVEN_OFFLINE,
  MAVEN_RELEASE_UNSUPPORTED,
  MAVEN_WRAPPER_OFFLINE,
  gradleCompileErrors,
  gradleReport,
  mavenCompileErrors,
  mavenMainError,
  surefireReport,
} from "./support/javaBuildOutputs";

/**
 * Lectura de lo que dejan Maven, Gradle, JUnit y JaCoCo, con extractos de
 * corridas reales (ver `support/javaBuildOutputs.ts`).
 */

const ROOT = path.join(os.tmpdir(), "Proyectos Java", "tienda con tildé");
const ARTIFACT = "src/test/java/com/tienda/UTIA_prueba_Carrito_agregar_Test.java";
const TEST_CLASS = "com.tienda.UTIA_prueba_Carrito_agregar_Test";

describe("errores del compilador de Java", () => {
  it("Maven: ruta relativa, línea, columna y el detalle en el mismo mensaje, sin repetidos", () => {
    const diagnostics = parseCompilerOutput(mavenCompileErrors(ROOT, ARTIFACT), ROOT, "maven");

    assert.deepEqual(diagnostics, [
      {
        filePath: ARTIFACT,
        line: 11,
        column: 31,
        severity: "error",
        message: "incompatible types: int cannot be converted to java.lang.String",
      },
      {
        filePath: ARTIFACT,
        line: 12,
        column: 28,
        severity: "error",
        message:
          "cannot find symbol; symbol: method sumar(int,int); location: variable sut of type com.tienda.Carrito",
      },
      {
        filePath: ARTIFACT,
        line: 13,
        column: 9,
        severity: "error",
        message:
          "cannot find symbol; symbol: class Desconocida; location: class com.tienda.UTIA_prueba_Carrito_agregar_Test",
      },
    ]);
  });

  it("Maven: un error en el código del proyecto queda con su archivo", () => {
    const [diagnostic, ...rest] = parseCompilerOutput(mavenMainError(ROOT), ROOT, "maven");

    assert.deepEqual(rest, []);
    assert.equal(diagnostic.filePath, "src/main/java/com/tienda/Carrito.java");
    assert.equal(diagnostic.message, "cannot find symbol; symbol: variable c; location: class com.tienda.Carrito");
  });

  it("Gradle: la columna sale del «^», también en el resumen con más sangría", () => {
    const diagnostics = parseCompilerOutput(gradleCompileErrors(ROOT, ARTIFACT), ROOT, "gradle");

    assert.deepEqual(
      diagnostics.map((diagnostic) => [diagnostic.line, diagnostic.column, diagnostic.severity]),
      [
        [11, 31, "error"],
        [12, 28, "error"],
        [13, 25, "warning"],
      ]
    );
    assert.ok(diagnostics.every((diagnostic) => diagnostic.filePath === ARTIFACT));
    assert.equal(
      diagnostics[1].message,
      "cannot find symbol; symbol: method sumar(int,int); location: variable sut of type Carrito"
    );
  });

  it("las rutas de Maven y de Gradle quedan relativas a la raíz, sin importar la mayúscula de la unidad", () => {
    assert.equal(toProjectRelative("/D:/Proyecto/src/A.java", "d:\\Proyecto"), "src/A.java");
    assert.equal(toProjectRelative("D:\\Proyecto\\src\\A.java", "D:\\Proyecto\\"), "src/A.java");
    assert.equal(toProjectRelative("/home/ana/p/src/A.java", "/home/ana/p"), "src/A.java");
    assert.equal(toProjectRelative("/otro/lado/A.java", "/home/ana/p"), "/otro/lado/A.java");
  });
});

describe("informe JUnit de Surefire y de Gradle", () => {
  it("Surefire: los cuatro contadores, cada prueba con su motivo y la traza de las fallidas", () => {
    const report = parseJUnitReport(surefireReport(TEST_CLASS));

    assert.ok(report);
    assert.deepEqual([report.total, report.passed, report.failed, report.skipped], [5, 1, 2, 2]);
    assert.deepEqual(
      report.cases.map((testCase) => [testCase.testName, testCase.outcome, testCase.message]),
      [
        [`${TEST_CLASS}.supuesto`, "skipped", "Assumption failed: rama que no se puede probar"],
        [`${TEST_CLASS}.deshabilitada`, "skipped", "no aplica"],
        [`${TEST_CLASS}.pasa`, "passed", undefined],
        [`${TEST_CLASS}.falla`, "failed", "1 + 2 debería dar 4 ==> expected: <4> but was: <3>"],
        [`${TEST_CLASS}.lanza`, "failed", "explotó"],
      ]
    );
    assert.match(report.cases[3].stackTrace ?? "", /at com\.tienda\.UTIA_prueba_Carrito_agregar_Test\.falla/);
    assert.equal(report.cases[2].stackTrace, undefined);
    assert.equal(report.cases[2].durationMs, 11);
  });

  it("Gradle: sin «()», sin la clase de la excepción delante y con la excepción como fallida", () => {
    const report = parseJUnitReport(gradleReport(TEST_CLASS));

    assert.ok(report);
    assert.deepEqual([report.total, report.passed, report.failed, report.skipped], [4, 1, 2, 1]);
    assert.deepEqual(
      report.cases.map((testCase) => [testCase.testName.slice(TEST_CLASS.length + 1), testCase.message]),
      [
        ["supuesto", "Assumption failed: rama que no se puede probar"],
        ["falla", "7 no es cero ==> expected: <cero> but was: <positivo>"],
        ["lanza", "explotó"],
        ["1 + 1 = 2", undefined],
      ]
    );
  });

  it("lo que no es un informe JUnit no se lee como uno vacío", () => {
    assert.equal(parseJUnitReport("<html></html>"), undefined);
  });
});

describe("informe de JaCoCo", () => {
  const target: CoverageTarget = {
    filePath: "src/main/java/com/example/project/Clasificador.java",
    unit: { className: "Clasificador", methodName: "clasificar" },
  };
  const read = (unit = target.unit) =>
    readJacocoReport(JACOCO_REPORT, { ...target, unit }, "com/example/project/Clasificador.java");

  it("línea, decisión e instrucción del archivo, con los totales de JaCoCo", () => {
    const reading = read();

    assert.equal(reading.kind, "measured");
    assert.ok(reading.kind === "measured");
    const { report } = reading;
    assert.deepEqual(report.line, { covered: 12, total: 20, percentage: 60 });
    assert.deepEqual(report.decision, { covered: 11, total: 19, percentage: 57.9 });
    assert.deepEqual(report.instruction, { covered: 48, total: 82, percentage: 58.5 });
  });

  it("junta las sobrecargas en la unidad bajo prueba y le atribuye la lambda a su método", () => {
    const reading = read();
    assert.ok(reading.kind === "measured");
    const { report } = reading;

    assert.deepEqual(report.target, {
      name: "Clasificador.clasificar",
      firstLine: 9,
      line: { covered: 4, total: 6, percentage: 66.7 },
      decision: { covered: 5, total: 10, percentage: 50 },
      instruction: { covered: 14, total: 27, percentage: 51.9 },
    });

    const units = report.byFile[0].units;
    assert.deepEqual(
      units.map((unit) => [unit.name, unit.firstLine, unit.line.covered, unit.line.total]),
      [
        ["Clasificador (constructor)", 6, 1, 1],
        ["Clasificador.clasificar", 9, 4, 6],
        ["Clasificador.contarPares", 22, 7, 7],
        ["Clasificador.nivel", 33, 0, 4],
        ["Interna (constructor)", 40, 0, 1],
        ["Interna.doble", 42, 0, 1],
      ]
    );
    // La lambda de la línea 22 suma sus dos ramas y sus 8 instrucciones.
    const contarPares = units[2];
    assert.deepEqual(contarPares.decision, { covered: 6, total: 6, percentage: 100 });
    assert.deepEqual(contarPares.instruction, { covered: 31, total: 31, percentage: 100 });
  });

  it("una línea con algo sin ejecutar queda parcial, y una sin nada ejecutado, sin cubrir", () => {
    const reading = read();
    assert.ok(reading.kind === "measured");
    const status = new Map(reading.report.byFile[0].lines.map((line) => [line.line, line.status]));

    assert.equal(status.get(9), "partial"); // una rama sin cubrir
    assert.equal(status.get(14), "partial"); // instrucciones sin ejecutar
    assert.equal(status.get(10), "covered");
    assert.equal(status.get(12), "missed");
    assert.equal(status.get(13), undefined); // sin código
  });

  it("encuentra una unidad de una clase anidada por su propio nombre", () => {
    const reading = read({ className: "Interna", methodName: "doble" });
    assert.ok(reading.kind === "measured");
    assert.equal(reading.report.target?.name, "Interna.doble");
  });

  it("un archivo sin condiciones tiene decisión medida con total cero, no ausente", () => {
    const reading = readJacocoReport(
      JACOCO_REPORT,
      { filePath: "src/main/java/com/example/project/Calculator.java", unit: { className: "Calculator", methodName: "add" } },
      "com/example/project/Calculator.java"
    );
    assert.ok(reading.kind === "measured");
    assert.deepEqual(reading.report.decision, { covered: 0, total: 0, percentage: 0 });
    assert.deepEqual(reading.report.target?.line, { covered: 0, total: 1, percentage: 0 });
  });

  it("distingue un archivo que JaCoCo no midió de un informe que no se puede leer", () => {
    assert.equal(
      readJacocoReport(JACOCO_REPORT, target, "com/example/otro/Clasificador.java").kind,
      "fileMissing"
    );
    assert.equal(readJacocoReport("<html/>", target, "com/example/project/Clasificador.java").kind, "unreadable");
  });
});

describe("avisos a partir de la salida de Maven y de Gradle", () => {
  const COMPILE = { doing: "compilar", retry: "la compilación" };
  const failed = (output: string): BuildRunResult => ({ exitCode: 1, timedOut: false, output });

  const cases: [string, BuildRunResult, typeof MAVEN, string][] = [
    ["Maven sin Java", failed(MAVEN_NO_JAVA), MAVEN, "java.jdk-missing"],
    ["Gradle sin Java", failed(GRADLE_NO_JAVA), GRADLE, "java.jdk-missing"],
    ["Maven con un JRE", failed(MAVEN_JRE), MAVEN, "java.jdk-without-compiler"],
    ["Gradle con un JRE, aunque diga «Could not resolve all dependencies»", failed(GRADLE_JRE), GRADLE, "java.jdk-without-compiler"],
    ["un JDK más viejo que el proyecto", failed(MAVEN_RELEASE_UNSUPPORTED), MAVEN, "java.jdk-too-old"],
    ["Maven sin Internet", failed(MAVEN_OFFLINE), MAVEN, "java.dependencies-unavailable"],
    ["Gradle sin Internet", failed(GRADLE_OFFLINE), GRADLE, "java.dependencies-unavailable"],
    ["el wrapper de Maven sin Internet", failed(MAVEN_WRAPPER_OFFLINE), MAVEN, "java.wrapper-download-failed"],
    ["el wrapper de Gradle sin Internet", failed(GRADLE_WRAPPER_OFFLINE), GRADLE, "java.wrapper-download-failed"],
    ["un proceso que no arrancó", { exitCode: null, timedOut: false, spawnError: "spawn EINVAL", output: "" }, MAVEN, "java.build-failed-to-start"],
    ["el tiempo agotado", { exitCode: null, timedOut: true, output: "" }, GRADLE, "java.build-timeout"],
  ];

  for (const [name, run, commands, code] of cases) {
    it(name, () => {
      assert.equal(buildBlocker(run, commands, COMPILE, 600000)?.code, code);
    });
  }

  it("la versión que pide el proyecto aparece en el aviso", () => {
    const blocker = buildBlocker(failed(MAVEN_RELEASE_UNSUPPORTED), MAVEN, COMPILE, 600000);
    assert.match(blocker?.message ?? "", /pide Java 25/);
    assert.match(blocker?.remediation ?? "", /JDK 25 o más nuevo/);
  });

  it("los errores de compilación de la prueba no son un aviso de la máquina", () => {
    assert.equal(buildBlocker(failed(mavenCompileErrors(ROOT, ARTIFACT)), MAVEN, COMPILE, 600000), undefined);
    assert.equal(buildBlocker(failed(gradleCompileErrors(ROOT, ARTIFACT)), GRADLE, COMPILE, 600000), undefined);
  });
});

describe("lo que se le pide a Maven y a Gradle", () => {
  it("Maven: solo la clase, sin cortar por una prueba que falla, y JaCoCo alrededor si se mide", () => {
    assert.deepEqual(MAVEN.testArgs(TEST_CLASS, false), [
      "-B",
      "-ntp",
      "test",
      `-Dtest=${TEST_CLASS}`,
      "-Dmaven.test.failure.ignore=true",
    ]);

    const measured = MAVEN.testArgs(TEST_CLASS, true);
    const prepare = measured.indexOf("org.jacoco:jacoco-maven-plugin:prepare-agent");
    assert.ok(prepare !== -1 && prepare < measured.indexOf("test"), measured.join(" "));
    assert.equal(measured[measured.length - 1], "org.jacoco:jacoco-maven-plugin:report");
    assert.ok(measured.includes("-Djacoco.destFile=target/utia-run/jacoco.exec"));
  });

  it("Maven: JaCoCo va sin versión, para usar la del proyecto si ya lo engancha", () => {
    // Con una versión fija distinta de la del pom.xml, la máquina virtual de
    // las pruebas carga dos agentes y se cae antes de correr nada.
    const pinned = MAVEN.testArgs(TEST_CLASS, true).filter((arg) => /jacoco-maven-plugin:\d/.test(arg));
    assert.deepEqual(pinned, []);
  });

  it("Gradle: su configuración aparte, solo la clase y el informe en la carpeta de la extensión", () => {
    const args = GRADLE.testArgs(TEST_CLASS, true);

    assert.deepEqual(args.slice(0, 7), [
      "--console=plain",
      "--no-daemon",
      "--init-script",
      "build/utia-run/utia.gradle",
      "test",
      "--tests",
      TEST_CLASS,
    ]);
    assert.ok(args.includes("jacocoTestReport"));
    assert.ok(args.includes("-Putia.testResults=build/utia-run/test-results"));
    assert.match(GRADLE.setupFiles["utia.gradle"], /toolVersion = '0\.8\.15'/);
  });

  it("ninguna ruta del proyecto pasa por la línea de comandos", () => {
    for (const args of [MAVEN.testArgs(TEST_CLASS, true), GRADLE.testArgs(TEST_CLASS, true)]) {
      assert.ok(args.every((arg) => !path.isAbsolute(arg.replace(/^-[DP][\w.]+=/, ""))), args.join(" "));
    }
  });
});

describe("cómo se lanza la herramienta", () => {
  it("comillas para la consola de Windows solo cuando hacen falta", () => {
    assert.equal(quoteForCmd("-Dtest=com.tienda.Prueba_Test"), "-Dtest=com.tienda.Prueba_Test");
    assert.equal(quoteForCmd("test-compile"), "test-compile");
    assert.equal(quoteForCmd("con espacio"), '"con espacio"');
  });

  it("pide la consola en UTF-8 sin pisar ni duplicar las opciones que ya hubiera", () => {
    const env = buildEnvironment({ Path: "C:\\bin", maven_opts: "-Xmx1g" });

    assert.equal(env["Path"], "C:\\bin");
    assert.equal(env["maven_opts"], undefined);
    assert.match(env["MAVEN_OPTS"] ?? "", /^-Xmx1g -Dstdout\.encoding=UTF-8/);
    assert.match(env["GRADLE_OPTS"] ?? "", /^-Dstdout\.encoding=UTF-8/);
  });

  it("busca el comando en el PATH con las extensiones de Windows", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "utia-path-"));
    try {
      await fsp.writeFile(path.join(dir, "mvn.cmd"), "", "utf8");
      const env = { PATH: `C:\\no-existe;${dir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
      assert.equal(await findOnPath("mvn", env, "win32"), path.join(dir, "mvn.cmd"));
      assert.equal(await findOnPath("gradle", env, "win32"), undefined);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
