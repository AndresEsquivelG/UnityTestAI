import * as fs from "fs";
import * as path from "path";

/**
 * Copia de cada corrida.
 *
 * `AgentOutputs` guarda lo que hizo cada agente con nombres fijos, así que la
 * corrida siguiente lo pisa: sirve para mirar la última, no para comparar dos.
 * Esto deja una copia aparte cuando la corrida termina, bien o mal, y no cambia
 * nada de lo que ven los modelos.
 */

const OUTPUTS_FOLDER = "AgentOutputs";
const RUNS_FOLDER = "corridas";

/**
 * La prueba se copia con un nombre fijo y sin la extensión de su lenguaje: dentro
 * del proyecto, un `.py` o un `.java` más podría entrar en la recolección o en la
 * búsqueda de símbolos. El nombre de la carpeta ya dice de qué prueba es.
 */
const TEST_COPY = "generated-test.txt";

/**
 * Margen para no perder archivos en un disco con fechas poco precisas. No alcanza
 * a mezclar corridas: entre una y otra alguien tiene que volver a pedir la prueba.
 */
const TIMESTAMP_MARGIN_MS = 2000;

export interface RunArchiveRequest {
  /** La raíz en la que los agentes escribieron `AgentOutputs`. */
  readonly outputRoot: string;
  /** Cuándo empezó: lo que sea anterior quedó de otra corrida. */
  readonly startedAt: number;
  readonly modelId: string;
  readonly className: string | null;
  readonly methodName: string;
  /** La prueba escrita, si se llegó a escribir. */
  readonly testFile?: string;
}

/**
 * Copia lo que escribió esta corrida a su propia carpeta y devuelve esa carpeta.
 *
 * Se filtra por fecha porque una corrida que se corta a la mitad deja en
 * `AgentOutputs` lo que escribieron los agentes siguientes en la corrida anterior.
 * Sin nada nuevo, como cuando faltan requisitos y ningún agente llegó a correr, no
 * crea nada.
 */
export function archiveRun(request: RunArchiveRequest): string | undefined {
  const outputs = path.join(request.outputRoot, OUTPUTS_FOLDER);
  if (!fs.existsSync(outputs)) {
    return undefined;
  }

  const files = filesWrittenSince(outputs, request.startedAt - TIMESTAMP_MARGIN_MS);
  if (files.length === 0) {
    return undefined;
  }

  const target = createRunFolder(path.join(outputs, RUNS_FOLDER), runName(request));
  for (const relative of files) {
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(outputs, relative), destination);
  }
  if (request.testFile && fs.existsSync(request.testFile)) {
    fs.copyFileSync(request.testFile, path.join(target, TEST_COPY));
  }
  return target;
}

/** Rutas relativas a `AgentOutputs`, sin entrar en las copias de otras corridas. */
function filesWrittenSince(outputs: string, since: number): string[] {
  const found: string[] = [];
  const visit = (relative: string) => {
    for (const entry of fs.readdirSync(path.join(outputs, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (child !== RUNS_FOLDER) {
          visit(child);
        }
      } else if (entry.isFile() && fs.statSync(path.join(outputs, child)).mtimeMs >= since) {
        found.push(child);
      }
    }
  };
  visit("");
  return found;
}

/** `2026-11-10_14-30-05_modelo_Clase_metodo`, en hora local. */
function runName(request: RunArchiveRequest): string {
  const date = new Date(request.startedAt);
  const two = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  const time = `${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`;
  const unit = [request.modelId, request.className, request.methodName]
    .filter((part): part is string => !!part)
    .join("_")
    .replace(/[^A-Za-z0-9_-]/g, "_");
  return `${day}_${time}_${unit}`;
}

/** Crea la carpeta sin reutilizar una existente: una copia nunca toca a otra. */
function createRunFolder(parent: string, name: string): string {
  fs.mkdirSync(parent, { recursive: true });
  for (let attempt = 1; ; attempt++) {
    const candidate = path.join(parent, attempt === 1 ? name : `${name}_${attempt}`);
    try {
      fs.mkdirSync(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
}
