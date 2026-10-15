import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { checkGeneratedTest, generateTest, type Ask, type PipelineEvent } from "../pipeline";
import { JavaAdapter } from "../adapters/java/javaAdapter";
import { fakeBuildToolchain, passingReport } from "./support/javaBuildOutputs";
import { createJavaFixture, type JavaFixture } from "./support/javaFixture";

/**
 * El pipeline entero sobre el adaptador de Java, con un modelo «de libreto»
 * como el de `pipeline.test.ts`.
 *
 * No mide la calidad de la prueba: comprueba que la generación encadena las
 * operaciones de Java de punta a punta. El resolutor pide la dependencia con
 * su nombre calificado, el analizador devuelve los campos propios de Java y
 * el generador los recibe, y la prueba queda escrita en la carpeta de su
 * paquete con la línea `package` correcta. Después la compilan, ejecutan y
 * miden un Maven de mentira, o avisan que no pueden en un proyecto de Ant.
 */

const TEST_CLASS = "com.tienda.UTIA_libreto_Carrito_agregar_Test";

/** Informe de JaCoCo armado a mano para `Carrito`: una sobrecarga cubierta y otra no. */
const CARRITO_JACOCO = `<?xml version="1.0" encoding="UTF-8"?>
<report name="tienda">
<package name="com/tienda">
<class name="com/tienda/Carrito" sourcefilename="Carrito.java">
<method name="agregar" desc="(Lcom/tienda/modelo/Item;)V" line="19"/>
<method name="agregar" desc="(Lcom/tienda/modelo/Item;I)V" line="26"/>
</class>
<sourcefile name="Carrito.java">
<line nr="19" mi="0" ci="4" mb="0" cb="0"/>
<line nr="26" mi="0" ci="3" mb="1" cb="1"/>
<line nr="27" mi="5" ci="0" mb="0" cb="0"/>
</sourcefile>
</package>
</report>`;

const SLICE = [
  "package com.tienda;",
  "",
  "import com.tienda.modelo.Item;",
  "",
  "public class Carrito {",
  "    public void agregar(Item item) {",
  "        agregar(item, 1);",
  "    }",
  "}",
];

/** Lo que devolvería un modelo: con cercado, otro paquete y otro nombre de clase. */
const GENERATED = [
  "```java",
  "package com.equivocado;",
  "",
  "import com.tienda.modelo.Item;",
  "import org.junit.jupiter.api.Test;",
  "import org.junit.jupiter.api.Timeout;",
  "import static org.junit.jupiter.api.Assertions.*;",
  "",
  "@Timeout(2)",
  "class Test_Carrito_agregar {",
  "    @Test",
  "    void agregaSinLanzar() {",
  '        assertDoesNotThrow(() -> new Carrito().agregar(new Item("lapiz", 1.5)));',
  "    }",
  "}",
  "```",
].join("\n");

const ANALYSIS = {
  status: "READY",
  methodSummary: { name: "agregar", inputs: [{ name: "item", type: "Item" }], output: "void" },
  dependencies: [{ name: "Item", type: "record", membersUsed: [] }],
  decisionTable: [],
  loops: [],
  sideEffects: ["adds item to items"],
  privateMembers: [{ name: "items", kind: "field", type: "List<Item>" }],
  injectedFields: [],
  requiredImports: ["com.tienda.modelo.Item"],
  untestableBranches: [],
  preFlightChecklist: {
    typeInstantiations: [
      {
        typeName: "Item",
        pattern: "new",
        constructorSignature: "Item(String nombre, double precio)",
        parameterless: false,
        constructorNotes: "",
        reason: "record",
      },
    ],
    computedProperties: [],
  },
};

interface ScriptLine {
  readonly agent: string;
  readonly opening: string;
  readonly response: string;
}

const SCRIPT: readonly ScriptLine[] = [
  {
    agent: "Dependency Resolver",
    opening: "You are a static code dependency analyzer.",
    response: JSON.stringify({
      status: "MISSING_DEPENDENCIES",
      files: ["com.tienda.modelo.Item"],
      codeSlice: SLICE.join("\n"),
    }),
  },
  {
    agent: "Context Validator",
    opening: "You are a context validator",
    response: JSON.stringify({ status: "VALID" }),
  },
  {
    agent: "Code Analyzer",
    opening: "You are a code analysis engine.",
    response: JSON.stringify(ANALYSIS),
  },
  {
    agent: "Test Generator",
    opening: "You are an expert Software Engineer",
    response: GENERATED,
  },
  {
    agent: "Test Validator",
    opening: "You are a test validator",
    response: JSON.stringify({ status: "VALID" }),
  },
];

const COVERAGE_TEMPLATE = path.resolve(__dirname, "..", "..", "ui", "coverage", "report.html");

/** Modelo de libreto que además guarda el prompt que recibió cada agente. */
function scriptedModel() {
  const prompts = new Map<string, string>();
  const ask: Ask = async (prompt) => {
    const line = SCRIPT.find(({ opening }) => prompt.startsWith(opening));
    if (!line) {
      throw new Error(`Prompt que el libreto no conoce: ${prompt.slice(0, 80)}`);
    }
    prompts.set(line.agent, prompt);
    return line.response;
  };
  return { ask, prompts };
}

describe("pipeline entero sobre el adaptador de Java", () => {
  let fixture: JavaFixture;

  beforeEach(async () => {
    fixture = await createJavaFixture();
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  function generate(ask: Ask, onEvent?: (event: PipelineEvent) => void) {
    return generateTest({
      adapter: new JavaAdapter(),
      rootPath: fixture.projectRoot,
      className: "Carrito",
      methodName: "agregar",
      modelId: "libreto",
      reduceContext: false,
      ask,
      onEvent,
    });
  }

  it("escribe la prueba en la carpeta de su paquete, con su paquete y el nombre del archivo", async () => {
    const model = scriptedModel();
    const test = await generate(model.ask);

    const written = path.join(fixture.testPackageDir, "UTIA_libreto_Carrito_agregar_Test.java");
    assert.equal(test.savedPath, written);

    const content = fs.readFileSync(written, "utf8");
    assert.equal(content, test.testCode);
    assert.ok(content.startsWith("package com.tienda;\n"), content.slice(0, 40));
    assert.ok(content.includes("class UTIA_libreto_Carrito_agregar_Test {"));
    assert.ok(!content.includes("```"));
  });

  it("traduce la dependencia calificada a su archivo y la suma al contexto", async () => {
    const events: PipelineEvent[] = [];
    const test = await generate(scriptedModel().ask, (event) => events.push(event));

    assert.deepEqual(events.find((event) => event.kind === "dependencyFiles"), {
      kind: "dependencyFiles",
      files: [{ path: "src/main/java/com/tienda/modelo/Item.java", found: true, detected: false }],
    });
    assert.ok(test.assembledContext.includes("public record Item(String nombre, double precio)"));
  });

  it("el generador recibe el perfil de JUnit 5 y lo que el analizador calculó para Java", async () => {
    const model = scriptedModel();
    await generate(model.ask);

    const prompt = model.prompts.get("Test Generator") ?? "";
    assert.match(prompt, /JUnit 5 \(Jupiter\) test methods/);
    assert.match(prompt, /━━ PRE-FLIGHT CHECKLIST/);
    assert.match(prompt, /Item → new Item\(String nombre, double precio\)/);
    assert.match(prompt, /Required imports[\s\S]*import com\.tienda\.modelo\.Item;/);
    assert.ok(!prompt.includes("{{"), "quedó un marcador sin componer");
  });

  it("la ficha de la clase llega al final del contexto de cada agente, y al corrector", async () => {
    const model = scriptedModel();
    const test = await generate(model.ask);

    // Después del validador de contexto: él no la ve, así que no la puede tocar.
    assert.ok(!(model.prompts.get("Context Validator") ?? "").includes("CLASS FACTS"));
    for (const agent of ["Code Analyzer", "Test Generator", "Test Validator"]) {
      const prompt = model.prompts.get(agent) ?? "";
      assert.match(prompt, /━━ CLASS FACTS/, agent);
      assert.match(prompt, /The method under test: public void agregar\(Item item\)/, agent);
    }

    // El corrector compone su prompt con este contexto.
    assert.match(test.assembledContext, /━━ CLASS FACTS[\s\S]*Methods of Carrito that `agregar` calls:/);
    assert.ok(
      test.assembledContext.indexOf("━━ CLASS FACTS") >
        test.assembledContext.indexOf("public record Item(String nombre, double precio)"),
      "la ficha no quedó después de las dependencias"
    );

    const generatorPrompt = model.prompts.get("Test Generator") ?? "";
    assert.match(generatorPrompt, /Only the CLASS FACTS block outranks it/);
    assert.match(generatorPrompt, /• CLASS FACTS block at the end of the context/);

    const saved = JSON.parse(
      fs.readFileSync(path.join(fixture.projectRoot, "AgentOutputs", "unit-facts", "unit-facts-output.json"), "utf8")
    );
    assert.match(saved.facts, /^━━ CLASS FACTS/);
  });

  async function check(adapter: JavaAdapter, test: Awaited<ReturnType<typeof generate>>, ask: Ask) {
    const events: PipelineEvent[] = [];
    await checkGeneratedTest({
      adapter,
      test,
      className: "Carrito",
      methodName: "agregar",
      ask,
      tokenTotals: () => ({ inputTokens: 0, outputTokens: 0 }),
      coverageTemplate: COVERAGE_TEMPLATE,
      onEvent: (event) => events.push(event),
    });
    return events;
  }

  /** El estado que mostró cada etapa, en orden, sin los avisos de «corriendo». */
  const shown = (events: readonly PipelineEvent[]) =>
    events.flatMap((event) =>
      event.kind === "verified"
        ? []
        : "presentation" in event
          ? [`${event.presentation.stageName}: ${event.presentation.status}`]
          : []
    );

  it("compila, ejecuta y mide la prueba con la herramienta del proyecto", async () => {
    const model = scriptedModel();
    const test = await generate(model.ask);
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

    const events = await check(new JavaAdapter({ toolchain }), test, model.ask);

    assert.deepEqual(shown(events), ["Compilación: passed", "Ejecución: passed", "Cobertura: measured"]);
    assert.equal(toolchain.runs.length, 2);
    const coverage = events.find((event) => event.kind === "coverage");
    assert.ok(coverage && coverage.kind === "coverage");
    assert.equal(coverage.presentation.summary, "método agregar, 66,7 % de líneas (2 de 3).");
    assert.ok(coverage.presentation.details?.includes("Decisión del archivo: 50 % de decisiones (1 de 2)."));
    assert.ok(fs.existsSync(path.join(fixture.projectRoot, "AgentOutputs", "coverage", "coverage-report.html")));
  });

  it("con Ant, la prueba se genera y las tres etapas dicen que solo saben hacerlo con Maven o Gradle", async () => {
    await fsp.rm(path.join(fixture.projectRoot, "pom.xml"));
    await fsp.writeFile(path.join(fixture.projectRoot, "build.xml"), "<project/>", "utf8");
    const model = scriptedModel();
    const test = await generate(model.ask);
    const toolchain = fakeBuildToolchain({});

    const events = await check(new JavaAdapter({ toolchain }), test, model.ask);

    assert.deepEqual(shown(events), ["Compilación: notRun", "Ejecución: notRun", "Cobertura: notRun"]);
    const summaries = events.flatMap((event) => ("presentation" in event ? [event.presentation.summary] : []));
    assert.match(summaries[0], /solo puede compilar, ejecutar y medir proyectos que usan Maven o Gradle, y este usa Ant/);
    assert.equal(summaries[1], "No se ejecutó. La verificación no se pudo hacer.");
    assert.equal(toolchain.runs.length, 0);
  });

  it("sin la carpeta del paquete, se detiene antes de llamar al modelo y dice cuál crear", async () => {
    await fsp.rm(fixture.testPackageDir, { recursive: true });
    const model = scriptedModel();

    await assert.rejects(generate(model.ask), /Creá la carpeta "src\/test\/java\/com\/tienda"/);
    assert.equal(model.prompts.size, 0);
  });
});
