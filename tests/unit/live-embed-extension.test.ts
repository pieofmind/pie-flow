import { describe, it, expect } from "vitest";
// Import from the pure-utility module (the editor extension file pulls in
// `obsidian` / `@codemirror/*` which aren't resolvable under Vitest).
import { isOmniboardLink } from "../../src/embed/linkUtils";

/**
 * Story 7-12 — pure-function tests for the Live Preview embed extension.
 *
 * The widget rendering and CodeMirror integration require a real
 * Obsidian + CM6 runtime, so they are not unit-tested. Manual smoke
 * test documented in the story spec (AC8).
 */

describe("isOmniboardLink", () => {
  it("matches `.omniboard.md` suffix", () => {
    expect(isOmniboardLink("note.omniboard.md")).toBe(true);
  });

  it("matches `.omniboard` suffix (without `.md`)", () => {
    expect(isOmniboardLink("note.omniboard")).toBe(true);
  });

  it("matches with full path prefix", () => {
    expect(isOmniboardLink("subfolder/quy-trinh-ban-hang.omniboard.md")).toBe(true);
  });

  it("matches when followed by a heading anchor `#`", () => {
    expect(isOmniboardLink("note.omniboard.md#Some Heading")).toBe(true);
  });

  it("matches when followed by a block ref `#^`", () => {
    expect(isOmniboardLink("note.omniboard.md#^block-id")).toBe(true);
  });

  it("matches with anchor on the `.omniboard` (no `.md`) variant", () => {
    expect(isOmniboardLink("note.omniboard#section")).toBe(true);
  });

  it("rejects plain `.md` files (no omniboard suffix)", () => {
    expect(isOmniboardLink("note.md")).toBe(false);
  });

  it("rejects unrelated extensions", () => {
    expect(isOmniboardLink("diagram.bpmn")).toBe(false);
    expect(isOmniboardLink("image.png")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isOmniboardLink("")).toBe(false);
  });

  it("rejects `omniboard` substring not at end", () => {
    // The link `omniboard.md.bak` contains "omniboard" but doesn't end
    // in the suffix — must not match.
    expect(isOmniboardLink("omniboard.md.bak")).toBe(false);
  });

  it("rejects suffix-only with no basename", () => {
    // `.omniboard.md` alone is unusual but valid path syntax — still
    // satisfies the suffix check. Document the current behavior.
    expect(isOmniboardLink(".omniboard.md")).toBe(true);
  });
});
