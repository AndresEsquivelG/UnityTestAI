import { maskCommentsAndLiterals } from "./masking";

/**
 * La línea `package` de un archivo Java.
 *
 * En Java el paquete decide qué ve una clase sin importarlo: una prueba del
 * mismo paquete usa directamente los miembros sin modificador y los
 * `protected`. Por eso la prueba generada tiene que declarar el mismo paquete
 * que la clase bajo prueba, y estar en la carpeta que le corresponde.
 */

const PACKAGE_LINE = /^[ \t]*package[ \t]+([\w$.]+)[ \t]*;[ \t]*\r?\n?/m;

/** Paquete que declara el código, o `null` si está en el paquete por omisión. */
export function readPackageName(code: string): string | null {
  return PACKAGE_LINE.exec(maskCommentsAndLiterals(code))?.[1] ?? null;
}

/**
 * Deja el código con la línea `package` que corresponde: la reemplaza si
 * existe, la agrega al principio si falta, y la quita si el paquete es el
 * paquete por omisión. Aplicarla dos veces da lo mismo que una.
 */
export function withPackage(code: string, packageName: string | null): string {
  const existing = PACKAGE_LINE.exec(maskCommentsAndLiterals(code));

  if (existing) {
    const before = code.slice(0, existing.index);
    const after = code.slice(existing.index + existing[0].length);
    if (packageName === null) {
      return `${before}${after.replace(/^\s*\n/, "")}`;
    }
    return `${before}package ${packageName};\n${after}`;
  }

  return packageName === null ? code : `package ${packageName};\n\n${code}`;
}

/** Paquete que corresponde a una carpeta relativa a una raíz de fuentes. */
export function packageForDirectory(relativeDirectory: string): string | null {
  const segments = relativeDirectory.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments.join(".") : null;
}
