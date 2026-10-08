import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as path from "path";
import { AdapterRegistry, selectEcosystem } from "../core/adapters";
import {
  artifactRelativePath,
  describeViolations,
  renderProjectTree,
  writeArtifact,
} from "../core/project";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import { createStubAdapter } from "./support/stubAdapter";
import { createUnityFixture, type UnityFixture } from "./support/unityFixture";

/**
 * Secuencia que recorre el núcleo al generar una prueba, sin el modelo de
 * lenguaje: seleccionar el ecosistema, construir el modelo, dibujar el árbol,
 * localizar la unidad, especificar el artefacto, comprobar las precondiciones,
 * normalizar y escribir.
 *
 * Es lo que hace `handleGenerate`, que no se puede ejercitar directamente porque
 * importa el editor. Esta prueba cubre el encadenado: que el valor que devuelve
 * cada operación sea el que espera la siguiente.
 */
describe("cableado del núcleo con el adaptador real", () => {
  const registry = new AdapterRegistry();
  let fixture: UnityFixture;

  before(async () => {
    // El adaptador de mentira se registra primero a propósito: si la selección
    // no preguntara por la aplicabilidad, ganaría él.
    registry.register(createStubAdapter({ id: "ajeno", displayName: "Ajeno" }));
    registry.register(new UnityAdapter());
    fixture = await createUnityFixture();
  });

  after(async () => {
    await fixture.dispose();
  });

  it("recorre la secuencia completa hasta escribir el artefacto", async () => {
    // ── OP-02: selección del ecosistema ─────────────────────────────────────
    const selection = await selectEcosystem(registry.list(), {
      rootPath: fixture.projectRoot,
      activeFile: {
        path: path.join(fixture.assetsDir, "Scripts", "Player.cs"),
        languageId: "csharp",
      },
    });

    assert.ok(selection.selected);
    assert.equal(selection.active.adapter.descriptor.id, "unity");
    assert.equal(selection.ambiguous, false);

    const { adapter } = selection.active;

    // ── OP-04: modelo del proyecto y su dibujo ──────────────────────────────
    const project = await adapter.buildProjectModel(selection.active.rootPath);
    const tree = renderProjectTree(project);

    assert.equal(
      tree,
      ["- Assets", "  - Scripts", "    - Enemy.cs", "    - Player.cs"].join("\n")
    );

    // ── OP-05: localización de la unidad ────────────────────────────────────
    const target = { className: "Player", methodName: "Move" };
    const location = await adapter.locateSymbol(project, target);

    assert.ok(location.found);
    const [targetLocation] = location.candidates;
    assert.equal(targetLocation.filePath, "Assets/Scripts/Player.cs");

    // ── OP-06: código de la unidad ──────────────────────────────────────────
    const source = await adapter.readSource(project, targetLocation);
    assert.ok(source.content.includes("public void Move(float distance)"));

    // ── OP-10: destino del artefacto ────────────────────────────────────────
    const spec = adapter.specifyArtifact({
      project,
      target,
      targetLocation,
      modelId: "claude",
    });

    assert.equal(
      artifactRelativePath(spec),
      "Assets/Tests/UTIA_claude_Player_Move.cs"
    );

    // ── OP-12: precondiciones ───────────────────────────────────────────────
    // La carpeta de pruebas del proyecto de mentira existe pero no tiene
    // archivo de definición de ensamblado, así que el adaptador lo reclama.
    const pending = await adapter.checkPreconditions(project, spec);
    assert.equal(pending.length, 1);
    assert.match(describeViolations(pending), /asmdef[\s\S]*→ /);

    await fsp.writeFile(path.join(fixture.testsDir, "Tests.asmdef"), "{}", "utf8");
    assert.deepEqual(await adapter.checkPreconditions(project, spec), []);

    // ── OP-11 y escritura ───────────────────────────────────────────────────
    const generated = "```csharp\npublic class LoQueSeaTests\n{\n}\n```";
    const normalized = adapter.normalizeGeneratedCode(generated, spec);
    const savedPath = await writeArtifact(project, spec, normalized);

    assert.equal(savedPath, path.join(fixture.projectRoot, "Assets", "Tests", "UTIA_claude_Player_Move.cs"));
    assert.equal(
      await fsp.readFile(savedPath, "utf8"),
      "public class UTIA_claude_Player_Move\n{\n}"
    );
  });

  it("no escribe nada cuando falta la carpeta de pruebas", async () => {
    const adapter = new UnityAdapter();
    const project = await adapter.buildProjectModel(fixture.projectRoot);
    const spec = {
      ...adapter.specifyArtifact({
        project,
        target: { className: "Player", methodName: "Move" },
        targetLocation: {
          filePath: "Assets/Scripts/Player.cs",
          line: 1,
          column: 1,
          signature: "",
        },
        modelId: "claude",
      }),
      directory: "Assets/NoExiste",
    };

    const violations = await adapter.checkPreconditions(project, spec);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, "unity.test-directory-missing");
  });
});
