/**
 * Entradas fijas con las que se fotografían los prompts.
 *
 * Son inventadas y no salen del disco: la foto tiene que producir exactamente el
 * mismo texto en cualquier máquina y en cualquier momento. Si dependiera de un
 * proyecto real, cambiaría al cambiar el proyecto y dejaría de servir para
 * comparar.
 *
 * No son realistas por capricho. Cada valor ocupa el hueco de un marcador de las
 * plantillas, así que si alguno quedara vacío, la foto no probaría que ese hueco
 * se rellena. Se mantienen cortos para que la diferencia entre dos fotos se lea
 * de un vistazo.
 *
 * **Cambiar cualquier valor de este archivo invalida las doce fotos.** Es una
 * decisión deliberada, no un efecto colateral: hay que regenerarlas y revisar la
 * diferencia entera.
 */

export const CLASS_NAME = "Player";
export const METHOD_NAME = "Move";

/** Archivo fuente completo, tal como llega del editor (entrada del cortador). */
export const SOURCE_CODE = `using UnityEngine;

namespace Game.Actors
{
    public class Player : MonoBehaviour
    {
        private float speed;
        private Inventory inventory;

        void Awake()
        {
            speed = 5f;
        }

        public bool Move(float distance, bool sprint)
        {
            if (distance <= 0f)
            {
                return false;
            }

            float applied = sprint ? distance * 2f : distance;
            transform.Translate(Vector3.forward * applied * speed);
            return inventory.HasStamina(applied);
        }
    }
}`;

/** Recorte del método, tal como lo devuelve el cortador. */
export const CODE_SLICE = `public class Player : MonoBehaviour
{
    private float speed;
    private Inventory inventory;

    public bool Move(float distance, bool sprint)
    {
        if (distance <= 0f)
        {
            return false;
        }

        float applied = sprint ? distance * 2f : distance;
        transform.Translate(Vector3.forward * applied * speed);
        return inventory.HasStamina(applied);
    }
}`;

/** Árbol del proyecto, tal como lo dibuja el núcleo. */
export const PROJECT_TREE = `- Assets
  - Scripts
    - Actors
      - Player.cs
    - Items
      - Inventory.cs`;

/** Dependencias leídas, tal como las concatena el núcleo. */
export const DEPENDENCY_FILES = `

// File: Assets/Scripts/Items/Inventory.cs
public class Inventory
{
    private float stamina;

    public bool HasStamina(float cost)
    {
        return stamina >= cost;
    }
}`;

/** Contexto ya ensamblado y validado, entrada de los agentes finales. */
export const ASSEMBLED_CONTEXT = `// ── TARGET: Player.Move ──────────────────────────────────────
public class Player : MonoBehaviour
{
    private float speed;
    private Inventory inventory;

    public bool Move(float distance, bool sprint)
    {
        if (distance <= 0f)
        {
            return false;
        }

        float applied = sprint ? distance * 2f : distance;
        transform.Translate(Vector3.forward * applied * speed);
        return inventory.HasStamina(applied);
    }
}

// ── DEPENDENCY: Assets/Scripts/Items/Inventory.cs ──────────────────────────────────────
public class Inventory
{
    private float stamina;

    public bool HasStamina(float cost)
    {
        return stamina >= cost;
    }
}`;

/**
 * Análisis precalculado, con la forma exacta que produce `formatCodeAnalysis`
 * en el núcleo. Es el bloque opcional del generador.
 */
export const CODE_ANALYSIS = `Method: Move(float distance, bool sprint) → bool

Decision Table:
  [TRUE] distance <= 0f → devuelve false sin desplazar
  [FALSE] distance > 0f && sprint → aplica el doble de la distancia

Dependencies:
  Inventory inventory: [HasStamina]

Private Members (require Reflection):
  [field] float speed
  [field] Inventory inventory

Fields initialized in Start/Awake (must init via Reflection in SetUp):
  float speed [Awake]`;

/** Prueba generada, entrada del validador y del corrector por chat. */
export const TEST_CODE = `using NUnit.Framework;
using UnityEngine;

public class UTIA_claude_Player_Move
{
    [Test]
    public void Move_ConDistanciaNoPositiva_DevuelveFalse()
    {
        var go = new GameObject();
        go.SetActive(false);
        var player = go.AddComponent<Player>();

        Assert.IsFalse(player.Move(0f, false));
    }
}`;

/** Mensaje de la persona usuaria, entrada del corrector por chat. */
export const USER_MESSAGE =
  "La prueba falla con NullReferenceException en inventory. Corregila.";
