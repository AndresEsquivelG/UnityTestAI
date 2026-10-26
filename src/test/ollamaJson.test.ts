import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { generateWithOllama } from "../llm/llamaLocal";

/**
 * El pedido que le llega a Ollama, sin Ollama: se reemplaza `fetch` por uno
 * que guarda el cuerpo del pedido y contesta con un flujo mínimo, como el de
 * su API compatible con la de OpenAI.
 *
 * Comprueba que `{ json: true }` llegue como `response_format`, que es lo que
 * hace que Ollama solo deje escribir JSON válido: sin esto, qwen2.5-coder:14b
 * devolvió un JSON roto al recortador (2026-10-26).
 */

const originalFetch = globalThis.fetch;

function streamOf(text: string): Response {
  const chunk = (body: object) => `data: ${JSON.stringify(body)}\n\n`;
  const base = { id: "x", object: "chat.completion.chunk", created: 0, model: "qwen2.5-coder:14b" };
  const sse =
    chunk({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] }) +
    chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } }) +
    "data: [DONE]\n\n";
  return new Response(sse, { headers: { "Content-Type": "text/event-stream" } });
}

/** Reemplaza `fetch` y devuelve los cuerpos de los pedidos que le lleguen. */
function captureRequests(answer: string): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return streamOf(answer);
  }) as typeof fetch;
  return bodies;
}

describe("los pedidos a Ollama", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("con json, piden un objeto JSON a Ollama", async () => {
    const bodies = captureRequests('{"status": "READY"}');

    const result = await generateWithOllama([{ role: "user", content: "x" }], "qwen2.5-coder:14b", { json: true });

    assert.equal(result.text, '{"status": "READY"}');
    assert.deepEqual(bodies[0].response_format, { type: "json_object" });
    assert.equal(bodies[0].temperature, 0);
  });

  it("sin json, como el generador, no piden nada más", async () => {
    const bodies = captureRequests("def test_a():\n    assert True");

    await generateWithOllama([{ role: "user", content: "x" }], "qwen2.5-coder:14b");

    assert.equal(bodies[0].response_format, undefined);
  });
});
