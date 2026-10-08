/**
 * Bloque Análisis de la interfaz de adaptación — OP-05, OP-06 y OP-07.
 */

/**
 * Candidata a declaración de la unidad bajo prueba.
 *
 * `signature` existe porque ante métodos sobrecargados hay que poder presentar
 * las firmas disponibles y devolver la ubicación de la que se elija.
 */
export interface SymbolCandidate {
  /** Ruta relativa a `ProjectModel.rootPath`. */
  readonly filePath: string;
  /** Línea de la declaración, base 1. */
  readonly line: number;
  /** Columna de la declaración, base 1. */
  readonly column: number;
  /** Firma completa de la declaración, tal como aparece en el archivo. */
  readonly signature: string;
}

/**
 * OP-05 — Ubicación del símbolo.
 *
 * El tipo es una unión discriminada y no un par de banderas porque hay que
 * distinguir la declaración de la invocación: un archivo que invoca un método
 * sin declararlo tiene que reportarse como no localizado, antes de iniciar el
 * pipeline y de gastar tokens.
 *
 * Hoy esta operación es `checkSymbols`, en el núcleo, y devuelve
 * `{ classOk, methodOk }` a partir de dos expresiones regulares insensibles a
 * mayúsculas que casan también con las invocaciones. Ese es el falso positivo
 * que esta forma corrige.
 */
export type SymbolLocation =
  | {
      readonly found: true;
      /** Al menos una candidata. Más de una solo cuando hay sobrecarga. */
      readonly candidates: readonly [SymbolCandidate, ...SymbolCandidate[]];
    }
  | {
      readonly found: false;
      /** Motivo presentable a la persona usuaria, sin sintaxis del lenguaje. */
      readonly reason: string;
    };

/** OP-06 — Texto fuente leído en la ubicación determinada por OP-05. */
export interface SourceText {
  /** Ruta relativa a `ProjectModel.rootPath`. */
  readonly filePath: string;
  readonly content: string;
}

/**
 * OP-07 — Resolución de una referencia lógica de dependencia a su ruta física.
 *
 * `triedPaths` se conserva en el caso negativo porque es el único dato que
 * permite diagnosticar una resolución fallida: traducir un nombre lógico a una
 * ruta admite varias candidatas, como cuando un paquete se corresponde con una
 * jerarquía de carpetas.
 *
 * Hoy esta operación está duplicada en el núcleo, en `readDependencyFiles`
 * (src/agents/codeAnalyzer.ts) y en `getClassContents`
 * (src/utils/dependencyPromptHandler.ts, módulo muerto), ambas con el prefijo
 * "Assets/" incrustado.
 */
export type DependencyResolution =
  | {
      readonly resolved: true;
      /** Ruta relativa a `ProjectModel.rootPath`. */
      readonly relativePath: string;
      readonly content: string;
    }
  | {
      readonly resolved: false;
      /** Referencia lógica que no se pudo resolver, tal como la emitió el agente. */
      readonly reference: string;
      /** Rutas candidatas que se intentaron, para diagnóstico. */
      readonly triedPaths: readonly string[];
    };
