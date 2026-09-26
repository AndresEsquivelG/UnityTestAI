import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as path from "path";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import { declaredTypeNames } from "../adapters/unity/dependencies";
import type { ProjectModel, SymbolCandidate } from "../core/contracts";
import { createUnityFixture, type UnityFixture } from "./support/unityFixture";

describe("adaptador de Unity", () => {
  const adapter = new UnityAdapter();
  let fixture: UnityFixture;
  let project: ProjectModel;

  before(async () => {
    fixture = await createUnityFixture();
    project = await adapter.buildProjectModel(fixture.projectRoot);
  });

  after(async () => {
    await fixture.dispose();
  });

  describe("OP-02 · detección de aplicabilidad", () => {
    it("reconoce el proyecto desde su raíz", async () => {
      const result = await adapter.detectApplicability({ rootPath: fixture.projectRoot });

      assert.equal(result.applicable, true);
      assert.equal(result.confidence, 0.95);
      assert.ok(result.evidence.includes("ProjectSettings/ProjectVersion.txt"));
    });

    it("lo reconoce también con la carpeta Assets abierta", async () => {
      const result = await adapter.detectApplicability({
        rootPath: fixture.assetsDir,
        activeFile: {
          path: path.join(fixture.assetsDir, "Scripts", "Player.cs"),
          languageId: "csharp",
        },
      });

      assert.equal(result.applicable, true);
      assert.ok(result.evidence.some((marker) => marker.includes("archivo abierto")));
    });

    it("no reclama un proyecto ajeno", async () => {
      const result = await adapter.detectApplicability({
        rootPath: path.join(fixture.projectRoot, "ProjectSettings"),
      });

      assert.deepEqual(result, { applicable: false, confidence: 0, evidence: [] });
    });
  });

  describe("OP-04 · modelo del proyecto", () => {
    it("recoge las fuentes con rutas relativas a la raíz", () => {
      const paths = project.sources.map((source) => source.relativePath).sort();

      assert.deepEqual(paths, ["Assets/Scripts/Enemy.cs", "Assets/Scripts/Player.cs"]);
    });

    it("excluye las carpetas que genera el editor", () => {
      const paths = project.sources.map((source) => source.relativePath);

      assert.ok(!paths.some((relative) => relative.includes("/obj/") || relative.includes("Library")));
    });

    it("declara la jerarquía principal y la de pruebas", () => {
      assert.deepEqual(
        project.sourceRoots.map((root) => `${root.kind}:${root.relativePath}`),
        ["main:Assets", "test:Assets/Tests"]
      );
    });

    it("conserva la versión del editor para las operaciones siguientes", () => {
      assert.equal(project.adapterData?.unityVersion, "6000.0.23f1");
    });

    it("ancla el modelo en la raíz aunque se abra la carpeta Assets", async () => {
      const opened = await adapter.buildProjectModel(fixture.assetsDir);

      assert.equal(opened.rootPath, project.rootPath);
      assert.equal(opened.sources.length, project.sources.length);
    });
  });

  describe("OP-05 · localización de la unidad", () => {
    it("devuelve una candidata por cada sobrecarga", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Player",
        methodName: "Move",
      });

      assert.equal(location.found, true);
      assert.equal(location.candidates.length, 2);
      assert.deepEqual(
        location.candidates.map((candidate) => candidate.signature),
        ["public void Move(float distance)", "public void Move(float distance, bool sprint)"]
      );
    });

    it("no confunde una función local con un miembro de la clase", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Player",
        methodName: "Move",
      });

      assert.equal(location.found, true);
      assert.ok(location.candidates.every((candidate) => !candidate.signature.includes("int local")));
    });

    it("no toma por declaración una invocación", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Enemy",
        methodName: "Move",
      });

      assert.equal(location.found, false);
      assert.match(location.reason, /Move/);
      assert.match(location.reason, /Enemy/);
    });

    it("distingue la clase que no existe", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Fantasma",
        methodName: "Move",
      });

      assert.equal(location.found, false);
      assert.match(location.reason, /Fantasma/);
    });

    it("distingue el método que la clase no declara", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Player",
        methodName: "Teleport",
      });

      assert.equal(location.found, false);
      assert.match(location.reason, /Teleport/);
      assert.match(location.reason, /Player/);
    });

    it("encuentra un método de cuerpo de expresión", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Player",
        methodName: "IsFast",
      });

      assert.equal(location.found, true);
      assert.equal(location.candidates[0].signature, "private bool IsFast()");
    });
  });

  describe("OP-06 · lectura del código fuente", () => {
    it("lee el archivo donde está la declaración", async () => {
      const location = await adapter.locateSymbol(project, {
        className: "Player",
        methodName: "Move",
      });
      assert.equal(location.found, true);

      const source = await adapter.readSource(project, location.candidates[0]);

      assert.equal(source.filePath, "Assets/Scripts/Player.cs");
      assert.ok(source.content.includes("class Player"));
    });
  });

  describe("OP-07 · resolución de dependencias", () => {
    for (const reference of ["Assets/Scripts/Enemy.cs", "Scripts/Enemy.cs", "Enemy"]) {
      it(`resuelve la referencia "${reference}"`, async () => {
        const resolution = await adapter.resolveDependency(project, reference);

        assert.equal(resolution.resolved, true);
        assert.equal(resolution.relativePath, "Assets/Scripts/Enemy.cs");
        assert.ok(resolution.content.includes("class Enemy"));
      });
    }

    it("informa las rutas que intentó cuando no resuelve", async () => {
      const resolution = await adapter.resolveDependency(project, "Assets/Scripts/NoExiste.cs");

      assert.equal(resolution.resolved, false);
      assert.ok(resolution.triedPaths.length > 0);
    });
  });

  describe("OP-17 · detección de dependencias", () => {
    it("detecta el tipo de un parámetro cuyos miembros usa el método", async () => {
      // El caso que el agente resolutor omitió con qwen2.5:14b y con Haiku.
      const slice = `using UnityEngine;

public static class Utilities
{
    public static bool AreNeighbors(Player s1, Player s2)
    {
        return Mathf.Abs(s1.Column - s2.Column) <= 1;
    }
}`;

      assert.deepEqual(await adapter.detectDependencies(project, slice), [
        "Assets/Scripts/Player.cs",
      ]);
    });

    it("no devuelve el archivo del tipo que el propio código declara", async () => {
      const slice = `public class Enemy : MonoBehaviour
{
    private Player target;

    public void Chase()
    {
        target.Move(2f);
    }
}`;

      assert.deepEqual(await adapter.detectDependencies(project, slice), [
        "Assets/Scripts/Player.cs",
      ]);
    });

    it("no cuenta los nombres que solo aparecen en comentarios y cadenas", async () => {
      const slice = `public class Hud
{
    // Muestra la vida del Player.
    public string Label() { return "Enemy"; }
}`;

      assert.deepEqual(await adapter.detectDependencies(project, slice), []);
    });

    it("deja afuera las pruebas y el código de terceros de Plugins", async () => {
      const helper = path.join(fixture.testsDir, "TestHelper.cs");
      const tween = path.join(fixture.assetsDir, "Plugins", "Tween", "Tweener.cs");
      await fsp.writeFile(helper, "public class TestHelper { }\n", "utf8");
      await fsp.mkdir(path.dirname(tween), { recursive: true });
      await fsp.writeFile(tween, "public class Tweener { }\n", "utf8");
      try {
        const withExtras = await adapter.buildProjectModel(fixture.projectRoot);
        assert.ok(
          withExtras.sources.some((source) => source.relativePath.endsWith("Tweener.cs")),
          "el modelo sí incluye Plugins: la exclusión es de la detección"
        );

        const slice = "public class Uso { TestHelper a; Tweener b; Player c; }";

        assert.deepEqual(await adapter.detectDependencies(withExtras, slice), [
          "Assets/Scripts/Player.cs",
        ]);
      } finally {
        await fsp.rm(helper, { force: true });
        await fsp.rm(path.dirname(tween), { recursive: true, force: true });
      }
    });

    describe("con foco en la unidad, sobre el archivo entero", () => {
      const file = `public class Board
{
    private Enemy boss;

    public bool Near(Player a) => a != null;

    public void Spawn()
    {
        boss = new Enemy();
    }

    public int Count() { return Near(null) ? 1 : 0; }
}`;

      it("solo cuenta lo que usa el método", async () => {
        const detected = await adapter.detectDependencies(project, file, {
          className: "Board",
          methodName: "Spawn",
        });

        assert.deepEqual(detected, ["Assets/Scripts/Enemy.cs"]);
      });

      it("un cuerpo de expresión termina en su punto y coma", async () => {
        const detected = await adapter.detectDependencies(project, file, {
          className: "Board",
          methodName: "Near",
        });

        assert.deepEqual(detected, ["Assets/Scripts/Player.cs"]);
      });

      it("sin foco cuenta el archivo entero", async () => {
        assert.deepEqual(await adapter.detectDependencies(project, file), [
          "Assets/Scripts/Enemy.cs",
          "Assets/Scripts/Player.cs",
        ]);
      });

      it("si el método no aparece, cuenta el archivo entero antes que nada", async () => {
        const detected = await adapter.detectDependencies(project, file, {
          className: "Board",
          methodName: "NoExiste",
        });

        assert.equal(detected.length, 2);
      });
    });

    it("una restricción `where T : class` no declara un tipo llamado `where`", () => {
      const masked = "class Pool<T> where T : class\n    where U : struct { }";

      assert.deepEqual(declaredTypeNames(masked), ["Pool"]);
    });
  });

  describe("OP-10 y OP-11 · artefacto de prueba", () => {
    const location: SymbolCandidate = {
      filePath: "Assets/Scripts/Player.cs",
      line: 12,
      column: 21,
      signature: "public void Move(float distance)",
    };

    it("sitúa y nombra el artefacto", () => {
      const spec = adapter.specifyArtifact({
        project,
        target: { className: "Player", methodName: "Move" },
        targetLocation: location,
        modelId: "claude",
      });

      assert.deepEqual(spec, {
        directory: "Assets/Tests",
        fileName: "UTIA_claude_Player_Move",
        extension: ".cs",
        unitName: "UTIA_claude_Player_Move",
      });
    });

    it("toma el nombre del archivo cuando la unidad no tiene clase", () => {
      const spec = adapter.specifyArtifact({
        project,
        target: { className: null, methodName: "Move" },
        targetLocation: location,
        modelId: "claude",
      });

      assert.equal(spec.fileName, "UTIA_claude_Player_Move");
    });

    it("quita el cercado de markdown y renombra la clase generada", () => {
      const spec = adapter.specifyArtifact({
        project,
        target: { className: "Player", methodName: "Move" },
        targetLocation: location,
        modelId: "claude",
      });

      const normalized = adapter.normalizeGeneratedCode(
        "```csharp\n[TestFixture]\npublic class GeneratedTests\n{\n}\n```",
        spec
      );

      assert.equal(normalized, `[TestFixture]\npublic class ${spec.unitName}\n{\n}`);
    });
  });

  describe("OP-12 · precondiciones del ecosistema", () => {
    const spec = {
      directory: "Assets/Tests",
      fileName: "UTIA_claude_Player_Move",
      extension: ".cs",
      unitName: "UTIA_claude_Player_Move",
    };

    it("reclama el archivo de definición de ensamblado, con instrucción concreta", async () => {
      const violations = await adapter.checkPreconditions(project, spec);

      assert.equal(violations.length, 1);
      assert.equal(violations[0].code, "unity.assembly-definition-missing");
      assert.ok(violations[0].remediation.length > 0);
    });

    it("no reclama nada cuando la carpeta de pruebas está lista", async () => {
      const assemblyDefinition = path.join(fixture.testsDir, "Tests.asmdef");
      await fsp.writeFile(assemblyDefinition, "{}", "utf8");

      try {
        assert.deepEqual(await adapter.checkPreconditions(project, spec), []);
      } finally {
        await fsp.rm(assemblyDefinition, { force: true });
      }
    });

    it("reclama la carpeta de pruebas cuando no existe", async () => {
      await fsp.rm(fixture.testsDir, { recursive: true, force: true });

      try {
        const violations = await adapter.checkPreconditions(project, spec);

        assert.equal(violations.length, 1);
        assert.equal(violations[0].code, "unity.test-directory-missing");
      } finally {
        await fsp.mkdir(fixture.testsDir, { recursive: true });
      }
    });
  });

  describe("OP-03 · capacidades declaradas", () => {
    it("declara la extensión del esquema, la compilación, la ejecución y la detección de dependencias, y ninguna otra", () => {
      // Las dos en falso son ciertas hoy: el pipeline no mide cobertura y no
      // tiene artefactos temporales que preparar ni limpiar.
      assert.deepEqual(adapter.capabilities, {
        verification: "compile",
        runTests: true,
        coverage: false,
        analysisSchemaExtension: true,
        lifecycle: false,
        dependencyDetection: true,
      });
    });

    it("implementa OP-09, OP-13, OP-14 y OP-17 tal como las declara", () => {
      // El registro rechazaría al adaptador si declarara sin implementar, pero
      // conviene que el fallo se lea aquí y no en un mensaje de alta.
      assert.equal(typeof adapter.extendAnalysisSchema, "function");
      assert.equal(typeof adapter.verifyArtifact, "function");
      assert.equal(typeof adapter.runTests, "function");
      assert.equal(typeof adapter.detectDependencies, "function");
    });
  });
});
