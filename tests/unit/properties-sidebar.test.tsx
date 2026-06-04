import { describe, it, expect } from "vitest";
import { PropertiesSidebar } from "../../src/ui/PropertiesSidebar";
import type { PropertyFieldSchema } from "../../src/core/sidebarSchema";
import {
  asVNode,
  collectAll,
  findByTestId,
} from "./_helpers/vnode-inspect";

describe("PropertiesSidebar — AC3 header", () => {
  it("renders the section title and subtitle chip when both provided", () => {
    const root = asVNode(
      PropertiesSidebar({
        sectionTitle: "Diagram",
        sectionSubtitle: "bpmn",
        fields: [],
      }),
    );
    const header = findByTestId(root, "diagrams-properties-header");
    expect(header).toBeDefined();
    const titleSpans = collectAll(
      root,
      (v) => v.props.class === "diagrams-properties-title",
    );
    const subtitleSpans = collectAll(
      root,
      (v) => v.props.class === "diagrams-properties-subtitle",
    );
    expect(titleSpans.length).toBe(1);
    expect(subtitleSpans.length).toBe(1);
  });

  it("omits the header entirely when sectionTitle is undefined", () => {
    const root = asVNode(PropertiesSidebar({ fields: [] }));
    const header = findByTestId(root, "diagrams-properties-header");
    expect(header).toBeUndefined();
  });

  it("renders BOTH header AND empty state when sectionTitle is set but fields=[]", () => {
    // Common real-world case: a node is selected but the adapter hasn't
    // wired any property fields yet (Stories 7-3 / 7-8). The header
    // identifies the selection while the body shows the empty-state copy.
    const root = asVNode(
      PropertiesSidebar({
        sectionTitle: "Lane",
        sectionSubtitle: "bpmn",
        fields: [],
      }),
    );
    expect(findByTestId(root, "diagrams-properties-header")).toBeDefined();
    expect(findByTestId(root, "diagrams-properties-empty")).toBeDefined();
  });
});

describe("PropertiesSidebar — AC3 empty state", () => {
  it("renders default empty state copy when fields=[]", () => {
    const root = asVNode(PropertiesSidebar({ fields: [] }));
    const empty = findByTestId(root, "diagrams-properties-empty");
    expect(empty).toBeDefined();
    expect(empty?.props.children).toContain("Chọn một phần tử");
  });

  it("renders custom empty state copy when emptyStateText provided", () => {
    const root = asVNode(
      PropertiesSidebar({
        fields: [],
        emptyStateText: "Nothing here yet.",
      }),
    );
    const empty = findByTestId(root, "diagrams-properties-empty");
    expect(empty?.props.children).toBe("Nothing here yet.");
  });

  it("renders body (not empty state) when fields has entries", () => {
    const fields: PropertyFieldSchema[] = [
      { kind: "text", key: "title", label: "Tiêu đề", value: "X" },
    ];
    const root = asVNode(PropertiesSidebar({ fields }));
    expect(findByTestId(root, "diagrams-properties-body")).toBeDefined();
    expect(findByTestId(root, "diagrams-properties-empty")).toBeUndefined();
  });
});

describe("PropertiesSidebar — AC3 text field", () => {
  it("renders an <input type='text'> with the value and placeholder", () => {
    const fields: PropertyFieldSchema[] = [
      {
        kind: "text",
        key: "title",
        label: "Tiêu đề",
        value: "Quy trình",
        placeholder: "Nhập tiêu đề",
      },
    ];
    const root = asVNode(PropertiesSidebar({ fields }));
    const field = findByTestId(root, "diagrams-properties-field-title");
    expect(field).toBeDefined();
    const inputs = collectAll(root, (v) => v.type === "input");
    expect(inputs.length).toBe(1);
    expect(inputs[0].props.value).toBe("Quy trình");
    expect(inputs[0].props.placeholder).toBe("Nhập tiêu đề");
  });

  it("calls onChange with the new value on input", () => {
    let captured = "";
    const fields: PropertyFieldSchema[] = [
      {
        kind: "text",
        key: "title",
        label: "Tiêu đề",
        value: "",
        onChange: (v) => {
          captured = v;
        },
      },
    ];
    const root = asVNode(PropertiesSidebar({ fields }));
    const inputs = collectAll(root, (v) => v.type === "input");
    const onInput = inputs[0].props.onInput as ((e: unknown) => void) | undefined;
    expect(typeof onInput).toBe("function");
    // Simulate a typed event with currentTarget.value
    onInput?.({ currentTarget: { value: "Hello" } });
    expect(captured).toBe("Hello");
  });
});

describe("PropertiesSidebar — AC3 select field", () => {
  it("renders segmented buttons when options.length <= 3", () => {
    const fields: PropertyFieldSchema[] = [
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
    ];
    const root = asVNode(PropertiesSidebar({ fields }));
    const segments = collectAll(
      root,
      (v) => String(v.props.class ?? "").includes("diagrams-properties-segment") &&
            v.type === "button",
    );
    expect(segments.length).toBe(2);
    // The active segment must contain the active modifier class
    const activeSegments = segments.filter((s) =>
      String(s.props.class ?? "").includes("diagrams-properties-segment-active"),
    );
    expect(activeSegments.length).toBe(1);
  });

  it("renders segmented buttons at the EXACT boundary (options.length === 3)", () => {
    // Pin the `<=` semantics — a future careless `<` swap would silently
    // convert 3-option fields into dropdowns, breaking the design contract.
    const fields: PropertyFieldSchema[] = [
      {
        kind: "select",
        key: "size",
        label: "Size",
        value: "M",
        options: [
          { value: "S", label: "S" },
          { value: "M", label: "M" },
          { value: "L", label: "L" },
        ],
      },
    ];
    const root = asVNode(PropertiesSidebar({ fields }));
    const segments = collectAll(
      root,
      (v) =>
        String(v.props.class ?? "").includes("diagrams-properties-segment") &&
        v.type === "button",
    );
    expect(segments.length).toBe(3);
    // And NO dropdown
    expect(collectAll(root, (v) => v.type === "select").length).toBe(0);
  });

  it("renders a <select> dropdown when options.length > 3", () => {
    const fields: PropertyFieldSchema[] = [
      {
        kind: "select",
        key: "style",
        label: "Style",
        value: "a",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
          { value: "d", label: "D" },
        ],
      },
    ];
    const root = asVNode(PropertiesSidebar({ fields }));
    const selects = collectAll(root, (v) => v.type === "select");
    expect(selects.length).toBe(1);
    expect(selects[0].props.value).toBe("a");
  });

  it("segmented button click calls onChange with the option value", () => {
    let captured = "";
    const fields: PropertyFieldSchema[] = [
      {
        kind: "select",
        key: "dir",
        label: "Hướng",
        value: "LR",
        options: [
          { value: "LR", label: "LR" },
          { value: "TB", label: "TB" },
        ],
        onChange: (v) => {
          captured = v;
        },
      },
    ];
    const root = asVNode(PropertiesSidebar({ fields }));
    const segments = collectAll(
      root,
      (v) =>
        v.type === "button" &&
        String(v.props.class ?? "").includes("diagrams-properties-segment"),
    );
    // Click the "TB" segment (index 1)
    const onClick = segments[1].props.onClick as (() => void) | undefined;
    onClick?.();
    expect(captured).toBe("TB");
  });
});

describe("PropertiesSidebar — AC3 toggle field", () => {
  it("renders a switch with aria-checked reflecting value", () => {
    const fieldsOn: PropertyFieldSchema[] = [
      { kind: "toggle", key: "snap", label: "Snap", value: true },
    ];
    const fieldsOff: PropertyFieldSchema[] = [
      { kind: "toggle", key: "snap", label: "Snap", value: false },
    ];
    const rootOn = asVNode(PropertiesSidebar({ fields: fieldsOn }));
    const rootOff = asVNode(PropertiesSidebar({ fields: fieldsOff }));

    const switches = (root: typeof rootOn) =>
      collectAll(root, (v) => v.type === "button" && v.props["role"] === "switch");

    expect(switches(rootOn)[0].props["aria-checked"]).toBe(true);
    expect(switches(rootOff)[0].props["aria-checked"]).toBe(false);
    // The "on" switch should have the modifier class
    expect(String(switches(rootOn)[0].props.class ?? "")).toContain(
      "diagrams-properties-toggle-on",
    );
    expect(String(switches(rootOff)[0].props.class ?? "")).not.toContain(
      "diagrams-properties-toggle-on",
    );
  });

  it("click toggles the value via onChange(!value)", () => {
    let captured: boolean | null = null;
    const fields: PropertyFieldSchema[] = [
      {
        kind: "toggle",
        key: "snap",
        label: "Snap",
        value: false,
        onChange: (v) => {
          captured = v;
        },
      },
    ];
    const root = asVNode(PropertiesSidebar({ fields }));
    const sw = collectAll(
      root,
      (v) => v.type === "button" && v.props["role"] === "switch",
    )[0];
    const onClick = sw.props.onClick as (() => void) | undefined;
    onClick?.();
    expect(captured).toBe(true); // flipped from false → true
  });
});
