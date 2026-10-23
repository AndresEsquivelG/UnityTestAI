import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { checkExistingTest, findExistingTest, type PipelineEvent } from "../pipeline";
import { JavaAdapter } from "../adapters/java/javaAdapter";
import { fakeBuildToolchain, mavenCompileErrors, passingReport } from "./support/javaBuildOutputs";
import { createJavaFixture, type JavaFixture } from "./support/javaFixture";

/**
 * Ejecutar y medir una prueba ya escrita, sin generarla: el botón del panel
 * cuando ya hay una prueba de esa unidad con ese modelo. Nada de esto recibe
 * una función para llamar al modelo, así que no puede llamarlo.
 */

const TEST_CLASS = "com.tienda.UTIA_libreto_Carrito_agregar_Test";
const TEST_FILE = "src/test/java/com/tienda/UTIA_libreto_Carrito_agregar_Test.java";
const COVERAGE_TEMPLATE = path.resolve(__dirname, "..", "..", "ui", "coverage", "report.html");

const TEST_CODE = [
  "package com.tienda;",
  "",
  "import org.junit.jupiter.api.Test;",
  "",
  "class UTIA_libreto_Carrito_agregar_Test {",
  "    @Test",
  "    void agregaUno() { }",
  "}",
  "",
].join("\n");

const CARRITO_JACOCO = `<?xml version="1.0" encoding="UTF-8"?>
<report name="tienda">
<package name="com/tienda">
<class name="com/tienda/Carrito" sourcefilename="Carrito.java">
<method name="agregar" desc="(Lcom/tienda/modelo/Item;)V" line="19"/>
</class>
<sourcefile name="Carrito.java">
<line nr="19" mi="0" ci="4" mb="0" cb="0"/>
</sourcefile>
</package>
</report>`;

describe("ejecutar y medir una prueba que ya existe", () => {
  let fixture: JavaFixture;

  beforeEach(async () => {
    fixture = await createJavaFixture();
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  function find(adapter = new JavaAdapter(), className = "Carrito") {
    return findExistingTest({
      adapter,
      rootPath: fixture.projectRoot,
      className,
      methodName: "agregar",
      modelId: "libreto",
    });
  }

  async function writeTest() {
    await fsp.writeFile(path.join(fixture.projectRoot, ...TEST_FILE.split("/")), TEST_CODE, "utf8");
  }

  /** El estado que mostró cada etapa, en orden. */
  const shown = (events: readonly PipelineEvent[]) =>
    events.flatMap((event) =>
      "presentation" in event ? [`${event.presentation.stageName}: ${event.presentation.status}`] : []
    );

  it("sin la prueba escrita, dice que hay que generarla", async () => {
    const lookup = await find();

    assert.equal(lookup.found, false);
    assert.ok(!lookup.found && /No hay una prueba de Carrito\.agregar generada con libreto: generala primero/.test(lookup.reason));
  });

  it("solo reconoce la prueba del mismo proveedor y modelo", async () => {
    const qwen = "src/test/java/com/tienda/UTIA_ollama_qwen2_5_14b_Carrito_agregar_Test.java";
    await fsp.writeFile(path.join(fixture.projectRoot, ...qwen.split("/")), TEST_CODE, "utf8");
    const lookup = (modelId: string) =>
      findExistingTest({ adapter: new JavaAdapter(), rootPath: fixture.projectRoot, className: "Carrito", methodName: "agregar", modelId });

    const same = await lookup("ollama/qwen2.5:14b");
    assert.ok(same.found && same.test.savedPath.endsWith("UTIA_ollama_qwen2_5_14b_Carrito_agregar_Test.java"));

    const other = await lookup("ollama/qwen2.5-coder:14b");
    assert.ok(!other.found && /generada con ollama\/qwen2\.5-coder:14b: generala primero/.test(other.reason));
  });

  it("con una unidad que no existe, avisa con el motivo del adaptador", async () => {
    const lookup = await find(new JavaAdapter(), "NoExiste");
    assert.ok(!lookup.found && lookup.reason.includes("NoExiste"));
  });

  it("encuentra la prueba con lo que deja una generación, y la ficha como contexto del corrector", async () => {
    await writeTest();
    const lookup = await find();

    assert.ok(lookup.found);
    const { test } = lookup;
    assert.equal(test.testCode, TEST_CODE);
    assert.equal(test.savedPath, path.join(fixture.projectRoot, ...TEST_FILE.split("/")));
    assert.equal(test.spec.unitName, "UTIA_libreto_Carrito_agregar_Test");
    assert.deepEqual(test.coverageTarget, {
      filePath: "src/main/java/com/tienda/Carrito.java",
      unit: { className: "Carrito", methodName: "agregar" },
    });
    assert.match(test.assembledContext, /^\/\/ ── TARGET: Carrito\.agregar/);
    assert.match(test.assembledContext, /public class Carrito \{/);
    assert.match(test.assembledContext, /━━ CLASS FACTS[\s\S]*The method under test: public void agregar\(Item item\)/);
  });

  it("compila, ejecuta y mide sin tocar la prueba", async () => {
    await writeTest();
    const toolchain = fakeBuildToolchain({
      respond: (args) =>
        args.includes("test-compile")
          ? { output: "[INFO] BUILD SUCCESS" }
          : {
              files: {
                [`target/surefire-reports/TEST-${TEST_CLASS}.xml`]: passingReport(TEST_CLASS),
                "target/site/jacoco/jacoco.xml": CARRITO_JACOCO,
              },
            },
    });
    const adapter = new JavaAdapter({ toolchain });
    const lookup = await find(adapter);
    assert.ok(lookup.found);

    const events: PipelineEvent[] = [];
    await checkExistingTest({
      adapter,
      test: lookup.test,
      coverageTemplate: COVERAGE_TEMPLATE,
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(shown(events), ["Compilación: passed", "Ejecución: passed", "Cobertura: measured"]);
    assert.deepEqual(events.find((event) => event.kind === "verified"), { kind: "verified", status: "passed" });
    assert.equal(toolchain.runs.length, 2);
    assert.ok(fs.existsSync(path.join(fixture.projectRoot, "AgentOutputs", "coverage", "coverage-report.html")));
    assert.equal(fs.readFileSync(lookup.test.savedPath, "utf8"), TEST_CODE);
  });

  it("si no compila, muestra los errores, no corrige y no ejecuta", async () => {
    await writeTest();
    const toolchain = fakeBuildToolchain({
      respond: () => ({ exitCode: 1, output: mavenCompileErrors(fixture.projectRoot, TEST_FILE) }),
    });
    const adapter = new JavaAdapter({ toolchain });
    const lookup = await find(adapter);
    assert.ok(lookup.found);

    const events: PipelineEvent[] = [];
    await checkExistingTest({
      adapter,
      test: lookup.test,
      coverageTemplate: COVERAGE_TEMPLATE,
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(shown(events), ["Compilación: failed", "Ejecución: notRun", "Cobertura: notRun"]);
    assert.ok(!events.some((event) => event.kind === "agent"), "llamó a un agente");
    assert.equal(toolchain.runs.length, 1);
    assert.equal(fs.readFileSync(lookup.test.savedPath, "utf8"), TEST_CODE);
  });
});
