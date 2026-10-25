import type {
  ArtifactSpec,
  Diagnostic,
  PreconditionViolation,
  ProjectModel,
  VerificationResult,
} from "../../../core/contracts";
import { buildBlocker, prepareBuild, savedOutputHint, type BuildActivity } from "./blockers";
import { parseCompilerOutput } from "./diagnostics";
import type { JavaBuildToolchain } from "./toolchain";

/**
 * OP-13 — Compilación del proyecto con la prueba ya escrita, con la
 * herramienta del proyecto: `test-compile` en Maven, `testClasses` en Gradle.
 *
 * Compila el proyecto entero, no solo la prueba: así lo hacen las dos
 * herramientas, y un error en otro archivo también impide ejecutarla. Los
 * errores se conservan todos, estén donde estén; los avisos, solo los de la
 * prueba, como en Unity.
 *
 * Medido sobre el proyecto de ejemplo de JUnit, ya descargado lo necesario:
 * Maven 4 a 7 s, Gradle unos 7 s sin proceso de fondo. La primera corrida
 * baja la herramienta y sus complementos: 45 s con Maven, 41 s con Gradle.
 */

/** Holgado a propósito: la primera corrida descarga lo que el proyecto necesita. */
export const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

const COMPILE: BuildActivity = { doing: "compilar", retry: "la compilación" };

/**
 * El mensaje de `javac` cuando la prueba importa JUnit 5 y el proyecto no lo
 * declara. La prueba está bien: lo que falta es la dependencia, y corregir la
 * prueba no lo arregla. Solo el paquete principal de JUnit 5: si falta
 * `org.junit.jupiter.params`, la prueba puede escribirse sin pruebas con
 * parámetros, y eso sí lo corrige el corrector.
 */
const JUNIT_MISSING = /^package org\.junit\.jupiter\.api does not exist/;

export interface JavaCompileOptions {
  readonly toolchain: JavaBuildToolchain;
  readonly timeoutMs?: number;
}

export async function compileJavaProject(
  project: ProjectModel,
  spec: ArtifactSpec,
  options: JavaCompileOptions
): Promise<VerificationResult> {
  const prepared = await prepareBuild(project, spec, options.toolchain);
  if ("blocker" in prepared) {
    return notRun(prepared.blocker);
  }
  const { commands, launcher } = prepared;
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;

  const run = await options.toolchain.run(launcher, commands.compileArgs(), {
    cwd: project.rootPath,
    timeoutMs,
  });

  const blocker = buildBlocker(run, commands, COMPILE, timeoutMs);
  if (blocker) {
    return notRun(blocker, run.output);
  }

  const exitCode = run.exitCode ?? -1;
  const artifactPath = `${spec.directory}/${spec.fileName}${spec.extension}`;
  const diagnostics = parseCompilerOutput(run.output, project.rootPath, commands.tool);
  const inArtifact = (diagnostic: Diagnostic) => samePath(diagnostic.filePath, artifactPath);

  if (exitCode === 0) {
    return {
      status: "passed",
      diagnostics: diagnostics.filter(inArtifact),
      exitCode,
      rawOutput: run.output,
    };
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.some((diagnostic) => inArtifact(diagnostic) && JUNIT_MISSING.test(diagnostic.message))) {
    return notRun(
      {
        code: "java.junit-missing",
        message: "El proyecto no declara JUnit 5, así que la prueba no puede compilar.",
        remediation:
          commands.tool === "maven"
            ? "Agregá la dependencia org.junit.jupiter:junit-jupiter con scope test al pom.xml y volvé a intentar la compilación."
            : "Agregá la dependencia de pruebas org.junit.jupiter:junit-jupiter (testImplementation) y org.junit.platform:junit-platform-launcher (testRuntimeOnly) a build.gradle o build.gradle.kts, y volvé a intentar la compilación.",
      },
      run.output
    );
  }

  if (errors.length > 0) {
    return { status: "failed", diagnostics: errors, exitCode, rawOutput: run.output };
  }

  return notRun(
    {
      code: "java.build-failed",
      message: `${commands.name} terminó con el código ${exitCode} sin informar errores de compilación.`,
      remediation: `${savedOutputHint("verification")} Suele ser un problema de la configuración del proyecto: probá compilarlo con ${commands.name} en una terminal.`,
    },
    run.output
  );
}

/** Las rutas de Windows no distinguen mayúsculas. */
export function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function notRun(blocker: PreconditionViolation, rawOutput?: string): VerificationResult {
  return rawOutput === undefined
    ? { status: "notRun", blocker }
    : { status: "notRun", blocker, rawOutput };
}
