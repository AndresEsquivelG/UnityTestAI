import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type {
  ArtifactSpec,
  Diagnostic,
  EcosystemAdapter,
  ProjectModel,
  VerificationResult,
} from "../core/contracts";
import {
  artifactErrors,
  describeForFixer,
  presentRepairProgress,
  presentRepairResult,
  verifyAndRepair,
  type RepairEvent,
  type RepairReply,
  type RepairRequest,
  type RepairResult,
} from "../core/verification";
import { createStubAdapter } from "./support/stubAdapter";

/**
 * Corrección automática a partir de los diagnósticos de la verificación.
 *
 * El ciclo lee y escribe la prueba en disco de verdad, así que el proyecto
 * vive en una carpeta temporal. La verificación y el corrector son de mentira:
 * cada prueba les dicta la secuencia de respuestas.
 */

const SPEC: ArtifactSpec = {
  directory: "Tests",
  fileName: "Prueba",
  extension: ".x",
  unitName: "Prueba",
};

const ARTIFACT = "Tests/Prueba.x";

const AMBIGUOUS = "'Object' is an ambiguous reference between 'UnityEngine.Object' and 'object'";

/** La prueba real que Unity rechazó con CS0104, acortada. */
const TEST_WITH_AMBIGUITY = [
  "using System;",
  "using UnityEngine;",
  "",
  "public class Prueba",
  "{",
  "    [TearDown]",
  "    public void TearDown()",
  "    {",
  "        Object.Destroy(_go1);",
  "        Object.Destroy(_go2);",
  "    }",
  "}",
].join("\n");

const TEST_FIXED = TEST_WITH_AMBIGUITY.replace(/Object\.Destroy/g, "UnityEngine.Object.Destroy");

function error(line: number, code: string, message: string, filePath = ARTIFACT): Diagnostic {
  return { filePath, line, column: 9, severity: "error", code, message };
}

function failed(...diagnostics: Diagnostic[]): VerificationResult {
  return { status: "failed", diagnostics, exitCode: 1, rawOutput: "" };
}

const PASSED: VerificationResult = { status: "passed", diagnostics: [], exitCode: 0, rawOutput: "" };

let rootPath: string;
let project: ProjectModel;

before(() => {
  rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "utia-repair-"));
  fs.mkdirSync(path.join(rootPath, "Tests"));
  project = { rootPath, ecosystemId: "mentira", sourceRoots: [], sources: [] };
});

after(() => {
  fs.rmSync(rootPath, { recursive: true, force: true });
});

beforeEach(() => {
  writeTest(TEST_WITH_AMBIGUITY);
});

function writeTest(content: string): void {
  fs.writeFileSync(path.join(rootPath, "Tests", "Prueba.x"), content, "utf8");
}

function readTest(): string {
  return fs.readFileSync(path.join(rootPath, "Tests", "Prueba.x"), "utf8");
}

/**
 * Adaptador que verifica con las respuestas indicadas, en orden, y normaliza
 * quitando espacios de los extremos. Cuenta las verificaciones.
 */
function scriptedAdapter(results: VerificationResult[]): EcosystemAdapter & { verifications: number } {
  const queue = [...results];
  const adapter = createStubAdapter({
    id: "compila",
    capabilities: { verification: "compile" },
    optional: {
      verifyArtifact: async () => {
        adapter.verifications++;
        const next = queue.shift();
        if (!next) {
          throw new Error("la prueba no previó otra verificación");
        }
        return next;
      },
    },
    override: {
      normalizeGeneratedCode: (code) => code.trim(),
    },
  }) as EcosystemAdapter & { verifications: number };
  adapter.verifications = 0;
  return adapter;
}

/** Corrector que contesta con las respuestas indicadas, en orden, y guarda lo que recibió. */
function scriptedFixer(replies: RepairReply[]) {
  const queue = [...replies];
  const requests: RepairRequest[] = [];
  const fix = async (request: RepairRequest): Promise<RepairReply> => {
    requests.push(request);
    const next = queue.shift();
    if (!next) {
      throw new Error("la prueba no previó otra corrección");
    }
    return next;
  };
  return { fix, requests };
}

async function run(
  adapter: EcosystemAdapter,
  fix: (request: RepairRequest) => Promise<RepairReply>,
  maxCycles?: number
): Promise<{ result: RepairResult; events: RepairEvent[] }> {
  const events: RepairEvent[] = [];
  const result = await verifyAndRepair({
    adapter,
    project,
    spec: SPEC,
    fix,
    onEvent: (event) => events.push(event),
    maxCycles,
  });
  return { result, events };
}

describe("corrección automática", () => {
  it("si la prueba pasa a la primera, no se llama al corrector", async () => {
    const adapter = scriptedAdapter([PASSED]);
    const fixer = scriptedFixer([]);

    const { result } = await run(adapter, fixer.fix);

    assert.equal(result.stop, "passed");
    assert.equal(result.initialStatus, "passed");
    assert.deepEqual(result.cycles, []);
    assert.equal(fixer.requests.length, 0);
  });

  it("realimenta los errores de la prueba, escribe la corrección normalizada y vuelve a verificar", async () => {
    const adapter = scriptedAdapter([failed(error(9, "CS0104", AMBIGUOUS), error(10, "CS0104", AMBIGUOUS)), PASSED]);
    const fixer = scriptedFixer([{ status: "fixed", code: `\n${TEST_FIXED}\n\n`, summary: "calificado" }]);

    const { result, events } = await run(adapter, fixer.fix);

    assert.equal(result.stop, "passed");
    assert.equal(result.initialStatus, "failed");
    assert.equal(result.outcome.status, "passed");
    assert.equal(adapter.verifications, 2);

    assert.equal(fixer.requests.length, 1);
    assert.equal(fixer.requests[0].code, TEST_WITH_AMBIGUITY);
    assert.match(fixer.requests[0].feedback, /Tests\/Prueba\.x:9:9: error CS0104/);

    assert.equal(readTest(), TEST_FIXED, "se escribe lo que devuelve OP-11, no la respuesta cruda");

    assert.equal(result.cycles.length, 1);
    assert.equal(result.cycles[0].fixer, "fixed");
    assert.equal(result.cycles[0].detail, "calificado");
    assert.equal(result.cycles[0].verification, "passed");
    assert.equal(result.cycles[0].errors.length, 2);

    assert.deepEqual(
      events.map((event) => `${event.kind}:${event.cycle}`),
      ["verifying:0", "fixing:1", "fixed:1", "verifying:1"]
    );
    const fixed = events.find((event) => event.kind === "fixed");
    assert.ok(fixed?.kind === "fixed");
    assert.equal(fixed.code, TEST_FIXED);
  });

  it("lee la prueba del disco: si la persona la editó, corrige esa versión", async () => {
    writeTest(`${TEST_WITH_AMBIGUITY}\n// editada a mano`);
    const adapter = scriptedAdapter([failed(error(9, "CS0104", AMBIGUOUS)), PASSED]);
    const fixer = scriptedFixer([{ status: "fixed", code: TEST_FIXED }]);

    await run(adapter, fixer.fix);

    assert.match(fixer.requests[0].code, /editada a mano/);
  });

  it("solo realimenta los errores de la prueba, no los del resto del proyecto", async () => {
    const elsewhere = error(3, "CS1002", "; expected", "Assets/Scripts/Juego.cs");
    const adapter = scriptedAdapter([failed(elsewhere, error(9, "CS0104", AMBIGUOUS)), failed(elsewhere)]);
    const fixer = scriptedFixer([{ status: "fixed", code: TEST_FIXED }]);

    const { result } = await run(adapter, fixer.fix);

    const feedback = fixer.requests[0].feedback;
    assert.match(feedback, /with 1 error\./);
    assert.doesNotMatch(feedback, /Juego\.cs/);
    // Después de corregir, lo que queda no es de la prueba: otro ciclo no lo arregla.
    assert.equal(result.stop, "outsideArtifact");
    assert.equal(fixer.requests.length, 1);
  });

  it("si todos los errores están fuera de la prueba, no se llama al corrector", async () => {
    const adapter = scriptedAdapter([failed(error(3, "CS1002", "; expected", "Assets/Scripts/Juego.cs"))]);
    const fixer = scriptedFixer([]);

    const { result } = await run(adapter, fixer.fix);

    assert.equal(result.stop, "outsideArtifact");
    assert.equal(fixer.requests.length, 0);
    assert.equal(readTest(), TEST_WITH_AMBIGUITY);
  });

  it("sin verificación declarada no hay nada que corregir", async () => {
    const adapter = createStubAdapter({ id: "sin-verificacion" });
    const fixer = scriptedFixer([]);

    const { result, events } = await run(adapter, fixer.fix);

    assert.equal(result.stop, "notApplicable");
    assert.equal(fixer.requests.length, 0);
    assert.deepEqual(events, [{ kind: "verifying", cycle: 0 }]);
  });

  it("si la herramienta no corrió, no hay diagnósticos que realimentar", async () => {
    const adapter = scriptedAdapter([
      { status: "notRun", blocker: { code: "x", message: "Proyecto tomado.", remediation: "Liberalo." } },
    ]);
    const fixer = scriptedFixer([]);

    const { result } = await run(adapter, fixer.fix);

    assert.equal(result.stop, "notRun");
    assert.equal(fixer.requests.length, 0);
  });

  it("si el corrector no corrige, la prueba queda como estaba y no se vuelve a verificar", async () => {
    const adapter = scriptedAdapter([failed(error(9, "CS0104", AMBIGUOUS))]);
    const fixer = scriptedFixer([{ status: "notFixed", reason: "contexto insuficiente" }]);

    const { result, events } = await run(adapter, fixer.fix);

    assert.equal(result.stop, "notFixed");
    assert.equal(result.cycles[0].detail, "contexto insuficiente");
    assert.equal(adapter.verifications, 1);
    assert.equal(readTest(), TEST_WITH_AMBIGUITY);
    assert.deepEqual(events.at(-1), { kind: "notFixed", cycle: 1, reason: "contexto insuficiente" });
  });

  it("si la llamada al corrector falla, la corrida no se pierde", async () => {
    const adapter = scriptedAdapter([failed(error(9, "CS0104", AMBIGUOUS))]);

    const { result } = await run(adapter, async () => {
      throw new Error("400 Bad Request");
    });

    assert.equal(result.stop, "notFixed");
    assert.match(result.cycles[0].detail ?? "", /400 Bad Request/);
    assert.equal(readTest(), TEST_WITH_AMBIGUITY);
  });

  it("una corrección idéntica no se escribe ni se vuelve a verificar", async () => {
    const adapter = scriptedAdapter([failed(error(9, "CS0104", AMBIGUOUS))]);
    // Mismo texto con otros finales de línea: OP-11 no los toca y no es un cambio.
    const fixer = scriptedFixer([{ status: "fixed", code: TEST_WITH_AMBIGUITY.replace(/\n/g, "\r\n") }]);

    const { result } = await run(adapter, fixer.fix);

    assert.equal(result.stop, "unchanged");
    assert.equal(adapter.verifications, 1);
    assert.equal(readTest(), TEST_WITH_AMBIGUITY);
  });

  it("si después de corregir quedan los mismos errores, se detiene aunque hayan cambiado de línea", async () => {
    const adapter = scriptedAdapter([
      failed(error(9, "CS0104", AMBIGUOUS)),
      failed(error(12, "CS0104", AMBIGUOUS)),
    ]);
    const fixer = scriptedFixer([{ status: "fixed", code: `// intento\n${TEST_WITH_AMBIGUITY}` }]);

    const { result } = await run(adapter, fixer.fix);

    assert.equal(result.stop, "noProgress");
    assert.equal(fixer.requests.length, 1);
    assert.equal(adapter.verifications, 2);
  });

  it("si una corrección arregla uno de dos errores iguales, sigue corrigiendo", async () => {
    const adapter = scriptedAdapter([
      failed(error(9, "CS0104", AMBIGUOUS), error(10, "CS0104", AMBIGUOUS)),
      failed(error(10, "CS0104", AMBIGUOUS)),
      PASSED,
    ]);
    const fixer = scriptedFixer([
      { status: "fixed", code: `// uno\n${TEST_WITH_AMBIGUITY}` },
      { status: "fixed", code: TEST_FIXED },
    ]);

    const { result } = await run(adapter, fixer.fix);

    assert.equal(result.stop, "passed");
    assert.equal(fixer.requests.length, 2);
  });

  it("se detiene al agotar los ciclos", async () => {
    const adapter = scriptedAdapter([
      failed(error(9, "E1", "uno")),
      failed(error(9, "E2", "dos")),
      failed(error(9, "E3", "tres")),
    ]);
    const fixer = scriptedFixer([
      { status: "fixed", code: "// primera" },
      { status: "fixed", code: "// segunda" },
    ]);

    const { result } = await run(adapter, fixer.fix, 2);

    assert.equal(result.stop, "limit");
    assert.equal(fixer.requests.length, 2);
    assert.equal(adapter.verifications, 3);
    assert.equal(readTest(), "// segunda");
    assert.equal(result.outcome.status, "failed");
  });
});

describe("errores de la prueba", () => {
  it("se queda con los errores del artefacto y descarta los avisos", () => {
    const warning: Diagnostic = { ...error(4, "CS0168", "sin uso"), severity: "warning" };
    const elsewhere = error(3, "CS1002", "; expected", "Tests/Otra.x");

    assert.deepEqual(artifactErrors([warning, elsewhere, error(9, "CS0104", AMBIGUOUS)], SPEC), [
      error(9, "CS0104", AMBIGUOUS),
    ]);
  });
});

describe("texto para el corrector", () => {
  it("cada error lleva debajo la línea de la prueba a la que apunta", () => {
    const feedback = describeForFixer(
      "compile",
      [error(9, "CS0104", AMBIGUOUS), error(10, "CS0104", AMBIGUOUS)],
      TEST_WITH_AMBIGUITY
    );

    // Es texto que ve el modelo: cualquier cambio tiene que ser deliberado.
    assert.equal(
      feedback,
      [
        "The compiler rejected the test file with 2 errors. Line and column numbers refer to the current test code.",
        "",
        `Tests/Prueba.x:9:9: error CS0104: ${AMBIGUOUS}`,
        "  9 |         Object.Destroy(_go1);",
        "",
        `Tests/Prueba.x:10:9: error CS0104: ${AMBIGUOUS}`,
        "  10 |         Object.Destroy(_go2);",
        "",
        "Fix every error listed above and return the complete corrected file.",
      ].join("\n")
    );
  });

  it("nombra la herramienta según la clase de verificación, no según el ecosistema", () => {
    const [first] = describeForFixer("importCheck", [error(1, "E1", "x")], "a").split("\n");

    assert.equal(
      first,
      "The import check rejected the test file with 1 error. Line and column numbers refer to the current test code."
    );
  });

  it("sin la línea en el código, el error va solo, sin código ni columna si no los hay", () => {
    const feedback = describeForFixer(
      "compile",
      [{ filePath: ARTIFACT, line: 99, severity: "error", message: "fuera de rango" }],
      "una línea"
    );

    assert.match(feedback, /\n\nTests\/Prueba\.x:99: error: fuera de rango\n\nFix/);
  });

  it("corta la lista en veinte errores y dice cuántos quedaron afuera", () => {
    const errors = Array.from({ length: 23 }, (_, index) => error(index + 1, "E1", `error ${index + 1}`));

    const feedback = describeForFixer("compile", errors, "");

    assert.match(feedback, /with 23 errors\./);
    assert.match(feedback, /error 20\n/);
    assert.doesNotMatch(feedback, /error 21/);
    assert.match(feedback, /\n\n\(3 more errors not shown\)\n\nFix/);
  });
});

describe("presentación de la corrección automática", () => {
  function result(partial: Partial<RepairResult>): RepairResult {
    return {
      initialStatus: "failed",
      outcome: PASSED,
      stop: "passed",
      cycles: [],
      maxCycles: 3,
      ...partial,
    };
  }

  const appliedCycle = {
    cycle: 1,
    errors: [],
    fixer: "fixed" as const,
    verification: "passed" as const,
    fixMs: 0,
  };

  it("mientras corrige, lo dice y no ofrece reintentar", () => {
    const presented = presentRepairProgress("compile", failed(error(9, "CS0104", AMBIGUOUS)), 1, 3);

    assert.equal(presented.inProgress, true);
    assert.equal(presented.note, "Corrigiendo automáticamente: intento 1 de 3…");
    assert.equal(presented.diagnostics.length, 1);
  });

  it("si pasó sin corregir, no agrega nada", () => {
    const presented = presentRepairResult("compile", result({ initialStatus: "passed" }));

    assert.equal(presented.note, undefined);
    assert.equal(presented.inProgress, undefined);
  });

  it("si pasó después de corregir, dice cuántas correcciones hicieron falta", () => {
    const presented = presentRepairResult("compile", result({ cycles: [appliedCycle] }));

    assert.equal(presented.note, "Pasó después de 1 corrección automática.");
  });

  it("si se agotaron los ciclos, lo dice y ofrece seguir en el chat", () => {
    const presented = presentRepairResult(
      "compile",
      result({
        outcome: failed(error(9, "E1", "uno")),
        stop: "limit",
        cycles: [appliedCycle, { ...appliedCycle, cycle: 2 }],
      })
    );

    assert.equal(presented.note, "Siguen quedando errores después de 2 correcciones automáticas.");
    assert.match(presented.remediation ?? "", /chat/);
  });

  it("con errores fuera de la prueba, remite al proyecto y no al chat", () => {
    const presented = presentRepairResult(
      "compile",
      result({ outcome: failed(error(3, "E1", "x", "Otro.x")), stop: "outsideArtifact" })
    );

    assert.match(presented.note ?? "", /fuera de la prueba/);
    assert.match(presented.remediation ?? "", /proyecto/);
  });

  it("no pisa la instrucción de un resultado sin ejecutar", () => {
    const presented = presentRepairResult(
      "compile",
      result({
        outcome: { status: "notRun", blocker: { code: "x", message: "Tomado.", remediation: "Liberalo." } },
        stop: "notRun",
        cycles: [appliedCycle],
      })
    );

    assert.equal(presented.remediation, "Liberalo.");
    assert.equal(presented.note, "La última corrección automática quedó escrita sin verificar.");
  });
});
