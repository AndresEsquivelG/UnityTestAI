import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as path from "path";
import { JavaAdapter } from "../adapters/java/javaAdapter";
import { AdapterRegistry } from "../core/adapters";
import type { ArtifactSpec, ProjectModel, SymbolCandidate } from "../core/contracts";
import { artifactRelativePath } from "../core/project";
import { formatCodeAnalysis } from "../agents/analysisText";
import { buildCodeAnalyzerSchema, type CodeAnalyzerOutput } from "../agents/codeAnalyzer";
import { createJavaFixture, type JavaFixture } from "./support/javaFixture";

describe("adaptador de Java", () => {
  const adapter = new JavaAdapter();
  let fixture: JavaFixture;
  let project: ProjectModel;

  before(async () => {
    fixture = await createJavaFixture();
    project = await adapter.buildProjectModel(fixture.projectRoot);
  });

  after(async () => {
    await fixture.dispose();
  });

  /** Primera declaración de una unidad que el proyecto de ejemplo declara. */
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
      modelId: "claude",
    });
  }

  it("el registro lo acepta junto a sus capacidades", () => {
    assert.doesNotThrow(() => new AdapterRegistry().register(new JavaAdapter()));
  });

  describe("OP-02 · detección de aplicabilidad", () => {
    it("reconoce un proyecto Maven con fuentes", async () => {
      const result = await adapter.detectApplicability({
        rootPath: fixture.projectRoot,
        activeFile: {
          path: path.join(fixture.projectRoot, "src", "main", "java", "com", "tienda", "Carrito.java"),
          languageId: "java",
        },
      });

      assert.equal(result.applicable, true);
      assert.equal(result.confidence, 0.95);
      assert.deepEqual(result.evidence.slice(0, 2), ["pom.xml", "src/main/java/"]);
      assert.ok(result.evidence.some((marker) => marker.includes("Carrito.java")));
    });

    for (const descriptor of ["build.gradle", "build.gradle.kts"] as const) {
      it(`reconoce un proyecto Gradle con ${descriptor}`, async () => {
        const gradle = await createJavaFixture({ descriptor });
        try {
          const result = await adapter.detectApplicability({ rootPath: gradle.projectRoot });
          assert.equal(result.applicable, true);
          assert.equal(result.evidence[0], descriptor);
        } finally {
          await gradle.dispose();
        }
      });
    }

    it("con la jerarquía principal vacía lo reclama con menos confianza", async () => {
      const empty = await createJavaFixture();
      try {
        await fsp.rm(path.join(empty.projectRoot, "src", "main", "java", "com"), { recursive: true });
        const result = await adapter.detectApplicability({ rootPath: empty.projectRoot });
        assert.equal(result.applicable, true);
        assert.equal(result.confidence, 0.8);
      } finally {
        await empty.dispose();
      }
    });

    it("reclama fuentes sin descriptor de Maven ni de Gradle, con menos confianza", async () => {
      const bare = await createJavaFixture({ descriptor: null });
      try {
        const withoutDescriptor = await adapter.detectApplicability({ rootPath: bare.projectRoot });
        assert.deepEqual(withoutDescriptor, { applicable: true, confidence: 0.7, evidence: ["src/main/java/"] });

        await fsp.writeFile(path.join(bare.projectRoot, "build.xml"), "<project/>", "utf8");
        const ant = await adapter.detectApplicability({ rootPath: bare.projectRoot });
        assert.deepEqual(ant, { applicable: true, confidence: 0.7, evidence: ["build.xml", "src/main/java/"] });
        const model = await adapter.buildProjectModel(bare.projectRoot);
        assert.deepEqual(model.adapterData, { buildTool: "ant", buildFile: "build.xml" });
      } finally {
        await bare.dispose();
      }
    });

    it("no reclama src/main/java vacía sin descriptor, ni un descriptor sin src/main/java", async () => {
      const bare = await createJavaFixture({ descriptor: null });
      try {
        await fsp.rm(path.join(bare.projectRoot, "src", "main", "java"), { recursive: true });
        await fsp.mkdir(path.join(bare.projectRoot, "src", "main", "java"));
        const empty = await adapter.detectApplicability({ rootPath: bare.projectRoot });
        assert.deepEqual(empty, { applicable: false, confidence: 0, evidence: [] });

        await fsp.writeFile(path.join(bare.projectRoot, "pom.xml"), "<project/>", "utf8");
        await fsp.rm(path.join(bare.projectRoot, "src", "main"), { recursive: true });
        const aggregator = await adapter.detectApplicability({ rootPath: bare.projectRoot });
        assert.equal(aggregator.applicable, false);
      } finally {
        await bare.dispose();
      }
    });
  });

  describe("OP-04 · modelo del proyecto", () => {
    it("recoge las fuentes de las dos jerarquías, sin package-info ni target", () => {
      const paths = project.sources.map((source) => source.relativePath).sort();

      assert.deepEqual(paths, [
        "src/main/java/com/tienda/Carrito.java",
        "src/main/java/com/tienda/Cliente.java",
        "src/main/java/com/tienda/Utilidades.java",
        "src/main/java/com/tienda/modelo/Item.java",
        "src/main/java/com/tienda/modelo/Pedido.java",
        "src/main/java/com/tienda/modelo/Utilidades.java",
      ]);
    });

    it("declara la jerarquía principal y la de pruebas", () => {
      assert.deepEqual(
        project.sourceRoots.map((root) => `${root.kind}:${root.relativePath}`),
        ["main:src/main/java", "test:src/test/java"]
      );
    });

    it("recuerda la herramienta de construcción para las operaciones siguientes", async () => {
      assert.equal(project.adapterData?.buildTool, "maven");

      const gradle = await createJavaFixture({ descriptor: "build.gradle.kts" });
      try {
        const model = await adapter.buildProjectModel(gradle.projectRoot);
        assert.equal(model.adapterData?.buildTool, "gradle");
      } finally {
        await gradle.dispose();
      }
    });

    it("marca como prueba lo que está en src/test/java", async () => {
      const testFile = path.join(fixture.testPackageDir, "CarritoTest.java");
      await fsp.writeFile(testFile, "package com.tienda;\n\nclass CarritoTest { }\n", "utf8");
      try {
        const model = await adapter.buildProjectModel(fixture.projectRoot);
        const source = model.sources.find((s) => s.name === "CarritoTest.java");
        assert.equal(source?.sourceRoot, "test");
        assert.equal(source?.relativePath, "src/test/java/com/tienda/CarritoTest.java");
      } finally {
        await fsp.rm(testFile);
      }
    });
  });

  describe("OP-05 y OP-06 · localización y lectura", () => {
    it("devuelve una candidata por cada sobrecarga, sin las falsas", async () => {
      const location = await adapter.locateSymbol(project, { className: "Carrito", methodName: "agregar" });

      assert.ok(location.found);
      assert.deepEqual(
        location.candidates.map((candidate) => candidate.signature),
        ["public void agregar(Item item)", "public void agregar(Item item, int cantidad)"]
      );
      assert.ok(location.candidates.every((c) => c.filePath === "src/main/java/com/tienda/Carrito.java"));
    });

    it("encuentra el método de una clase anidada por su nombre", async () => {
      const candidate = await locate("Linea", "agregar");
      assert.equal(candidate.signature, "void agregar(Item item)");
    });

    it("no toma por declaración una invocación", async () => {
      const location = await adapter.locateSymbol(project, { className: "Cliente", methodName: "agregar" });

      assert.equal(location.found, false);
      assert.match(!location.found ? location.reason : "", /agregar[\s\S]*Cliente/);
    });

    it("distingue la clase que no existe del método que la clase no declara", async () => {
      const noClass = await adapter.locateSymbol(project, { className: "Fantasma", methodName: "agregar" });
      const noMethod = await adapter.locateSymbol(project, { className: "Carrito", methodName: "quitar" });

      assert.match(!noClass.found ? noClass.reason : "", /"Fantasma"/);
      assert.match(!noMethod.found ? noMethod.reason : "", /"quitar" dentro de "Carrito"/);
    });

    it("lee el archivo de la declaración elegida", async () => {
      const candidate = await locate("Carrito", "mayor");
      const source = await adapter.readSource(project, candidate);

      assert.equal(source.filePath, "src/main/java/com/tienda/Carrito.java");
      assert.ok(source.content.includes(candidate.signature));
    });
  });

  describe("OP-07 · resolución de dependencias", () => {
    async function resolvedPath(reference: string): Promise<string | null> {
      const resolution = await adapter.resolveDependency(project, reference);
      return resolution.resolved ? resolution.relativePath : null;
    }

    it("traduce un nombre calificado a su archivo", async () => {
      assert.equal(await resolvedPath("com.tienda.modelo.Item"), "src/main/java/com/tienda/modelo/Item.java");
    });

    it("un tipo anidado está en el archivo de su tipo exterior", async () => {
      assert.equal(await resolvedPath("com.tienda.modelo.Pedido.Estado"), "src/main/java/com/tienda/modelo/Pedido.java");
      // Utilidades está en dos paquetes: solo el nombre calificado dice cuál.
      assert.equal(
        await resolvedPath("com.tienda.modelo.Utilidades.Interna"),
        "src/main/java/com/tienda/modelo/Utilidades.java"
      );
    });

    it("acepta la ruta del árbol, la ruta sin raíz y el nombre a secas", async () => {
      assert.equal(await resolvedPath("src/main/java/com/tienda/Cliente.java"), "src/main/java/com/tienda/Cliente.java");
      assert.equal(await resolvedPath("com/tienda/Cliente.java"), "src/main/java/com/tienda/Cliente.java");
      assert.equal(await resolvedPath("Item"), "src/main/java/com/tienda/modelo/Item.java");
      assert.equal(await resolvedPath("Item[]"), "src/main/java/com/tienda/modelo/Item.java");
      assert.equal(await resolvedPath("Pedido<Item>"), "src/main/java/com/tienda/modelo/Pedido.java");
    });

    it("ante un nombre que está en dos paquetes, no elige: devuelve las dos rutas", async () => {
      const resolution = await adapter.resolveDependency(project, "Utilidades");

      assert.equal(resolution.resolved, false);
      assert.deepEqual(!resolution.resolved ? [...resolution.triedPaths].sort() : [], [
        "src/main/java/com/tienda/Utilidades.java",
        "src/main/java/com/tienda/modelo/Utilidades.java",
      ]);
    });

    it("ante un paquete que no existe, dice qué rutas probó", async () => {
      const resolution = await adapter.resolveDependency(project, "com.otra.Cosa");

      assert.equal(resolution.resolved, false);
      assert.ok(!resolution.resolved && resolution.triedPaths.includes("src/main/java/com/otra/Cosa.java"));
    });
  });

  describe("OP-10 · especificación del artefacto", () => {
    it("replica el paquete de la clase en la jerarquía de pruebas", async () => {
      const spec = await specFor("Carrito", "agregar");

      assert.equal(spec.directory, "src/test/java/com/tienda");
      assert.equal(artifactRelativePath(spec), "src/test/java/com/tienda/UTIA_claude_Carrito_agregar_Test.java");
    });

    it("el nombre es la base común con _Test al final, y la clase se llama igual", () => {
      const spec = adapter.specifyArtifact({
        project,
        target: { className: "Item", methodName: "precio" },
        targetLocation: { filePath: "src/main/java/com/tienda/modelo/Item.java", line: 3, column: 1, signature: "" },
        modelId: "llama local",
      });

      assert.equal(spec.fileName, "UTIA_llama_local_Item_precio_Test");
      assert.equal(spec.unitName, spec.fileName);
      assert.equal(spec.directory, "src/test/java/com/tienda/modelo");
      assert.ok(/Test$/.test(spec.fileName), "Maven solo ejecuta clases que terminan en Test");
    });

    it("una clase del paquete por omisión va a la raíz de pruebas", () => {
      const spec = adapter.specifyArtifact({
        project,
        target: { className: "Suelta", methodName: "correr" },
        targetLocation: { filePath: "src/main/java/Suelta.java", line: 1, column: 1, signature: "" },
        modelId: "claude",
      });

      assert.equal(spec.directory, "src/test/java");
    });
  });

  describe("OP-11 · normalización", () => {
    const generated = [
      "```java",
      "package com.otro;",
      "",
      "import org.junit.jupiter.api.Test;",
      "",
      "class Test_Carrito_agregar {",
      "    Test_Carrito_agregar() { }",
      "",
      "    @Test",
      '    void agrega() { String s = "Test_Carrito_agregar()"; }',
      "}",
      "```",
    ].join("\n");

    it("quita el cercado, renombra la clase y sus constructores, y pone el paquete de la carpeta", async () => {
      const spec = await specFor("Carrito", "agregar");
      const normalized = adapter.normalizeGeneratedCode(generated, spec);

      assert.equal(
        normalized,
        [
          "package com.tienda;",
          "",
          "import org.junit.jupiter.api.Test;",
          "",
          "class UTIA_claude_Carrito_agregar_Test {",
          "    UTIA_claude_Carrito_agregar_Test() { }",
          "",
          "    @Test",
          '    void agrega() { String s = "Test_Carrito_agregar()"; }',
          "}",
        ].join("\n")
      );
    });

    it("agrega la línea package si el modelo la omitió", async () => {
      const spec = await specFor("Carrito", "agregar");
      const normalized = adapter.normalizeGeneratedCode("class X {\n}", spec);

      assert.equal(normalized, "package com.tienda;\n\nclass UTIA_claude_Carrito_agregar_Test {\n}");
    });

    it("normalizar dos veces da lo mismo que una", async () => {
      const spec = await specFor("Carrito", "agregar");
      const once = adapter.normalizeGeneratedCode(generated, spec);

      assert.equal(adapter.normalizeGeneratedCode(once, spec), once);
    });
  });

  describe("OP-12 · precondiciones", () => {
    it("sin incumplimientos cuando la carpeta del paquete existe", async () => {
      assert.deepEqual(await adapter.checkPreconditions(project, await specFor("Carrito", "agregar")), []);
    });

    it("si la carpeta del paquete falta, dice cuál crear", async () => {
      const spec = adapter.specifyArtifact({
        project,
        target: { className: "Pedido", methodName: "pagar" },
        targetLocation: { filePath: "src/main/java/com/tienda/modelo/Pedido.java", line: 3, column: 1, signature: "" },
        modelId: "claude",
      });
      const [violation, ...rest] = await adapter.checkPreconditions(project, spec);

      assert.deepEqual(rest, []);
      assert.equal(violation.code, "java.test-package-directory-missing");
      assert.match(violation.remediation, /src\/test\/java\/com\/tienda\/modelo/);
    });
  });

  describe("OP-08 · perfil de prompt", () => {
    it("nombra la herramienta de construcción del proyecto", async () => {
      assert.equal(adapter.getPromptProfile(project).vocabulary.ecosystem, "Maven");

      const gradle = await createJavaFixture({ descriptor: "build.gradle" });
      try {
        const model = await adapter.buildProjectModel(gradle.projectRoot);
        assert.equal(adapter.getPromptProfile(model).vocabulary.ecosystem, "Gradle");
      } finally {
        await gradle.dispose();
      }

      const bare = await createJavaFixture({ descriptor: null });
      try {
        const none = await adapter.buildProjectModel(bare.projectRoot);
        assert.equal(adapter.getPromptProfile(none).vocabulary.ecosystem, "Java");
        await fsp.writeFile(path.join(bare.projectRoot, "MODULE.bazel"), "", "utf8");
        const bazel = await adapter.buildProjectModel(bare.projectRoot);
        assert.equal(adapter.getPromptProfile(bazel).vocabulary.ecosystem, "Bazel");
      } finally {
        await bare.dispose();
      }
    });

    it("trae los 74 fragmentos, ninguno vacío", () => {
      const fragments = Object.values(adapter.getPromptProfile(project).fragments);

      assert.equal(fragments.length, 74);
      assert.ok(fragments.every((fragment) => typeof fragment === "string" && fragment.trim().length > 0));
    });
  });

  describe("OP-09 · extensión del esquema de análisis", () => {
    const extension = adapter.extendAnalysisSchema();

    const response = {
      status: "READY",
      methodSummary: { name: "agregar", inputs: [{ name: "item", type: "Item" }], output: "void" },
      dependencies: [],
      decisionTable: [],
      loops: [],
      sideEffects: [],
      injectedFields: [{ name: "repositorio", type: "Repositorio", initBy: "@Autowired" }],
      requiredImports: ["com.tienda.modelo.Item"],
      untestableBranches: [{ condition: "System.getenv(\"X\") != null", reason: "lo fija la máquina" }],
      preFlightChecklist: {
        typeInstantiations: [
          {
            typeName: "Carrito",
            pattern: "new",
            constructorSignature: null,
            parameterless: true,
            constructorNotes: "",
            reason: "concrete class",
          },
          {
            typeName: "Pasarela",
            pattern: "subclass",
            constructorSignature: null,
            parameterless: false,
            constructorNotes: "",
            reason: "interface",
          },
        ],
        computedProperties: [{ propertyName: "getTotal()", getterSummary: "suma items", controlVia: "items" }],
      },
    };

    it("conserva los campos de Java al validar la respuesta", () => {
      const parsed = buildCodeAnalyzerSchema(extension.fields).parse(response) as Record<string, unknown>;

      assert.deepEqual(parsed.requiredImports, ["com.tienda.modelo.Item"]);
      assert.ok(parsed.preFlightChecklist);
      assert.ok(parsed.injectedFields);
    });

    it("sin la extensión, el esquema común los descartaría", () => {
      const parsed = buildCodeAnalyzerSchema().parse(response) as Record<string, unknown>;

      assert.equal(parsed.preFlightChecklist, undefined);
      assert.equal(parsed.requiredImports, undefined);
    });

    it("los presenta al generador en términos de Java", () => {
      const parsed = buildCodeAnalyzerSchema(extension.fields).parse(response) as CodeAnalyzerOutput;
      const text = formatCodeAnalysis(parsed, extension.format);

      assert.match(text, /Repositorio repositorio \[@Autowired\]/);
      assert.match(text, /import com\.tienda\.modelo\.Item;/);
      assert.match(text, /SKIP: System\.getenv/);
      assert.match(text, /PRE-FLIGHT CHECKLIST/);
      assert.match(text, /Carrito → new Carrito\(\)/);
      assert.match(text, /Pasarela → lambda or anonymous class/);
      assert.match(text, /getTotal\(\): suma items/);
    });
  });
});
