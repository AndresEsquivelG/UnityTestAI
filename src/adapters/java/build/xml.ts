/**
 * Lo poco de XML que hace falta para leer los informes de JUnit y JaCoCo.
 * Se leen con expresiones, como los de Unity, para no sumar una dependencia:
 * los formatos son fijos y solo hacen falta atributos y el texto de unos
 * pocos elementos.
 */

export function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeEntities(match[2]);
  }
  return attributes;
}

/** Texto de un elemento, con CDATA o con entidades. */
export function elementText(content: string): string {
  return content
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) =>
      part.startsWith("<![CDATA[") ? part.slice("<![CDATA[".length, -"]]>".length) : decodeEntities(part)
    )
    .join("")
    .trim();
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (entity, code: string) => {
    switch (code.toLowerCase()) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return String.fromCodePoint(
          code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        );
    }
  });
}
