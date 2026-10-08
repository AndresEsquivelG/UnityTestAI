import * as fsp from "fs/promises";
import { FictitiousAdapter } from "../support/fictitiousAdapter";
import { createFictitiousFixture } from "../support/fictitiousFixture";
import { describeAdapterContract } from "./adapterContract";

describeAdapterContract({
  name: "ficticio",
  createAdapter: () => new FictitiousAdapter(),

  async createProject() {
    const fixture = await createFictitiousFixture();
    return {
      rootPath: fixture.projectRoot,
      breakPreconditions: () => fsp.rm(fixture.testsDir, { recursive: true, force: true }),
      dispose: () => fixture.dispose(),
    };
  },

  knownUnit: { className: "Calculadora", methodName: "sumar" },
  knownDependency: "Registro",
  generatedCode: [
    "```fic",
    "usar Calculadora",
    "",
    "unidad CualquierNombre {",
    "  funcion prueba_suma() {",
    "    afirmar Calculadora.sumar(1, 2) == 3",
    "  }",
    "}",
    "```",
  ].join("\n"),
});
