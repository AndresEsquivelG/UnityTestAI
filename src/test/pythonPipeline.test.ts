import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { checkGeneratedTest, generateTest, type Ask, type PipelineEvent } from "../pipeline";
import { PythonAdapter } from "../adapters/python/pythonAdapter";
import { createPythonFixture, type PythonFixture } from "./support/pythonFixture";
import { fakePythonRuntime } from "./support/pythonRunOutputs";

/**
 * El pipeline entero sobre el adaptador de Python, con un modelo «de libreto»
 * como el de `javaPipeline.test.ts`.
 *
 * No mide la calidad de la prueba: comprueba que la generación encadena las
 * operaciones de Python de punta a punta. El resolutor pide la dependencia con
 * su nombre con puntos, el analizador devuelve los campos propios de Python y
 * el generador los recibe, la ficha llega con la línea que importa la clase, y
 * la prueba queda escrita en `tests/` sin el cercado. Después la comprueba, la
 * ejecuta y la mide con un Python de mentira (`pythonRunOutputs.ts`).
 */

/** Lo que devolvería un modelo: con cercado. */
const GENERATED = [
  "```python",
  "import pytest",
  "",
  "from tienda.carrito import Carrito",
  "from tienda.modelo import Item",
  "",
  "",
  "def test_agregar_suma_el_item():",
  "    carrito = Carrito()",
  '    carrito.agregar(Item("lapiz", 1.5))',
  "    assert len(carrito.items) == 1",
  "```",
].join("\n");

const ANALYSIS = {
  status: "READY",
  methodSummary: { name: "agregar", inputs: [{ name: "item", type: "Item" }], output: "None" },
  dependencies: [{ name: "Item", type: "dataclass", membersUsed: ["nombre"] }],
  decisionTable: [],
  loops: [{ type: "for", condition: "range(cantidad)" }],
  sideEffects: ["appends item to self.items"],
  privateMembers: [{ name: "_cache", kind: "attribute", type: "dict" }],
  lateAttributes: [],
  patchTargets: [],
  requiredImports: ["from tienda.modelo import Item"],
  untestableBranches: [],
  preFlightChecklist: {
    typeInstantiations: [
      {
        typeName: "Item",
        pattern: "direct",
        constructorSignature: "Item(nombre: str, precio: float = 0.0)",
        parameterless: false,
        constructorNotes: "",
        reason: "dataclass",
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
      files: ["tienda.modelo.Item"],
      codeSlice: "class Carrito:\n    def agregar(self, item):\n        self.items.append(item)",
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

describe("pipeline entero sobre el adaptador de Python", () => {
  let fixture: PythonFixture;

  beforeEach(async () => {
    fixture = await createPythonFixture();
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  function generate(ask: Ask, onEvent?: (event: PipelineEvent) => void) {
    return generateTest({
      adapter: new PythonAdapter(),
      rootPath: fixture.projectRoot,
      className: "Carrito",
      methodName: "agregar",
      modelId: "libreto",
      reduceContext: false,
      ask,
      onEvent,
    });
  }

  it("escribe la prueba en tests/, con el nombre que recolecta pytest y sin el cercado", async () => {
    const test = await generate(scriptedModel().ask);

    const written = path.join(fixture.testDir, "UTIA_libreto_Carrito_agregar_test.py");
    assert.equal(test.savedPath, written);

    const content = fs.readFileSync(written, "utf8");
    assert.equal(content, test.testCode);
    assert.ok(content.startsWith("import pytest\n"), content.slice(0, 40));
    assert.ok(!content.includes("```"));
  });

  it("traduce la dependencia con puntos a su archivo y la suma al contexto", async () => {
    const events: PipelineEvent[] = [];
    const test = await generate(scriptedModel().ask, (event) => events.push(event));

    assert.deepEqual(events.find((event) => event.kind === "dependencyFiles"), {
      kind: "dependencyFiles",
      files: [{ path: "tienda/modelo.py", found: true, detected: false }],
    });
    assert.ok(test.assembledContext.includes("class Forma(ABC):"));
  });

  it("el generador recibe el perfil de pytest y lo que el analizador calculó para Python", async () => {
    const model = scriptedModel();
    await generate(model.ask);

    const prompt = model.prompts.get("Test Generator") ?? "";
    assert.match(prompt, /MINIMUM number of pytest test methods/);
    assert.match(prompt, /━━ PRE-FLIGHT CHECKLIST/);
    assert.match(prompt, /Item → Item\(nombre: str, precio: float = 0\.0\)/);
    assert.match(prompt, /Required imports \(exact lines\):\n {2}from tienda\.modelo import Item/);
    // El código del proyecto trae `{{no}}` en un texto con formato: lo que no
    // puede quedar es un marcador de la plantilla.
    assert.ok(!/\{\{[A-Za-z]+\}\}/.test(prompt.replace("{{no}}", "")), "quedó un marcador sin componer");
  });

  it("la ficha llega con la línea que importa la clase al final del contexto de cada agente", async () => {
    const model = scriptedModel();
    const test = await generate(model.ask);

    // Después del validador de contexto: él no la ve, así que no la puede tocar.
    assert.ok(!(model.prompts.get("Context Validator") ?? "").includes("CLASS FACTS"));
    for (const agent of ["Code Analyzer", "Test Generator", "Test Validator"]) {
      const prompt = model.prompts.get(agent) ?? "";
      assert.match(prompt, /━━ CLASS FACTS/, agent);
      assert.match(prompt, /Import it in the test exactly like this:\n {2}from tienda\.carrito import Carrito/, agent);
    }

    // El corrector compone su prompt con este contexto.
    assert.ok(
      test.assembledContext.indexOf("━━ CLASS FACTS") > test.assembledContext.indexOf("class Forma(ABC):"),
      "la ficha no quedó después de las dependencias"
    );

    const saved = JSON.parse(
      fs.readFileSync(path.join(fixture.projectRoot, "AgentOutputs", "unit-facts", "unit-facts-output.json"), "utf8")
    );
    assert.match(saved.facts, /from tienda\.carrito import Carrito/);
  });

  it("con src/, la ficha importa sin esa carpeta", async () => {
    await fixture.dispose();
    fixture = await createPythonFixture({ layout: "src" });
    const model = scriptedModel();
    await generate(model.ask);

    assert.match(model.prompts.get("Test Generator") ?? "", /\n {2}from tienda\.carrito import Carrito\n/);
  });

  async function check(adapter: PythonAdapter, test: Awaited<ReturnType<typeof generate>>, ask: Ask) {
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
      event.kind !== "verified" && "presentation" in event
        ? [`${event.presentation.stageName}: ${event.presentation.status}`]
        : []
    );

  it("comprueba que se importa, la ejecuta y la mide con el Python del proyecto", async () => {
    const model = scriptedModel();
    const test = await generate(model.ask);
    const runtime = fakePythonRuntime();

    const events = await check(new PythonAdapter({ runtime }), test, model.ask);

    assert.deepEqual(shown(events), [
      "Comprobación de importabilidad: passed",
      "Ejecución: passed",
      "Cobertura: measured",
    ]);
    assert.deepEqual(runtime.steps(), ["review", "collect", "coverageRun", "coverageJson"]);
    const coverage = events.find((event) => event.kind === "coverage");
    assert.ok(coverage && coverage.kind === "coverage");
    assert.equal(coverage.presentation.summary, "método agregar, 90 % de líneas (9 de 10).");
    assert.ok(coverage.presentation.details?.includes("Decisión del archivo: 50 % de decisiones (4 de 8)."));
    assert.ok(fs.existsSync(path.join(fixture.projectRoot, "AgentOutputs", "coverage", "coverage-report.html")));
  });

  it("sin Python, la prueba se genera igual y las tres etapas dicen qué falta", async () => {
    const model = scriptedModel();
    const test = await generate(model.ask);

    const events = await check(new PythonAdapter({ runtime: fakePythonRuntime({ interpreters: {} }) }), test, model.ask);

    assert.equal(fs.existsSync(test.savedPath), true);
    assert.deepEqual(shown(events), [
      "Comprobación de importabilidad: notRun",
      "Ejecución: notRun",
      "Cobertura: notRun",
    ]);
  });

  it("sin la carpeta de pruebas, se detiene antes de llamar al modelo y dice cuál crear", async () => {
    await fsp.rm(fixture.testDir, { recursive: true });
    const model = scriptedModel();

    await assert.rejects(generate(model.ask), /Creá la carpeta "tests"/);
    assert.equal(model.prompts.size, 0);
  });
});
