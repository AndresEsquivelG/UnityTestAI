/**
 * Análisis fijo con el que se fotografía su presentación.
 *
 * Lleva **todos** los apartados poblados a propósito, incluidos los opcionales:
 * la foto solo prueba lo que el análisis trae, y un apartado vacío no se
 * imprime. Con campos a medias, mover un bloque de sitio pasaría inadvertido.
 *
 * Los campos propios de Unity —los que OP-09 saca del núcleo— viajan aparte,
 * para poder armar tanto el análisis neutro como el completo.
 */

/** Apartados que el núcleo sabe presentar sin nombrar ninguna tecnología. */
export const NEUTRAL_ANALYSIS = {
  status: "READY" as const,
  methodSummary: {
    name: "Move",
    inputs: [
      { name: "distance", type: "float" },
      { name: "sprint", type: "bool" },
    ],
    output: "bool",
  },
  dependencies: [
    { name: "inventory", type: "class", membersUsed: ["HasStamina"] },
  ],
  decisionTable: [
    { conditions: ["distance <= 0f"], branch: "true" as const, expectedBehavior: "devuelve false" },
    { conditions: ["distance <= 0f"], branch: "false" as const, expectedBehavior: "se desplaza" },
  ],
  loops: [{ type: "foreach", condition: "waypoints" }],
  sideEffects: ["escribe speed", "llama a transform.Translate"],
  privateMembers: [
    { name: "speed", kind: "field", type: "float" },
    { name: "State", kind: "nestedType", type: "enum", nestedValues: ["Wait", "Init"] },
    { name: "FixedUpdate", kind: "unityMessage", type: "void" },
  ],
};

/** Apartados que el adaptador aporta y presenta (OP-09). */
export const ECOSYSTEM_ANALYSIS = {
  startAwakeFields: [
    { name: "speed", type: "float", initIn: "Awake" as const, notes: "usar 5" },
    { name: "waypoints", type: "Queue<Vector3>", initIn: "Start" as const },
  ],
  requiredUsings: ["Game.Actors", "Game.Items"],
  untestableBranches: [
    { condition: "Input.GetKeyDown(jumpKey)", reason: "Input always false in PlayMode" },
  ],
  preFlightChecklist: {
    typeInstantiations: [
      {
        typeName: "Player",
        pattern: "AddComponent",
        constructorSignature: null,
        parameterless: true,
        constructorNotes: "",
        reason: "extends MonoBehaviour",
      },
      {
        typeName: "Inventory",
        pattern: "new",
        constructorSignature: "Inventory(GameSettings gs)",
        parameterless: false,
        constructorNotes: "GameSettings admite valores por omisión",
        reason: "plain C# class",
      },
      {
        typeName: "Waypoint",
        pattern: "new",
        constructorSignature: "Waypoint()",
        parameterless: true,
        constructorNotes: "",
        reason: "plain C# class",
      },
    ],
    computedProperties: [
      {
        propertyName: "Current",
        getterSummary: "devuelve el último de _list",
        controlVia: "_list — agregar un elemento",
      },
    ],
  },
};

/** El análisis completo, tal como lo devuelve hoy el analizador. */
export const FULL_ANALYSIS = { ...NEUTRAL_ANALYSIS, ...ECOSYSTEM_ANALYSIS };
