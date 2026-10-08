import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import { parseUnityCompilerLog } from "../adapters/unity/compilation";
import {
  editorCandidates,
  systemEditorToolchain,
  type EditorRunResult,
  type UnityEditorToolchain,
} from "../adapters/unity/editor";
import type { ArtifactSpec, ProjectModel } from "../core/contracts";
import { createUnityFixture, type UnityFixture } from "./support/unityFixture";

/**
 * Compilación del proyecto Unity (OP-13).
 *
 * Los logs son extractos de corridas reales de Unity 2021.3.19f1 en modo
 * batch, acortados sin cambiar su forma: los diagnósticos repetidos, las
 * líneas en blanco entre ellos y el texto que los rodea son los de verdad.
 *
 * El editor se reemplaza por uno de mentira que escribe ese log donde el modo
 * batch lo escribiría. Así se prueba la clasificación sin tener Unity
 * instalado y en milisegundos.
 */

const ARTIFACT = "Assets/Tests/UTIA_Prueba_Player_Move.cs";
const ARTIFACT_WIN = ARTIFACT.replace(/\//g, "\\");

const SPEC: ArtifactSpec = {
  directory: "Assets/Tests",
  fileName: "UTIA_Prueba_Player_Move",
  extension: ".cs",
  unitName: "UTIA_Prueba_Player_Move",
};

/** Compilación con errores: cada diagnóstico aparece dos veces. */
const LOG_WITH_ERRORS = `##### ExitCode
1
##### Output
${ARTIFACT_WIN}(28,9): error CS0246: The type or namespace name 'ShapeQueNoExiste' could not be found (are you missing a using directive or an assembly reference?)

${ARTIFACT_WIN}(29,9): error CS0246: The type or namespace name 'ShapeQueNoExiste' could not be found (are you missing a using directive or an assembly reference?)
*** Tundra build failed (0.68 seconds), 1 items updated, 297 evaluated
${ARTIFACT_WIN}(28,9): error CS0246: The type or namespace name 'ShapeQueNoExiste' could not be found (are you missing a using directive or an assembly reference?)
${ARTIFACT_WIN}(29,9): error CS0246: The type or namespace name 'ShapeQueNoExiste' could not be found (are you missing a using directive or an assembly reference?)
AssetDatabase: script compilation time: 1.113947s
Scripts have compiler errors.
Exiting without the bug reporter. Application will terminate with return code 1`;

/**
 * Compilación con avisos. El segundo archivo no está en la corrida real: se
 * agregó para comprobar que los avisos ajenos a la prueba se descartan.
 */
const LOG_WITH_WARNINGS = `[294/297    0s] Csc Library/Bee/artifacts/1900b0aEDbg.dag/Tests.dll (+2 others)
${ARTIFACT_WIN}(15,11): warning CS0168: The variable 'sinUso' is declared but never used
Assets\\Scripts\\Player.cs(7,23): warning CS0414: The field 'Player.hint' is assigned but its value is never used
*** Tundra build success (0.68 seconds), 3 items updated, 297 evaluated
${ARTIFACT_WIN}(15,11): warning CS0168: The variable 'sinUso' is declared but never used
AssetDatabase: script compilation time: 1.049457s`;

/** El modo batch con el mismo proyecto abierto en el editor: sale con 21. */
const LOG_PROJECT_OPEN = `Successfully changed project path to: C:/Proyectos/Juego
It looks like another Unity instance is running with this project open.

Multiple Unity instances cannot open the same project.

Project: C:/Proyectos/Juego
Fatal Error! It looks like another Unity instance is running with this project open.`;

interface FakeEditor extends UnityEditorToolchain {
  readonly runs: (readonly string[])[];
}

function fakeEditor(options: {
  installed?: boolean;
  projectOpen?: boolean;
  log?: string;
  result?: EditorRunResult;
}): FakeEditor {
  const runs: (readonly string[])[] = [];
  return {
    runs,
    findEditor: async (version) =>
      options.installed === false ? undefined : `C:/Unity/${version}/Unity.exe`,
    isProjectOpen: async () => options.projectOpen ?? false,
    run: async (_executable, args) => {
      runs.push(args);
      if (options.log !== undefined) {
        await fsp.writeFile(args[args.indexOf("-logFile") + 1], options.log, "utf8");
      }
      return options.result ?? { exitCode: 0, timedOut: false };
    },
  };
}

describe("compilación del proyecto Unity (OP-13)", () => {
  let fixture: UnityFixture;
  let project: ProjectModel;

  before(async () => {
    fixture = await createUnityFixture();
    project = await new UnityAdapter().buildProjectModel(fixture.projectRoot);
  });

  after(async () => {
    await fixture.dispose();
  });

  const verify = (editor: UnityEditorToolchain, model: ProjectModel = project) =>
    new UnityAdapter({ toolchain: editor }).verifyArtifact(model, SPEC);

  describe("lectura del log", () => {
    it("descarta los diagnósticos repetidos y normaliza la ruta", () => {
      const diagnostics = parseUnityCompilerLog(LOG_WITH_ERRORS, "C:/Proyectos/Juego");

      assert.deepEqual(diagnostics, [
        {
          filePath: ARTIFACT,
          line: 28,
          column: 9,
          severity: "error",
          code: "CS0246",
          message:
            "The type or namespace name 'ShapeQueNoExiste' could not be found (are you missing a using directive or an assembly reference?)",
        },
        {
          filePath: ARTIFACT,
          line: 29,
          column: 9,
          severity: "error",
          code: "CS0246",
          message:
            "The type or namespace name 'ShapeQueNoExiste' could not be found (are you missing a using directive or an assembly reference?)",
        },
      ]);
    });

    it("vuelve relativa una ruta absoluta dentro del proyecto, aunque cambie la mayúscula", () => {
      const log = "c:\\proyectos\\juego\\Assets\\Tests\\A.cs(3,5): error CS1002: ; expected";
      const [diagnostic] = parseUnityCompilerLog(log, "C:\\Proyectos\\Juego");

      assert.equal(diagnostic.filePath, "Assets/Tests/A.cs");
    });

    it("no confunde con un diagnóstico las líneas que solo se le parecen", () => {
      const log = [
        "[294/297    0s] Csc Library/Bee/artifacts/1900b0aEDbg.dag/Tests.dll (+2 others)",
        "Scripts have compiler errors.",
        "Debug.Log(\"error CS0000: no es un diagnóstico\")",
      ].join("\n");

      assert.deepEqual(parseUnityCompilerLog(log, "C:/Proyectos/Juego"), []);
    });
  });

  describe("clasificación del resultado", () => {
    it("compila: `passed` y solo los avisos de la prueba generada", async () => {
      const result = await verify(fakeEditor({ log: LOG_WITH_WARNINGS }));

      assert.ok(result.status === "passed");
      assert.deepEqual(
        result.diagnostics.map((d) => `${d.filePath}:${d.line} ${d.code}`),
        [`${ARTIFACT}:15 CS0168`]
      );
      assert.equal(result.exitCode, 0);
    });

    it("no compila: `failed` con los errores, sin repetir", async () => {
      const result = await verify(
        fakeEditor({ log: LOG_WITH_ERRORS, result: { exitCode: 1, timedOut: false } })
      );

      assert.ok(result.status === "failed");
      assert.equal(result.diagnostics.length, 2);
      assert.ok(result.diagnostics.every((d) => d.severity === "error" && d.filePath === ARTIFACT));
      assert.equal(result.exitCode, 1);
      assert.match(result.rawOutput, /Scripts have compiler errors/);
    });

    it("con el editor abierto no lanza nada y pide cerrarlo", async () => {
      const editor = fakeEditor({ projectOpen: true });
      const result = await verify(editor);

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.project-open");
      assert.match(result.blocker.remediation, /Cerrá el editor/);
      assert.equal(editor.runs.length, 0);
    });

    it("si el bloqueo no se detectó antes, lo reconoce en el log y no lo da por fallo", async () => {
      // Es el caso de macOS y Linux, donde el bloqueo no se ve de antemano.
      const result = await verify(
        fakeEditor({ log: LOG_PROJECT_OPEN, result: { exitCode: 21, timedOut: false } })
      );

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.project-open");
    });

    it("sin el editor de la versión del proyecto, avisa cuál instalar", async () => {
      const editor = fakeEditor({ installed: false });
      const result = await verify(editor);

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.editor-not-installed");
      assert.match(result.blocker.remediation, /6000\.0\.23f1/);
      assert.equal(editor.runs.length, 0);
    });

    it("sin versión del editor en el modelo, no intenta adivinarla", async () => {
      const result = await verify(fakeEditor({}), { ...project, adapterData: undefined });

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.editor-version-unknown");
    });

    it("si se agota el tiempo, no es un fallo de la prueba", async () => {
      const result = await verify(fakeEditor({ result: { exitCode: null, timedOut: true } }));

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.compile-timeout");
    });

    it("un código distinto de cero sin diagnósticos no se informa como error de compilación", async () => {
      // Por ejemplo, un problema de licencia: la prueba puede estar bien.
      const result = await verify(
        fakeEditor({ log: "Cannot load ULF license\n", result: { exitCode: 1, timedOut: false } })
      );

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.editor-failed");
      assert.equal(result.rawOutput, "Cannot load ULF license\n");
    });

    it("si el editor no arranca, lo dice", async () => {
      const result = await verify(
        fakeEditor({ result: { exitCode: null, timedOut: false, spawnError: "spawn ENOENT" } })
      );

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.editor-failed-to-start");
    });

    it("lanza el modo batch sobre la raíz del proyecto y borra el log temporal", async () => {
      const editor = fakeEditor({ log: "" });
      await verify(editor);

      const [args] = editor.runs;
      assert.deepEqual(args.slice(0, 5), [
        "-batchmode",
        "-quit",
        "-nographics",
        "-projectPath",
        fixture.projectRoot,
      ]);
      const logFile = args[args.indexOf("-logFile") + 1];
      assert.equal(path.dirname(path.dirname(logFile)), os.tmpdir());
      await assert.rejects(fsp.stat(path.dirname(logFile)));
    });
  });

  describe("editor instalado", () => {
    it("en Windows lo busca en la carpeta de Unity Hub", () => {
      assert.deepEqual(
        editorCandidates("2021.3.19f1", "win32", { ProgramFiles: "C:\\Program Files" }),
        ["C:\\Program Files\\Unity\\Hub\\Editor\\2021.3.19f1\\Editor\\Unity.exe"]
      );
    });

    it("prefiere la carpeta secundaria de Unity Hub cuando existe", () => {
      const [first, second] = editorCandidates(
        "2021.3.19f1",
        "win32",
        { ProgramFiles: "C:\\Program Files" },
        "D:\\Unity"
      );
      assert.equal(first, "D:\\Unity\\2021.3.19f1\\Editor\\Unity.exe");
      assert.equal(second, "C:\\Program Files\\Unity\\Hub\\Editor\\2021.3.19f1\\Editor\\Unity.exe");
    });

    it("en macOS y Linux usa las rutas de Unity Hub de cada sistema", () => {
      assert.deepEqual(editorCandidates("6000.0.23f1", "darwin", {}), [
        "/Applications/Unity/Hub/Editor/6000.0.23f1/Unity.app/Contents/MacOS/Unity",
      ]);
      assert.deepEqual(editorCandidates("6000.0.23f1", "linux", { HOME: "/home/ana" }), [
        "/home/ana/Unity/Hub/Editor/6000.0.23f1/Editor/Unity",
      ]);
    });
  });

  describe("proyecto abierto en el editor", () => {
    // El caso positivo —el editor abierto deja el archivo tomado y abrirlo da
    // EBUSY— se comprobó a mano en Windows: no hay forma portable de tomar un
    // archivo en exclusiva desde Node para simularlo aquí.

    it("sin archivo de bloqueo, el proyecto no está abierto", async () => {
      assert.equal(await systemEditorToolchain.isProjectOpen(fixture.projectRoot), false);
    });

    it("un bloqueo que quedó de un editor cerrado de golpe no cuenta", async () => {
      const temp = path.join(fixture.projectRoot, "Temp");
      await fsp.mkdir(temp, { recursive: true });
      await fsp.writeFile(path.join(temp, "UnityLockfile"), "");
      try {
        assert.equal(await systemEditorToolchain.isProjectOpen(fixture.projectRoot), false);
      } finally {
        await fsp.rm(temp, { recursive: true, force: true });
      }
    });
  });
});
