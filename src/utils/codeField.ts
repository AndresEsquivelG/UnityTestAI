import { JsonSanitizer } from "./jsonSanitizer";

/**
 * Lee el código que un modelo devuelve dentro de un campo JSON. El modelo a
 * veces lo codifica de más (comillas extra, saltos escapados dos veces, un
 * objeto) y para `JSON.parse` eso sigue siendo una cadena válida. Solo se
 * desenvuelve una cadena JSON completa; lo demás se rechaza en vez de
 * repararse, porque reemplazar `\n` a mano rompería los literales que lo usan.
 */

export type CodeField =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly reason: string };

/** Capas de comillas que se aceptan desenvolver antes de darse por vencido. */
const MAX_UNWRAP = 2;

export function readCodeField(value: string): CodeField {
  let text = value.trim();

  for (let i = 0; i < MAX_UNWRAP && isQuoted(text); i++) {
    const inner = parseJsonString(text);
    if (inner === undefined) {
      break;
    }
    text = inner.trim();
  }

  if (text.startsWith('"')) {
    return { ok: false, reason: "the code is wrapped in quotes, encoded as a string" };
  }
  if (/^\{\s*\\*"/.test(text)) {
    return { ok: false, reason: "the code is shaped as a JSON object" };
  }

  const lineBreaks = count(text, /\n/g);
  if (lineBreaks === 0) {
    return { ok: false, reason: "the code has no line breaks" };
  }
  if (count(text, /\\n/g) > lineBreaks) {
    return { ok: false, reason: "the code has more escaped line breaks (\\n) than real ones" };
  }

  return { ok: true, code: text };
}

function isQuoted(text: string): boolean {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"');
}

function parseJsonString(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(JsonSanitizer.sanitize(text));
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}
