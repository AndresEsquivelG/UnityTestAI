// scripts/uiManager.js
import { show, hide } from "../domUtils.js";
import { switchToChat } from "../domUtils.js";

// === Referencias centralizadas ===
function getRefs() {
  return {
    resultCard: document.getElementById("resultCard"),
    typingIndicator: document.getElementById("typingIndicator"),
    resultContainer: document.getElementById("resultContainer"),
    stepper: document.getElementById("stepper"),
    jsonContainer: document.getElementById("configLoader"),
    actionsContainer: document.getElementById("actions"),
    chatActionsContainer: document.getElementById("chatActions"),
  };
}

// === Muestra el estado de carga principal (spinner del resultado) ===
export function showLoadingUI(clear = true) {
  const { resultCard, typingIndicator, resultContainer } = getRefs();
  show(resultCard);
  show(typingIndicator, "flex");
  if (clear && resultContainer) resultContainer.innerText = "";
}

// === Oculta el spinner global ===
export function hideLoadingUI() {
  const { typingIndicator } = getRefs();
  hide(typingIndicator);
}

// === Cambia a la vista de chat ===
export function showChatUI() {
  const { stepper, jsonContainer, actionsContainer, chatActionsContainer } =
    getRefs();
  switchToChat(stepper, jsonContainer, actionsContainer, chatActionsContainer);
}

// === Reinicia la vista (reset total) ===
export function resetUI() {
  const { resultCard, typingIndicator, resultContainer } = getRefs();
  hide(typingIndicator);
  hide(resultCard);
  if (resultContainer) resultContainer.innerText = "";
}


// === Pipeline de agentes ===

/**
 * Muestra o actualiza el estado de un agente en el pipeline.
 * status: "running" | "done" | "error"
 */
/**
 * @param {string} agentName
 * @param {"running"|"done"|"error"} status
 * @param {string} [model]   - model name shown while running
 * @param {string} [detail]  - extra info (file path, etc.)
 */
export function updateAgentStatus(agentName, status, detail) {
  const pipeline = document.getElementById("agentPipeline");
  if (!pipeline) return;

  pipeline.style.display = "block";

  let item = pipeline.querySelector(`[data-agent="${agentName}"]`);
  if (!item) {
    item = document.createElement("div");
    item.setAttribute("data-agent", agentName);
    pipeline.appendChild(item);
  }

  item.className = `agent-step agent-step--${status}`;

  // Con textContent y no con innerHTML: el detalle trae texto del modelo y
  // mensajes del compilador, que pueden tener «<» y «>».
  const name = document.createElement("span");
  name.className = "agent-step__name";
  name.textContent = agentName;

  const label = document.createElement("span");
  label.className = "agent-step__label";
  label.textContent = status === "running" || !detail ? status : `${status}: ${detail}`;

  item.replaceChildren(name, label);

  if (status === "running") {
    const dots = document.createElement("span");
    dots.className = "agent-step__dots";
    dots.append(
      document.createElement("span"),
      document.createElement("span"),
      document.createElement("span")
    );
    item.appendChild(dots);
  }
}

/** Limpia el pipeline de agentes */
export function clearAgentPipeline() {
  const pipeline = document.getElementById("agentPipeline");
  if (pipeline) {
    pipeline.innerHTML = "";
    pipeline.style.display = "none";
  }
}

/**
 * Shows resolved dependency file paths as sub-items under the last agent step.
 * No title — just the file list appended directly. Las que detectó el
 * adaptador y el agente no había pedido llevan una marca.
 * @param {{ path: string, found: boolean, detected?: boolean }[]} files
 */
export function showDependencyFilesList(files) {
  const pipeline = document.getElementById("agentPipeline");
  if (!pipeline || !files.length) return;

  // Find the last agent step (Code Analyzer) and append under it
  const steps = pipeline.querySelectorAll(".agent-step");
  const lastStep = steps[steps.length - 1];
  if (!lastStep) return;

  const list = document.createElement("div");
  list.className = "agent-dep-files";

  for (const f of files) {
    const row = document.createElement("div");
    row.className = f.found
      ? "agent-dep-files__item agent-dep-files__item--found"
      : "agent-dep-files__item agent-dep-files__item--missing";
    row.textContent = `${f.found ? "\u2713" : "\u2717"} ${f.path}${f.detected ? " (detectada)" : ""}`;
    list.appendChild(row);
  }

  // Insert right after the last agent step
  lastStep.after(list);
}

/**
 * Shows the sliced dependency file paths under the Context Builder agent step.
 * @param {{ filePath: string }[]} slices
 */
export function showContextBuilderSlices(slices) {
  const pipeline = document.getElementById("agentPipeline");
  if (!pipeline || !slices.length) return;

  const ctxStep = pipeline.querySelector('[data-agent="Context Builder"]');
  if (!ctxStep) return;

  const list = document.createElement("div");
  list.className = "agent-dep-files";

  for (const s of slices) {
    const row = document.createElement("div");
    row.className = "agent-dep-files__item agent-dep-files__item--found";
    row.textContent = `✓ ${s.filePath}`;
    list.appendChild(row);
  }

  ctxStep.after(list);
}

// === Verificación y ejecución del artefacto ===
//
// Las dos etapas usan el mismo bloque, cada una en su contenedor: el núcleo
// compone el resultado de la ejecución con la misma forma que el de la
// verificación.

/**
 * Muestra que la etapa está en curso. Deshabilita el reintento: una segunda
 * corrida a la vez chocaría con la primera por el mismo proyecto.
 * @param {string} stageName
 * @param {string} [panelId]
 */
export function showVerificationRunning(stageName, panelId = "verificationPanel") {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  panel.replaceChildren();
  panel.className = "verification verification--running";
  panel.style.display = "block";

  const header = document.createElement("div");
  header.className = "verification__header";
  header.textContent = `${stageName}: en curso…`;
  panel.appendChild(header);
}

/**
 * Muestra el resultado ya compuesto por el núcleo. Todo el texto entra con
 * textContent: los mensajes del compilador traen «<» y «>» de los genéricos.
 *
 * Mientras la corrección automática trabaja sobre este resultado no se ofrece
 * reintentar, por el mismo motivo que durante la verificación.
 * @param {{ stageName: string, status: string, summary: string,
 *           remediation?: string, note?: string, inProgress?: boolean,
 *           retryable?: boolean,
 *           cases?: { outcome: "passed" | "failed" | "skipped", name: string, detail?: string }[],
 *           diagnostics: { severity: string, location: string, code?: string, message: string }[] }} verification
 * @param {() => void} onRetry
 * @param {string} [panelId]
 */
export function showVerification(verification, onRetry, panelId = "verificationPanel") {
  const panel = document.getElementById(panelId);
  if (!panel || !verification) return;

  panel.replaceChildren();
  panel.className = `verification verification--${verification.status}`;
  panel.style.display = "block";

  const header = document.createElement("div");
  header.className = "verification__header";
  header.textContent = `${verification.stageName}: ${verification.summary}`;
  panel.appendChild(header);

  if (verification.note) {
    const note = document.createElement("div");
    note.className = "verification__note";
    note.textContent = verification.note;
    panel.appendChild(note);
  }

  if (verification.remediation) {
    const remediation = document.createElement("div");
    remediation.className = "verification__remediation";
    remediation.textContent = `→ ${verification.remediation}`;
    panel.appendChild(remediation);
  }

  // Solo la ejecución trae pruebas: cada una con su resultado, las fallidas
  // primero, como las ordenó el núcleo.
  if (verification.cases && verification.cases.length) {
    const marks = { passed: "✓", failed: "✗", skipped: "○" };
    const list = document.createElement("div");
    list.className = "verification__cases";
    for (const c of verification.cases) {
      const row = document.createElement("div");
      row.className = `verification__case verification__case--${c.outcome}`;
      row.textContent = `${marks[c.outcome] ?? "?"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`;
      list.appendChild(row);
    }
    panel.appendChild(list);
  }

  if (verification.diagnostics.length) {
    const list = document.createElement("div");
    list.className = "verification__diagnostics";
    for (const d of verification.diagnostics) {
      const row = document.createElement("div");
      row.className = `verification__diagnostic verification__diagnostic--${d.severity}`;
      row.textContent = `${d.location}  ${d.code ? `${d.code}: ` : ""}${d.message}`;
      list.appendChild(row);
    }
    panel.appendChild(list);
  }

  // Sin reintento cuando la etapa no aplica o el núcleo dice que reintentar
  // no cambiaría nada: no hay nada que volver a correr.
  if (
    verification.status !== "notApplicable" &&
    !verification.inProgress &&
    verification.retryable !== false
  ) {
    const retry = document.createElement("button");
    retry.className = "verification__retry";
    retry.textContent = `Volver a intentar: ${verification.stageName.toLowerCase()}`;
    retry.addEventListener("click", () => {
      retry.disabled = true;
      onRetry();
    });
    panel.appendChild(retry);
  }
}

/**
 * Oculta el resultado de una corrida anterior.
 * @param {string} [panelId]
 */
export function hideVerification(panelId = "verificationPanel") {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.replaceChildren();
  panel.style.display = "none";
}

export function enterGenerationMode() {
  const stepper = document.getElementById("stepper");
  const jsonContainer = document.getElementById("configLoader");
  const actionsContainer = document.getElementById("actions");
  const resultCard = document.getElementById("resultCard");
  const typingIndicator = document.getElementById("typingIndicator");
  const resultContainer = document.getElementById("resultContainer");

  // Ocultar setup
  if (stepper) stepper.style.display = "none";
  if (jsonContainer) jsonContainer.style.display = "none";
  if (actionsContainer) actionsContainer.style.display = "none";

  // Mostrar loader
  if (resultCard) resultCard.style.display = "block";
  if (typingIndicator) typingIndicator.style.display = "flex";
  if (resultContainer) resultContainer.innerText = "";
}
