import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  artifactRelativePath,
  describeViolations,
  renderProjectTree,
  resolveDependencies,
} from "../core/project";
import type {
  ArtifactSpec,
  DependencyResolution,
  EcosystemAdapter,
  ProjectModel,
  SourceFile,
} from "../core/contracts";
import { createStubAdapter } from "./support/stubAdapter";

function model(relativePaths: string[]): ProjectModel {
  const sources: SourceFile[] = relativePaths.map((relativePath) => ({
    relativePath,
    name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    sourceRoot: "main",
  }));

  return {
    rootPath: "/proyecto",
    ecosystemId: "inventado",
    sourceRoots: [],
    sources,
  };
}

describe("dibujo del modelo del proyecto", () => {
  it("dibuja la jerarquía con dos espacios por nivel", () => {
    const tree = renderProjectTree(
      model(["src/main/Player.java", "src/main/Enemy.java", "pom.xml"]),
    );

    assert.equal(
      tree,
      [
        "- src",
        "  - main",
        "    - Enemy.java",
        "    - Player.java",
        "- pom.xml",
      ].join("\n"),
    );
  });

  it("pone las carpetas antes que los archivos del mismo nivel", () => {
    const tree = renderProjectTree(model(["zeta/A.py", "alfa.py"]));

    assert.equal(tree, ["- zeta", "  - A.py", "- alfa.py"].join("\n"));
  });

  it("devuelve la cadena vacía cuando el modelo no tiene fuentes", () => {
    // Quien arma el prompt aplica entonces su propio texto de reemplazo.
    assert.equal(renderProjectTree(model([])), "");
  });

  it("no depende del orden en que vengan las fuentes", () => {
    const paths = ["b/Dos.cs", "a/Uno.cs", "b/Uno.cs"];

    assert.equal(
      renderProjectTree(model(paths)),
      renderProjectTree(model([...paths].reverse())),
    );
  });
});

describe("ruta del artefacto", () => {
  it("compone carpeta, nombre y extensión con separador de barra", () => {
    const spec: ArtifactSpec = {
      directory: "src/test/java",
      fileName: "PlayerTest",
      extension: ".java",
      unitName: "PlayerTest",
    };

    assert.equal(artifactRelativePath(spec), "src/test/java/PlayerTest.java");
  });
});

describe("presentación de los incumplimientos", () => {
  it("acompaña cada mensaje con su instrucción de subsanación", () => {
    const text = describeViolations([
      { code: "a", message: "Falta la carpeta.", remediation: "Creála." },
      { code: "b", message: "Falta el descriptor.", remediation: "Agregalo." },
    ]);

    assert.equal(
      text,
      "Falta la carpeta.\n  → Creála.\nFalta el descriptor.\n  → Agregalo.",
    );
  });

  it("devuelve la cadena vacía cuando no hay ninguno", () => {
    assert.equal(describeViolations([]), "");
  });
});

describe("lectura de las dependencias resueltas", () => {
  /** Adaptador inventado que resuelve solo las referencias indicadas. */
  function resolver(
    resolve: (reference: string) => DependencyResolution,
  ): EcosystemAdapter {
    return createStubAdapter({
      id: "resolvedor",
      override: {
        resolveDependency: async (_project, reference) => resolve(reference),
      },
    });
  }

  it("concatena lo encontrado y anota lo que no se pudo resolver", async () => {
    const adapter = resolver((reference) =>
      reference === "Player"
        ? {
            resolved: true,
            relativePath: "Assets/Scripts/Player.cs",
            content: "class Player {}",
          }
        : { resolved: false, reference, triedPaths: [`${reference}.cs`] },
    );

    const result = await resolveDependencies(adapter, model([]), [
      "Player",
      "Fantasma",
    ]);

    assert.equal(
      result.code,
      "\n\n// File: Assets/Scripts/Player.cs\nclass Player {}",
    );
    assert.deepEqual(
      result.files.map((file) => ({
        reference: file.reference,
        found: file.found,
      })),
      [
        { reference: "Player", found: true },
        { reference: "Fantasma", found: false },
      ],
    );
  });

  it("nombra la dependencia por la ruta con la que la resolvió el adaptador", async () => {
    const adapter = resolver(() => ({
      resolved: true,
      relativePath: "Assets/Scripts/Player.cs",
      content: "",
    }));

    const result = await resolveDependencies(adapter, model([]), ["Player"]);

    assert.equal(result.files[0].relativePath, "Assets/Scripts/Player.cs");
  });

  it("no lee nada cuando el agente no pidió dependencias", async () => {
    // El adaptador de mentira lanza en `resolveDependency`: si se invocara, la
    // prueba fallaría.
    const adapter = createStubAdapter({ id: "resolvedor" });

    const result = await resolveDependencies(adapter, model([]), []);

    assert.deepEqual(result, { code: "", files: [] });
  });
});
