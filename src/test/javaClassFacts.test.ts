import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeJavaUnit } from "../adapters/java/analysis/classFacts";

/**
 * Ficha de la clase (OP-18): lo que se dice de la clase sin preguntarle a un
 * modelo. Cada caso es uno de los que rompieron, o romperían, la generación
 * cuando el contexto llega recortado.
 */

function factsOf(lines: string[], className: string, methodName: string): string {
  return describeJavaUnit(lines.join("\n"), { className, methodName });
}

/** Lo que la ficha dice sobre cómo crear la instancia, en una sola línea. */
function creationLine(facts: string): string {
  const lines = facts.split("\n");
  return lines[lines.indexOf("How to create an instance:") + 1].trim();
}

/** El bloque de llamadas, desde su encabezado hasta el final. */
function callsSection(facts: string, className: string): string {
  return facts.slice(facts.indexOf(`Methods of ${className} that`));
}

const ABSTRACT_DOCUMENT = [
  "package com.iluwatar.abstractdocument;",
  "",
  "import java.util.Map;",
  "",
  "/** Abstract implementation of Document interface. */",
  "public abstract class AbstractDocument implements Document {",
  "",
  "  private final Map<String, Object> documentProperties;",
  "",
  "  protected AbstractDocument(Map<String, Object> properties) {",
  '    Objects.requireNonNull(properties, "properties map is required");',
  "    this.documentProperties = properties;",
  "  }",
  "",
  "  @Override",
  "  public Void put(String key, Object value) {",
  "    documentProperties.put(key, value);",
  "    return null;",
  "  }",
  "",
  "  @Override",
  "  public Object get(String key) {",
  "    return documentProperties.get(key);",
  "  }",
  "",
  "  @Override",
  "  public <T> Stream<T> children(String key, Function<Map<String, Object>, T> childConstructor) {",
  "    return Stream.ofNullable(get(key))",
  "        .filter(Objects::nonNull)",
  "        .map(childConstructor);",
  "  }",
  "",
  "  private String buildStringRepresentation() {",
  '    return "x";',
  "  }",
  "}",
];

describe("ficha de la clase de Java", () => {
  describe("cómo se crea la instancia", () => {
    it("una abstracta sin métodos abstractos va con el cuerpo vacío, no con new a secas", () => {
      const facts = factsOf(ABSTRACT_DOCUMENT, "AbstractDocument", "put");

      assert.match(facts, /^━━ CLASS FACTS/);
      assert.match(facts, /follow these facts/);
      assert.match(facts, /Kind: abstract class/);
      assert.match(facts, /Abstract methods declared in AbstractDocument: none\./);
      assert.match(facts, /Constructors:\n {2}protected AbstractDocument\(Map<String, Object> properties\)/);
      assert.match(creationLine(facts), /^new AbstractDocument\(.*\) \{ \} — an anonymous subclass with an EMPTY body/);
      assert.match(facts, /do not add @Override methods/);
    });

    it("lista todos los métodos que la clase declara, para que no se invente ninguno", () => {
      const facts = factsOf(ABSTRACT_DOCUMENT, "AbstractDocument", "put");
      const listed = facts
        .slice(facts.indexOf("Methods declared in AbstractDocument"))
        .split("\n\n")[0]
        .split("\n")
        .slice(1)
        .map((line) => line.trim());

      assert.deepEqual(listed, [
        "public Void put(String key, Object value)",
        "public Object get(String key)",
        "public <T> Stream<T> children(String key, Function<Map<String, Object>, T> childConstructor)",
        "private String buildStringRepresentation()",
      ]);
      assert.ok(!facts.includes("documentProperties()"), "inventó un método");
    });

    it("una abstracta con métodos abstractos los nombra con su firma exacta", () => {
      const facts = factsOf(
        [
          "public abstract class Report {",
          "    public String render() {",
          '        return body().isEmpty() ? "vacío" : body();',
          "    }",
          "    protected abstract String body();",
          "    abstract int pages(int from);",
          "}",
        ],
        "Report",
        "render"
      );

      assert.match(facts, /Abstract methods declared in Report:\n {2}protected abstract String body\(\)\n {2}abstract int pages\(int from\)/);
      assert.match(creationLine(facts), /^new Report\(\) \{ \.\.\. \} — an anonymous subclass that implements exactly the abstract methods/);
      assert.match(facts, /Constructors: none declared — Java provides an implicit no-argument constructor\./);
      assert.match(
        callsSection(facts, "Report"),
        /protected abstract String body\(\) — abstract: the anonymous subclass decides what it returns/
      );
    });

    it("una concreta se crea con new, y sin constructores con el implícito", () => {
      const conConstructor = factsOf(
        ["public class Pedido {", "    public Pedido(int id) { }", "    void cerrar() { }", "}"],
        "Pedido",
        "cerrar"
      );
      const sinConstructor = factsOf(["class Caja {", "    int abrir() { return 1; }", "}"], "Caja", "abrir");

      assert.equal(creationLine(conConstructor), "new Pedido(<arguments for one of the constructors above>).");
      assert.equal(creationLine(sinConstructor), "new Caja().");
      assert.match(conConstructor, /Kind: class/);
    });

    it("con todos los constructores privados, manda a la fábrica estática", () => {
      const facts = factsOf(
        [
          "public final class Money {",
          "    private Money(int cents) { }",
          "    public static Money of(int cents) { return new Money(cents); }",
          "    public int cents() { return 0; }",
          "}",
        ],
        "Money",
        "cents"
      );

      assert.match(facts, /Kind: final class/);
      assert.match(creationLine(facts), /^All constructors of Money are private: do not use `new`\. Use one of its static factory methods: public static Money of\(int cents\)\./);
    });

    it("un método estático no necesita instancia", () => {
      const facts = factsOf(
        ["public class Calc {", "    public static int doble(int x) { return x * 2; }", "}"],
        "Calc",
        "doble"
      );
      assert.equal(creationLine(facts), "`doble` is static: call it as `Calc.doble(...)` — no instance is needed.");
    });

    it("una enumeración usa sus constantes y un registro sus componentes", () => {
      const enumFacts = factsOf(
        [
          "public enum Estado {",
          '    ABIERTO("a") { @Override String etiqueta() { return "A"; } },',
          '    CERRADO("c");',
          "    private final String codigo;",
          "    Estado(String codigo) { this.codigo = codigo; }",
          "    String etiqueta() { return codigo; }",
          "}",
        ],
        "Estado",
        "etiqueta"
      );
      const recordFacts = factsOf(
        ["public record Item(String nombre, double precio) {", "    double conIva() { return precio * 1.13; }", "}"],
        "Item",
        "conIva"
      );

      assert.equal(creationLine(enumFacts), "Estado is an enum: use one of its constants (ABIERTO, CERRADO). Never write `new Estado(...)`.");
      assert.equal(creationLine(recordFacts), "new Item(...) with one argument per component, in this order: (String nombre, double precio).");
    });

    it("una interfaz se implementa con una clase anónima o una lambda", () => {
      const facts = factsOf(
        [
          "public interface Repo {",
          "    Order find(int id);",
          "    void save(Order order);",
          "    default Order findOrNull(int id) { return id < 0 ? null : find(id); }",
          "    static Repo empty() { return null; }",
          "}",
        ],
        "Repo",
        "findOrNull"
      );

      assert.match(facts, /Abstract methods declared in Repo:\n {2}Order find\(int id\)\n {2}void save\(Order order\)\n/);
      assert.match(creationLine(facts), /^Repo is an interface: use an anonymous class `new Repo\(\) \{ \.\.\. \}` that implements exactly/);
    });

    it("avisa cuando el método bajo prueba es privado", () => {
      const facts = factsOf(["class A {", "    private int clamp(int v) { return v; }", "}"], "A", "clamp");
      assert.match(facts, /It is private: call it through reflection/);
    });
  });

  describe("métodos que llama la unidad", () => {
    it("trae el código de un privado, y de los privados que ese privado llama", () => {
      const facts = factsOf(
        [
          "public class Caja {",
          "    private int sum;",
          "    public int total() {",
          "        return applyDiscount(sum);",
          "    }",
          "    private int applyDiscount(int x) {",
          "        return x > 100 ? round(x - 10) : x;",
          "    }",
          "    private int round(int x) { return x; }",
          "    private int nadieLoLlama() { return 0; }",
          "}",
        ],
        "Caja",
        "total"
      );
      const calls = callsSection(facts, "Caja");

      assert.match(calls, /private int applyDiscount\(int x\) — private, so it is part of the unit under test\. Reach it through `total`/);
      assert.match(calls, /return x > 100 \? round\(x - 10\) : x;/);
      assert.match(calls, /private int round\(int x\) — private/);
      assert.ok(!calls.includes("nadieLoLlama"), calls);
    });

    it("de un no privado trae el código si es corto", () => {
      const facts = factsOf(ABSTRACT_DOCUMENT, "AbstractDocument", "children");
      const calls = callsSection(facts, "AbstractDocument");

      assert.match(calls, /public Object get\(String key\) — its code:\n {6}public Object get\(String key\) \{\n {8}return documentProperties\.get\(key\);\n {6}\}/);
    });

    it("cuenta this.x(), Clase.x() y this::x, pero no las llamadas sobre otros objetos ni los new", () => {
      const facts = factsOf(
        [
          "public class Servicio {",
          "    public void run(List<String> items) {",
          "        this.uno();",
          "        Servicio.dos();",
          "        items.forEach(this::tres);",
          "        items.add(cuatro());",
          "        new Servicio();",
          "        Runnable r = new Runnable() { public void run() { } };",
          "    }",
          "    void uno() { }",
          "    static void dos() { }",
          "    void tres(String s) { }",
          "    String cuatro() { return \"\"; }",
          "    void add(String s) { }",
          "}",
        ],
        "Servicio",
        "run"
      );
      const calls = callsSection(facts, "Servicio");

      for (const called of ["void uno()", "static void dos()", "void tres(String s)", "String cuatro()"]) {
        assert.ok(calls.includes(called), `no cuenta ${called}`);
      }
      assert.ok(!calls.includes("void add(String s)"), "contó items.add como llamada propia");
      assert.ok(!calls.includes("not declared"), calls);
    });

    it("incluye las otras sobrecargas del mismo nombre", () => {
      const facts = factsOf(
        [
          "public class Carrito {",
          "    public void agregar(Item item) {",
          "        agregar(item, 1);",
          "    }",
          "    public void agregar(Item item, int cantidad) {",
          "        items.add(item);",
          "    }",
          "}",
        ],
        "Carrito",
        "agregar"
      );

      assert.match(facts, /The method under test: public void agregar\(Item item\)\n/);
      assert.match(callsSection(facts, "Carrito"), /public void agregar\(Item item, int cantidad\) — its code:/);
    });

    it("nombra lo que llama sin que la clase lo declare: heredado o importado", () => {
      const facts = factsOf(
        [
          "public class OrderRepo extends BaseRepo {",
          "    public void save(Order o) {",
          "        if (o == null) { throw new IllegalArgumentException(); }",
          "        validate(o);",
          "    }",
          "}",
        ],
        "OrderRepo",
        "save"
      );

      assert.match(facts, /Methods of OrderRepo that `save` calls: none\./);
      assert.match(facts, /not declared in OrderRepo \(inherited from a supertype or statically imported\): validate\(\.\.\.\)\./);
    });
  });

  describe("lectura", () => {
    it("no se confunde con comentarios, cadenas, inicializadores con llaves ni anotaciones con argumentos", () => {
      const facts = factsOf(
        [
          "public class Raro {",
          '    // public Raro(String falso) { }',
          '    private final String pista = "void falso() { ";',
          "    private final int[] numeros = { 1, 2 };",
          "    private final Runnable r = () -> { hacer(); };",
          "    private final Object o = new Object() { public String toString() { return \"\"; } };",
          '    @SuppressWarnings("unchecked")',
          "    public Raro(int a) { }",
          "    static { System.out.println(); }",
          "    public void hacer() { }",
          "    class Interna { void interno() { } }",
          "}",
        ],
        "Raro",
        "hacer"
      );

      assert.match(facts, /Constructors:\n {2}public Raro\(int a\)\n/);
      const listed = facts.slice(facts.indexOf("Methods declared in Raro")).split("\n\n")[0];
      assert.equal(listed.split("\n").length, 2, listed);
      assert.match(listed, /public void hacer\(\)/);
    });

    it("sin la clase, sin el método o sin nombre de clase, no dice nada", () => {
      assert.equal(factsOf(ABSTRACT_DOCUMENT, "Otra", "put"), "");
      assert.equal(factsOf(ABSTRACT_DOCUMENT, "AbstractDocument", "noExiste"), "");
      assert.equal(describeJavaUnit(ABSTRACT_DOCUMENT.join("\n"), { className: null, methodName: "put" }), "");
    });
  });
});
