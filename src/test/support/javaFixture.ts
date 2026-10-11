import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Proyecto Java de mentira, de un solo módulo, creado en una carpeta temporal.
 *
 * Cada pieza existe para ejercitar un caso concreto del adaptador:
 *
 *   · `agregar` declarado dos veces              → sobrecargas
 *   · un comentario, una cadena, un carácter y un bloque de texto con la forma
 *     de una declaración o de una llave
 *   · `agregar` dentro de una clase anónima y de una clase anidada → no son
 *     miembros de `Carrito`
 *   · un método genérico y uno con la anotación en la misma línea
 *   · `Cliente` invoca `agregar` sin declararlo
 *   · `Item` en otro paquete y `Pedido.Estado` anidado → nombres calificados
 *   · dos `Utilidades.java` en paquetes distintos → nombre ambiguo
 *   · `package-info.java` y `target/` → no son fuentes
 *   · `src/test/java/com/tienda/` existe; `.../modelo/` no
 */
export interface JavaFixture {
  /** Raíz del proyecto, la que contiene el descriptor. */
  readonly projectRoot: string;
  /** Carpeta del paquete `com.tienda` en la jerarquía de pruebas. */
  readonly testPackageDir: string;
  dispose(): Promise<void>;
}

export interface JavaFixtureOptions {
  /** Descriptor de construcción en la raíz. Por defecto, `pom.xml`. */
  readonly descriptor?: "pom.xml" | "build.gradle" | "build.gradle.kts" | null;
}

const POM = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.tienda</groupId>
  <artifactId>tienda</artifactId>
  <version>1.0.0</version>
</project>
`;

const CARRITO = `package com.tienda;

import com.tienda.modelo.Item;
import java.util.ArrayList;
import java.util.List;

/**
 * Este comentario declara public void agregar(int falso) { y no debe contar.
 */
public class Carrito {
    private final List<Item> items = new ArrayList<>();
    private final String pista = "public void agregar(String falso) { ";
    private final char llave = '{';
    private final String bloque = """
        public void agregar(double falso) {
        """;

    public void agregar(Item item) {
        agregar(item, 1);
    }

    @Override public String toString() { return "Carrito"; }

    public void agregar(Item item,
                        int cantidad) throws IllegalArgumentException {
        if (cantidad <= 0) {
            throw new IllegalArgumentException("cantidad");
        }
        Runnable aviso = new Runnable() {
            @Override
            public void run() {
                agregar(null);
            }
        };
        for (int i = 0; i < cantidad; i++) {
            items.add(item);
        }
    }

    public static <T extends Comparable<T>> T mayor(List<T> valores) {
        return valores.get(0);
    }

    int total() {
        return items.size();
    }

    static class Linea {
        void agregar(Item item) { }
    }
}
`;

const CLIENTE = `package com.tienda;

import com.tienda.modelo.Item;

public class Cliente {
    private final Carrito carrito = new Carrito();

    public void comprar(Item item) {
        carrito.agregar(item);
    }
}
`;

const ITEM = `package com.tienda.modelo;

public record Item(String nombre, double precio) { }
`;

const PEDIDO = `package com.tienda.modelo;

public class Pedido {
    public enum Estado { NUEVO, PAGADO }

    private Estado estado = Estado.NUEVO;
}
`;

export async function createJavaFixture(options: JavaFixtureOptions = {}): Promise<JavaFixture> {
  const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "unitytestia-java-"));
  const main = path.join(projectRoot, "src", "main", "java", "com", "tienda");
  const testPackageDir = path.join(projectRoot, "src", "test", "java", "com", "tienda");

  const descriptor = options.descriptor === undefined ? "pom.xml" : options.descriptor;
  if (descriptor !== null) {
    await write(path.join(projectRoot, descriptor), descriptor === "pom.xml" ? POM : "plugins { java }\n");
  }

  await write(path.join(main, "Carrito.java"), CARRITO);
  await write(path.join(main, "Cliente.java"), CLIENTE);
  await write(path.join(main, "Utilidades.java"), "package com.tienda;\n\npublic class Utilidades { }\n");
  await write(path.join(main, "package-info.java"), "package com.tienda;\n");
  await write(path.join(main, "modelo", "Item.java"), ITEM);
  await write(path.join(main, "modelo", "Pedido.java"), PEDIDO);
  await write(path.join(main, "modelo", "Utilidades.java"), "package com.tienda.modelo;\n\npublic class Utilidades { }\n");
  await write(path.join(projectRoot, "target", "generated", "Fantasma.java"), "public class Fantasma { }\n");
  await fsp.mkdir(testPackageDir, { recursive: true });

  return {
    projectRoot,
    testPackageDir,
    dispose: () => fsp.rm(projectRoot, { recursive: true, force: true }),
  };
}

async function write(target: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, "utf8");
}
