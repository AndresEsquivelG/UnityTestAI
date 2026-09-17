/**
 * Vocabulario de entrada común a varias operaciones de la interfaz.
 *
 * OP-05 localiza la unidad bajo prueba a partir de los identificadores que
 * recibe, y esos identificadores son este tipo. Se conservan los términos clase
 * y método porque son conceptos de orientación a objetos presentes en los tres
 * ecosistemas, no nombres de una tecnología concreta.
 *
 * La clase es opcional porque no toda unidad pertenece a una: una función
 * declarada a nivel de módulo no tiene clase que la contenga, y exigirla dejaría
 * fuera del framework a buena parte de un ecosistema como Python.
 */
export interface UnitTarget {
  /**
   * Nombre de la clase que contiene la unidad bajo prueba, o `null` cuando la
   * unidad se declara a nivel de módulo o archivo.
   */
  readonly className: string | null;
  /** Nombre del método o función bajo prueba. */
  readonly methodName: string;
}
