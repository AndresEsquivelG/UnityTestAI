# Contexto para continuar — UnityTestAI

Documento de traspaso. Escrito el 2026-09-17, al final de la sesión en la que se
definió el contrato de adaptación y se construyó el adaptador de Unity.

---

## 1. Qué es el proyecto

Práctica profesional. El punto de partida es **IAutoTest**: una extensión de VS
Code que genera pruebas unitarias con modelos de lenguaje mediante un pipeline
de agentes, hoy atada al ecosistema Unity/C#.

El objetivo es **rediseñar su arquitectura con una capa de adaptadores**, de modo
que se puedan incorporar Java y Python sin modificar el núcleo. Cada adaptador
encapsula un ecosistema completo: lenguaje, framework de pruebas, estructura del
proyecto, herramienta de construcción y mecanismo de cobertura.

Los documentos que gobiernan el trabajo viven **fuera del repositorio**:

```
C:\Users\minif\OneDrive\Documentos\Universidad\OctavoSemestre\Informe uno\
├── Anteproyecto_Andrés Esquivel.docx   ← Tabla 9 (reparto núcleo/adaptador),
│                                          Tabla 10 (operaciones OP-01 a OP-16),
│                                          requerimientos RF/RNF, decisiones de
│                                          diseño e historias HU-01 a HU-39
└── Backlog_reordenado.docx             ← reordena las historias en épicas E0 a
                                           E6 y añade HU-40, HU-41 y HU-42
```

Son archivos zip: se leen extrayendo `word/document.xml`. Si Word los tiene
abiertos, Python falla con «Permission denied»; hay que copiarlos antes desde
PowerShell abriendo el archivo con `FileShare.ReadWrite`.

---

## 2. Cómo trabajar en este proyecto

Instrucciones dadas por Andrés, válidas para todo lo que siga:

- **En español.**
- **Explicá en términos sencillos y sé crítico.** Señalá lo que no cumple, con
  evidencia concreta (archivo y línea), en lugar de validar lo que ya está.
- **Los comentarios del código y los mensajes de commit no citan historias ni
  requerimientos.** Nada de HU-xx, RF-xx, RNF-xx ni referencias al anteproyecto:
  solo se explica el cambio y su porqué técnico. Los `OP-xx` sí se conservan,
  porque nombran las operaciones de la propia interfaz.
- **Los commits los hace Andrés.** El asistente solo sugiere el mensaje.
- **Ignorá las fechas de las épicas.** Si algo se puede arreglar de paso y ayuda
  a futuro, se arregla.

---

## 3. Estado del repositorio

Rama `HU-01`, al día con `origin/HU-01`, sin cambios pendientes.

```
d037ba1  feat(adapters): implement the Unity adapter based on the contract
bbf53bb  refactor(core): adjust the contract prior to the first adapter
5d6e1fd  feat(core): definir contrato de adaptación de ecosistema (HU-01)
b61d21f  fix: remove stray character in extension.ts
```

Comprobaciones disponibles:

```bash
npm run test:unit        # 63 pruebas: adaptador, lectura de C#, registro,
                         # selección, piezas neutras del núcleo y cableado
npx tsc --noEmit -p .    # comprobación de tipos de todo el proyecto
npx eslint src           # 11 avisos previos de `curly`, ninguno en core ni adapters
npm run compile          # empaquetado con webpack
```

---

## 4. Lo que ya está hecho

### 4.1 Contrato de adaptación — `src/core/contracts/`

Interfaz `EcosystemAdapter` con las dieciséis operaciones: once obligatorias como
miembros requeridos y cinco opcionales (OP-09, OP-13, OP-14, OP-15 y OP-16) como
miembros opcionales que además se declaran en `capabilities`. `index.ts` es el
punto de entrada único y contiene la tabla de correspondencia entre operaciones y
tipos. Son solo declaraciones de tipos, sin implementación.

Ajustes que se aplicaron **antes** de escribir el primer adaptador, cuando aún
eran gratis:

| Cambio | Motivo |
|---|---|
| `getPromptProfile(project)` en vez de una propiedad fija | La variante del marco de pruebas y la herramienta de construcción dependen del proyecto |
| `AnalysisSchemaExtension.format(data)` | Sin ella, los campos propios del ecosistema los seguiría formateando el núcleo |
| `UnitTarget.className: string \| null` | Una función a nivel de módulo no tiene clase |
| `CapabilityMap.verification: "compile" \| "importCheck" \| "none"` | Un ecosistema interpretado no compila, pero sí comprueba importabilidad |
| `detectApplicability(DetectionContext)` | El proyecto no siempre ocupa la primera carpeta del espacio de trabajo; el archivo abierto entra como pista secundaria |
| `ProjectModel.adapterData` | Memoria opaca del descubrimiento: Maven o Gradle, versión del editor, ubicación del `.asmdef` |
| `AdapterDescriptor.languageIds` | Presentación y avisos, sin que el núcleo pregunte por el `id` |

**Divergencia deliberada respecto de la Tabla 10:** OP-13 se llama
`verifyArtifact` y devuelve `VerificationResult`, no «compilación». Se apoya en
RF-16 (la compilación tiene equivalente en ecosistemas interpretados) y en HU-27
(Python declara importabilidad sin lógica condicional en el núcleo). **Hay que
sostener esta divergencia en el informe o revertirla.**

### 4.2 Adaptador de Unity — `src/adapters/unity/`

Primera implementación del contrato: las once operaciones obligatorias, sin
ninguna capacidad opcional. No importa `vscode`, así que se puede ejercitar sin
abrir el editor.

| Archivo | Contenido |
|---|---|
| `unityAdapter.ts` | La clase: descriptor, capacidades y delegación |
| `detection.ts` | OP-02: marcadores `Assets/`, `ProjectVersion.txt`, `manifest.json` y grado de confianza |
| `projectModel.ts` | OP-04: recorrido de `Assets`, jerarquías principal y de pruebas, versión del editor |
| `csharpSource.ts` | Lectura léxica de C#: enmascarado de comentarios y cadenas, cuerpos de tipos, declaraciones |
| `symbols.ts` | OP-05, OP-06 y OP-07 |
| `artifact.ts` | OP-10, OP-11 y OP-12 |
| `promptProfile.ts` | OP-08, vacío a propósito |

Tres diferencias de comportamiento respecto del código viejo:

1. **La prueba se escribirá en `Assets/Tests`.** El generador actual usa `Tests`
   relativo a la carpeta abierta, que solo cae dentro de `Assets` si se abrió esa
   carpeta; fuera de `Assets`, el editor no compila las pruebas.
2. **La localización recorre el proyecto entero**, enmascara comentarios y
   cadenas, exige tipo de retorno y cuerpo, descarta funciones locales, es
   sensible a mayúsculas y devuelve todas las sobrecargas con su firma. Corrige
   los dos falsos positivos de `checkSymbols`.
3. **El modelo se ancla en la raíz de Unity** aunque se abra `Assets`, así que
   las rutas relativas siempre empiezan por `Assets/` y la doble tentativa de
   `readDependencyFiles` deja de hacer falta.

Límites conocidos, documentados en el código: no localiza constructores ni
declaraciones sin cuerpo (abstractos e interfaces), y no resuelve dependencias
fuera de `Assets`, como las de `Packages/`.

### 4.3 Arnés de pruebas

`tsconfig.test.json` compila a CommonJS solo lo que las pruebas ejercitan, y
`npm run test:unit` las corre con el ejecutor que ya trae Node. **Sin
dependencias nuevas y sin levantar el editor.** El proyecto Unity de prueba se
arma en una carpeta temporal (`src/test/support/unityFixture.ts`) y se borra al
terminar. 63 pruebas, unos 180 ms.

Es también el lugar donde van a vivir la foto de los prompts y la futura suite de
contrato.

### 4.4 Registro, selección y cableado del núcleo

`src/core/adapters/` y `src/core/project/`. El núcleo ya trabaja contra la
interfaz: `extension.ts` es el único archivo que importa `UnityAdapter`.

| Archivo | Contenido |
|---|---|
| `adapters/registry.ts` | Alta y recuperación. El orden de alta es la preferencia |
| `adapters/capabilityConsistency.ts` | Comprueba que OP-03 y las operaciones opcionales no divergan; el registro rechaza al incoherente |
| `adapters/selection.ts` | Consulta OP-02 a cada adaptador y ordena por confianza. Recibe la lista como parámetro |
| `project/projectTree.ts` | Dibuja el modelo como árbol de texto (sustituye a `getFilteredAssetsTree`) |
| `project/artifact.ts` | Ruta y escritura del artefacto, y presentación de los incumplimientos de OP-12 |
| `project/dependencies.ts` | Recorre las referencias del agente resolutor contra OP-07 |

`handleGenerate` ahora encadena OP-04 → OP-05 → OP-10 → OP-12 → OP-06 → agentes
→ OP-11 → escritura, y `validateInputs` usa OP-05. Borrados:
`getFilteredAssetsTree.ts`, `codeValidation.ts`, `testSaver.ts`,
`dependencyPromptHandler.ts`, `readDependencyFiles` y `prompts/basePrompt.txt`.

Cambios de comportamiento que hay que tener presentes:

1. **Sin ecosistema reconocido no se abre el panel.** Antes se abría y la corrida
   moría al final, después de pagar el pipeline completo.
2. **Las precondiciones se comprueban antes de la primera llamada al modelo**, y
   ahora incluyen el `.asmdef`, que antes vivía en código muerto. Un proyecto con
   `Assets/Tests` sin `.asmdef` deja de generar.
3. **El código analizado sale de OP-06**, no del editor, salvo cuando la
   declaración está en el archivo abierto. Antes, pedir una clase declarada en
   otro archivo fallaba de entrada.
4. **`AgentOutputs` se escribe en la raíz del proyecto**, no en la carpeta
   abierta, así que ya no cae dentro de `Assets` cuando se abre esa carpeta.
5. **El árbol del prompt cambia**: sin carpetas vacías de fuentes, con guion en
   la primera línea y en orden determinista.

---

## 5. Lo que falta, en orden

1. ~~**Registro de adaptadores y cableado del núcleo.**~~ Hecho: ver 4.4. Queda
   fuera el selector manual de ecosistema, que solo hace falta cuando haya más de
   un adaptador; la selección ya devuelve las candidatas ordenadas y marca el
   empate para poder preguntar.
2. **Foto de los prompts actuales.** Guardar lo que producen hoy las ocho
   funciones `build*Prompt` con entradas fijas, como prueba.
3. **Plantillas neutras.** Separar cada plantilla en parte neutra (núcleo) y
   fragmentos del perfil del adaptador, **exigiendo que el prompt resultante sea
   idéntico letra por letra**. Empezar por las pequeñas (`dependencyResolver`,
   `contextValidator`) y dejar `testGenerator` y `codeAnalyzer` —que necesita
   OP-09— para el final. Recién después de eso, deduplicar y mejorar la
   redacción: eso ya cambia el prompt y hay que medirlo.
4. **Más adelante:** capacidades reales (compilar, ejecutar pruebas, recolectar
   cobertura), detección automática y selector de ecosistema, regla de análisis
   estático que prohíba nombres de tecnologías en el núcleo, y un adaptador
   ficticio como fixture de pruebas cuando Unity empiece a declarar
   `verification: "compile"`.

---

## 6. Decisiones tomadas

No conviene reabrirlas sin un motivo nuevo:

- **Sin adaptador ficticio por ahora.** El adaptador de Unity ya nace declarando
  todas las capacidades opcionales en falso —hoy es cierto: no compila, no
  ejecuta ni mide cobertura—, así que el camino «capacidad ausente» del núcleo se
  ejercita igual. El ficticio vuelve como fixture de pruebas cuando Unity declare
  capacidades verdaderas.
- **El perfil de prompt se dividirá** en vocabulario obligatorio (nombre del
  lenguaje, framework de pruebas, etiqueta del bloque de código) y bloques de
  reglas opcionales. El cambio de forma se hace al extraer las plantillas, porque
  la lista real de bloques sale de ese trabajo.
- **Dos capas de conocimiento dentro de `adapters/`:** lo que es del lenguaje C#
  (reflexión, espacios de nombres, visibilidad por defecto) y lo que es del
  ecosistema Unity (`MonoBehaviour`, `Start`/`Awake`, `Input.*` en PlayMode,
  `[UnityTest]`, `.asmdef`). El núcleo ve un solo perfil ya combinado.
- **El selector listará ecosistemas** («Unity / C#»), no lenguajes: un proyecto
  .NET con xUnit también es C# y no le sirve este adaptador.
- **`prompts/basePrompt.txt` es código muerto:** `promptBuilder` no la carga
  nunca. No hay que derivar nada de ella.

---

## 7. Lo que todavía está atado a Unity dentro del núcleo

| Qué | Dónde | Destino |
|---|---|---|
| Campos de Unity en el esquema del analizador | `src/agents/codeAnalyzer.ts:34,41-44,75` | OP-09 — pendiente |
| Formateo de esos campos para el prompt | `src/webview/webviewManager.ts:132-226` | OP-09 — pendiente |
| Conocimiento de Unity y C# en las ocho plantillas vivas | `prompts/*.txt` | OP-08 — pendiente |
| `language-cs` y la expresión regular de ```` ```csharp ```` | `ui/index.html:35`, `ui/scripts/managers/resultRendererManager.js:2,31` | Vocabulario del perfil — pendiente |
| Menciones de NUnit y PlayMode en comentarios | `src/agents/validator.ts:78,128`, `src/prompts/promptBuilder.ts:125,148` | Se van con OP-08 |

Las cuatro filas de «falta cablear» ya no están: el núcleo las consume a través
de la interfaz. El código muerto que las sostenía quedó borrado.

---

## 8. Deudas y riesgos conocidos

- **`verification.ts` es provisional.** Sus tres tipos no se derivaron de
  herramientas reales, porque el pipeline no invoca ninguna. Hay que
  contrastarlos con corridas manuales de Maven, Gradle, JaCoCo y pytest antes de
  darlos por buenos.
- **No hay línea base medida** del pipeline actual: ni tokens, ni tiempo por
  agente, ni tasa de pruebas que compilan. `AgentOutputs` se sobrescribe en cada
  corrida, así que el repositorio no la guarda. Hace falta tomarla **antes** de
  cambiar la redacción de los prompts, porque lo comprometido es igualar o
  superar esa línea base.
- **El pipeline, los agentes y los prompts no tienen ninguna prueba.** El arnés
  solo cubre el adaptador.
- **Empaquetado:** `.vscodeignore` excluye `src/**`. Si los fragmentos del perfil
  se guardan como archivos `.md` dentro de `src/adapters/unity/`, no viajan en el
  `.vsix`. Hay que decidirlo al extraer las plantillas: incrustarlos con
  `asset/source` de webpack o copiarlos a `dist/`.
- **Las capacidades opcionales no se consultan.** Las guardas
  `supportsVerification`, `supportsTestRun`, `supportsCoverage` y
  `supportsSchemaExtension` (`src/core/contracts/ecosystemAdapter.ts:194-213`) no
  tienen ni un sitio de llamada, porque el núcleo todavía no tiene etapa de
  verificación, ejecución ni cobertura. Es decir: el camino «capacidad ausente»
  **no está ejercitado**, contra lo que supone la primera decisión de la sección
  6. Se ejercitará al agregar esas etapas.
- **`PreconditionViolation` no tiene severidad.** El núcleo trata todo
  incumplimiento como bloqueante, así que la falta del `.asmdef` impide generar
  igual que la falta de la carpeta. Si conviene distinguir «no se puede escribir»
  de «se escribe pero el editor no lo va a compilar», el tipo necesita un campo,
  y eso ya es un cambio de contrato.
- **OP-08 sigue sin sitio de llamada.** `getPromptProfile` no se invoca en ningún
  lado, porque el perfil está vacío a propósito. Se cablea en el punto 3.
- **El panel muestra el archivo abierto, no el analizado.** Cuando la declaración
  está en otro archivo, el bloque de código de la interfaz no corresponde a lo
  que recorre el pipeline.
- **Dos recorridos del proyecto por generación.** `validateInputs` localiza para
  habilitar el paso 2 y `handleGenerate` vuelve a localizar porque necesita la
  declaración para OP-10. Frente a seis llamadas al modelo no se nota, pero son
  dos lecturas completas de las fuentes.

---

## 9. Para arrancar el próximo chat

> Leé `docs/contexto-traspaso.md` antes de responder. Seguimos por el punto 2 de
> «Lo que falta»: la foto de los prompts actuales, antes de tocar ninguna
> plantilla. Respetá las instrucciones de la sección 2.
