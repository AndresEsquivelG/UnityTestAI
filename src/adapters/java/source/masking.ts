/**
 * Enmascarado de comentarios y literales de Java.
 *
 * Devuelve una copia del código con los comentarios, las cadenas, los bloques
 * de texto y los caracteres sustituidos por espacios, conservando la longitud y
 * los saltos de línea. Así las llaves y los nombres que aparecen dentro de un
 * texto o de un comentario dejan de contarse como código, y una posición
 * encontrada en la copia sigue valiendo sobre el original.
 *
 * Es lo primero que hace cualquier lectura del adaptador: sin esto, un
 * comentario con la forma de una declaración se tomaría por una declaración.
 */
export function maskCommentsAndLiterals(source: string): string {
  const characters = source.split("");

  const blank = (from: number, to: number) => {
    for (let index = from; index < to && index < characters.length; index++) {
      if (characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
      }
    }
  };

  let i = 0;
  while (i < source.length) {
    const current = source[i];
    const next = source[i + 1];

    if (current === "/" && next === "/") {
      const end = endOfLine(source, i + 2);
      blank(i, end);
      i = end;
      continue;
    }

    if (current === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }

    // Bloque de texto (Java 15): de `"""` a `"""`, y puede ocupar varias
    // líneas. Va antes que la cadena común, que lo cortaría en la segunda
    // comilla.
    if (source.startsWith('"""', i)) {
      const end = endOfTextBlock(source, i + 3);
      blank(i, end);
      i = end;
      continue;
    }

    // Cadena o carácter. No cruzan líneas: si falta el cierre, el literal
    // termina con la línea y el resto del archivo se sigue leyendo.
    if (current === '"' || current === "'") {
      let end = i + 1;
      while (end < source.length && source[end] !== current && source[end] !== "\n") {
        end += source[end] === "\\" ? 2 : 1;
      }
      end = Math.min(end + 1, source.length);
      blank(i, end);
      i = end;
      continue;
    }

    i++;
  }

  return characters.join("");
}

function endOfLine(source: string, from: number): number {
  const newline = source.indexOf("\n", from);
  return newline === -1 ? source.length : newline;
}

/** Posición siguiente al `"""` que cierra el bloque, saltando los escapados. */
function endOfTextBlock(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source.startsWith('"""', index)) {
      return index + 3;
    }
    index++;
  }
  return source.length;
}
