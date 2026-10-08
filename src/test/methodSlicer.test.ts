import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { runMethodSlicer } from "../agents/methodSlicer";
import { unityPromptProfile } from "../adapters/unity/promptProfile";
import { CLASS_NAME, METHOD_NAME } from "./support/promptFixture";

/**
 * Lectura de la respuesta del recortador de métodos.
 *
 * El estado de éxito no agrega nada al recorte, y un modelo que lo nombra
 * distinto no debe cortar la corrida.
 */

/** Respuesta real de claude-haiku-4-5 (2026-09-26), acortada sin cambiar su forma. */
const RAW_HAIKU_SUCCESS = [
  "```json",
  "{",
  '  "status": "SUCCESS",',
  '  "codeSlice": [',
  '    "using UnityEngine;",',
  '    "",',
  '    "public static class Utilities",',
  '    "{",',
  '    "    public static bool AreVerticalOrHorizontalNeighbors(Shape s1, Shape s2)",',
  '    "    {",',
  '    "        return s1.Column == s2.Column;",',
  '    "    }",',
  '    "}"',
  "  ]",
  "}",
  "```",
].join("\n");

describe("recortador de métodos", () => {
  const profile = unityPromptProfile({
    rootPath: "/proyecto",
    ecosystemId: "unity",
    sourceRoots: [],
    sources: [],
  });
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "utia-recortador-"));
  });

  after(async () => {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });

  const slice = (raw: string) =>
    runMethodSlicer(
      { profile, code: "class X {}", className: CLASS_NAME, methodName: METHOD_NAME, workspaceRoot },
      async () => raw
    );

  it("acepta un recorte válido aunque el estado de éxito tenga otro nombre", async () => {
    const result = await slice(RAW_HAIKU_SUCCESS);

    if (result.status !== "READY") {
      assert.fail(`se esperaba READY y llegó ${result.status}`);
    }
    assert.equal(result.codeSlice.length, 9);
    assert.match(result.codeSlice[4], /AreVerticalOrHorizontalNeighbors\(Shape s1, Shape s2\)/);
  });

  it("un error declarado sigue siendo un error, aunque traiga un recorte", async () => {
    const raw = JSON.stringify({ status: "ERROR", message: "no está el método", codeSlice: [] });

    assert.deepEqual(await slice(raw), { status: "ERROR", message: "no está el método" });
  });

  it("sin recorte, un estado desconocido sigue siendo ilegible", async () => {
    const result = await slice(JSON.stringify({ status: "SUCCESS" }));

    assert.equal(result.status, "ERROR");
  });

  it("un recorte que no es una lista de líneas sigue siendo ilegible", async () => {
    const result = await slice(JSON.stringify({ status: "SUCCESS", codeSlice: [1, 2] }));

    assert.equal(result.status, "ERROR");
  });
});
