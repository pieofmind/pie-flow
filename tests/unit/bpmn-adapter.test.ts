import { describe, it, expect } from "vitest";
import { bpmnAdapter } from "../../src/adapters/bpmn/index";
import {
  getBpmnTitle,
  setBpmnTitle,
  validateBpmnSource,
} from "../../src/adapters/bpmn/sourceOps";

const SAMPLE = bpmnAdapter.emptyTemplate();
const SAMPLE_NAMED = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P1" name="Quy trình A" isExecutable="false">
    <bpmn:startEvent id="S1"/>
  </bpmn:process>
</bpmn:definitions>`;

describe("bpmn adapter — contract metadata", () => {
  it("declares id, displayName, codeBlockLanguage, icon", () => {
    expect(bpmnAdapter.id).toBe("bpmn");
    expect(bpmnAdapter.displayName).toBe("BPMN 2.0");
    expect(bpmnAdapter.codeBlockLanguage).toBe("bpmn");
    expect(bpmnAdapter.icon).toBeTruthy();
  });

  it("exposes export formats", () => {
    expect(bpmnAdapter.exportFormats).toContain("svg");
    expect(bpmnAdapter.exportFormats).toContain("png");
    expect(bpmnAdapter.exportFormats).toContain("pdf");
  });

  it("validate() on parsed model is permissive (no false positives)", () => {
    const result = bpmnAdapter.validate(SAMPLE);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("bpmn adapter — parse/serialize identity (sync contract)", () => {
  it("parse is identity on raw XML", () => {
    expect(bpmnAdapter.parse(SAMPLE)).toBe(SAMPLE);
  });

  it("serialize is identity on string model", () => {
    expect(bpmnAdapter.serialize(SAMPLE)).toBe(SAMPLE);
  });

  it("round-trip lossless: serialize(parse(s)) === s", () => {
    const inputs = [SAMPLE, SAMPLE_NAMED, "", "<bpmn:definitions/>"];
    for (const s of inputs) {
      expect(bpmnAdapter.serialize(bpmnAdapter.parse(s))).toBe(s);
    }
  });
});

describe("bpmn adapter — validateSource", () => {
  it("returns [] for a well-formed BPMN document", () => {
    const issues = bpmnAdapter.validateSource!(SAMPLE);
    expect(issues).toEqual([]);
  });

  it("flags empty input", () => {
    expect(bpmnAdapter.validateSource!("")).toEqual([
      { severity: "error", message: "Source rỗng" },
    ]);
    expect(bpmnAdapter.validateSource!("   \n  ")).toEqual([
      { severity: "error", message: "Source rỗng" },
    ]);
  });

  it("flags missing bpmn:definitions root", () => {
    const issues = bpmnAdapter.validateSource!("<root><inner/></root>");
    expect(issues.some((i) => i.message.includes("bpmn:definitions"))).toBe(true);
  });

  it("never throws on garbage input", () => {
    expect(() => bpmnAdapter.validateSource!("<<<>><<")).not.toThrow();
    expect(() => bpmnAdapter.validateSource!("not xml at all")).not.toThrow();
  });

  it("flags malformed XML (parseerror or missing root)", () => {
    // Both DOMParser (when available) and the definitions regex check should catch this.
    const issues = bpmnAdapter.validateSource!("<unclosed");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("flags large source without blocking", () => {
    const huge = "<x>".repeat(1_500_000); // ~4.5 MB — exceeds 4 MB guard
    const issues = bpmnAdapter.validateSource!(huge);
    expect(issues.length).toBe(1);
    expect(issues[0].message).toMatch(/quá lớn/);
  });
});

describe("bpmn adapter — getTitle / setTitle", () => {
  it("getTitle returns undefined when process has no name", () => {
    expect(bpmnAdapter.getTitle!(SAMPLE)).toBeUndefined();
  });

  it("getTitle extracts name from bpmn:process", () => {
    expect(bpmnAdapter.getTitle!(SAMPLE_NAMED)).toBe("Quy trình A");
  });

  it("setTitle inserts name attr when absent", () => {
    const next = bpmnAdapter.setTitle!(SAMPLE, "New Title");
    expect(bpmnAdapter.getTitle!(next)).toBe("New Title");
    expect(next).not.toBe(SAMPLE); // immutable
  });

  it("setTitle replaces existing name", () => {
    const next = bpmnAdapter.setTitle!(SAMPLE_NAMED, "Quy trình B");
    expect(bpmnAdapter.getTitle!(next)).toBe("Quy trình B");
  });

  it("setTitle round-trips XML-escaped characters", () => {
    const title = `A & "B" <C>`;
    const next = bpmnAdapter.setTitle!(SAMPLE, title);
    expect(bpmnAdapter.getTitle!(next)).toBe(title);
  });

  it("setTitle with empty string removes name attr", () => {
    const next = bpmnAdapter.setTitle!(SAMPLE_NAMED, "");
    expect(bpmnAdapter.getTitle!(next)).toBeUndefined();
  });

  it("setTitle is no-op when no process tag present", () => {
    const src = "<bpmn:definitions/>";
    expect(bpmnAdapter.setTitle!(src, "X")).toBe(src);
  });
});

describe("bpmn adapter — paletteItems", () => {
  it("declares at least 8 palette items", () => {
    expect(bpmnAdapter.paletteItems).toBeDefined();
    expect(bpmnAdapter.paletteItems!.length).toBeGreaterThanOrEqual(8);
  });

  it("each item has id, label, icon", () => {
    for (const item of bpmnAdapter.paletteItems!) {
      expect(item.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = bpmnAdapter.paletteItems!.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers PHẦN TỬ, SUBPROCESS, FLOW, DATA groups", () => {
    const groups = new Set(bpmnAdapter.paletteItems!.map((i) => i.group));
    expect(groups.has("PHẦN TỬ")).toBe(true);
    expect(groups.has("SUBPROCESS")).toBe(true);
    expect(groups.has("FLOW")).toBe(true);
    expect(groups.has("DATA")).toBe(true);
  });
});

describe("sourceOps — direct unit tests", () => {
  it("validateBpmnSource is import-equivalent", () => {
    expect(validateBpmnSource(SAMPLE)).toEqual([]);
  });

  it("getBpmnTitle handles multi-line process tag", () => {
    const src = `<bpmn:process
      id="P"
      name="MultilineTitle"
      isExecutable="false">
    </bpmn:process>`;
    expect(getBpmnTitle(src)).toBe("MultilineTitle");
  });

  it("setBpmnTitle preserves surrounding XML", () => {
    const before = `<a><bpmn:process id="P"/></a>`;
    const after = setBpmnTitle(before, "X");
    expect(after.startsWith("<a>")).toBe(true);
    expect(after.endsWith("</a>")).toBe(true);
    expect(after).toContain('name="X"');
  });
});
