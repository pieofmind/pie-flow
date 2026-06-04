import { describe, it, expect } from "vitest";
import { BoardEditor } from "../../src/ui/BoardEditor";
import { PaletteSidebar } from "../../src/ui/PaletteSidebar";
import { PropertiesSidebar } from "../../src/ui/PropertiesSidebar";
import type {
  PaletteItem,
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

const paletteItems: PaletteItem[] = [
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
