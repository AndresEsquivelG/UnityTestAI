import * as fsp from "fs/promises";
import * as path from "path";
import { UnityAdapter } from "../../adapters/unity/unityAdapter";
import { createUnityFixture } from "../support/unityFixture";
import { describeAdapterContract } from "./adapterContract";

describeAdapterContract({
  name: "Unity",
  createAdapter: () => new UnityAdapter(),

  async createProject() {
    const fixture = await createUnityFixture();
    // El proyecto de mentira trae la carpeta de pruebas sin el archivo de
    // definición de ensamblado, que Unity exige para escribir en ella.
    const assemblyDefinition = path.join(fixture.testsDir, "Tests.asmdef");
    await fsp.writeFile(assemblyDefinition, '{ "name": "Tests" }\n', "utf8");

    return {
      rootPath: fixture.projectRoot,
      breakPreconditions: () => fsp.rm(assemblyDefinition),
      dispose: () => fixture.dispose(),
    };
  },

  knownUnit: { className: "Player", methodName: "Move" },
  knownDependency: "Enemy",
  generatedCode: [
    "```csharp",
    "using NUnit.Framework;",
    "",
    "public class CualquierNombre",
    "{",
    "    [Test]",
    "    public void Move_GuardaLaVelocidad() { Assert.Pass(); }",
    "}",
    "```",
  ].join("\n"),
});
