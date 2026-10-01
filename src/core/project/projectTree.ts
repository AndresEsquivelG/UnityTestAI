import type { ProjectModel } from "../contracts";

/**
 * Dibujo del modelo del proyecto (OP-04) como árbol de texto para el prompt.
 *
 * Es del núcleo y no del adaptador: el formato del árbol es el mismo en los tres
 * ecosistemas, y lo único propio de cada uno —qué archivos son fuentes y qué
 * carpetas se excluyen— ya viene resuelto en el modelo. Sustituye a
 * `getFilteredAssetsTree`, que devolvía el árbol ya formateado con la carpeta
 * `Assets` y la extensión `.cs` incrustadas.
 *
 * Tres diferencias respecto de aquel árbol, que hay que tener presentes al
 * comparar corridas:
 *
 *   1. las carpetas sin ninguna fuente dejan de aparecer, porque el modelo lleva
 *      archivos y no carpetas;
 *   2. la primera línea lleva guion como las demás, en vez de ser el nombre de
 *      la carpeta a secas;
 *   3. el orden es determinista —carpetas antes que archivos, y alfabético
 *      dentro de cada grupo— y no el que devuelva el sistema de archivos.
 *
 * Lo tercero es deliberado: sin un orden fijo, la foto de los prompts no sería
 * reproducible entre máquinas.
 */

const INDENT = "  ";

interface TreeNode {
  readonly children: Map<string, TreeNode>;
}

function emptyNode(): TreeNode {
  return { children: new Map() };
}

/**
 * Devuelve la cadena vacía cuando el modelo no tiene fuentes, para que quien
 * arma el prompt aplique su propio texto de reemplazo.
 */
export function renderProjectTree(project: ProjectModel): string {
  const root = emptyNode();

  for (const source of project.sources) {
    let node = root;
    for (const segment of source.relativePath.split("/")) {
      if (!segment) {
        continue;
      }
      let child = node.children.get(segment);
      if (!child) {
        child = emptyNode();
        node.children.set(segment, child);
      }
      node = child;
    }
  }

  return renderChildren(root, 0).join("\n");
}

function renderChildren(node: TreeNode, depth: number): string[] {
  const lines: string[] = [];

  for (const [name, child] of sortedEntries(node)) {
    lines.push(`${INDENT.repeat(depth)}- ${name}`);
    lines.push(...renderChildren(child, depth + 1));
  }

  return lines;
}

/**
 * Carpetas primero y después archivos, cada grupo en orden de punto de código.
 * No se usa `localeCompare` a propósito: su resultado depende del entorno, y el
 * árbol tiene que salir igual en cualquier máquina.
 */
function sortedEntries(node: TreeNode): [string, TreeNode][] {
  return [...node.children.entries()].sort(([nameA, a], [nameB, b]) => {
    const directoryA = a.children.size > 0;
    const directoryB = b.children.size > 0;
    if (directoryA !== directoryB) {
      return directoryA ? -1 : 1;
    }
    if (nameA === nameB) {
      return 0;
    }
    return nameA < nameB ? -1 : 1;
  });
}
