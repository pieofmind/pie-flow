/**
 * Board dark mode uses ONE neutral palette for the board and its chrome
 * (topbar, side panel, toolbars). Guard against a warm/brown tint coming back:
 * every --pg-* colour declared under .lk-dark must have blue >= red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");

function rgbOf(v: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const m of v.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const n = parseInt(m[1], 16);
    out.push([n >> 16, (n >> 8) & 255, n & 255]);
  }
  for (const m of v.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) out.push([+m[1], +m[2], +m[3]]);
  return out;
}

describe("board dark palette", () => {
  const darkBlocks = [...css.matchAll(/([^{}]*\.lk-dark[^{}]*)\{([^}]*)\}/g)];

  it("has dark rules", () => {
    expect(darkBlocks.length).toBeGreaterThan(0);
  });

  it("no warm (brown) --pg-* colour under .lk-dark", () => {
    const warm: string[] = [];
    for (const [, sel, body] of darkBlocks) {
      for (const d of body.matchAll(/(--pg-(?!accent)[\w-]+)\s*:\s*([^;]+)/g)) {
        for (const [r, , b] of rgbOf(d[2])) if (b < r) warm.push(`${sel.trim()} ${d[1]}: ${d[2]}`);
      }
    }
    expect(warm).toEqual([]);
  });

  it("chrome around the board takes the same dark palette as the board", () => {
    const shared = darkBlocks.find(([, sel]) => /\.lk-root\.lk-dark\s*,\s*\.da-board-view:has\(\.lk-root\.lk-dark\)\s*$/.test(sel));
    expect(shared?.[2]).toMatch(/--pg-surface:/);
  });
});
