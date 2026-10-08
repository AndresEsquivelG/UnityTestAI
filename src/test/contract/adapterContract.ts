import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AdapterRegistry } from "../../core/adapters";
import type {
  ArtifactSpec,
  EcosystemAdapter,
  ProjectModel,
  SymbolCandidate,
} from "../../core/contracts";
import { artifactAbsolutePath, writeArtifact } from "../../core/project";
import { composeTemplate, templatePlaceholders } from "../../core/prompts";

/**
 * Suite de contrato: lo que el núcleo da por hecho de cualquier adaptador.
 *
 * Cada comprobación es una promesa de `src/core/contracts/` de la que depende
 * una línea concreta del núcleo, citada al lado. Ninguna mira valores de un
 * ecosistema: un adaptador la corre con su ficha y nada más. Si necesitara una
 * excepción para alguno, la suite estaría midiendo a ese adaptador y no al
 * contrato.
 *
 * Cubre las once operaciones obligatorias. Las opcionales no entran todavía.
 */

/** Lo único que aporta cada adaptador para correr la suite. */
export interface ContractSheet {
  /** Nombre con el que se agrupan las pruebas. */
  readonly name: string;
  createAdapter(): EcosystemAdapter;
  /** Proyecto de ejemplo nuevo, que cumple todas las precondiciones. */
  createProject(): Promise<ContractProject>;
  /** Una unidad que el proyecto de ejemplo declara. */
  readonly knownUnit: { readonly className: string; readonly methodName: string };
  /** Una dependencia que el proyecto declara, nombrada como la pediría el agente. */
  readonly knownDependency: string;
  /** Código como lo devolvería el generador, con lo que suela traer de más. */
  readonly generatedCode: string;
}

export interface ContractProject {
  /** Raíz desde la que el adaptador construye el modelo. */
  readonly rootPath: string;
  /** Deja el proyecto sin cumplir alguna precondición. */
  breakPreconditions(): Promise<void>;
  dispose(): Promise<void>;
}

/** Nombre que ningún proyecto de ejemplo declara. */
const UNKNOWN = "NoExisteEnElProyecto";

/** Las plantillas, copiadas junto al constructor compilado. */
const TEMPLATES_DIR = path.resolve(__dirname, "..", "..", "prompts");

const BLOCK_LINE = /^[ \t]*\{\{[A-Za-z][A-Za-z0-9]*\}\}[ \t]*$/;

export function describeAdapterContract(sheet: ContractSheet): void {
  describe(`contrato del adaptador · ${sheet.name}`, () => {
    const adapter = sheet.createAdapter();
    let project: ContractProject;
    let model: ProjectModel;

    beforeEach(async () => {
      project = await sheet.createProject();
      model = await adapter.buildProjectModel(project.rootPath);
    });

    afterEach(async () => {
      await project.dispose();
    });

    async function locateKnown(): Promise<SymbolCandidate> {
      const location = await adapter.locateSymbol(model, sheet.knownUnit);
      assert.ok(location.found, `no localiza ${sheet.knownUnit.className}.${sheet.knownUnit.methodName}`);
      return location.candidates[0];
    }

    async function specForKnown(): Promise<ArtifactSpec> {
      return adapter.specifyArtifact({
        project: model,
        target: sheet.knownUnit,
        targetLocation: await locateKnown(),
        modelId: "contrato",
      });
    }

    describe("OP-01 y OP-03 · identidad", () => {
      // core/adapters/registry.ts: rechaza un identificador vacío y unas
      // capacidades que no coinciden con lo que el adaptador implementa.
      it("el registro lo acepta", () => {
        assert.doesNotThrow(() => new AdapterRegistry().register(sheet.createAdapter()));
      });
    });

    describe("OP-02 · detección", () => {
      // core/adapters/selection.ts ordena por confianza; el panel muestra la
      // evidencia.
      it("reclama su proyecto con una confianza entre 0 y 1, y dice por qué", async () => {
        const result = await adapter.detectApplicability({ rootPath: project.rootPath });

        assert.equal(result.applicable, true);
        assert.ok(result.confidence > 0 && result.confidence <= 1, `confianza ${result.confidence}`);
        assert.ok(result.evidence.length > 0, "sin evidencia");
      });

      it("no reclama una carpeta vacía ni una que no existe", async () => {
        const empty = await fsp.mkdtemp(path.join(os.tmpdir(), "contrato-"));
        try {
          for (const rootPath of [empty, path.join(empty, "no-existe")]) {
            const result = await adapter.detectApplicability({ rootPath });
            assert.equal(result.applicable, false, rootPath);
            assert.equal(result.confidence, 0, rootPath);
          }
        } finally {
          await fsp.rm(empty, { recursive: true, force: true });
        }
      });
    });

    describe("OP-04 · modelo del proyecto", () => {
      // core/project/projectTree.ts parte las rutas por «/», y el pipeline
      // las compone sobre la raíz para leer y para escribir los volcados.
      it("las rutas son relativas a una raíz absoluta, con «/», y existen", () => {
        assert.ok(path.isAbsolute(model.rootPath), model.rootPath);
        assert.equal(model.ecosystemId, adapter.descriptor.id);
        assert.ok(model.sources.length > 0, "el modelo no trae fuentes");

        for (const source of model.sources) {
          assertPortable(source.relativePath);
          assert.ok(
            fs.existsSync(path.join(model.rootPath, ...source.relativePath.split("/"))),
            `${source.relativePath} no existe`
          );
        }
      });
    });

    describe("OP-05 y OP-06 · localización y lectura", () => {
      // pipeline/generate.ts lee la primera candidata y mide la cobertura
      // sobre su archivo.
      it("localiza la unidad conocida en un archivo del modelo", async () => {
        const location = await adapter.locateSymbol(model, sheet.knownUnit);

        assert.ok(location.found);
        const sources = new Set(model.sources.map((source) => source.relativePath));
        for (const candidate of location.candidates) {
          assert.ok(sources.has(candidate.filePath), `${candidate.filePath} no está en el modelo`);
          assert.ok(candidate.line >= 1 && candidate.column >= 1, JSON.stringify(candidate));
          assert.ok(candidate.signature.includes(sheet.knownUnit.methodName), candidate.signature);
        }
      });

      // pipeline/generate.ts corta la corrida con el motivo, antes de la
      // primera llamada al modelo.
      it("ante una unidad que no existe, avisa con un motivo en lugar de lanzar", async () => {
        for (const target of [
          { className: sheet.knownUnit.className, methodName: UNKNOWN },
          { className: UNKNOWN, methodName: sheet.knownUnit.methodName },
        ]) {
          const location = await adapter.locateSymbol(model, target);
          assert.equal(location.found, false, JSON.stringify(target));
          assert.ok(!location.found && location.reason.trim().length > 0, "sin motivo");
        }
      });

      // El código que leen los agentes sale de aquí.
      it("lee el archivo que indicó la localización, con la declaración adentro", async () => {
        const candidate = await locateKnown();
        const source = await adapter.readSource(model, candidate);

        assert.equal(source.filePath, candidate.filePath);
        assert.ok(source.content.includes(candidate.signature), candidate.signature);
      });
    });

    describe("OP-07 · resolución de dependencias", () => {
      // core/project/dependencies.ts arma el contexto con lo que se resolvió.
      it("resuelve la dependencia conocida a un archivo del modelo", async () => {
        const resolution = await adapter.resolveDependency(model, sheet.knownDependency);

        assert.ok(resolution.resolved, sheet.knownDependency);
        assert.ok(model.sources.some((source) => source.relativePath === resolution.relativePath));
        assert.ok(resolution.content.length > 0);
      });

      // El agente pide las dependencias con las rutas que vio en el árbol.
      it("resuelve cada ruta del árbol a ese mismo archivo", async () => {
        for (const source of model.sources) {
          const resolution = await adapter.resolveDependency(model, source.relativePath);
          assert.ok(resolution.resolved, source.relativePath);
          assert.equal(resolution.relativePath, source.relativePath);
        }
      });

      // core/project/dependencies.ts guarda las rutas probadas para el
      // diagnóstico, y el panel muestra la dependencia como no encontrada.
      it("ante una que no existe, devuelve la referencia y lo que intentó", async () => {
        const resolution = await adapter.resolveDependency(model, UNKNOWN);

        assert.equal(resolution.resolved, false);
        assert.ok(!resolution.resolved && resolution.reference === UNKNOWN);
        assert.ok(!resolution.resolved && Array.isArray(resolution.triedPaths));
      });
    });

    describe("OP-08 · perfil de prompt", () => {
      // core/prompts/composeTemplate.ts: un marcador dentro de una frase que
      // el perfil no contesta se reemplaza por nada y deja la frase rota.
      it("todas las plantillas se componen sin marcadores ni frases con huecos", () => {
        const profile = adapter.getPromptProfile(model);
        const answered = new Set(
          [
            ...Object.entries(profile.vocabulary),
            ...Object.entries(profile.fragments),
          ]
            .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
            .map(([point]) => point)
        );

        const templates = fs.readdirSync(TEMPLATES_DIR).filter((name) => name.endsWith(".txt"));
        assert.ok(templates.length > 0, `no hay plantillas en ${TEMPLATES_DIR}`);

        for (const name of templates) {
          const template = fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf8");
          const holes = template
            .split(/\r?\n/)
            .filter((line) => !BLOCK_LINE.test(line))
            .flatMap((line) => templatePlaceholders(line))
            .filter((point) => !answered.has(point));

          assert.deepEqual(holes, [], `${name} queda con frases sin completar`);
          assert.equal(composeTemplate(template, profile).includes("{{"), false, name);
        }
      });
    });

    describe("OP-10, OP-11 y OP-12 · materialización", () => {
      // core/project/artifact.ts compone la ruta con «/» y concatena el
      // nombre con la extensión; la unidad se muestra en la ejecución.
      it("la especificación es una ruta que el núcleo sabe componer", async () => {
        const spec = await specForKnown();

        assertPortable(spec.directory);
        assert.ok(spec.fileName.length > 0 && !/[\\/]/.test(spec.fileName), spec.fileName);
        assert.ok(spec.extension.startsWith("."), spec.extension);
        assert.ok(spec.unitName.length > 0);
      });

      // El pipeline vuelve a normalizar las correcciones del validador y del
      // corrector, que ya pasaron por aquí una vez.
      it("normalizar dos veces da lo mismo que una", async () => {
        const spec = await specForKnown();
        const once = adapter.normalizeGeneratedCode(sheet.generatedCode, spec);

        assert.ok(once.trim().length > 0);
        assert.equal(adapter.normalizeGeneratedCode(once, spec), once);
      });

      // pipeline/generate.ts comprueba las precondiciones y después escribe
      // sin crear carpetas: si no hay incumplimientos, escribir tiene que
      // funcionar.
      it("sin incumplimientos, el núcleo escribe la prueba donde dijo la especificación", async () => {
        const spec = await specForKnown();

        assert.deepEqual(await adapter.checkPreconditions(model, spec), []);
        const code = adapter.normalizeGeneratedCode(sheet.generatedCode, spec);
        const written = await writeArtifact(model, spec, code);

        assert.equal(written, artifactAbsolutePath(model, spec));
        assert.equal(fs.readFileSync(written, "utf8"), code);
      });

      // core/project/artifact.ts muestra cada incumplimiento con su
      // instrucción.
      it("con una precondición rota, dice cuál y cómo resolverla", async () => {
        const spec = await specForKnown();
        await project.breakPreconditions();
        const violations = await adapter.checkPreconditions(model, spec);

        assert.ok(violations.length > 0, "no informa ningún incumplimiento");
        for (const violation of violations) {
          assert.ok(violation.code.trim().length > 0, "sin código");
          assert.ok(violation.message.trim().length > 0, "sin mensaje");
          assert.ok(violation.remediation.trim().length > 0, "sin instrucción");
        }
      });
    });
  });
}

/** Relativa, con «/», sin salir de la raíz. */
function assertPortable(relativePath: string): void {
  assert.ok(relativePath.length > 0, "ruta vacía");
  assert.ok(!path.isAbsolute(relativePath) && !relativePath.startsWith("/"), `${relativePath} es absoluta`);
  assert.ok(!relativePath.includes("\\"), `${relativePath} usa «\\»`);
  assert.ok(!relativePath.split("/").includes(".."), `${relativePath} sale de la raíz`);
}
