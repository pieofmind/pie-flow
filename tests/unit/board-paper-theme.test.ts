/**
 * "Paper" board: the diagram surface (.lk-root canvas, bpmn-js .djs-container)
 * stays LIGHT regardless of Obsidian's theme — diagrams are documents
 * (bpmn.io / draw.io convention). Chrome (.da-board-view topbar) uses Pie Flow's
 * own tokens too; it turns dark only with the board's own dark mode (☰ menu).
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
  it("chrome (.da-board-view) uses Pie Flow tokens, not the Obsidian theme", () => {
    expect(css).not.toMatch(/\.theme-dark\s+\.da-board-view\s*\{/);
    const block = /\n\.da-board-view\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(block).not.toMatch(/var\(--background-primary|var\(--text-normal/);
    // Obsidian's own button/input rules read its theme vars → those vars point at Pie Flow tokens.
    const shared = /\.da-board-view, \.lk-root,[^{]*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(shared).toMatch(/--background-primary:\s*var\(--pg-surface\)/);
    expect(shared).toMatch(/--text-normal:\s*var\(--pg-text\)/);
    expect(shared).toMatch(/--interactive-normal:\s*transparent/);
  });
  it("bpmn-native.css paints .bpmn-native-root as paper, not the app background", () => {
    const block = /\n\.bpmn-native-root\s*\{[^}]*\}/.exec(native)?.[0] ?? "";
    expect(block).not.toMatch(/background:\s*var\(--background-primary/);
    expect(block).toMatch(/background:\s*#FFFFFF/i); // white = bpmn-js pool fill, not cream
    expect(block).toMatch(/color-scheme:\s*light/);
  });
  it("bpmn-native.css has no theme-dependent chrome floating over the paper", () => {
    // palette / context-pad / nav widget sit ON the diagram → must stay light
    expect(native).not.toMatch(/\.theme-dark/);
    const nav = /\.bpmn-native-root \.bpmn-nav-widget\s*\{[^}]*\}/.exec(native)?.[0] ?? "";
    expect(nav).not.toMatch(/var\(--background/);
  });
  it("bpmn-native.css does not repaint the diagram container dark", () => {
    expect(native).not.toMatch(/\.theme-dark\s+\.bpmn-native-root\s+\.djs-container\b/);
  });
});
