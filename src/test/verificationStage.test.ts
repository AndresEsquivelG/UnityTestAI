import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArtifactSpec, ProjectModel, VerificationResult } from "../core/contracts";
import {
  presentVerification,
  runVerificationStage,
  verificationStageName,
} from "../core/verification";
import { createStubAdapter } from "./support/stubAdapter";

/**
 * Etapa de verificación del núcleo.
 *
 * Se ejercita con adaptadores de mentira a propósito: el de Unity ya declara
 * compilación, así que el camino en el que el adaptador no ofrece verificación
 * no lo recorre ningún ecosistema real, y es el que Python va a necesitar.
 */

const PROJECT: ProjectModel = {
  rootPath: "/proyecto",
  ecosystemId: "mentira",
  sourceRoots: [],
  sources: [],
};

const SPEC: ArtifactSpec = {
  directory: "tests",
  fileName: "prueba",
  extension: ".x",
  unitName: "prueba",
};

describe("etapa de verificación", () => {
  it("si el adaptador no ofrece verificación, la etapa no aplica y no se invoca nada", async () => {
    const adapter = createStubAdapter({ id: "sin-verificacion" });

    assert.deepEqual(await runVerificationStage(adapter, PROJECT, SPEC), {
      status: "notApplicable",
    });
  });

  it("pasa al adaptador el modelo y la especificación, y devuelve su resultado tal cual", async () => {
    const received: unknown[] = [];
    const result: VerificationResult = {
      status: "passed",
      diagnostics: [],
      exitCode: 0,
      rawOutput: "ok",
    };
    const adapter = createStubAdapter({
      id: "compila",
      capabilities: { verification: "compile" },
      optional: {
        verifyArtifact: async (project, spec) => {
          received.push(project, spec);
          return result;
        },
      },
    });

    assert.equal(await runVerificationStage(adapter, PROJECT, SPEC), result);
    assert.deepEqual(received, [PROJECT, SPEC]);
  });

  it("si el adaptador lanza, la corrida sigue y la etapa queda sin ejecutar", async () => {
    const adapter = createStubAdapter({
      id: "roto",
      capabilities: { verification: "importCheck" },
      optional: {
        verifyArtifact: async () => {
          throw new Error("se cayó");
        },
      },
    });

    const outcome = await runVerificationStage(adapter, PROJECT, SPEC);

    assert.ok(outcome.status === "notRun");
    assert.equal(outcome.blocker.code, "core.verification-crashed");
    assert.match(outcome.blocker.message, /se cayó/);
  });

  describe("presentación", () => {
    it("nombra la etapa según la clase de verificación declarada, no según el ecosistema", () => {
      assert.equal(verificationStageName("compile"), "Compilación");
      assert.equal(verificationStageName("importCheck"), "Comprobación de importabilidad");
      assert.equal(verificationStageName("none"), "Verificación");
    });

    it("una etapa que no aplica se informa como tal", () => {
      const presented = presentVerification("none", { status: "notApplicable" });

      assert.equal(presented.status, "notApplicable");
      assert.match(presented.summary, /no aplica/);
      assert.deepEqual(presented.diagnostics, []);
    });

    it("los errores llevan ruta, línea y columna en la forma que el editor enlaza", () => {
      const presented = presentVerification("compile", {
        status: "failed",
        diagnostics: [
          {
            filePath: "tests/prueba.x",
            line: 28,
            column: 9,
            severity: "error",
            code: "E1",
            message: "tipo desconocido",
          },
          { filePath: "tests/prueba.x", line: 40, severity: "error", message: "sin código" },
        ],
        exitCode: 1,
        rawOutput: "",
      });

      assert.equal(presented.summary, "La prueba no pasó la verificación: 2 errores.");
      assert.deepEqual(presented.diagnostics, [
        { severity: "error", location: "tests/prueba.x:28:9", code: "E1", message: "tipo desconocido" },
        { severity: "error", location: "tests/prueba.x:40", code: undefined, message: "sin código" },
      ]);
    });

    it("un resultado sin ejecutar muestra el motivo y cómo resolverlo", () => {
      const presented = presentVerification("compile", {
        status: "notRun",
        blocker: { code: "x", message: "El proyecto está tomado.", remediation: "Liberalo." },
      });

      assert.equal(presented.summary, "No se pudo verificar. El proyecto está tomado.");
      assert.equal(presented.remediation, "Liberalo.");
    });

    it("una verificación superada cuenta los avisos en singular y en plural", () => {
      const warning = {
        filePath: "tests/prueba.x",
        line: 1,
        severity: "warning" as const,
        message: "sin uso",
      };
      const withOne = presentVerification("compile", {
        status: "passed",
        diagnostics: [warning],
        exitCode: 0,
        rawOutput: "",
      });
      const withNone = presentVerification("compile", {
        status: "passed",
        diagnostics: [],
        exitCode: 0,
        rawOutput: "",
      });

      assert.equal(withOne.summary, "La prueba pasó la verificación con 1 aviso.");
      assert.equal(withNone.summary, "La prueba pasó la verificación.");
    });
  });
});
