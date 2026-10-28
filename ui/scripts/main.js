// ./main.js

import { toggleElement } from "./domUtils.js";
import { renderResult } from "./managers/resultRendererManager.js";
import {
  getStepperState,
  setStepperState,
  applyStepUI,
  classStepLabel,
  isClassOptional,
  setClassOptional,
} from "./stepper.js";
import { setModels, getSelectedModel } from "./modelMenu.js";
import { initJsonLoader } from "./managers/jsonLoaderManager.js";
import {
  showChatUI,
  showLoadingUI,
  hideLoadingUI,
  resetUI,
  updateAgentStatus,
  clearAgentPipeline,
  showDependencyFilesList,
  showContextBuilderSlices,
  showVerificationRunning,
  showVerification,
  hideVerification,
} from "./managers/uiManager.js";
import { initChat, appendChatMessage } from "./managers/chatManager.js";
import "../styles/main.css";

/* ============================
   Inicialización del entorno
============================ */

// Instancia del API de VS Code para comunicación con la extensión
const vscode = acquireVsCodeApi();
window.vscode = vscode;

/* ============================
   Referencias DOM principales
============================ */

const toggleBtn = document.getElementById("toggleBtn"); // Botón para mostrar/ocultar bloque de código
const codeContainer = document.getElementById("codeContainer"); // Contenedor del código fuente (C#)
const generateBtn = document.getElementById("generateBtn"); // Botón para generar las pruebas
const resultContainer = document.getElementById("resultContainer"); // Contenedor del resultado del LLM
const copyBtn = document.getElementById("copyBtn"); // Botón para copiar el resultado del LLM
const genTimeBadge = document.getElementById("genTimeBadge"); // Tiempo total de generación
const genTokenBadge = document.getElementById("genTokenBadge"); // Tokens totales de la sesión
const currentStep = document.getElementById("currentStep"); // Texto del paso actual (1 de 2)
const stepperFill = document.getElementById("stepperFill"); // Barra de progreso del stepper
const stepperBox = document.getElementById("stepper"); // Contenedor completo del stepper
const stepLabel = document.getElementById("stepLabel"); // Etiqueta descriptiva del paso actual
const stepInput = document.getElementById("stepInput"); // Input donde se ingresa el valor del paso actual
const readyBadge = document.getElementById("readyBadge"); // Insignia que indica que los pasos están completos
const chatInput = document.getElementById("chatInput"); // Input del chat con el LLM
const chatSendBtn = document.getElementById("chatSendBtn"); // Botón para enviar mensajes al LLM
const reduceContextToggle = document.getElementById("reduceContextToggle"); // Toggle de contexto reducido
const reduceContextCaption = document.getElementById("reduceContextCaption"); // Etiqueta del toggle
const contextToggleBar = document.getElementById("contextToggleBar"); // Barra del toggle de contexto
const ecosystemBadge = document.getElementById("ecosystemBadge"); // Ecosistema detectado

function getReduceContext() {
  return reduceContextToggle ? reduceContextToggle.checked : true;
}

function hideContextToggle() {
  if (contextToggleBar) contextToggleBar.style.display = "none";
}
function showContextToggle() {
  if (contextToggleBar) contextToggleBar.style.display = "flex";
}

if (reduceContextToggle && reduceContextCaption) {
  reduceContextToggle.addEventListener("change", () => {
    reduceContextCaption.textContent = reduceContextToggle.checked
      ? "Contexto reducido"
      : "Contexto completo";
  });
}

/* ============================
   Inicialización de módulos
============================ */

// Inicializa resaltado de sintaxis en bloques <pre><code>
hljs.highlightAll();

// Permite cargar una configuración de prueba desde un archivo JSON
initJsonLoader();

// Configura el sistema de chat (entrada y envío)
initChat(vscode, chatInput, chatSendBtn);

// Notifica al backend cuando el DOM está listo
window.addEventListener("DOMContentLoaded", () => {
  vscode.postMessage({ command: "webviewReady" });
});

/* ============================
   Configuración del stepper
============================ */

// Inicializa el stepper en el paso 0
applyStepUI(0, {
  currentStep,
  stepperFill,
  stepperBox,
  readyBadge,
  stepLabel,
  stepInput,
});
setStepperState(0, "", "");

// Permite avanzar entre pasos presionando Enter
stepInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const val = stepInput.value.trim();
  const { step, classNameVal } = getStepperState();

  // Validar que el campo no esté vacío. La clase puede quedar vacía si el
  // ecosistema acepta funciones sin clase.
  if (!val && !(step === 0 && isClassOptional())) {
    stepInput.classList.add("error");
    setTimeout(() => stepInput.classList.remove("error"), 900);
    return;
  }

  // Paso 0: solicitar nombre de la clase
  if (step === 0) {
    setStepperState(1, val, undefined);
    applyStepUI(1, {
      currentStep,
      stepperFill,
      stepperBox,
      readyBadge,
      stepLabel,
      stepInput,
    });
  }
  // Paso 1: solicitar nombre del método y validar entradas
  else if (step === 1) {
    setStepperState(1, undefined, val);
    const { methodNameVal } = getStepperState();

    // Enviar los datos (clase y método) al backend para validación. El
    // proveedor y el modelo van también: entran en el nombre del archivo de la
    // prueba, y con ellos se sabe si ya hay una.
    const { selectedModel, selectedSubModel } = getSelectedModel();
    vscode.postMessage({
      command: "validateInputs",
      className: classNameVal.trim(),
      methodName: methodNameVal.trim(),
      model: selectedModel,
      subModel: selectedSubModel,
    });
  }
});

/* ============================
   Interacción con la UI
============================ */

// Alternar visibilidad del bloque de código fuente (Asset C#)
toggleBtn.addEventListener("click", () => {
  toggleElement(codeContainer, "collapsed");
  toggleBtn.textContent = codeContainer.classList.contains("collapsed")
    ? "Mostrar código"
    : "Ocultar código";
});

// Generar pruebas
generateBtn.addEventListener("click", () => {
  hideExistingTest();
  showLoadingUI();
  hideContextToggle();
  const { selectedModel, selectedSubModel } = getSelectedModel();

  vscode.postMessage({
    command: "generateTest",
    model: selectedModel,
    subModel: selectedSubModel,
    reduceContext: getReduceContext(),
  });
});

/* ============================
   Prueba que ya existe
============================ */

const existingTestNotice = document.getElementById("existingTestNotice");

function hideExistingTest() {
  if (!existingTestNotice) return;
  existingTestNotice.replaceChildren();
  existingTestNotice.style.display = "none";
}

/** Pasa al paso 2 y deja el panel esperando lo que pidió el botón. */
function enterStep2() {
  hideExistingTest();
  setStepperState(2, undefined, undefined);
  applyStepUI(2, {
    currentStep,
    stepperFill,
    stepperBox,
    readyBadge,
    stepLabel,
    stepInput,
  });
  showLoadingUI();
  hideContextToggle();
}

function startGeneration() {
  enterStep2();
  const { selectedModel, selectedSubModel } = getSelectedModel();
  vscode.postMessage({
    command: "generateTest",
    model: selectedModel,
    subModel: selectedSubModel,
    reduceContext: getReduceContext(),
  });
}

/** Compila, ejecuta y mide la prueba que ya existe, sin llamar al modelo. */
function startRunExisting() {
  enterStep2();
  const { selectedModel, selectedSubModel } = getSelectedModel();
  vscode.postMessage({
    command: "runExistingTest",
    model: selectedModel,
    subModel: selectedSubModel,
  });
}

/**
 * Ya hay una prueba de esa unidad con ese modelo: en lugar de generar otra
 * sin preguntar, se ofrece medir la que está. Con textContent: los nombres
 * vienen del código del proyecto.
 */
function showExistingTest(message) {
  if (!existingTestNotice) return;
  existingTestNotice.replaceChildren();

  const text = document.createElement("div");
  const unit = message.className
    ? `el método ${message.methodName} de ${message.className}`
    : `la función ${message.methodName}`;
  text.textContent = `Ya existe una prueba para ${unit}. Podés generar otra o ejecutarla y medirla, sin llamar al modelo.`;
  const file = document.createElement("span");
  file.className = "existing-test__file";
  file.textContent = message.testFile;
  text.appendChild(file);

  const actions = document.createElement("div");
  actions.className = "existing-test__actions";
  const run = document.createElement("button");
  run.textContent = "Ejecutar y medir";
  run.addEventListener("click", startRunExisting);
  const generate = document.createElement("button");
  generate.textContent = "Generar otra";
  generate.addEventListener("click", startGeneration);
  actions.append(run, generate);

  existingTestNotice.append(text, actions);
  existingTestNotice.style.display = "block";
  // «Todo listo» diría que la generación va a empezar, y espera la respuesta.
  if (readyBadge) readyBadge.style.display = "none";
}

/* ============================
   Tiempo de generación
============================ */

function formatElapsed(ms) {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes} m ${seconds} s`;
}

function showGenTime(ms) {
  if (!genTimeBadge || typeof ms !== "number") return;
  genTimeBadge.textContent = formatElapsed(ms);
  genTimeBadge.style.display = "inline-flex";
}

function formatTokens(n) {
  if (n < 1000) return `${n} tok`;
  return `${(n / 1000).toFixed(1)}k tok`;
}

function showGenTokens(total) {
  if (!genTokenBadge || typeof total !== "number") return;
  genTokenBadge.textContent = formatTokens(total);
  genTokenBadge.title = `${total.toLocaleString()} tokens (entrada + salida) en esta generación`;
  genTokenBadge.style.display = "inline-flex";
}

/* ============================
   Ecosistema detectado
============================ */

/**
 * Muestra contra qué ecosistema se va a generar. El texto lo compone el
 * adaptador; aquí solo se presenta, junto con los marcadores que lo
 * sustentan, para que una detección equivocada se pueda diagnosticar.
 */
function showEcosystem(ecosystem) {
  if (!ecosystemBadge || !ecosystem) return;

  ecosystemBadge.textContent = ecosystem.displayName;

  const confidence = Math.round((ecosystem.confidence ?? 0) * 100);
  const evidence = (ecosystem.evidence ?? []).join(", ");

  const tooltip = [`Ecosistema detectado con ${confidence}% de confianza`];
  if (evidence) tooltip.push(`Marcadores: ${evidence}`);
  tooltip.push(`Adaptador ${ecosystem.version}`);
  ecosystemBadge.title = tooltip.join("\n");

  ecosystemBadge.style.display = "inline-flex";

  // Si acepta funciones sin clase, la clase se puede dejar vacía. Solo cambia
  // la etiqueta: lo que la persona ya escribió queda.
  setClassOptional(ecosystem.moduleLevelUnits === true);
  if (getStepperState().step === 0) stepLabel.textContent = classStepLabel();
}

/* ============================
   Comunicación con el backend
============================ */

window.addEventListener("message", (event) => {
  const message = event.data;

  switch (message.command) {
    /* ----------------------------------------
      Mostrar la respuesta generada por el LLM
    ---------------------------------------- */
    case "agentStatus":
      // Hide the typing indicator — agent pipeline replaces it
      hideLoadingUI();
      updateAgentStatus(message.agent, message.status, message.detail);
      break;

    case "clearPipeline":
      clearAgentPipeline();
      hideVerification();
      hideVerification("testRunPanel");
      hideVerification("coveragePanel");
      if (genTimeBadge) genTimeBadge.style.display = "none";
      if (genTokenBadge) genTokenBadge.style.display = "none";
      break;

    case "dependencyFiles":
      showDependencyFilesList(message.files);
      break;

    case "contextBuilderSlices":
      showContextBuilderSlices(message.slices);
      break;

    case "agentError": {
      // Mark the currently-running agent step as error (red)
      const running = document.querySelector(".agent-step--running");
      if (running) {
        const name = running.getAttribute("data-agent") || "Agent";
        updateAgentStatus(name, "error", message.message);
      }
      hideLoadingUI();
      break;
    }

    case "generationError":
      hideLoadingUI();
      break;

    case "showResult":
      hideLoadingUI();
      clearAgentPipeline();
      renderResult(message.result, resultContainer, copyBtn);
      showGenTime(message.elapsedMs);
      showGenTokens(message.totalTokens);
      showChatUI();
      break;

    case "updateResult": {
      // Chat Fixer correction — update the code panel WITHOUT clearing the agent pipeline
      renderResult(message.result, resultContainer, copyBtn);
      // Flash the result card green to signal the update
      const card = resultContainer.closest
        ? resultContainer.closest("[id]")
        : null;
      const target = document.getElementById("resultCard") || resultContainer;
      target.style.transition = "box-shadow 0.3s ease";
      target.style.boxShadow = "0 0 0 2px #4caf50";
      setTimeout(() => { target.style.boxShadow = ""; }, 1400);
      // Scroll the result into view
      resultContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      break;
    }

    case "verificationRunning":
      showVerificationRunning(message.stageName);
      // Lo que se va a verificar es otra versión: la ejecución anterior ya no
      // habla de ella, ni su cobertura.
      hideVerification("testRunPanel");
      hideVerification("coveragePanel");
      break;

    case "testRunRunning":
      showVerificationRunning(message.stageName, "testRunPanel");
      hideVerification("coveragePanel");
      break;

    case "coverageRunning":
      showVerificationRunning(message.stageName, "coveragePanel");
      break;

    case "showCoverage":
      // Sin reintento propio: los datos salen de la ejecución, y su
      // reintento vuelve a medir.
      showVerification(
        message.coverage,
        () => {},
        "coveragePanel",
        message.reportAvailable
          ? {
              label: "Abrir informe",
              run: () => vscode.postMessage({ command: "openCoverageReport" }),
            }
          : undefined
      );
      break;

    case "showTestRun":
      showVerification(
        message.testRun,
        () => vscode.postMessage({ command: "runTestsAgain" }),
        "testRunPanel"
      );
      break;

    case "showVerification":
      showVerification(message.verification, () =>
        vscode.postMessage({ command: "verifyAgain" })
      );
      break;

    case "showDependencyResult":
      hideLoadingUI();
      renderResult(message.result, resultContainer, copyBtn, true);
      showChatUI();
      break;
    /* ----------------------------------------
      Poblar el menú de modelos LLM disponibles
    ---------------------------------------- */
    case "setEcosystem":
      showEcosystem(message.ecosystem);
      break;

    case "setModels":
      setModels(
        message.models,
        document.getElementById("modelMenuContainer"),
        "modelBtn"
      );
      break;

    /* ----------------------------------------
      Solicitar entradas de clase y método
    ---------------------------------------- */
    case "requestInputs": {
      const pending = stepInput.value.trim();
      const state = getStepperState();

      if (state.step === 0 && pending)
        setStepperState(0, pending, state.methodNameVal);
      if (state.step === 1 && pending)
        setStepperState(1, state.classNameVal, pending);

      const { classNameVal, methodNameVal } = getStepperState();
      const hasClass = (classNameVal || "").trim().length > 0 || isClassOptional();
      const hasMethod = (methodNameVal || "").trim().length > 0;

      // Validar que ambos valores existan antes de continuar (la clase puede
      // quedar vacía si el ecosistema acepta funciones sin clase)
      if (!hasClass || !hasMethod) {
        stepInput.classList.add("error");
        setTimeout(() => stepInput.classList.remove("error"), 900);
        vscode.postMessage({ command: "inputsCancelled" });
        hideLoadingUI();
        return;
      }

      // Si todo está correcto, avanzar al paso 2
      setStepperState(2, classNameVal, methodNameVal);
      applyStepUI(2, {
        currentStep,
        stepperFill,
        stepperBox,
        readyBadge,
        stepLabel,
        stepInput,
      });

      vscode.postMessage({
        command: "inputsProvided",
        className: classNameVal.trim(),
        methodName: methodNameVal.trim(),
      });
      break;
    }
    /* ----------------------------------------
        Reiniciar los campos de entrada y UI
    ---------------------------------------- */
    case "resetInputs":
      clearAgentPipeline();
      hideExistingTest();
      showContextToggle();
      setStepperState(0, "", "");
      applyStepUI(0, {
        currentStep,
        stepperFill,
        stepperBox,
        readyBadge,
        stepLabel,
        stepInput,
      });
      resetUI();
      break;

    /* ----------------------------------------
        Mostrar respuesta dentro del chat
    ---------------------------------------- */
    case "chatResponse":
      hideLoadingUI();
      appendChatMessage("assistant", message.text);
      break;

    /* ----------------------------------------
        Avanzar al paso 2 (generación del test)
    ---------------------------------------- */
    case "goToStep2":
      startGeneration();
      break;

    /* ----------------------------------------
        Ya hay una prueba de esa unidad: preguntar
    ---------------------------------------- */
    case "existingTest":
      showExistingTest(message);
      break;
  }
});
