import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { readCodeField } from "../utils/codeField";
import { runTestValidator } from "../agents/validator";
import { runChatFixer } from "../agents/chatFixer";
import { unityPromptProfile } from "../adapters/unity/promptProfile";
import {
  ASSEMBLED_CONTEXT,
  CLASS_NAME,
  METHOD_NAME,
  TEST_CODE,
  USER_MESSAGE,
} from "./support/promptFixture";

const CODE = `using NUnit.Framework;

public class PlayerTests
{
    [Test]
    public void Moves() { Assert.Pass(); }
}`;

// Respuestas reales de qwen2.5:7b y qwen2.5:14b, acortadas sin cambiar su forma.
const RAW_7B = String.raw`{
  "status": "INVALID",
  "issues": ["checklist item 2 failed: missing using System.Linq;"],
  "correctedCode": "\"using NUnit.Framework;\nusing UnityEngine;\nusing System.Reflection;\\n\\npublic class UTIA_Test : MonoBehaviour\\n{\\n    private static MethodInfo methodInfo = typeof(Utilities).GetMethod(\"AreVerticalOrHorizontalNeighbors\");\\n}\""
}`;

const RAW_14B = String.raw`{
  "status": "INVALID",
  "issues": ["The test class is targeting a method signature that does not match the provided reference context."],
  "correctedCode": "{\\\"using\\\": [\\\"NUnit.Framework\\\", \\\"UnityEngine\\\"], \\\"public class UTIA_Test\\\": {\\\"private MethodInfo method;\\\", \\\"[SetUp]\\\": \\\"public void SetUp()\\\"}}"
}`;

describe("readCodeField", () => {
  it("acepta el código tal como viene", () => {
    assert.deepEqual(readCodeField(CODE), { ok: true, code: CODE });
  });

  it("desenvuelve el código codificado una y dos veces como cadena JSON", () => {
    assert.deepEqual(readCodeField(JSON.stringify(CODE)), { ok: true, code: CODE });
    assert.deepEqual(readCodeField(JSON.stringify(JSON.stringify(CODE))), { ok: true, code: CODE });
  });

  it("conserva los \\n que el código usa dentro de sus literales", () => {
    const withLiteral = CODE.replace("Assert.Pass();", 'Debug.Log("a\\nb"); Assert.Pass();');
    assert.deepEqual(readCodeField(withLiteral), { ok: true, code: withLiteral });
  });

  it("rechaza el código en una sola línea con los saltos escapados", () => {
    const result = readCodeField(CODE.replace(/\n/g, "\\n"));
    assert.equal(result.ok, false);
  });

  it("rechaza el código entre comillas que no es una cadena JSON limpia", () => {
    const value = JSON.parse(RAW_7B).correctedCode;
    assert.equal(readCodeField(value).ok, false);
  });

  it("rechaza el código convertido en un objeto JSON", () => {
    const value = JSON.parse(RAW_14B).correctedCode;
    assert.equal(readCodeField(value).ok, false);
  });
});

describe("correcciones de los agentes", () => {
  const profile = unityPromptProfile({
    rootPath: "/proyecto",
    ecosystemId: "unity",
    sourceRoots: [],
    sources: [],
  });
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "utia-correcciones-"));
  });

  after(async () => {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });

  const validate = (raw: string) =>
    runTestValidator(
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

  for (const [model, raw, issue] of [
    ["qwen2.5:7b", RAW_7B, "checklist item 2"],
    ["qwen2.5:14b", RAW_14B, "method signature"],
  ] as const) {
    it(`el validador descarta la corrección de ${model} y conserva los problemas`, async () => {
      const result = await validate(raw);
      if (result.status !== "ERROR") {
        assert.fail(`se esperaba ERROR y llegó ${result.status}`);
      }
      assert.match(result.message, /Discarded the validator's correction/);
      assert.ok(result.message.includes(issue));
    });
  }

  it("el validador acepta una corrección bien formada", async () => {
    const raw = JSON.stringify({ status: "INVALID", issues: ["x"], correctedCode: CODE });
    assert.deepEqual(await validate(raw), { status: "FIXED", output: CODE, issues: ["x"] });
  });

  it("el corrector del chat descarta una corrección mal codificada", async () => {
    const raw = JSON.stringify({ status: "FIXED", correctedCode: JSON.parse(RAW_14B).correctedCode });
    const result = await runChatFixer(
      {
        profile,
        testCode: TEST_CODE,
        assembledContext: ASSEMBLED_CONTEXT,
        userMessage: USER_MESSAGE,
        className: CLASS_NAME,
        methodName: METHOD_NAME,
        workspaceRoot,
      },
      async () => raw
    );
    assert.equal(result.status, "ERROR");
  });
});
