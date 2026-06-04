import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DiagramAdapter, Theme } from "../../src/core/adapter";
import { asVNode, collectAll, findByTestId } from "./_helpers/vnode-inspect";

/**
 * Story 7-7 — DiagramCard polish tests.
 *
 * DiagramCard imports from `obsidian` (Menu, Notice, setIcon). We mock the
 * obsidian module here with minimal stubs so Vitest can load the component.
 * The Obsidian Menu API is tested indirectly: we assert that button click
 * handlers fire and our mock Menu records `showAtMouseEvent` calls.
 */

// vi.hoisted lets us declare mock state + classes BEFORE vi.mock factory
// runs (which is hoisted to file top). Without this, vi.mock would
// fail with "Cannot access 'MockMenu' before initialization".
const mockState = vi.hoisted(() => {
  const menuRegistry: HoistedMockMenu[] = [];
  const noticeRegistry: string[] = [];

  class HoistedMockMenu {
    items: Array<{ title: string; icon: string; onClick: () => void }> = [];
    separators: number[] = [];
    shownAt: unknown = null;

    constructor() {
      menuRegistry.push(this);
    }

    addItem(
      cb: (i: {
        setTitle: (t: string) => unknown;
        setIcon: (n: string) => unknown;
        onClick: (fn: () => void) => unknown;
      }) => void,
    ): HoistedMockMenu {
      const entry = { title: "", icon: "", onClick: () => {} };
      const fluent = {
        setTitle: (t: string) => {
          entry.title = t;
          return fluent;
        },
        setIcon: (n: string) => {
          entry.icon = n;
          return fluent;
        },
        onClick: (fn: () => void) => {
          entry.onClick = fn;
          return fluent;
        },
      };
      cb(fluent);
      this.items.push(entry);
      return this;
    }

    addSeparator(): HoistedMockMenu {
      this.separators.push(this.items.length);
      return this;
    }

    showAtMouseEvent(e: unknown): HoistedMockMenu {
      this.shownAt = e;
      return this;
    }
  }

  class HoistedMockNotice {
    constructor(msg: string) {
      noticeRegistry.push(msg);
    }
  }

  return { menuRegistry, noticeRegistry, HoistedMockMenu, HoistedMockNotice };
});

type MockMenu = InstanceType<typeof mockState.HoistedMockMenu>;
const menuRegistry = mockState.menuRegistry as MockMenu[];
const noticeRegistry = mockState.noticeRegistry;

vi.mock("obsidian", () => ({
  Menu: mockState.HoistedMockMenu,
  Notice: mockState.HoistedMockNotice,
  setIcon: (_el: unknown, _name: string) => {
    // no-op
  },
}));

// Import AFTER the mock so DiagramCard picks up MockMenu.
import { DiagramCard } from "../../src/ui/DiagramCard";

// ── Test fixtures ───────────────────────────────────────────────────────────

const theme: Theme = {
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

const bpmnAdapter: DiagramAdapter<string> = {
  id: "bpmn",
  displayName: "BPMN 2.0",
  codeBlockLanguage: "bpmn",
  icon: "git-fork",
  parse: (s) => s,
  serialize: (s) => s,
  emptyTemplate: () => "",
  Renderer: (() => null) as DiagramAdapter<string>["Renderer"],
  Editor: (() => null) as DiagramAdapter<string>["Editor"],
  exportFormats: ["svg", "png", "pdf"],
  validate: () => ({ ok: true, errors: [] }),
};

function makeMouseEvent(): MouseEvent {
  // Simple object satisfying MouseEvent for our mock's typing.
  return {
    stopPropagation: vi.fn(),
    currentTarget: null,
  } as unknown as MouseEvent;
}

beforeEach(() => {
  menuRegistry.length = 0;
  noticeRegistry.length = 0;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("DiagramCard — AC1/AC2 header layout", () => {
  it("renders chip with adapter.displayName", () => {
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit: () => {} }),
    );
    const chip = findByTestId(root, "diagrams-card-chip");
    expect(chip).toBeDefined();
    // The label is a child span; collect text children
    const labelSpan = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-chip-label",
    );
    expect(labelSpan.length).toBe(1);
    expect(labelSpan[0].props.children).toBe("BPMN 2.0");
  });

  it("renders 3 header buttons: Export, Sửa, ⋯", () => {
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit: () => {} }),
    );
    expect(findByTestId(root, "diagrams-card-export")).toBeDefined();
    expect(findByTestId(root, "diagrams-card-edit")).toBeDefined();
    expect(findByTestId(root, "diagrams-card-more")).toBeDefined();
  });

  it('the "Sửa" button has the primary modifier class', () => {
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit: () => {} }),
    );
    const edit = findByTestId(root, "diagrams-card-edit");
    expect(String(edit?.props.class ?? "")).toContain(
      "diagrams-card-btn-primary",
    );
  });
});

describe("DiagramCard — AC2 Edit button", () => {
  it("invokes onEdit on click", () => {
    const onEdit = vi.fn();
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit }),
    );
    const edit = findByTestId(root, "diagrams-card-edit");
    const handler = edit?.props.onClick as (e: MouseEvent) => void;
    handler(makeMouseEvent());
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

describe("DiagramCard — AC3 Export button", () => {
  it("opens an Obsidian Menu with formats from adapter.exportFormats", () => {
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit: () => {} }),
    );
    const exp = findByTestId(root, "diagrams-card-export");
    const handler = exp?.props.onClick as (e: MouseEvent) => void;
    handler(makeMouseEvent());
    expect(menuRegistry.length).toBe(1);
    const menu = menuRegistry[0];
    expect(menu.items.map((i) => i.title)).toEqual(["SVG", "PNG", "PDF"]);
    expect(menu.shownAt).not.toBeNull();
  });

  it("filters menu to formats the adapter actually supports", () => {
    const svgOnlyAdapter: DiagramAdapter<string> = {
      ...bpmnAdapter,
      exportFormats: ["svg"],
    };
    const root = asVNode(
      DiagramCard({
        adapter: svgOnlyAdapter,
        source: "",
        theme,
        onEdit: () => {},
      }),
    );
    const exp = findByTestId(root, "diagrams-card-export");
    (exp?.props.onClick as (e: MouseEvent) => void)(makeMouseEvent());
    expect(menuRegistry[0].items.map((i) => i.title)).toEqual(["SVG"]);
  });

  it("calls onExport(format) when the user picks a menu item", () => {
    const onExport = vi.fn();
    const root = asVNode(
      DiagramCard({
        adapter: bpmnAdapter,
        source: "",
        theme,
        onEdit: () => {},
        onExport,
      }),
    );
    const exp = findByTestId(root, "diagrams-card-export");
    (exp?.props.onClick as (e: MouseEvent) => void)(makeMouseEvent());
    const pngItem = menuRegistry[0].items.find((i) => i.title === "PNG");
    pngItem?.onClick();
    expect(onExport).toHaveBeenCalledWith("png");
  });

  it("shows a deferred-impl Notice when onExport prop is absent", () => {
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit: () => {} }),
    );
    const exp = findByTestId(root, "diagrams-card-export");
    (exp?.props.onClick as (e: MouseEvent) => void)(makeMouseEvent());
    menuRegistry[0].items[0].onClick(); // click SVG
    expect(noticeRegistry.length).toBe(1);
    expect(noticeRegistry[0]).toContain("Story 7-20");
  });
});

describe("DiagramCard — AC4 3-dot menu", () => {
  it("opens a Menu with 4 items + 1 separator", () => {
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit: () => {} }),
    );
    const more = findByTestId(root, "diagrams-card-more");
    (more?.props.onClick as (e: MouseEvent) => void)(makeMouseEvent());
    const menu = menuRegistry[0];
    expect(menu.items.map((i) => i.title)).toEqual([
      "Mở trình chỉnh sửa",
      "Export…",
      "Copy as image",
      "Sửa dạng mã nguồn",
    ]);
    // Separator inserted between Copy as image (index 3) and Sửa dạng mã nguồn
    expect(menu.separators).toEqual([3]);
  });

  it('"Mở trình chỉnh sửa" calls onEdit', () => {
    const onEdit = vi.fn();
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit }),
    );
    (findByTestId(root, "diagrams-card-more")?.props.onClick as (e: MouseEvent) => void)(
      makeMouseEvent(),
    );
    menuRegistry[0].items[0].onClick();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('"Export…" opens the export submenu', () => {
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit: () => {} }),
    );
    (findByTestId(root, "diagrams-card-more")?.props.onClick as (e: MouseEvent) => void)(
      makeMouseEvent(),
    );
    // Click "Export…" — should create a SECOND Menu (the export submenu)
    menuRegistry[0].items[1].onClick();
    expect(menuRegistry.length).toBe(2);
    expect(menuRegistry[1].items.map((i) => i.title)).toEqual(["SVG", "PNG", "PDF"]);
  });

  it('"Copy as image" shows deferred Notice when callback absent', () => {
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit: () => {} }),
    );
    (findByTestId(root, "diagrams-card-more")?.props.onClick as (e: MouseEvent) => void)(
      makeMouseEvent(),
    );
    menuRegistry[0].items[2].onClick();
    expect(noticeRegistry[0]).toContain("Story 7-20");
  });

  it('"Sửa dạng mã nguồn" falls back to onEdit when onSourceEdit is absent', () => {
    const onEdit = vi.fn();
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit }),
    );
    (findByTestId(root, "diagrams-card-more")?.props.onClick as (e: MouseEvent) => void)(
      makeMouseEvent(),
    );
    menuRegistry[0].items[3].onClick(); // "Sửa dạng mã nguồn"
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('"Sửa dạng mã nguồn" calls onSourceEdit when provided', () => {
    const onEdit = vi.fn();
    const onSourceEdit = vi.fn();
    const root = asVNode(
      DiagramCard({
        adapter: bpmnAdapter,
        source: "",
        theme,
        onEdit,
        onSourceEdit,
      }),
    );
    (findByTestId(root, "diagrams-card-more")?.props.onClick as (e: MouseEvent) => void)(
      makeMouseEvent(),
    );
    menuRegistry[0].items[3].onClick();
    expect(onSourceEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("DiagramCard — Story 7-6 warning state", () => {
  it("renders the preview (no warning) when adapter has no validateSource", () => {
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit: () => {} }),
    );
    expect(findByTestId(root, "diagrams-card-warning")).toBeUndefined();
    expect(findByTestId(root, "diagrams-card-preview")).toBeDefined();
  });

  it("renders the preview (no warning) when validateSource returns []", () => {
    const adapter: DiagramAdapter<string> = {
      ...bpmnAdapter,
      validateSource: () => [],
    };
    const root = asVNode(
      DiagramCard({ adapter, source: "", theme, onEdit: () => {} }),
    );
    expect(findByTestId(root, "diagrams-card-warning")).toBeUndefined();
  });

  it("renders the warning card when validateSource returns an error issue", () => {
    const adapter: DiagramAdapter<string> = {
      ...bpmnAdapter,
      validateSource: () => [
        { severity: "error", message: "Không phân tích được diagram", line: 5 },
      ],
    };
    const root = asVNode(
      DiagramCard({ adapter, source: "", theme, onEdit: () => {} }),
    );
    const warning = findByTestId(root, "diagrams-card-warning");
    expect(warning).toBeDefined();
    // The error message must appear in the warning title
    const titles = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-warning-title",
    );
    expect(titles.length).toBe(1);
  });

  it("ignores warning-severity issues — only errors trigger the warning card", () => {
    const adapter: DiagramAdapter<string> = {
      ...bpmnAdapter,
      validateSource: () => [
        { severity: "warning", message: "minor hint" },
      ],
    };
    const root = asVNode(
      DiagramCard({ adapter, source: "", theme, onEdit: () => {} }),
    );
    expect(findByTestId(root, "diagrams-card-warning")).toBeUndefined();
  });

  it('warning card "Mở editor để sửa" button falls back to onEdit when no onSourceEdit', () => {
    const onEdit = vi.fn();
    const adapter: DiagramAdapter<string> = {
      ...bpmnAdapter,
      validateSource: () => [{ severity: "error", message: "syntax error" }],
    };
    const root = asVNode(
      DiagramCard({ adapter, source: "", theme, onEdit }),
    );
    const btn = findByTestId(root, "diagrams-card-warning-edit");
    (btn?.props.onClick as (e: MouseEvent) => void)(makeMouseEvent());
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('warning card "Mở editor để sửa" button uses onSourceEdit when provided', () => {
    const onEdit = vi.fn();
    const onSourceEdit = vi.fn();
    const adapter: DiagramAdapter<string> = {
      ...bpmnAdapter,
      validateSource: () => [{ severity: "error", message: "syntax error" }],
    };
    const root = asVNode(
      DiagramCard({ adapter, source: "", theme, onEdit, onSourceEdit }),
    );
    const btn = findByTestId(root, "diagrams-card-warning-edit");
    (btn?.props.onClick as (e: MouseEvent) => void)(makeMouseEvent());
    expect(onSourceEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("DiagramCard — AC6 click propagation", () => {
  it("the card body wrapper itself has onEdit on the root div (preserves M0 convenience)", () => {
    const onEdit = vi.fn();
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit }),
    );
    const handler = root.props.onClick as (() => void) | undefined;
    handler?.();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("header button handlers call stopPropagation", () => {
    const onEdit = vi.fn();
    const root = asVNode(
      DiagramCard({ adapter: bpmnAdapter, source: "", theme, onEdit }),
    );
    const stop = vi.fn();
    const fakeEvent = { stopPropagation: stop } as unknown as MouseEvent;
    // Each header button must call stopPropagation
    const exp = findByTestId(root, "diagrams-card-export");
    (exp?.props.onClick as (e: MouseEvent) => void)(fakeEvent);
    const edit = findByTestId(root, "diagrams-card-edit");
    (edit?.props.onClick as (e: MouseEvent) => void)(fakeEvent);
    const more = findByTestId(root, "diagrams-card-more");
    (more?.props.onClick as (e: MouseEvent) => void)(fakeEvent);
    expect(stop).toHaveBeenCalledTimes(3);
  });
});
