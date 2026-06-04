import { describe, it, expect } from "vitest";
import { BoardEditor } from "../../src/ui/BoardEditor";
import { PaletteSidebar } from "../../src/ui/PaletteSidebar";
import { PropertiesSidebar } from "../../src/ui/PropertiesSidebar";
import type {
  PaletteSidebarItem,
  PropertyFieldSchema,
} from "../../src/core/sidebarSchema";
import type { DiagramAdapter, Theme } from "../../src/core/adapter";

/**
 * Story 7-2 — Story 7-1 integration smoke test.
 *
 * This file does NOT mount the sidebars INSIDE BoardEditor (that's Story 7-3
 * canvas-wiring's job). It only verifies all three components render
 * independently without throwing, so the next story can confidently compose
 * them.
 */

interface DummyModel {
  __dummy: true;
}

const dummyAdapter: DiagramAdapter<DummyModel> = {
  id: "flowchart",
  displayName: "Dummy",
  codeBlockLanguage: "dummy",
  icon: "square",
  parse: () => ({ __dummy: true }),
  serialize: () => "",
  emptyTemplate: () => "",
  Renderer: (() => null) as DiagramAdapter<DummyModel>["Renderer"],
  Editor: (() => null) as DiagramAdapter<DummyModel>["Editor"],
  exportFormats: ["svg"],
  validate: () => ({ ok: true, errors: [] }),
};

const dummyTheme: Theme = {
  isDark: false,
  colors: {
    background: "#fff",
    backgroundSecondary: "#f5f5f5",
    border: "#e0e0e0",
    text: "#000",
    textMuted: "#888",
    accent: "#6965db",
  },
};

const paletteItems: PaletteSidebarItem[] = [
  { id: "select", label: "Chọn", icon: "mouse-pointer", shortcut: "V", group: "PHẦN TỬ" },
  { id: "task", label: "Task", icon: "square", shortcut: "T", group: "PHẦN TỬ" },
];

const propertyFields: PropertyFieldSchema[] = [
  { kind: "text", key: "title", label: "Tiêu đề", value: "Demo" },
  {
    kind: "select",
    key: "dir",
    label: "Hướng",
    value: "LR",
    options: [
      { value: "LR", label: "LR" },
      { value: "TB", label: "TB" },
    ],
  },
  { kind: "toggle", key: "snap", label: "Snap to grid", value: true },
];

describe("Story 7-2 ↔ 7-1 integration smoke", () => {
  it("BoardEditor renders without depending on sidebar components", () => {
    expect(() =>
      BoardEditor({
        adapter: dummyAdapter,
        initialModel: { __dummy: true },
        theme: dummyTheme,
        mode: "modal",
        onSave: () => {},
        onClose: () => {},
      }),
    ).not.toThrow();
  });

  it("PaletteSidebar renders without throwing for representative items", () => {
    expect(() =>
      PaletteSidebar({ items: paletteItems, selectedId: "select" }),
    ).not.toThrow();
  });

  it("PropertiesSidebar renders without throwing for all three field kinds", () => {
    expect(() =>
      PropertiesSidebar({
        sectionTitle: "Diagram",
        sectionSubtitle: "dummy",
        fields: propertyFields,
      }),
    ).not.toThrow();
  });

  it("PropertiesSidebar empty state renders without throwing", () => {
    expect(() => PropertiesSidebar({ fields: [] })).not.toThrow();
  });
});

// ── Story 7-3: body slot composition smoke ─────────────────────────────────
// These tests verify BoardEditor renders sidebars conditionally based on
// optional body props (paletteItems / propertyFields / shapeCategories+canvasModel).
// Real DOM mounting of OmniboardCanvas is exercised in omniboardcanvas-mount.test.tsx
// with happy-dom; here we only assert the VNode tree includes the right children.
//
// IMPORTANT: child Component VNodes (e.g. <PaletteSidebar />) appear in the
// tree as unevaluated function references — they have `type === PaletteSidebar`
// but do NOT yet carry the rendered DOM's data-testid. We therefore identify
// them by component identity (referential equality on `type`), not by testid.

import { findByTestId, collectAll, asVNode } from "./_helpers/vnode-inspect";

const hasComponent = (
  root: ReturnType<typeof asVNode>,
  Component: unknown,
): boolean => collectAll(root, (v) => v.type === Component).length > 0;

describe("Story 7-3 — BoardEditor body slot composition", () => {
  it("renders only the empty body when no body props are provided (back-compat with Story 7-1)", () => {
    const root = asVNode(
      BoardEditor({
        adapter: dummyAdapter,
        initialModel: { __dummy: true },
        theme: dummyTheme,
        mode: "modal",
        onSave: () => {},
        onClose: () => {},
      }),
    );
    const body = findByTestId(root, "diagrams-board-editor-body");
    expect(body).toBeDefined();
    expect(hasComponent(root, PaletteSidebar)).toBe(false);
    expect(hasComponent(root, PropertiesSidebar)).toBe(false);
    // Body should NOT have the composed modifier when empty.
    expect(String(body?.props.class ?? "")).not.toContain(
      "diagrams-board-editor-body-composed",
    );
  });

  it("renders PaletteSidebar when paletteItems is provided", () => {
    const root = asVNode(
      BoardEditor({
        adapter: dummyAdapter,
        initialModel: { __dummy: true },
        theme: dummyTheme,
        mode: "modal",
        onSave: () => {},
        onClose: () => {},
        paletteItems,
      }),
    );
    expect(hasComponent(root, PaletteSidebar)).toBe(true);
    const body = findByTestId(root, "diagrams-board-editor-body");
    expect(String(body?.props.class ?? "")).toContain(
      "diagrams-board-editor-body-composed",
    );
  });

  it("renders PropertiesSidebar when propertyFields is provided", () => {
    const root = asVNode(
      BoardEditor({
        adapter: dummyAdapter,
        initialModel: { __dummy: true },
        theme: dummyTheme,
        mode: "modal",
        onSave: () => {},
        onClose: () => {},
        propertyFields,
        propertiesTitle: "Diagram",
        propertiesSubtitle: "dummy",
      }),
    );
    expect(hasComponent(root, PropertiesSidebar)).toBe(true);
  });

  it("includes the OmniboardCanvasMount component VNode when shapeCategories AND canvasModel both provided", async () => {
    const { OmniboardCanvasMount } = await import(
      "../../src/ui/OmniboardCanvasMount"
    );
    const root = asVNode(
      BoardEditor({
        adapter: dummyAdapter,
        initialModel: { __dummy: true },
        theme: dummyTheme,
        mode: "modal",
        onSave: () => {},
        onClose: () => {},
        shapeCategories: [{ title: "x", items: [] }],
        canvasModel: { nodes: [], edges: [] },
      }),
    );
    expect(hasComponent(root, OmniboardCanvasMount)).toBe(true);
  });

  it("renders all three regions together when all body props provided", async () => {
    const { OmniboardCanvasMount } = await import(
      "../../src/ui/OmniboardCanvasMount"
    );
    const root = asVNode(
      BoardEditor({
        adapter: dummyAdapter,
        initialModel: { __dummy: true },
        theme: dummyTheme,
        mode: "modal",
        onSave: () => {},
        onClose: () => {},
        paletteItems,
        propertyFields,
        shapeCategories: [{ title: "x", items: [] }],
        canvasModel: { nodes: [], edges: [] },
      }),
    );
    expect(hasComponent(root, PaletteSidebar)).toBe(true);
    expect(hasComponent(root, PropertiesSidebar)).toBe(true);
    expect(hasComponent(root, OmniboardCanvasMount)).toBe(true);
  });
});
