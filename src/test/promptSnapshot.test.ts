import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildChatFixerPrompt,
  buildCodeAnalyzerPrompt,
  buildContextBuilderPrompt,
  buildContextValidatorPrompt,
  buildDependencyResolverPrompt,
  buildMethodSlicerPrompt,
  buildTestGeneratorPrompt,
  buildTestValidatorPrompt,
} from "../prompts/promptBuilder";
import { assertPromptSnapshot } from "./support/snapshot";
import { unityPromptProfile } from "../adapters/unity/promptProfile";
import type { ProjectModel } from "../core/contracts";
import {
  ASSEMBLED_CONTEXT,
  CLASS_NAME,
  CODE_ANALYSIS,
  CODE_SLICE,
  DEPENDENCY_FILES,
  METHOD_NAME,
  PROJECT_TREE,
  SOURCE_CODE,
  TEST_CODE,
  USER_MESSAGE,
} from "./support/promptFixture";

/**
 * Perfil del único adaptador que existe. La foto se compone con el perfil de
 * verdad y no con uno inventado: si el reparto entre plantilla neutra y perfil
 * se desviara un carácter, la foto lo acusaría.
 *
 * El modelo está vacío porque el perfil de Unity todavía no depende de él.
 */
const PROJECT: ProjectModel = {
  rootPath: "/proyecto",
  ecosystemId: "unity",
  sourceRoots: [],
  sources: [],
};
const PROFILE = unityPromptProfile(PROJECT);

/**
 * Foto de los ocho prompts, con entradas fijas.
 *
 * No comprueba que los prompts sean buenos: los congela como están. Es la red
 * con la que se reparten las plantillas entre núcleo y adaptador, porque un
 * espacio de más al recomponer no rompe nada visible y sí empeora lo que
 * genera el modelo.
 *
 * Las cuatro primeras ya se repartieron y estas fotos no cambiaron: esa es la
 * prueba de que el reparto fue exacto. Las otras cuatro siguen enteras.
 *
 * Se fotografían doce y no ocho porque tres funciones tienen una rama que
 * agrega o quita texto, y ese texto también hay que congelarlo:
 *
 *   · el árbol ausente y las dependencias ausentes, que tienen texto de
 *     reemplazo (promptBuilder.ts:77,96);
 *   · la nota de contexto completo y el bloque de análisis precalculado, que no
 *     están en ninguna plantilla sino escritos dentro del TypeScript
 *     (promptBuilder.ts:127-131,154). Al repartir las plantillas que faltan hay
 *     que acordarse de esos dos.
 */
describe("foto de los prompts", () => {
  describe("cortador de métodos", () => {
    it("arma el prompt con el archivo fuente completo", () => {
      assertPromptSnapshot(
        "methodSlicer",
        buildMethodSlicerPrompt(PROFILE, METHOD_NAME, CLASS_NAME, SOURCE_CODE)
      );
    });
  });

  describe("resolutor de dependencias", () => {
    it("arma el prompt con el árbol del proyecto", () => {
      assertPromptSnapshot(
        "dependencyResolver",
        buildDependencyResolverPrompt(PROFILE, METHOD_NAME, CLASS_NAME, CODE_SLICE, PROJECT_TREE)
      );
    });

    it("arma el prompt con el texto de reemplazo cuando no hay árbol", () => {
      assertPromptSnapshot(
        "dependencyResolver.sinArbol",
        buildDependencyResolverPrompt(PROFILE, METHOD_NAME, CLASS_NAME, CODE_SLICE, "")
      );
    });
  });

  describe("constructor de contexto", () => {
    it("arma el prompt con las dependencias leídas", () => {
      assertPromptSnapshot(
        "contextBuilder",
        buildContextBuilderPrompt(PROFILE, METHOD_NAME, CLASS_NAME, CODE_SLICE, DEPENDENCY_FILES)
      );
    });

    it("arma el prompt con el texto de reemplazo cuando no hay dependencias", () => {
      assertPromptSnapshot(
        "contextBuilder.sinDependencias",
        buildContextBuilderPrompt(PROFILE, METHOD_NAME, CLASS_NAME, CODE_SLICE, "")
      );
    });
  });

  describe("validador de contexto", () => {
    it("arma el prompt del contexto reducido", () => {
      assertPromptSnapshot(
        "contextValidator",
        buildContextValidatorPrompt(PROFILE, METHOD_NAME, CLASS_NAME, ASSEMBLED_CONTEXT)
      );
    });

    it("agrega la nota cuando el contexto es completo", () => {
      assertPromptSnapshot(
        "contextValidator.contextoCompleto",
        buildContextValidatorPrompt(PROFILE, METHOD_NAME, CLASS_NAME, ASSEMBLED_CONTEXT, true)
      );
    });
  });

  describe("analizador de código", () => {
    it("arma el prompt con el contexto ensamblado", () => {
      assertPromptSnapshot(
        "codeAnalyzer",
        buildCodeAnalyzerPrompt(PROFILE, METHOD_NAME, CLASS_NAME, ASSEMBLED_CONTEXT)
      );
    });
  });

  describe("generador de pruebas", () => {
    it("arma el prompt sin análisis precalculado", () => {
      assertPromptSnapshot(
        "testGenerator",
        buildTestGeneratorPrompt(PROFILE, METHOD_NAME, CLASS_NAME, ASSEMBLED_CONTEXT)
      );
    });

    it("agrega el bloque cuando hay análisis precalculado", () => {
      assertPromptSnapshot(
        "testGenerator.conAnalisis",
        buildTestGeneratorPrompt(PROFILE, METHOD_NAME, CLASS_NAME, ASSEMBLED_CONTEXT, CODE_ANALYSIS)
      );
    });
  });

  describe("validador de pruebas", () => {
    it("arma el prompt con el contexto y la prueba generada", () => {
      assertPromptSnapshot(
        "testValidator",
        buildTestValidatorPrompt(PROFILE, METHOD_NAME, CLASS_NAME, ASSEMBLED_CONTEXT, TEST_CODE)
      );
    });
  });

  describe("corrector por chat", () => {
    it("arma el prompt con la prueba y el mensaje de la persona usuaria", () => {
      assertPromptSnapshot(
        "chatFixer",
        buildChatFixerPrompt(
          PROFILE,
          METHOD_NAME,
          CLASS_NAME,
          ASSEMBLED_CONTEXT,
          TEST_CODE,
          USER_MESSAGE
        )
      );
    });
  });
});

/**
 * Comportamiento de `replacePlaceholders` que la foto no cubre y que hay que
 * conservar, porque esa función se reescribe al repartir las plantillas.
 *
 * Sustituye con `String.replace`, que interpreta los patrones de reemplazo del
 * segundo argumento: `$&`, `` $` ``, `$'`, `$1`. Un valor inyectado que los
 * contenga no llega literal al modelo. No se arregla ahora a propósito:
 * arreglarlo cambia el prompt, y esta foto existe justamente para que ningún
 * cambio de prompt pase inadvertido. Con la foto puesta, el arreglo es medible.
 */
describe("sustitución de marcadores", () => {
  it("hoy interpreta los patrones de reemplazo dentro del valor inyectado", () => {
    const withPattern = buildMethodSlicerPrompt(PROFILE, "Move", "Player", "var a = $&;");

    // `$&` se resuelve al propio marcador que se estaba sustituyendo.
    assert.ok(withPattern.includes("var a = {code};"));
    assert.ok(!withPattern.includes("var a = $&;"));
  });

  it("deja intacto el signo de dólar de la interpolación de cadenas", () => {
    // Es el caso frecuente de verdad en el código real, y ese sí llega literal.
    const interpolated = buildMethodSlicerPrompt(PROFILE, "Move", "Player", 'Debug.Log($"x={x}");');

    assert.ok(interpolated.includes('Debug.Log($"x={x}");'));
  });
});
