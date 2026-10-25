import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "fs";
import * as path from "path";
import { templatePlaceholders } from "../core/prompts";
import { unityPromptProfile } from "../adapters/unity/promptProfile";
import { javaPromptProfile } from "../adapters/java/profile";
import type { ProjectModel, PromptProfile } from "../core/contracts";

/**
 * El perfil del adaptador responde a lo que piden las plantillas neutras.
 *
 * La foto comprueba que el prompt sale igual que antes; esto comprueba algo
 * distinto y que la foto no puede ver: que no quede un punto de extensión sin
 * contestar. Un punto sin contestar no rompe nada —se resuelve como vacío, que
 * es lo que el contrato pide— así que se escaparía en silencio, con el prompt
 * perdiendo una regla entera.
 *
 * Las plantillas se leen del disco a propósito: el error que se busca aparece
 * justamente al agregar un marcador nuevo y olvidarse del perfil.
 */
describe("cobertura del perfil sobre las plantillas neutras", () => {
  /** Las ocho plantillas, ya todas repartidas. */
  const SPLIT_TEMPLATES = [
    "methodSlicerPrompt.txt",
    "dependencyResolverPrompt.txt",
    "contextBuilderPrompt.txt",
    "contextValidatorPrompt.txt",
    "testValidatorPrompt.txt",
    "chatFixerPrompt.txt",
    "codeAnalyzerPrompt.txt",
    "testGeneratorPrompt.txt",
  ];

  /** Un perfil por adaptador. Un adaptador nuevo se agrega aquí. */
  const PROFILES: readonly (readonly [string, PromptProfile])[] = [
    ["Unity", unityPromptProfile(projectOf("unity"))],
    ["Java", javaPromptProfile(projectOf("java"))],
  ];

  function projectOf(ecosystemId: string): ProjectModel {
    return { rootPath: "/proyecto", ecosystemId, sourceRoots: [], sources: [] };
  }

  function readTemplate(name: string): string {
    // Las pruebas corren desde out-test/test; las plantillas se copian junto al
    // constructor compilado, en out-test/prompts.
    return fs.readFileSync(path.resolve(__dirname, "..", "prompts", name), "utf8");
  }

  for (const [adapterName, profile] of PROFILES) {
    const answered = new Set([
      ...Object.keys(profile.vocabulary),
      ...Object.keys(profile.fragments),
    ]);

    for (const name of SPLIT_TEMPLATES) {
      it(`el perfil de ${adapterName} contesta todo lo que pide ${name}`, () => {
        const asked = templatePlaceholders(readTemplate(name));

        assert.ok(asked.length > 0, `${name} no expone ningún punto de extensión`);

        const missing = asked.filter((point) => !answered.has(point));
        assert.deepEqual(missing, [], `${name} pide puntos que el perfil no trae`);
      });
    }

    it(`al perfil de ${adapterName} no le sobran fragmentos sin usar en ninguna plantilla`, () => {
      // Un fragmento que ninguna plantilla pide es texto muerto: se escribió para
      // un marcador que se renombró o que nunca llegó a ponerse.
      const asked = new Set(
        SPLIT_TEMPLATES.flatMap((name) => templatePlaceholders(readTemplate(name)))
      );
      const unused = Object.keys(profile.fragments).filter((point) => !asked.has(point));

      assert.deepEqual(unused, []);
    });
  }
});
