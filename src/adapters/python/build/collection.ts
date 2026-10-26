import * as path from "path";
import type { Diagnostic } from "../../../core/contracts";

/**
 * Los errores de `pytest --collect-only`, leídos del texto: `--tb` no cambia su
 * forma, y `--junitxml` los guarda con el mismo texto, así que no hay nada más
 * estructurado que leer (comprobado con pytest 9.1.1).
 *
 * Cada archivo que no se pudo importar tiene su bloque, que empieza con
 * `____ ERROR collecting tests/X_test.py ____`. Adentro, dos formas:
 *
 *   · un error de sintaxis trae la ubicación en su propia línea, después de
 *     quince renglones de pytest por dentro:
 *       E     File "D:\…\tests\X_test.py", line 5
 *       E   SyntaxError: invalid syntax
 *   · lo demás, la traza: un renglón `ruta:línea: in <módulo>` por paso, y al
 *     final la excepción:
 *       tests\X_test.py:1: in <module>
 *       patterns\utia_dep.py:1: in <module>
 *       E   ModuleNotFoundError: No module named 'requests'
 *
 * De la traza vale el último renglón que es del proyecto, y no de Python ni de
 * lo instalado. Si es la prueba, el error es de la prueba; si es otro archivo
 * del proyecto, el error está ahí (una biblioteca que falta, un `input()` al
 * importar), y el núcleo no llama al corrector.
 *
 * Python se detiene en el primer error de cada archivo: hay uno por bloque.
 */

const BLOCK_HEADER = /^_+ ERROR collecting (.+?) _+$/;
const BLOCK_END = /^(?:=+ short test summary info =+|!+ Interrupted|=+ .* =+)$/;
const SYNTAX_LOCATION = /^E\s+File "(.+)", line (\d+)/;
const FRAME = /^(\S.*?):(\d+): in \S/;
const EXCEPTION = /^E {3}([A-Za-z_][\w.]*): ?(.*)$/;

export function parseCollectionErrors(output: string, rootPath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let block: string[] | undefined;

  const flush = () => {
    const diagnostic = block ? fromBlock(block, rootPath) : undefined;
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
    block = undefined;
  };

  for (const line of output.split(/\r?\n/)) {
    if (BLOCK_HEADER.test(line)) {
      flush();
      block = [];
      continue;
    }
    if (BLOCK_END.test(line)) {
      flush();
      continue;
    }
    block?.push(line);
  }
  flush();
  return diagnostics;
}

function fromBlock(lines: readonly string[], rootPath: string): Diagnostic | undefined {
  const exception = lines.map((line) => EXCEPTION.exec(line)).find((match) => match !== null);
  if (!exception) {
    return undefined;
  }
  const [, code, message] = exception;

  const syntax = lines.map((line) => SYNTAX_LOCATION.exec(line)).find((match) => match !== null);
  if (syntax) {
    return diagnostic(toProjectRelative(syntax[1], rootPath), Number(syntax[2]), code, message);
  }

  let location: { file: string; line: number } | undefined;
  for (const line of lines) {
    const frame = FRAME.exec(line);
    if (!frame) {
      continue;
    }
    const file = toProjectRelative(frame[1], rootPath);
    if (isProjectFile(file)) {
      location = { file, line: Number(frame[2]) };
    }
  }
  return location ? diagnostic(location.file, location.line, code, message) : undefined;
}

function diagnostic(filePath: string, line: number, code: string, message: string): Diagnostic {
  return { filePath, line, severity: "error", code, message: message.trim() };
}

/**
 * Un archivo del proyecto: debajo de la raíz y fuera de lo instalado. pytest
 * escribe relativo a la raíz todo lo que está en la misma unidad, también
 * Python mismo (`..\..\Programs\Python\Python314\Lib\importlib\__init__.py`,
 * comprobado); lo de otra unidad llega absoluto, y lo instalado lleva
 * `site-packages`.
 */
function isProjectFile(file: string): boolean {
  return (
    !path.isAbsolute(file) &&
    !/^[A-Za-z]:\//.test(file) &&
    !file.startsWith("../") &&
    !file.includes("site-packages") &&
    !file.startsWith("<")
  );
}

/** Relativa a la raíz y con «/», si está debajo de ella; si no, absoluta con «/». */
export function toProjectRelative(file: string, rootPath: string): string {
  const forward = file.replace(/\\/g, "/");
  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  if (path.isAbsolute(file) || /^[A-Za-z]:\//.test(forward)) {
    return forward.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? forward.slice(root.length + 1) : forward;
  }
  return forward.replace(/^\.\//, "");
}
