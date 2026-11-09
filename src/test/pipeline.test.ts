import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as fs from "fs";
import * as path from "path";
import {
  checkGeneratedTest,
  generateTest,
  type Ask,
  type PipelineEvent,
} from "../pipeline";
import type {
  ArtifactSpec,
  EcosystemAdapter,
  PreconditionViolation,
  ProjectModel,
} from "../core/contracts";
import { artifactRelativePath, UnmetPreconditions } from "../core/project";
import { FictitiousAdapter } from "./support/fictitiousAdapter";
import { createFictitiousFixture, type FictitiousFixture } from "./support/fictitiousFixture";

/**
 * El pipeline entero, de la localización a la cobertura, sobre el adaptador
 * ficticio y con un modelo «de libreto».
 *
 * El modelo de libreto reconoce a cada agente por la primera frase de su
 * plantilla y contesta lo que contestaría un modelo que hace bien su trabajo.
 * No mide la calidad de nada: comprueba que la secuencia se encadena, que el
 * núcleo salta las etapas que el ecosistema no ofrece y que la prueba queda
 * escrita donde dijo el adaptador.
 */

const SLICE = [
  "usar Registro",
  "",
  "unidad Calculadora {",
  "  funcion sumar(a, b) {",
  "    devolver a + b",
  "  }",
  "}",
];

const GENERATED = [
  "```fic",
  "usar Calculadora",
  "",
  "unidad PruebaDelModelo {",
  "  funcion prueba_suma() {",
  "    afirmar Calculadora.sumar(1, 2) == 3",
  "  }",
  "}",
  "```",
].join("\n");

interface ScriptLine {
  readonly agent: string;
  /** Con qué empieza el prompt de ese agente. */
  readonly opening: string;
  readonly response: string;
}

const SCRIPT: readonly ScriptLine[] = [
  {
    agent: "Method Slicer",
    opening: "You are a code extraction engine.",
    response: JSON.stringify({ status: "READY", codeSlice: SLICE }),
  },
  {
    agent: "Dependency Resolver",
    opening: "You are a static code dependency analyzer.",
    response: JSON.stringify({
      status: "MISSING_DEPENDENCIES",
      files: ["Registro"],
      codeSlice: SLICE.join("\n"),
    }),
  },
  {
    agent: "Context Builder",
    opening: "You are a code context optimizer.",
    response: JSON.stringify({
      status: "READY",
      dependencySlices: [
        {
          filePath: "fuentes/bitacora.fic",
          relevantSlice: "unidad Registro {\n  funcion anotar(texto) {\n    devolver texto\n  }\n}",
        },
      ],
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
    response: JSON.stringify({
      status: "READY",
      methodSummary: {
        name: "sumar",
        inputs: [
          { name: "a", type: "numero" },
          { name: "b", type: "numero" },
        ],
        output: "numero",
      },
      // La clase de la dependencia es la que el perfil ficticio le pide al
      // modelo (`analyzerDependencyKinds`), no una de C#.
      dependencies: [{ name: "Registro", type: "unidad", membersUsed: ["anotar"] }],
      decisionTable: [],
      loops: [],
      sideEffects: [],
    }),
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

/** Plantilla del informe de cobertura; el ficticio no mide, así que no se lee. */
const COVERAGE_TEMPLATE = path.resolve(__dirname, "..", "..", "ui", "coverage", "report.html");

/** Modelo que contesta según el libreto y anota a qué agente le contestó, y cuáles pidieron JSON. */
function scriptedModel(script: readonly ScriptLine[] = SCRIPT) {
  const calls: string[] = [];
  const jsonCalls: string[] = [];
  const ask: Ask = async (prompt, options) => {
    const line = script.find(({ opening }) => prompt.startsWith(opening));
    if (!line) {
      throw new Error(`Prompt que el libreto no conoce: ${prompt.slice(0, 80)}`);
    }
    calls.push(line.agent);
    if (options?.json) {
      jsonCalls.push(line.agent);
    }
    return line.response;
  };
  return { ask, calls, jsonCalls };
}

interface PipelineRun {
  readonly className?: string;
  readonly reduceContext?: boolean;
  readonly script?: readonly ScriptLine[];
}

describe("pipeline entero sobre el adaptador ficticio", () => {
  let fixture: FictitiousFixture;

  beforeEach(async () => {
    fixture = await createFictitiousFixture();
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  async function runPipeline(run: PipelineRun = {}) {
    const adapter = new FictitiousAdapter();
    const model = scriptedModel(run.script);
    const events: PipelineEvent[] = [];
    const className = run.className ?? "Calculadora";
    const methodName = "sumar";

    const test = await generateTest({
      adapter,
      rootPath: fixture.projectRoot,
      className,
      methodName,
      modelId: "libreto",
      reduceContext: run.reduceContext ?? true,
      ask: model.ask,
      onEvent: (event) => events.push(event),
    });
    const generationEvents = events.length;

    await checkGeneratedTest({
      adapter,
      test,
      className,
      methodName,
      ask: model.ask,
      tokenTotals: () => ({ inputTokens: 0, outputTokens: 0 }),
      coverageTemplate: COVERAGE_TEMPLATE,
      onEvent: (event) => events.push(event),
    });

    return {
      test,
      calls: model.calls,
      jsonCalls: model.jsonCalls,
      generation: events.slice(0, generationEvents),
      check: events.slice(generationEvents),
    };
  }

  it("los agentes que leen JSON lo piden; el generador, que escribe código, no", async () => {
    const { calls, jsonCalls } = await runPipeline();

    assert.deepEqual(
      calls.filter((agent) => agent !== "Test Generator"),
      jsonCalls,
      "cada agente que no es el generador tiene que pedir JSON"
    );
    assert.deepEqual(jsonCalls, [
      "Method Slicer",
      "Dependency Resolver",
      "Context Builder",
      "Context Validator",
      "Code Analyzer",
      "Test Validator",
    ]);
  });

  function agentSteps(events: readonly PipelineEvent[]): string[] {
    return events.flatMap((event) =>
      event.kind === "agent" ? [`${event.agent}: ${event.status}`] : []
    );
  }

  function readOutput(agentName: string): unknown {
    const file = path.join(fixture.projectRoot, "AgentOutputs", agentName, `${agentName}-output.json`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  it("con recorte, los siete agentes corren en orden y la prueba queda escrita", async () => {
    const { test, calls, generation } = await runPipeline();

    assert.deepEqual(calls, SCRIPT.map((line) => line.agent));
    assert.deepEqual(
      agentSteps(generation),
      SCRIPT.flatMap((line) => [`${line.agent}: running`, `${line.agent}: done`])
    );
    assert.equal(generation[0].kind, "generationStarted");

    // La dependencia la pidió el resolutor por el nombre de la unidad, y el
    // adaptador la tradujo a la ruta del archivo que la declara.
    assert.deepEqual(
      generation.find((event) => event.kind === "dependencyFiles"),
      {
        kind: "dependencyFiles",
        files: [{ path: "fuentes/bitacora.fic", found: true, detected: false }],
      }
    );

    const written = path.join(fixture.projectRoot, "pruebas", "prueba_calculadora_sumar.fic");
    assert.equal(test.savedPath, written);
    assert.equal(fs.readFileSync(written, "utf8"), test.testCode);
    assert.ok(test.testCode.startsWith("usar Calculadora"));
    assert.ok(test.testCode.includes("unidad PruebaCalculadoraSumar {"));
  });

  it("verificación, ejecución y cobertura se informan como no aplicables, sin correr nada", async () => {
    const { calls, check } = await runPipeline();

    // Ninguna etapa avisa que corre, y el corrector no se llama nunca.
    assert.deepEqual(
      check.map((event) => event.kind),
      ["verification", "verified", "testRun", "coverage"]
    );
    assert.equal(calls.length, SCRIPT.length);

    const statuses = check.map((event) =>
      event.kind === "verified" ? event.status : "presentation" in event ? event.presentation.status : event.kind
    );
    assert.deepEqual(statuses, ["notApplicable", "notApplicable", "notApplicable", "notApplicable"]);

    const coverage = check[check.length - 1];
    assert.equal(coverage.kind === "coverage" && coverage.report, undefined);

    assert.deepEqual(readOutput("verification"), { status: "notApplicable" });
    assert.equal((readOutput("test-run") as { status: string }).status, "notApplicable");
    assert.equal((readOutput("coverage") as { status: string }).status, "notApplicable");
  });

  it("el analizador acepta las clases de dependencia que dicta el perfil del adaptador", async () => {
    await runPipeline();

    assert.equal((readOutput("code-analyzer") as { status: string }).status, "READY");
  });

  it("sin recorte, no llama al recortador ni al constructor de contexto", async () => {
    const { calls } = await runPipeline({ reduceContext: false });

    assert.deepEqual(calls, [
      "Dependency Resolver",
      "Context Validator",
      "Code Analyzer",
      "Test Generator",
      "Test Validator",
    ]);
    assert.ok(fs.existsSync(path.join(fixture.projectRoot, "pruebas", "prueba_calculadora_sumar.fic")));
  });

  it("si el recortador falla, sigue con el archivo entero, lo avisa y escribe la prueba", async () => {
    const script = SCRIPT.map((line) =>
      line.agent === "Method Slicer" ? { ...line, response: '{"status": "READY", "codeSlice": ["a" "b"]}' } : line
    );

    const { calls, generation, test } = await runPipeline({ script });

    assert.deepEqual(calls, SCRIPT.map((line) => line.agent));
    const slicer = generation.filter((event) => event.kind === "agent" && event.agent === "Method Slicer").at(-1);
    assert.ok(slicer && slicer.kind === "agent");
    assert.equal(slicer.status, "error");
    assert.match(slicer.detail ?? "", /^Failed to parse LLM response as valid JSON: .*\. Se sigue con el archivo entero, sin recortar\.$/);

    // El resolutor recibió el archivo entero, con el comentario y la otra
    // función que el recorte habría quitado.
    const resolverPrompt = fs.readFileSync(
      path.join(fixture.projectRoot, "AgentOutputs", "dependency-resolver", "dependency-resolver-prompt.txt"),
      "utf8"
    );
    assert.ok(resolverPrompt.includes("funcion dividir(a, b) {"));
    assert.ok(fs.existsSync(test.savedPath));
  });

  it("si un agente falla, la corrida se corta y no escribe la prueba", async () => {
    const script = SCRIPT.map((line) =>
      line.agent === "Dependency Resolver" ? { ...line, response: "no es JSON" } : line
    );
    const model = scriptedModel(script);
    const events: PipelineEvent[] = [];

    await assert.rejects(
      generateTest({
        adapter: new FictitiousAdapter(),
        rootPath: fixture.projectRoot,
        className: "Calculadora",
        methodName: "sumar",
        modelId: "libreto",
        reduceContext: true,
        ask: model.ask,
        onEvent: (event) => events.push(event),
      }),
      /Dependency Resolver failed/
    );

    assert.deepEqual(model.calls, ["Method Slicer", "Dependency Resolver"]);
    assert.equal(agentSteps(events).at(-1), "Dependency Resolver: error");
    assert.equal(fs.existsSync(path.join(fixture.projectRoot, "pruebas", "prueba_calculadora_sumar.fic")), false);
  });

  it("con una precondición rota, falla con los incumplimientos antes de la primera llamada al modelo", async () => {
    fs.rmSync(path.join(fixture.projectRoot, "pruebas"), { recursive: true });
    const model = scriptedModel();

    const request = generateTest({
      adapter: new FictitiousAdapter(),
      rootPath: fixture.projectRoot,
      className: "Calculadora",
      methodName: "sumar",
      modelId: "libreto",
      reduceContext: true,
      ask: model.ask,
    });

    await assert.rejects(request, (error: unknown) => {
      assert.ok(error instanceof UnmetPreconditions);
      assert.equal(error.rootPath, fixture.projectRoot);
      assert.equal(error.violations[0].code, "ficticio.test-directory-missing");
      return true;
    });
    assert.deepEqual(model.calls, []);
  });

  it("le pasa a las precondiciones dónde está la unidad bajo prueba", async () => {
    const adapter: EcosystemAdapter = new FictitiousAdapter();
    const original = adapter.checkPreconditions.bind(adapter);
    let seen: string | undefined;
    adapter.checkPreconditions = (project, spec, location) => {
      seen = location?.filePath;
      return original(project, spec);
    };

    await generateTest({
      adapter,
      rootPath: fixture.projectRoot,
      className: "Calculadora",
      methodName: "sumar",
      modelId: "libreto",
      reduceContext: true,
      ask: scriptedModel().ask,
    });

    assert.match(seen ?? "", /calculadora/i);
  });

  describe("generar pese a los avisos", () => {
    const AVISO = {
      code: "ficticio.falta-algo",
      message: "Falta algo en el proyecto.",
      remediation: "Agregalo.",
    };

    /** El ficticio, con verificación, y con los incumplimientos que diga cada prueba. */
    function adapterWith(
      pending: () => readonly PreconditionViolation[],
      status: "failed" | "passed" = "failed"
    ): EcosystemAdapter {
      const base = new FictitiousAdapter();
      return Object.assign(Object.create(base), {
        capabilities: { ...base.capabilities, verification: "compile" },
        checkPreconditions: async () => pending(),
        verifyArtifact: async (_project: ProjectModel, spec: ArtifactSpec) =>
          status === "passed"
            ? { status, diagnostics: [], exitCode: 0, rawOutput: "" }
            : {
                status,
                diagnostics: [
                  {
                    filePath: artifactRelativePath(spec),
                    line: 1,
                    severity: "error",
                    code: "E1",
                    message: "No se encuentra el tipo.",
                  },
                ],
                exitCode: 1,
                rawOutput: "",
              },
      }) as EcosystemAdapter;
    }

    async function generateAndCheck(adapter: EcosystemAdapter) {
      const model = scriptedModel();
      const events: PipelineEvent[] = [];
      const test = await generateTest({
        adapter,
        rootPath: fixture.projectRoot,
        className: "Calculadora",
        methodName: "sumar",
        modelId: "libreto",
        reduceContext: true,
        ignorePreconditions: true,
        ask: model.ask,
      });
      await checkGeneratedTest({
        adapter,
        test,
        className: "Calculadora",
        methodName: "sumar",
        ask: model.ask,
        tokenTotals: () => ({ inputTokens: 0, outputTokens: 0 }),
        coverageTemplate: COVERAGE_TEMPLATE,
        onEvent: (event) => events.push(event),
      });
      const shown = events.filter((event) => event.kind === "verification").at(-1);
      assert.ok(shown?.kind === "verification");
      const fixerAsked = events.some(
        (event) => event.kind === "agent" && event.agent === "Auto Fixer #1"
      );
      return { presentation: shown.presentation, fixerAsked };
    }

    it("escribe la prueba aunque falte su carpeta, y la crea", async () => {
      fs.rmSync(path.join(fixture.projectRoot, "pruebas"), { recursive: true });
      const model = scriptedModel();

      const test = await generateTest({
        adapter: new FictitiousAdapter(),
        rootPath: fixture.projectRoot,
        className: "Calculadora",
        methodName: "sumar",
        modelId: "libreto",
        reduceContext: true,
        ignorePreconditions: true,
        ask: model.ask,
      });

      assert.ok(fs.existsSync(test.savedPath));
      assert.ok(model.calls.includes("Test Generator"));
      assert.ok(test.ignoredPreconditionsAt?.filePath.toLowerCase().includes("calculadora"));
    });

    it("sin pedirlo no marca nada", async () => {
      const test = await generateTest({
        adapter: new FictitiousAdapter(),
        rootPath: fixture.projectRoot,
        className: "Calculadora",
        methodName: "sumar",
        modelId: "libreto",
        reduceContext: true,
        ask: scriptedModel().ask,
      });

      assert.equal(test.ignoredPreconditionsAt, undefined);
    });

    it("si un agente falla antes de escribir, no deja la carpeta creada", async () => {
      fs.rmSync(path.join(fixture.projectRoot, "pruebas"), { recursive: true });
      const script = SCRIPT.map((line) =>
        line.agent === "Dependency Resolver" ? { ...line, response: "no es JSON" } : line
      );

      await assert.rejects(
        generateTest({
          adapter: new FictitiousAdapter(),
          rootPath: fixture.projectRoot,
          className: "Calculadora",
          methodName: "sumar",
          modelId: "libreto",
          reduceContext: true,
          ignorePreconditions: true,
          ask: scriptedModel(script).ask,
        }),
        /Dependency Resolver failed/
      );

      assert.equal(fs.existsSync(path.join(fixture.projectRoot, "pruebas")), false);
    });

    it("mientras sigue pendiente no llama al corrector, y dice por qué", async () => {
      const { presentation, fixerAsked } = await generateAndCheck(adapterWith(() => [AVISO]));

      assert.equal(fixerAsked, false);
      assert.equal(presentation.status, "failed");
      assert.ok(presentation.note?.includes("No se intentó corregirla sola"));
      assert.ok(presentation.note?.includes(AVISO.message));
      assert.equal(presentation.remediation, AVISO.remediation);
      assert.equal(presentation.diagnostics.length, 1);
    });

    it("si ya se resolvió, el corrector vuelve a correr", async () => {
      const { presentation, fixerAsked } = await generateAndCheck(adapterWith(() => []));

      assert.equal(fixerAsked, true);
      assert.ok(!presentation.note?.includes("No se intentó"));
    });

    it("si compila igual, no dice que algo sigue pendiente", async () => {
      const { presentation } = await generateAndCheck(adapterWith(() => [AVISO], "passed"));

      assert.equal(presentation.status, "passed");
      assert.equal(presentation.note, undefined);
    });
  });

  it("si la unidad no existe, falla antes de la primera llamada al modelo", async () => {
    const model = scriptedModel();

    await assert.rejects(
      generateTest({
        adapter: new FictitiousAdapter(),
        rootPath: fixture.projectRoot,
        className: "Fantasma",
        methodName: "sumar",
        modelId: "libreto",
        reduceContext: true,
        ask: model.ask,
      }),
      { message: 'No se encontró la unidad "Fantasma" en el proyecto.' }
    );
    assert.deepEqual(model.calls, []);
  });
});
