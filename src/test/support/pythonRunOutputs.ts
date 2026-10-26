import * as fsp from "fs/promises";
import * as path from "path";
import type { PythonRunOptions, PythonRunResult, PythonRuntime } from "../../adapters/python/build/runtime";

/**
 * Salidas e informes de pytest 9.1.1 y coverage 7.17.0 (Python 3.14.3,
 * Windows), de corridas reales del 2026-10-25 sobre el proyecto de ejemplo de
 * `pythonFixture.ts`, con cada caso provocado a propósito. Se acortaron sin
 * cambiar su forma; las rutas se arman con la raíz de cada prueba. Las del
 * entorno virtual, que en la corrida real estaba en otra unidad, quedaron con
 * una ruta inventada de la misma forma.
 *
 * Se usan con un Python de mentira que contesta con ellas y deja los informes
 * donde los dejaría el de verdad.
 */

/** Donde estaba pytest en la corrida real: otra unidad, así que pytest escribe la ruta absoluta. */
const SITE_PACKAGES = "D:\\entornos\\tienda\\Lib\\site-packages";

/** Python mismo, en la misma unidad que el proyecto: pytest lo escribe relativo, subiendo. */
const IMPORTLIB = "..\\..\\Programs\\Python\\Python314\\Lib\\importlib\\__init__.py";

export const COLLECT_OK = `tests/UTIA_prueba_Carrito_agregar_test.py::test_agregar_suma_el_item

1 test collected in 0.04s`;

export const COLLECT_NOTHING = `
no tests collected in 0.01s`;

export function collectSyntaxError(root: string, file: string): string {
  return `
=================================== ERRORS ====================================
________________ ERROR collecting tests/${file} _________________
${SITE_PACKAGES}\\_pytest\\python.py:508: in importtestmodule
    mod = import_path(
${SITE_PACKAGES}\\_pytest\\pathlib.py:596: in import_path
    importlib.import_module(module_name)
${IMPORTLIB}:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
<frozen importlib._bootstrap>:1398: in _gcd_import
    ???
<frozen importlib._bootstrap>:938: in _load_unlocked
    ???
${SITE_PACKAGES}\\_pytest\\assertion\\rewrite.py:348: in _rewrite_test
    tree = ast.parse(source, filename=strfn)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
..\\..\\Programs\\Python\\Python314\\Lib\\ast.py:46: in parse
    return compile(source, filename, mode, flags,
E     File "${path.join(root, "tests", file)}", line 4
E       def test_a(:
E                  ^
E   SyntaxError: invalid syntax
=========================== short test summary info ===========================
ERROR tests/${file}
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
no tests collected, 1 error in 2.25s`;
}

export function collectImportError(root: string, file: string): string {
  return `
=================================== ERRORS ====================================
_________________ ERROR collecting tests/${file} __________________
ImportError while importing test module '${path.join(root, "tests", file)}'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
${IMPORTLIB}:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
tests\\${file}:1: in <module>
    from tienda.carrito import Carrito, Gato
E   ImportError: cannot import name 'Gato' from 'tienda.carrito' (${path.join(root, "tienda", "carrito.py")})
=========================== short test summary info ===========================
ERROR tests/${file}
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
no tests collected, 1 error in 1.79s`;
}

/** El módulo bajo prueba importa una biblioteca que no está instalada: el error es del proyecto. */
export function collectProjectError(root: string, file: string): string {
  return `
=================================== ERRORS ====================================
________________ ERROR collecting tests/${file} _________________
ImportError while importing test module '${path.join(root, "tests", file)}'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
${IMPORTLIB}:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
tests\\${file}:1: in <module>
    from tienda.roto import Roto
tienda\\roto.py:1: in <module>
    import requests_que_no_existe
E   ModuleNotFoundError: No module named 'requests_que_no_existe'
=========================== short test summary info ===========================
ERROR tests/${file}
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
no tests collected, 1 error in 1.60s`;
}

/** Un módulo que pide `input()` al importarse: el último renglón es de pytest, el anterior del proyecto. */
export function collectInputError(file: string): string {
  return `
=================================== ERRORS ====================================
_________________ ERROR collecting tests/${file} _________________
tests\\${file}:1: in <module>
    from tienda.pide import nombre
tienda\\pide.py:1: in <module>
    nombre = input("Nombre: ")
${SITE_PACKAGES}\\_pytest\\capture.py:229: in read
    raise OSError(
E   OSError: pytest: reading from stdin while output is captured!  Consider using \`-s\`.
------------------------------- Captured stdout -------------------------------
Nombre:
=========================== short test summary info ===========================
ERROR tests/${file} - OSError: pytest: reading from stdin while ...
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
no tests collected, 1 error in 1.71s`;
}

/**
 * El error salta dentro de Python mismo (`json`), en la misma unidad que el
 * proyecto: pytest escribe esos renglones relativos, subiendo con «..». El
 * error es de la prueba, que llamó mal a `json.loads`.
 */
export function collectStandardLibraryError(file: string): string {
  return `
=================================== ERRORS ====================================
__________________ ERROR collecting tests/${file} ___________________
tests\\${file}:3: in <module>
    DATOS = json.loads("x")
            ^^^^^^^^^^^^^^^
..\\..\\Programs\\Python\\Python314\\Lib\\json\\__init__.py:352: in loads
    return _default_decoder.decode(s)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^
..\\..\\Programs\\Python\\Python314\\Lib\\json\\decoder.py:345: in decode
    obj, end = self.raw_decode(s, idx=_w(s, 0).end())
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
..\\..\\Programs\\Python\\Python314\\Lib\\json\\decoder.py:363: in raw_decode
    raise JSONDecodeError("Expecting value", s, err.value) from None
E   json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
=========================== short test summary info ===========================
ERROR tests/${file} - json.decoder.JSONDecodeError: Expecting value...
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
no tests collected, 1 error in 0.15s`;
}

/** Lo que contesta el revisor: una línea con la marca y la lista de errores. */
export function reviewAnswer(errors: readonly Record<string, unknown>[]): string {
  return `UTIA-REVIEW:${JSON.stringify(errors)}\n`;
}

export function passingJUnit(module: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="1" time="0.434" timestamp="2026-10-25T22:57:05.719077-06:00" hostname="Andres"><testcase classname="tests.${module}" name="test_agregar_suma_el_item" time="0.016" /></testsuite></testsuites>`;
}

/** Ocho pruebas: pasa, falla una aserción, dos excepciones, una fixture rota, omitida, xfail y una con «é». */
export const MIXED_JUNIT = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="1" failures="3" skipped="2" tests="8" time="0.105" timestamp="2026-10-25T21:38:46.363079-06:00" hostname="Andres"><testcase classname="tests.UTIA_mezcla_test" name="test_pasa" time="0.001" /><testcase classname="tests.UTIA_mezcla_test" name="test_falla_assert" time="0.001"><failure message="AssertionError: assert 'Rex' == 'Firulais'&#10;  &#10;  - Firulais&#10;  + Rex">shop = &lt;patterns.creational.abstract_factory.PetShop object at 0x000001C8A82D9BD0&gt;

    def test_falla_assert(shop):
&gt;       assert shop.buy_pet("Rex").name == "Firulais"
E       AssertionError: assert 'Rex' == 'Firulais'
E
E         - Firulais
E         + Rex

tests\\UTIA_mezcla_test.py:20: AssertionError</failure></testcase><testcase classname="tests.UTIA_mezcla_test" name="test_excepcion_en_el_cuerpo" time="0.000"><failure message="AttributeError: 'PetShop' object has no attribute 'no_existe'">shop = &lt;patterns.creational.abstract_factory.PetShop object at 0x000001C8A82DA5D0&gt;

    def test_excepcion_en_el_cuerpo(shop):
&gt;       shop.no_existe()
        ^^^^^^^^^^^^^^
E       AttributeError: 'PetShop' object has no attribute 'no_existe'

tests\\UTIA_mezcla_test.py:24: AttributeError</failure></testcase><testcase classname="tests.UTIA_mezcla_test" name="test_nameerror_en_el_cuerpo" time="0.000"><failure message="NameError: name 'Gato' is not defined">def test_nameerror_en_el_cuerpo():
&gt;       assert Gato
               ^^^^
E       NameError: name 'Gato' is not defined

tests\\UTIA_mezcla_test.py:28: NameError</failure></testcase><testcase classname="tests.UTIA_mezcla_test" name="test_error_en_fixture" time="0.000"><error message="failed on setup with &quot;RuntimeError: la fixture explota&quot;">@pytest.fixture
    def rota():
&gt;       raise RuntimeError("la fixture explota")
E       RuntimeError: la fixture explota

tests\\UTIA_mezcla_test.py:12: RuntimeError</error></testcase><testcase classname="tests.UTIA_mezcla_test" name="test_omitida" time="0.000"><skipped type="pytest.skip" message="no aplica aquí">D:\\Andrés\\tests\\UTIA_mezcla_test.py:36: no aplica aquí</skipped></testcase><testcase classname="tests.UTIA_mezcla_test" name="test_xfail" time="0.000"><skipped type="pytest.xfail" message="se espera que falle" /></testcase><testcase classname="tests.UTIA_mezcla_test" name="test_imprime_é" time="0.000" /></testsuite></testsuites>`;

/** Lo que deja `--junitxml` cuando el archivo no se pudo importar. */
export const COLLECTION_FAILURE_JUNIT = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="1" failures="0" skipped="0" tests="1" time="0.148" timestamp="2026-10-25T21:38:30.941338-06:00" hostname="Andres"><testcase classname="" name="tests.UTIA_nombre_test" time="0.000"><error message="collection failure">ImportError while importing test module 'D:\\tienda\\tests\\UTIA_nombre_test.py'.
E   ImportError: cannot import name 'Gato' from 'tienda.carrito'</error></testcase></testsuite></testsuites>`;

/**
 * `coverage json` de `tienda/carrito.py` del proyecto de ejemplo, con la prueba
 * que agrega un ítem: `agregar` recorre el `for` y el `if` de adentro, pero
 * nunca con `cantidad <= 0` (25) ni con `validar` falso (31 → 30). Se quitaron
 * los resúmenes y las funciones, que el adaptador no lee.
 */
export const CARRITO_COVERAGE_JSON = JSON.stringify({
  meta: { format: 3, version: "7.17.0", timestamp: "2026-10-25T22:57:08.722413", branch_coverage: true, show_contexts: false },
  files: {
    "tienda\\carrito.py": {
      executed_lines: [5, 7, 12, 15, 17, 18, 19, 20, 22, 23, 24, 27, 28, 30, 31, 32, 33, 34, 36, 37, 38, 40, 41, 42, 44, 47, 50, 51, 54, 57, 63, 64, 68],
      missing_lines: [25, 45, 48, 52, 55, 60, 61, 65, 70],
      excluded_lines: [],
      executed_branches: [
        [24, 27],
        [30, 31],
        [30, 33],
        [31, 32],
      ],
      missing_branches: [
        [24, 25],
        [31, 30],
        [60, -57],
        [60, 61],
      ],
    },
  },
});

/**
 * Un paso de la corrida, según lo que se le pide a Python. `unknown` es un
 * guion que no es ni el sondeo ni el revisor: contesta como un Python que no
 * entendió, sin la línea que se espera.
 */
export type PythonStep = "probe" | "review" | "collect" | "run" | "coverageRun" | "coverageJson" | "unknown";

/** Una corrida del Python de mentira: lo que devuelve y los informes que deja. */
export interface FakePythonResponse {
  readonly exitCode?: number | null;
  readonly stdout?: string;
  readonly output?: string;
  readonly timedOut?: boolean;
  readonly spawnError?: string;
  /** El informe JUnit que deja en la ruta de `--junitxml`. */
  readonly junit?: string;
  /** El informe de coverage que deja en la ruta de `-o`. */
  readonly coverageJson?: string;
}

/** Cómo contesta cada Python al sondeo: qué tiene instalado, o que no es un Python. */
export type FakeInterpreter =
  | { readonly pytest?: boolean; readonly coverage?: boolean; readonly version?: string }
  | "storeAlias"
  | "broken";

export interface FakePythonRun {
  readonly command: string;
  readonly step: PythonStep;
  readonly args: readonly string[];
  readonly options: PythonRunOptions;
}

export interface FakePythonRuntime extends PythonRuntime {
  readonly runs: FakePythonRun[];
  /** Las corridas sin los sondeos. */
  readonly steps: () => PythonStep[];
}

/**
 * Python de mentira. `interpreters` dice cómo contesta cada comando al sondeo;
 * el ejecutable de un entorno virtual, que llega como ruta absoluta, se busca
 * como `venv`. Un comando que no está es como uno que no existe (`ENOENT`).
 * Por defecto, `python` con pytest y coverage. Cada paso contesta con lo que
 * diga `respond`, o si no, como una prueba que pasa.
 */
export function fakePythonRuntime(
  options: {
    readonly interpreters?: Readonly<Record<string, FakeInterpreter>>;
    readonly respond?: (step: PythonStep, args: readonly string[]) => FakePythonResponse | undefined;
  } = {}
): FakePythonRuntime {
  const interpreters = options.interpreters ?? { python: {} };
  const runs: FakePythonRun[] = [];

  return {
    runs,
    steps: () => runs.filter((run) => run.step !== "probe").map((run) => run.step),
    run: async (command, args, runOptions): Promise<PythonRunResult> => {
      const step = stepOf(args);
      runs.push({ command, step, args, options: runOptions });
      const key = path.isAbsolute(command) ? "venv" : command;
      const interpreter = interpreters[key];

      if (interpreter === undefined) {
        return { exitCode: null, timedOut: false, spawnError: `spawn ${command} ENOENT`, stdout: "", output: "" };
      }
      if (step === "probe") {
        if (interpreter === "storeAlias") {
          const output = "no se encontró Python; ejecutar sin argumentos para instalar desde el Microsoft Store";
          return { exitCode: 9009, timedOut: false, stdout: output, output };
        }
        if (interpreter === "broken") {
          const output = "No Python at '\"C:\\Python311\\python.exe'";
          return { exitCode: 103, timedOut: false, stdout: "", output };
        }
        const stdout = `UTIA-PROBE:${JSON.stringify({
          version: interpreter.version ?? "3.14.3",
          pytest: interpreter.pytest ?? true,
          coverage: interpreter.coverage ?? true,
        })}\n`;
        return { exitCode: 0, timedOut: false, stdout, output: stdout };
      }

      const response = (step === "unknown" ? undefined : options.respond?.(step, args)) ?? defaultResponse(step);
      const junitPath = args.find((arg) => arg.startsWith("--junitxml="))?.slice("--junitxml=".length);
      if (junitPath && response.junit !== undefined) {
        await fsp.writeFile(junitPath, response.junit, "utf8");
      }
      const outIndex = args.indexOf("-o");
      if (step === "coverageJson" && outIndex !== -1 && response.coverageJson !== undefined) {
        await fsp.writeFile(args[outIndex + 1], response.coverageJson, "utf8");
      }
      const stdout = response.stdout ?? "";
      return {
        exitCode: response.exitCode === undefined ? 0 : response.exitCode,
        timedOut: response.timedOut ?? false,
        ...(response.spawnError ? { spawnError: response.spawnError } : {}),
        stdout,
        output: response.output ?? stdout,
      };
    },
  };
}

function stepOf(args: readonly string[]): PythonStep {
  const script = args.indexOf("-c");
  if (script !== -1) {
    const text = args[script + 1];
    return text.includes("UTIA-PROBE:") ? "probe" : text.includes("UTIA-REVIEW:") ? "review" : "unknown";
  }
  if (args.includes("--collect-only")) {
    return "collect";
  }
  if (args.includes("coverage")) {
    return args.includes("json") ? "coverageJson" : "coverageRun";
  }
  return "run";
}

function defaultResponse(step: PythonStep): FakePythonResponse {
  switch (step) {
    case "unknown":
      return { exitCode: 1, output: "Traceback (most recent call last):\nNameError: guion desconocido" };
    case "review":
      return { stdout: reviewAnswer([]) };
    case "collect":
      return { output: COLLECT_OK };
    case "coverageJson":
      return { coverageJson: CARRITO_COVERAGE_JSON, output: "Wrote JSON report to coverage.json" };
    default:
      return { junit: passingJUnit("UTIA_prueba_Carrito_agregar_test"), output: ".  [100%]\n1 passed in 0.06s" };
  }
}
