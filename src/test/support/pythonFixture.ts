import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Proyecto Python de mentira, creado en una carpeta temporal.
 *
 * Cada pieza existe para ejercitar un caso concreto del adaptador:
 *
 *   · `agregar` es un método de `Carrito`, una función anidada adentro de él
 *     usa el mismo patrón, `Carrito.Linea` lo declara otra vez y el módulo
 *     tiene una función `agregar`        → el ámbito de cada declaración
 *   · la documentación, un comentario y un texto con formato con la forma de
 *     una declaración, y un `#` dentro de un texto
 *   · un método con los parámetros en varias líneas, uno estático, una
 *     propiedad, uno asíncrono, uno con dos guiones bajos
 *   · atributos que crea `__init__`, uno que crea otro método y uno que no crea
 *     nadie                               → la ficha
 *   · `Cliente` invoca `agregar` sin declararlo
 *   · `Item` (clase de datos), `Estado` (enumeración) y `Forma` (abstracta) en
 *     `tienda/modelo.py`                  → nombres con puntos y la ficha
 *   · dos `utilidades.py` en paquetes distintos → nombre ambiguo
 *   · `.venv/`, un entorno con otro nombre, `__pycache__/`, `build/` y
 *     `*.egg-info/` con archivos `.py`    → no son fuentes
 *   · `env/` es un paquete del proyecto, no un entorno → sí es fuente
 *   · `tests/` existe
 */
export interface PythonFixture {
  /** Raíz del proyecto, la que contiene `pyproject.toml`. */
  readonly projectRoot: string;
  /** Carpeta de pruebas de la raíz. */
  readonly testDir: string;
  /** Carpeta del paquete `tienda`: en la raíz o dentro de `src/`. */
  readonly packageDir: string;
  dispose(): Promise<void>;
}

export interface PythonFixtureOptions {
  /** Dónde está el paquete. Por defecto, en la raíz. */
  readonly layout?: "flat" | "src";
  /** Marcador del proyecto en la raíz. Por defecto, `pyproject.toml`. */
  readonly marker?: "pyproject.toml" | "setup.py" | "requirements.txt" | null;
}

const PYPROJECT = `[project]
name = "tienda"
version = "0.1.0"
`;

export const CARRITO = `"""Carrito de compras.

def agregar(self, falso): este texto de documentación no es una declaración.
"""
from decimal import Decimal

from tienda.modelo import Item

# def agregar(self, comentario): un comentario tampoco cuenta


class Carrito:
    """Un carrito. class Falsa: tampoco cuenta."""

    impuesto = Decimal("0.13")

    def __init__(self, items=None, *, descuento=0):
        self.items = list(items or [])
        self.descuento = descuento
        self._cache = {}

    def agregar(self, item: Item, cantidad: int = 1) -> None:
        aviso = f"{item.nombre} x{cantidad}: def falso(): {{no}} {'#'}"
        if cantidad <= 0:
            raise ValueError("cantidad")

        def validar(x):
            return x is not None

        for _ in range(cantidad):
            if validar(item):
                self.items.append(item)
        self._recalcular()
        self.ultimo_aviso = aviso

    @property
    def total(self):
        return sum(item.precio for item in self.items)

    def _recalcular(self):
        self._cache["total"] = self.total
        self.cantidad = len(self.items)

    def __privado(self):
        return self.cupon

    def con_cupon(self):
        return self.cupon + self.cantidad

    @staticmethod
    def redondear(valor):
        return round(valor, 2)

    async def sincronizar(self, cliente):
        await cliente.enviar(self.items)

    def vaciar(self,
               confirmar=True,
               motivo=("a", "b")):
        if confirmar:
            self.items.clear()

    class Linea:
        def agregar(self, item):
            return item


def agregar(carrito, item):
    """Función de módulo con el mismo nombre que el método."""
    carrito.agregar(item)
`;

export const MODELO = `from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum


@dataclass
class Item:
    nombre: str
    precio: float = 0.0


class Estado(Enum):
    NUEVO = 1
    PAGADO = 2


class Forma(ABC):
    @abstractmethod
    def area(self) -> float:
        ...

    def describir(self):
        return f"área {self.area():.2f}"
`;

const CLIENTE = `from tienda.carrito import Carrito


class Cliente:
    def __init__(self):
        self.carrito = Carrito()

    def comprar(self, item):
        self.carrito.agregar(item)
`;

const UTILIDADES = `class Utilidades:
    pass
`;

export async function createPythonFixture(options: PythonFixtureOptions = {}): Promise<PythonFixture> {
  const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "unitytestia-python-"));
  const packageDir =
    options.layout === "src" ? path.join(projectRoot, "src", "tienda") : path.join(projectRoot, "tienda");
  const testDir = path.join(projectRoot, "tests");

  const marker = options.marker === undefined ? "pyproject.toml" : options.marker;
  if (marker !== null) {
    await write(path.join(projectRoot, marker), marker === "pyproject.toml" ? PYPROJECT : "pytest\n");
  }

  await write(path.join(packageDir, "__init__.py"), "");
  await write(path.join(packageDir, "carrito.py"), CARRITO);
  await write(path.join(packageDir, "modelo.py"), MODELO);
  await write(path.join(packageDir, "cliente.py"), CLIENTE);
  await write(path.join(packageDir, "utilidades.py"), UTILIDADES);
  await write(path.join(packageDir, "extra", "__init__.py"), "");
  await write(path.join(packageDir, "extra", "utilidades.py"), UTILIDADES);

  // Lo que no es del proyecto, aunque tenga archivos .py.
  await write(path.join(projectRoot, ".venv", "pyvenv.cfg"), "home = C:\\Python314\n");
  await write(path.join(projectRoot, ".venv", "Lib", "site-packages", "fantasma.py"), "class Carrito: pass\n");
  await write(path.join(projectRoot, "entorno", "pyvenv.cfg"), "home = C:\\Python314\n");
  await write(path.join(projectRoot, "entorno", "fantasma.py"), "class Carrito: pass\n");
  await write(path.join(packageDir, "__pycache__", "fantasma.py"), "class Carrito: pass\n");
  await write(path.join(projectRoot, "build", "lib", "tienda", "carrito.py"), CARRITO);
  await write(path.join(projectRoot, "tienda.egg-info", "fantasma.py"), "class Carrito: pass\n");

  // Un paquete del proyecto que se llama como un entorno, pero no lo es.
  await write(path.join(projectRoot, "env", "__init__.py"), "");
  await write(path.join(projectRoot, "env", "config.py"), "DEBUG = False\n");

  await write(path.join(testDir, "test_existente.py"), "def test_existente():\n    assert True\n");

  return {
    projectRoot,
    testDir,
    packageDir,
    dispose: () => fsp.rm(projectRoot, { recursive: true, force: true }),
  };
}

async function write(target: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, "utf8");
}
