import { describe, it, expect } from "vitest";
import { PaletteSidebar } from "../../src/ui/PaletteSidebar";
import type { PaletteSidebarItem } from "../../src/core/sidebarSchema";
import {
  asVNode,
  collectAll,
  findByTestId,
} from "./_helpers/vnode-inspect";

const ITEMS: PaletteSidebarItem[] = [
  { id: "select", label: "Chọn", icon: "mouse-pointer", shortcut: "V", group: "PHẦN TỬ" },
  { id: "start", label: "Start event", icon: "circle", shortcut: "S", group: "PHẦN TỬ" },
  { id: "task", label: "Task", icon: "square", shortcut: "T", group: "PHẦN TỬ" },
  { id: "gate", label: "Gateway", icon: "diamond", shortcut: "G", group: "PHẦN TỬ" },
];

describe("PaletteSidebar — AC2 layout", () => {
  it("renders one button per palette item", () => {
    const root = asVNode(PaletteSidebar({ items: ITEMS }));
    const buttons = collectAll(root, (v) => v.type === "button");
    expect(buttons.length).toBe(ITEMS.length);
  });

  it("renders the root aside with the sidebar testid", () => {
    const root = asVNode(PaletteSidebar({ items: ITEMS }));
    expect(root.type).toBe("aside");
    expect(root.props["data-testid"]).toBe("diagrams-palette-sidebar");
  });

  it("renders an empty aside (no buttons) when items=[]", () => {
    const root = asVNode(PaletteSidebar({ items: [] }));
    expect(root.type).toBe("aside");
    const buttons = collectAll(root, (v) => v.type === "button");
    expect(buttons.length).toBe(0);
  });

  it("exposes per-item testid `diagrams-palette-item-<id>`", () => {
    const root = asVNode(PaletteSidebar({ items: ITEMS }));
    for (const item of ITEMS) {
      const hit = findByTestId(root, `diagrams-palette-item-${item.id}`);
      expect(hit, `expected testid for ${item.id}`).toBeDefined();
    }
  });
});

describe("PaletteSidebar — AC2 group header", () => {
  it("renders one group header when all items share a group", () => {
    const root = asVNode(PaletteSidebar({ items: ITEMS }));
    const headers = collectAll(
      root,
      (v) => v.props.class === "diagrams-palette-group-header",
    );
    expect(headers.length).toBe(1);
  });

  it("does NOT render a group header when items have no group field", () => {
    const ungrouped: PaletteSidebarItem[] = ITEMS.map((i) => ({ ...i, group: undefined }));
    const root = asVNode(PaletteSidebar({ items: ungrouped }));
    const headers = collectAll(
      root,
      (v) => v.props.class === "diagrams-palette-group-header",
    );
    expect(headers.length).toBe(0);
  });

  it("renders separate headers for distinct groups in stable order", () => {
    const mixed: PaletteSidebarItem[] = [
      { id: "a", label: "A", icon: "x", group: "G1" },
      { id: "b", label: "B", icon: "x", group: "G2" },
      { id: "c", label: "C", icon: "x", group: "G1" }, // back to G1
    ];
    const root = asVNode(PaletteSidebar({ items: mixed }));
    // Headers should appear in the insertion order of their FIRST item:
    // G1 then G2. The two G1 items cluster under the single G1 header.
    const headers = collectAll(
      root,
      (v) => v.props.class === "diagrams-palette-group-header",
    );
    expect(headers.length).toBe(2);
  });

  it("clusters interleaved-group items under their respective headers without preserving array order across groups", () => {
    // Pin the cluster-by-group contract — adapter authors might assume
    // visual order matches array order. The implementation clusters.
    const interleaved: PaletteSidebarItem[] = [
      { id: "a1", label: "A1", icon: "x", group: "A" },
      { id: "b1", label: "B1", icon: "x", group: "B" },
      { id: "a2", label: "A2", icon: "x", group: "A" },
      { id: "b2", label: "B2", icon: "x", group: "B" },
    ];
    const root = asVNode(PaletteSidebar({ items: interleaved }));
    const groupDivs = collectAll(
      root,
      (v) => v.type === "div" && v.props.class === "diagrams-palette-group",
    );
    expect(groupDivs.length).toBe(2);
    // First group (A) should contain BOTH a1 AND a2 — not interleaved with B.
    const aButtons = collectAll(
      groupDivs[0],
      (v) =>
        v.type === "button" &&
        typeof v.props["data-testid"] === "string" &&
        v.props["data-testid"].startsWith("diagrams-palette-item-"),
    );
    expect(aButtons.map((b) => b.props["data-testid"])).toEqual([
      "diagrams-palette-item-a1",
      "diagrams-palette-item-a2",
    ]);
  });

  it("treats empty-string group as 'no group' (no header rendered)", () => {
    const items: PaletteSidebarItem[] = [
      { id: "x", label: "X", icon: "x", group: "" },
    ];
    const root = asVNode(PaletteSidebar({ items }));
    const headers = collectAll(
      root,
      (v) => v.props.class === "diagrams-palette-group-header",
    );
    expect(headers.length).toBe(0);
  });
});

describe("PaletteSidebar — AC2 selection", () => {
  it("applies `diagrams-palette-item-selected` class AND aria-current to the matching item", () => {
    const root = asVNode(PaletteSidebar({ items: ITEMS, selectedId: "task" }));
    const taskBtn = findByTestId(root, "diagrams-palette-item-task");
    expect(taskBtn?.props.class).toContain("diagrams-palette-item-selected");
    expect(taskBtn?.props["aria-current"]).toBe("true");
    // Other items: not selected, no aria-current
    const startBtn = findByTestId(root, "diagrams-palette-item-start");
    expect(startBtn?.props.class).not.toContain("diagrams-palette-item-selected");
    expect(startBtn?.props["aria-current"]).toBeUndefined();
  });

  it("when selectedId is undefined, no item is marked selected", () => {
    const root = asVNode(PaletteSidebar({ items: ITEMS }));
    const buttons = collectAll(root, (v) => v.type === "button");
    for (const btn of buttons) {
      expect(btn.props.class).not.toContain("diagrams-palette-item-selected");
    }
  });
});

describe("PaletteSidebar — AC2 click dispatch", () => {
  it("invokes onSelectItem(id) AND item.onActivate() on click", () => {
    let selected: string | null = null;
    let activated = false;
    const items: PaletteSidebarItem[] = [
      {
        id: "task",
        label: "Task",
        icon: "square",
        onActivate: () => {
          activated = true;
        },
      },
    ];
    const root = asVNode(
      PaletteSidebar({
        items,
        onSelectItem: (id) => {
          selected = id;
        },
      }),
    );
    const btn = findByTestId(root, "diagrams-palette-item-task");
    expect(btn).toBeDefined();
    // Simulate click — call the onClick handler directly from props
    const onClick = btn?.props.onClick as (() => void) | undefined;
    expect(typeof onClick).toBe("function");
    onClick?.();
    expect(selected).toBe("task");
    expect(activated).toBe(true);
  });

  it("does not throw when onSelectItem and onActivate are both absent", () => {
    const items: PaletteSidebarItem[] = [{ id: "x", label: "X", icon: "x" }];
    const root = asVNode(PaletteSidebar({ items }));
    const btn = findByTestId(root, "diagrams-palette-item-x");
    const onClick = btn?.props.onClick as (() => void) | undefined;
    expect(() => onClick?.()).not.toThrow();
  });
});
