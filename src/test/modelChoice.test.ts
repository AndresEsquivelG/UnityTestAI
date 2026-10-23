import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as http from "http";
import type { AddressInfo } from "net";
import { baseArtifactName } from "../adapters/shared/artifactName";
import { thinkingFor } from "../llm/claude";
import { artifactModelId, CLAUDE_MODELS, OPENAI_MODELS } from "../llm/models";
import { listOllamaModels } from "../llm/ollamaModels";

/**
 * Elegir el modelo en el panel: la lista de la nube, la de Ollama y el nombre
 * de la prueba, que lleva proveedor y modelo para que dos modelos del mismo
 * proveedor no se pisen.
 */

describe("elegir el modelo", () => {
  describe("nombre de la prueba", () => {
    it("lleva el proveedor y el modelo, como identificador", () => {
      const name = (provider: string, model: string) =>
        baseArtifactName(artifactModelId(provider, model), "Carrito", "agregar");

      assert.equal(name("llamaLocal", "qwen2.5:14b"), "UTIA_ollama_qwen2_5_14b_Carrito_agregar");
      assert.equal(name("claude", "claude-haiku-4-5"), "UTIA_anthropic_claude_haiku_4_5_Carrito_agregar");
      assert.equal(name("chatgpt", "gpt-6.1-sol"), "UTIA_openai_gpt_6_1_sol_Carrito_agregar");
    });

    it("dos modelos del mismo proveedor dan nombres distintos", () => {
      assert.notEqual(
        baseArtifactName(artifactModelId("llamaLocal", "qwen2.5:14b"), "Carrito", "agregar"),
        baseArtifactName(artifactModelId("llamaLocal", "qwen2.5-coder:14b"), "Carrito", "agregar")
      );
    });

    it("dice con qué se generó en una forma que se lee", () => {
      assert.equal(artifactModelId("llamaLocal", "qwen2.5:14b"), "ollama/qwen2.5:14b");
    });
  });

  describe("lista de la nube", () => {
    it("Haiku 4.5 va primero, con presupuesto fijo; los demás de Claude usan razonamiento adaptativo", () => {
      assert.equal(CLAUDE_MODELS[0].id, "claude-haiku-4-5");
      assert.equal(thinkingFor(CLAUDE_MODELS[0].id).type, "enabled");
      for (const model of CLAUDE_MODELS.slice(1)) {
        assert.deepEqual(thinkingFor(model.id), { type: "adaptive" }, model.id);
      }
    });

    it("no repite modelos y cada uno tiene su nombre para el menú", () => {
      for (const list of [CLAUDE_MODELS, OPENAI_MODELS]) {
        assert.equal(new Set(list.map((model) => model.id)).size, list.length);
        assert.ok(list.every((model) => model.label.length > 0));
      }
    });
  });

  describe("modelos de Ollama", () => {
    /** Lo que contesta el Ollama de mentira en `/api/tags`. */
    let reply: { status: number; body: unknown } = { status: 200, body: {} };
    let server: http.Server;
    let url: string;

    before(async () => {
      server = http.createServer((request, response) => {
        if (request.url !== "/api/tags") {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(reply.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(reply.body));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(() => {
      server.close();
    });

    it("trae los que generan texto, ordenados por nombre", async () => {
      // El orden y los campos son los de Ollama: del más reciente al más viejo.
      reply = {
        status: 200,
        body: {
          models: [
            { name: "qwen2.5-coder:14b", capabilities: ["completion", "tools", "insert"] },
            { name: "nomic-embed-text:latest", capabilities: ["embedding"] },
            { name: "qwen2.5:14b", capabilities: ["completion", "tools"] },
            { name: "llama3:8b" },
          ],
        },
      };

      assert.deepEqual(await listOllamaModels(url), {
        ok: true,
        models: ["llama3:8b", "qwen2.5-coder:14b", "qwen2.5:14b"],
      });
    });

    it("sin modelos, dice cómo bajar uno", async () => {
      reply = { status: 200, body: { models: [] } };
      const result = await listOllamaModels(url);

      assert.ok(!result.ok && /no tiene modelos instalados: bajá uno con «ollama pull qwen2\.5:14b»/.test(result.reason));
    });

    it("si contesta con un error, da el código", async () => {
      reply = { status: 500, body: {} };
      const result = await listOllamaModels(url);

      assert.ok(!result.ok && result.reason.includes("500"));
    });

    it("cerrado, dice que no responde sin esperar de más", async () => {
      const closed = http.createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const port = (closed.address() as AddressInfo).port;
      await new Promise<void>((resolve) => closed.close(() => resolve()));

      const start = Date.now();
      const result = await listOllamaModels(`http://127.0.0.1:${port}`, 1000);

      assert.ok(!result.ok && /Ollama no responde: abrilo y volvé a abrir el panel/.test(result.reason));
      assert.ok(Date.now() - start < 2000);
    });

    it("si acepta la conexión y no contesta, se rinde al pasar el límite", async () => {
      const silent = http.createServer(() => {
        // Nunca contesta: como un Ollama trabado.
      });
      await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
      const port = (silent.address() as AddressInfo).port;

      try {
        const start = Date.now();
        const result = await Promise.race([
          listOllamaModels(`http://127.0.0.1:${port}`, 300),
          new Promise<"colgado">((resolve) => setTimeout(() => resolve("colgado"), 3000)),
        ]);

        assert.notEqual(result, "colgado");
        assert.ok(result !== "colgado" && !result.ok && /no responde/.test(result.reason));
        assert.ok(Date.now() - start < 2000);
      } finally {
        silent.closeAllConnections();
        silent.close();
      }
    });
  });
});
