import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { UnityAdapter } from "../adapters/unity/unityAdapter";
import {
  mergeCoverage,
  parseOpenCover,
  pathFilterFor,
  readExecutionCoverage,
  sourceMethodOf,
} from "../adapters/unity/coverage";
import type { EditorRunResult, UnityEditorToolchain } from "../adapters/unity/editor";
import type {
  ArtifactSpec,
  CompletedTestRun,
  CoverageTarget,
  ProjectModel,
} from "../core/contracts";
import { createUnityFixture, type UnityFixture } from "./support/unityFixture";

/**
 * Cobertura con el paquete de Unity (OP-15).
 *
 * Los informes son extractos de corridas reales con Unity 2021.3.19f1 y el
 * paquete 1.3.0 sobre `Utilities.cs` de MatchThreeGame, acortados sin
 * cambiar su forma: el mapa escribe la columna en cero y la ejecución no, el
 * iterador queda en una clase que generó el compilador, y la línea 20 (un
 * `foreach`) tiene tres puntos. Solo se cambió la ruta del archivo.
 */

const FILE = "Assets/Scripts/Utilities.cs";

const TARGET: CoverageTarget = {
  filePath: FILE,
  unit: { className: "Utilities", methodName: "AreVerticalOrHorizontalNeighbors" },
};

const SPEC: ArtifactSpec = {
  directory: "Assets/Tests",
  fileName: "UTIA_claude_Utilities_AreVerticalOrHorizontalNeighbors",
  extension: ".cs",
  unitName: "UTIA_claude_Utilities_AreVerticalOrHorizontalNeighbors",
};

/** El mapa completo: todo lo medible del archivo, en cero. */
const MAP = `<?xml version="1.0" encoding="utf-8"?>
<CoverageSession xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="0.0.0.0">
  <Summary numSequencePoints="161" visitedSequencePoints="0" numBranchPoints="0" visitedBranchPoints="0" sequenceCoverage="0.0" branchCoverage="0.0" />
  <Modules>
    <Module>
      <ModuleName>GlobalAssembly</ModuleName>
      <Files>
        <File uid="1" fullPath="D:/Juego/Assets/Scripts/Utilities.cs" />
      </Files>
      <Classes>
        <Class>
          <FullName>Utilities</FullName>
          <Methods>
            <Method visited="false" cyclomaticComplexity="0" sequenceCoverage="0.0" branchCoverage="0" isConstructor="false" isStatic="true">
              <MetadataToken>100663382</MetadataToken>
              <Name>static System.Boolean Utilities::AreVerticalOrHorizontalNeighbors(Shape, Shape)</Name>
              <FileRef uid="1" />
              <SequencePoints>
                <SequencePoint vc="0" uspid="1" ordinal="0" offset="0" sl="48" sc="0" el="48" ec="0" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="0" uspid="2" ordinal="0" offset="1" sl="49" sc="0" el="49" ec="0" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="0" uspid="3" ordinal="0" offset="80" sl="53" sc="0" el="53" ec="0" bec="0" bev="0" fileid="1" />
              </SequencePoints>
              <BranchPoints />
            </Method>
            <Method visited="false" cyclomaticComplexity="0" sequenceCoverage="0.0" branchCoverage="0" isConstructor="false" isStatic="true">
              <MetadataToken>100663383</MetadataToken>
              <Name>static System.Collections.Generic.IEnumerable[GameObject] Utilities::GetPotentialMatches(ShapesArray)</Name>
              <FileRef uid="1" />
              <SequencePoints>
                <SequencePoint vc="0" uspid="4" ordinal="0" offset="0" sl="60" sc="0" el="60" ec="0" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="0" uspid="5" ordinal="0" offset="1" sl="62" sc="0" el="62" ec="0" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="0" uspid="6" ordinal="0" offset="7" sl="64" sc="0" el="64" ec="0" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="0" uspid="7" ordinal="0" offset="14" sl="65" sc="0" el="65" ec="0" bec="0" bev="0" fileid="1" />
              </SequencePoints>
              <BranchPoints />
            </Method>
          </Methods>
        </Class>
        <Class>
          <FullName>Utilities/&lt;AnimatePotentialMatches&gt;d__0</FullName>
          <Methods>
            <Method visited="false" cyclomaticComplexity="0" sequenceCoverage="0.0" branchCoverage="0" isConstructor="false" isStatic="false">
              <MetadataToken>100663509</MetadataToken>
              <Name>System.Boolean Utilities/&lt;AnimatePotentialMatches&gt;d__0::MoveNext()</Name>
              <FileRef uid="1" />
              <SequencePoints>
                <SequencePoint vc="0" uspid="130" ordinal="0" offset="48" sl="17" sc="0" el="17" ec="0" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="0" uspid="131" ordinal="0" offset="49" sl="18" sc="0" el="18" ec="0" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="0" uspid="133" ordinal="0" offset="66" sl="20" sc="0" el="20" ec="0" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="0" uspid="134" ordinal="0" offset="67" sl="20" sc="0" el="20" ec="0" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="0" uspid="135" ordinal="0" offset="86" sl="20" sc="0" el="20" ec="0" bec="0" bev="0" fileid="1" />
              </SequencePoints>
              <BranchPoints />
            </Method>
          </Methods>
        </Class>
      </Classes>
    </Module>
  </Modules>
</CoverageSession>`;

/** El de la ejecución: solo el método que la prueba tocó, y con la columna. */
const EXECUTED = `<?xml version="1.0" encoding="utf-8"?>
<CoverageSession xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="0.0.0.0">
  <Summary numSequencePoints="3" visitedSequencePoints="3" numBranchPoints="0" visitedBranchPoints="0" sequenceCoverage="100.0" branchCoverage="0.0" />
  <Modules>
    <Module>
      <ModuleName>GlobalAssembly</ModuleName>
      <Files>
        <File uid="1" fullPath="D:/Juego/Assets/Scripts/Utilities.cs" />
      </Files>
      <Classes>
        <Class>
          <FullName>Utilities</FullName>
          <Methods>
            <Method visited="true" cyclomaticComplexity="0" sequenceCoverage="100.0" branchCoverage="0" isConstructor="false" isStatic="true">
              <MetadataToken>100663382</MetadataToken>
              <Name>static System.Boolean Utilities::AreVerticalOrHorizontalNeighbors(Shape, Shape)</Name>
              <FileRef uid="1" />
              <SequencePoints>
                <SequencePoint vc="6" uspid="1" ordinal="0" offset="0" sl="48" sc="5" el="48" ec="5" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="6" uspid="2" ordinal="0" offset="1" sl="49" sc="9" el="49" ec="9" bec="0" bev="0" fileid="1" />
                <SequencePoint vc="6" uspid="3" ordinal="0" offset="80" sl="53" sc="5" el="53" ec="5" bec="0" bev="0" fileid="1" />
              </SequencePoints>
              <BranchPoints />
            </Method>
          </Methods>
        </Class>
      </Classes>
    </Module>
  </Modules>
</CoverageSession>`;

/** Lo que deja el paquete cuando la prueba no ejecutó nada del archivo. */
const LOG_NOTHING_VISITED = `[Code Coverage] Code coverage results were not saved. Visited sequence points not found.
Included Assemblies: globalassembly,tests`;

const LOG_PROJECT_OPEN = `It looks like another Unity instance is running with this project open.`;

const REPORT_PASSED = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="2" testcasecount="6" result="Passed" total="6" passed="6" failed="0" inconclusive="0" skipped="0">
</test-run>`;

function completedRun(rawCoverage?: string): CompletedTestRun {
  return {
    status: "passed",
    total: 6,
    passed: 6,
    failed: 0,
    skipped: 0,
    cases: [],
    exitCode: 0,
    rawReport: REPORT_PASSED,
    ...(rawCoverage === undefined ? {} : { rawCoverage }),
  };
}

interface FakeEditor extends UnityEditorToolchain {
  readonly runs: (readonly string[])[];
}

/**
 * Editor de mentira que deja los informes donde los dejaría el paquete: el
 * de la ejecución dentro de `<proyecto>-opencov/<plataforma>/`, y el mapa en
 * la raíz de resultados, solo si se lo pidió.
 */
function fakeEditor(options: {
  projectOpen?: boolean;
  log?: string;
  executed?: string;
  map?: string;
  result?: EditorRunResult;
}): FakeEditor {
  const runs: (readonly string[])[] = [];
  return {
    runs,
    findEditor: async (version) => `C:/Unity/${version}/Unity.exe`,
    isProjectOpen: async () => options.projectOpen ?? false,
    run: async (_executable, args) => {
      runs.push(args);
      await fsp.writeFile(args[args.indexOf("-logFile") + 1], options.log ?? "", "utf8");
      await fsp.writeFile(args[args.indexOf("-testResults") + 1], REPORT_PASSED, "utf8");
      const results = args.indexOf("-coverageResultsPath");
      if (results !== -1) {
        const dir = args[results + 1];
        const fullMap = args[args.indexOf("-coverageOptions") + 1].includes("generateRootEmptyReport");
        if (fullMap && options.map !== undefined) {
          await fsp.mkdir(dir, { recursive: true });
          await fsp.writeFile(path.join(dir, "TestCoverageResults_fullEmpty.xml"), options.map, "utf8");
        }
        if (!fullMap && options.executed !== undefined) {
          const platformDir = path.join(dir, "Juego-opencov", "PlayMode");
          await fsp.mkdir(platformDir, { recursive: true });
          await fsp.writeFile(path.join(platformDir, "TestCoverageResults_0000.xml"), options.executed, "utf8");
        }
      }
      return options.result ?? { exitCode: 0, timedOut: false };
    },
  };
}

describe("cobertura con el paquete de Unity (OP-15)", () => {
  let fixture: UnityFixture;
  let project: ProjectModel;
  const manifest = () => path.join(fixture.projectRoot, "Packages", "manifest.json");

  before(async () => {
    fixture = await createUnityFixture();
    await fsp.writeFile(
      path.join(fixture.testsDir, "Tests.asmdef"),
      JSON.stringify({ name: "Tests", includePlatforms: [] }),
      "utf8"
    );
    await fsp.mkdir(path.dirname(manifest()), { recursive: true });
    await fsp.writeFile(
      manifest(),
      JSON.stringify({ dependencies: { "com.unity.testtools.codecoverage": "1.3.0" } }),
      "utf8"
    );
    project = await new UnityAdapter().buildProjectModel(fixture.projectRoot);
  });

  after(async () => {
    await fixture.dispose();
  });

  /** Corre `body` con el manifiesto sin el paquete, y lo restituye. */
  async function withoutPackage(body: () => Promise<void>) {
    const original = await fsp.readFile(manifest(), "utf8");
    await fsp.writeFile(manifest(), JSON.stringify({ dependencies: {} }), "utf8");
    try {
      await body();
    } finally {
      await fsp.writeFile(manifest(), original, "utf8");
    }
  }

  describe("lectura del informe", () => {
    it("lee cada punto con su método, desplazamiento, línea, visitas y archivo", () => {
      const points = parseOpenCover(EXECUTED);

      assert.deepEqual(points, [
        {
          method: "static System.Boolean Utilities::AreVerticalOrHorizontalNeighbors(Shape, Shape)",
          offset: 0,
          line: 48,
          hits: 6,
          file: "D:/Juego/Assets/Scripts/Utilities.cs",
        },
        {
          method: "static System.Boolean Utilities::AreVerticalOrHorizontalNeighbors(Shape, Shape)",
          offset: 1,
          line: 49,
          hits: 6,
          file: "D:/Juego/Assets/Scripts/Utilities.cs",
        },
        {
          method: "static System.Boolean Utilities::AreVerticalOrHorizontalNeighbors(Shape, Shape)",
          offset: 80,
          line: 53,
          hits: 6,
          file: "D:/Juego/Assets/Scripts/Utilities.cs",
        },
      ]);
    });

    it("decodifica las entidades del nombre de un método que generó el compilador", () => {
      const points = parseOpenCover(MAP) ?? [];

      assert.ok(
        points.some((point) => point.method === "System.Boolean Utilities/<AnimatePotentialMatches>d__0::MoveNext()")
      );
    });

    it("la cadena vacía es un informe sin puntos; otra cosa que no es un informe, ninguno", () => {
      assert.deepEqual(parseOpenCover(""), []);
      assert.equal(parseOpenCover("<test-run />"), undefined);
    });

    it("atribuye el código generado al método escrito en el archivo", () => {
      assert.deepEqual(
        sourceMethodOf("static System.Boolean Utilities::AreVerticalOrHorizontalNeighbors(Shape, Shape)"),
        { className: "Utilities", methodName: "AreVerticalOrHorizontalNeighbors" }
      );
      assert.deepEqual(sourceMethodOf("System.Boolean Utilities/<AnimatePotentialMatches>d__0::MoveNext()"), {
        className: "Utilities",
        methodName: "AnimatePotentialMatches",
      });
      assert.deepEqual(sourceMethodOf("System.Boolean Juego.Tablero/<>c::<Buscar>b__3_0(Pieza)"), {
        className: "Tablero",
        methodName: "Buscar",
      });
      assert.deepEqual(
        sourceMethodOf("System.Collections.Generic.Dictionary[System.String, System.Int32] Juego.Caja`1::Contar()"),
        { className: "Caja", methodName: "Contar" }
      );
    });
  });

  describe("cruce de los dos informes", () => {
    const merge = (executed: string, target: CoverageTarget = TARGET) =>
      mergeCoverage(parseOpenCover(MAP) ?? [], parseOpenCover(executed) ?? [], target);

    it("el total sale del mapa y lo cubierto de la ejecución, aunque la columna no coincida", () => {
      const report = merge(EXECUTED);

      assert.deepEqual(report.line, { covered: 3, total: 10, percentage: 30 });
      assert.deepEqual(report.target, {
        name: "Utilities.AreVerticalOrHorizontalNeighbors",
        firstLine: 48,
        line: { covered: 3, total: 3, percentage: 100 },
      });
    });

    it("lista cada método en el orden del archivo, con el iterador como uno solo", () => {
      const [file] = merge(EXECUTED).byFile;

      assert.equal(file.filePath, FILE);
      assert.deepEqual(
        file.units.map((unit) => [unit.name, unit.firstLine, unit.line.covered, unit.line.total]),
        [
          ["Utilities.AnimatePotentialMatches", 17, 0, 3],
          ["Utilities.AreVerticalOrHorizontalNeighbors", 48, 3, 3],
          ["Utilities.GetPotentialMatches", 60, 0, 4],
        ]
      );
    });

    it("una línea con varios puntos queda parcial si se ejecutó solo uno, y cuenta como cubierta", () => {
      // Sintético: la ejecución trae un solo punto, uno de los tres del
      // foreach de la línea 20.
      const partial = EXECUTED.replace(
        "static System.Boolean Utilities::AreVerticalOrHorizontalNeighbors(Shape, Shape)",
        "System.Boolean Utilities/&lt;AnimatePotentialMatches&gt;d__0::MoveNext()"
      ).replace(
        /<SequencePoints>[\s\S]*<\/SequencePoints>/,
        '<SequencePoints><SequencePoint vc="1" uspid="133" ordinal="0" offset="66" sl="20" sc="13" el="20" ec="13" bec="0" bev="0" fileid="1" /></SequencePoints>'
      );
      const [file] = merge(partial).byFile;
      const status = new Map(file.lines.map((line) => [line.line, line.status]));

      assert.equal(status.get(20), "partial");
      assert.equal(status.get(17), "missed");
      const animate = file.units.find((unit) => unit.name === "Utilities.AnimatePotentialMatches");
      assert.deepEqual(animate?.line, { covered: 1, total: 3, percentage: 33.3 });
    });

    it("cuenta cada línea una vez aunque tenga varios puntos, y deja los puntos en una nota", () => {
      // El mapa tiene 12 puntos en 10 líneas: la 20 tiene tres.
      const report = merge(EXECUTED);

      assert.equal(report.byFile[0].lines.length, 10);
      assert.equal(report.line.total, 10);
      assert.ok(report.notes.some((note) => /ejecutó 3 de 12/.test(note)));
    });

    it("las líneas cubiertas y las que no, en orden y solo las medibles", () => {
      const [file] = merge(EXECUTED).byFile;

      assert.deepEqual(
        file.lines.map((line) => `${line.line}:${line.status}`),
        ["17:missed", "18:missed", "20:missed", "48:covered", "49:covered", "53:covered", "60:missed", "62:missed", "64:missed", "65:missed"]
      );
    });

    it("sin visitas, todo queda sin cubrir y la unidad sigue apareciendo", () => {
      const report = merge("");

      assert.deepEqual(report.line, { covered: 0, total: 10, percentage: 0 });
      assert.deepEqual(report.target?.line, { covered: 0, total: 3, percentage: 0 });
    });

    it("con otra clase en el pedido, no confunde un método del mismo nombre", () => {
      const report = merge(EXECUTED, {
        ...TARGET,
        unit: { className: "Tablero", methodName: "AreVerticalOrHorizontalNeighbors" },
      });

      assert.equal(report.target, undefined);
    });
  });

  describe("pedido en la corrida de la prueba", () => {
    const runTests = (editor: UnityEditorToolchain, target?: CoverageTarget) =>
      new UnityAdapter({ toolchain: editor }).runTests(project, SPEC, target);

    it("pide la cobertura del archivo en la misma corrida y devuelve el informe crudo", async () => {
      const editor = fakeEditor({ executed: EXECUTED });
      const result = await runTests(editor, TARGET);

      const [args] = editor.runs;
      assert.ok(args.includes("-enableCodeCoverage"));
      assert.equal(
        args[args.indexOf("-coverageOptions") + 1],
        "assemblyFilters:+<assets>;pathFilters:+**/Assets/Scripts/Utilities.cs"
      );
      const resultsDir = args[args.indexOf("-coverageResultsPath") + 1];
      assert.equal(path.dirname(path.dirname(resultsDir)), os.tmpdir(), "nunca dentro del proyecto");

      assert.ok(result.status === "passed");
      assert.equal(result.rawCoverage, EXECUTED);
    });

    it("sin pedido no mide, y sin el paquete tampoco, pero ejecuta igual", async () => {
      const plain = fakeEditor({ executed: EXECUTED });
      const withoutRequest = await runTests(plain);
      assert.ok(!plain.runs[0].includes("-enableCodeCoverage"));
      assert.ok(withoutRequest.status === "passed" && withoutRequest.rawCoverage === undefined);

      await withoutPackage(async () => {
        const editor = fakeEditor({ executed: EXECUTED });
        const result = await runTests(editor, TARGET);
        assert.ok(!editor.runs[0].includes("-enableCodeCoverage"));
        assert.ok(result.status === "passed" && result.rawCoverage === undefined);
      });
    });

    it("sin informe, distingue «no ejecutó nada del archivo» de «no dejó datos»", async () => {
      const empty = await fsp.mkdtemp(path.join(os.tmpdir(), "utia-cobertura-"));
      try {
        assert.equal(await readExecutionCoverage(empty, LOG_NOTHING_VISITED), "");
        assert.equal(await readExecutionCoverage(empty, "otra cosa"), undefined);
      } finally {
        await fsp.rm(empty, { recursive: true, force: true });
      }
    });

    it("una ruta con separadores o comodines del paquete no se puede filtrar", () => {
      assert.equal(pathFilterFor("Assets/Scripts/Utilities.cs"), "+**/Assets/Scripts/Utilities.cs");
      assert.equal(pathFilterFor("Assets\\Scripts\\Utilities.cs"), "+**/Assets/Scripts/Utilities.cs");
      for (const bad of ["Assets/a,b.cs", "Assets/a;b.cs", "Assets/[x].cs", "Assets/a*.cs", "Assets/a?.cs"]) {
        assert.equal(pathFilterFor(bad), undefined, bad);
      }
    });
  });

  describe("medición", () => {
    const collect = (editor: UnityEditorToolchain, run: CompletedTestRun, target = TARGET) =>
      new UnityAdapter({ toolchain: editor }).collectCoverage(project, run, target);

    it("abre el editor en EditMode sin ejecutar nada, para que el paquete escriba el mapa", async () => {
      const editor = fakeEditor({ map: MAP });
      const result = await collect(editor, completedRun(EXECUTED));

      const [args] = editor.runs;
      assert.equal(args[args.indexOf("-testPlatform") + 1], "EditMode");
      assert.equal(args[args.indexOf("-testFilter") + 1], "^$");
      assert.equal(
        args[args.indexOf("-coverageOptions") + 1],
        "generateRootEmptyReport;assemblyFilters:+<assets>;pathFilters:+**/Assets/Scripts/Utilities.cs"
      );
      const resultsDir = args[args.indexOf("-coverageResultsPath") + 1];
      await assert.rejects(fsp.stat(path.dirname(resultsDir)), "la carpeta temporal se borra");

      assert.ok(result.status === "measured");
      assert.deepEqual(result.line, { covered: 3, total: 10, percentage: 30 });
      assert.deepEqual(result.target?.line, { covered: 3, total: 3, percentage: 100 });
      assert.equal(result.decision, undefined, "la decisión no está disponible, no es cero");
      assert.ok(result.notes?.some((note) => /decisión no está disponible.*1\.3\.0/.test(note)));
    });

    it("sin el paquete en el proyecto no lanza nada y dice cómo instalarlo", async () => {
      await withoutPackage(async () => {
        const editor = fakeEditor({ map: MAP });
        const result = await collect(editor, completedRun(EXECUTED));

        assert.ok(result.status === "notRun");
        assert.equal(result.blocker.code, "unity.coverage-package-missing");
        assert.match(result.blocker.remediation, /Package Manager/);
        assert.equal(editor.runs.length, 0);
      });
    });

    it("si la ejecución no dejó datos no inventa un 0 %", async () => {
      const editor = fakeEditor({ map: MAP });
      const result = await collect(editor, completedRun());

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.coverage-data-missing");
      assert.equal(editor.runs.length, 0);
    });

    it("una ejecución que no tocó el archivo sí es una medición: 0 %", async () => {
      const result = await collect(fakeEditor({ map: MAP }), completedRun(""));

      assert.ok(result.status === "measured");
      assert.deepEqual(result.line, { covered: 0, total: 10, percentage: 0 });
    });

    it("sin el mapa no hay total, y no se mide", async () => {
      const result = await collect(fakeEditor({}), completedRun(EXECUTED));

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.coverage-map-missing");
    });

    it("con el editor abierto pide cerrarlo y reintentar la ejecución, que es lo que vuelve a medir", async () => {
      const result = await collect(fakeEditor({ projectOpen: true, map: MAP }), completedRun(EXECUTED));

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.project-open");
      assert.match(result.blocker.remediation, /la ejecución/);
    });

    it("si el bloqueo aparece recién en el log, también lo reconoce", async () => {
      const result = await collect(
        fakeEditor({ log: LOG_PROJECT_OPEN, map: MAP, result: { exitCode: 21, timedOut: false } }),
        completedRun(EXECUTED)
      );

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.project-open");
    });

    it("una ruta que no se puede filtrar no se mide", async () => {
      const editor = fakeEditor({ map: MAP });
      const result = await collect(editor, completedRun(EXECUTED), { ...TARGET, filePath: "Assets/a,b.cs" });

      assert.ok(result.status === "notRun");
      assert.equal(result.blocker.code, "unity.coverage-path-unsupported");
      assert.equal(editor.runs.length, 0);
    });
  });
});
