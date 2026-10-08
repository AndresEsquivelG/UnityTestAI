import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { runContextValidator, runTestValidator } from "../agents/validator";
import { unityPromptProfile } from "../adapters/unity/promptProfile";
import { ASSEMBLED_CONTEXT, CLASS_NAME, METHOD_NAME, TEST_CODE } from "./support/promptFixture";

/**
 * Validador que encuentra problemas pero no trae corrección.
 *
 * Antes se leía como un formato roto: el validador de contexto daba ERROR y
 * la corrida se cortaba después de pagar cuatro llamadas al modelo.
 */

/**
 * Respuesta real de claude-haiku-4-5 (2026-09-26). El resolvedor no pidió
 * `Shape.cs`, y el validador lo notó pero no tenía de dónde sacar la
 * declaración.
 */
const RAW_HAIKU = [
  "```json",
  "{",
  '  "status": "INVALID",',
  '  "issues": [',
  '    "Shape class is referenced in method body (parameters s1, s2) but not included in context. Required members Column and Row are accessed but Shape definition is missing."',
  "  ]",
  "}",
  "```",
].join("\n");

describe("validador sin corrección", () => {
  const profile = unityPromptProfile({
    rootPath: "/proyecto",
    ecosystemId: "unity",
    sourceRoots: [],
    sources: [],
  });
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "utia-sin-correccion-"));
  });

  after(async () => {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });

  const validateContext = (raw: string) =>
    runContextValidator(
      {
        profile,
        assembledContext: ASSEMBLED_CONTEXT,
        className: CLASS_NAME,
        methodName: METHOD_NAME,
        workspaceRoot,
      },
      async () => raw
    );

  it("el de contexto devuelve los problemas y el contexto sin tocar, no un error", async () => {
    const result = await validateContext(RAW_HAIKU);

    if (result.status !== "UNFIXED") {
      assert.fail(`se esperaba UNFIXED y llegó ${result.status}`);
    }
    assert.equal(result.output, ASSEMBLED_CONTEXT);
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0], /Shape definition is missing/);
  });

  it("una corrección vacía cuenta como ausente", async () => {
    const raw = JSON.stringify({ status: "INVALID", issues: ["x"], correctedContext: "  " });

    assert.deepEqual(await validateContext(raw), {
      status: "UNFIXED",
      output: ASSEMBLED_CONTEXT,
      issues: ["x"],
    });
  });

  it("el de pruebas también conserva el código del generador con los problemas", async () => {
    const raw = JSON.stringify({ status: "INVALID", issues: ["falta un caso"] });

    const result = await runTestValidator(
      {
        profile,
        testCode: TEST_CODE,
        assembledContext: ASSEMBLED_CONTEXT,
        className: CLASS_NAME,
        methodName: METHOD_NAME,
        workspaceRoot,
      },
      async () => raw
    );

    assert.deepEqual(result, { status: "UNFIXED", output: TEST_CODE, issues: ["falta un caso"] });
  });

  it("sin la lista de problemas sigue siendo una respuesta ilegible", async () => {
    const result = await validateContext(JSON.stringify({ status: "INVALID" }));

    assert.equal(result.status, "ERROR");
  });
});
