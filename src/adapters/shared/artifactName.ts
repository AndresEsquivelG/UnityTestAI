/**
 * Nombre base de la prueba generada, común a todos los adaptadores.
 *
 * Es `UTIA_<modelo>_<dueño>_<unidad>`: el prefijo marca lo que escribió la
 * herramienta, y el modelo separa las pruebas de cada proveedor para que una
 * corrida con otro no pise la anterior. Cada adaptador le agrega al final lo
 * que su herramienta necesite para reconocerla como prueba, y la extensión.
 *
 * Vive con los adaptadores y no en el núcleo: el nombre lo decide cada
 * adaptador en OP-10. Esto solo garantiza que la parte común sea la misma en
 * todos, y un adaptador puede no usarla si su ecosistema pide otra forma.
 */

const PREFIX = "UTIA";

/**
 * @param owner Clase que contiene la unidad, o el nombre de su archivo cuando
 *   la unidad no pertenece a ninguna.
 * @param unit Método o función bajo prueba.
 */
export function baseArtifactName(modelId: string, owner: string, unit: string): string {
  return [PREFIX, modelId, owner, unit].map(toIdentifier).join("_");
}

/**
 * Convierte un texto en un identificador válido: letras, dígitos y guion bajo,
 * sin empezar por un dígito. Esas reglas son las mismas en C#, Java y Python,
 * así que el nombre sirve igual para el archivo y para la clase que contiene.
 */
export function toIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}
