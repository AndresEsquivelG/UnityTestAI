/**
 * @file modelMenu.js
 * @description
 * Controla el menú de selección de modelos: un submenú por proveedor, con los
 * modelos que se pueden elegir de cada uno.
 */

/**
 * Proveedor seleccionado (`claude`, `chatgpt`, `llamaLocal`).
 * @type {string|null}
 */
let selectedModel = null;

/**
 * Modelo seleccionado dentro del proveedor (`claude-haiku-4-5`, `qwen2.5:14b`…).
 * @type {string|null}
 */
let selectedSubModel = null;

/**
 * Obtiene el proveedor y el modelo seleccionados.
 *
 * @returns {{ selectedModel: string|null, selectedSubModel: string|null }}
 * Objeto con los identificadores del proveedor y del modelo activos.
 */
export function getSelectedModel() {
  return { selectedModel, selectedSubModel };
}

/**
 * Crea y renderiza el menú desplegable de modelos disponibles.
 *
 * La extensión puede mandar el menú más de una vez (al abrir el panel y cuando
 * este avisa que está listo). Si el modelo elegido sigue en la lista, se
 * conserva; si no, se elige el primero.
 *
 * @param {Array<{ id: string, name: string, models: Array<{ id: string, label: string }>, notice?: string }>} providers
 *   Proveedores, cada uno con sus modelos. `notice` dice por qué no tiene ninguno.
 * @param {HTMLElement} container - Contenedor donde se renderizará el menú.
 * @param {string} triggerId - ID asignado al botón principal del menú.
 */
export function setModels(providers, container, triggerId) {
  container.innerHTML = "";

  const dropdown = document.createElement("div");
  dropdown.className = "dropdown";

  const trigger = document.createElement("button");
  trigger.className = "dropbtn";
  trigger.id = triggerId;
  trigger.textContent = "Selecciona modelo";

  const dropdownContent = document.createElement("div");
  dropdownContent.className = "dropdown-content";

  /** @type {{ provider: string, model: string, label: string }[]} */
  const choices = [];

  const choose = (choice) => {
    selectedModel = choice.provider;
    selectedSubModel = choice.model;
    trigger.textContent = choice.label;
  };

  providers.forEach((provider) => {
    const submenu = document.createElement("div");
    submenu.className = "submenu";

    const submenuTitle = document.createElement("a");
    submenuTitle.className = "submenu-title";
    submenuTitle.textContent = provider.name;

    const submenuContent = document.createElement("div");
    submenuContent.className = "submenu-content";

    if (provider.models.length === 0) {
      const notice = document.createElement("span");
      notice.className = "submenu-notice";
      notice.textContent = provider.notice || "No hay modelos para elegir.";
      submenuContent.appendChild(notice);
    }

    provider.models.forEach((model) => {
      const choice = { provider: provider.id, model: model.id, label: model.label };
      choices.push(choice);

      const item = document.createElement("a");
      item.textContent = model.label;
      item.dataset.model = provider.id;
      item.dataset.subModel = model.id;
      item.addEventListener("click", () => choose(choice));
      submenuContent.appendChild(item);
    });

    submenu.appendChild(submenuTitle);
    submenu.appendChild(submenuContent);
    dropdownContent.appendChild(submenu);
  });

  dropdown.appendChild(trigger);
  dropdown.appendChild(dropdownContent);
  container.appendChild(dropdown);

  const kept = choices.find(
    (choice) => choice.provider === selectedModel && choice.model === selectedSubModel
  );
  if (kept || choices.length > 0) {
    choose(kept || choices[0]);
  } else {
    selectedModel = null;
    selectedSubModel = null;
  }
}
