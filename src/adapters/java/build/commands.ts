import type { SupportedBuildTool } from "../discovery/layout";

/**
 * Qué se le pide a cada herramienta para compilar, ejecutar y medir, y dónde
 * deja lo que produce. Todo lo que cambia entre Maven y Gradle está aquí; la
 * compilación, la ejecución y la cobertura no preguntan cuál es.
 *
 * Medido con Maven 3.10.0 (Surefire 3.6.0) y Gradle 9.8.0, con JDK 21 y
 * JaCoCo 0.8.15, sobre los proyectos de ejemplo de JUnit.
 *
 * Las rutas son relativas a la raíz del proyecto, que es la carpeta de
 * trabajo: así no pasa por la línea de comandos ninguna ruta con espacios o
 * tildes, y quedan en la misma unidad que el proyecto, cosa que el agente de
 * JaCoCo exige en Gradle («'other' has different root» con el archivo en
 * otra unidad, comprobado).
 */

/**
 * Versión de JaCoCo que se le pide a Gradle. Fija, para que los números no
 * cambien solos de una corrida a otra; cada versión soporta hasta cierta
 * versión de Java (la 0.8.15 es de junio de 2026).
 */
export const JACOCO_VERSION = "0.8.15";

/**
 * A Maven, en cambio, se le pide sin versión. Si el `pom.xml` o su padre ya
 * enganchan JaCoCo con otra versión, pedir una fija suma un segundo agente a
 * la máquina virtual de las pruebas, y dos agentes de JaCoCo de versiones
 * distintas no pueden convivir: la máquina virtual se cae antes de correr
 * nada («duplicate class definition for java.lang.$JaCoCo», comprobado con
 * java-design-patterns, que trae la 0.8.13). Sin versión, Maven usa la que
 * declara el proyecto y queda un solo agente; si el proyecto no declara
 * JaCoCo, usa la última publicada.
 */
const JACOCO_MAVEN_PLUGIN = "org.jacoco:jacoco-maven-plugin";

export interface BuildCommands {
  readonly tool: SupportedBuildTool;
  /** «Maven», «Gradle». */
  readonly name: string;
  /** Nombre del wrapper, para los avisos: «mvnw», «gradlew». */
  readonly wrapperName: string;
  /** El comando instalado, para los avisos: «mvn», «gradle». */
  readonly installedName: string;
  /** Lo que se le pasa para compilar el código y las pruebas, sin ejecutarlas. */
  compileArgs(): string[];
  /** Lo que se le pasa para ejecutar solo la clase de la prueba, y medir si se pide. */
  testArgs(testClass: string, coverage: boolean): string[];
  /**
   * Carpeta propia de la extensión dentro de la de construcción: se vacía
   * antes de cada corrida, así que nunca quedan datos de una anterior.
   */
  readonly workDir: string;
  /** Informe JUnit de la clase de la prueba. */
  reportPath(testClass: string): string;
  /** Datos crudos de JaCoCo de la corrida. */
  readonly coverageDataPath: string;
  /** Informe XML de JaCoCo. */
  readonly coverageReportPath: string;
  /**
   * Archivos que hay que escribir en `workDir` antes de ejecutar, con su
   * contenido. Gradle necesita su configuración aparte.
   */
  readonly setupFiles: Readonly<Record<string, string>>;
}

/**
 * Maven, en modo batch (`-B`) y sin el progreso de las descargas (`-ntp`).
 *
 *   · Compilar es `test-compile`: compila todo `src/main/java` y después todo
 *     `src/test/java`. Un error en el código del proyecto corta antes de llegar
 *     a las pruebas.
 *   · `-Dtest=<clase>` corre solo esa clase, aunque su nombre no termine en
 *     `Test` (comprobado: sin el filtro, `mvn test` se la saltea). Si no
 *     encuentra la clase, falla con «No tests matching pattern».
 *   · `-Dmaven.test.failure.ignore=true` deja que una prueba que falla termine
 *     en éxito, para que JaCoCo escriba el informe después: una prueba que falla
 *     también recorre código.
 *   · JaCoCo se pide por sus coordenadas, sin versión y sin tocar el
 *     `pom.xml` (ver `JACOCO_MAVEN_PLUGIN`). Su informe va siempre a
 *     `target/site/jacoco/` (esa carpeta no se puede cambiar desde la línea de
 *     comandos), y el de Surefire a `target/surefire-reports/`.
 */
export const MAVEN: BuildCommands = {
  tool: "maven",
  name: "Maven",
  wrapperName: "mvnw",
  installedName: "mvn",
  workDir: "target/utia-run",
  coverageDataPath: "target/utia-run/jacoco.exec",
  coverageReportPath: "target/site/jacoco/jacoco.xml",
  setupFiles: {},
  compileArgs: () => ["-B", "-ntp", "test-compile"],
  testArgs: (testClass, coverage) => [
    "-B",
    "-ntp",
    ...(coverage ? [`${JACOCO_MAVEN_PLUGIN}:prepare-agent`] : []),
    "test",
    `-Dtest=${testClass}`,
    "-Dmaven.test.failure.ignore=true",
    ...(coverage
      ? [
          `-Djacoco.destFile=${MAVEN.coverageDataPath}`,
          `-Djacoco.dataFile=${MAVEN.coverageDataPath}`,
          `${JACOCO_MAVEN_PLUGIN}:report`,
        ]
      : []),
  ],
  reportPath: (testClass) => `target/surefire-reports/TEST-${testClass}.xml`,
};

const GRADLE_INIT_SCRIPT = "utia.gradle";

/**
 * Configuración que Gradle carga además de la del proyecto (`--init-script`),
 * para no tocar su `build.gradle`:
 *
 *   · la tarea de pruebas nunca se da por hecha ni se trae del caché: sin
 *     esto, volver a ejecutar sin cambios no corre nada;
 *   · el informe JUnit va a la carpeta de la extensión;
 *   · con cobertura, aplica JaCoCo e ignora las pruebas que fallan, para que
 *     el informe se escriba igual.
 */
const INIT_SCRIPT = `// Escrito por la extensión UnityTestAI para ejecutar la prueba generada.
allprojects {
    plugins.withId('java') {
        tasks.named('test') {
            outputs.upToDateWhen { false }
            outputs.cacheIf { false }
            reports.junitXml.outputLocation.set(file(project.property('utia.testResults')))
        }
        if (project.hasProperty('utia.jacocoXml')) {
            apply plugin: 'jacoco'
            jacoco { toolVersion = '${JACOCO_VERSION}' }
            def execFile = file(project.property('utia.jacocoExec'))
            tasks.named('test') {
                ignoreFailures = true
                jacoco { destinationFile = execFile }
            }
            tasks.named('jacocoTestReport') {
                executionData.setFrom(execFile)
                reports {
                    xml.required.set(true)
                    xml.outputLocation.set(file(project.property('utia.jacocoXml')))
                    html.required.set(false)
                    csv.required.set(false)
                }
            }
        }
    }
}
`;

/**
 * Gradle, con la consola en texto plano y sin dejar un proceso de fondo
 * (`--no-daemon`). El proceso de fondo hace las corridas siguientes más
 * rápidas (2 s contra 7 s, medido), pero queda en memoria (415 MB, medido)
 * hasta tres horas después de la última, y eso no es algo que quien genera
 * una prueba espere.
 *
 *   · Compilar es `testClasses`, que compila el código y las pruebas.
 *   · `--tests <clase>` corre solo esa clase (comprobado: no toma otra que
 *     empiece igual). Sin pruebas, falla con «No tests found for given
 *     includes»; lo mismo si el proyecto no activa JUnit 5
 *     (`useJUnitPlatform()`).
 *   · Las pruebas que fallan cuentan como `failure`, también las que lanzan
 *     una excepción, y los nombres llevan «()».
 */
export const GRADLE: BuildCommands = {
  tool: "gradle",
  name: "Gradle",
  wrapperName: "gradlew",
  installedName: "gradle",
  workDir: "build/utia-run",
  coverageDataPath: "build/utia-run/jacoco.exec",
  coverageReportPath: "build/utia-run/jacoco.xml",
  setupFiles: { [GRADLE_INIT_SCRIPT]: INIT_SCRIPT },
  compileArgs: () => ["--console=plain", "--no-daemon", "testClasses"],
  testArgs: (testClass, coverage) => [
    "--console=plain",
    "--no-daemon",
    "--init-script",
    `${GRADLE.workDir}/${GRADLE_INIT_SCRIPT}`,
    "test",
    "--tests",
    testClass,
    `-Putia.testResults=${GRADLE.workDir}/test-results`,
    ...(coverage
      ? [
          "jacocoTestReport",
          `-Putia.jacocoExec=${GRADLE.coverageDataPath}`,
          `-Putia.jacocoXml=${GRADLE.coverageReportPath}`,
        ]
      : []),
  ],
  reportPath: (testClass) => `${GRADLE.workDir}/test-results/TEST-${testClass}.xml`,
};

export function commandsFor(tool: SupportedBuildTool): BuildCommands {
  return tool === "maven" ? MAVEN : GRADLE;
}
