/**
 * "Paper" board: the diagram surface (.lk-root canvas, bpmn-js .djs-container)
 * stays LIGHT regardless of Obsidian's theme — diagrams are documents
 * (bpmn.io / draw.io convention). Only chrome (.da-board-view topbar, native
 * palette/context-pad) follows the dark theme.
 *
 * Guard against re-introducing a `.theme-dark` override on the surface.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");
const native = readFileSync(resolve(__dirname, "../../src/bpmn-native/bpmn-native.css"), "utf8");

describe("paper board theme", () => {
  it("styles.css has no .theme-dark override on .lk-root (canvas surface)", () => {
    expect(css).not.toMatch(/\.theme-dark\s+\.lk-root\b/);
  });
  it(".lk-root forces color-scheme: light so native inputs/scrollbars match the paper", () => {
    const blocks = [...css.matchAll(/(?:^|[\s,])\.lk-root\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(blocks.some((b) => /color-scheme:\s*light/.test(b))).toBe(true);
  });
  it(".diagrams-canvas-mount paints with --pg-canvas, not Obsidian's --background-primary alone", () => {
    const block = /\.diagrams-canvas-mount\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(block).toMatch(/background:\s*var\(--pg-canvas/);
  });
  it("chrome (.da-board-view) follows the active Obsidian theme via its CSS vars", () => {
    // No hard-coded brand-dark override: Obsidian's own vars flip with the theme.
    expect(css).not.toMatch(/\.theme-dark\s+\.da-board-view\s*\{/);
    const block = /\n\.da-board-view\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(block).toMatch(/--pg-surface:\s*var\(--background-primary\)/);
    expect(block).toMatch(/--pg-text:\s*var\(--text-normal\)/);
    expect(block).toMatch(/--pg-border:\s*var\(--background-modifier-border\)/);
  });
  it("bpmn-native.css does not repaint the diagram container dark", () => {
    expect(native).not.toMatch(/\.theme-dark\s+\.bpmn-native-root\s+\.djs-container\b/);
  });
});
