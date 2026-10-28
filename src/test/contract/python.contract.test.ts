import * as fsp from "fs/promises";
import { PythonAdapter } from "../../adapters/python/pythonAdapter";
import { createPythonFixture } from "../support/pythonFixture";
import { describeAdapterContract } from "./adapterContract";

describeAdapterContract({
  name: "Python",
  createAdapter: () => new PythonAdapter(),

  async createProject() {
    const fixture = await createPythonFixture();
    return {
      rootPath: fixture.projectRoot,
      // La única precondición de Python: la carpeta de pruebas.
      breakPreconditions: () => fsp.rm(fixture.testDir, { recursive: true, force: true }),
      dispose: () => fixture.dispose(),
    };
  },

  knownUnit: { className: "Carrito", methodName: "agregar" },
  // La función de módulo con el mismo nombre que el método.
  knownModuleUnit: "agregar",
  // Con puntos y con el nombre de la clase al final, como lo escribe un
  // `import`: es la forma que el adaptador tiene que traducir a una ruta.
  knownDependency: "tienda.modelo.Item",
  generatedCode: [
    "```python",
    "import pytest",
    "",
    "from tienda.carrito import Carrito",
    "",
    "",
    "def test_agregar_no_lanza():",
    "    assert Carrito().items == []",
    "```",
  ].join("\n"),
});
