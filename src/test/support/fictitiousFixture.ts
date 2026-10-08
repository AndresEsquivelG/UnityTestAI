import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Proyecto del ecosistema ficticio, creado en una carpeta temporal.
 *
 * El lenguaje es inventado y mínimo: `unidad` agrupa funciones, `funcion`
 * declara una, `usar` importa una unidad, `#` comenta hasta el final de la
 * línea y las cadenas van entre comillas dobles. Basta para que las
 * operaciones obligatorias del adaptador trabajen sobre archivos de verdad.
 *
 * Como en el proyecto de Unity, cada pieza existe para un caso concreto:
 *
 *   · un comentario y una cadena con la forma de una declaración
 *   · `bitacora.fic` declara `Registro`: el archivo no se llama como su unidad
 *   · `duplicar` se declara fuera de toda unidad → unidad sin clase
 *   · `Principal` invoca `sumar` sin declararlo
 *   · `salida/` y `.cache/` → carpetas que hay que excluir
 *   · `notas.txt` → archivo que no es fuente
 */
export interface FictitiousFixture {
  /** Raíz del proyecto, la carpeta que contiene el marcador. */
  readonly projectRoot: string;
  /** Carpeta de pruebas del proyecto. */
  readonly testsDir: string;
  dispose(): Promise<void>;
}

/** Archivo cuya presencia en la raíz identifica al ecosistema. */
export const FICTITIOUS_MARKER = "ficticio.proyecto";

const CALCULADORA = `usar Registro

# Este comentario declara funcion sumar(x) { y no debe contar.
unidad Calculadora {
  funcion sumar(a, b) {
    Registro.anotar("funcion falsa() {")
    devolver a + b
  }

  funcion dividir(a, b) {
    si b == 0 {
      devolver nada
    }
    devolver a / b
  }
}
`;

const BITACORA = `unidad Registro {
  funcion anotar(texto) {
    devolver texto
  }
}
`;

const UTILES = `funcion duplicar(x) {
  devolver x * 2
}

unidad Contador {
  funcion contar(tope) {
    total = 0
    mientras total < tope {
      total = total + 1
    }
    devolver duplicar(total)
  }
}
`;

const PRINCIPAL = `usar Calculadora

unidad Principal {
  funcion iniciar() {
    sumar(1, 2)
  }
}
`;

const PRUEBA_EXISTENTE = `usar Registro

unidad PruebaRegistroAnotar {
  funcion prueba_devuelve_el_texto() {
    afirmar Registro.anotar("hola") == "hola"
  }
}
`;

export async function createFictitiousFixture(): Promise<FictitiousFixture> {
  const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "ficticio-"));
  const testsDir = path.join(projectRoot, "pruebas");

  await write(path.join(projectRoot, FICTITIOUS_MARKER), "nombre = demo\n");
  await write(path.join(projectRoot, "fuentes", "mates", "calculadora.fic"), CALCULADORA);
  await write(path.join(projectRoot, "fuentes", "bitacora.fic"), BITACORA);
  await write(path.join(projectRoot, "fuentes", "utiles.fic"), UTILES);
  await write(path.join(projectRoot, "fuentes", "principal.fic"), PRINCIPAL);
  await write(path.join(projectRoot, "fuentes", "notas.txt"), "funcion fantasma() {}\n");
  await write(path.join(testsDir, "prueba_registro_anotar.fic"), PRUEBA_EXISTENTE);
  await write(path.join(projectRoot, "salida", "generado.fic"), "unidad Generado {}\n");
  await write(path.join(projectRoot, ".cache", "copia.fic"), "unidad Copia {}\n");

  return {
    projectRoot,
    testsDir,
    dispose: () => fsp.rm(projectRoot, { recursive: true, force: true }),
  };
}

async function write(target: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, "utf8");
}
