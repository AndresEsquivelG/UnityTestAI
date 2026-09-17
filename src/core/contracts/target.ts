/**
 * Vocabulario de entrada común a varias operaciones de la interfaz.
 *
 * OP-05 localiza la unidad bajo prueba "a partir de los identificadores
 * proporcionados" (Tabla 10); esos identificadores son este tipo. Se conservan
 * los términos clase y método porque son los que emplea el propio anteproyecto
 * en HU-09 y HU-16, y son conceptos de orientación a objetos presentes en los
 * tres ecosistemas, no nombres de una tecnología concreta.
 */
export interface UnitTarget {
  /** Nombre de la clase que contiene la unidad bajo prueba. */
  readonly className: string;
  /** Nombre del método bajo prueba. */
  readonly methodName: string;
}
