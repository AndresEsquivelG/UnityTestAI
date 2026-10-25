import type { ArtifactSpec, PreconditionViolation, ProjectModel } from "../../../core/contracts";
import { BUILD_TOOL_NAMES, isSupportedBuildTool, type BuildTool } from "../discovery/layout";
import { commandsFor, type BuildCommands } from "./commands";
import type { BuildLauncher, BuildRunResult, JavaBuildToolchain } from "./toolchain";

/**
 * Por qué no se pudo compilar, ejecutar o medir, dicho de forma que la
 * persona sepa qué falta y cómo resolverlo.
 *
 * Lo que se puede saber de antemano se comprueba antes de lanzar nada: que
 * el proyecto use Maven o Gradle y que la herramienta esté. El resto se
 * reconoce en la salida, porque la herramienta ya lo dice claro y medirlo
 * aparte costaría lo mismo que lanzarla: falta de Java, un Java sin
 * compilador, uno más viejo que el que pide el proyecto, sin Internet la
 * primera vez. Cada patrón sale de una corrida real (Maven 3.10.0, Gradle
 * 9.8.0, JDK 21, Windows), provocando el caso a propósito.
 */

/** Cómo se nombra, en los avisos, lo que la corrida iba a hacer. */
export interface BuildActivity {
  /** En infinitivo: «compilar», «ejecutar las pruebas». */
  readonly doing: string;
  /** Lo que se vuelve a intentar: «la compilación», «la ejecución». */
  readonly retry: string;
}

/** Recordatorio para todo lo que se arregla instalando o cambiando variables. */
const RESTART_VSCODE =
  "Si lo acabás de instalar o cambiar, cerrá VS Code entero y volvé a abrirlo: la extensión ve las variables de entorno de cuando arrancó.";

export interface PreparedBuild {
  readonly commands: BuildCommands;
  readonly launcher: BuildLauncher;
}

/**
 * La herramienta del proyecto y su lanzador, o por qué no se puede usar.
 * Lo comparten las tres operaciones.
 */
export async function prepareBuild(
  project: ProjectModel,
  spec: ArtifactSpec,
  toolchain: JavaBuildToolchain
): Promise<PreparedBuild | { readonly blocker: PreconditionViolation }> {
  const tool = project.adapterData?.["buildTool"];
  if (!isSupportedBuildTool(tool)) {
    return { blocker: unsupportedBuildTool(project, spec) };
  }

  const commands = commandsFor(tool);
  const launcher = await toolchain.findLauncher(tool, project.rootPath);
  if (!launcher) {
    return {
      blocker: {
        code: `java.${tool}-missing`,
        message: `No se encontró ${commands.name}: el proyecto no trae ${commands.wrapperName} y ${commands.installedName} no está en el PATH.`,
        remediation: `Instalá ${commands.name} y agregá su carpeta bin al PATH, o agregá el wrapper (${commands.wrapperName}) al proyecto. ${RESTART_VSCODE}`,
      },
    };
  }
  return { commands, launcher };
}

/**
 * El proyecto se reconoció como Java pero no usa una herramienta que el
 * adaptador sepa manejar. La prueba ya está escrita: lo que falta es
 * compilarla con la del proyecto.
 */
export function unsupportedBuildTool(project: ProjectModel, spec: ArtifactSpec): PreconditionViolation {
  const tool = project.adapterData?.["buildTool"];
  const file = project.adapterData?.["buildFile"];
  const uses =
    typeof tool === "string" && Object.prototype.hasOwnProperty.call(BUILD_TOOL_NAMES, tool)
      ? `este usa ${BUILD_TOOL_NAMES[tool as BuildTool]}${typeof file === "string" ? ` (${file})` : ""}`
      : "este no usa ninguno: no tiene pom.xml, build.gradle ni build.gradle.kts en la raíz";
  return {
    code: "java.build-tool-unsupported",
    message: `La extensión solo puede compilar, ejecutar y medir proyectos que usan Maven o Gradle, y ${uses}.`,
    remediation: `La prueba ya quedó escrita en ${spec.directory}/${spec.fileName}${spec.extension}: compilala y ejecutala con la herramienta del proyecto.`,
  };
}

/**
 * Las formas de fallar que no dependen de lo que la corrida iba a hacer: no
 * arrancó, se agotó el tiempo, falta Java o no se pudo descargar algo.
 * Devuelve `undefined` si no pasó ninguna.
 *
 * El orden importa: sin compilador, Gradle también dice «Could not resolve
 * all dependencies», y eso no es falta de Internet.
 */
export function buildBlocker(
  run: BuildRunResult,
  commands: BuildCommands,
  activity: BuildActivity,
  timeoutMs: number
): PreconditionViolation | undefined {
  const { name } = commands;
  const output = run.output;

  if (run.spawnError) {
    return {
      code: "java.build-failed-to-start",
      message: `No se pudo lanzar ${name}: ${run.spawnError}`,
      remediation: `Comprobá que ${name} funcione corriendo «${commands.installedName} -v» en una terminal.`,
    };
  }

  if (run.timedOut) {
    return {
      code: "java.build-timeout",
      message: `${name} no terminó de ${activity.doing} en ${Math.round(timeoutMs / 60000)} minutos y se detuvo.`,
      remediation: `La primera corrida descarga lo que el proyecto necesita y puede tardar. Volvé a intentar ${activity.retry}; si se repite, probá ${activity.doing} el proyecto con ${name} en una terminal.`,
    };
  }

  // Maven: «The JAVA_HOME environment variable is not defined correctly»
  // (también con JAVA_HOME apuntando a una carpeta que no existe). Gradle:
  // «JAVA_HOME is not set and no 'java' command could be found in your PATH»
  // o «JAVA_HOME is set to an invalid directory».
  if (
    /JAVA_HOME environment variable is not defined correctly|JAVA_HOME is not set and no 'java' command could be found|JAVA_HOME is set to an invalid directory/.test(
      output
    )
  ) {
    return {
      code: "java.jdk-missing",
      message: `${name} no encontró Java: JAVA_HOME no está definido, o apunta a una carpeta que no existe, y no hay java en el PATH.`,
      remediation: `Instalá un JDK (por ejemplo, Temurin 21) y definí JAVA_HOME con su carpeta. ${RESTART_VSCODE}`,
    };
  }

  // Un JRE, sin compilador. Maven: «No compiler is provided in this
  // environment». Gradle: «does not provide the required capabilities:
  // [JAVA_COMPILER]».
  if (/No compiler is provided in this environment|required capabilities: \[JAVA_COMPILER\]/.test(output)) {
    return {
      code: "java.jdk-without-compiler",
      message: `El Java que usa ${name} no trae compilador: es un JRE, y hace falta un JDK.`,
      remediation: `Instalá un JDK y apuntá JAVA_HOME a su carpeta. ${RESTART_VSCODE}`,
    };
  }

  // El proyecto pide una versión de Java que el JDK no conoce. Maven y Gradle
  // pasan el mensaje de javac: «release version 25 not supported»; con
  // `source` y `target` en lugar de `release`, «invalid target release: 17».
  const release = /release version (\d+) not supported|invalid (?:target|source) release:\s*([\w.]+)/.exec(output);
  if (release) {
    const version = release[1] ?? release[2];
    return {
      code: "java.jdk-too-old",
      message: `El proyecto pide Java ${version}, y el JDK que usa ${name} es más viejo.`,
      remediation: `Instalá un JDK ${version} o más nuevo y apuntá JAVA_HOME a su carpeta. ${RESTART_VSCODE}`,
    };
  }

  // Gradle con toolchain: el proyecto declara la versión de Java y Gradle no
  // la encuentra instalada.
  const toolchainRequest =
    /Cannot find a Java installation on your machine matching|No matching toolchains found/.test(output);
  if (toolchainRequest) {
    const version = /languageVersion=(\d+)/.exec(output)?.[1];
    return {
      code: "java.jdk-too-old",
      message: `El proyecto pide ${version ? `Java ${version}` : "una versión de Java"} en su configuración y ${name} no la encontró instalada.`,
      remediation: `Instalá ${version ? `un JDK ${version}` : "esa versión del JDK"}. ${RESTART_VSCODE}`,
    };
  }

  // Un Gradle viejo sobre un JDK nuevo no puede ni leer sus propias clases.
  if (commands.tool === "gradle" && /Unsupported class file major version (\d+)/.test(output)) {
    return {
      code: "java.gradle-jdk-incompatible",
      message: "La versión de Gradle del proyecto no funciona con el JDK que está usando.",
      remediation: `Usá un JDK que esa versión de Gradle soporte, o actualizá el wrapper del proyecto con «gradle wrapper --gradle-version <versión>». ${RESTART_VSCODE}`,
    };
  }

  // El wrapper baja la herramienta la primera vez. Maven: «Cannot start maven
  // from wrapper». Gradle: «Downloading https://…gradle-9.8.0-bin.zip» y
  // después la excepción de Java.
  if (
    /Cannot start maven from wrapper/.test(output) ||
    (/Downloading https?:\/\/\S+\.zip/.test(output) && /Exception in thread "main"/.test(output))
  ) {
    return {
      code: "java.wrapper-download-failed",
      message: `${commands.wrapperName} no pudo descargar ${name}, y para eso hace falta Internet la primera vez.`,
      remediation: `Conectate a Internet y volvé a intentar ${activity.retry}: la descarga queda guardada para las siguientes. También podés instalar ${name} en la máquina.`,
    };
  }

  // No se pudo bajar una dependencia o un complemento. Maven: «Could not
  // transfer artifact», «could not be resolved», «Non-resolvable import
  // POM». Gradle: «Could not resolve all files for configuration».
  if (
    /Could not transfer artifact|could not be resolved|Could not resolve dependencies|Non-resolvable (?:import|parent) POM|Could not resolve all (?:files|dependencies|artifacts)|Could not resolve [\w.-]+:[\w.-]+:/.test(
      output
    )
  ) {
    return {
      code: "java.dependencies-unavailable",
      message: `${name} no pudo descargar lo que el proyecto necesita (dependencias o complementos).`,
      remediation: `Conectate a Internet y volvé a intentar ${activity.retry}: solo hace falta la primera vez, después queda guardado. Si ya tenés Internet, probá ${activity.doing} el proyecto con ${name} en una terminal.`,
    };
  }

  return undefined;
}

/** Dónde quedó la salida, para el aviso de un fallo que no se reconoció. */
export function savedOutputHint(stage: "verification" | "test-run"): string {
  return `La salida completa quedó en AgentOutputs/${stage}/${stage}-output.json.`;
}
