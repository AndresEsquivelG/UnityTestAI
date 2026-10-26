import type { Diagnostic } from "../../../core/contracts";

/**
 * El revisor de la prueba: un guion de Python que junta todos los errores de
 * importación y de nombres de una vez, antes de que pytest la recolecte.
 *
 * **Por qué.** pytest importa la prueba de un tirón, y Python se detiene en el
 * primer error: con cuatro errores, el corrector recibe uno por ronda y tiene
 * tres. Además, un nombre sin definir dentro de una función pytest no lo ve
 * hasta ejecutar, donde no hay corrección (decisión de Andrés del
 * 2026-10-15). El revisor los ve todos: con una prueba de cuatro errores,
 * pytest mostró uno y el revisor los cuatro, en 0,3 s. Aprobado por Andrés el
 * 2026-10-25.
 *
 * **Qué hace**, con solo la biblioteca estándar:
 *
 *   1. lee el archivo con `ast`; si hay un error de sintaxis, lo informa y no
 *      sigue, porque sin leerlo no se puede revisar nada más (el lector de
 *      Python se detiene en el primero);
 *   2. importa cada `import` por separado, así uno roto no tapa a los demás;
 *   3. busca los nombres que se usan y nadie define, en todo el archivo, con
 *      `symtable`, que sabe en qué parte del código vale cada nombre.
 *
 * Un error en el código del proyecto, y no en la prueba (una biblioteca que
 * falta, un `input()` al importar, un proyecto con `src/` sin instalar), va con
 * el archivo y la línea del proyecto: el núcleo corta sin llamar al corrector,
 * porque corregir la prueba no lo arregla.
 *
 * **Qué no ve:** un método que no existe o un argumento de más, que solo se
 * saben al ejecutar. Por eso pytest recolecta después igual, y es el que
 * tiene la última palabra.
 *
 * El guion va como texto y se lanza con `python -c`: no hay que instalar ni
 * copiar nada, ni se escribe nada en el proyecto. Se corre desde la raíz, así
 * que importa los módulos del proyecto igual que pytest (y corre su código,
 * como pytest).
 */
export const REVIEW_SCRIPT = String.raw`
import ast
import builtins
import contextlib
import importlib
import io
import json
import os
import symtable
import sys
import traceback

path = sys.argv[1]
root = os.getcwd()
test_file = os.path.relpath(os.path.abspath(path), root)
with open(path, encoding="utf-8") as handle:
    source = handle.read()
errors = []


def report(line, code, message, file=test_file, column=None):
    error = {"file": file, "line": line, "code": code, "message": message}
    if column:
        error["column"] = column
    errors.append(error)


def finish():
    errors.sort(key=lambda e: (e["file"] != test_file, e["line"]))
    print("UTIA-REVIEW:" + json.dumps(errors, ensure_ascii=False))
    sys.exit(0)


# 1. Sintaxis.
try:
    tree = ast.parse(source, filename=path)
except SyntaxError as e:
    report(e.lineno or 1, type(e).__name__, e.msg, column=e.offset)
    finish()


# 2. Cada import por separado.
def comparable(p):
    return os.path.normcase(os.path.abspath(p))


installed = {comparable(p) for p in (sys.prefix, sys.base_prefix)}
root_prefix = comparable(root) + os.sep


def in_project(file):
    if not file.startswith(root_prefix) or "site-packages" in file:
        return False
    return not any(file.startswith(prefix + os.sep) for prefix in installed)


def report_elsewhere(error, line, message):
    # El último renglón de la traza que es del proyecto; si no hay ninguno,
    # el último que es un archivo, aunque sea de lo instalado. Nunca la prueba:
    # ella pidió algo que existe, y lo que falló está adentro.
    project, last = None, None
    for frame in traceback.extract_tb(error.__traceback__):
        if frame.filename.startswith("<") or not os.path.isfile(frame.filename):
            continue
        last = (frame.filename, frame.lineno)
        if in_project(comparable(frame.filename)):
            project = (os.path.relpath(os.path.abspath(frame.filename), root), frame.lineno)
    if project:
        report(project[1], type(error).__name__, message, file=project[0])
    elif last:
        report(last[1], type(error).__name__, message, file=os.path.abspath(last[0]))
    else:
        report(line, type(error).__name__, message, file="<entorno>")


def try_import(name, line):
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as e:
        # Si lo que falta es lo que pide la prueba, el error es de la prueba;
        # si falta algo que importa el código del proyecto, es del proyecto.
        if e.name is not None and (name == e.name or name.startswith(e.name + ".")):
            report(line, "ModuleNotFoundError", str(e))
        else:
            report_elsewhere(e, line, str(e))
    except (Exception, SystemExit) as e:
        report_elsewhere(e, line, "al importar '%s': %s" % (name, e))
    return None


# Los nombres que llegan con «from x import *». Si uno de esos módulos no se
# pudo importar, o es relativo, no se sabe qué nombres trae, y no se buscan
# nombres sin definir: darían falsas alarmas.
star_names = set()
star_unknown = False


def check_imports():
    global star_unknown
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                try_import(alias.name, node.lineno)
        elif isinstance(node, ast.ImportFrom):
            star = any(alias.name == "*" for alias in node.names)
            if node.level > 0 or not node.module:
                # Relativo («from . import x»): depende del paquete de las
                # pruebas y lo resuelve pytest al recolectar. Sus nombres
                # cuentan como definidos, porque symtable los ve importados.
                star_unknown = star_unknown or star
                continue
            module = try_import(node.module, node.lineno)
            if module is None:
                star_unknown = star_unknown or star
                continue
            for alias in node.names:
                if alias.name == "*":
                    public = getattr(module, "__all__", None)
                    if public is None:
                        public = [n for n in dir(module) if not n.startswith("_")]
                    star_names.update(public)
                    continue
                if hasattr(module, alias.name):
                    continue
                try:
                    importlib.import_module(node.module + "." + alias.name)
                except ImportError:
                    report(node.lineno, "ImportError",
                           "cannot import name '%s' from '%s'" % (alias.name, node.module))


# Lo que imprima el código del proyecto al importarse no se mezcla con el resultado.
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    check_imports()

# 3. Nombres que se usan y nadie define.
if not star_unknown:
    top = symtable.symtable(source, path, "exec")
    defined = set(dir(builtins)) | {"__file__", "__name__", "__doc__", "__builtins__"}
    defined |= star_names
    defined |= {s.get_name() for s in top.get_symbols()
                if s.is_assigned() or s.is_imported() or s.is_namespace()}
    missing = set()

    def visit(table):
        for symbol in table.get_symbols():
            name = symbol.get_name()
            if not symbol.is_referenced() or name in defined:
                continue
            if table.get_type() == "module" or symbol.is_global():
                missing.add(name)
        for child in table.get_children():
            visit(child)

    visit(top)
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in missing:
            report(node.lineno, "NameError", "name '%s' is not defined" % node.id,
                   column=node.col_offset + 1)

finish()
`;

/** Marca de la línea con el resultado del revisor. */
const REVIEW_MARK = "UTIA-REVIEW:";

interface ReviewEntry {
  readonly file?: unknown;
  readonly line?: unknown;
  readonly column?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
}

/**
 * Los errores que encontró el revisor, con las rutas relativas a la raíz y con
 * «/» como las guarda el contrato. `undefined` si el revisor no llegó a
 * contestar (un Python muy viejo, un error del propio guion): entonces manda
 * solo pytest, que es la comprobación de verdad.
 */
export function parseReview(stdout: string): Diagnostic[] | undefined {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((text) => text.startsWith(REVIEW_MARK));
  if (!line) {
    return undefined;
  }

  let entries: unknown;
  try {
    entries = JSON.parse(line.slice(REVIEW_MARK.length));
  } catch {
    return undefined;
  }
  if (!Array.isArray(entries)) {
    return undefined;
  }

  const diagnostics: Diagnostic[] = [];
  for (const entry of entries as ReviewEntry[]) {
    if (typeof entry.file !== "string" || typeof entry.line !== "number" || typeof entry.message !== "string") {
      continue;
    }
    diagnostics.push({
      filePath: entry.file.replace(/\\/g, "/"),
      line: entry.line,
      ...(typeof entry.column === "number" ? { column: entry.column } : {}),
      severity: "error",
      ...(typeof entry.code === "string" ? { code: entry.code } : {}),
      message: entry.message,
    });
  }
  return diagnostics;
}
