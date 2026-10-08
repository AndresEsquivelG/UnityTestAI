import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { AdapterRegistry, findCapabilityMismatches, selectEcosystem } from "../core/adapters";
import type { ArtifactSpec, ProjectModel, SymbolCandidate } from "../core/contracts";
import {
  artifactRelativePath,
  readArtifact,
  renderProjectTree,
  resolveDependencies,
  writeArtifact,
} from "../core/project";
import { composeTemplate, templatePlaceholders } from "../core/prompts";
import {
  presentCoverage,
  presentRepairResult,
  presentTestRun,
  runCoverageStage,
  runTestStage,
  verifyAndRepair,
} from "../core/verification";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import { FictitiousAdapter } from "./support/fictitiousAdapter";
import {
  FICTITIOUS_MARKER,
  createFictitiousFixture,
  type FictitiousFixture,
} from "./support/fictitiousFixture";
import { createUnityFixture, type UnityFixture } from "./support/unityFixture";

/** Código como lo devolvería el generador, con el cercado y otro nombre. */
const GENERATED = [
  "```fic",
  "usar Calculadora",
  "",
  "unidad CualquierNombre {",
  "  funcion prueba_suma() {",
  "    afirmar Calculadora.sumar(1, 2) == 3",
  "  }",
  "}",
  "```",
].join("\n");

describe("adaptador ficticio", () => {
  const adapter = new FictitiousAdapter();
  let fixture: FictitiousFixture;
  let project: ProjectModel;

  before(async () => {
    fixture = await createFictitiousFixture();
    project = await adapter.buildProjectModel(fixture.projectRoot);
  });

  after(async () => {
    await fixture.dispose();
  });

  async function locate(className: string | null, methodName: string): Promise<SymbolCandidate> {
    const location = await adapter.locateSymbol(project, { className, methodName });
    assert.ok(location.found, `no se localizó ${className}.${methodName}`);
    return location.candidates[0];
  }

  async function specFor(className: string | null, methodName: string): Promise<ArtifactSpec> {
    return adapter.specifyArtifact({
      project,
      target: { className, methodName },
      targetLocation: await locate(className, methodName),
      modelId: "claude",
    });
  }

  describe("alta y capacidades", () => {
    it("declara ausentes las seis capacidades y no implementa ninguna", () => {
      assert.deepEqual(adapter.capabilities, {
        verification: "none",
        runTests: false,
        coverage: false,
        analysisSchemaExtension: false,
        lifecycle: false,
        dependencyDetection: false,
      });
      for (const operation of [
        "verifyArtifact",
        "runTests",
        "collectCoverage",
        "extendAnalysisSchema",
        "prepare",
        "cleanup",
        "detectDependencies",
      ]) {
        assert.equal(operation in adapter, false, `implementa ${operation}`);
      }
      assert.deepEqual(findCapabilityMismatches(adapter), []);
    });

    it("el registro lo acepta como a cualquier otro adaptador", () => {
      const registry = new AdapterRegistry();
      registry.register(adapter);

      assert.equal(registry.get("ficticio"), adapter);
    });

    describe("junto a Unity, cada uno reclama solo su proyecto", () => {
      const registry = new AdapterRegistry();
      let unityFixture: UnityFixture;

      before(async () => {
        registry.register(new UnityAdapter());
        registry.register(new FictitiousAdapter());
        unityFixture = await createUnityFixture();
      });

      after(async () => {
        await unityFixture.dispose();
      });

      it("elige el ficticio en su proyecto", async () => {
        const selection = await selectEcosystem(registry.list(), { rootPath: fixture.projectRoot });

        assert.ok(selection.selected);
        assert.equal(selection.active.adapter.descriptor.id, "ficticio");
        assert.equal(selection.ambiguous, false);
      });

      it("elige Unity en el suyo", async () => {
        const selection = await selectEcosystem(registry.list(), {
          rootPath: unityFixture.projectRoot,
        });

        assert.ok(selection.selected);
        assert.equal(selection.active.adapter.descriptor.id, "unity");
        assert.equal(selection.ambiguous, false);
      });
    });
  });

  describe("OP-02 · detección de aplicabilidad", () => {
    it("reconoce el proyecto por su marcador", async () => {
      assert.deepEqual(await adapter.detectApplicability({ rootPath: fixture.projectRoot }), {
        applicable: true,
        confidence: 0.9,
        evidence: [FICTITIOUS_MARKER],
      });
    });

    it("no reclama una carpeta sin marcador", async () => {
      assert.deepEqual(await adapter.detectApplicability({ rootPath: fixture.testsDir }), {
        applicable: false,
        confidence: 0,
        evidence: [],
      });
    });

    it("no lanza ante una ruta que no existe", async () => {
      const result = await adapter.detectApplicability({
        rootPath: path.join(fixture.projectRoot, "no-existe"),
      });

      assert.equal(result.applicable, false);
    });
  });

  describe("OP-04 · modelo del proyecto", () => {
    it("recoge solo las fuentes, con rutas relativas y en orden", () => {
      assert.deepEqual(
        project.sources.map((source) => source.relativePath),
        [
          "fuentes/bitacora.fic",
          "fuentes/mates/calculadora.fic",
          "fuentes/principal.fic",
          "fuentes/utiles.fic",
          "pruebas/prueba_registro_anotar.fic",
        ]
      );
    });

    it("marca a qué jerarquía pertenece cada fuente", () => {
      const roots = Object.fromEntries(
        project.sources.map((source) => [source.name, source.sourceRoot])
      );

      assert.equal(roots["calculadora.fic"], "main");
      assert.equal(roots["prueba_registro_anotar.fic"], "test");
      assert.equal(project.ecosystemId, "ficticio");
    });

    it("el núcleo dibuja su árbol sin saber de qué ecosistema es", () => {
      assert.equal(
        renderProjectTree(project),
        [
          "- fuentes",
          "  - mates",
          "    - calculadora.fic",
          "  - bitacora.fic",
          "  - principal.fic",
          "  - utiles.fic",
          "- pruebas",
          "  - prueba_registro_anotar.fic",
        ].join("\n")
      );
    });
  });

  describe("OP-05 · localización de la unidad", () => {
    it("localiza una función dentro de su unidad", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Calculadora",
        methodName: "sumar",
      });

      assert.deepEqual(location, {
        found: true,
        candidates: [
          {
            filePath: "fuentes/mates/calculadora.fic",
            line: 5,
            column: 3,
            signature: "funcion sumar(a, b)",
          },
        ],
      });
    });

    it("las llaves de un comentario o de una cadena no desordenan el anidamiento", async () => {
      // `dividir` va después de una cadena con una llave abierta: si la cadena
      // contara, quedaría un nivel más adentro y dejaría de ser de la unidad.
      const candidate = await locate("Calculadora", "dividir");

      assert.equal(candidate.line, 10);
    });

    it("localiza una función declarada fuera de toda unidad", async () => {
      const candidate = await locate(null, "duplicar");

      assert.deepEqual(candidate, {
        filePath: "fuentes/utiles.fic",
        line: 1,
        column: 1,
        signature: "funcion duplicar(x)",
      });
    });

    it("no confunde una función de módulo con una de unidad", async () => {
      const sinClase = await adapter.locateSymbol(project, { className: null, methodName: "contar" });
      const conClase = await adapter.locateSymbol(project, {
        className: "Contador",
        methodName: "duplicar",
      });

      assert.equal(sinClase.found, false);
      assert.equal(conClase.found, false);
    });

    it("invocar una función no es declararla", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Principal",
        methodName: "sumar",
      });

      assert.deepEqual(location, {
        found: false,
        reason: 'No se encontró la declaración de "sumar" dentro de "Principal".',
      });
    });

    it("distingue la unidad que no existe", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Fantasma",
        methodName: "sumar",
      });

      assert.deepEqual(location, {
        found: false,
        reason: 'No se encontró la unidad "Fantasma" en el proyecto.',
      });
    });
  });

  describe("OP-06 · lectura del código fuente", () => {
    it("lee el archivo que indicó la localización", async () => {
      const source = await adapter.readSource(project, await locate("Calculadora", "sumar"));

      assert.equal(source.filePath, "fuentes/mates/calculadora.fic");
      assert.ok(source.content.includes("funcion sumar(a, b) {"));
    });
  });

  describe("OP-07 · resolución de dependencias", () => {
    for (const reference of [
      "fuentes/mates/calculadora.fic",
      "fuentes\\mates\\calculadora",
      "./fuentes/mates/calculadora.fic",
      "calculadora.fic",
    ]) {
      it(`resuelve "${reference}"`, async () => {
        const resolution = await adapter.resolveDependency(project, reference);

        assert.ok(resolution.resolved);
        assert.equal(resolution.relativePath, "fuentes/mates/calculadora.fic");
      });
    }

    it("resuelve por el nombre de la unidad aunque el archivo se llame distinto", async () => {
      const resolution = await adapter.resolveDependency(project, "Registro");

      assert.ok(resolution.resolved);
      assert.equal(resolution.relativePath, "fuentes/bitacora.fic");
    });

    it("informa lo que intentó cuando no la encuentra", async () => {
      assert.deepEqual(await adapter.resolveDependency(project, "Inexistente"), {
        resolved: false,
        reference: "Inexistente",
        triedPaths: ["Inexistente.fic"],
      });
    });

    it("el núcleo las resuelve sin repetir un archivo pedido dos veces", async () => {
      const resolved = await resolveDependencies(adapter, project, [
        "Registro",
        "fuentes/bitacora.fic",
        "Inexistente",
      ]);

      assert.deepEqual(
        resolved.files.map(({ reference, found }) => ({ reference, found })),
        [
          { reference: "Registro", found: true },
          { reference: "Inexistente", found: false },
        ]
      );
    });
  });

  describe("OP-08 · perfil de prompt", () => {
    const TEMPLATES = [
      "methodSlicerPrompt.txt",
      "dependencyResolverPrompt.txt",
      "contextBuilderPrompt.txt",
      "contextValidatorPrompt.txt",
      "testValidatorPrompt.txt",
      "chatFixerPrompt.txt",
      "codeAnalyzerPrompt.txt",
      "testGeneratorPrompt.txt",
    ];
    const BLOCK_LINE = /^[ \t]*\{\{[A-Za-z][A-Za-z0-9]*\}\}[ \t]*$/;

    function readTemplate(name: string): string {
      return fs.readFileSync(path.resolve(__dirname, "..", "prompts", name), "utf8");
    }

    /** Marcadores que caen dentro de una frase y no solos en su línea. */
    function inlinePlaceholders(template: string): readonly string[] {
      return template
        .split(/\r?\n/)
        .filter((line) => !BLOCK_LINE.test(line))
        .flatMap((line) => templatePlaceholders(line));
    }

    const profile = new FictitiousAdapter().getPromptProfile({
      rootPath: "/proyecto",
      ecosystemId: "ficticio",
      sourceRoots: [],
      sources: [],
    });
    const answered = new Set([
      ...Object.keys(profile.vocabulary),
      ...Object.keys(profile.fragments),
    ]);

    for (const name of TEMPLATES) {
      it(`${name} se compone sin huecos en ninguna frase`, () => {
        const template = readTemplate(name);
        const holes = inlinePlaceholders(template).filter((point) => !answered.has(point));

        assert.deepEqual(holes, []);
        assert.equal(composeTemplate(template, profile).includes("{{"), false);
      });
    }

    it("no aporta ningún bloque: cada fragmento cae dentro de una frase", () => {
      const inline = new Set(TEMPLATES.flatMap((name) => inlinePlaceholders(readTemplate(name))));
      const blocks = Object.keys(profile.fragments).filter((point) => !inline.has(point));

      assert.deepEqual(blocks, []);
    });
  });

  describe("OP-10 y OP-11 · artefacto de prueba", () => {
    it("el archivo y la unidad de prueba no se llaman igual", async () => {
      assert.deepEqual(await specFor("Calculadora", "sumar"), {
        directory: "pruebas",
        fileName: "prueba_calculadora_sumar",
        extension: ".fic",
        unitName: "PruebaCalculadoraSumar",
      });
    });

    it("sin clase, el nombre sale del archivo que declara la función", async () => {
      const spec = await specFor(null, "duplicar");

      assert.equal(spec.fileName, "prueba_utiles_duplicar");
      assert.equal(spec.unitName, "PruebaUtilesDuplicar");
    });

    it("el modelo no entra en el nombre", async () => {
      const targetLocation = await locate("Calculadora", "sumar");
      const target = { className: "Calculadora", methodName: "sumar" };

      assert.deepEqual(
        adapter.specifyArtifact({ project, target, targetLocation, modelId: "claude" }),
        adapter.specifyArtifact({ project, target, targetLocation, modelId: "llamaLocal" })
      );
    });

    it("quita el cercado y renombra la unidad, y normalizar dos veces no cambia nada", async () => {
      const spec = await specFor("Calculadora", "sumar");
      const once = adapter.normalizeGeneratedCode(GENERATED, spec);

      assert.equal(once.startsWith("usar Calculadora"), true);
      assert.equal(once.includes("```"), false);
      assert.ok(once.includes("unidad PruebaCalculadoraSumar {"));
      assert.equal(adapter.normalizeGeneratedCode(once, spec), once);
    });
  });

  describe("OP-12 · precondiciones", () => {
    it("no hay incumplimientos si existe la carpeta de pruebas", async () => {
      assert.deepEqual(await adapter.checkPreconditions(project, await specFor("Calculadora", "sumar")), []);
    });

    it("sin la carpeta, dice cuál falta y cómo crearla", async () => {
      const spec = { ...(await specFor("Calculadora", "sumar")), directory: "pruebas_borradas" };
      const [violation, ...rest] = await adapter.checkPreconditions(project, spec);

      assert.deepEqual(rest, []);
      assert.equal(violation.code, "ficticio.test-directory-missing");
      assert.ok(violation.remediation.includes("pruebas_borradas"));
    });
  });

  describe("etapas opcionales", () => {
    it("el núcleo escribe la prueba y salta verificación, ejecución y cobertura", async () => {
      const target = { className: "Calculadora", methodName: "sumar" };
      const targetLocation = await locate(target.className, target.methodName);
      const spec = adapter.specifyArtifact({ project, target, targetLocation, modelId: "claude" });
      const coverageTarget = { filePath: targetLocation.filePath, unit: target };

      // ── OP-11 y escritura ───────────────────────────────────────────────
      const code = adapter.normalizeGeneratedCode(GENERATED, spec);
      const savedPath = await writeArtifact(project, spec, code);

      assert.equal(artifactRelativePath(spec), "pruebas/prueba_calculadora_sumar.fic");
      assert.equal(await readArtifact(project, spec), code);

      // ── OP-13: sin verificación, el corrector no se llama nunca ─────────
      const repair = await verifyAndRepair({
        adapter,
        project,
        spec,
        fix: async () => assert.fail("no hay nada que corregir sin verificación"),
      });

      assert.equal(repair.outcome.status, "notApplicable");
      assert.equal(repair.stop, "notApplicable");
      assert.deepEqual(repair.cycles, []);
      assert.equal(presentRepairResult("none", repair).status, "notApplicable");

      // ── OP-14 y OP-15 ───────────────────────────────────────────────────
      const testRun = await runTestStage(adapter, project, spec, repair.outcome.status, coverageTarget);
      const coverage = await runCoverageStage(adapter, project, testRun, coverageTarget);

      assert.deepEqual(testRun, { status: "notApplicable" });
      assert.deepEqual(coverage, { status: "notApplicable" });
      assert.equal(presentTestRun(testRun, spec.unitName).status, "notApplicable");
      assert.equal(presentCoverage(coverage, coverageTarget).status, "notApplicable");

      // La prueba quedó como se escribió: saltar las etapas no la toca.
      assert.equal(await fsp.readFile(savedPath, "utf8"), code);
    });
  });
});
