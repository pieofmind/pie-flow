import { describe, it, expect } from "vitest";
import { nodeHtml } from "../../src/canvas/htmlNode";

describe("ERD HTML render — cluster color + N rows (Story 2.1)", () => {
  it("renders header with cluster color from extra.headerColor", () => {
    const html = nodeHtml(
      "erd-entity",
      "product_template",
      undefined,
      {
        cols: [
          { k: "PK", name: "id", type: "int" },
          { k: "FK", name: "customer_id", type: "int" },
        ],
        headerColor: "#5E8FB9",
      }
    );
    expect(html).toContain('style="background:#5E8FB9"');
    expect(html).toContain("product_template");
  });

  it("renders N rows from cols array", () => {
    const cols = ["id", "a", "b", "c", "d", "e", "f"].map((name, i) => ({
      k: (i === 0 ? "PK" : "") as "" | "PK" | "FK",
      name,
      type: "int",
    }));
    const html = nodeHtml("erd-entity", "t", undefined, { cols });
    const matches = html.match(/erd-col/g) || [];
    expect(matches.length).toBe(7);
  });

  it("each row has data-col-name attribute (for Story 2.2 port factory)", () => {
    const html = nodeHtml("erd-entity", "t", undefined, {
      cols: [
        { k: "PK", name: "id", type: "int" },
        { k: "FK", name: "ref_id", type: "int" },
      ],
    });
    expect(html).toContain('data-col-name="id"');
    expect(html).toContain('data-col-name="ref_id"');
  });

  it("PK/FK badges have whitelisted class names (no injection)", () => {
    const html = nodeHtml("erd-entity", "t", undefined, {
      cols: [
        { k: "PK", name: "id", type: "int" },
        { k: "FK" as const, name: "x", type: "int" },
        { k: "" as const, name: "y", type: "int" },
      ],
    });
    expect(html).toContain('class="kk pk"');
    expect(html).toContain('class="kk fk"');
    expect(html).toContain('class="kk "'); // empty k
  });

  it("no headerColor → no inline style on header (uses CSS default)", () => {
    const html = nodeHtml("erd-entity", "t", undefined, {
      cols: [{ k: "PK", name: "id", type: "int" }],
    });
    expect(html).not.toContain('style="background:');
  });

  it("renders default cols when extra missing (legacy fallback)", () => {
    const html = nodeHtml("erd-entity", "t");
    expect(html).toContain("erd-col");
    expect(html).toContain("id");
  });

  it("escapes column name (XSS guard)", () => {
    const html = nodeHtml("erd-entity", "t", undefined, {
      cols: [{ k: "", name: '<script>alert(1)</script>', type: "int" }],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
