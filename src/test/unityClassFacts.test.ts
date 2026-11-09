import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { describeUnityUnit } from "../adapters/unity/classFacts";
import {
  findAbstractMembers,
  findConstructors,
  findEnclosingNamespace,
  findMemberTypes,
  findTypeDeclarations,
  maskCommentsAndStrings,
} from "../adapters/unity/csharpSource";
import type { ProjectModel, SymbolCandidate } from "../core/contracts";

/**
 * Ficha de la clase en Unity (OP-18). El caso que la originó es
 * `NodeReader.GetAreaIdFromIndexes`, de SanAndreasUnity: el recortador quitó el
 * espacio de nombres, ningún agente lo vio y la prueba no compiló.
 */

/** La posición de `text`, como la devolvería OP-05. */
function locationOf(code: string, text: string): SymbolCandidate {
  const before = code.slice(0, code.indexOf(text)).split("\n");
  return {
    filePath: "Assets/Scripts/Archivo.cs",
    line: before.length,
    column: before[before.length - 1].length + 1,
    signature: text,
  };
}

function namespaceAt(code: string, text: string): string {
  const { line, column } = locationOf(code, text);
  return findEnclosingNamespace(maskCommentsAndStrings(code), line, column);
}

const NODE_FILE = [
  "using System;",
  "using UGameCore.Utilities;",
  "using UnityEngine;",
  "",
  "namespace SanAndreasUnity.Importing.Paths",
  "{",
  "    public static class NodeReader",
  "    {",
  "        public static int GetAreaIdFromIndexes(Vector2Int areaIndexes)",
  "        {",
  "            return areaIndexes.y * 8 + areaIndexes.x;",
  "        }",
  "    }",
  "}",
].join("\n");

const TARGET = { className: "NodeReader", methodName: "GetAreaIdFromIndexes" };

describe("ficha de la clase en Unity (OP-18)", () => {
  describe("espacio de nombres que envuelve una posición", () => {
    it("lee uno compuesto", () => {
      assert.equal(namespaceAt(NODE_FILE, "GetAreaIdFromIndexes"), "SanAndreasUnity.Importing.Paths");
    });

    it("une los anidados", () => {
      const code = "namespace A\n{\n  namespace B.C\n  {\n    class D { void M() { } }\n  }\n}\n";
      assert.equal(namespaceAt(code, "M()"), "A.B.C");
    });

    it("con dos en el archivo, elige el que envuelve la posición", () => {
      const code = "namespace A\n{\n  class X { void M() { } }\n}\nnamespace B\n{\n  class Y { void N() { } }\n}\n";
      assert.equal(namespaceAt(code, "M()"), "A");
      assert.equal(namespaceAt(code, "N()"), "B");
    });

    it("funciona con todo en una sola línea", () => {
      assert.equal(namespaceAt("namespace A { class B { void M() { } } }", "M()"), "A");
    });

    it("una posición fuera de todo bloque no tiene espacio de nombres", () => {
      const code = "namespace A\n{\n  class X { }\n}\nclass Y { void M() { } }\n";
      assert.equal(namespaceAt(code, "M()"), "");
    });

    it("no se confunde con uno escrito en un comentario", () => {
      const code = "// namespace Viejo {\nclass X { void M() { } }\n// }\n";
      assert.equal(namespaceAt(code, "M()"), "");
    });

    it("no se confunde con uno escrito en una cadena", () => {
      const code = 'class X { string a = "namespace Texto {"; void M() { } string b = "}"; }';
      assert.equal(namespaceAt(code, "M()"), "");
    });

    it("cuenta bien las líneas de un archivo con saltos de Windows", () => {
      assert.equal(
        namespaceAt(NODE_FILE.replace(/\n/g, "\r\n"), "GetAreaIdFromIndexes"),
        "SanAndreasUnity.Importing.Paths"
      );
    });
  });

  describe("texto de la ficha", () => {
    it("da el espacio de nombres y la línea que necesita la prueba", () => {
      const facts = describeUnityUnit(NODE_FILE, TARGET, locationOf(NODE_FILE, "GetAreaIdFromIndexes"));

      assert.match(facts, /`NodeReader` is declared inside `namespace SanAndreasUnity\.Importing\.Paths \{ \}`\./);
      assert.match(facts, /^The test file needs: using SanAndreasUnity\.Importing\.Paths;$/m);
      assert.match(facts, /GetType\("NodeReader"\) finds nothing/);
    });

    it("no copia los demás using del archivo, que pueden volver ambiguo un nombre", () => {
      const facts = describeUnityUnit(NODE_FILE, TARGET, locationOf(NODE_FILE, "GetAreaIdFromIndexes"));
      assert.ok(!facts.includes("UGameCore.Utilities"));
    });

    it("una clase sin espacio de nombres no tiene ficha (MatchThreeGame)", () => {
      const code = [
        "using UnityEngine;",
        "",
        "public static class Utilities",
        "{",
        "    public static bool AreVerticalOrHorizontalNeighbors(Shape s1, Shape s2) { return true; }",
        "}",
      ].join("\n");
      const target = { className: "Utilities", methodName: "AreVerticalOrHorizontalNeighbors" };

      assert.equal(describeUnityUnit(code, target, locationOf(code, target.methodName)), "");
    });

    it("un espacio de nombres escrito en un comentario no genera ficha", () => {
      const code = "// namespace Viejo {\nclass X { void M() { } }\n// }\n";
      const target = { className: "X", methodName: "M" };

      assert.equal(describeUnityUnit(code, target, locationOf(code, "M()")), "");
    });

    it("sin clase no hay nada que decir", () => {
      const target = { className: null, methodName: "GetAreaIdFromIndexes" };
      assert.equal(describeUnityUnit(NODE_FILE, target, locationOf(NODE_FILE, target.methodName)), "");
    });

    it("un método estático sin llamadas no cambia la ficha", () => {
      const facts = describeUnityUnit(NODE_FILE, TARGET, locationOf(NODE_FILE, "GetAreaIdFromIndexes"));
      assert.ok(!facts.includes("These facts are exact"));
    });
  });

  describe("clase abstracta bajo prueba (ItemBase.GetUnityVec3)", () => {
    const ITEM_FILE = [
      "using System.IO;",
      "namespace SanAndreasUnity.Importing.Items",
      "{",
      "    public abstract class ItemBase",
      "    {",
      "        private readonly string[] _parts;",
      "",
      "        protected ItemBase(string line, bool commaSeparated = true)",
      "        {",
      "            _parts = line.Split(',');",
      "        }",
      "",
      "        protected ItemBase(BinaryReader reader)",
      "        {",
      "        }",
      "",
      "        public float GetSingle(int index)",
      "        {",
      "            return float.Parse(_parts[index]);",
      "        }",
      "",
      "        public UnityEngine.Vector3 GetUnityVec3(ref int index, bool invertYAndZ)",
      "        {",
      "            float x = GetSingle(index++);",
      "            return new UnityEngine.Vector3(x, x, x);",
      "        }",
      "    }",
      "}",
    ].join("\n");
    const target = { className: "ItemBase", methodName: "GetUnityVec3" };
    const facts = () => describeUnityUnit(ITEM_FILE, target, locationOf(ITEM_FILE, "GetUnityVec3"));

    it("dice que es abstracta y que no hay nada que sobrescribir", () => {
      assert.match(facts(), /`ItemBase` is abstract: `new ItemBase\(\.\.\.\)` does not compile/);
      assert.match(facts(), /It declares no abstract members: the subclass has nothing to override\./);
    });

    it("da los constructores que la subclase tiene que llamar, con su código", () => {
      assert.match(facts(), /the subclass must call one of them with `: base\(\.\.\.\)`/);
      assert.match(facts(), /protected ItemBase\(string line, bool commaSeparated = true\)/);
      assert.match(facts(), /protected ItemBase\(BinaryReader reader\)/);
      assert.match(facts(), /_parts = line\.Split\(','\);/);
    });

    it("avisa que lo que llama no se puede sobrescribir, que es el CS0506", () => {
      assert.match(
        facts(),
        /public float GetSingle\(int index\) — not virtual: a subclass cannot override it \(CS0506\)/
      );
      assert.match(facts(), /return float\.Parse\(_parts\[index\]\);/);
    });

    it("no lista la llamada a un constructor como un método", () => {
      assert.ok(!facts().includes("Vector3 Vector3"));
    });

    it("no repite la firma encima de su propio código", () => {
      assert.equal(facts().split("public float GetSingle(int index)").length - 1, 1);
    });
  });

  describe("otras formas de crear la clase", () => {
    it("con constructores privados, muestra las fábricas estáticas", () => {
      const code = [
        "namespace A",
        "{",
        "    public class Archivo",
        "    {",
        "        private Archivo(System.IO.Stream s) { }",
        "        static Archivo() { }",
        "        public static Archivo Abrir(string ruta) { return null; }",
        "        public string Nombre(int i) { return null; }",
        "    }",
        "}",
      ].join("\n");
      const facts = describeUnityUnit(code, { className: "Archivo", methodName: "Nombre" }, locationOf(code, "Nombre(int"));

      assert.match(facts, /All constructors of `Archivo` are private/);
      assert.match(facts, /public static Archivo Abrir\(string ruta\)/);
      assert.ok(!facts.includes("static Archivo()"));
    });

    it("una clase sin espacio de nombres también tiene ficha si hay algo que decir", () => {
      const code = "public abstract class X\n{\n    public int M() { return 1; }\n}\n";
      const facts = describeUnityUnit(code, { className: "X", methodName: "M" }, locationOf(code, "M()"));

      assert.match(facts, /`X` is abstract/);
      assert.ok(!facts.includes("namespace"));
    });

    it("muestra el código de un auxiliar privado, y la firma sola de uno público largo", () => {
      const largo = Array.from({ length: 15 }, (_, i) => `        int v${i} = ${i};`).join("\n");
      const code = [
        "public class X",
        "{",
        "    int Ayudante() { return 2; }",
        "    public void Largo()",
        "    {",
        largo,
        "    }",
        "    public int M() { Largo(); otro.Ayudante2(); return Ayudante(); }",
        "}",
      ].join("\n");
      const facts = describeUnityUnit(code, { className: "X", methodName: "M" }, locationOf(code, "M()"));

      assert.match(facts, /int Ayudante\(\) \{ return 2; \}/);
      assert.match(facts, /public void Largo\(\)/);
      assert.ok(!facts.includes("int v14"));
      assert.ok(!facts.includes("Ayudante2"));
    });
  });

  describe("dependencia abstracta (Eye.SetupPupil)", () => {
    const EYE = [
      "using RedRunner.Characters;",
      "namespace RedRunner.Enemies",
      "{",
      "    public class Eye : MonoBehaviour",
      "    {",
      "        [SerializeField]",
      "        protected Character m_LatestCharacter;",
      "        protected virtual void SetupPupil()",
      "        {",
      "            if (m_LatestCharacter != null) { var dead = m_LatestCharacter.IsDead; }",
      "        }",
      "    }",
      "}",
    ].join("\n");
    const CHARACTER = [
      "using Otro;",
      "namespace RedRunner.Characters",
      "{",
      "    [RequireComponent(typeof(Rigidbody2D))]",
      "    [RequireComponent(typeof(Collider2D))]",
      "    public abstract class Character : MonoBehaviour",
      "    {",
      "        public delegate void DeadHandler();",
      "        #pragma warning disable 0067",
      "        public virtual event DeadHandler OnDead;",
      "        #pragma warning restore 0067",
      "        public abstract float MaxRunSpeed { get; }",
      "        public abstract string[] Actions { get; }",
      "        public abstract Skeleton Skeleton { get; }",
      "        public abstract void Die(bool blood);",
      "        public virtual bool IsDead { get; set; }",
      "    }",
      "}",
    ].join("\n");
    const RED = "namespace RedRunner.Characters\n{\n    public class RedCharacter : Character { }\n}\n";
    const SKELETON = "namespace RedRunner\n{\n    public class Skeleton : MonoBehaviour { }\n}\n";

    let root: string;
    const proyecto = (archivos: Record<string, string>): ProjectModel => {
      for (const [relativo, contenido] of Object.entries(archivos)) {
        const destino = path.join(root, relativo);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, contenido, "utf8");
      }
      return {
        rootPath: root,
        ecosystemId: "unity",
        sourceRoots: [{ relativePath: "Assets", kind: "main" }],
        sources: Object.keys(archivos).map((relativePath) => ({
          relativePath,
          name: path.basename(relativePath),
          sourceRoot: "main" as const,
        })),
      } as ProjectModel;
    };
    const TODOS = {
      "Assets/Eye.cs": EYE,
      "Assets/Character.cs": CHARACTER,
      "Assets/RedCharacter.cs": RED,
      "Assets/Skeleton.cs": SKELETON,
    };
    const fichaDe = (archivos: Record<string, string>) =>
      describeUnityUnit(
        EYE,
        { className: "Eye", methodName: "SetupPupil" },
        locationOf(EYE, "SetupPupil"),
        proyecto(archivos)
      );

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "utia-ficha-"));
    });
    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("encuentra la dependencia por el tipo del campo que usa el método", () => {
      assert.match(fichaDe(TODOS), /`Character` \(needs: using RedRunner\.Characters;\) is abstract/);
    });

    it("lista todos sus miembros abstractos, sin los preprocesadores ni lo que no es abstracto", () => {
      const facts = fichaDe(TODOS);
      assert.match(facts, /must override all 4 of its abstract members:/);
      assert.match(facts, /^ {2}public abstract float MaxRunSpeed \{ get; \}$/m);
      assert.match(facts, /^ {2}public abstract string\[\] Actions \{ get; \}$/m);
      assert.match(facts, /^ {2}public abstract void Die\(bool blood\);$/m);
      assert.ok(!facts.includes("#pragma"));
      assert.ok(!facts.includes("IsDead"));
    });

    it("nombra las clases concretas que ya existen", () => {
      assert.match(fichaDe(TODOS), /Concrete subclasses already in the project: RedCharacter \(using RedRunner\.Characters;\)\./);
    });

    it("da el using de un tipo que aparece en esas firmas", () => {
      assert.match(fichaDe(TODOS), /^ {2}using RedRunner; \/\/ Skeleton$/m);
    });

    it("no sugiere el using de un nombre repetido en dos espacios de nombres", () => {
      const facts = fichaDe({
        ...TODOS,
        "Assets/Otro.cs": "namespace Otro\n{\n    public class Skeleton { }\n}\n",
      });
      assert.ok(!facts.includes("using RedRunner; //"));
      assert.ok(!facts.includes("using Otro;"));
    });

    it("no toma por tipo a un nombre de otro espacio que ese archivo no ve", () => {
      const facts = fichaDe({
        ...TODOS,
        "Assets/Actions.cs": "namespace Terreno\n{\n    public class Actions { }\n}\n",
      });
      assert.ok(!facts.includes("using Terreno;"));
    });

    it("no toma una dependencia abstracta de un espacio que la unidad no ve", () => {
      const facts = describeUnityUnit(
        EYE,
        { className: "Eye", methodName: "SetupPupil" },
        locationOf(EYE, "SetupPupil"),
        proyecto({
          "Assets/Eye.cs": EYE,
          "Assets/Character.cs": CHARACTER.replace("RedRunner.Characters", "OtroJuego.Personajes"),
        })
      );
      assert.ok(!facts.includes("is abstract"));
    });

    it("explica RequireComponent, con la advertencia de los tipos abstractos", () => {
      const facts = fichaDe(TODOS);
      assert.match(facts, /`Character` has \[RequireComponent\] for: Rigidbody2D, Collider2D\./);
      assert.match(facts, /first add a concrete subclass of it to the GameObject/);
    });

    it("sin la clase abstracta en el proyecto no inventa nada", () => {
      const facts = fichaDe({ "Assets/Eye.cs": EYE });
      assert.ok(!facts.includes("is abstract"));
    });

    it("no toma en cuenta el código de terceros", () => {
      const facts = fichaDe({
        "Assets/Eye.cs": EYE,
        "Assets/Plugins/Character.cs": CHARACTER,
      });
      assert.ok(!facts.includes("is abstract"));
    });
  });

  describe("lectura de C#", () => {
    it("lee modificadores, bases sin genéricos y una restricción sin confundirla", () => {
      const [tipo] = findTypeDeclarations(
        "public sealed class A<T> : Base.B<T>, IC where T : class\n{\n}\n"
      );
      assert.equal(tipo.name, "A");
      assert.deepEqual(tipo.modifiers, ["public", "sealed"]);
      assert.deepEqual(tipo.bases, ["B", "IC"]);
    });

    it("no toma dos restricciones seguidas por un tipo llamado where", () => {
      const nombres = findTypeDeclarations(
        "class A { void M<T, U>() where T : class where U : struct { } }"
      ).map((tipo) => tipo.name);
      assert.deepEqual(nombres, ["A"]);
    });

    it("lee los atributos de RequireComponent aunque compartan corchetes", () => {
      const [tipo] = findTypeDeclarations(
        "[RequireComponent(typeof(UnityEngine.Rigidbody), typeof(Foo)), DisallowMultipleComponent]\nclass A { }"
      );
      assert.deepEqual(tipo.requiredComponents, ["Rigidbody", "Foo"]);
    });

    it("no confunde una propiedad con un arreglo al buscar miembros abstractos", () => {
      const masked = "abstract class A { public abstract int[] B { get; } public int C() { return 1; } }";
      const [tipo] = findTypeDeclarations(masked);
      assert.deepEqual(findAbstractMembers(masked, tipo.body), ["public abstract int[] B { get; }"]);
    });

    it("no lista una clase abstracta anidada como un miembro", () => {
      const masked = "class A { public abstract class B { } }";
      const [tipo] = findTypeDeclarations(masked);
      assert.deepEqual(findAbstractMembers(masked, tipo.body), []);
    });

    it("con un constructor que encadena con llaves, encuentra su cuerpo", () => {
      const code = "class A\n{\n    public A() : this(new[] { 1 })\n    {\n        var x = 1;\n    }\n    A(int[] v) { }\n}";
      const [tipo] = findTypeDeclarations(code);
      const [primero] = findConstructors(code, code, tipo.body, "A");
      assert.match(code.slice(primero.extent.start, primero.extent.end), /var x = 1;\n {4}\}$/);
    });

    it("un nombre calificado no pasa por un tipo del proyecto con ese nombre", () => {
      const code = [
        "namespace A.B",
        "{",
        "    public abstract class X",
        "    {",
        "        public abstract UnityEngine.Vector3 Pos();",
        "        public int M() { return 1; }",
        "    }",
        "}",
      ].join("\n");
      const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "utia-calificado-"));
      try {
        fs.writeFileSync(path.join(raiz, "V.cs"), "namespace A\n{\n    public class Vector3 { }\n}\n", "utf8");
        const facts = describeUnityUnit(code, { className: "X", methodName: "M" }, locationOf(code, "M()"), {
          rootPath: raiz,
          ecosystemId: "unity",
          sourceRoots: [{ relativePath: "", kind: "main" }],
          sources: [{ relativePath: "V.cs", name: "V.cs", sourceRoot: "main" }],
        } as ProjectModel);
        assert.ok(!facts.includes("using A;"));
      } finally {
        fs.rmSync(raiz, { recursive: true, force: true });
      }
    });

    it("lee el tipo de campos y propiedades, sin entrar en los cuerpos", () => {
      const code = "class A { [X] protected List<int> a = null;\n  public B b { get; set; }\n  void M() {\n    C c = null;\n  }\n}";
      const [tipo] = findTypeDeclarations(code);
      const tipos = findMemberTypes(code, tipo.body);
      assert.equal(tipos.get("b"), "B");
      assert.equal(tipos.has("c"), false);
    });
  });
});
