import { describe, it, expect } from "vitest";
import {
  serializeBoard,
  deserializeBoard,
  deserializeBpmnXml,
  deserializeSourceMeta,
  isPieFlowMarkdown,
  isBoardPath,
  boardTags,
} from "../../src/view/boardSerde";
import type { CanvasModel } from "../../src/canvas/types";

const model: CanvasModel = {
  nodes: [{ id: "n1", type: "rect", x: 0, y: 0, w: 10, h: 10, label: "A" }],
  edges: [],
} as CanvasModel;

/** A board as written before the Omniboard → Pie Flow rename. */
const legacyBoard = [
  "---",
  "omniboard-plugin: parsed",
  "tags: [omniboard, bpmn, kalix]",
  "aliases: x",
  "---",
  "",
  "# Omniboard",
  "%%",
  "## Drawing",
  "```omniboard-data",
  JSON.stringify(model),
  "```",
  "",
  "## BPMN XML",
  "```omniboard-bpmn-xml",
  "<bpmn:definitions/>",
  "```",
  "",
  "## Source Meta",
  "```omniboard-source-meta",
  JSON.stringify({ k: 1 }),
  "```",
  "%%",
].join("\n");

describe("pre-rename Omniboard boards", () => {
  it("are still read: marker, drawing, BPMN and meta blocks", () => {
    expect(isPieFlowMarkdown(legacyBoard)).toBe(true);
    expect(deserializeBoard(legacyBoard)?.nodes[0].id).toBe("n1");
    expect(deserializeBpmnXml(legacyBoard)).toBe("<bpmn:definitions/>");
    expect(deserializeSourceMeta(legacyBoard)).toEqual({ k: 1 });
  });

  it("are re-written in the Pie Flow format, keeping user frontmatter and tags", () => {
    const out = serializeBoard(model, legacyBoard);
    expect(out).toMatch(/^---\npie-flow-plugin: parsed\ntags: \[pie-flow, bpmn, kalix\]\naliases: x\n---/);
    expect(out).not.toContain("omniboard");
    expect(out).toContain("```pie-flow-data");
    expect(out).toContain("```pie-flow-bpmn-xml");
    expect(out).toContain("```pie-flow-source-meta");
    expect(deserializeBoard(out)?.nodes[0].id).toBe("n1");
  });

  it("legacy .omniboard.md paths still count as boards", () => {
    expect(isBoardPath("Pie Flow/a.pieflow.md")).toBe(true);
    expect(isBoardPath("Omniboards/a.omniboard.md")).toBe(true);
    expect(isBoardPath("notes/a.md")).toBe(false);
  });
});

describe("boardTags", () => {
  it.each([
    [undefined, "[pie-flow]"],
    ["[omniboard]", "[pie-flow]"],
    ["[omniboard, bpmn]", "[pie-flow, bpmn]"],
    ["[pie-flow, x]", "[pie-flow, x]"],
    ["[bpmn, kalix]", "[pie-flow, bpmn, kalix]"],
    ["[]", "[pie-flow]"],
    ["[my-omniboard]", "[pie-flow, my-omniboard]"],
    ["\n- omniboard\n- x", "\n- pie-flow\n- x"],
    ["\n- x", "\n- x\n- pie-flow"],
  ])("%j → %j", (input, expected) => {
    expect(boardTags(input)).toBe(expected);
  });
});
