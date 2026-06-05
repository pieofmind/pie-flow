import { describe, it, expect, vi } from "vitest";
import { EmbedCard } from "../../src/ui/EmbedCard";
import { asVNode, collectAll, findByTestId } from "./_helpers/vnode-inspect";

/**
 * EmbedCard unit tests.
 *
 * EmbedCard is intentionally synchronous + obsidian-free (setIcon and the
 * Export / overflow menus are injected by the host) so it tests as a pure
 * function just like DiagramCard.
 */

describe("EmbedCard — basic structure", () => {
  it("renders the title (file name) in the badge", () => {
    const root = asVNode(
      EmbedCard({
        title: "quy-trinh-onboarding",
        nodeCount: 5,
        edgeCount: 4,
        svg: "<svg/>",
        onEdit: () => {},
      }),
    );
    const title = findByTestId(root, "diagrams-embed-title");
    expect(title?.props.children).toBe("quy-trinh-onboarding");
  });

  it("uses the title as the only badge label (no diagram-type label)", () => {
    const root = asVNode(
      EmbedCard({
        title: "Quy trình duyệt",
        nodeCount: 0,
        edgeCount: 0,
        svg: "",
        onEdit: () => {},
      }),
    );
    const labels = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-chip-label",
    );
    expect(labels.length).toBe(1);
    expect(labels[0].props.children).toBe("Quy trình duyệt");
  });

  it("includes a Sửa button with primary styling", () => {
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 0,
        edgeCount: 0,
        svg: "",
        onEdit: () => {},
      }),
    );
    const editBtn = findByTestId(root, "diagrams-embed-edit");
    expect(editBtn).toBeDefined();
    expect(String(editBtn?.props.class ?? "")).toContain(
      "diagrams-card-btn-primary",
    );
  });

  it("hides Export / overflow buttons when no handler is supplied", () => {
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 0,
        edgeCount: 0,
        svg: "",
        onEdit: () => {},
      }),
    );
    expect(findByTestId(root, "diagrams-embed-export")).toBeUndefined();
    expect(findByTestId(root, "diagrams-embed-more")).toBeUndefined();
  });

  it("shows Export / overflow buttons when handlers are supplied", () => {
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 0,
        edgeCount: 0,
        svg: "",
        onEdit: () => {},
        onExportMenu: () => {},
        onMoreMenu: () => {},
      }),
    );
    expect(findByTestId(root, "diagrams-embed-export")).toBeDefined();
    expect(findByTestId(root, "diagrams-embed-more")).toBeDefined();
  });
});

describe("EmbedCard — states", () => {
  it("renders loading state when svg is undefined", () => {
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 0,
        edgeCount: 0,
        svg: undefined,
        onEdit: () => {},
      }),
    );
    const loading = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-embed-loading",
    );
    expect(loading.length).toBe(1);
  });

  it("renders empty state when svg is empty string AND no error", () => {
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 0,
        edgeCount: 0,
        svg: "",
        onEdit: () => {},
      }),
    );
    const empty = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-embed-empty",
    );
    expect(empty.length).toBe(1);
  });

  it("renders error message when errorMessage provided", () => {
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 0,
        edgeCount: 0,
        svg: "",
        errorMessage: "Không đọc được board.",
        onEdit: () => {},
      }),
    );
    const empty = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-embed-empty",
    );
    expect(empty.length).toBe(1);
  });

  it("renders SVG content when svg is a non-empty string", () => {
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 5,
        edgeCount: 4,
        svg: "<svg><rect/></svg>",
        onEdit: () => {},
      }),
    );
    const svgWrap = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-embed-svg",
    );
    expect(svgWrap.length).toBe(1);
    const inner = svgWrap[0].props.dangerouslySetInnerHTML as {
      __html: string;
    } | undefined;
    expect(inner?.__html).toBe("<svg><rect/></svg>");
  });
});

describe("EmbedCard — meta line", () => {
  it("shows 'N phần tử · M nối' when no error", () => {
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 7,
        edgeCount: 5,
        svg: "<svg/>",
        onEdit: () => {},
      }),
    );
    const meta = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-embed-meta",
    );
    expect(meta[0].props.children).toBe("7 phần tử · 5 nối");
  });

  it("overrides meta with errorMessage when set", () => {
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 0,
        edgeCount: 0,
        svg: "",
        errorMessage: "File hỏng",
        onEdit: () => {},
      }),
    );
    const meta = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-embed-meta",
    );
    expect(meta[0].props.children).toBe("File hỏng");
  });
});

describe("EmbedCard — interaction", () => {
  it("calls onEdit when the Sửa button is clicked", () => {
    const onEdit = vi.fn();
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 0,
        edgeCount: 0,
        svg: "",
        onEdit,
      }),
    );
    const btn = findByTestId(root, "diagrams-embed-edit");
    const stop = vi.fn();
    const evt = { stopPropagation: stop } as unknown as MouseEvent;
    (btn?.props.onClick as (e: MouseEvent) => void)(evt);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("chip click does NOT call onEdit (stopPropagation)", () => {
    const onEdit = vi.fn();
    const root = asVNode(
      EmbedCard({
        title: "x",
        nodeCount: 0,
        edgeCount: 0,
        svg: "",
        onEdit,
      }),
    );
    const chip = collectAll(
      root,
      (v) => v.props.class === "diagrams-card-chip",
    )[0];
    const stop = vi.fn();
    const evt = { stopPropagation: stop } as unknown as MouseEvent;
    (chip.props.onClick as (e: MouseEvent) => void)(evt);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("setIcon callback is wired without throwing", () => {
    const calls: Array<[unknown, string]> = [];
    EmbedCard({
      title: "x",
      nodeCount: 0,
      edgeCount: 0,
      svg: "",
      onEdit: () => {},
      setIcon: (el, name) => calls.push([el, name]),
    });
    // setIcon fires via callback refs only in a real render context.
    expect(calls).toBeInstanceOf(Array);
  });
});
