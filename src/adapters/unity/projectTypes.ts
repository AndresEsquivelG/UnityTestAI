import * as fs from "fs";
import * as path from "path";
import type { ProjectModel, SourceFile } from "../../core/contracts";
import {
  findEnclosingNamespace,
  findTypeDeclarations,
  maskCommentsAndStrings,
  type TypeDeclaration,
} from "./csharpSource";

/**
 * Los tipos que declara el proyecto, para responder preguntas que el archivo de
 * la unidad no alcanza a contestar: en qué espacio de nombres está un tipo, si es
 * abstracto y qué clases concretas lo heredan.
 *
 * Es síncrono porque la ficha (OP-18) lo es. Enmascarar es lo caro, así que solo
 * se enmascaran los archivos donde el nombre pedido aparece declarado.
 */

/**
 * Carpeta que Unity compila aparte y que por convención guarda código de
 * terceros. Sigue la misma regla que la detección de dependencias.
 */
const THIRD_PARTY_FOLDER = "Plugins";

const RAW_DECLARATION = /\b(?:class|struct|interface|enum|record)\s+(?:(?:class|struct)\s+)?([A-Za-z_]\w*)/g;

export interface ProjectType extends TypeDeclaration {
  readonly namespace: string;
  /** Dentro de otro tipo: un `using` no alcanza para nombrarlo. */
  readonly nested: boolean;
  readonly filePath: string;
  readonly code: string;
  readonly masked: string;
}

interface ProjectFile {
  readonly relativePath: string;
  readonly code: string;
  parsed?: readonly ProjectType[];
}

export class ProjectTypes {
  private readonly files: ProjectFile[] = [];
  private readonly filesDeclaring = new Map<string, ProjectFile[]>();

  constructor(project: ProjectModel) {
    for (const source of project.sources) {
      if (isProjectCode(source)) {
        this.addFile(project.rootPath, source.relativePath);
      }
    }
  }

  private addFile(rootPath: string, relativePath: string): void {
    let code: string;
    try {
      code = fs.readFileSync(path.join(rootPath, relativePath), "utf8");
    } catch {
      // Se borró desde que se armó el modelo: no declara nada.
      return;
    }
    const file: ProjectFile = { relativePath, code };
    this.files.push(file);
    for (const match of code.matchAll(RAW_DECLARATION)) {
      const declaring = this.filesDeclaring.get(match[1]);
      if (!declaring) {
        this.filesDeclaring.set(match[1], [file]);
      } else if (!declaring.includes(file)) {
        declaring.push(file);
      }
    }
  }

  /** Las declaraciones de un nombre; más de una si se repite en otro espacio. */
  find(name: string): readonly ProjectType[] {
    return (this.filesDeclaring.get(name) ?? []).flatMap((file) =>
      parse(file).filter((type) => type.name === name)
    );
  }

  /** Las clases no abstractas que heredan directamente de `name`. */
  concreteSubclassesOf(name: string): readonly ProjectType[] {
    const needle = new RegExp(`:[^{;]*\\b${name}\\b`);
    return this.files
      .filter((file) => needle.test(file.code))
      .flatMap((file) =>
        parse(file).filter(
          (type) =>
            type.kind === "class" &&
            type.bases.includes(name) &&
            !type.modifiers.includes("abstract")
        )
      );
  }
}

function parse(file: ProjectFile): readonly ProjectType[] {
  if (file.parsed) {
    return file.parsed;
  }
  const masked = maskCommentsAndStrings(file.code);
  const declarations = findTypeDeclarations(masked);
  file.parsed = declarations.map((declaration) => {
    const before = masked.slice(0, declaration.start).split("\n");
    return {
      ...declaration,
      namespace: findEnclosingNamespace(masked, before.length, before[before.length - 1].length + 1),
      nested: declarations.some(
        (other) => other.body.start <= declaration.start && declaration.start < other.body.end
      ),
      filePath: file.relativePath,
      code: file.code,
      masked,
    };
  });
  return file.parsed;
}

/** Solo el código principal: ni las pruebas ni el código de terceros. */
export function isProjectCode(source: SourceFile): boolean {
  return (
    source.sourceRoot === "main" &&
    !source.relativePath.split("/").includes(THIRD_PARTY_FOLDER)
  );
}

/**
 * El único espacio de nombres al que se puede llegar con un `using`. Un nombre
 * repetido en dos, o declarado dentro de otro tipo, no tiene una sola respuesta:
 * sumar los dos `using` volvería ambiguo el nombre (CS0104).
 */
export function uniqueNamespace(declarations: readonly ProjectType[]): string | undefined {
  const reachable = declarations.filter((type) => !type.nested && type.namespace !== "");
  const namespaces = new Set(reachable.map((type) => type.namespace));
  return reachable.length === declarations.length && namespaces.size === 1
    ? reachable[0].namespace
    : undefined;
}
