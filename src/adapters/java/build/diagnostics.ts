import type { Diagnostic } from "../../../core/contracts";
import type { SupportedBuildTool } from "../discovery/layout";

/**
 * Errores y avisos del compilador en la salida de Maven o de Gradle.
 *
 * Los dos pasan los mensajes de `javac`, pero con distinta forma, y los dos
 * los escriben dos veces (en el momento y en el resumen del final), así que
 * se descartan los repetidos.
 *
 * **Sin código.** `javac` no da un código por error, como `CS0246` en C#.
 * Tiene una opción oculta que lo da (`-XDrawDiagnostics`, comprobada con
 * Maven compilando en un proceso aparte), pero a cambio quita la ruta del
 * archivo y cambia el mensaje por claves internas que no lee ni una persona
 * ni el modelo que corrige. Se conservan la ruta y el mensaje.
 */
export function parseCompilerOutput(
  output: string,
  rootPath: string,
  tool: SupportedBuildTool
): Diagnostic[] {
  return tool === "maven" ? parseMavenOutput(output, rootPath) : parseJavacOutput(output, rootPath);
}

/**
 * Maven: `[ERROR] /D:/Proyecto/src/test/java/com/x/P.java:[11,31] incompatible types: …`.
 * La ruta es absoluta, con «/» y una barra delante de la unidad en Windows.
 * Lo que sigue en las líneas siguientes sin la marca (o con la marca y
 * sangría, en el resumen) es parte del mismo mensaje: `symbol:` y `location:`.
 */
const MAVEN_DIAGNOSTIC = /^\[(ERROR|WARNING)\] (.+?\.java):\[(\d+),(\d+)\] (.*)$/;
const MAVEN_CONTINUATION = /^(?:\[(?:ERROR|WARNING)\])?\s{2,}(\S.*)$/;

export function parseMavenOutput(output: string, rootPath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let current: { diagnostic: Diagnostic; extra: string[] } | undefined;

  const flush = () => {
    if (current) {
      diagnostics.push(withDetails(current.diagnostic, current.extra));
      current = undefined;
    }
  };

  for (const line of output.split(/\r?\n/)) {
    const match = MAVEN_DIAGNOSTIC.exec(line);
    if (match) {
      flush();
      const [, level, file, lineNumber, column, message] = match;
      current = {
        diagnostic: {
          filePath: toProjectRelative(file, rootPath),
          line: Number(lineNumber),
          column: Number(column),
          severity: level === "ERROR" ? "error" : "warning",
          message: message.trim(),
        },
        extra: [],
      };
      continue;
    }

    const continuation = current ? MAVEN_CONTINUATION.exec(line) : null;
    if (current && continuation) {
      current.extra.push(continuation[1].trim());
      continue;
    }
    flush();
  }
  flush();

  return unique(diagnostics);
}

/**
 * El formato de `javac`, que Gradle muestra tal cual:
 *
 *     D:\Proyecto\src\test\java\com\x\P.java:11: error: incompatible types: …
 *             String texto = sut.add(1, 2);
 *                                   ^
 *       symbol:   method sumar(int,int)
 *
 * Sin columna en el encabezado: sale de la posición de «^» bajo la línea de
 * código. En el resumen del final todo va con dos espacios más de sangría,
 * así que la columna se cuenta desde la sangría del encabezado.
 */
const JAVAC_DIAGNOSTIC = /^(\s*)(.+?\.java):(\d+): (error|warning): (.*)$/;

export function parseJavacOutput(output: string, rootPath: string): Diagnostic[] {
  const lines = output.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];

  for (let index = 0; index < lines.length; index++) {
    const match = JAVAC_DIAGNOSTIC.exec(lines[index]);
    if (!match) {
      continue;
    }
    const [, indent, file, lineNumber, severity, message] = match;

    // Después del encabezado vienen la línea de código y la del «^», y
    // después los detalles con más sangría, hasta lo que no sea del bloque.
    let column: number | undefined;
    let next = index + 1;
    const caretLine = lines[index + 2];
    if (caretLine !== undefined && caretLine.trim() === "^" && !JAVAC_DIAGNOSTIC.test(lines[index + 1] ?? "")) {
      column = caretLine.indexOf("^") - indent.length + 1;
      next = index + 3;
    }
    const extra: string[] = [];
    for (; next < lines.length; next++) {
      const detail = /^\s+(\w+:\s.*)$/.exec(lines[next]);
      if (!detail || !lines[next].startsWith(`${indent}  `) || JAVAC_DIAGNOSTIC.test(lines[next])) {
        break;
      }
      extra.push(detail[1].trim());
    }

    diagnostics.push(
      withDetails(
        {
          filePath: toProjectRelative(file, rootPath),
          line: Number(lineNumber),
          ...(column === undefined ? {} : { column }),
          severity: severity as Diagnostic["severity"],
          message: message.trim(),
        },
        extra
      )
    );
  }

  return unique(diagnostics);
}

/** «cannot find symbol» solo no dice cuál: el detalle va en el mismo mensaje. */
function withDetails(diagnostic: Diagnostic, extra: readonly string[]): Diagnostic {
  return extra.length === 0
    ? diagnostic
    : { ...diagnostic, message: `${diagnostic.message}; ${extra.map((line) => line.replace(/\s+/g, " ")).join("; ")}` };
}

function unique(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.filePath}|${diagnostic.line}|${diagnostic.column ?? ""}|${diagnostic.severity}|${diagnostic.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Ruta relativa a la raíz y con «/», como el resto del modelo. Maven escribe
 * `/D:/…`; Gradle, `D:\…`. Se compara sin distinguir mayúsculas, porque en
 * Windows la unidad puede venir en otra.
 */
export function toProjectRelative(file: string, rootPath: string): string {
  const normalized = file.replace(/\\/g, "/").replace(/^\/([A-Za-z]:\/)/, "$1");
  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
}
