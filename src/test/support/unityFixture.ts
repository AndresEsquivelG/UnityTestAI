import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Proyecto Unity de mentira, creado en una carpeta temporal.
 *
 * Se construye en tiempo de ejecución en lugar de versionar archivos `.cs` de
 * prueba: así cada corrida parte de un estado conocido y las pruebas pueden
 * crear y borrar archivos sin ensuciar el repositorio.
 *
 * El contenido no es decorativo. Cada pieza existe para ejercitar un caso
 * concreto del adaptador:
 *
 *   · `Move` declarado dos veces        → sobrecargas
 *   · una función local llamada `Move`  → no es un miembro de la clase
 *   · un comentario y una cadena con la forma de una declaración
 *   · `Enemy` invoca `Move` sin declararlo
 *   · `Assets/Plugins/obj` y `Library`  → carpetas que hay que excluir
 */
export interface UnityFixture {
  /** Raíz del proyecto Unity, la carpeta que contiene `Assets`. */
  readonly projectRoot: string;
  /** Carpeta `Assets`, tal como se abriría en el editor. */
  readonly assetsDir: string;
  /** Carpeta de pruebas del proyecto de mentira. */
  readonly testsDir: string;
  dispose(): Promise<void>;
}

const PLAYER = `using UnityEngine;

namespace Game.Actors
{
    public class Player : MonoBehaviour
    {
        private float speed;

        // Este comentario declara public void Move(int fake) { } y no debe contar.
        private readonly string hint = "public void Move(string fake) { ";

        public void Move(float distance)
        {
            speed = distance;
            Move(distance, false);
        }

        public void Move(float distance, bool sprint)
        {
            void Move(int local)
            {
                speed = local;
            }

            Move(1);
            speed = sprint ? distance * 2f : distance;
        }

        private bool IsFast() => speed > 10f;

        void Update()
        {
            Move(1f);
        }
    }
}
`;

const ENEMY = `using UnityEngine;

public class Enemy : MonoBehaviour
{
    private Player target;

    public void Chase()
    {
        target.Move(2f);
    }
}
`;

export async function createUnityFixture(): Promise<UnityFixture> {
  const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "unitytestia-"));
  const assetsDir = path.join(projectRoot, "Assets");
  const testsDir = path.join(assetsDir, "Tests");

  await write(path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 6000.0.23f1\nm_EditorVersionWithRevision: 6000.0.23f1 (1234567890ab)\n");
  await write(path.join(assetsDir, "Scripts", "Player.cs"), PLAYER);
  await write(path.join(assetsDir, "Scripts", "Enemy.cs"), ENEMY);
  await write(path.join(assetsDir, "Plugins", "obj", "Generated.cs"), "public class Generated { }\n");
  await write(path.join(projectRoot, "Library", "ScriptAssemblies", "Ghost.cs"), "public class Ghost { }\n");
  await fsp.mkdir(testsDir, { recursive: true });

  return {
    projectRoot,
    assetsDir,
    testsDir,
    dispose: () => fsp.rm(projectRoot, { recursive: true, force: true }),
  };
}

async function write(target: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, "utf8");
}
