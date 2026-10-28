import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { PythonAdapter } from "../adapters/python/pythonAdapter";
import { AdapterRegistry } from "../core/adapters";
import type { ArtifactSpec, ProjectModel, SymbolCandidate } from "../core/contracts";
import { artifactRelativePath } from "../core/project";
import { composeTemplate } from "../core/prompts";
import { formatCodeAnalysis } from "../agents/analysisText";
import { buildCodeAnalyzerSchema, type CodeAnalyzerOutput } from "../agents/codeAnalyzer";
import { createPythonFixture, type PythonFixture } from "./support/pythonFixture";

describe("adaptador de Python", () => {
  const adapter = new PythonAdapter();
  let fixture: PythonFixture;
  let project: ProjectModel;

  before(async () => {
    fixture = await createPythonFixture();
    project = await adapter.buildProjectModel(fixture.projectRoot);
  });

  after(async () => {
    await fixture.dispose();
  });

  async function locate(className: string, methodName: string): Promise<SymbolCandidate> {
    const location = await adapter.locateSymbol(project, { className, methodName });
    assert.ok(location.found, `no localiza ${className}.${methodName}`);
    return location.candidates[0];
  }

  async function specFor(className: string, methodName: string): Promise<ArtifactSpec> {
    return adapter.specifyArtifact({
      project,
      target: { className, methodName },
      targetLocation: await locate(className, methodName),
      modelId: "anthropic_claude-haiku-4-5",
    });
  }

  async function withFixture<T>(
    options: Parameters<typeof createPythonFixture>[0],
    use: (other: PythonFixture) => Promise<T>
  ): Promise<T> {
    const other = await createPythonFixture(options);
    try {
      return await use(other);
    } finally {
      await other.dispose();
    }
  }

  it("el registro lo acepta junto a sus capacidades", () => {
    assert.doesNotThrow(() => new AdapterRegistry().register(new PythonAdapter()));
  });

  it("declara la importabilidad como su verificación, y la ejecución y la cobertura", () => {
    assert.equal(adapter.capabilities.verification, "importCheck");
    assert.equal(adapter.capabilities.runTests, true);
    assert.equal(adapter.capabilities.coverage, true);
    assert.equal(adapter.capabilities.unitFacts, true);
    assert.equal(adapter.capabilities.moduleLevelUnits, true);
    assert.equal(typeof adapter.verifyArtifact, "function");
    assert.equal(typeof adapter.runTests, "function");
    assert.equal(typeof adapter.collectCoverage, "function");
  });

  describe("OP-02 · detección de aplicabilidad", () => {
    it("reconoce un proyecto con pyproject.toml y código", async () => {
      const result = await adapter.detectApplicability({
        rootPath: fixture.projectRoot,
        activeFile: { path: path.join(fixture.packageDir, "carrito.py"), languageId: "python" },
      });

      assert.equal(result.applicable, true);
      assert.equal(result.confidence, 0.9);
      assert.deepEqual(result.evidence.slice(0, 2), ["pyproject.toml", "archivos .py"]);
      assert.ok(result.evidence.some((marker) => marker.includes("carrito.py")));
    });

    it("con setup.py también, y con solo requirements.txt lo reclama con menos confianza", async () => {
      const setup = await withFixture({ marker: "setup.py" }, (other) =>
        adapter.detectApplicability({ rootPath: other.projectRoot })
      );
      const requirements = await withFixture({ marker: "requirements.txt" }, (other) =>
        adapter.detectApplicability({ rootPath: other.projectRoot })
      );

      assert.equal(setup.confidence, 0.9);
      assert.equal(setup.evidence[0], "setup.py");
      assert.equal(requirements.confidence, 0.8);
      assert.equal(requirements.evidence[0], "requirements.txt");
    });

    it("sin marcador, solo una carpeta con scripts en la raíz, y con la confianza más baja", async () => {
      const folder = await fsp.mkdtemp(path.join(os.tmpdir(), "python-scripts-"));
      try {
        await fsp.writeFile(path.join(folder, "calculadora.py"), "def sumar(a, b):\n    return a + b\n");
        const scripts = await adapter.detectApplicability({ rootPath: folder });
        assert.equal(scripts.applicable, true);
        assert.equal(scripts.confidence, 0.45);

        // Un .py metido en una subcarpeta, sin marcador, no alcanza.
        await fsp.rm(path.join(folder, "calculadora.py"));
        await fsp.mkdir(path.join(folder, "herramientas"));
        await fsp.writeFile(path.join(folder, "herramientas", "x.py"), "x = 1\n");
        assert.equal((await adapter.detectApplicability({ rootPath: folder })).applicable, false);
      } finally {
        await fsp.rm(folder, { recursive: true, force: true });
      }
    });

    it("un marcador sin ningún .py todavía lo reclama, con poca confianza", async () => {
      const folder = await fsp.mkdtemp(path.join(os.tmpdir(), "python-vacio-"));
      try {
        await fsp.writeFile(path.join(folder, "pyproject.toml"), "[project]\nname = 'x'\n");
        const result = await adapter.detectApplicability({ rootPath: folder });
        assert.equal(result.confidence, 0.5);
      } finally {
        await fsp.rm(folder, { recursive: true, force: true });
      }
    });
  });

  describe("OP-04 · modelo del proyecto", () => {
    it("trae los .py del proyecto y deja afuera entornos virtuales, cachés y lo que deja la construcción", () => {
      const paths = project.sources.map((source) => source.relativePath).sort();

      assert.deepEqual(paths, [
        "env/__init__.py",
        "env/config.py",
        "tests/test_existente.py",
        "tienda/__init__.py",
        "tienda/carrito.py",
        "tienda/cliente.py",
        "tienda/extra/__init__.py",
        "tienda/extra/utilidades.py",
        "tienda/modelo.py",
        "tienda/utilidades.py",
      ]);
    });

    it("clasifica las pruebas aparte y guarda la raíz de importación", () => {
      const test = project.sources.find((source) => source.relativePath === "tests/test_existente.py");
      assert.equal(test?.sourceRoot, "test");
      assert.deepEqual(project.sourceRoots, [
        { relativePath: ".", kind: "main" },
        { relativePath: "tests", kind: "test" },
      ]);
      assert.deepEqual(project.adapterData, { layout: "flat", importRoot: ".", testRoot: "tests" });
    });

    it("reconoce la forma con src/: el código cuelga de ahí y se importa sin esa carpeta", async () => {
      await withFixture({ layout: "src" }, async (other) => {
        const model = await adapter.buildProjectModel(other.projectRoot);

        assert.deepEqual(model.adapterData, { layout: "src", importRoot: "src", testRoot: "tests" });
        assert.ok(model.sources.some((source) => source.relativePath === "src/tienda/carrito.py"));
        // Fuera de src/ y de tests/ no es de ninguna de las dos.
        assert.equal(model.sources.find((source) => source.relativePath === "env/config.py")?.sourceRoot, null);
      });
    });

    it("declara la carpeta de pruebas aunque no exista, y usa test/ si es la que hay", async () => {
      await withFixture({}, async (other) => {
        await fsp.rm(other.testDir, { recursive: true });
        assert.equal((await adapter.buildProjectModel(other.projectRoot)).adapterData?.testRoot, "tests");

        await fsp.mkdir(path.join(other.projectRoot, "test"));
        assert.equal((await adapter.buildProjectModel(other.projectRoot)).adapterData?.testRoot, "test");
      });
    });
  });

  describe("OP-05 y OP-06 · localización y lectura", () => {
    it("encuentra el método de la clase, no la función de módulo ni la anidada con el mismo nombre", async () => {
      const location = await adapter.locateSymbol(project, { className: "Carrito", methodName: "agregar" });

      assert.ok(location.found);
      assert.deepEqual(location.candidates, [
        {
          filePath: "tienda/carrito.py",
          line: 22,
          column: 9,
          signature: "def agregar(self, item: Item, cantidad: int = 1) -> None",
        },
      ]);
    });

    it("el método de una clase anidada se pide por la clase anidada", async () => {
      const candidate = await locate("Linea", "agregar");
      assert.equal(candidate.line, 64);
    });

    it("una función definida dentro de un método no es un método de la clase", async () => {
      const location = await adapter.locateSymbol(project, { className: "Carrito", methodName: "validar" });
      assert.equal(location.found, false);
    });

    it("sin clase, encuentra la función de módulo", async () => {
      const location = await adapter.locateSymbol(project, { className: null, methodName: "agregar" });

      assert.ok(location.found);
      assert.deepEqual(
        location.candidates.map((candidate) => [candidate.filePath, candidate.line, candidate.signature]),
        [["tienda/carrito.py", 68, "def agregar(carrito, item)"]]
      );
    });

    it("si la clase no existe, lo dice, y avisa dónde está la función de módulo con ese nombre", async () => {
      const location = await adapter.locateSymbol(project, { className: "carrito", methodName: "agregar" });

      assert.equal(location.found, false);
      assert.match(!location.found ? location.reason : "", /clase "carrito"/);
      assert.match(
        !location.found ? location.reason : "",
        /función "agregar" fuera de toda clase en tienda\/carrito\.py: para probarla, dejá vacía la clase\./
      );
    });

    it("sin clase, de un archivo que la declara dos veces cuenta la última", async () => {
      await withFixture({}, async (other) => {
        const twice = "try:\n    import ujson\n\n    def cargar(x):\n        return ujson.loads(x)\nexcept ImportError:\n    def cargar(x):\n        return x\n";
        await fsp.writeFile(path.join(other.packageDir, "carga.py"), twice, "utf8");
        const model = await adapter.buildProjectModel(other.projectRoot);
        const location = await adapter.locateSymbol(model, { className: null, methodName: "cargar" });

        assert.ok(location.found);
        assert.deepEqual(
          location.candidates.map((candidate) => [candidate.filePath, candidate.line]),
          [["tienda/carga.py", 7]]
        );
      });
    });

    it("si la función de módulo está en muchos archivos, como main, nombra solo algunos", async () => {
      await withFixture({}, async (other) => {
        for (const name of ["a", "b", "c", "d"]) {
          await fsp.writeFile(path.join(other.packageDir, `${name}.py`), "def agregar(x):\n    return x\n", "utf8");
        }
        const model = await adapter.buildProjectModel(other.projectRoot);
        const location = await adapter.locateSymbol(model, { className: "Nada", methodName: "agregar" });

        assert.match(!location.found ? location.reason : "", /en tienda\/a\.py, tienda\/b\.py, tienda\/c\.py y 2 más:/);
      });
    });

    it("no encuentra lo que solo se invoca, ni lo que dicen los textos y los comentarios", async () => {
      const invoked = await adapter.locateSymbol(project, { className: "Cliente", methodName: "agregar" });
      const inText = await adapter.locateSymbol(project, { className: "Falsa", methodName: "agregar" });

      assert.equal(invoked.found, false);
      assert.match(!invoked.found ? invoked.reason : "", /método "agregar" dentro de "Cliente"/);
      assert.equal(inText.found, false);
    });

    it("un método con los parámetros en varias líneas, y la firma con los espacios colapsados", async () => {
      const candidate = await locate("Carrito", "vaciar");
      assert.equal(candidate.signature, 'def vaciar(self, confirmar=True, motivo=("a", "b"))');
    });

    it("lee el archivo entero de la declaración", async () => {
      const source = await adapter.readSource(project, await locate("Carrito", "agregar"));

      assert.equal(source.filePath, "tienda/carrito.py");
      assert.ok(source.content.includes("class Carrito:"));
      assert.ok(source.content.includes("def agregar(carrito, item):"));
    });
  });

  describe("OP-07 · resolución de dependencias", () => {
    for (const reference of ["tienda.modelo.Item", "tienda.modelo", "tienda/modelo.py", "Item", ".modelo", "modelo"]) {
      it(`traduce «${reference}» a tienda/modelo.py`, async () => {
        const resolution = await adapter.resolveDependency(project, reference);
        assert.ok(resolution.resolved, JSON.stringify(resolution));
        assert.equal(resolution.relativePath, "tienda/modelo.py");
      });
    }

    it("un paquete es su __init__.py", async () => {
      const resolution = await adapter.resolveDependency(project, "tienda.extra");
      assert.ok(resolution.resolved);
      assert.equal(resolution.relativePath, "tienda/extra/__init__.py");
    });

    it("con la forma con src/, el nombre con puntos no lleva src", async () => {
      await withFixture({ layout: "src" }, async (other) => {
        const model = await adapter.buildProjectModel(other.projectRoot);
        const resolution = await adapter.resolveDependency(model, "tienda.modelo.Item");
        assert.ok(resolution.resolved);
        assert.equal(resolution.relativePath, "src/tienda/modelo.py");
      });
    });

    it("si el nombre a secas está en dos módulos, no elige: devuelve los dos", async () => {
      for (const reference of ["utilidades", "Utilidades"]) {
        const resolution = await adapter.resolveDependency(project, reference);
        assert.equal(resolution.resolved, false, reference);
        assert.deepEqual(
          !resolution.resolved ? [...resolution.triedPaths].sort() : [],
          ["tienda/extra/utilidades.py", "tienda/utilidades.py"]
        );
      }
    });

    it("lo que no está en el modelo no se resuelve, aunque esté en el disco", async () => {
      const resolution = await adapter.resolveDependency(project, ".venv/Lib/site-packages/fantasma.py");
      assert.equal(resolution.resolved, false);
    });
  });

  describe("OP-08 y OP-09 · perfil y esquema del análisis", () => {
    it("el vocabulario es de Python y de pytest, y las plantillas se componen sin marcadores", async () => {
      const profile = adapter.getPromptProfile(project);
      assert.equal(profile.vocabulary.language, "Python");
      assert.equal(profile.vocabulary.testFramework, "pytest");

      const template = await fsp.readFile(path.resolve(__dirname, "..", "prompts", "testGeneratorPrompt.txt"), "utf8");
      const composed = composeTemplate(template, profile);
      assert.ok(!composed.includes("{{"), "quedó un marcador sin componer");
      assert.match(composed, /MINIMUM number of pytest test methods/);
      assert.match(composed, /Import it in the test exactly like this/);
    });

    it("con clase el perfil es el de siempre; sin clase cambia solo las instrucciones que son de una clase", () => {
      const always = adapter.getPromptProfile(project);
      const method = adapter.getPromptProfile(project, { className: "Carrito", methodName: "agregar" });
      const free = adapter.getPromptProfile(project, { className: null, methodName: "agregar" });

      assert.deepEqual(method, always);
      assert.deepEqual(free.vocabulary, always.vocabulary);
      assert.deepEqual(Object.keys(free.fragments).sort(), Object.keys(always.fragments).sort());
      const changed = Object.entries(free.fragments)
        .filter(([point, text]) => text !== always.fragments[point as keyof typeof always.fragments])
        .map(([point]) => point)
        .sort();
      assert.deepEqual(changed, [
        "analyzerDefaultVisibility",
        "analyzerLifecycleFields",
        "analyzerNamespaces",
        "analyzerPrivateMemberKinds",
        "fixerImports",
        "generatorInstantiationCheck",
        "generatorLifecycleFields",
        "generatorNamespaceStep",
        "generatorPreFlightItems",
        "generatorTestClassRules",
        "validatorComputedProperties",
        "validatorImports",
      ]);
      for (const point of changed) {
        const text = free.fragments[point as keyof typeof free.fragments] ?? "";
        assert.ok(!text.includes("<class-name>"), `${point} pide la clase`);
        assert.ok(!text.includes("CLASS FACTS"), `${point} nombra la ficha de una clase`);
      }
    });

    it("el analizador tampoco sugiere una clase auxiliar con un nombre que empiece con Test", async () => {
      // En la primera prueba con Ctrl+F5 sugirió `class TestPet(Pet)`, y el generador lo copió.
      const template = await fsp.readFile(path.resolve(__dirname, "..", "prompts", "codeAnalyzerPrompt.txt"), "utf8");
      const composed = composeTemplate(template, adapter.getPromptProfile(project));

      assert.match(composed, /A helper class that the test defines must NOT have a name that starts with Test/);
      assert.match(composed, /class _ConcretePet\(Pet\)/);
    });

    it("el esquema conserva lo que calcula el analizador para Python, y se lo presenta al generador", () => {
      const extension = adapter.extendAnalysisSchema();
      const schema = buildCodeAnalyzerSchema(extension.fields);
      const analysis = {
        status: "READY",
        methodSummary: { name: "con_cupon", inputs: [], output: "int" },
        dependencies: [],
        decisionTable: [],
        loops: [],
        sideEffects: [],
        lateAttributes: [{ name: "cupon", setBy: "outside the class", notes: "assign an int" }],
        patchTargets: [{ call: "random.randint(1, 6)", target: "tienda.dado.randint" }],
        requiredImports: ["tienda.modelo.Item", "from tienda.carrito import Carrito"],
        untestableBranches: [{ condition: "os._exit(1)", reason: "kills the test process" }],
        preFlightChecklist: {
          typeInstantiations: [
            {
              typeName: "Carrito",
              pattern: "direct",
              constructorSignature: "__init__(self, items=None, *, descuento=0)",
              parameterless: false,
              constructorNotes: "",
              reason: "regular class",
            },
            { typeName: "Forma", pattern: "subclass", constructorSignature: null, parameterless: false, constructorNotes: "", reason: "abstract class" },
            { typeName: "Estado", pattern: "member", constructorSignature: null, parameterless: false, constructorNotes: "", reason: "enum" },
          ],
          computedProperties: [{ propertyName: "total", getterSummary: "sums prices", controlVia: "self.items" }],
        },
      };

      const parsed = schema.parse(analysis) as CodeAnalyzerOutput;
      const text = formatCodeAnalysis(parsed, extension.format);

      assert.match(text, /self\.cupon \[created by outside the class\] — assign an int/);
      assert.match(text, /random\.randint\(1, 6\) → monkeypatch\.setattr\("tienda\.dado\.randint", \.\.\.\)/);
      assert.match(text, /from tienda\.modelo import Item/);
      assert.match(text, /from tienda\.carrito import Carrito/);
      assert.match(text, /SKIP: os\._exit\(1\)/);
      assert.match(text, /Carrito → Carrito\(items=None, \*, descuento=0\)/);
      assert.match(text, /Forma → helper subclass/);
      assert.match(text, /Estado → an Enum member \(Estado\.MEMBER\)/);
      assert.match(text, /Computed Properties[\s\S]*Control via: self\.items/);
      assert.match(text, /Only the CLASS FACTS block outranks it/);
      // Con la clase escrita, la presentación es la de siempre.
      assert.equal(formatCodeAnalysis(parsed, adapter.extendAnalysisSchema({ className: "Carrito", methodName: "con_cupon" }).format), text);
    });

    it("sin clase, el análisis presenta el estado del módulo y la ficha de la función", () => {
      const extension = adapter.extendAnalysisSchema({ className: null, methodName: "naturalsize" });
      const parsed = buildCodeAnalyzerSchema(extension.fields).parse({
        status: "READY",
        methodSummary: { name: "naturalsize", inputs: [], output: "str" },
        dependencies: [],
        decisionTable: [],
        loops: [],
        sideEffects: [],
        lateAttributes: [{ name: "suffixes", setBy: "module level", notes: "monkeypatch.setattr(humanize.filesize, 'suffixes', ...)" }],
        preFlightChecklist: { typeInstantiations: [], computedProperties: [] },
      }) as CodeAnalyzerOutput;

      const text = formatCodeAnalysis(parsed, extension.format);

      assert.match(text, /Module-level state \(shared by every test[^\n]*\n {2}suffixes \[module level\] — monkeypatch/);
      assert.ok(!text.includes("self."), text);
      assert.match(text, /Only the FUNCTION FACTS block outranks it/);
    });
  });

  describe("OP-10, OP-11 y OP-12 · materialización", () => {
    it("la prueba va en tests/, con el nombre común más _test", async () => {
      const spec = await specFor("Carrito", "agregar");

      assert.deepEqual(spec, {
        directory: "tests",
        fileName: "UTIA_anthropic_claude_haiku_4_5_Carrito_agregar_test",
        extension: ".py",
        unitName: "UTIA_anthropic_claude_haiku_4_5_Carrito_agregar_test",
      });
      assert.equal(artifactRelativePath(spec), "tests/UTIA_anthropic_claude_haiku_4_5_Carrito_agregar_test.py");
    });

    it("un modelo con punto y dos puntos en el nombre da un archivo que pytest puede importar", async () => {
      const spec = adapter.specifyArtifact({
        project,
        target: { className: "Carrito", methodName: "agregar" },
        targetLocation: await locate("Carrito", "agregar"),
        modelId: "ollama/qwen2.5:14b",
      });
      assert.match(spec.fileName, /^[A-Za-z_][A-Za-z0-9_]*$/);
    });

    it("quita el cercado de markdown, y normalizar dos veces da lo mismo", async () => {
      const spec = await specFor("Carrito", "agregar");
      const once = adapter.normalizeGeneratedCode("```python\nimport pytest\n\ndef test_a():\n    assert 1 == 1\n```", spec);

      assert.equal(once, "import pytest\n\ndef test_a():\n    assert 1 == 1");
      assert.equal(adapter.normalizeGeneratedCode(once, spec), once);
    });

    it("sin la carpeta de pruebas, dice cuál crear", async () => {
      await withFixture({}, async (other) => {
        await fsp.rm(other.testDir, { recursive: true });
        const model = await adapter.buildProjectModel(other.projectRoot);
        const location = await adapter.locateSymbol(model, { className: "Carrito", methodName: "agregar" });
        assert.ok(location.found);
        const spec = adapter.specifyArtifact({
          project: model,
          target: { className: "Carrito", methodName: "agregar" },
          targetLocation: location.candidates[0],
          modelId: "m",
        });

        const violations = await adapter.checkPreconditions(model, spec);
        assert.equal(violations.length, 1);
        assert.equal(violations[0].code, "python.test-directory-missing");
        assert.match(violations[0].remediation, /Creá la carpeta "tests"/);
      });
    });
  });
});
