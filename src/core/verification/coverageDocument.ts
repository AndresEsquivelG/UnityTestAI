import * as fsp from "fs/promises";
import * as path from "path";
import type {
  CoverageMetric,
  CoverageReport,
  CoverageTarget,
  LineCoverageStatus,
  ProjectModel,
} from "../contracts";

/**
 * Datos del informe HTML de cobertura.
 *
 * El informe es una plantilla que se dibuja sola con estos datos, metidos
 * como JSON: así el código fuente nunca pasa por HTML armado a mano, y un
 * `List<int>` del archivo no puede romper la página. Lo arma el núcleo a
 * partir de `CoverageReport`, así que sirve igual para cualquier ecosistema.
 */
export interface CoverageDocument {
  readonly title: string;
  /** Fecha y hora de la medición, en ISO 8601. */
  readonly generatedAt: string;
  /** Nombre de la prueba generada. */
  readonly testName: string;
  readonly target?: { readonly name: string; readonly line: CoverageMetric };
  readonly line: CoverageMetric;
  /** Ausente quiere decir «no disponible». */
  readonly decision?: CoverageMetric;
  readonly notes: readonly string[];
  readonly files: readonly CoverageDocumentFile[];
}

export interface CoverageDocumentFile {
  readonly filePath: string;
  readonly line: CoverageMetric;
  readonly units: readonly {
    readonly name: string;
    readonly firstLine: number;
    readonly line: CoverageMetric;
    readonly isTarget: boolean;
  }[];
  /** El archivo entero, con el estado de las líneas que tienen código medible. */
  readonly source: readonly {
    readonly number: number;
    readonly text: string;
    readonly status?: LineCoverageStatus;
  }[];
  /** Por qué falta el código, si no se pudo leer. */
  readonly sourceError?: string;
}

export async function buildCoverageDocument(
  project: ProjectModel,
  report: CoverageReport,
  target: CoverageTarget,
  testName: string,
  now: Date = new Date()
): Promise<CoverageDocument> {
  const unitLabel = target.unit.className
    ? `${target.unit.className}.${target.unit.methodName}`
    : target.unit.methodName;

  const files: CoverageDocumentFile[] = [];
  for (const file of report.byFile) {
    const statusByLine = new Map(file.lines.map((line) => [line.line, line.status]));
    let source: CoverageDocumentFile["source"] = [];
    let sourceError: string | undefined;
    try {
      const text = await fsp.readFile(
        path.join(project.rootPath, ...file.filePath.split("/")),
        "utf8"
      );
      source = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((lineText, index) => {
          const status = statusByLine.get(index + 1);
          return { number: index + 1, text: lineText, ...(status ? { status } : {}) };
        });
    } catch (error) {
      sourceError = `No se pudo leer el archivo: ${error instanceof Error ? error.message : String(error)}`;
    }

    files.push({
      filePath: file.filePath,
      line: file.line,
      units: file.units.map((unit) => ({
        name: unit.name,
        firstLine: unit.firstLine,
        line: unit.line,
        isTarget: unit.name === report.target?.name,
      })),
      source,
      ...(sourceError ? { sourceError } : {}),
    });
  }

  return {
    title: `Cobertura de ${unitLabel}`,
    generatedAt: now.toISOString(),
    testName,
    ...(report.target ? { target: { name: report.target.name, line: report.target.line } } : {}),
    line: report.line,
    ...(report.decision ? { decision: report.decision } : {}),
    notes: report.notes ?? [],
    files,
  };
}

/** Lo que la plantilla tiene en el lugar de los datos. */
export const COVERAGE_DATA_MARKER = '"__COVERAGE_DATA__"';

/**
 * Pone los datos en la plantilla. Van dentro de un `<script>`, así que se
 * escapa «<»: un `</script>` en el código fuente cerraría el bloque antes de
 * tiempo. Los separadores de línea de Unicode también, por los navegadores
 * viejos que no los aceptan dentro de una cadena.
 */
export function renderCoverageDocument(template: string, document: CoverageDocument): string {
  if (!template.includes(COVERAGE_DATA_MARKER)) {
    throw new Error("La plantilla del informe de cobertura no tiene el lugar de los datos.");
  }
  const data = JSON.stringify(document)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  // Con una función: un «$» en el código fuente no se lee como patrón.
  return template.replace(COVERAGE_DATA_MARKER, () => data);
}
