import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as path from "path";
import type { ArtifactSpec, ProjectModel, SymbolCandidate } from "../core/contracts";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import { applyPreconditionFix } from "../core/project";
import { createUnityFixture, type UnityFixture } from "./support/unityFixture";

const SPEC: ArtifactSpec = {
  directory: "Assets/Tests",
  fileName: "UTIA_claude_Player_Move",
  extension: ".cs",
  unitName: "UTIA_claude_Player_Move",
};

const LOCATION: SymbolCandidate = {
  filePath: "Assets/Scripts/Player.cs",
  line: 42,
  column: 21,
  signature: "public void Move(float distance)",
};

/** Lo que `Tests.asmdef` necesita para compilar con el ensamblado de la clase. */
const WORKING_TESTS = JSON.stringify({ name: "Tests", references: ["Game"] });

describe("ensamblado de pruebas de Unity (OP-12)", () => {
  const adapter = new UnityAdapter();
  let fixture: UnityFixture;

  const file = (...segments: string[]) => path.join(fixture.projectRoot, ...segments);

  const write = async (relativePath: string, content: string) => {
    const target = file(...relativePath.split("/"));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content, "utf8");
  };

  /** El modelo se arma al comprobar, como en la generación: los archivos ya están. */
  const check = async (location: SymbolCandidate | undefined = LOCATION) => {
    const project: ProjectModel = await adapter.buildProjectModel(fixture.projectRoot);
    return adapter.checkPreconditions(project, SPEC, location);
  };

  const installTestFramework = () =>
    write("Packages/manifest.json", JSON.stringify({ dependencies: { "com.unity.test-framework": "1.1.29" } }));

  const putClassInAssembly = (references: string[] = []) =>
    write("Assets/Scripts/Game.asmdef", JSON.stringify({ name: "Game", references }));

  beforeEach(async () => {
    fixture = await createUnityFixture();
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  describe("sin archivo de pruebas, y con la clase en un ensamblado propio", () => {
    beforeEach(async () => {
      await installTestFramework();
      await putClassInAssembly(["Motor", "GUID:abc123"]);
    });

    it("ofrece crearlo con las referencias de la clase y lo que ella usa", async () => {
      const [violation, ...rest] = await check();

      assert.deepEqual(rest, []);
      assert.equal(violation.code, "unity.assembly-definition-missing");
      assert.equal(violation.fix?.label, "Crear Tests.asmdef");
      assert.equal(violation.fix?.relativePath, "Assets/Tests/Tests.asmdef");
      assert.match(violation.remediation, /Game, Motor, GUID:abc123/);

      assert.deepEqual(JSON.parse(violation.fix!.content), {
        name: "Tests",
        rootNamespace: "",
        references: ["UnityEngine.TestRunner", "UnityEditor.TestRunner", "Game", "Motor", "GUID:abc123"],
        includePlatforms: [],
        excludePlatforms: [],
        allowUnsafeCode: false,
        overrideReferences: true,
        precompiledReferences: ["nunit.framework.dll"],
        autoReferenced: false,
        defineConstraints: ["UNITY_INCLUDE_TESTS"],
        versionDefines: [],
        noEngineReferences: false,
      });
    });

    it("también lo ofrece si falta la carpeta, y el arreglo la crea", async () => {
      await fsp.rm(fixture.testsDir, { recursive: true });

      const [violation] = await check();
      assert.equal(violation.code, "unity.test-directory-missing");
      assert.ok(violation.fix);

      await applyPreconditionFix(fixture.projectRoot, violation.fix);
      assert.deepEqual(await fsp.readdir(fixture.testsDir), ["Tests.asmdef"]);
    });

    it("después de crearlo no queda nada que reclamar", async () => {
      const [violation] = await check();
      await applyPreconditionFix(fixture.projectRoot, violation.fix!);

      assert.deepEqual(await check(), []);
    });

    it("comprobar no escribe nada", async () => {
      await check();

      assert.deepEqual(await fsp.readdir(fixture.testsDir), []);
    });

    it("cambia el nombre si otro ensamblado ya se llama Tests", async () => {
      await write("Assets/Plugins/Otro/Otro.asmdef", JSON.stringify({ name: "Tests" }));

      const [violation] = await check();

      assert.equal(JSON.parse(violation.fix!.content).name, "UTIA.Tests");
      assert.equal(violation.fix?.relativePath, "Assets/Tests/Tests.asmdef");
    });

    it("no cuenta un nombre repetido en una carpeta que Unity ignora", async () => {
      await write("Assets/Samples~/Otro.asmdef", JSON.stringify({ name: "Tests" }));

      const [violation] = await check();

      assert.equal(JSON.parse(violation.fix!.content).name, "Tests");
    });

    it("no lo ofrece si la carpeta ya tiene scripts: cambiarían de ensamblado", async () => {
      await write("Assets/Tests/Sub/Ayudante.cs", "public class Ayudante { }\n");

      const [violation, ...rest] = await check();

      assert.deepEqual(rest, []);
      assert.equal(violation.code, "unity.assembly-definition-missing");
      assert.equal(violation.fix, undefined);
      assert.match(violation.message, /un script/);
    });

    it("usa el ensamblado más cercano a la clase", async () => {
      await write("Assets/Global.asmdef", JSON.stringify({ name: "Global" }));

      const [violation] = await check();

      assert.equal(JSON.parse(violation.fix!.content).references[2], "Game");
    });
  });

  describe("sin archivo de pruebas, cuando crearlo no alcanzaría", () => {
    it("con la clase en Assembly-CSharp avisa, y no ofrece nada", async () => {
      await installTestFramework();

      const [violation, ...rest] = await check();

      assert.deepEqual(rest, []);
      assert.equal(violation.code, "unity.class-in-default-assembly");
      assert.equal(violation.fix, undefined);
      assert.match(violation.message, /Assembly-CSharp/);
      assert.match(violation.message, /Assets\/Scripts\/Player\.cs/);
    });

    it("con la clase en Assembly-CSharp, hacer lo que dice el aviso lleva al botón", async () => {
      await installTestFramework();

      const [violation] = await check();
      assert.match(violation.remediation, /te va a ofrecer crear Tests\.asmdef/);
      const [, relativePath, content] =
        /Creá el archivo "([^"]+)" con este texto: (\{.*?\})\./.exec(violation.remediation) ?? [];
      assert.equal(relativePath, "Assets/ProjectScripts.asmdef");
      await write(relativePath, content);

      const [next, ...rest] = await check();
      assert.deepEqual(rest, []);
      assert.equal(next.code, "unity.assembly-definition-missing");
      assert.deepEqual(JSON.parse(next.fix!.content).references.slice(2), ["ProjectScripts"]);
    });

    it("con un ensamblado solo para el editor avisa, y no ofrece nada", async () => {
      await installTestFramework();
      await write(
        "Assets/Scripts/Game.asmdef",
        JSON.stringify({ name: "Game", includePlatforms: ["Editor"] })
      );

      const [violation, ...rest] = await check();

      assert.deepEqual(rest, []);
      assert.equal(violation.code, "unity.class-in-editor-assembly");
      assert.equal(violation.fix, undefined);
    });

    it("sin Test Framework avisa, y no ofrece nada", async () => {
      await putClassInAssembly();

      const [violation, ...rest] = await check();

      assert.deepEqual(rest, []);
      assert.equal(violation.code, "unity.test-framework-missing");
      assert.equal(violation.fix, undefined);
    });

    it("dice todo lo que falta de una vez", async () => {
      const codes = (await check()).map((violation) => violation.code);

      assert.deepEqual(codes, ["unity.class-in-default-assembly", "unity.test-framework-missing"]);
    });

    it("con el ensamblado de la clase roto dice cuál es", async () => {
      await installTestFramework();
      await write("Assets/Scripts/Game.asmdef", "{ no es JSON");

      const [violation] = await check();

      assert.equal(violation.code, "unity.assembly-definition-invalid");
      assert.match(violation.message, /Assets\/Scripts\/Game\.asmdef/);
    });
  });

  describe("cómo reconoce Test Framework", () => {
    beforeEach(() => putClassInAssembly());

    it("como dependencia de otro paquete, en packages-lock.json", async () => {
      await write("Packages/manifest.json", JSON.stringify({ dependencies: {} }));
      await write(
        "Packages/packages-lock.json",
        JSON.stringify({ dependencies: { "com.unity.test-framework": { version: "1.1.31" } } })
      );

      const [violation] = await check();

      assert.ok(violation.fix);
    });

    it("embebido en el proyecto", async () => {
      await fsp.mkdir(file("Packages", "com.unity.test-framework"), { recursive: true });

      const [violation] = await check();

      assert.ok(violation.fix);
    });
  });

  describe("con archivo de pruebas", () => {
    beforeEach(() => putClassInAssembly());

    it("con la referencia por nombre no reclama nada", async () => {
      await write("Assets/Tests/Tests.asmdef", WORKING_TESTS);

      assert.deepEqual(await check(), []);
    });

    it("con la referencia por GUID no reclama nada", async () => {
      await write("Assets/Scripts/Game.asmdef.meta", "fileFormatVersion: 2\nguid: ABC123\n");
      await write("Assets/Tests/Tests.asmdef", JSON.stringify({ name: "Tests", references: ["GUID:abc123"] }));

      assert.deepEqual(await check(), []);
    });

    it("admite el BOM con el que Unity puede guardarlo", async () => {
      await write("Assets/Tests/Tests.asmdef", `\uFEFF${WORKING_TESTS}`);

      assert.deepEqual(await check(), []);
    });

    it("sin la referencia dice el nombre exacto que hay que agregar", async () => {
      await putClassInAssembly(["Motor"]);
      await write("Assets/Tests/Tests.asmdef", JSON.stringify({ name: "Tests", references: [] }));

      const [violation, ...rest] = await check();

      assert.deepEqual(rest, []);
      assert.equal(violation.code, "unity.assembly-reference-missing");
      assert.match(violation.remediation, /Agregá "Game"/);
      assert.match(violation.remediation, /Motor/);
      assert.equal(violation.fix, undefined);
    });

    it("no reclama lo que el ensamblado usa: la prueba puede compilar sin eso", async () => {
      await putClassInAssembly(["Motor"]);
      await write("Assets/Tests/Tests.asmdef", WORKING_TESTS);

      assert.deepEqual(await check(), []);
    });

    it("con la clase en Assembly-CSharp avisa", async () => {
      await fsp.rm(file("Assets", "Scripts", "Game.asmdef"));
      await write("Assets/Tests/Tests.asmdef", WORKING_TESTS);

      const [violation] = await check();

      assert.equal(violation.code, "unity.class-in-default-assembly");
      // Ya existe: prometer que se va a ofrecer crearlo sería falso.
      assert.doesNotMatch(violation.remediation, /ofrecer crear/);
    });

    it("con el JSON roto dice el archivo y la línea, sin ofrecer sobrescribirlo", async () => {
      // Lo que pasó en SanAndreasUnity: falta la comilla de cierre en la línea 4.
      await write(
        "Assets/Tests/Tests.asmdef",
        '{\n    "name": "Tests",\n    "references": [\n        "UGameCore.Utilities\n    ]\n}\n'
      );

      const [violation, ...rest] = await check();

      assert.deepEqual(rest, []);
      assert.equal(violation.code, "unity.assembly-definition-invalid");
      assert.match(violation.message, /Assets\/Tests\/Tests\.asmdef/);
      assert.match(violation.message, /línea 4/);
      assert.equal(violation.fix, undefined);
    });

    it("una clase del mismo ensamblado que las pruebas no necesita referencia", async () => {
      await write("Assets/Tests/Tests.asmdef", JSON.stringify({ name: "Tests" }));

      const inside = { ...LOCATION, filePath: "Assets/Tests/Ayudante.cs" };
      await write(inside.filePath, "public class Ayudante { }\n");

      assert.deepEqual(await check(inside), []);
    });

    it("una clase solo para el editor no sirve si las pruebas son de PlayMode", async () => {
      await write(
        "Assets/Scripts/Game.asmdef",
        JSON.stringify({ name: "Game", includePlatforms: ["Editor"] })
      );
      await write("Assets/Tests/Tests.asmdef", WORKING_TESTS);

      const [violation] = await check();

      assert.equal(violation.code, "unity.class-in-editor-assembly");
    });

    it("una clase solo para el editor sí sirve si las pruebas también lo son", async () => {
      await write(
        "Assets/Scripts/Game.asmdef",
        JSON.stringify({ name: "Game", includePlatforms: ["Editor"] })
      );
      await write(
        "Assets/Tests/Tests.asmdef",
        JSON.stringify({ name: "Tests", references: ["Game"], includePlatforms: ["Editor"] })
      );

      assert.deepEqual(await check(), []);
    });

    it("sigue un .asmref hasta su ensamblado, referenciado por nombre o por GUID", async () => {
      await fsp.rm(file("Assets", "Scripts", "Game.asmdef"));
      await write("Assets/Core/Motor.asmdef", JSON.stringify({ name: "Motor" }));
      await write("Assets/Core/Motor.asmdef.meta", "guid: f00d\n");
      await write("Assets/Scripts/Game.asmref", JSON.stringify({ reference: "GUID:f00d" }));

      await write("Assets/Tests/Tests.asmdef", JSON.stringify({ name: "Tests", references: ["Motor"] }));
      assert.deepEqual(await check(), []);

      await write("Assets/Tests/Tests.asmdef", JSON.stringify({ name: "Tests", references: [] }));
      const [violation] = await check();
      assert.equal(violation.code, "unity.assembly-reference-missing");
      assert.match(violation.remediation, /Agregá "Motor"/);
    });
  });

  describe("sin saber dónde está la clase", () => {
    it("solo comprueba lo de las pruebas, y no ofrece nada", async () => {
      const project = await adapter.buildProjectModel(fixture.projectRoot);

      const [violation] = await adapter.checkPreconditions(project, SPEC);

      assert.equal(violation.code, "unity.assembly-definition-missing");
      assert.equal(violation.fix, undefined);
    });

    it("el menú del editor se usa desde la carpeta de arriba, porque crea una carpeta nueva", async () => {
      await fsp.rm(fixture.testsDir, { recursive: true });
      const project = await adapter.buildProjectModel(fixture.projectRoot);

      const [violation] = await adapter.checkPreconditions(project, SPEC);

      assert.equal(violation.code, "unity.test-directory-missing");
      assert.match(violation.remediation, /seleccioná la carpeta "Assets"/);
    });
  });
});
