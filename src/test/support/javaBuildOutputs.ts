import * as fsp from "fs/promises";
import * as path from "path";
import type { BuildLauncher, BuildRunResult, JavaBuildToolchain } from "../../adapters/java/build/toolchain";
import type { SupportedBuildTool } from "../../adapters/java/discovery/layout";

/**
 * Salidas e informes de Maven 3.10.0 y Gradle 9.8.0 (JDK 21, JaCoCo 0.8.15),
 * extractos de corridas reales del 2026-10-12 sobre los proyectos de ejemplo
 * de JUnit, con cada caso provocado a propósito. Se acortaron sin cambiar su
 * forma: las líneas repetidas, la sangría y el texto que rodea a lo que
 * importa son los de verdad. Las rutas se arman con la raíz de cada prueba.
 *
 * Se usan con una herramienta de mentira que devuelve la salida y deja los
 * informes donde los dejaría la de verdad.
 */

/** Maven escribe las rutas absolutas con «/» y una barra delante de la unidad. */
export function mavenPath(root: string, relative: string): string {
  const forward = `${root.replace(/\\/g, "/")}/${relative}`;
  return /^[A-Za-z]:/.test(forward) ? `/${forward}` : forward;
}

/** Gradle las escribe con el separador del sistema. */
export function gradlePath(root: string, relative: string): string {
  return path.join(root, ...relative.split("/"));
}

/** Tres errores en la prueba: tipos, método inexistente y clase inexistente. */
export function mavenCompileErrors(root: string, artifact: string): string {
  const file = mavenPath(root, artifact);
  return `[INFO] --- compiler:3.16.0:testCompile (default-testCompile) @ tienda ---
[INFO] Recompiling the module because of changed source code.
[INFO] Compiling 2 source files with javac [debug release 17] to target\\test-classes
[INFO] -------------------------------------------------------------
[ERROR] COMPILATION ERROR :
[INFO] -------------------------------------------------------------
[ERROR] ${file}:[11,31] incompatible types: int cannot be converted to java.lang.String
[ERROR] ${file}:[12,28] cannot find symbol
  symbol:   method sumar(int,int)
  location: variable sut of type com.tienda.Carrito
[ERROR] ${file}:[13,9] cannot find symbol
  symbol:   class Desconocida
  location: class com.tienda.UTIA_prueba_Carrito_agregar_Test
[INFO] 3 errors
[INFO] -------------------------------------------------------------
[INFO] ------------------------------------------------------------------------
[ERROR] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.16.0:testCompile (default-testCompile) on project tienda: Compilation failure: Compilation failure:
[ERROR] ${file}:[11,31] incompatible types: int cannot be converted to java.lang.String
[ERROR] ${file}:[12,28] cannot find symbol
[ERROR]   symbol:   method sumar(int,int)
[ERROR]   location: variable sut of type com.tienda.Carrito
[ERROR] ${file}:[13,9] cannot find symbol
[ERROR]   symbol:   class Desconocida
[ERROR]   location: class com.tienda.UTIA_prueba_Carrito_agregar_Test
[ERROR] -> [Help 1]
[ERROR]
[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.`;
}

/** Un error en el código del proyecto: Maven corta antes de compilar las pruebas. */
export function mavenMainError(root: string): string {
  const file = mavenPath(root, "src/main/java/com/tienda/Carrito.java");
  return `[INFO] --- compiler:3.16.0:compile (default-compile) @ tienda ---
[INFO] Recompiling the module because of changed source code.
[INFO] Compiling 1 source file with javac [debug release 17] to target\\classes
[INFO] -------------------------------------------------------------
[ERROR] COMPILATION ERROR :
[INFO] -------------------------------------------------------------
[ERROR] ${file}:[16,28] cannot find symbol
  symbol:   variable c
  location: class com.tienda.Carrito
[INFO] 1 error
[INFO] -------------------------------------------------------------
[ERROR] BUILD FAILURE
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.16.0:compile (default-compile) on project tienda: Compilation failure
[ERROR] ${file}:[16,28] cannot find symbol
[ERROR]   symbol:   variable c
[ERROR]   location: class com.tienda.Carrito
[ERROR] -> [Help 1]`;
}

/**
 * Compila con un aviso en la prueba. El del otro archivo no está en la
 * corrida real: se agregó para comprobar que los ajenos se descartan.
 */
export function mavenWarnings(root: string, artifact: string): string {
  return `[INFO] --- compiler:3.16.0:testCompile (default-testCompile) @ tienda ---
[INFO] Recompiling the module because of changed source code.
[INFO] Compiling 2 source files with javac [debug release 17] to target\\test-classes
[WARNING] ${mavenPath(root, artifact)}:[9,25] Integer(int) in java.lang.Integer has been deprecated and marked for removal
[WARNING] ${mavenPath(root, "src/test/java/com/tienda/CarritoTests.java")}:[4,5] Integer(int) in java.lang.Integer has been deprecated and marked for removal
[INFO] ------------------------------------------------------------------------
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------`;
}

/** El proyecto no declara JUnit 5: fallan también las pruebas que ya tenía. */
export function mavenWithoutJUnit(root: string, artifact: string): string {
  const existing = mavenPath(root, "src/test/java/com/tienda/CarritoTests.java");
  const file = mavenPath(root, artifact);
  return `[INFO] --- compiler:3.16.0:testCompile (default-testCompile) @ tienda ---
[INFO] -------------------------------------------------------------
[ERROR] COMPILATION ERROR :
[INFO] -------------------------------------------------------------
[ERROR] ${existing}:[13,36] package org.junit.jupiter.api does not exist
[ERROR] ${existing}:[13,1] static import only from classes and interfaces
[ERROR] ${file}:[3,29] package org.junit.jupiter.api does not exist
[ERROR] ${file}:[4,36] package org.junit.jupiter.api does not exist
[ERROR] ${file}:[4,1] static import only from classes and interfaces
[ERROR] ${existing}:[22,10] cannot find symbol
  symbol:   class Test
  location: class com.tienda.CarritoTests
[INFO] 6 errors
[ERROR] BUILD FAILURE`;
}

export const MAVEN_SUCCESS = `[INFO] --- compiler:3.16.0:testCompile (default-testCompile) @ tienda ---
[INFO] Nothing to compile - all classes are up to date.
[INFO] ------------------------------------------------------------------------
[INFO] BUILD SUCCESS`;

export const MAVEN_NO_JAVA = `The JAVA_HOME environment variable is not defined correctly,
this environment variable is needed to run this program.
`;

export const MAVEN_JRE = `[INFO] --- compiler:3.16.0:compile (default-compile) @ tienda ---
[INFO] Compiling 2 source files with javac [debug release 17] to target\\classes
[INFO] -------------------------------------------------------------
[ERROR] COMPILATION ERROR :
[INFO] -------------------------------------------------------------
[ERROR] No compiler is provided in this environment. Perhaps you are running on a JRE rather than a JDK?
[INFO] 1 error
[ERROR] BUILD FAILURE
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.16.0:compile (default-compile) on project tienda: Compilation failure
[ERROR] No compiler is provided in this environment. Perhaps you are running on a JRE rather than a JDK?`;

export const MAVEN_RELEASE_UNSUPPORTED = `[INFO] --- compiler:3.16.0:compile (default-compile) @ tienda ---
[INFO] Compiling 2 source files with javac [debug release 25] to target\\classes
[ERROR] BUILD FAILURE
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.16.0:compile (default-compile) on project tienda: Fatal error compiling: error: release version 25 not supported -> [Help 1]`;

export const MAVEN_OFFLINE = `[INFO] Scanning for projects...
[ERROR] [ERROR] Some problems were encountered while processing the POMs:
[ERROR] Non-resolvable import POM: The following artifacts could not be resolved: org.junit:junit-bom:pom:6.1.3 (absent): Could not transfer artifact org.junit:junit-bom:pom:6.1.3 from/to nada (https://repo.invalid/maven2): Host desconocido (repo.invalid) @ line 17, column 16
[ERROR] 'dependencies.dependency.version' for org.junit.jupiter:junit-jupiter:jar is missing. @ line 28, column 15
 @
[ERROR] The build could not read 1 project -> [Help 1]`;

/** El wrapper no pudo bajar Maven: el error de PowerShell llega en la página de la consola. */
export const MAVEN_WRAPPER_OFFLINE = `icm : Excepci\uFFFDn al llamar a "DownloadFile" con los argumentos "2": "No se puede resolver el nombre remoto:
'repo.invalid'"
    + FullyQualifiedErrorId : WebException,Microsoft.PowerShell.Commands.InvokeCommandCommand

Cannot start maven from wrapper`;

export const MAVEN_NO_TESTS = `[INFO] --- surefire:3.6.0:test (default-test) @ tienda ---
[INFO] ------------------------------------------------------------------------
[ERROR] BUILD FAILURE
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.6.0:test (default-test) on project tienda: No tests matching pattern "com.tienda.UTIA_prueba_Carrito_agregar_Test" were executed! (Set -Dsurefire.failIfNoSpecifiedTests=false to ignore this error.) -> [Help 1]`;

export const MAVEN_TESTS_RAN = `[INFO] Running com.tienda.UTIA_prueba_Carrito_agregar_Test
[ERROR] Tests run: 5, Failures: 1, Errors: 1, Skipped: 2, Time elapsed: 0.094 s <<< FAILURE! -- in com.tienda.UTIA_prueba_Carrito_agregar_Test
[ERROR] Tests run: 5, Failures: 1, Errors: 1, Skipped: 2
[INFO] --- jacoco:0.8.15:report (default-cli) @ tienda ---
[INFO] Loading execution data file target\\utia-run\\jacoco.exec
[INFO] BUILD SUCCESS`;

/** Con un `<argLine>` propio en el `pom.xml`, JaCoCo no observa nada. */
export const MAVEN_JACOCO_SKIPPED = `[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0
[INFO] --- jacoco:0.8.15:report (default-cli) @ tienda ---
[INFO] Skipping JaCoCo execution due to missing execution data file.
[INFO] BUILD SUCCESS`;

/** Gradle muestra el formato de `javac`, sin columna y con la línea del «^». */
export function gradleCompileErrors(root: string, artifact: string): string {
  const file = gradlePath(root, artifact);
  return `> Task :compileJava UP-TO-DATE
> Task :processResources NO-SOURCE
> Task :classes UP-TO-DATE

> Task :compileTestJava FAILED
${file}:11: error: incompatible types: int cannot be converted to String
        String texto = sut.add(1, 2);
                              ^
${file}:12: error: cannot find symbol
        assertEquals(3, sut.sumar(1, 2));
                           ^
  symbol:   method sumar(int,int)
  location: variable sut of type Carrito
${file}:13: warning: [removal] Integer(int) in Integer has been deprecated and marked for removal
        Integer viejo = new Integer(3);
                        ^
2 errors
1 warning

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':compileTestJava' (registered by plugin class 'org.gradle.api.plugins.JavaBasePlugin').
> Compilation failed; see the compiler output below.
  ${file}:11: error: incompatible types: int cannot be converted to String
          String texto = sut.add(1, 2);
                                ^
  ${file}:12: error: cannot find symbol
          assertEquals(3, sut.sumar(1, 2));
                             ^
    symbol:   method sumar(int,int)
    location: variable sut of type Carrito
  ${file}:13: warning: [removal] Integer(int) in Integer has been deprecated and marked for removal
          Integer viejo = new Integer(3);
                          ^
  2 errors
  1 warning

* Try:
> Check your code and dependencies to fix the compilation error(s)

BUILD FAILED in 1s`;
}

export const GRADLE_NO_TESTS = `> Task :test FAILED

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':test'.
> No tests found for given includes: [com.tienda.UTIA_prueba_Carrito_agregar_Test](--tests filter)

BUILD FAILED in 1s`;

export const GRADLE_NO_JAVA = `
ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.

Please set the JAVA_HOME variable in your environment to match the
location of your Java installation.
`;

export const GRADLE_JRE = `* What went wrong:
Could not determine the dependencies of task ':compileTestJava'.
> Could not resolve all dependencies for configuration ':testCompileClasspath'.
   > Failed to calculate the value of task ':compileTestJava' property 'javaCompiler'.
      > Toolchain installation 'C:\\Temp\\jre21' does not provide the required capabilities: [JAVA_COMPILER]`;

export const GRADLE_OFFLINE = `* What went wrong:
Execution failed for task ':compileTestJava' (registered by plugin class 'org.gradle.api.plugins.JavaBasePlugin').
> Could not resolve all files for configuration ':testCompileClasspath'.
   > Could not resolve org.junit:junit-bom:6.1.2.
     Required by:
         root project 'gradle'`;

export const GRADLE_WRAPPER_OFFLINE = `Fetching distribution.
Downloading https://services.invalid/distributions/gradle-9.8.0-bin.zip

Attempt 1/1 failed. Reason: services.invalid
Exception in thread "main" java.net.UnknownHostException: services.invalid
	at java.base/sun.nio.ch.NioSocketImpl.connect(NioSocketImpl.java:567)`;

/** El informe de Surefire de una clase con una prueba de cada resultado. */
export function surefireReport(testClass: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://maven.apache.org/surefire/maven-surefire-plugin/xsd/surefire-test-report.xsd" version="3.0.2" name="${testClass}" time="0.094" tests="5" errors="1" skipped="2" failures="1">
  <properties>
    <property name="java.version" value="21.0.12.1"/>
  </properties>
  <testcase name="supuesto" classname="${testClass}" time="0.0">
    <skipped type="org.opentest4j.TestAbortedException"><![CDATA[org.opentest4j.TestAbortedException: Assumption failed: rama que no se puede probar
	at org.junit.jupiter.api.Assumptions.throwAssumptionFailed(Assumptions.java:340)
]]></skipped>
  </testcase>
  <testcase name="deshabilitada" classname="${testClass}" time="0.0">
    <skipped message="no aplica"/>
  </testcase>
  <testcase name="pasa" classname="${testClass}" time="0.011"/>
  <testcase name="falla" classname="${testClass}" time="0.004">
    <failure message="1 + 2 debería dar 4 ==&gt; expected: &lt;4&gt; but was: &lt;3&gt;" type="org.opentest4j.AssertionFailedError"><![CDATA[org.opentest4j.AssertionFailedError: 1 + 2 debería dar 4 ==> expected: <4> but was: <3>
	at org.junit.jupiter.api.Assertions.assertEquals(Assertions.java:601)
	at com.tienda.UTIA_prueba_Carrito_agregar_Test.falla(UTIA_prueba_Carrito_agregar_Test.java:15)
]]></failure>
  </testcase>
  <testcase name="lanza" classname="${testClass}" time="0.004">
    <error message="explotó" type="java.lang.IllegalStateException"><![CDATA[java.lang.IllegalStateException: explotó
	at com.tienda.UTIA_prueba_Carrito_agregar_Test.lanza(UTIA_prueba_Carrito_agregar_Test.java:18)
]]></error>
  </testcase>
</testsuite>`;
}

/** Solo pruebas que pasan. */
export function passingReport(testClass: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${testClass}" time="0.02" tests="2" errors="0" skipped="0" failures="0">
  <testcase name="agregaUno" classname="${testClass}" time="0.011"/>
  <testcase name="agregaVarios" classname="${testClass}" time="0.002"/>
</testsuite>`;
}

/** El informe de Gradle: los nombres con «()», y la excepción como `failure`. */
export function gradleReport(testClass: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${testClass}" tests="4" skipped="1" failures="2" errors="0" timestamp="2026-10-12T20:08:02.981Z" hostname="ANDRES" time="0.104">
  <properties/>
  <testcase name="supuesto()" classname="${testClass}" time="0.044">
    <skipped message="org.opentest4j.TestAbortedException: Assumption failed: rama que no se puede probar" type="org.opentest4j.TestAbortedException">org.opentest4j.TestAbortedException: Assumption failed: rama que no se puede probar
</skipped>
  </testcase>
  <testcase name="falla()" classname="${testClass}" time="0.018">
    <failure message="org.opentest4j.AssertionFailedError: 7 no es cero ==&gt; expected: &lt;cero&gt; but was: &lt;positivo&gt;" type="org.opentest4j.AssertionFailedError">org.opentest4j.AssertionFailedError: 7 no es cero ==&gt; expected: &lt;cero&gt; but was: &lt;positivo&gt;
</failure>
  </testcase>
  <testcase name="lanza()" classname="${testClass}" time="0.002">
    <failure message="java.lang.IllegalStateException: explotó" type="java.lang.IllegalStateException">java.lang.IllegalStateException: explotó
</failure>
  </testcase>
  <testcase name="1 + 1 = 2" classname="${testClass}" time="0.002"/>
  <system-out><![CDATA[]]></system-out>
  <system-err><![CDATA[]]></system-err>
</testsuite>`;
}

/**
 * Informe de JaCoCo de `Clasificador.java`, una clase con condiciones, dos
 * sobrecargas de `clasificar`, una lambda dentro de `contarPares` y una clase
 * anidada, después de tres pruebas: `clasificar(-5)`, `contarPares([1, 2, 3])`
 * y `clasificar(7)`. Trae también `Calculator.java`, que no se ejecutó.
 */
export const JACOCO_REPORT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">
<report name="junit-jupiter-starter-maven">
<package name="com/example/project">
<class name="com/example/project/Clasificador$Interna" sourcefilename="Clasificador.java">
<method name="&lt;init&gt;" desc="()V" line="40">
<counter type="INSTRUCTION" missed="3" covered="0"/>
<counter type="LINE" missed="1" covered="0"/>
</method>
<method name="doble" desc="(I)I" line="42">
<counter type="INSTRUCTION" missed="4" covered="0"/>
<counter type="LINE" missed="1" covered="0"/>
</method>
<counter type="INSTRUCTION" missed="7" covered="0"/>
</class>
<class name="com/example/project/Clasificador" sourcefilename="Clasificador.java">
<method name="&lt;init&gt;" desc="()V" line="6">
<counter type="INSTRUCTION" missed="0" covered="3"/>
</method>
<method name="clasificar" desc="(I)Ljava/lang/String;" line="9">
<counter type="INSTRUCTION" missed="4" covered="14"/>
<counter type="BRANCH" missed="3" covered="5"/>
<counter type="LINE" missed="1" covered="4"/>
</method>
<method name="clasificar" desc="(Ljava/lang/String;)Ljava/lang/String;" line="18">
<counter type="INSTRUCTION" missed="9" covered="0"/>
<counter type="BRANCH" missed="2" covered="0"/>
<counter type="LINE" missed="1" covered="0"/>
</method>
<method name="contarPares" desc="(Ljava/util/List;)I" line="22">
<counter type="INSTRUCTION" missed="0" covered="23"/>
<counter type="BRANCH" missed="0" covered="4"/>
<counter type="LINE" missed="0" covered="7"/>
</method>
<method name="nivel" desc="(Ljava/lang/String;)I" line="33">
<counter type="INSTRUCTION" missed="14" covered="0"/>
<counter type="BRANCH" missed="3" covered="0"/>
<counter type="LINE" missed="4" covered="0"/>
</method>
<method name="lambda$contarPares$0" desc="(I)Z" line="22">
<counter type="INSTRUCTION" missed="0" covered="8"/>
<counter type="BRANCH" missed="0" covered="2"/>
<counter type="LINE" missed="0" covered="1"/>
</method>
<counter type="INSTRUCTION" missed="27" covered="48"/>
</class>
<class name="com/example/project/Calculator" sourcefilename="Calculator.java">
<method name="&lt;init&gt;" desc="()V" line="13">
<counter type="INSTRUCTION" missed="3" covered="0"/>
</method>
<method name="add" desc="(II)I" line="16">
<counter type="INSTRUCTION" missed="4" covered="0"/>
</method>
</class>
<sourcefile name="Clasificador.java">
<line nr="6" mi="0" ci="3" mb="0" cb="0"/>
<line nr="9" mi="0" ci="5" mb="1" cb="3"/>
<line nr="10" mi="0" ci="2" mb="0" cb="0"/>
<line nr="11" mi="0" ci="2" mb="1" cb="1"/>
<line nr="12" mi="2" ci="0" mb="0" cb="0"/>
<line nr="14" mi="2" ci="5" mb="1" cb="1"/>
<line nr="18" mi="9" ci="0" mb="2" cb="0"/>
<line nr="22" mi="0" ci="10" mb="0" cb="2"/>
<line nr="23" mi="0" ci="2" mb="0" cb="0"/>
<line nr="24" mi="0" ci="11" mb="0" cb="2"/>
<line nr="25" mi="0" ci="4" mb="0" cb="2"/>
<line nr="26" mi="0" ci="1" mb="0" cb="0"/>
<line nr="28" mi="0" ci="1" mb="0" cb="0"/>
<line nr="29" mi="0" ci="2" mb="0" cb="0"/>
<line nr="33" mi="8" ci="0" mb="3" cb="0"/>
<line nr="34" mi="2" ci="0" mb="0" cb="0"/>
<line nr="35" mi="2" ci="0" mb="0" cb="0"/>
<line nr="36" mi="2" ci="0" mb="0" cb="0"/>
<line nr="40" mi="3" ci="0" mb="0" cb="0"/>
<line nr="42" mi="4" ci="0" mb="0" cb="0"/>
<counter type="INSTRUCTION" missed="34" covered="48"/>
<counter type="BRANCH" missed="8" covered="11"/>
<counter type="LINE" missed="8" covered="12"/>
</sourcefile>
<sourcefile name="Calculator.java">
<line nr="13" mi="3" ci="0" mb="0" cb="0"/>
<line nr="16" mi="4" ci="0" mb="0" cb="0"/>
<counter type="INSTRUCTION" missed="7" covered="0"/>
<counter type="LINE" missed="2" covered="0"/>
</sourcefile>
</package>
</report>`;

/** Una corrida de la herramienta de mentira: lo que devuelve y los archivos que deja. */
export interface FakeBuildResponse {
  readonly exitCode?: number | null;
  readonly output?: string;
  readonly timedOut?: boolean;
  readonly spawnError?: string;
  /** Rutas relativas a la raíz del proyecto, con «/». */
  readonly files?: Readonly<Record<string, string>>;
}

export interface FakeBuildToolchain extends JavaBuildToolchain {
  readonly runs: { readonly launcher: BuildLauncher; readonly args: readonly string[]; readonly cwd: string }[];
}

/**
 * Maven o Gradle de mentira. `launcher: null` es que no está; si no, el
 * wrapper. Cada corrida contesta con lo que diga `respond`.
 */
export function fakeBuildToolchain(options: {
  readonly launcher?: BuildLauncher | null;
  readonly respond?: (args: readonly string[], tool: SupportedBuildTool) => FakeBuildResponse;
}): FakeBuildToolchain {
  const runs: FakeBuildToolchain["runs"] = [];
  let lastTool: SupportedBuildTool = "maven";
  return {
    runs,
    findLauncher: async (tool) => {
      lastTool = tool;
      if (options.launcher === null) {
        return undefined;
      }
      return options.launcher ?? { command: tool === "maven" ? "./mvnw" : "./gradlew", wrapper: true };
    },
    run: async (launcher, args, runOptions): Promise<BuildRunResult> => {
      runs.push({ launcher, args, cwd: runOptions.cwd });
      const response = options.respond?.(args, lastTool) ?? {};
      for (const [relative, content] of Object.entries(response.files ?? {})) {
        const target = path.join(runOptions.cwd, ...relative.split("/"));
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, content, "utf8");
      }
      return {
        exitCode: response.exitCode === undefined ? 0 : response.exitCode,
        timedOut: response.timedOut ?? false,
        ...(response.spawnError ? { spawnError: response.spawnError } : {}),
        output: response.output ?? "",
      };
    },
  };
}
