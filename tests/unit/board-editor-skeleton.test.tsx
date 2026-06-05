import { describe, it, expect } from "vitest";
import { h, type VNode } from "preact";
import {
  BoardEditor,
  type BoardEditorMode,
  type BoardEditorProps,
} from "../../src/ui/BoardEditor";
import type { DiagramAdapter, Theme } from "../../src/core/adapter";

/**
 * Story 7-1 — `<BoardEditor>` skeleton tests.
 *
 * The skeleton component is pure: it returns a VNode tree based on props
 * without touching the DOM. Tests inspect the VNode structure directly,
 * avoiding the need for happy-dom / jsdom (story AC6 forbids new deps).
 *
 * Subsequent stories (7-4, 7-5) will mount the component into a real Modal /
 * ItemView and add integration tests with DOM.
 */

// ── Minimal stubs satisfying the prop contract without any runtime behaviour ─

interface DummyModel {
  __dummy: true;
}

const dummyAdapter: DiagramAdapter<DummyModel> = {
  id: "flowchart", // arbitrary — skeleton doesn't read this in 7-1
  displayName: "Dummy",
  codeBlockLanguage: "dummy",
  icon: "square",
  parse: () => ({ __dummy: true }),
  serialize: () => "",
  emptyTemplate: () => "",
  // Renderer/Editor are unused in skeleton; cast minimally so the test stays
  // focused on the layout contract under test.
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

function buildProps(
  mode: BoardEditorMode,
  overrides: Partial<BoardEditorProps<DummyModel>> = {},
): BoardEditorProps<DummyModel> {
  return {
    adapter: dummyAdapter,
    initialModel: { __dummy: true },
    theme: dummyTheme,
    mode,
    onSave: () => {},
    onClose: () => {},
    ...overrides,
  };
}

// ── VNode walking helpers ────────────────────────────────────────────────────
// Shared with sidebar tests via tests/unit/_helpers/vnode-inspect.ts so we
// avoid duplicating the inspection logic across test files.

import { asVNode, findByTestId } from "./_helpers/vnode-inspect";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("BoardEditor skeleton — AC2 layout structure", () => {
  it("emits a root <div> with the three slot children (header / body / footer)", () => {
    const result = BoardEditor(buildProps("modal")) as unknown as VNode;
    const root = asVNode(result);

    expect(root.type).toBe("div");

    const header = findByTestId(root, "diagrams-board-editor-header");
    const body = findByTestId(root, "diagrams-board-editor-body");
    const footer = findByTestId(root, "diagrams-board-editor-footer");

    expect(header).toBeDefined();
    expect(body).toBeDefined();
    expect(footer).toBeDefined();

    expect(header?.type).toBe("header");
    expect(body?.type).toBe("div");
    expect(footer?.type).toBe("footer");
  });

  it("exposes data-testid on the root for downstream story tests", () => {
    const root = asVNode(BoardEditor(buildProps("modal")));
    expect(root.props["data-testid"]).toBe("diagrams-board-editor");
  });
});

describe("BoardEditor skeleton — AC3 mode prop", () => {
  // Single source of truth: the modifier class on the root element. We do
  // NOT also stamp a `data-mode` attribute — that would be redundant and
  // invite drift (per code review D1, 2026-06-04).
  it("renders modal modifier class when mode='modal'", () => {
    const root = asVNode(BoardEditor(buildProps("modal")));
    expect(root.props.class).toContain("diagrams-board-editor");
    expect(root.props.class).toContain("diagrams-board-editor-mode-modal");
    expect(root.props.class).not.toContain("diagrams-board-editor-mode-tab");
  });

  it("renders tab modifier class when mode='tab'", () => {
    const root = asVNode(BoardEditor(buildProps("tab")));
    expect(root.props.class).toContain("diagrams-board-editor");
    expect(root.props.class).toContain("diagrams-board-editor-mode-tab");
    expect(root.props.class).not.toContain("diagrams-board-editor-mode-modal");
  });
});

describe("BoardEditor skeleton — AC1 generic type contract", () => {
  it("accepts a typed adapter and infers the model parameter (compile-time check)", () => {
    // This block is a compile-time contract: if BoardEditorProps were not
    // properly generic, TypeScript would error here. The runtime assert is
    // trivial — the real test is that the file type-checks under `tsc`.
    const props = buildProps("modal");
    const result = BoardEditor<DummyModel>(props);
    expect(result).toBeDefined();
  });

  it("treats title/onTitleChange as optional (skeleton does not require them)", () => {
    // Building props without title/onTitleChange must be accepted by the
    // type system AND at runtime. If the optionality regresses, callers
    // (Story 7-4 / 7-5) will not compile until they wire title plumbing.
    const propsWithoutTitle = buildProps("modal");
    expect(() => BoardEditor(propsWithoutTitle)).not.toThrow();

    const propsWithTitle = buildProps("modal", {
      title: "Quy trình bán hàng",
      onTitleChange: () => {},
    });
    expect(() => BoardEditor(propsWithTitle)).not.toThrow();
  });
});

describe("BoardEditor skeleton — AC4 no side effects in skeleton", () => {
  it("does not invoke onSave or onClose at render time", () => {
    let saveCalled = false;
    let closeCalled = false;
    const props = buildProps("modal", {
      onSave: () => {
        saveCalled = true;
      },
      onClose: () => {
        closeCalled = true;
      },
    });
    BoardEditor(props);
    expect(saveCalled).toBe(false);
    expect(closeCalled).toBe(false);
  });

  it("allocates a fresh VNode on each invocation", () => {
    // Two h() calls always return distinct objects — this is a Preact
    // internal guarantee, not proof of P5 compliance. P5 ("no module-level
    // mutable state") is enforced by code review of the source file, not by
    // runtime assertions. We assert distinct VNode identity here only as a
    // sanity check that the component is not accidentally memoizing/caching.
    const a = BoardEditor(buildProps("modal"));
    const b = BoardEditor(buildProps("modal"));
    expect(a).not.toBe(b);
  });
});

describe("BoardEditor — Story 7-5 body slot + modal header chrome", () => {
  it("renders the provided body VNode inside the body region", () => {
    const marker = h("span", { "data-testid": "my-body-marker" }, "BODY");
    const root = asVNode(
      BoardEditor(buildProps("modal", { body: marker as unknown as VNode })),
    );
    expect(findByTestId(root, "my-body-marker")).toBeDefined();
  });

  it("body slot suppresses the palette/canvas/properties composition", () => {
    const marker = h("span", { "data-testid": "my-body-marker" });
    const root = asVNode(
      BoardEditor(
        buildProps("modal", {
          body: marker as unknown as VNode,
          // These would normally render slots — must be suppressed by body.
          paletteItems: [{ id: "x", label: "X", icon: "square" }],
          propertyFields: [],
          // Canvas slot would render if shapeCategories + canvasModel given;
          // body must suppress it (no OmniboardCanvasMount constructed).
          shapeCategories: [{ title: "G", items: [] }],
          canvasModel: { nodes: [], edges: [] },
        }),
      ),
    );
    expect(findByTestId(root, "my-body-marker")).toBeDefined();
    expect(findByTestId(root, "diagrams-palette-sidebar")).toBeUndefined();
    // Canvas mount must NOT appear in the tree when body is provided.
    expect(findByTestId(root, "diagrams-canvas-mount")).toBeUndefined();
  });

  it("renders chip + title in the header when mode='modal'", () => {
    const root = asVNode(
      BoardEditor(
        buildProps("modal", { chipLabel: "BPMN 2.0", title: "Quy trình bán hàng" }),
      ),
    );
    const chip = findByTestId(root, "diagrams-board-editor-chip");
    const title = findByTestId(root, "diagrams-board-editor-title");
    expect(chip).toBeDefined();
    expect(title).toBeDefined();
  });

  it("does NOT render the modal header chip in tab mode", () => {
    const root = asVNode(
      BoardEditor(buildProps("tab", { chipLabel: "BPMN 2.0", title: "X" })),
    );
    expect(findByTestId(root, "diagrams-board-editor-chip")).toBeUndefined();
  });

  it("omits chip/title when neither provided (modal mode)", () => {
    const root = asVNode(BoardEditor(buildProps("modal")));
    expect(findByTestId(root, "diagrams-board-editor-chip")).toBeUndefined();
    expect(findByTestId(root, "diagrams-board-editor-title")).toBeUndefined();
  });
});

describe("BoardEditor — Story 7-5b editable title + header actions", () => {
  it("renders an editable <input> when onTitleChange is provided", () => {
    const root = asVNode(
      BoardEditor(
        buildProps("modal", { title: "My Flow", onTitleChange: () => {} }),
      ),
    );
    const input = findByTestId(root, "diagrams-board-editor-title-input");
    expect(input).toBeDefined();
    expect(input?.type).toBe("input");
    expect(input?.props.value).toBe("My Flow");
    // The read-only span must NOT also render.
    expect(findByTestId(root, "diagrams-board-editor-title")).toBeUndefined();
  });

  it("title input dispatches onTitleChange with the new value", () => {
    let changed: string | undefined;
    const root = asVNode(
      BoardEditor(
        buildProps("modal", {
          title: "",
          onTitleChange: (v) => {
            changed = v;
          },
        }),
      ),
    );
    const input = findByTestId(root, "diagrams-board-editor-title-input");
    (input!.props.onInput as (e: unknown) => void)({
      target: { value: "Tên mới" },
    });
    expect(changed).toBe("Tên mới");
  });

  it("renders read-only span (not input) when onTitleChange absent", () => {
    const root = asVNode(BoardEditor(buildProps("modal", { title: "Fixed" })));
    expect(findByTestId(root, "diagrams-board-editor-title")).toBeDefined();
    expect(findByTestId(root, "diagrams-board-editor-title-input")).toBeUndefined();
  });

  it("renders header Save/Close buttons when showHeaderActions=true", () => {
    let saved = false;
    let closed = false;
    const root = asVNode(
      BoardEditor(
        buildProps("modal", {
          chipLabel: "Flowchart",
          showHeaderActions: true,
          onHeaderSave: () => {
            saved = true;
          },
          onClose: () => {
            closed = true;
          },
        }),
      ),
    );
    const saveBtn = findByTestId(root, "diagrams-board-editor-save");
    const closeBtn = findByTestId(root, "diagrams-board-editor-close");
    expect(saveBtn).toBeDefined();
    expect(closeBtn).toBeDefined();
    (saveBtn!.props.onClick as () => void)();
    (closeBtn!.props.onClick as () => void)();
    expect(saved).toBe(true);
    expect(closed).toBe(true);
  });

  it("does NOT render header actions by default (body-slot / 7-5 mode)", () => {
    const root = asVNode(
      BoardEditor(buildProps("modal", { chipLabel: "BPMN 2.0", title: "X" })),
    );
    expect(findByTestId(root, "diagrams-board-editor-save")).toBeUndefined();
    expect(findByTestId(root, "diagrams-board-editor-close")).toBeUndefined();
  });
});
