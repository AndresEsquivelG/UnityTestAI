import * as fsp from "fs/promises";
import { JavaAdapter } from "../../adapters/java/javaAdapter";
import { createJavaFixture } from "../support/javaFixture";
import { describeAdapterContract } from "./adapterContract";

describeAdapterContract({
  name: "Java",
  createAdapter: () => new JavaAdapter(),

  async createProject() {
    const fixture = await createJavaFixture();
    return {
      rootPath: fixture.projectRoot,
      // La única precondición de Java: la carpeta del paquete de la prueba.
      breakPreconditions: () => fsp.rm(fixture.testPackageDir, { recursive: true, force: true }),
      dispose: () => fixture.dispose(),
    };
  },

  knownUnit: { className: "Carrito", methodName: "agregar" },
  // Calificado a propósito: es la forma en que Java nombra un tipo de otro
  // paquete, y la que el adaptador tiene que traducir a una ruta.
  knownDependency: "com.tienda.modelo.Item",
  generatedCode: [
    "```java",
    "package com.otro;",
    "",
    "import org.junit.jupiter.api.Test;",
    "import static org.junit.jupiter.api.Assertions.*;",
    "",
    "class CualquierNombre {",
    "    @Test",
    "    void agregaUnItem() {",
    "        assertEquals(1, 1);",
    "    }",
    "}",
    "```",
  ].join("\n"),
});
