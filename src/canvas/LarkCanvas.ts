import { Graph, Node, Edge } from "@antv/x6";
import { Selection } from "@antv/x6-plugin-selection";
import { Clipboard } from "@antv/x6-plugin-clipboard";
import { History } from "@antv/x6-plugin-history";
import { Keyboard } from "@antv/x6-plugin-keyboard";
import { Snapline } from "@antv/x6-plugin-snapline";
import { Transform } from "@antv/x6-plugin-transform";
import type { PaletteItem, ShapeCategory, CanvasModel } from "./types";
import { shapeIcon } from "./shapes/index";
import { nodeHtml, defaultErdCols, defaultUml, type NodeStyle, type NodeExtra, type ErdCol } from "./htmlNode";
import { collectPluginCss } from "./staticRender";
import * as dagre from "@dagrejs/dagre";

export type { PaletteItem, ShapeCategory, CanvasModel };

// Pie "Warm AI Productivity" palette (DESIGN.md): soft tints row + brand/accent row.
// Row 1 = transparent + light surfaces/tints; Row 2 = brand cores + saturated extras.
const FILL_SWATCHES = [
  "transparent", "#FFFFFF", "#FFF4DE", "#9ED6F5", "#D6EFE0", "#FFF3BF", "#F6DADA", "#ECE0F5",
  "#3B1F1A", "#5E8FB9", "#9ED6F5", "#34A853", "#FFD966", "#FF8800", "#7A2E2E", "#E5484D", "#8E51FF", "#86909C",
];
const FONT_SIZES = [12, 14, 16, 18, 24, 32];

// ── Color helpers for the HSV picker ──
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

const SMART_ROUTER = { name: "manhattan", args: { padding: 16 } };
const CONNECTOR = { name: "rounded", args: { radius: 10 } };

// Sequence message: ignore X6 routing — emit a single horizontal line at the
// source point's Y. The target Y is forced down to source Y so the arrow stays
// straight regardless of where the user dropped on the target lifeline.
let SEQ_CONNECTOR_REGISTERED = false;
function ensureSeqConnector(): void {
  if (SEQ_CONNECTOR_REGISTERED) return;
  Graph.registerConnector(
    "seq-msg",
    function (this: unknown, sourcePoint: { x: number; y: number }, targetPoint: { x: number; y: number }, _routePoints: unknown, _args: unknown, view?: { cell?: { getData?: () => { y?: number } | undefined } }): string {
      const yOverride = view?.cell?.getData?.()?.y;
      const y = typeof yOverride === "number" ? yOverride : sourcePoint.y;
      return `M ${sourcePoint.x} ${y} L ${targetPoint.x} ${y}`;
    },
    true,
  );
  SEQ_CONNECTOR_REGISTERED = true;
}

const SEQ_LIFELINE_KINDS = new Set(["sq-actor", "sq-participant"]);
const MM_KINDS = new Set(["mm-root", "mm-branch", "mm-leaf"]);

// Mindmap edge: smooth cubic bezier between source and target — matches the Pie
// design's organic tree look (no manhattan 90° turns).
let MM_CONNECTOR_REGISTERED = false;
function ensureMindmapConnector(): void {
  if (MM_CONNECTOR_REGISTERED) return;
  Graph.registerConnector(
    "mm-edge",
    (sourcePoint: { x: number; y: number }, targetPoint: { x: number; y: number }): string => {
      const dx = (targetPoint.x - sourcePoint.x) * 0.55;
      const c1x = sourcePoint.x + dx, c1y = sourcePoint.y;
      const c2x = targetPoint.x - dx, c2y = targetPoint.y;
      return `M ${sourcePoint.x} ${sourcePoint.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${targetPoint.x} ${targetPoint.y}`;
    },
    true,
  );
  MM_CONNECTOR_REGISTERED = true;
}

const ACCENT = "#5E8FB9";
const EDGE_STROKE = "#9c8b7e"; // warm muted brown-grey
const CURSOR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7 16 2-6 6-2z"/></svg>`;
const EDGE_ATTRS = { line: { stroke: EDGE_STROKE, strokeWidth: 1.8, targetMarker: { name: "block", width: 11, height: 8 } } };
// Edge label body — opaque pill so the label is hit-testable (X6 needs a body
// for the user to grab and drag); also wipes the line behind the text.
const EDGE_LABEL_BODY = { ref: "label", refX: -6, refY: -2, refWidth: "100%", refHeight: "100%", refWidth2: 12, refHeight2: 4, fill: "var(--pg-surface)", stroke: "none", rx: 4, ry: 4, cursor: "move" } as const;
const EDGE_LABEL_TEXT = { fill: "var(--pg-text)", fontSize: 12, fontFamily: "var(--font-body)", cursor: "move" } as const;

// ── Edge styling (relationship types) ──
export interface EdgeStyle { stroke?: string; width?: number; dash?: string; start?: string; end?: string; shape?: string; textAngle?: number; jump?: string }
const EDGE_DASHES: Record<string, string> = { solid: "", dashed: "6 4", dotted: "2 4" };
type SpawnDir = "top" | "right" | "bottom" | "left";
const ACT_WIDTH = 12; // fixed width of the sequence activation bar
// Container/frame shapes that should render behind regular nodes.
const FRAME_KINDS = new Set<string>([
  "sq-frag-alt", "sq-frag-opt", "sq-frag-loop", "sq-frag-par",
  "bpmn-subprocess", "bpmn-lane", "bpmn-pool", "bpmn-annotation",
]);
// Container shapes whose bbox should hug their children after auto-layout.
// (annotation = sticky note, NOT a container — stays as a normal node.)
const CONTAINER_KINDS = new Set<string>([
  "sq-frag-alt", "sq-frag-opt", "sq-frag-loop", "sq-frag-par",
  "bpmn-subprocess", "bpmn-lane", "bpmn-pool",
]);
// Full arrowhead set for BOTH ends (flowchart + UML/ERD relationships).
function buildMarker(kind: string | undefined, color: string): Record<string, unknown> | null {
  switch (kind) {
    case "arrow": return { name: "block", width: 12, height: 9, fill: color };                       // mũi tên đặc
    case "arrow-open": return { name: "path", d: "M 14 -7 0 0 14 7", fill: "none", stroke: color, "stroke-width": 1.8 }; // mũi tên hở
    case "triangle": return { name: "block", width: 18, height: 15, fill: "#fff", stroke: color, "stroke-width": 1.5 }; // tam giác rỗng (kế thừa)
    case "triangle-f": return { name: "block", width: 18, height: 15, fill: color };                 // tam giác đặc
    case "diamond": return { name: "diamond", width: 18, height: 11, fill: color };                  // thoi đặc (composition)
    case "diamond-o": return { name: "diamond", width: 18, height: 11, fill: "#fff", stroke: color, "stroke-width": 1.5 }; // thoi rỗng (aggregation)
    case "circle": return { name: "circle", r: 4.5, fill: "#fff", stroke: color, "stroke-width": 1.5 }; // tròn rỗng
    case "circle-f": return { name: "circle", r: 4.5, fill: color };                                 // tròn đặc
    // ERD crow's foot — single path (fan / bar / combos). Base toward node at x=0.
    case "crow": return { name: "path", d: "M14 -8 0 0 14 8 M14 0 0 0", fill: "none", stroke: color, "stroke-width": 1.5 };       // many (n)
    case "bar": return { name: "path", d: "M6 -8 6 8", fill: "none", stroke: color, "stroke-width": 1.5 };                         // one (1)
    case "crow-bar": return { name: "path", d: "M16 -8 2 0 16 8 M16 0 2 0 M14 -8 14 8", fill: "none", stroke: color, "stroke-width": 1.5 }; // one-or-many (1..n)
    case "bar-bar": return { name: "path", d: "M5 -8 5 8 M10 -8 10 8", fill: "none", stroke: color, "stroke-width": 1.5 };          // exactly one (1,1)
    case "none": default: return null;
  }
}
const EDGE_MARKER_KINDS = ["none", "arrow", "arrow-open", "triangle", "triangle-f", "diamond", "diamond-o", "circle", "circle-f", "crow", "bar", "crow-bar", "bar-bar"] as const;
const EDGE_MARKER_LABEL: Record<string, string> = {
  none: "Không", arrow: "Mũi tên", "arrow-open": "Mũi tên hở", triangle: "Tam giác rỗng",
  "triangle-f": "Tam giác đặc", diamond: "Thoi đặc", "diamond-o": "Thoi rỗng", circle: "Tròn rỗng", "circle-f": "Tròn đặc",
  crow: "Crow nhiều (n)", bar: "Một (1)", "crow-bar": "Một-hoặc-nhiều (1..n)", "bar-bar": "Đúng một (1,1)",
};
const EDGE_WIDTHS = [1.4, 2.4, 3.6];
// Line shape presets → router + connector.
const EDGE_SHAPES: Record<string, { router: unknown; connector: unknown }> = {
  orthogonal: { router: { name: "manhattan", args: { padding: 16 } }, connector: { name: "rounded", args: { radius: 10 } } },
  elbow: { router: { name: "manhattan", args: { padding: 16 } }, connector: { name: "normal" } },
  straight: { router: { name: "normal" }, connector: { name: "normal" } },
  curved: { router: { name: "normal" }, connector: { name: "smooth" } },
};
// Line-crossing jumps (X6 native jumpover connector — no manual intersection math).
const EDGE_JUMPS: Record<string, "none" | "arc" | "gap" | "cubic"> = { none: "none", arc: "arc", gap: "gap" };

export class LarkCanvas {
  private graph: Graph;
  private root: HTMLElement;
  private graphMount: HTMLElement;
  private contextBar: HTMLElement;
  private edgeBar: HTMLElement | null = null;
  private popupLayer: HTMLElement;
  private categories: ShapeCategory[];
  private onChange: () => void;
  private labelInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  private propsBody: HTMLElement | null = null;
  private propsPanel: HTMLElement | null = null;
  private propsFab: HTMLElement | null = null;
  private zoomLabel: HTMLElement | null = null;
  private minimap: HTMLElement | null = null;
  private minimapSvg: SVGSVGElement | null = null;
  private minimapVp: HTMLElement | null = null;
  private mm = { scale: 1, ox: 0, oy: 0, bx: 0, by: 0 }; // minimap↔graph mapping
  private wheelPan?: (e: WheelEvent) => void;
  private mmFabs: HTMLElement | null = null;
  private padLayer: HTMLElement | null = null;
  private pendingDrop: Edge | null = null; // dangling edge awaiting a shape pick (drag-to-blank)
  private lastSelectedAt = new Map<string, number>(); // when each node became selected (for click-to-edit)
  private flyout: HTMLElement | null = null;
  private flyoutTimer: number | null = null;

  constructor(root: HTMLElement, categories: ShapeCategory[], onChange: () => void) {
    this.root = root;
    this.categories = categories;
    this.onChange = onChange;
    this.root.classList.add("lk-root");

    this.graphMount = el("div", "lk-graph-mount");
    this.root.appendChild(this.graphMount);

    ensureSeqConnector();
    ensureMindmapConnector();
    this.graph = this.initGraph();
    this.buildLeftToolbar();
    this.buildBottomControls();
    this.buildPropsPanel();
    this.buildCanvasHelp();
    this.buildMinimap();

    this.contextBar = el("div", "lk-context-bar");
    this.contextBar.style.display = "none";
    this.root.appendChild(this.contextBar);

    this.edgeBar = el("div", "lk-context-bar lk-edge-bar");
    this.edgeBar.style.display = "none";
    this.root.appendChild(this.edgeBar);

    this.mmFabs = el("div", "lk-mm-fabs");
    this.mmFabs.style.display = "none";
    this.root.appendChild(this.mmFabs);

    // Smart context pad: directional "+" handles around a selected (non-mindmap)
    // node to spawn a connected next node (reuses the mm-fab look).
    this.padLayer = el("div", "lk-mm-fabs lk-pad-layer");
    this.padLayer.style.display = "none";
    this.root.appendChild(this.padLayer);

    this.popupLayer = el("div", "lk-popup-layer");
    this.popupLayer.style.display = "none";
    this.root.appendChild(this.popupLayer);

    this.bindEvents();
    this.enableTrackpadPan();
    this.enableLabelDrag();
    this.enableInlineLabelEdit();
    this.refreshProps();
  }

  // ── Graph ──────────────────────────────────────────────────────────────
  private initGraph(): Graph {
    const graph = new Graph({
      container: this.graphMount,
      autoResize: true,
      panning: { enabled: true, modifiers: ["space"] },
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], zoomAtMousePosition: true },
      // Allow user to drag edge labels (bpmn.io behaviour — avoid label overlap on busy intersections).
      interacting: { edgeLabelMovable: true },
      grid: { visible: true, type: "dot", size: 22, args: { color: "#d4d0c8", thickness: 2 } },
      background: { color: "transparent" },
      connecting: {
        snap: { radius: 28 },
        allowBlank: true,    // drop on empty canvas → Larksuite-style "pick shape" picker
        allowLoop: false,    // no self-loops
        allowNode: true,     // drop anywhere on a target node (not only its port)
        allowEdge: false,
        allowMulti: true,
        highlight: true,
        router: SMART_ROUTER, connector: CONNECTOR,
        createEdge() { return this.createEdge({ attrs: EDGE_ATTRS }); },
        // Accept a drop on any other node — target ports are hidden, so requiring
        // a magnet made connections fail. Snap/router still pick a clean endpoint.
        // Also accept a drop on EMPTY canvas (no targetCell) so allowBlank fires
        // edge:connected → we then show the "Chèn hình" picker (Larksuite-style).
        validateConnection: ({ sourceCell, targetCell }) =>
          !targetCell || (targetCell.isNode() && sourceCell !== targetCell),
      },
      highlighting: {
        magnetAdsorbed: { name: "stroke", args: { attrs: { fill: "#fff", stroke: ACCENT } } },
      },
    });

    graph.use(new Selection({ rubberband: true, showNodeSelectionBox: true, pointerEvents: "none" }));
    graph.use(new History());
    graph.use(new Keyboard());
    graph.use(new Snapline({ enabled: true }));
    graph.use(new Transform({ resizing: { enabled: true, minWidth: 24, minHeight: 24 }, rotating: false }));
    graph.use(new Clipboard({ useLocalStorage: true })); // Cmd/Ctrl+C/V/X — survives reload

    graph.bindKey(["backspace", "delete"], () => {
      const cells = graph.getSelectedCells();
      if (cells.length) graph.removeCells(cells);
    });
    graph.bindKey(["ctrl+z", "cmd+z"], () => graph.canUndo() && graph.undo());
    graph.bindKey(["ctrl+shift+z", "cmd+shift+z"], () => graph.canRedo() && graph.redo());
    graph.bindKey(["ctrl+d", "cmd+d"], () => { this.duplicateSelection(); return false; });
    graph.bindKey(["ctrl+a", "cmd+a"], () => { graph.resetSelection(graph.getCells()); return false; });
    // Clipboard: copy / cut / paste (paste offsets +24 so it doesn't sit on top).
    graph.bindKey(["ctrl+c", "cmd+c"], () => {
      const cells = graph.getSelectedCells();
      if (cells.length) graph.copy(cells);
      return false;
    });
    graph.bindKey(["ctrl+x", "cmd+x"], () => {
      const cells = graph.getSelectedCells();
      if (cells.length) graph.cut(cells);
      return false;
    });
    graph.bindKey(["ctrl+v", "cmd+v"], () => {
      if (graph.isClipboardEmpty()) return false;
      const pasted = graph.paste({ offset: 24 });
      if (pasted.length) graph.resetSelection(pasted);
      return false;
    });
    graph.bindKey("esc", () => { this.hidePopup(); this.commitLabel(); graph.cleanSelection(); });

    // Mindmap quick-add via keyboard — only when a mindmap node is selected.
    graph.bindKey("tab", () => {
      const n = this.singleSelectedMindmapNode();
      if (!n) return;
      const side = this.nodeKind(n) === "mm-root" ? "right" : this.mindmapOutwardSide(n);
      this.addMindmapChild(n, side);
      return false;
    });
    graph.bindKey("enter", () => {
      const n = this.singleSelectedMindmapNode();
      if (!n) return;
      const k = this.nodeKind(n);
      if (k === "mm-root") return;
      this.addMindmapSiblingDir(n, "below");
      return false;
    });

    return graph;
  }

  private singleSelectedMindmapNode(): Node | null {
    if (this.labelInput) return null;
    const sel = this.graph.getSelectedCells();
    if (sel.length !== 1 || !sel[0].isNode()) return null;
    const n = sel[0] as Node;
    const k = this.nodeKind(n);
    return k === "mm-root" || k === "mm-branch" || k === "mm-leaf" ? n : null;
  }

  /** Defaults for a new mindmap node by its kind. */
  private mindmapDefaults(kind: "mm-root" | "mm-branch" | "mm-leaf"): { w: number; h: number; label: string } {
    if (kind === "mm-root")   return { w: 180, h: 50, label: "Trung tâm" };
    if (kind === "mm-branch") return { w: 150, h: 42, label: "Nhánh" };
    return { w: 130, h: 36, label: "Lá" };
  }

  /** Spawn a child node on the requested side of `parent` and connect with an edge. */
  private addMindmapChild(parent: Node, side: "left" | "right" = "right"): void {
    const pk = this.nodeKind(parent);
    const childKind: "mm-root" | "mm-branch" | "mm-leaf" =
      pk === "mm-root" ? "mm-branch" : "mm-leaf";
    const def = this.mindmapDefaults(childKind);
    const p = parent.getPosition(); const s = parent.getSize();
    const gap = 80;
    // Stack new children below existing children ON THE SAME SIDE so the two
    // sides of a root grow independently and don't collide.
    const onSide = (cx: number) => side === "right" ? cx >= p.x + s.width / 2 : cx < p.x + s.width / 2;
    const existingChildren = this.graph.getEdges()
      .filter((e) => e.getSourceCellId() === parent.id)
      .map((e) => this.graph.getCellById(e.getTargetCellId() ?? "")).filter((c): c is Node => !!c && c.isNode())
      .filter((c) => onSide(c.getPosition().x + c.getSize().width / 2));
    const baseY = p.y + s.height / 2 - def.h / 2;
    const stackY = existingChildren.length
      ? Math.max(...existingChildren.map((c) => c.getPosition().y + c.getSize().height)) + 14
      : baseY;
    const childX = side === "right" ? p.x + s.width + gap : p.x - gap - def.w;
    // Don't inherit parent style — keep the design default accent for every node.
    const child = this.addHtmlNode(childKind, childX, stackY, def.w, def.h, def.label);
    const edge = this.graph.addEdge({
      source: { cell: parent.id }, target: { cell: child.id },
      router: "normal", connector: "mm-edge", attrs: EDGE_ATTRS,
    });
    this.applyMindmapRoutingIfNeeded(edge); // anchor right/left ports
    this.graph.resetSelection([child]);
    this.editLabel(child);
  }

  /** Returns "left" or "right" based on where the parent of `node` sits. Defaults to right when no parent. */
  private mindmapOutwardSide(node: Node): "left" | "right" {
    const incoming = this.graph.getEdges().find((e) => e.getTargetCellId() === node.id);
    const parentId = incoming?.getSourceCellId();
    if (!parentId) return "right";
    const parent = this.graph.getCellById(parentId);
    if (!parent || !parent.isNode()) return "right";
    const pn = parent as Node;
    const pc = pn.getPosition().x + pn.getSize().width / 2;
    const nc = node.getPosition().x + node.getSize().width / 2;
    return nc >= pc ? "right" : "left";
  }

  /** Spawn a sibling above or below the selected node. */
  private addMindmapSiblingDir(node: Node, dir: "above" | "below"): void {
    const kind = this.nodeKind(node) as "mm-branch" | "mm-leaf";
    const def = this.mindmapDefaults(kind);
    const p = node.getPosition(); const s = node.getSize();
    const newY = dir === "below" ? p.y + s.height + 14 : p.y - def.h - 14;
    // Don't inherit style — siblings keep the design default accent.
    const sibling = this.addHtmlNode(kind, p.x, newY, def.w, def.h, def.label);
    const incoming = this.graph.getEdges().find((e) => e.getTargetCellId() === node.id);
    const parentId = incoming?.getSourceCellId();
    if (parentId) {
      const edge = this.graph.addEdge({
        source: { cell: parentId }, target: { cell: sibling.id },
        router: "normal", connector: "mm-edge", attrs: EDGE_ATTRS,
      });
      this.applyMindmapRoutingIfNeeded(edge); // anchor right/left ports
    }
    this.graph.resetSelection([sibling]);
    this.editLabel(sibling);
  }

  /** Shortcut wrapper for Enter (sibling below). */
  private addMindmapSibling(node: Node): void { this.addMindmapSiblingDir(node, "below"); }

  /** Position 2 or 3 floating "+" buttons around the selected mindmap node. */
  private refreshMindmapFabs(): void {
    if (!this.mmFabs) return;
    this.mmFabs.innerHTML = "";
    const sel = this.graph.getSelectedCells();
    if (sel.length !== 1 || !sel[0].isNode()) { this.mmFabs.style.display = "none"; return; }
    const node = sel[0] as Node;
    const kind = this.nodeKind(node);
    if (kind !== "mm-root" && kind !== "mm-branch" && kind !== "mm-leaf") {
      this.mmFabs.style.display = "none"; return;
    }
    const bbox = node.getBBox(); const sc = this.graph.scale().sx; const tr = this.graph.translate();
    const left = bbox.x * sc + tr.tx;
    const top = bbox.y * sc + tr.ty;
    const w = bbox.width * sc;
    const h = bbox.height * sc;

    const mkFab = (cls: string, x: number, y: number, title: string, fn: () => void) => {
      const b = el("button", `lk-mm-fab ${cls}`, "+");
      b.title = title;
      b.style.left = x + "px"; b.style.top = y + "px";
      b.onmousedown = (e) => e.stopPropagation();
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      this.mmFabs!.appendChild(b);
    };

    const gap = 30; // gap from node edge to button center
    const midY = top + h / 2;
    const midX = left + w / 2;

    if (kind === "mm-root") {
      // 2 buttons: left + right
      mkFab("lk-mm-fab-l", left - gap, midY, "Thêm nhánh trái", () => this.addMindmapChild(node, "left"));
      mkFab("lk-mm-fab-r", left + w + gap, midY, "Thêm nhánh phải", () => this.addMindmapChild(node, "right"));
    } else {
      // 3 buttons: outward + top sibling + bottom sibling
      const out = this.mindmapOutwardSide(node);
      if (out === "right") {
        mkFab("lk-mm-fab-r", left + w + gap, midY, "Thêm con", () => this.addMindmapChild(node, "right"));
      } else {
        mkFab("lk-mm-fab-l", left - gap, midY, "Thêm con", () => this.addMindmapChild(node, "left"));
      }
      mkFab("lk-mm-fab-t", midX, top - gap, "Thêm anh em phía trên", () => this.addMindmapSiblingDir(node, "above"));
      mkFab("lk-mm-fab-b", midX, top + h + gap, "Thêm anh em phía dưới", () => this.addMindmapSiblingDir(node, "below"));
    }
    this.mmFabs.style.display = "block";
  }

  // ── Smart context pad (F1): directional spawn of a connected next node ──────
  /** Show 4 directional "+" handles around the single selected non-mindmap node. */
  private refreshContextPad(): void {
    if (!this.padLayer) return;
    this.padLayer.innerHTML = "";
    const sel = this.graph.getSelectedCells();
    if (sel.length !== 1 || !sel[0].isNode()) { this.padLayer.style.display = "none"; return; }
    const node = sel[0] as Node;
    if (this.nodeKind(node).startsWith("mm-")) { this.padLayer.style.display = "none"; return; } // mindmap uses its own fabs
    const bbox = node.getBBox(); const sc = this.graph.scale().sx; const tr = this.graph.translate();
    const left = bbox.x * sc + tr.tx, top = bbox.y * sc + tr.ty, w = bbox.width * sc, h = bbox.height * sc;
    const midX = left + w / 2, midY = top + h / 2;
    const rw = this.root.clientWidth, rh = this.root.clientHeight;
    const gap = 24;
    const mk = (dir: SpawnDir, x: number, y: number, title: string) => {
      if (x < 14 || x > rw - 14 || y < 14 || y > rh - 14) return; // hide near canvas edge
      const b = el("button", "lk-mm-fab lk-pad-fab", "+");
      b.title = title; b.style.left = x + "px"; b.style.top = y + "px";
      b.onmousedown = (e) => e.stopPropagation();
      b.onclick = (e) => { e.stopPropagation(); this.openSpawnFlyout(node, dir, b); };
      this.padLayer!.appendChild(b);
    };
    mk("top", midX, top - gap, "Thêm node phía trên");
    mk("right", left + w + gap, midY, "Thêm node bên phải");
    mk("bottom", midX, top + h + gap, "Thêm node phía dưới");
    mk("left", left - gap, midY, "Thêm node bên trái");
    this.padLayer.style.display = "block";
  }

  /** Shared "Insert shape" grid (skips mindmap kinds). */
  private buildShapeGrid(onPick: (item: PaletteItem) => void, onlyCats?: string[]): HTMLElement {
    const grid = el("div", "lk-shape-grid");
    for (const cat of this.categories) {
      if (onlyCats && !onlyCats.includes(cat.title)) continue;
      for (const item of cat.items) {
        if (item.shape.startsWith("mm-")) continue; // mindmap has its own flow
        const cell = el("div", "lk-shape-cell", shapeIcon(item.shape));
        cell.title = item.label;
        cell.onclick = () => onPick(item);
        grid.appendChild(cell);
      }
    }
    return grid;
  }

  /** Click a directional handle → pick a shape → spawn it connected in that direction. */
  /** Map source-node kind → palette categories to show (Basic + same diagram type). */
  private categoriesFor(node: Node): string[] {
    const k = this.nodeKind(node);
    if (k.startsWith("bpmn-")) return ["Cơ bản", "BPMN"];
    if (k.startsWith("erd-"))  return ["Cơ bản", "ERD"];
    if (k.startsWith("uml-"))  return ["Cơ bản", "UML"];
    if (k.startsWith("st-"))   return ["Cơ bản", "State"];
    if (k.startsWith("sq-"))   return ["Cơ bản", "Sequence"];
    // Flowchart and basic shapes default to Basic + Flowchart.
    return ["Cơ bản", "Flowchart"];
  }

  private openSpawnFlyout(source: Node, dir: SpawnDir, anchor: HTMLElement): void {
    this.showPopup(this.buildShapeGrid(
      (item) => { this.spawnConnectedNode(source, dir, item); this.hidePopup(); },
      this.categoriesFor(source),
    ), anchor);
  }

  /** Drag an arrow onto empty canvas → pick a shape at the drop point, connect it. */
  private handleDragToBlank(edge: Edge): void {
    const srcId = edge.getSourceCellId();
    const src = srcId ? this.graph.getCellById(srcId) : null;
    if (!src || !src.isNode()) { edge.remove(); return; }
    const pt = edge.getTargetPoint(); // graph coords of the drop
    this.pendingDrop = edge;          // removed on dismiss unless a shape is picked
    const wrap = el("div", "lk-shape-popup");
    wrap.appendChild(el("div", "lk-flyout-title", "Chèn hình"));
    wrap.appendChild(this.buildShapeGrid((item) => {
      this.pendingDrop = null;        // resolved — keep the edge
      const created = this.addHtmlNode(item.shape, pt.x - item.w / 2, pt.y - item.h / 2, item.w, item.h, "");
      edge.setTarget({ cell: created.id }); // X6 picks the closest port
      edge.setData({ ...(edge.getData() as object) });
      this.applyMindmapRoutingIfNeeded(edge); this.applySeqRoutingIfNeeded(edge);
      this.hidePopup();
      this.graph.resetSelection([created]);
      this.editLabel(created);
      this.onChange();
    }, this.categoriesFor(src as Node))); // picker = basic + same diagram type as source
    const sc = this.graph.scale().sx; const tr = this.graph.translate();
    this.showPopupAt(wrap, pt.x * sc + tr.tx, pt.y * sc + tr.ty);
  }

  /** Show the popup layer at a root-relative point (clamped into view). */
  private showPopupAt(content: HTMLElement, x: number, y: number): void {
    this.popupLayer.innerHTML = "";
    this.popupLayer.appendChild(content);
    this.popupLayer.style.display = "block";
    const rw = this.root.clientWidth, rh = this.root.clientHeight;
    const pw = this.popupLayer.offsetWidth || 240, ph = this.popupLayer.offsetHeight || 280;
    this.popupLayer.style.left = Math.max(8, Math.min(x, rw - pw - 8)) + "px";
    this.popupLayer.style.top = Math.max(8, Math.min(y, rh - ph - 8)) + "px";
  }

  /** Place a new node `OFFSET` away in `dir`, auto-route an edge, focus it for typing. */
  private spawnConnectedNode(source: Node, dir: SpawnDir, item: PaletteItem): void {
    const p = source.getPosition(); const s = source.getSize();
    const OFF = 80;
    let x: number, y: number;
    if (dir === "right") { x = p.x + s.width + OFF; y = p.y + s.height / 2 - item.h / 2; }
    else if (dir === "left") { x = p.x - OFF - item.w; y = p.y + s.height / 2 - item.h / 2; }
    else if (dir === "bottom") { x = p.x + s.width / 2 - item.w / 2; y = p.y + s.height + OFF; }
    else { x = p.x + s.width / 2 - item.w / 2; y = p.y - OFF - item.h; }
    // Collision: shift along the secondary axis until the spot is free.
    const horiz = dir === "left" || dir === "right";
    let guard = 0;
    while (this.overlapsAny(x, y, item.w, item.h, source.id) && guard++ < 50) {
      if (horiz) y += item.h + 20; else x += item.w + 20;
    }
    const created = this.addHtmlNode(item.shape, x, y, item.w, item.h, "");
    const opp: Record<SpawnDir, SpawnDir> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    this.graph.addEdge({
      source: { cell: source.id, port: dir }, target: { cell: created.id, port: opp[dir] },
      router: SMART_ROUTER, connector: CONNECTOR, attrs: EDGE_ATTRS,
    });
    this.graph.resetSelection([created]);
    this.editLabel(created);
    this.onChange();
  }

  /** AABB overlap test (with padding) against every node except `exceptId`. */
  private overlapsAny(x: number, y: number, w: number, h: number, exceptId: string): boolean {
    const pad = 12;
    return this.graph.getNodes().some((n) => {
      if (n.id === exceptId) return false;
      const p = n.getPosition(); const s = n.getSize();
      return x < p.x + s.width + pad && x + w + pad > p.x && y < p.y + s.height + pad && y + h + pad > p.y;
    });
  }

  // Excalidraw-style trackpad: two-finger scroll pans the board; pinch (ctrl/meta
  // + wheel) is left to X6's mousewheel zoom. Shift+scroll → horizontal pan.
  private enableTrackpadPan() {
    this.wheelPan = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // pinch-zoom handled by X6
      e.preventDefault();
      let { deltaX: dx, deltaY: dy } = e;
      if (e.shiftKey && dx === 0) { dx = dy; dy = 0; } // shift+wheel → horizontal
      const t = this.graph.translate();
      this.graph.translate(t.tx - dx, t.ty - dy);
    };
    this.graphMount.addEventListener("wheel", this.wheelPan, { passive: false });
  }

  /**
   * Make BPMN node labels (.bp-elabel) draggable so users can manually move
   * them out of overlapping arrows when auto-flip isn't enough.
   * Persists the offset in node.data.labelOffset and re-renders the template.
   */
  private enableLabelDrag(): void {
    this.root.addEventListener("pointerdown", (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      const lbl = t?.closest?.(".bp-elabel") as HTMLElement | null;
      if (!lbl) return;
      const nodeEl = lbl.closest(".x6-node") as HTMLElement | null;
      const cellId = nodeEl?.getAttribute("data-cell-id");
      if (!cellId) return;
      const node = this.graph.getCellById(cellId);
      if (!node || !node.isNode()) return;
      e.preventDefault(); e.stopPropagation();
      lbl.classList.add("is-dragging");
      const start = { x: e.clientX, y: e.clientY };
      const base = (node.getData()?.labelOffset as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
      const scale = this.graph.scale().sx;
      const mv = (ev: PointerEvent) => {
        const dx = (ev.clientX - start.x) / scale;
        const dy = (ev.clientY - start.y) / scale;
        lbl.style.transform = `translate(${base.x + dx}px, ${base.y + dy}px)`;
      };
      const up = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", mv);
        document.removeEventListener("pointerup", up);
        lbl.classList.remove("is-dragging");
        const dx = (ev.clientX - start.x) / scale;
        const dy = (ev.clientY - start.y) / scale;
        const next = { x: base.x + dx, y: base.y + dy };
        // Snap-back to 0 if user barely moved → no persistent offset.
        const final = Math.abs(dx) < 1 && Math.abs(dy) < 1 ? undefined : next;
        const n = node as Node;
        n.setData({ ...n.getData(), labelOffset: final });
        this.rerender(n);
        this.onChange();
      };
      document.addEventListener("pointermove", mv);
      document.addEventListener("pointerup", up);
    });
  }

  /**
   * Try to open a child-label editor for the given click target. Returns true
   * if an editor was opened (caller should NOT fall back to whole-node edit).
   * Routes through X6's node:dblclick + node:click events for cross-build reliability.
   */
  private tryEditChildLabel(target: HTMLElement | null, node: Node): boolean {
    if (!target) return false;
    // 1. Pool main label band
    const poolHead = target.closest(".bp-pool-head") as HTMLElement | null;
    if (poolHead) { this.editPoolLabel(node, poolHead); return true; }
    // 2. Lane label band
    const laneHead = target.closest(".bp-pool-lane-head") as HTMLElement | null;
    if (laneHead) {
      const laneId = laneHead.closest(".bp-pool-lane")?.getAttribute("data-lane-id");
      if (laneId) { this.editLaneLabel(node, laneId, laneHead); return true; }
    }
    // 2b. ERD entity title band
    const erdTh = target.closest(".erd-table .erd-th") as HTMLElement | null;
    if (erdTh) { this.editLabelAt(node, erdTh); return true; }
    // 2c. UML class / interface name band
    const umlName = target.closest(".uml .uml-name") as HTMLElement | null;
    if (umlName) { this.editLabelAt(node, umlName); return true; }
    // 3. ERD column key marker → small menu (PK / FK / none)
    const erdKey = target.closest(".erd-col .kk") as HTMLElement | null;
    if (erdKey) {
      const idx = +(erdKey.closest(".erd-col")?.getAttribute("data-col-idx") ?? "-1");
      if (idx >= 0) { this.pickErdKey(node, idx, erdKey); return true; }
    }
    // 4. ERD column name
    const cname = target.closest(".erd-col .cname") as HTMLElement | null;
    if (cname) {
      const idx = +(cname.closest(".erd-col")?.getAttribute("data-col-idx") ?? "-1");
      if (idx >= 0) { this.editErdCell(node, idx, "name", cname); return true; }
    }
    // 5. ERD column type
    const ctype = target.closest(".erd-col .ctype") as HTMLElement | null;
    if (ctype) {
      const idx = +(ctype.closest(".erd-col")?.getAttribute("data-col-idx") ?? "-1");
      if (idx >= 0) { this.editErdCell(node, idx, "type", ctype); return true; }
    }
    // 6. UML field/method line
    const ln = target.closest(".uml-comp .ln") as HTMLElement | null;
    if (ln) {
      const idx = +(ln.getAttribute("data-line-idx") ?? "-1");
      const comp = ln.getAttribute("data-line-comp") as "fields" | "methods" | null;
      if (idx >= 0 && comp) { this.editUmlLine(node, comp, idx, ln); return true; }
    }
    // 7. BPMN event/gateway label below the shape (e.g. "Start", "End")
    const bpLabel = target.closest(".bp-elabel") as HTMLElement | null;
    if (bpLabel) { this.editLabelAt(node, bpLabel); return true; }
    // 8. Sequence actor name under the stick figure
    const sqActorLbl = target.closest(".sq-actor-lbl") as HTMLElement | null;
    if (sqActorLbl) { this.editLabelAt(node, sqActorLbl); return true; }
    // 9. Sequence participant header pill (and any inner text element)
    const sqPill = target.closest(".sq-pill") as HTMLElement | null;
    if (sqPill && !target.closest(".sq-who")) { this.editLabelAt(node, sqPill); return true; }
    // 10. Sequence participant subtitle "who" (data.who)
    const sqWho = target.closest(".sq-who") as HTMLElement | null;
    if (sqWho) { this.editWho(node, sqWho); return true; }
    return false;
  }

  /** Inline edit node.label positioned over a specific element (instead of whole-node bbox). */
  private editLabelAt(node: Node, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect(); const rr = this.root.getBoundingClientRect();
    this.inlineEdit({
      left: r.left - rr.left, top: r.top - rr.top, width: Math.max(r.width, 80), height: r.height,
      value: this.nodeLabel(node), multiLine: true,
      onCommit: (v) => {
        node.setData({ ...node.getData(), label: v });
        this.rerender(node);
        this.onChange();
      },
    });
  }

  /** Inline edit data.who for sequence participants. */
  private editWho(node: Node, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect(); const rr = this.root.getBoundingClientRect();
    const cur = (node.getData()?.who as string | undefined) ?? "";
    this.inlineEdit({
      left: r.left - rr.left, top: r.top - rr.top, width: Math.max(r.width, 60), height: r.height,
      value: cur,
      onCommit: (v) => {
        node.setData({ ...node.getData(), who: v });
        this.rerender(node);
        this.onChange();
      },
    });
  }

  /** Hook is reserved for future canvas-wide listeners (kept as no-op). */
  private enableInlineLabelEdit(): void { /* routed via node:click/node:dblclick in bindEvents */ }

  /** Inline edit an ERD column field (name or type). */
  private editErdCell(node: Node, idx: number, field: "name" | "type", anchor: HTMLElement): void {
    const ex = this.nodeExtra(node);
    const cols = (ex.cols ?? []).slice();
    if (idx < 0 || idx >= cols.length) return;
    const r = anchor.getBoundingClientRect(); const rr = this.root.getBoundingClientRect();
    this.inlineEdit({
      left: r.left - rr.left, top: r.top - rr.top, width: Math.max(r.width, 60), height: r.height,
      value: cols[idx][field],
      onCommit: (v) => {
        cols[idx] = { ...cols[idx], [field]: v };
        node.setData({ ...node.getData(), cols });
        this.rerender(node);
        this.onChange();
      },
    });
  }

  /** Open a small menu over an ERD key cell to set its marker (PK / FK / none). */
  private pickErdKey(node: Node, idx: number, anchor: HTMLElement): void {
    const ex = this.nodeExtra(node);
    const cols = (ex.cols ?? []).slice();
    if (idx < 0 || idx >= cols.length) return;
    const cur = cols[idx].k as "" | "PK" | "FK";
    const menu = el("div", "lk-context-menu lk-key-menu");
    const opts: Array<{ k: "PK" | "FK" | ""; label: string }> = [
      { k: "PK", label: "PK — Primary Key" },
      { k: "FK", label: "FK — Foreign Key" },
      { k: "", label: "Không (để trống)" },
    ];
    opts.forEach((o) => {
      const item = el("div", "lk-menu-item" + (o.k === cur ? " active" : ""));
      item.appendChild(el("span", "kk " + (o.k.toLowerCase() || "none"), o.k || "—"));
      item.appendChild(el("span", undefined, o.label));
      item.onclick = () => {
        const next = (this.nodeExtra(node).cols ?? []).slice();
        if (idx < next.length) {
          next[idx] = { ...next[idx], k: o.k };
          node.setData({ ...node.getData(), cols: next });
          this.rerender(node);
          this.onChange();
        }
        this.hidePopup();
      };
      menu.appendChild(item);
    });
    this.showPopup(menu, anchor);
  }

  /** Inline edit a UML field/method line. */
  private editUmlLine(node: Node, comp: "fields" | "methods", idx: number, anchor: HTMLElement): void {
    const ex = this.nodeExtra(node);
    const arr = ((comp === "fields" ? ex.fields : ex.methods) ?? []).slice();
    if (idx < 0 || idx >= arr.length) return;
    const r = anchor.getBoundingClientRect(); const rr = this.root.getBoundingClientRect();
    this.inlineEdit({
      left: r.left - rr.left, top: r.top - rr.top, width: Math.max(r.width, 120), height: r.height,
      value: arr[idx],
      onCommit: (v) => {
        arr[idx] = v;
        node.setData({ ...node.getData(), [comp]: arr });
        this.rerender(node);
        this.onChange();
      },
    });
  }

  private bindEvents() {
    const changed = () => this.onChange();
    ["node:added", "node:removed", "node:moved", "node:resized", "node:change:attrs",
     "edge:added", "edge:removed", "edge:connected"].forEach((ev) => this.graph.on(ev, changed));

    this.graph.on("node:mouseenter", ({ node }) => this.togglePorts(node, true));
    this.graph.on("node:mouseleave", ({ node }) => this.togglePorts(node, false));

    // Edges behave like nodes: click to select (highlighted), Delete to remove.
    // Double-click edits the label. No floating delete button.
    this.graph.on("edge:click", ({ edge }) => this.graph.select(edge));
    this.graph.on("edge:selected", ({ edge }) => {
      this.applyEdgeStyle(edge, true); // highlight without losing custom color
      // Reshape: drag waypoints (vertices) or whole orthogonal segments (ngang/dọc);
      // round handles at both ends to drag-reconnect.
      const dot = { tagName: "circle", attrs: { r: 5, fill: "#fff", stroke: ACCENT, "stroke-width": 1.6, cursor: "move" } };
      edge.addTools([
        { name: "vertices", args: { attrs: { r: 5, fill: "#fff", stroke: ACCENT, "stroke-width": 1.6 } } },
        { name: "segments", args: { threshold: 8 } },
        { name: "source-arrowhead", args: dot },
        { name: "target-arrowhead", args: dot },
      ]);
      this.showEdgeBar(edge);
      if (this.padLayer) this.padLayer.style.display = "none";
    });
    this.graph.on("edge:unselected", ({ edge }) => { this.applyEdgeStyle(edge, false); edge.removeTools(); this.hideEdgeBar(); });
    this.graph.on("edge:dblclick", ({ edge, e }) => { e.stopPropagation(); this.editEdgeLabel(edge); });

    this.graph.on("node:selected", () => { this.refreshContextBar(); this.refreshProps(); this.refreshMindmapFabs(); this.refreshContextPad(); });
    this.graph.on("node:unselected", () => { this.refreshContextBar(); this.refreshProps(); this.refreshMindmapFabs(); this.refreshContextPad(); });
    this.graph.on("node:moved", () => { this.refreshContextBar(); this.refreshProps(); this.refreshMindmapFabs(); this.refreshContextPad(); });
    this.graph.on("node:resized", () => { this.refreshContextBar(); this.refreshContextPad(); });
    // Sequence activation bar is a thin vertical lifeline overlay: pin its width
    // so resize only changes height (X6 minWidth would otherwise fatten it).
    this.graph.on("node:change:size", ({ node }) => {
      if (this.nodeKind(node) !== "sq-activation") return;
      const s = node.getSize();
      if (s.width !== ACT_WIDTH) node.resize(ACT_WIDTH, s.height);
    });
    this.graph.on("scale", () => { this.refreshMindmapFabs(); this.refreshContextPad(); this.refreshMinimap(); });
    this.graph.on("translate", () => { this.refreshMindmapFabs(); this.refreshContextPad(); this.refreshMinimap(); });
    // Keep the minimap in sync with content changes.
    ["node:added", "node:removed", "node:moved", "node:resized", "node:change:size"]
      .forEach((ev) => this.graph.on(ev, () => this.refreshMinimap()));
    // Auto-flip BPMN event labels when the wiring around them changes.
    ["edge:added", "edge:removed", "edge:connected", "node:moved"]
      .forEach((ev) => this.graph.on(ev, () => this.refreshBpmnEventLabels()));
    // Use X6's node:dblclick (more reliable across X6 builds than raw DOM dblclick):
    // dispatch to a specific child-label editor first, fall back to whole-node label.
    this.graph.on("node:dblclick", ({ node, e }) => {
      e.stopPropagation();
      if (this.tryEditChildLabel(e.target as HTMLElement | null, node as Node)) return;
      this.editLabel(node as Node);
    });
    // X6 fires node:click on every click (incl. the one that selects it).
    // Open child-label editor only when the node was already selected BEFORE this click.
    this.graph.on("node:click", ({ node, e }) => {
      if (this.lastSelectedAt.get(node.id) === undefined) return;
      const sinceSel = Date.now() - (this.lastSelectedAt.get(node.id) ?? 0);
      if (sinceSel < 80) return; // too fresh — this click is the selection itself
      if (this.tryEditChildLabel(e.target as HTMLElement | null, node as Node)) e.stopPropagation();
    });
    this.graph.on("node:selected", ({ node }) => { this.lastSelectedAt.set(node.id, Date.now()); });
    this.graph.on("node:unselected", ({ node }) => { this.lastSelectedAt.delete(node.id); });

    this.graph.on("blank:click", () => { this.hidePopup(); this.commitLabel(); });
    this.graph.on("blank:mousedown", () => this.hidePopup());

    // Sequence messages: when both endpoints are sequence lifelines, swap the
    // edge's connector to "seq-msg" so the arrow stays horizontal at source Y.
    this.graph.on("edge:connected", ({ edge, isNew }) => {
      // Dropped on empty canvas → show shape picker at the drop point (Larksuite).
      if (isNew && !edge.getTargetCellId()) { this.handleDragToBlank(edge); return; }
      this.applySeqRoutingIfNeeded(edge);
      this.applyMindmapRoutingIfNeeded(edge);
    });
    // Robust fallback: some X6 builds don't emit edge:connected for a blank drop.
    // After any mouseup, scan for a freshly dangling edge (source cell, target point)
    // and open the picker for it.
    this.graphMount.addEventListener("mouseup", () => {
      window.setTimeout(() => {
        if (this.pendingDrop) return; // already handling one
        const dangling = this.graph.getEdges().find((e) => !!e.getSourceCellId() && !e.getTargetCellId());
        if (dangling) this.handleDragToBlank(dangling);
      }, 0);
    });

    this.graph.on("node:contextmenu", ({ node, e }) => {
      e.preventDefault();
      this.graph.select(node);
      this.showContextMenu(e.clientX, e.clientY);
    });
  }

  // Reveal/hide a node's connect ports by writing inline visibility straight to
  // the rendered DOM (X6 setPortProp + silent did not flush, so ports stayed
  // hidden and connections were impossible).
  private togglePorts(node: Node, visible: boolean) {
    const view = this.graph.findViewByCell(node);
    if (!view) return;
    (view.container as Element).querySelectorAll<SVGElement>(".x6-port circle").forEach((c) => {
      c.style.visibility = visible ? "visible" : "hidden";
    });
  }

  // ── Left tool dock (design "PHẦN TỬ" — labeled vertical list) ─────────────
  // Compact icon rail (Larksuite-style): one icon per category; hover reveals a
  // flyout grid of that category's shapes (draggable onto the canvas).
  private buildLeftToolbar() {
    const rail = el("div", "lk-rail");

    const sel = el("div", "lk-rail-item is-active");
    sel.innerHTML = CURSOR_ICON;
    sel.title = "Chọn (V)";
    sel.onclick = () => this.graph.cleanSelection();
    sel.onmouseenter = () => this.scheduleFlyoutClose();
    rail.appendChild(sel);

    rail.appendChild(el("div", "lk-rail-sep"));

    const REP: Record<string, string> = {
      "Cơ bản": "bs-rect", "Flowchart": "fc-decision", "ERD": "erd-entity", "UML": "uml-class",
      "State": "st-state", "Sequence": "sq-actor", "Mindmap": "mm-root", "BPMN": "bpmn-gateway-x",
    };
    for (const cat of this.categories) {
      const item = el("div", "lk-rail-item");
      item.innerHTML = shapeIcon(REP[cat.title] ?? cat.items[0].shape);
      item.title = cat.title;
      item.onmouseenter = () => this.openFlyout(cat, item);
      item.onmouseleave = () => this.scheduleFlyoutClose();
      item.onclick = () => this.openFlyout(cat, item);
      rail.appendChild(item);
    }
    this.root.appendChild(rail);
  }

  private openFlyout(cat: ShapeCategory, anchor: HTMLElement) {
    this.cancelFlyoutClose();
    this.closeFlyoutNow();
    const fly = el("div", "lk-flyout");
    fly.appendChild(el("div", "lk-flyout-title", cat.title));
    const grid = el("div", "lk-flyout-grid");
    for (const item of cat.items) {
      const cell = el("div", "lk-flyout-cell", `${shapeIcon(item.shape)}<span class="lbl">${item.label}</span>`);
      cell.title = `Kéo "${item.label}" vào canvas`;
      cell.onmousedown = (e: MouseEvent) => { this.startDrag(e, item); this.closeFlyoutNow(); };
      grid.appendChild(cell);
    }
    fly.appendChild(grid);
    fly.onmouseenter = () => this.cancelFlyoutClose();
    fly.onmouseleave = () => this.scheduleFlyoutClose();
    this.root.appendChild(fly);

    const ir = anchor.getBoundingClientRect();
    const rr = this.root.getBoundingClientRect();
    fly.style.left = (ir.right - rr.left + 8) + "px";
    const maxTop = rr.height - fly.offsetHeight - 12;
    fly.style.top = Math.min(Math.max(8, ir.top - rr.top - 6), Math.max(8, maxTop)) + "px";
    this.flyout = fly;
  }
  private closeFlyoutNow() { this.flyout?.remove(); this.flyout = null; }
  private cancelFlyoutClose() { if (this.flyoutTimer !== null) { window.clearTimeout(this.flyoutTimer); this.flyoutTimer = null; } }
  private scheduleFlyoutClose() {
    this.cancelFlyoutClose();
    this.flyoutTimer = window.setTimeout(() => this.closeFlyoutNow(), 160);
  }

  // Drag a shape from the panel onto the canvas
  private startDrag(e: MouseEvent, item: PaletteItem) {
    e.preventDefault();
    const ghost = el("div", "lk-drag-ghost", shapeIcon(item.shape));
    document.body.appendChild(ghost);
    const move = (ev: MouseEvent) => { ghost.style.left = ev.clientX + 8 + "px"; ghost.style.top = ev.clientY + 8 + "px"; };
    move(e);
    const up = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      ghost.remove();
      const rect = this.graphMount.getBoundingClientRect();
      if (ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
        const p = this.graph.clientToLocal(ev.clientX, ev.clientY);
        const node = this.addHtmlNode(item.shape, p.x - item.w / 2, p.y - item.h / 2, item.w, item.h, item.label);
        this.graph.select(node);
      }
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  // ── Zoom control (bottom-left, design style) ─────────────────────────────
  private buildBottomControls() {
    const SVG = (path: string) =>
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const ICON_MINUS = SVG(`<path d="M5 12h14"/>`);
    const ICON_PLUS  = SVG(`<path d="M12 5v14M5 12h14"/>`);
    const ICON_FIT   = SVG(`<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>`);

    const wrap = el("div", "lk-zoomctl");
    const mk = (icon: string, title: string, fn: () => void) => {
      const b = el("button", "lk-ctrl-btn"); b.innerHTML = icon; b.title = title; b.onclick = fn; return b;
    };
    wrap.appendChild(mk(ICON_MINUS, "Thu nhỏ", () => { this.graph.zoom(-0.1); this.updateZoom(); }));
    this.zoomLabel = el("span", "lk-zoom-lvl", "100%");
    wrap.appendChild(this.zoomLabel);
    wrap.appendChild(mk(ICON_PLUS, "Phóng to", () => { this.graph.zoom(0.1); this.updateZoom(); }));
    wrap.appendChild(mk(ICON_FIT, "Vừa khung", () => { this.graph.zoomToFit({ padding: 40, maxScale: 1.2 }); this.updateZoom(); }));
    this.root.appendChild(wrap);
    this.graph.on("scale", () => this.updateZoom());
  }
  private updateZoom() { if (this.zoomLabel) this.zoomLabel.textContent = Math.round(this.graph.scale().sx * 100) + "%"; }

  // ── Minimap (overview navigator, bottom-right) ───────────────────────────
  private buildMinimap(): void {
    const box = el("div", "lk-minimap");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "lk-mm-svg");
    box.appendChild(svg);
    const vp = el("div", "lk-mm-viewport");
    box.appendChild(vp);
    this.root.appendChild(box);
    this.minimap = box; this.minimapSvg = svg as SVGSVGElement; this.minimapVp = vp;
    // Click / drag anywhere on the minimap → recenter the viewport there.
    const panTo = (clientX: number, clientY: number) => {
      const r = box.getBoundingClientRect();
      const gx = this.mm.bx + (clientX - r.left - this.mm.ox) / this.mm.scale;
      const gy = this.mm.by + (clientY - r.top - this.mm.oy) / this.mm.scale;
      const sc = this.graph.scale().sx;
      this.graph.translate(this.graphMount.clientWidth / 2 - gx * sc, this.graphMount.clientHeight / 2 - gy * sc);
    };
    box.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation(); panTo(e.clientX, e.clientY);
      const mv = (ev: PointerEvent) => panTo(ev.clientX, ev.clientY);
      const up = () => { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); };
      document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
    });
    this.refreshMinimap();
  }

  private refreshMinimap(): void {
    const box = this.minimap, svg = this.minimapSvg, vp = this.minimapVp;
    if (!box || !svg || !vp) return;
    const nodes = this.graph.getNodes();
    if (!nodes.length) { box.style.display = "none"; return; }
    box.style.display = "block";
    const W = 190, H = 128, PAD = 8, innerW = W - 2 * PAD, innerH = H - 2 * PAD;
    const bb = this.graph.getContentBBox();
    const scale = Math.min(innerW / Math.max(bb.width, 1), innerH / Math.max(bb.height, 1));
    const ox = PAD + (innerW - bb.width * scale) / 2;
    const oy = PAD + (innerH - bb.height * scale) / 2;
    this.mm = { scale, ox, oy, bx: bb.x, by: bb.y };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    let html = "";
    for (const n of nodes) {
      const p = n.getPosition(); const s = n.getSize();
      const st = (n.getData()?.style as NodeStyle) ?? {};
      const fill = st.fill && st.fill !== "transparent" ? st.fill : "#cdd6df";
      html += `<rect x="${(ox + (p.x - bb.x) * scale).toFixed(1)}" y="${(oy + (p.y - bb.y) * scale).toFixed(1)}" width="${Math.max(2, s.width * scale).toFixed(1)}" height="${Math.max(2, s.height * scale).toFixed(1)}" rx="1.5" fill="${fill}"/>`;
    }
    svg.innerHTML = html;
    // Viewport rectangle = visible graph area mapped into minimap pixels.
    const sc = this.graph.scale().sx; const tr = this.graph.translate();
    const cw = this.graphMount.clientWidth, ch = this.graphMount.clientHeight;
    vp.style.left = `${ox + (-tr.tx / sc - bb.x) * scale}px`;
    vp.style.top = `${oy + (-tr.ty / sc - bb.y) * scale}px`;
    vp.style.width = `${(cw / sc) * scale}px`;
    vp.style.height = `${(ch / sc) * scale}px`;
  }

  // ── Canvas help (bottom-center) ──────────────────────────────────────────
  private buildCanvasHelp() {
    const h = el("div", "lk-canvas-help",
      `<b>2 ngón</b> kéo board · <b>⌘/Ctrl+cuộn</b> zoom · <b>Space</b> kéo · <b>kéo cạnh</b> nối`);
    this.root.appendChild(h);
  }

  // ── Properties panel (right dock, design style) ──────────────────────────
  private buildPropsPanel() {
    const panel = el("div", "lk-props");
    this.propsPanel = panel;
    const head = el("div", "lk-props-head");
    head.appendChild(el("span", "lk-props-ttl", "Thuộc tính"));
    const collapse = el("button", "lk-props-collapse", "›");
    collapse.title = "Thu gọn";
    collapse.onclick = () => this.togglePropsPanel(false);
    head.appendChild(collapse);
    panel.appendChild(head);
    this.propsBody = el("div", "lk-props-body");
    panel.appendChild(this.propsBody);
    this.root.appendChild(panel);

    // Floating toggle (top-right) to reopen the panel only when needed.
    const fab = el("button", "lk-props-fab");
    fab.title = "Thuộc tính";
    fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/></svg>`;
    fab.onclick = () => this.togglePropsPanel(true);
    this.propsFab = fab;
    this.root.appendChild(fab);

    this.togglePropsPanel(false); // start collapsed → clean board
  }

  private togglePropsPanel(open: boolean) {
    this.propsPanel?.classList.toggle("open", open);
    if (this.propsFab) this.propsFab.style.display = open ? "none" : "grid";
  }

  private refreshProps() {
    const body = this.propsBody;
    if (!body) return;
    body.innerHTML = "";
    const nodes = this.graph.getSelectedCells().filter((c) => c.isNode()) as Node[];
    if (nodes.length !== 1) {
      const empty = el("div", "lk-props-empty");
      empty.innerHTML = `<div class="lk-props-empty-ic">◇</div>Chọn một phần tử trên canvas để chỉnh nội dung, màu và vị trí.`;
      body.appendChild(empty);
      return;
    }
    const node = nodes[0];

    const sec = (title: string) => { const s = el("div", "lk-psec"); s.appendChild(el("div", "lk-psec-h", title)); body.appendChild(s); return s; };
    const field = (parent: HTMLElement, label: string, control: HTMLElement) => {
      const f = el("div", "lk-pfield");
      f.appendChild(el("label", undefined, label));
      f.appendChild(control);
      parent.appendChild(f);
    };

    const st = this.nodeStyle(node);

    // Content
    const s1 = sec("Nội dung");
    const labelInput = el("input", "lk-pinput") as HTMLInputElement;
    labelInput.value = this.nodeLabel(node);
    labelInput.oninput = () => { node.setData({ ...node.getData(), label: labelInput.value }); this.rerender(node); this.onChange(); };
    field(s1, "Nhãn", labelInput);

    // Data-driven editors (ERD columns / UML members)
    const kind = this.nodeKind(node);
    if (kind === "erd-entity") this.buildErdEditor(node, body);
    else if (kind === "uml-class" || kind === "uml-interface") this.buildUmlEditor(node, body);

    // Style
    const s2 = sec("Kiểu");
    const swatchRow = (key: "fill" | "stroke") => {
      const row = el("div", "lk-pswatches");
      for (const c of FILL_SWATCHES) {
        const sw = el("div", "lk-pswatch");
        sw.style.background = c === "transparent" ? "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/8px 8px" : c;
        if (st[key] === c) sw.classList.add("on");
        sw.onclick = () => { this.setStyle(node, { [key]: c }); this.refreshProps(); };
        row.appendChild(sw);
      }
      return row;
    };
    field(s2, "Màu nền", swatchRow("fill"));
    field(s2, "Màu viền", swatchRow("stroke"));
    const fontSel = el("select", "lk-pinput") as HTMLSelectElement;
    FONT_SIZES.forEach((sz) => { const o = el("option", undefined, String(sz)); o.value = String(sz); fontSel.appendChild(o); });
    fontSel.value = String(st.fontSize || 13);
    fontSel.onchange = () => this.setStyle(node, { fontSize: Number(fontSel.value) });
    field(s2, "Cỡ chữ", fontSel);

    // Position
    const s3 = sec("Vị trí & kích thước");
    const pos = node.getPosition(); const size = node.getSize();
    const numRow = el("div", "lk-prow2");
    const mkNum = (val: number, set: (v: number) => void) => {
      const i = el("input", "lk-pinput") as HTMLInputElement; i.type = "number"; i.value = String(Math.round(val));
      i.onchange = () => { set(Number(i.value)); this.onChange(); }; return i;
    };
    numRow.appendChild(mkNum(pos.x, (v) => node.setPosition(v, node.getPosition().y)));
    numRow.appendChild(mkNum(pos.y, (v) => node.setPosition(node.getPosition().x, v)));
    field(s3, "X / Y", numRow);
    const sizeRow = el("div", "lk-prow2");
    sizeRow.appendChild(mkNum(size.width, (v) => node.resize(v, node.getSize().height)));
    sizeRow.appendChild(mkNum(size.height, (v) => node.resize(node.getSize().width, v)));
    field(s3, "Rộng / Cao", sizeRow);
  }

  // ── ERD column / UML member editors (right panel) ────────────────────────
  private buildErdEditor(node: Node, body: HTMLElement) {
    const sec = el("div", "lk-psec");
    sec.appendChild(el("div", "lk-psec-h", "Cột"));
    const list = el("div");
    sec.appendChild(list);
    const cols = (): ErdCol[] => this.nodeExtra(node).cols ?? [];
    const render = () => { list.innerHTML = ""; cols().forEach((c, i) => list.appendChild(this.erdRow(node, c, i, render))); };
    render();
    const add = el("button", "lk-padd", "+ Thêm cột");
    add.onclick = () => { this.setExtra(node, { cols: [...cols(), { k: "", name: "field", type: "text" }] }); render(); };
    sec.appendChild(add);
    body.appendChild(sec);
  }
  private erdRow(node: Node, col: ErdCol, idx: number, rerenderList: () => void): HTMLElement {
    const row = el("div", "lk-erd-row");
    const cols = (): ErdCol[] => this.nodeExtra(node).cols ?? [];
    const update = (patch: Partial<ErdCol>) => this.setExtra(node, { cols: cols().map((c, i) => (i === idx ? { ...c, ...patch } : c)) });
    const ksel = el("select", "lk-pinput") as HTMLSelectElement;
    (["", "PK", "FK"] as const).forEach((k) => { const o = el("option", undefined, k || "—"); o.value = k; ksel.appendChild(o); });
    ksel.value = col.k; ksel.style.flex = "0 0 52px";
    ksel.onchange = () => update({ k: ksel.value as ErdCol["k"] });
    const name = el("input", "lk-pinput") as HTMLInputElement; name.value = col.name; name.placeholder = "tên"; name.style.flex = "1";
    name.oninput = () => update({ name: name.value });
    const type = el("input", "lk-pinput") as HTMLInputElement; type.value = col.type; type.placeholder = "kiểu"; type.style.flex = "0 0 62px";
    type.oninput = () => update({ type: type.value });
    const del = el("button", "lk-cb-btn", "×"); del.title = "Xóa cột"; del.style.flex = "0 0 26px";
    del.onclick = () => { this.setExtra(node, { cols: cols().filter((_, i) => i !== idx) }); rerenderList(); };
    [ksel, name, type, del].forEach((e) => row.appendChild(e));
    return row;
  }

  private buildUmlEditor(node: Node, body: HTMLElement) {
    const mk = (title: string, key: "fields" | "methods") => {
      const sec = el("div", "lk-psec");
      sec.appendChild(el("div", "lk-psec-h", title));
      const list = el("div");
      sec.appendChild(list);
      const arr = (): string[] => this.nodeExtra(node)[key] ?? [];
      const render = () => { list.innerHTML = ""; arr().forEach((line, i) => list.appendChild(this.umlRow(node, key, line, i, render))); };
      render();
      const add = el("button", "lk-padd", "+ Thêm");
      add.onclick = () => { this.setExtra(node, { [key]: [...arr(), key === "methods" ? "+ method(): void" : "+ field: type"] } as NodeExtra); render(); };
      sec.appendChild(add);
      body.appendChild(sec);
    };
    mk("Thuộc tính", "fields");
    mk("Phương thức", "methods");
  }
  private umlRow(node: Node, key: "fields" | "methods", line: string, idx: number, rerenderList: () => void): HTMLElement {
    const row = el("div", "lk-erd-row");
    const arr = (): string[] => this.nodeExtra(node)[key] ?? [];
    const inp = el("input", "lk-pinput") as HTMLInputElement; inp.value = line; inp.style.flex = "1";
    inp.oninput = () => this.setExtra(node, { [key]: arr().map((l, i) => (i === idx ? inp.value : l)) } as NodeExtra);
    const del = el("button", "lk-cb-btn", "×"); del.title = "Xóa"; del.style.flex = "0 0 26px";
    del.onclick = () => { this.setExtra(node, { [key]: arr().filter((_, i) => i !== idx) } as NodeExtra); rerenderList(); };
    row.appendChild(inp); row.appendChild(del);
    return row;
  }

  // ── Contextual toolbar above selected node ──────────────────────────────
  private refreshContextBar() {
    const nodes = this.graph.getSelectedCells().filter((c) => c.isNode()) as Node[];
    if (nodes.length !== 1) { this.contextBar.style.display = "none"; return; }
    const node = nodes[0];
    // Mindmap nodes use the floating "+" fabs (top/right/bottom) for their
    // primary affordances — hide the context bar so it doesn't overlap them.
    const k = this.nodeKind(node);
    if (k === "mm-root" || k === "mm-branch" || k === "mm-leaf") {
      this.contextBar.style.display = "none";
      return;
    }
    this.contextBar.innerHTML = "";

    const mkBtn = (html: string, title: string, fn: (ev: MouseEvent) => void) => {
      const b = el("button", "lk-cb-btn", html); b.title = title; b.onclick = fn; return b;
    };

    const st = this.nodeStyle(node);
    // Shape morph
    this.contextBar.appendChild(mkBtn("◇", "Đổi hình", (ev) => this.openShapePopup(node, ev.currentTarget as HTMLElement)));
    // Edit label
    this.contextBar.appendChild(mkBtn("✎", "Sửa chữ", () => this.editLabel(node)));
    // Fill color
    this.contextBar.appendChild(mkBtn(`<span class="lk-color-dot" style="background:${st.fill || "var(--pg-surface)"}"></span>`, "Màu nền", (ev) => this.openColorPopup(node, "fill", ev.currentTarget as HTMLElement)));
    // Border color
    this.contextBar.appendChild(mkBtn(`<span class="lk-color-ring" style="border-color:${st.stroke || "#888"}"></span>`, "Màu viền", (ev) => this.openColorPopup(node, "stroke", ev.currentTarget as HTMLElement)));
    // Typography (font size, B/I/U/S, align, text color)
    this.contextBar.appendChild(mkBtn(`<b style="font-size:15px">A</b>`, "Chữ", (ev) => this.openTextPopup(node, ev.currentTarget as HTMLElement)));
    // Mindmap quick-add buttons render as floating circular "+" around the node
    // (see refreshMindmapFabs) — keep the context bar focused on style controls.
    // Duplicate / Delete / More
    this.contextBar.appendChild(mkBtn("⧉", "Nhân bản", () => this.duplicateSelection()));
    this.contextBar.appendChild(mkBtn("🗑", "Xóa", () => { this.graph.removeCells(this.graph.getSelectedCells()); }));
    this.contextBar.appendChild(mkBtn("⋯", "Thêm", (ev) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); this.showContextMenu(r.left, r.bottom + 4); }));

    // BPMN Pool — quick-action buttons (bpmn.io UX).
    if (this.nodeKind(node) === "bpmn-pool") {
      this.contextBar.appendChild(el("div", "lk-cb-sep"));
      const ic = (svg: string) => `<svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">${svg}</svg>`;
      this.contextBar.appendChild(mkBtn(ic(`<rect x="3" y="2" width="14" height="6" stroke-dasharray="2 2"/><rect x="3" y="11" width="14" height="7"/>`),
        "Thêm lane phía trên", () => this.addLaneToPool(node, "above")));
      this.contextBar.appendChild(mkBtn(ic(`<rect x="3" y="2" width="14" height="7"/><rect x="3" y="12" width="14" height="6" stroke-dasharray="2 2"/>`),
        "Thêm lane phía dưới", () => this.addLaneToPool(node, "below")));
      this.contextBar.appendChild(mkBtn(ic(`<rect x="3" y="3" width="14" height="6"/><rect x="3" y="11" width="14" height="6"/>`),
        "Chia 2 lane", () => this.dividePool(node, 2)));
      this.contextBar.appendChild(mkBtn(ic(`<rect x="3" y="2" width="14" height="4"/><rect x="3" y="8" width="14" height="4"/><rect x="3" y="14" width="14" height="4"/>`),
        "Chia 3 lane", () => this.dividePool(node, 3)));
    }

    // Position above node
    const bbox = node.getBBox();
    const s = this.graph.scale().sx; const t = this.graph.translate();
    const left = bbox.x * s + t.tx + (bbox.width * s) / 2;
    const top = bbox.y * s + t.ty;
    this.contextBar.style.display = "flex";
    const bw = this.contextBar.offsetWidth || 280;
    const bh = this.contextBar.offsetHeight || 40;
    this.contextBar.style.left = Math.max(8, left - bw / 2) + "px";
    // Sit above the top "+" pad (pad center at top-24, r≈11) so they don't overlap.
    this.contextBar.style.top = Math.max(8, top - 42 - bh) + "px";
  }

  // ── Popups ───────────────────────────────────────────────────────────────
  private openShapePopup(node: Node, anchor: HTMLElement) {
    const grid = el("div", "lk-shape-grid");
    for (const cat of this.categories) {
      for (const item of cat.items) {
        const cell = el("div", "lk-shape-cell", shapeIcon(item.shape));
        cell.title = item.label;
        cell.onclick = () => { this.morphShape(node, item.shape); this.hidePopup(); this.refreshContextBar(); };
        grid.appendChild(cell);
      }
    }
    this.showPopup(grid, anchor);
  }

  private openColorPopup(node: Node, key: "fill" | "stroke", anchor: HTMLElement) {
    const wrap = el("div", "lk-color-popup");
    const row = el("div", "lk-color-grid");
    for (const c of FILL_SWATCHES) {
      const sw = el("div", "lk-swatch");
      sw.style.background = c === "transparent" ? "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/8px 8px" : c;
      sw.onclick = () => { this.setStyle(node, { [key]: c === "transparent" ? "transparent" : c }); this.refreshContextBar(); this.hidePopup(); };
      row.appendChild(sw);
    }
    // "+" → open the HSV picker for a custom color.
    const plus = el("div", "lk-swatch lk-swatch-add", "+");
    const cur = (key === "fill" ? this.nodeStyle(node).fill : this.nodeStyle(node).stroke) || "#5E8FB9";
    plus.onclick = () => this.openColorWheel(cur, (hx) => { this.setStyle(node, { [key]: hx }); this.refreshContextBar(); }, anchor);
    row.appendChild(plus);
    wrap.appendChild(row);
    // Border weight + dash style live with the border color.
    if (key === "stroke") {
      const st = this.nodeStyle(node);
      const wRow = el("div", "lk-line-row");
      [1, 2, 3].forEach((bw, i) => {
        const b = el("div", "lk-line-cell" + ((st.borderWidth ?? 1) === bw ? " on" : ""),
          `<svg viewBox="0 0 26 8" width="30" height="10"><line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="${bw}"/></svg>`);
        b.title = ["Mảnh", "Vừa", "Đậm"][i];
        b.onclick = () => { this.setStyle(node, { borderWidth: bw }); this.hidePopup(); this.refreshContextBar(); this.openColorPopup(node, "stroke", anchor); };
        wRow.appendChild(b);
      });
      wrap.appendChild(wRow);
      const dRow = el("div", "lk-line-row");
      ([["solid", ""], ["dashed", "5 3"], ["dotted", "1.5 3"]] as Array<["solid" | "dashed" | "dotted", string]>).forEach(([key2, dash]) => {
        const b = el("div", "lk-line-cell" + ((st.borderDash ?? "solid") === key2 ? " on" : ""),
          `<svg viewBox="0 0 26 8" width="30" height="10"><line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ""}/></svg>`);
        b.title = key2;
        b.onclick = () => { this.setStyle(node, { borderDash: key2 }); this.hidePopup(); this.refreshContextBar(); this.openColorPopup(node, "stroke", anchor); };
        dRow.appendChild(b);
      });
      wrap.appendChild(dRow);
    }
    this.showPopup(wrap, anchor);
  }

  /** Modern HSV picker: draggable saturation/value square + hue slider + synced hex. */
  private openColorWheel(initial: string, onPick: (hex: string) => void, anchor: HTMLElement): void {
    const wrap = el("div", "lk-wheel");
    const sv = el("div", "lk-wheel-sv");
    const svThumb = el("div", "lk-wheel-sv-thumb"); sv.appendChild(svThumb);
    const hue = el("div", "lk-wheel-hue");
    const hueThumb = el("div", "lk-wheel-hue-thumb"); hue.appendChild(hueThumb);
    const hex = el("input", "lk-hex-input") as HTMLInputElement;
    hex.type = "text"; hex.maxLength = 7; hex.spellcheck = false;
    wrap.appendChild(sv); wrap.appendChild(hue); wrap.appendChild(hex);

    const rgb0 = hexToRgb(initial) ?? { r: 94, g: 143, b: 185 };
    let { h, s, v } = rgbToHsv(rgb0.r, rgb0.g, rgb0.b);
    const render = (emit = true) => {
      sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))`;
      svThumb.style.left = `${s * 100}%`; svThumb.style.top = `${(1 - v) * 100}%`;
      hueThumb.style.left = `${(h / 360) * 100}%`;
      const c = hsvToRgb(h, s, v); const hx = rgbToHex(c.r, c.g, c.b);
      svThumb.style.background = hx; hex.value = hx;
      if (emit) onPick(hx);
    };
    const drag = (elm: HTMLElement, move: (px: number, py: number) => void) => {
      const handle = (e: PointerEvent) => {
        const r = elm.getBoundingClientRect();
        move(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
        render();
      };
      elm.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation(); handle(e);
        const mv = (ev: PointerEvent) => handle(ev);
        const up = () => { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); };
        document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
      });
    };
    drag(sv, (px, py) => { s = px; v = 1 - py; });
    drag(hue, (px) => { h = px * 360; });
    hex.onpointerdown = (e) => e.stopPropagation();
    hex.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      const c = hexToRgb(hex.value); if (!c) return;
      ({ h, s, v } = rgbToHsv(c.r, c.g, c.b)); render();
    };
    render(false);
    this.showPopup(wrap, anchor);
  }

  /** Typography popover: font size · B/I/U/S · align · text color. */
  private openTextPopup(node: Node, anchor: HTMLElement) {
    const st = this.nodeStyle(node);
    const wrap = el("div", "lk-line-popup");
    // Font size row
    const szRow = el("div", "lk-line-row");
    FONT_SIZES.forEach((sz) => {
      const b = el("div", "lk-line-cell" + ((st.fontSize ?? 13) === sz ? " on" : ""), String(sz));
      b.onclick = () => { this.setStyle(node, { fontSize: sz }); this.refreshContextBar(); this.openTextPopup(node, anchor); };
      szRow.appendChild(b);
    });
    wrap.appendChild(szRow);
    // B / I / U / S toggles
    const tgRow = el("div", "lk-line-row");
    const toggle = (label: string, key: "bold" | "italic" | "underline" | "strike", css: string) => {
      const b = el("div", "lk-line-cell" + (st[key] ? " on" : ""), `<span style="${css}">${label}</span>`);
      b.onclick = () => { this.setStyle(node, { [key]: !st[key] }); this.refreshContextBar(); this.openTextPopup(node, anchor); };
      tgRow.appendChild(b);
    };
    toggle("B", "bold", "font-weight:700");
    toggle("I", "italic", "font-style:italic");
    toggle("U", "underline", "text-decoration:underline");
    toggle("S", "strike", "text-decoration:line-through");
    wrap.appendChild(tgRow);
    // Alignment
    const alRow = el("div", "lk-line-row");
    ([["left", "≡", "Trái"], ["center", "≡", "Giữa"], ["right", "≡", "Phải"]] as Array<["left" | "center" | "right", string, string]>).forEach(([al, , title]) => {
      const b = el("div", "lk-line-cell" + ((st.align ?? "center") === al ? " on" : ""),
        `<span style="display:block;width:18px;text-align:${al};font-size:13px">≡</span>`);
      b.title = title;
      b.onclick = () => { this.setStyle(node, { align: al }); this.refreshContextBar(); this.openTextPopup(node, anchor); };
      alRow.appendChild(b);
    });
    wrap.appendChild(alRow);
    // Text color
    const cRow = el("div", "lk-color-grid");
    for (const c of FILL_SWATCHES) {
      if (c === "transparent") continue;
      const sw = el("div", "lk-swatch"); sw.style.background = c;
      sw.onclick = () => { this.setStyle(node, { color: c }); this.refreshContextBar(); this.openTextPopup(node, anchor); };
      cRow.appendChild(sw);
    }
    wrap.appendChild(cRow);
    this.showPopup(wrap, anchor);
  }

  private showPopup(content: HTMLElement, anchor: HTMLElement) {
    this.popupLayer.innerHTML = "";
    this.popupLayer.appendChild(content);
    const r = anchor.getBoundingClientRect();
    const rootRect = this.root.getBoundingClientRect();
    this.popupLayer.style.display = "block";
    this.popupLayer.style.left = (r.left - rootRect.left) + "px";
    this.popupLayer.style.top = (r.bottom - rootRect.top + 6) + "px";
  }

  private hidePopup() {
    if (this.pendingDrop) { this.pendingDrop.remove(); this.pendingDrop = null; } // cancel drag-to-blank
    this.popupLayer.style.display = "none"; this.popupLayer.innerHTML = "";
  }

  // ── Right-click context menu ─────────────────────────────────────────────
  private showContextMenu(clientX: number, clientY: number) {
    const menu = el("div", "lk-context-menu");
    const rootRect = this.root.getBoundingClientRect();
    const add = (label: string, shortcut: string, fn: () => void) => {
      const item = el("div", "lk-menu-item");
      item.appendChild(el("span", undefined, label));
      if (shortcut) item.appendChild(el("span", "lk-menu-sc", shortcut));
      item.onclick = () => { fn(); this.hidePopup(); };
      menu.appendChild(item);
    };
    const sep = () => menu.appendChild(el("div", "lk-menu-sep"));
    add("Nhân bản", "⌘D", () => this.duplicateSelection());
    add("Copy style", "", () => this.copyStyle());
    add("Paste style", "", () => this.pasteStyle());
    sep();
    add("Lật ngang", "", () => {});
    add("Đưa lên trước", "", () => this.graph.getSelectedCells().forEach((c) => c.toFront()));
    add("Đưa ra sau", "", () => this.graph.getSelectedCells().forEach((c) => c.toBack()));
    sep();
    add("Xóa", "⌫", () => this.graph.removeCells(this.graph.getSelectedCells()));

    this.popupLayer.innerHTML = "";
    this.popupLayer.appendChild(menu);
    this.popupLayer.style.display = "block";
    this.popupLayer.style.left = (clientX - rootRect.left) + "px";
    this.popupLayer.style.top = (clientY - rootRect.top) + "px";
  }

  private styleClipboard: NodeStyle | null = null;
  private copyStyle() {
    const n = this.graph.getSelectedCells().find((c) => c.isNode()) as Node | undefined;
    if (n) this.styleClipboard = { ...this.nodeStyle(n) };
  }
  private pasteStyle() {
    if (!this.styleClipboard) return;
    (this.graph.getSelectedCells().filter((c) => c.isNode()) as Node[]).forEach((n) => this.setStyle(n, this.styleClipboard!));
  }

  // ── HTML node helpers ────────────────────────────────────────────────────
  private addHtmlNode(kind: string, x: number, y: number, w: number, h: number, label: string, style?: NodeStyle, id?: string, extra?: NodeExtra): Node {
    const ex = this.mergeExtra(kind, extra);
    const node = this.graph.addNode({
      id, shape: "html-node", x, y, width: w, height: h,
      data: { kind, label, style: style ?? {}, ...ex },
      attrs: { content: { html: nodeHtml(kind, label, style, ex), class: "hn" } },
    });
    if (kind === "mm-root" || kind === "mm-branch" || kind === "mm-leaf") {
      this.scheduleMindmapAutoGrow(node);
    }
    // Container/frame shapes (fragments, sub-process, lanes, pool, annotation)
    // sit behind regular nodes so they visually group them.
    if (FRAME_KINDS.has(kind)) node.toBack();
    return node;
  }

  /** Defer autoGrow past X6's mount + fitWhenReady race so DOM is measurable. */
  private scheduleMindmapAutoGrow(node: Node): void {
    setTimeout(() => this.autoGrowMindmapNode(node), 60);
  }
  // Seed default rows for data-driven kinds; keep only defined incoming overrides.
  private seedExtra(kind: string): NodeExtra {
    if (kind === "erd-entity") return { cols: defaultErdCols() };
    if (kind === "uml-class" || kind === "uml-interface") return defaultUml(kind);
    if (kind === "bpmn-pool") return { lanes: [{ id: "l1", label: "Lane 1" }] };
    return {};
  }
  private mergeExtra(kind: string, data?: NodeExtra): NodeExtra {
    const seed = this.seedExtra(kind);
    const out: NodeExtra = { ...seed };
    if (data?.cols) out.cols = data.cols;
    if (data?.fields) out.fields = data.fields;
    if (data?.methods) out.methods = data.methods;
    if (data?.who !== undefined) out.who = data.who;
    if (data?.labelOffset) out.labelOffset = data.labelOffset;
    if (data?.lanes && data.lanes.length > 0) out.lanes = data.lanes;  // empty array falls back to seed default
    return out;
  }
  private nodeKind(n: Node): string { return (n.getData()?.kind as string) ?? "bs-rect"; }
  private nodeLabel(n: Node): string { return (n.getData()?.label as string) ?? ""; }
  private nodeStyle(n: Node): NodeStyle { return (n.getData()?.style as NodeStyle) ?? {}; }
  private nodeExtra(n: Node): NodeExtra { const d = n.getData() ?? {}; return { cols: d.cols, fields: d.fields, methods: d.methods, who: d.who, labelOffset: d.labelOffset, lanes: d.lanes }; }
  private rerender(n: Node) {
    n.attr("content/html", nodeHtml(this.nodeKind(n), this.nodeLabel(n), this.nodeStyle(n), this.nodeExtra(n)));
    // Mindmap nodes wrap text — re-measure on the next paint so the bbox grows
    // to fit content (otherwise long labels overflow the visible frame).
    const k = this.nodeKind(n);
    if (k === "mm-root" || k === "mm-branch" || k === "mm-leaf") {
      this.scheduleMindmapAutoGrow(n);
    }
  }
  private setStyle(n: Node, patch: NodeStyle) { n.setData({ ...n.getData(), style: { ...this.nodeStyle(n), ...patch } }); this.rerender(n); this.onChange(); }

  // Update ERD cols / UML members, then re-render + grow node height to fit.
  private setExtra(n: Node, patch: NodeExtra) {
    n.setData({ ...n.getData(), ...patch });
    this.rerender(n);
    this.autoHeight(n);
    this.onChange();
  }
  private autoHeight(n: Node) {
    const kind = this.nodeKind(n); const ex = this.nodeExtra(n);
    let h = 0;
    if (kind === "erd-entity") h = 34 + (ex.cols?.length ?? 0) * 25;
    else if (kind === "uml-class" || kind === "uml-interface") {
      const f = ex.fields?.length ?? 0, m = ex.methods?.length ?? 0;
      h = 38 + (f ? 14 + f * 20 : 0) + (m ? 14 + m * 20 : 0);
    } else return;
    n.resize(n.getSize().width, Math.max(h, 44), { silent: false });
  }

  // ── Shape morph (change kind in place) ───────────────────────────────────
  private morphShape(node: Node, newKind: string) {
    node.setData({ ...node.getData(), kind: newKind, ...this.mergeExtra(newKind, this.nodeExtra(node)) });
    this.rerender(node);
    this.autoHeight(node);
    this.onChange();
  }

  // ── BPMN Pool lane operations ───────────────────────────────────────────
  private newLaneId(): string { return "l" + Math.random().toString(36).slice(2, 8); }

  private addLaneToPool(node: Node, where: "above" | "below"): void {
    const ex = this.nodeExtra(node);
    const lanes = [...(ex.lanes ?? [{ id: "l1", label: "Lane 1" }])];
    const next = { id: this.newLaneId(), label: `Lane ${lanes.length + 1}` };
    if (where === "above") lanes.unshift(next); else lanes.push(next);
    node.setData({ ...node.getData(), lanes });
    const s = node.getSize();
    node.resize(s.width, s.height + 70); // grow to fit new lane
    this.rerender(node);
    this.refreshContextBar();
    this.onChange();
  }

  private dividePool(node: Node, count: number): void {
    const lanes = Array.from({ length: count }, (_, i) => ({ id: this.newLaneId(), label: `Lane ${i + 1}` }));
    node.setData({ ...node.getData(), lanes });
    this.rerender(node);
    this.refreshContextBar();
    this.onChange();
  }

  /** Generic inline edit centered on a rotated label band (pool / lane head). */
  /**
   * Single global inline editor (bpmn.io-style). One `<textarea>` overlay
   * positioned over the target band. Auto-grows on input, commits on Enter
   * (Shift+Enter = newline when `multiLine`), Esc cancels, blur commits.
   * Live-commits if the user pans or zooms the canvas mid-edit so the editor
   * never floats free of its anchor.
   */
  private inlineEdit(opts: {
    left: number; top: number; width: number; height: number;
    value: string; vertical?: boolean; multiLine?: boolean;
    onCommit: (next: string) => void;
  }): void {
    this.commitLabel(); // close any previous editor
    const ta = el("textarea", "lk-label-input" + (opts.vertical ? " is-vertical" : "")) as HTMLTextAreaElement;
    ta.value = opts.value;
    ta.style.left = opts.left + "px";
    ta.style.top = opts.top + "px";
    ta.style.width = opts.width + "px";
    ta.style.height = opts.height + "px";
    ta.rows = 1;
    const autoGrow = () => {
      if (opts.vertical) {
        // vertical text grows along its writing axis (the textarea's HEIGHT after rotation = visual width)
        ta.style.width = "auto"; const w = Math.max(opts.width, ta.scrollWidth + 4); ta.style.width = w + "px";
      } else {
        ta.style.height = "auto"; const h = Math.max(opts.height, ta.scrollHeight); ta.style.height = h + "px";
      }
    };
    let done = false;
    const finish = (save: boolean) => {
      if (done) return; done = true;
      if (save) {
        const v = ta.value.trim();
        if (v) opts.onCommit(v);
      }
      this.graph.off("scale", abort); this.graph.off("translate", abort);
      ta.remove(); this.labelInput = null;
    };
    const abort = () => finish(true); // commit on viewport change so editor never drifts
    ta.addEventListener("input", autoGrow);
    ta.addEventListener("keydown", ((e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        if (opts.multiLine && e.shiftKey) return;       // multiLine: Shift+Enter = newline
        e.preventDefault(); finish(true);
      } else if (e.key === "Escape") { finish(false); }
    }) as EventListener);
    ta.addEventListener("blur", () => finish(true));
    this.root.appendChild(ta);
    this.labelInput = ta;
    this.graph.on("scale", abort); this.graph.on("translate", abort);
    setTimeout(() => { ta.focus(); ta.select(); autoGrow(); }, 10);
  }

  private editLaneLabel(node: Node, laneId: string, anchor: HTMLElement): void {
    const ex = this.nodeExtra(node);
    const lanes = (ex.lanes ?? []).slice();
    const idx = lanes.findIndex((l) => l.id === laneId);
    if (idx < 0) return;
    const r = anchor.getBoundingClientRect(); const rr = this.root.getBoundingClientRect();
    this.inlineEdit({
      left: r.left - rr.left, top: r.top - rr.top, width: r.width, height: r.height,
      value: lanes[idx].label, vertical: true,
      onCommit: (v) => {
        lanes[idx] = { ...lanes[idx], label: v };
        node.setData({ ...node.getData(), lanes });
        this.rerender(node);
        this.onChange();
      },
    });
  }

  private editPoolLabel(node: Node, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect(); const rr = this.root.getBoundingClientRect();
    this.inlineEdit({
      left: r.left - rr.left, top: r.top - rr.top, width: r.width, height: r.height,
      value: this.nodeLabel(node), vertical: true,
      onCommit: (v) => {
        node.setData({ ...node.getData(), label: v });
        this.rerender(node);
        this.onChange();
      },
    });
  }

  private duplicateSelection() {
    const nodes = this.graph.getSelectedCells().filter((c) => c.isNode()) as Node[];
    const fresh: Node[] = [];
    nodes.forEach((n) => {
      const p = n.getPosition(); const s = n.getSize();
      fresh.push(this.addHtmlNode(this.nodeKind(n), p.x + 24, p.y + 24, s.width, s.height, this.nodeLabel(n), this.nodeStyle(n), undefined, this.nodeExtra(n)));
    });
    if (fresh.length) this.graph.resetSelection(fresh);
    this.onChange();
  }

  // ── Inline label editing ─────────────────────────────────────────────────
  private editLabel(node: Node) {
    const bbox = node.getBBox(); const s = this.graph.scale().sx; const t = this.graph.translate();
    const kind = this.nodeKind(node);
    const isMindmap = kind === "mm-root" || kind === "mm-branch" || kind === "mm-leaf";
    this.inlineEdit({
      left: bbox.x * s + t.tx, top: bbox.y * s + t.ty,
      width: bbox.width * s, height: bbox.height * s,
      value: this.nodeLabel(node), multiLine: true, // allow Shift+Enter newline on all nodes
      onCommit: (v) => {
        node.setData({ ...node.getData(), label: v });
        this.rerender(node);
        if (isMindmap) this.autoGrowMindmapNode(node);
        this.onChange();
      },
    });
  }

  /** Re-measure rendered HTML and grow the node's height if the wrapped text overflows. */
  private autoGrowMindmapNode(node: Node): void {
    const view = this.graph.findViewByCell(node) as unknown as { container?: HTMLElement } | null;
    const mm = view?.container?.querySelector?.(".mm") as HTMLElement | null;
    if (!mm) return;
    const desired = mm.scrollHeight;
    const cur = node.getSize().height;
    if (desired > cur + 1) node.resize(node.getSize().width, desired);
  }
  private commitLabel() { if (this.labelInput) this.labelInput.blur(); }

  // Inline-edit an edge's label (double-click the arrow).
  private editEdgeLabel(edge: Edge) {
    this.commitLabel();
    const bbox = edge.getBBox(); const s = this.graph.scale().sx; const t = this.graph.translate();
    const cx = (bbox.x + bbox.width / 2) * s + t.tx;
    const cy = (bbox.y + bbox.height / 2) * s + t.ty;
    const input = el("input", "lk-label-input") as HTMLInputElement;
    const cur = (edge.getLabels()?.[0] as { attrs?: { label?: { text?: string } } } | undefined)?.attrs?.label?.text;
    input.value = cur ? String(cur) : "";
    input.style.left = (cx - 70) + "px";
    input.style.top = (cy - 15) + "px";
    input.style.width = "140px";
    input.style.height = "30px";
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const v = input.value.trim();
      edge.setLabels(v ? [{ attrs: { body: EDGE_LABEL_BODY, label: { ...EDGE_LABEL_TEXT, text: v } } }] : []);
      if (v) this.applyEdgeTextAngle(edge); // keep 90° rotation if set
      this.onChange(); input.remove(); this.labelInput = null;
    };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { done = true; input.remove(); this.labelInput = null; } });
    input.addEventListener("blur", commit);
    this.root.appendChild(input);
    this.labelInput = input;
    setTimeout(() => { input.focus(); input.select(); }, 10);
  }

  // ── Edge style (relationship type / weight / dash / color) ────────────────
  private edgeStyle(edge: Edge): EdgeStyle {
    return ((edge.getData() as { style?: EdgeStyle } | undefined)?.style) ?? {};
  }
  private setEdgeStyle(edge: Edge, patch: EdgeStyle) {
    const next: EdgeStyle = { ...this.edgeStyle(edge), ...patch };
    edge.setData({ ...(edge.getData() as object), style: next });
    this.applyEdgeStyle(edge);
    this.onChange();
  }
  // Render the edge's stored style onto its line + markers.
  private applyEdgeStyle(edge: Edge, selected = false) {
    const st = this.edgeStyle(edge);
    const color = st.stroke || EDGE_STROKE;
    edge.attr("line/stroke", selected ? ACCENT : color, { silent: true });
    edge.attr("line/strokeWidth", st.width ?? 1.8, { silent: true });
    edge.attr("line/strokeDasharray", EDGE_DASHES[st.dash ?? "solid"] ?? "", { silent: true });
    edge.attr("line/sourceMarker", buildMarker(st.start ?? "none", color) as never, { silent: true });
    edge.attr("line/targetMarker", buildMarker(st.end ?? "arrow", color) as never, { silent: true });
    if (st.shape || st.jump) this.applyEdgeShape(edge);
    // Attrs were set silently (no save spam) — force the edge view to repaint so
    // marker/stroke changes show immediately instead of only after reload.
    const view = this.graph.findViewByCell(edge) as { update?: () => void } | null;
    view?.update?.();
  }
  // Line shape (orthogonal/elbow/straight/curved) — skip seq/mindmap (special routing).
  // A line jump (arc/gap) overrides the connector with X6's native jumpover.
  private applyEdgeShape(edge: Edge) {
    const sid = edge.getSourceCellId() ?? undefined;
    if (this.isSeqLifeline(sid) || this.isMindmapNode(sid)) return;
    const st = this.edgeStyle(edge);
    const p = EDGE_SHAPES[st.shape ?? "orthogonal"] ?? EDGE_SHAPES.orthogonal;
    edge.setRouter(p.router as never);
    const jump = EDGE_JUMPS[st.jump ?? "none"];
    if (jump && jump !== "none") {
      edge.setConnector({ name: "jumpover", args: { type: jump, size: 6 } } as never);
    } else {
      edge.setConnector(p.connector as never);
    }
  }
  // Reverse arrow direction = swap the two endpoints.
  private reverseEdge(edge: Edge) {
    const s = edge.getSource(); const t = edge.getTarget();
    edge.prop("source", t, { rewrite: true });
    edge.prop("target", s, { rewrite: true });
    this.onChange();
  }
  // Rotate the edge label 0° ↔ 90°.
  private applyEdgeTextAngle(edge: Edge) {
    const ang = this.edgeStyle(edge).textAngle ?? 0;
    const labels = edge.getLabels();
    if (!labels.length) return;
    const text = (labels[0] as { attrs?: { label?: { text?: string } } })?.attrs?.label?.text;
    if (text == null) return;
    edge.setLabels([{ attrs: { body: EDGE_LABEL_BODY, label: { ...EDGE_LABEL_TEXT, text, transform: ang ? `rotate(${ang})` : null } } }]);
  }
  private toggleEdgeTextAngle(edge: Edge) {
    const cur = this.edgeStyle(edge).textAngle ?? 0;
    this.setEdgeStyle(edge, { textAngle: cur === 90 ? 0 : 90 });
    this.applyEdgeTextAngle(edge);
  }

  // Line + marker preview. side="start" mirrors it (marker on the left).
  private markerSvg(kind: string, side: "start" | "end" = "end"): string {
    const head: Record<string, string> = {
      none: "",
      arrow: `<path d="M14 2 23 8 14 14 Z" fill="currentColor"/>`,
      "arrow-open": `<path d="M14 2 23 8 14 14" fill="none" stroke="currentColor" stroke-width="1.7"/>`,
      triangle: `<path d="M12 1 23 8 12 15 Z" fill="var(--pg-surface)" stroke="currentColor" stroke-width="1.4"/>`,
      "triangle-f": `<path d="M12 1 23 8 12 15 Z" fill="currentColor"/>`,
      diamond: `<path d="M11 8 17 3 23 8 17 13 Z" fill="currentColor"/>`,
      "diamond-o": `<path d="M11 8 17 3 23 8 17 13 Z" fill="var(--pg-surface)" stroke="currentColor" stroke-width="1.4"/>`,
      circle: `<circle cx="19" cy="8" r="3.6" fill="var(--pg-surface)" stroke="currentColor" stroke-width="1.4"/>`,
      "circle-f": `<circle cx="19" cy="8" r="3.8" fill="currentColor"/>`,
      crow: `<path d="M24 8 13 2 M24 8 13 8 M24 8 13 14" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
      bar: `<path d="M19 2 19 14" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
      "crow-bar": `<path d="M24 8 14 2 M24 8 14 8 M24 8 14 14 M12 2 12 14" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
      "bar-bar": `<path d="M16 2 16 14 M20 2 20 14" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
    };
    const crowKinds = new Set(["crow", "bar", "crow-bar", "bar-bar"]);
    const lineEnd = kind === "none" ? 25 : crowKinds.has(kind) ? 12 : 13;
    const inner = `<line x1="1" y1="8" x2="${lineEnd}" y2="8" stroke="currentColor" stroke-width="1.6"/>${head[kind] ?? ""}`;
    const body = side === "start" ? `<g transform="translate(26,0) scale(-1,1)">${inner}</g>` : inner;
    return `<svg viewBox="0 0 26 16" width="26" height="16">${body}</svg>`;
  }

  private showEdgeBar(edge: Edge) {
    const bar = this.edgeBar;
    if (!bar) return;
    bar.innerHTML = "";
    const st = this.edgeStyle(edge);
    const caret = `<span class="lk-cb-caret">▾</span>`;
    const mkBtn = (html: string, title: string, fn: (ev: MouseEvent) => void) => {
      const b = el("button", "lk-cb-btn", html); b.title = title; b.onclick = fn; return b;
    };
    // 1) start marker ▾
    bar.appendChild(mkBtn(this.markerSvg(st.start ?? "none", "start") + caret, "Ký hiệu đầu trái",
      (ev) => this.openEdgeMarkerPopup(edge, "start", ev.currentTarget as HTMLElement)));
    // 2) reverse direction
    bar.appendChild(mkBtn(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M21 7H7a4 4 0 0 0-4 4"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h14a4 4 0 0 0 4-4"/></svg>`,
      "Đảo chiều", () => { this.reverseEdge(edge); this.showEdgeBar(edge); }));
    // 3) end marker ▾
    bar.appendChild(mkBtn(this.markerSvg(st.end ?? "arrow", "end") + caret, "Ký hiệu đầu phải",
      (ev) => this.openEdgeMarkerPopup(edge, "end", ev.currentTarget as HTMLElement)));
    bar.appendChild(el("div", "lk-cb-sep"));
    // 4) color
    bar.appendChild(mkBtn(`<span class="lk-color-dot" style="background:${st.stroke || EDGE_STROKE}"></span>`, "Màu mũi tên",
      (ev) => this.openEdgeColorPopup(edge, ev.currentTarget as HTMLElement)));
    bar.appendChild(el("div", "lk-cb-sep"));
    // 5) line style (shape + dash + weight) ▾
    bar.appendChild(mkBtn(
      `<svg viewBox="0 0 24 14" width="24" height="14"><path d="M2 11 H10 V3 H22" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>` + caret,
      "Kiểu đường", (ev) => this.openEdgeLinePopup(edge, ev.currentTarget as HTMLElement)));
    bar.appendChild(el("div", "lk-cb-sep"));
    // 6) add / edit text on the line
    bar.appendChild(mkBtn(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7h10M10 7v11"/><path d="M17 12h5M19.5 9.5v5"/></svg>`,
      "Thêm / sửa chữ", () => this.editEdgeLabel(edge)));
    // 7) rotate text 90°
    bar.appendChild(mkBtn(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 8 8l4 10M5.2 15h5.6"/><path d="M17 8v9M17 17l-2.2-2.2M17 17l2.2-2.2"/></svg>`,
      "Xoay chữ 90°", () => { this.toggleEdgeTextAngle(edge); }));
    bar.appendChild(el("div", "lk-cb-sep"));
    bar.appendChild(mkBtn("🗑", "Xóa", () => { this.graph.removeCells([edge]); this.hideEdgeBar(); }));

    // Position above the edge midpoint; flip below if it would clip the top edge.
    const bbox = edge.getBBox(); const s = this.graph.scale().sx; const t = this.graph.translate();
    const cx = (bbox.x + bbox.width / 2) * s + t.tx;
    const cy = (bbox.y + bbox.height / 2) * s + t.ty;
    bar.style.display = "flex";
    const bw = bar.offsetWidth || 360;
    const bh = bar.offsetHeight || 46;
    const rw = this.root.clientWidth; const rh = this.root.clientHeight;
    const gap = 34;
    let top = cy - bh - gap;                       // above
    if (top < 8) top = cy + gap;                   // flip below when clipped at top
    top = Math.min(top, rh - bh - 8);
    bar.style.left = Math.max(8, Math.min(cx - bw / 2, rw - bw - 8)) + "px";
    bar.style.top = Math.max(8, top) + "px";
  }
  private hideEdgeBar() { if (this.edgeBar) this.edgeBar.style.display = "none"; }

  private openEdgeMarkerPopup(edge: Edge, which: "start" | "end", anchor: HTMLElement) {
    const grid = el("div", "lk-marker-grid");
    const cur = which === "start" ? (this.edgeStyle(edge).start ?? "none") : (this.edgeStyle(edge).end ?? "arrow");
    for (const kind of EDGE_MARKER_KINDS) {
      const cell = el("div", "lk-marker-cell" + (kind === cur ? " on" : ""), this.markerSvg(kind, which));
      cell.title = EDGE_MARKER_LABEL[kind] ?? kind;
      cell.onclick = () => { this.setEdgeStyle(edge, which === "start" ? { start: kind } : { end: kind }); this.hidePopup(); this.showEdgeBar(edge); };
      grid.appendChild(cell);
    }
    this.showPopup(grid, anchor);
  }
  // Line popup: shape (orthogonal/elbow/straight/curved) + dash + weight.
  private openEdgeLinePopup(edge: Edge, anchor: HTMLElement) {
    const st = this.edgeStyle(edge);
    const wrap = el("div", "lk-line-popup");
    const shapes: Array<[string, string]> = [
      ["orthogonal", `<path d="M2 12 H8 V2 H16" fill="none" stroke="currentColor" stroke-width="1.8"/>`],
      ["elbow", `<path d="M2 12 H10 V2 H16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/>`],
      ["straight", `<line x1="2" y1="13" x2="16" y2="2" stroke="currentColor" stroke-width="1.8"/>`],
      ["curved", `<path d="M2 12 C8 12 8 3 16 3" fill="none" stroke="currentColor" stroke-width="1.8"/>`],
    ];
    const shapeRow = el("div", "lk-line-row");
    for (const [key, svg] of shapes) {
      const b = el("div", "lk-line-cell" + ((st.shape ?? "orthogonal") === key ? " on" : ""), `<svg viewBox="0 0 18 14" width="22" height="16">${svg}</svg>`);
      b.title = key;
      b.onclick = () => { this.setEdgeStyle(edge, { shape: key }); this.applyEdgeShape(edge); this.showEdgeBar(edge); };
      shapeRow.appendChild(b);
    }
    wrap.appendChild(shapeRow);
    const dashRow = el("div", "lk-line-row");
    ([["solid", ""], ["dashed", "5 3"], ["dotted", "1.5 3"]] as Array<[string, string]>).forEach(([key, dash]) => {
      const b = el("div", "lk-line-cell" + ((st.dash ?? "solid") === key ? " on" : ""),
        `<svg viewBox="0 0 26 8" width="30" height="10"><line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ""}/></svg>`);
      b.onclick = () => { this.setEdgeStyle(edge, { dash: key }); this.showEdgeBar(edge); };
      dashRow.appendChild(b);
    });
    wrap.appendChild(dashRow);
    const wRow = el("div", "lk-line-row");
    EDGE_WIDTHS.forEach((w, i) => {
      const b = el("div", "lk-line-cell" + (Math.abs((st.width ?? 1.8) - w) < 0.2 ? " on" : ""),
        `<svg viewBox="0 0 26 8" width="30" height="10"><line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="${w}"/></svg>`);
      b.title = ["Mảnh", "Vừa", "Đậm"][i];
      b.onclick = () => { this.setEdgeStyle(edge, { width: w }); this.showEdgeBar(edge); };
      wRow.appendChild(b);
    });
    wrap.appendChild(wRow);
    // Line jumps (crossing): none / arc / gap — for cleaner overlapping flowcharts.
    const jRow = el("div", "lk-line-row");
    const jumps: Array<[string, string, string]> = [
      ["none", "Cắt thẳng", `<line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="1.8"/>`],
      ["arc", "Vòng cung", `<path d="M1 4 H9 A3 3 0 0 1 17 4 H25" fill="none" stroke="currentColor" stroke-width="1.8"/>`],
      ["gap", "Hở", `<path d="M1 4 H9 M17 4 H25" fill="none" stroke="currentColor" stroke-width="1.8"/>`],
    ];
    for (const [key, title, svg] of jumps) {
      const b = el("div", "lk-line-cell" + ((st.jump ?? "none") === key ? " on" : ""),
        `<svg viewBox="0 0 26 8" width="30" height="10">${svg}</svg>`);
      b.title = title;
      b.onclick = () => { this.setEdgeStyle(edge, { jump: key }); this.applyEdgeShape(edge); this.showEdgeBar(edge); };
      jRow.appendChild(b);
    }
    wrap.appendChild(jRow);
    this.showPopup(wrap, anchor);
  }
  private openEdgeColorPopup(edge: Edge, anchor: HTMLElement) {
    const wrap = el("div", "lk-color-popup");
    const row = el("div", "lk-color-grid");
    for (const c of FILL_SWATCHES) {
      if (c === "transparent") continue;
      const sw = el("div", "lk-swatch"); sw.style.background = c;
      sw.onclick = () => { this.setEdgeStyle(edge, { stroke: c }); this.applyEdgeStyle(edge, true); this.hidePopup(); this.showEdgeBar(edge); };
      row.appendChild(sw);
    }
    // "+" → open the HSV picker for a custom edge color.
    const plus = el("div", "lk-swatch lk-swatch-add", "+");
    plus.onclick = () => this.openColorWheel(this.edgeStyle(edge).stroke || EDGE_STROKE,
      (hx) => { this.setEdgeStyle(edge, { stroke: hx }); this.applyEdgeStyle(edge, true); }, anchor);
    row.appendChild(plus);
    wrap.appendChild(row);
    this.showPopup(wrap, anchor);
  }

  private isSeqLifeline(cellId: string | undefined): boolean {
    if (!cellId) return false;
    const c = this.graph.getCellById(cellId);
    if (!c || !c.isNode()) return false;
    const k = (c as Node).getData()?.kind as string | undefined;
    return !!k && SEQ_LIFELINE_KINDS.has(k);
  }

  private applySeqRoutingIfNeeded(edge: Edge): void {
    const srcId = edge.getSourceCellId() ?? undefined;
    const tgtId = edge.getTargetCellId() ?? undefined;
    if (!this.isSeqLifeline(srcId) || !this.isSeqLifeline(tgtId)) return;
    edge.setRouter("normal");
    edge.setConnector("seq-msg");
    // Auto-stack: place this new message just below the lowest existing
    // message between the same lifelines so connections don't pile at one Y.
    if (typeof (edge.getData() as { y?: number } | undefined)?.y === "number") return;
    const peers = this.graph.getEdges().filter((other) => {
      if (other.id === edge.id) return false;
      const os = other.getSourceCellId(), ot = other.getTargetCellId();
      const same = (os === srcId && ot === tgtId) || (os === tgtId && ot === srcId);
      return same && other.getConnector() === "seq-msg";
    });
    const baseY = edge.getSourcePoint()?.y ?? 100;
    const lowest = peers.reduce((acc, p) => {
      const y = (p.getData() as { y?: number } | undefined)?.y ?? p.getSourcePoint()?.y ?? baseY;
      return Math.max(acc, y);
    }, baseY - 30);
    edge.setData({ ...(edge.getData() ?? {}), y: lowest + 30 });
  }

  /**
   * Auto-flip BPMN event labels to the opposite side of any connected edge
   * (mimics bpmn.io). If an edge enters/exits below the node centre, label moves
   * up; if above, label stays at the default bottom.
   */
  private refreshBpmnEventLabels(): void {
    for (const n of this.graph.getNodes()) {
      const k = this.nodeKind(n);
      const isEvent = k.startsWith("bpmn-start") || k.startsWith("bpmn-end") || k.startsWith("bpmn-intermediate");
      const isGw = k.startsWith("bpmn-gateway");
      if (!isEvent && !isGw) continue;
      const cy = n.getPosition().y + n.getSize().height / 2;
      let bottom = false, top = false;
      for (const e of this.graph.getEdges()) {
        const s = e.getSourceCellId(), t = e.getTargetCellId();
        if (s !== n.id && t !== n.id) continue;
        const otherId = s === n.id ? t : s;
        if (!otherId) continue;
        const other = this.graph.getCellById(otherId);
        if (!other || !other.isNode()) continue;
        const o = other as Node;
        const oc = o.getPosition().y + o.getSize().height / 2;
        if (oc > cy + 4) bottom = true;
        else if (oc < cy - 4) top = true;
      }
      // Flip up only when bottom is busy and top is free.
      const flipUp = bottom && !top;
      const view = this.graph.findViewByCell(n) as { container?: Element } | null;
      const el = view?.container?.querySelector?.(isGw ? ".bp-gw" : ".bp-event") as HTMLElement | null;
      if (el) el.classList.toggle("label-top", flipUp);
    }
  }

  private isMindmapNode(cellId: string | undefined): boolean {
    if (!cellId) return false;
    const c = this.graph.getCellById(cellId);
    if (!c || !c.isNode()) return false;
    const k = (c as Node).getData()?.kind as string | undefined;
    return !!k && MM_KINDS.has(k);
  }

  private applyMindmapRoutingIfNeeded(edge: Edge): void {
    const srcId = edge.getSourceCellId() ?? undefined;
    const tgtId = edge.getTargetCellId() ?? undefined;
    if (!this.isMindmapNode(srcId) || !this.isMindmapNode(tgtId)) return;
    // Anchor at parent's side-center → child's opposite-center so the bezier
    // always starts/ends at a clean horizontal point (no scattered arrows).
    const src = this.graph.getCellById(srcId!) as Node;
    const tgt = this.graph.getCellById(tgtId!) as Node;
    const sc = src.getPosition().x + src.getSize().width / 2;
    const tc = tgt.getPosition().x + tgt.getSize().width / 2;
    const right = tc >= sc;
    edge.setSource({ cell: srcId!, port: right ? "right" : "left" });
    edge.setTarget({ cell: tgtId!, port: right ? "left" : "right" });
    edge.setRouter("normal");
    edge.setConnector("mm-edge");
  }

  // ── Model load / serialize ───────────────────────────────────────────────
  loadModel(model: CanvasModel) {
    this.graph.startBatch("load");
    this.graph.clearCells();
    for (const n of model.nodes) {
      const a = n.attrs ?? {};
      const style = (a.style as NodeStyle) ?? {};
      const extra: NodeExtra = { cols: a.cols as ErdCol[] | undefined, fields: a.fields as string[] | undefined, methods: a.methods as string[] | undefined, who: a.who as string | undefined, labelOffset: a.labelOffset as { x: number; y: number } | undefined, lanes: a.lanes as Array<{ id: string; label: string }> | undefined };
      this.addHtmlNode(n.shape, n.x, n.y, n.width, n.height, n.label, style, n.id, extra);
    }
    for (const e of model.edges) {
      const seq = this.isSeqLifeline(e.source) && this.isSeqLifeline(e.target);
      const mm = !seq && this.isMindmapNode(e.source) && this.isMindmapNode(e.target);
      // Sequence message labels sit ABOVE the line so a short message still shows
      // its full arrow underneath the text (default label position covers the line).
      // User-dragged label position (`e.labelPos`) wins over the seq default.
      const lblAttrs = { body: EDGE_LABEL_BODY, label: { ...EDGE_LABEL_TEXT, text: e.label } };
      const labelSpec = e.label
        ? [e.labelPos
            ? { attrs: lblAttrs, position: e.labelPos }
            : seq
              ? { attrs: lblAttrs, position: { distance: 0.5, offset: -10 } }
              : { attrs: lblAttrs }]
        : [];
      // Return messages (response arrows) render as a dashed line per design.
      const edgeAttrs = seq && e.ret
        ? { line: { ...EDGE_ATTRS.line, strokeDasharray: "5 4" } }
        : EDGE_ATTRS;
      const data: { y?: number; ret?: boolean; style?: EdgeStyle } = {};
      if (seq) { data.y = typeof e.y === "number" ? e.y : undefined; data.ret = e.ret || undefined; }
      if (e.style) data.style = e.style;
      const created = this.graph.addEdge({
        id: e.id, source: { cell: e.source, port: e.sourcePort }, target: { cell: e.target, port: e.targetPort },
        router: seq || mm ? "normal" : SMART_ROUTER,
        connector: seq ? "seq-msg" : mm ? "mm-edge" : CONNECTOR,
        attrs: edgeAttrs,
        labels: labelSpec,
        vertices: e.vertices ?? [],
        // Sequence Y is read by the seq-msg connector from edge data at draw time.
        data,
      });
      if (e.style) this.applyEdgeStyle(created); // custom relationship style overrides defaults
      if (mm) this.applyMindmapRoutingIfNeeded(created); // re-anchor right/left ports (old boards had none)
    }
    this.graph.stopBatch("load");
    // Auto-grow every mindmap node once the foreignObject DOM is mounted &
    // measurable — covers long labels saved with too-small initial height.
    setTimeout(() => {
      this.graph.getNodes().forEach((n) => {
        const k = this.nodeKind(n);
        if (k === "mm-root" || k === "mm-branch" || k === "mm-leaf") this.autoGrowMindmapNode(n);
      });
      this.refreshMinimap();
      this.refreshBpmnEventLabels();
    }, 80);
    if (model.nodes.length) this.fitWhenReady();
  }

  // In Obsidian the view container may have 0 size at load time (layout not
  // measured yet) — zoomToFit then computes scale ≈ 0 and content vanishes.
  // Retry on animation frames until the mount has a real size, then fit.
  private fitWhenReady(tries = 0): void {
    const r = this.graphMount.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      if (tries < 120) requestAnimationFrame(() => this.fitWhenReady(tries + 1));
      return;
    }
    this.graph.resize(r.width, r.height);
    this.graph.zoomToFit({ padding: 40, maxScale: 1.2 });
    this.updateZoom();
  }

  getModel(): CanvasModel {
    const nodes = this.graph.getNodes().map((n) => {
      const p = n.getPosition(); const s = n.getSize(); const ex = this.nodeExtra(n);
      return {
        id: n.id, shape: this.nodeKind(n), x: p.x, y: p.y, width: s.width, height: s.height,
        label: this.nodeLabel(n),
        attrs: { style: this.nodeStyle(n), cols: ex.cols, fields: ex.fields, methods: ex.methods, who: ex.who, labelOffset: ex.labelOffset, lanes: ex.lanes },
      };
    });
    const edges = this.graph.getEdges().map((e) => {
      const src = e.getSource() as { cell: string; port?: string };
      const tgt = e.getTarget() as { cell: string; port?: string };
      const d = (e.getData() as { y?: number; ret?: boolean; style?: EdgeStyle } | undefined) ?? {};
      const verts = e.getVertices();
      const lbl = e.getLabels()?.[0] as { attrs?: { label?: { text?: string } }; position?: { distance?: number; offset?: number | { x: number; y: number } } } | undefined;
      const labelPos = lbl?.position && (lbl.position.distance != null || lbl.position.offset != null)
        ? { distance: lbl.position.distance, offset: lbl.position.offset }
        : undefined;
      return {
        id: e.id, source: src.cell, sourcePort: src.port, target: tgt.cell, targetPort: tgt.port,
        label: lbl?.attrs?.label?.text,
        labelPos,
        y: typeof d.y === "number" ? d.y : undefined,
        ret: d.ret ? true : undefined,
        style: d.style && Object.keys(d.style).length ? d.style : undefined,
        vertices: verts && verts.length ? verts.map((v) => ({ x: v.x, y: v.y })) : undefined,
      };
    });
    return { nodes, edges };
  }

  nodeCount(): number { return this.graph.getNodes().length; }

  /**
   * n8n-style auto layout (longest-path ranking).
   * @param dir "LR" = left→right (default), "TB" = top→bottom.
   * Skips mindmap & sequence nodes (own layouts).
   */
  /**
   * Industry-standard auto layout via dagre (Sugiyama). Steps:
   * 1. Classify nodes (skip mindmap/sequence; mark containers).
   * 2. Detect container ⊃ child by bbox containment from current positions.
   * 3. Feed only LEAF nodes to dagre.
   * 4. Preserve the centre of the moved cluster so the board doesn't jump.
   * 5. Apply positions.
   * 6. Auto-resize each container to hug its (now relocated) children.
   * 7. Reset edge waypoints + re-anchor ports to the flow direction.
   * 8. zoomToFit + minimap + label-flip refresh.
   */
  autoLayout(dir: "LR" | "TB" = "LR"): void {
    const horiz = dir === "LR";
    const nodes = this.graph.getNodes();
    // 1. Classify.
    const layoutable = nodes.filter((n) => {
      const k = this.nodeKind(n);
      return !k.startsWith("mm-") && !k.startsWith("sq-");
    });
    if (layoutable.length < 2) return;
    const containers = layoutable.filter((n) => CONTAINER_KINDS.has(this.nodeKind(n)));
    const containerIds = new Set(containers.map((c) => c.id));
    const leaves = layoutable.filter((n) => !containerIds.has(n.id));
    if (leaves.length < 2) return;

    // 2. Parent-child by bbox containment (record BEFORE moving anything).
    const childOf = new Map<string, string[]>();
    containers.forEach((c) => childOf.set(c.id, []));
    {
      const cb = new Map<string, { x: number; y: number; w: number; h: number }>();
      containers.forEach((c) => { const p = c.getPosition(); const s = c.getSize(); cb.set(c.id, { x: p.x, y: p.y, w: s.width, h: s.height }); });
      for (const lf of leaves) {
        const p = lf.getPosition(); const s = lf.getSize();
        const cx = p.x + s.width / 2, cy = p.y + s.height / 2;
        for (const [cid, b] of cb) {
          if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) { childOf.get(cid)!.push(lf.id); break; }
        }
      }
    }

    // 4-prep. Record OLD centre of leaves so we can preserve viewport context.
    const oldCentre = (() => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const lf of leaves) {
        const p = lf.getPosition(); const s = lf.getSize();
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.width); maxY = Math.max(maxY, p.y + s.height);
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    })();

    // 3. Run dagre on leaves only.
    const g = new dagre.graphlib.Graph({ directed: true });
    g.setGraph({ rankdir: dir, nodesep: horiz ? 38 : 50, ranksep: horiz ? 90 : 80, ranker: "longest-path", marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const leafIds = new Set(leaves.map((n) => n.id));
    for (const lf of leaves) {
      const s = lf.getSize();
      g.setNode(lf.id, { width: s.width, height: s.height });
    }
    for (const e of this.graph.getEdges()) {
      const s = e.getSourceCellId(), t = e.getTargetCellId();
      if (s && t && s !== t && leafIds.has(s) && leafIds.has(t)) g.setEdge(s, t);
    }
    dagre.layout(g);

    // 4. New centre → offset to keep board context.
    const newCentre = (() => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const lf of leaves) {
        const n = g.node(lf.id) as { x: number; y: number; width: number; height: number };
        const left = n.x - n.width / 2, top = n.y - n.height / 2;
        minX = Math.min(minX, left); minY = Math.min(minY, top);
        maxX = Math.max(maxX, left + n.width); maxY = Math.max(maxY, top + n.height);
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    })();
    const offX = oldCentre.x - newCentre.x, offY = oldCentre.y - newCentre.y;

    // 5. Apply leaf positions.
    for (const lf of leaves) {
      const n = g.node(lf.id) as { x: number; y: number; width: number; height: number };
      lf.position(n.x - n.width / 2 + offX, n.y - n.height / 2 + offY);
    }

    // 6. Resize each container to hug its children + padding.
    for (const c of containers) {
      const kids = (childOf.get(c.id) ?? []).map((id) => this.graph.getCellById(id)).filter((x): x is Node => !!x && x.isNode());
      if (!kids.length) continue;
      const k = this.nodeKind(c);
      const pad = k === "bpmn-lane" || k === "bpmn-pool" ? 24 : 18;
      const headerW = k === "bpmn-lane" || k === "bpmn-pool" ? 30 : 0;            // vertical label band on left
      const headerH = k.startsWith("sq-frag") ? 22 : 0;                            // fragment tab on top
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const kd of kids) {
        const p = kd.getPosition(); const s = kd.getSize();
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.width); maxY = Math.max(maxY, p.y + s.height);
      }
      c.position(minX - pad - headerW, minY - pad - headerH);
      c.resize(maxX - minX + 2 * pad + headerW, maxY - minY + 2 * pad + headerH);
    }

    // 7. Reset edges (vertices + router/connector + ports) — skip mindmap/seq.
    const srcPort = horiz ? "right" : "bottom", tgtPort = horiz ? "left" : "top";
    for (const e of this.graph.getEdges()) {
      const sId = e.getSourceCellId(), tId = e.getTargetCellId();
      if (!sId || !tId) continue;
      if (this.isMindmapNode(sId) && this.isMindmapNode(tId)) continue;
      if (this.isSeqLifeline(sId) && this.isSeqLifeline(tId)) continue;
      e.setVertices([]);
      e.setSource({ cell: sId, port: srcPort });
      e.setTarget({ cell: tId, port: tgtPort });
      e.setRouter(SMART_ROUTER as never);
      e.setConnector(CONNECTOR as never);
      // Preserve any user edge style (dash/marker/jump/etc).
      this.applyEdgeStyle(e);
    }

    this.onChange();
    setTimeout(() => {
      this.graph.zoomToFit({ padding: 40, maxScale: 1.2 });
      this.updateZoom();
      this.refreshMinimap();
      this.refreshBpmnEventLabels();
    }, 30);
  }

  selectNode(id: string) {
    const cell = this.graph.getCellById(id);
    if (cell) this.graph.select(cell);
  }

  // ── Public API for the view top bar ──────────────────────────────────────
  undo() { if (this.graph.canUndo()) this.graph.undo(); }
  redo() { if (this.graph.canRedo()) this.graph.redo(); }
  duplicate() { this.duplicateSelection(); }
  deleteSelection() { const c = this.graph.getSelectedCells(); if (c.length) this.graph.removeCells(c); }
  fit() { this.graph.zoomToFit({ padding: 40, maxScale: 1.2 }); this.updateZoom(); }

  /** Standalone, fully-styled SVG string (tokens + node CSS inlined, white bg). */
  exportSVG(): string {
    const SVGNS = "http://www.w3.org/2000/svg";
    const svgEl = (this.graph as unknown as { view: { svg: SVGSVGElement } }).view.svg;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    const bbox = svgEl.getBBox?.();
    const pad = 24;
    let x = 0, y = 0, w = 800, h = 600;
    if (bbox) {
      x = bbox.x - pad; y = bbox.y - pad;
      w = Math.ceil(bbox.width + pad * 2); h = Math.ceil(bbox.height + pad * 2);
      clone.setAttribute("width", String(w));
      clone.setAttribute("height", String(h));
      clone.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    }
    clone.setAttribute("xmlns", SVGNS);
    clone.classList.add("lk-root"); // so `.lk-root …` selectors + tokens apply

    const style = document.createElementNS(SVGNS, "style");
    style.textContent = collectPluginCss();
    const bg = document.createElementNS(SVGNS, "rect");
    bg.setAttribute("x", String(x)); bg.setAttribute("y", String(y));
    bg.setAttribute("width", String(w)); bg.setAttribute("height", String(h));
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild);
    clone.insertBefore(style, clone.firstChild);

    return new XMLSerializer().serializeToString(clone);
  }

  /** Rasterize the standalone SVG to a PNG Blob at the given pixel scale. */
  async exportPNG(scale = 2): Promise<Blob> {
    const svg = this.exportSVG();
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG load failed"));
      img.src = url;
    });
    const w = img.width || 800, h = img.height || 600;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
    );
  }

  /** A4 single-page PDF (orientation auto-picked from diagram aspect). Returns raw bytes. */
  async exportPDF(): Promise<Uint8Array> {
    const { jsPDF } = await import("jspdf");
    const blob = await this.exportPNG(2);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error("read PNG failed"));
      r.readAsDataURL(blob);
    });
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("img load failed"));
      img.src = dataUrl;
    });

    const aspect = img.width / Math.max(1, img.height);
    const orientation = aspect >= 1 ? "landscape" : "portrait";
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const maxW = pageW - 2 * margin, maxH = pageH - 2 * margin;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const drawW = img.width * scale, drawH = img.height * scale;
    const x = (pageW - drawW) / 2, y = (pageH - drawH) / 2;
    pdf.addImage(dataUrl, "PNG", x, y, drawW, drawH);
    return new Uint8Array(pdf.output("arraybuffer"));
  }

  /** Best-effort Mermaid `flowchart TD` export of the current node-edge model. */
  exportMermaid(): string {
    const model = this.getModel();
    const safeId = (raw: string, i: number) => "n" + (raw.replace(/[^a-zA-Z0-9]/g, "") || String(i));
    const idMap = new Map<string, string>();
    model.nodes.forEach((n, i) => idMap.set(n.id, safeId(n.id, i)));

    const esc = (s: string) => `"${(s || " ").replace(/"/g, "&quot;").replace(/\n/g, " ")}"`;
    const wrap = (kind: string, label: string): string => {
      const t = esc(label);
      if (kind === "fc-start" || kind === "fc-end" || kind === "st-initial" || kind === "st-final") return `([${t}])`;
      if (kind === "fc-decision" || kind === "bs-diamond" || kind === "st-choice" || kind.startsWith("bpmn-gateway")) return `{${t}}`;
      if (kind === "fc-io") return `[/${t}/]`;
      if (kind === "bs-ellipse" || kind === "fc-document") return `(${t})`;
      if (kind === "bs-rounded" || kind === "st-state") return `(${t})`;
      return `[${t}]`;
    };

    const lines = ["flowchart TD"];
    for (const n of model.nodes) lines.push(`  ${idMap.get(n.id)}${wrap(n.shape, n.label)}`);
    for (const e of model.edges) {
      const s = idMap.get(e.source), t = idMap.get(e.target);
      if (!s || !t) continue;
      lines.push(e.label ? `  ${s} -->|${esc(e.label)}| ${t}` : `  ${s} --> ${t}`);
    }
    return lines.join("\n");
  }

  destroy() {
    this.commitLabel();
    this.cancelFlyoutClose();
    this.closeFlyoutNow();
    if (this.wheelPan) this.graphMount.removeEventListener("wheel", this.wheelPan);
    this.graph.dispose();
  }
}
