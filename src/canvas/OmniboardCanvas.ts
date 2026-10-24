import { fixInnerMessageFlows } from "../io/bpmn/innerFlows";
import { Graph, Node, Edge, Path, type Cell, type EdgeView } from "@antv/x6";
import { Selection } from "@antv/x6-plugin-selection";
import { Clipboard } from "@antv/x6-plugin-clipboard";
import { History } from "@antv/x6-plugin-history";
import { Keyboard } from "@antv/x6-plugin-keyboard";
import { Snapline } from "@antv/x6-plugin-snapline";
import { Transform } from "@antv/x6-plugin-transform";
import type { PaletteItem, ShapeCategory, CanvasModel, BoardAppState } from "./types";
import { shapeIcon } from "./shapes/index";
import { FIXED_PORT_IDS, fixedPort, nearestFixedPortInBox, pickDropTarget, type FixedPortId } from "./shapes/ports";
import { nodeHtml, defaultErdCols, defaultUml, BPMN_DEFAULT_FONT_SIZE, type NodeStyle, type NodeExtra, type ErdCol } from "./htmlNode";
import { buildErdColumnPorts, ERD_COL_PORT_GROUPS } from "./erdPorts";
import { collectPluginCss } from "./staticRender";
import { addChildLane, allLaneIds, asStackLanes, fromStackLanes, fromStackLanesDeep, growLaneAt, laneBandOf, laneHeights, leafLaneAt, leafLaneSize, mergeChildLanes, removeChildLane, resizeLaneBoundary, resizePoolLanes, setSiblings, splitLane } from "./laneLayout";
import { poolDropAnchor } from "./poolConnect";
import { AVOID_ROUTER, registerAvoidRouter } from "./avoidRouter";
import { layoutInLanes, type LayoutNode, type LayoutPool } from "./laneAwareLayout";
import { hasExternalLabel } from "../io/bpmn/labelGeometry";
import { SUBPROCESS_KINDS, closedLayout, openLayout } from "./subprocessLayout";
import { triggerChoices } from "../io/bpmn/eventTriggers";
import { clampDelta, planSpace, shiftVertices, type Axis, type SpaceBox } from "./spaceTool";
import { findMatches, stepIndex } from "./search";
import { ATTACH_DISTANCE, distanceToBorder, eventLabelSide, followHost, hostSide, pickHost, snapToHostBorder, type Box } from "./boundaryLayout";
import {
  alignLeft, alignCenterH, alignRight,
  alignTop, alignMiddleV, alignBottom,
  distributeH, distributeV,
  type AlignCell, type AlignResult,
} from "./bulkAlign";
import * as dagre from "@dagrejs/dagre";

export type { PaletteItem, ShapeCategory, CanvasModel };

export interface SelectedNodeSnapshot {
  id: string;
  kind: string;
  label: string;
  attrs: Record<string, unknown>;
  style: NodeStyle;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

// Pie "Warm AI Productivity" palette (DESIGN.md): soft tints row + brand/accent row.
// Row 1 = transparent + light surfaces/tints; Row 2 = brand cores + saturated extras.
/** First entry = the default cream paper (stored as "no background"). */
const BOARD_BG_SWATCHES = ["#FFFCF5", "#FFFFFF", "#F8F9FA", "#F5F0E6", "#EEF4FA", "#F3F0FA"];
const BOARD_BG_SWATCHES_DARK = ["#1B1B1B", "#121212", "#1E2024", "#242424", "#1A2029", "#1F1C26"];
const GRID_DOT = { light: "#d4d0c8", dark: "#3a3a3a" };
const ICON_SVG = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON_MOON = ICON_SVG(`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`);
const ICON_SUN = ICON_SVG(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`);
const ICON_MENU = ICON_SVG(`<path d="M4 6h16M4 12h16M4 18h16"/>`);
const FILL_SWATCHES = [
  "transparent", "#FFFFFF", "#FFF4DE", "#9ED6F5", "#D6EFE0", "#FFF3BF", "#F6DADA", "#ECE0F5",
  "#3B1F1A", "#5E8FB9", "#9ED6F5", "#34A853", "#FFD966", "#FF8800", "#7A2E2E", "#E5484D", "#8E51FF", "#86909C",
];

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
  else[r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// `orth` (not `manhattan`): manhattan is an obstacle-avoiding router that
// repeatedly fails ("Unable to execute manhattan algorithm, use orth instead")
// during the live connect-drag preview and on edges whose endpoints are pinned
// to precise boundary anchors — it then silently falls back to orth anyway, just
// with console spam. orth is the plain orthogonal router: right-angle segments
// that dock cleanly to the boundary anchor, no obstacle avoidance (which a
// user-arranged flowchart doesn't need, and bpmn.io doesn't do either).
// New arrows route around shapes (avoidRouter.ts); arrows saved with "orth" keep it.
const SMART_ROUTER = AVOID_ROUTER;
const CONNECTOR = { name: "rounded", args: { radius: 6 } };

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
const SPACE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 8 22 12 18 16"/><polyline points="6 8 2 12 6 16"/><line x1="2" x2="22" y1="12" y2="12"/></svg>`;
const HAND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6.5a1.5 1.5 0 0 0-3 0M15 10.5V5a1.5 1.5 0 0 0-3 0v5M12 10V6.5a1.5 1.5 0 0 0-3 0V11M9 11V8a1.5 1.5 0 0 0-3 0v6a6 6 0 0 0 6 6h1.5a5 5 0 0 0 5-5v-3"/></svg>`;
const ARROW_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const EDGE_ATTRS = { line: { stroke: EDGE_STROKE, strokeWidth: 1.8, targetMarker: { name: "block", width: 11, height: 8 } } };
// Edge label body — opaque pill so the label is hit-testable (X6 needs a body
// for the user to grab and drag); also wipes the line behind the text.
const EDGE_LABEL_BODY = { ref: "label", refX: -6, refY: -2, refWidth: "100%", refHeight: "100%", refWidth2: 12, refHeight2: 4, fill: "var(--pg-surface)", stroke: "none", rx: 4, ry: 4, cursor: "move" } as const;
// X6's native `text` attribute hook splits text by '\n' into <tspan> elements
// automatically. We also apply a positive absolute `textWrap.width` of 150px
// (matching bpmn.io) so that long single lines auto-wrap dynamically without
// needing a reference bounding box (which would render "-" on edge labels).
/** Effective default label size when a node has no explicit fontSize style. */
function defaultFontSizeFor(node: Node): number {
  return String(node.shape ?? "").startsWith("bpmn-") ? BPMN_DEFAULT_FONT_SIZE : 13;
}

const EDGE_LABEL_TEXT = { fill: "var(--pg-text)", fontSize: 12, fontFamily: "var(--font-body)", cursor: "move", textAnchor: "middle", textVerticalAnchor: "middle", textWrap: { width: 150, breakWord: true, ellipsis: false } } as const;

// ── Edge styling (relationship types) ──
export interface EdgeStyle {
  stroke?: string; width?: number; dash?: string; start?: string; end?: string; shape?: string; textAngle?: number; jump?: string;
  /** BPMN flow type (Đợt C). Picking one in the edge bar applies a preset of
   *  dash/start/end + a custom source marker; sequence resets to default. */
  flowType?: "sequence" | "default" | "message" | "conditional" | "association";
}

/** BPMN flow-type presets — pure style patches applied via setEdgeStyle. Đợt C. */
const FLOW_TYPE_PRESETS: Record<string, EdgeStyle> = {
  sequence: { dash: "solid", start: "none", end: "arrow" },
  default: { dash: "solid", start: "def-slash", end: "arrow" },
  message: { dash: "dashed", start: "circle", end: "triangle" },
  conditional: { dash: "solid", start: "diamond-o", end: "arrow" },
  association: { dash: "dotted", start: "none", end: "arrow-open" },
};
const FLOW_TYPE_LABEL: Record<string, string> = {
  sequence: "Sequence", default: "Default", message: "Message", conditional: "Conditional", association: "Association",
};
const EDGE_DASHES: Record<string, string> = { solid: "", dashed: "6 4", dotted: "2 4" };
type SpawnDir = "top" | "right" | "bottom" | "left";
type PortSide = SpawnDir;
const PORT_SIDE: Record<PortSide, PortSide> = { top: "top", right: "right", bottom: "bottom", left: "left" };
const OPPOSITE_SIDE: Record<PortSide, PortSide> = { top: "bottom", right: "left", bottom: "top", left: "right" };
const PORT_CONNECTION_POINT = { name: "anchor" } as const;
const NON_CONNECTABLE_PORT_KINDS = new Set<string>(["bpmn-lane", "bpmn-pool", "bpmn-group"]);
const ACT_WIDTH = 12; // fixed width of the sequence activation bar
// Container/frame shapes that should render behind regular nodes.
const FRAME_KINDS = new Set<string>([
  "sq-frag-alt", "sq-frag-opt", "sq-frag-loop", "sq-frag-par",
  "bpmn-subprocess", "bpmn-transaction", "bpmn-event-subprocess", "bpmn-adhoc-subprocess",
  "bpmn-lane", "bpmn-pool", "bpmn-annotation", "bpmn-group",
]);
/** z of a frame shape: behind regular nodes, and pools / lanes behind every
 *  other frame — a sub-process or group drawn inside a pool must stay on top
 *  of it (clickable, draggable). Nested frames add their depth. */
const frameZ = (kind: string, depth = 0): number =>
  (kind === "bpmn-pool" || kind === "bpmn-lane" ? -2000 : -1000) + depth;
// Container shapes whose bbox should hug their children after auto-layout.
// (annotation = sticky note, NOT a container — stays as a normal node.)
const CONTAINER_KINDS = new Set<string>([
  "sq-frag-alt", "sq-frag-opt", "sq-frag-loop", "sq-frag-par",
  "bpmn-subprocess", "bpmn-transaction", "bpmn-event-subprocess", "bpmn-adhoc-subprocess",
  "bpmn-lane", "bpmn-pool", "bpmn-group",
]);

// BPMN Đợt D — context-bar pickers
const BPMN_TRIGGER_LABEL: Record<string, string> = {
  none: "Không", message: "Message", timer: "Timer", signal: "Signal", error: "Error",
  escalation: "Escalation", compensation: "Compensation", conditional: "Conditional",
  link: "Link", cancel: "Cancel", terminate: "Terminate", multiple: "Multiple",
  "parallel-multiple": "Parallel Multiple",
};
const BPMN_ACTIVITY_KINDS = new Set<string>([
  "bpmn-task", "bpmn-task-user", "bpmn-task-service", "bpmn-task-script",
  "bpmn-task-manual", "bpmn-task-send", "bpmn-task-receive", "bpmn-task-rule",
  "bpmn-subprocess", "bpmn-transaction", "bpmn-event-subprocess", "bpmn-call-activity",
]);
const BPMN_EVENT_KINDS = new Set<string>([
  "bpmn-event-start", "bpmn-event-intermediate", "bpmn-event-end",
]);
const BPMN_MARKERS = ["loop", "mi-par", "mi-seq", "adhoc", "compensation"] as const;
const BPMN_MARKER_LABEL: Record<string, string> = {
  loop: "Loop", "mi-par": "Multi-Instance Parallel", "mi-seq": "Multi-Instance Sequential",
  adhoc: "Ad-Hoc", compensation: "Compensation",
};

/** Migrate legacy BPMN event kinds (e.g. `bpmn-start-message`, `bpmn-end-terminate`)
 *  to the unified Đợt A schema: 3 kinds (bpmn-event-start/intermediate/end) +
 *  trigger/throwing in NodeExtra. Identity for already-unified or non-event kinds. */
function migrateBpmnEventKind(shape: string, extra: NodeExtra): { kind: string; extra: NodeExtra } {
  // Map (legacyKind) → (unifiedKind, triggerPatch)
  const M: Record<string, { kind: string; patch: Partial<NodeExtra> }> = {
    "bpmn-start": { kind: "bpmn-event-start", patch: {} },
    "bpmn-start-message": { kind: "bpmn-event-start", patch: { trigger: "message" } },
    "bpmn-start-timer": { kind: "bpmn-event-start", patch: { trigger: "timer" } },
    "bpmn-intermediate": { kind: "bpmn-event-intermediate", patch: {} },
    "bpmn-intermediate-message": { kind: "bpmn-event-intermediate", patch: { trigger: "message" } },
    "bpmn-intermediate-timer": { kind: "bpmn-event-intermediate", patch: { trigger: "timer" } },
    "bpmn-end": { kind: "bpmn-event-end", patch: {} },
    "bpmn-end-message": { kind: "bpmn-event-end", patch: { trigger: "message", throwing: true } },
    "bpmn-end-terminate": { kind: "bpmn-event-end", patch: { trigger: "terminate" } },
  };
  const hit = M[shape];
  if (!hit) return { kind: shape, extra };
  return { kind: hit.kind, extra: { ...extra, ...hit.patch } };
}

function portSide(port?: string): PortSide | undefined {
  const side = port?.split("-")[0] as PortSide | undefined;
  return side && side in PORT_SIDE ? side : undefined;
}

function portBand(port?: string): "" | "-1" | "-2" {
  if (port?.endsWith("-1")) return "-1";
  if (port?.endsWith("-2")) return "-2";
  return "";
}

function oppositePort(port?: string): FixedPortId | undefined {
  const side = portSide(port);
  if (!side) return undefined;
  return `${OPPOSITE_SIDE[side]}${portBand(port)}` as FixedPortId;
}

function centerPortForSide(side: PortSide): FixedPortId {
  return side as FixedPortId;
}

function collapsePortToSideCenter(port?: string | null): FixedPortId | undefined {
  const side = portSide(port ?? undefined);
  return side ? centerPortForSide(side) : undefined;
}

function nearestFixedPort(node: Node, pt: { x: number; y: number }): FixedPortId {
  return nearestFixedPortInBox(node.getBBox(), pt);
}

function portEndpoint(cell: string, port: string) {
  return { cell, port, connectionPoint: PORT_CONNECTION_POINT };
}
// Full arrowhead set for BOTH ends (flowchart + UML/ERD relationships).
function buildMarker(kind: string | undefined, color: string): Record<string, unknown> | null {
  const m = markerOf(kind, color);
  return m?.name === "path" ? { ...m, ...keepOrigin(String(m.d)) } : m;
}
// Our path markers are drawn with the line end at (0, 0). X6 centres a path
// marker's bbox on the line end unless given offsets — which pushed arrowheads
// into the shape. These offsets cancel the centring.
function keepOrigin(d: string): { offsetX: number; offsetY: number } {
  const b = Path.parse(d).bbox();
  return b ? { offsetX: -b.width / 2 - b.x, offsetY: -b.height / 2 - b.y } : { offsetX: 0, offsetY: 0 };
}
/** BPMN-style heads share the default arrow's size (12×9) so no flow type looks heavier. */
function markerOf(kind: string | undefined, color: string): Record<string, unknown> | null {
  switch (kind) {
    case "arrow": return { name: "block", width: 12, height: 9, fill: color };                       // mũi tên đặc
    case "arrow-open": return { name: "path", d: "M 12 -4.5 0 0 12 4.5", fill: "none", stroke: color, "stroke-width": 1.8 }; // mũi tên hở
    case "triangle": return { name: "block", width: 12, height: 9, fill: "#fff", stroke: color, "stroke-width": 1.5 }; // tam giác rỗng (kế thừa)
    case "triangle-f": return { name: "block", width: 12, height: 9, fill: color };                 // tam giác đặc
    case "diamond": return { name: "diamond", width: 14, height: 9, fill: color };                  // thoi đặc (composition)
    case "diamond-o": return { name: "diamond", width: 14, height: 9, fill: "#fff", stroke: color, "stroke-width": 1.5 }; // thoi rỗng (aggregation)
    case "circle": return { name: "circle", r: 4.5, fill: "#fff", stroke: color, "stroke-width": 1.5 }; // tròn rỗng
    case "circle-f": return { name: "circle", r: 4.5, fill: color };                                 // tròn đặc
    // ERD crow's foot — single path (fan / bar / combos). Base toward node at x=0.
    case "crow": return { name: "path", d: "M14 -8 0 0 14 8 M14 0 0 0", fill: "none", stroke: color, "stroke-width": 1.5 };       // many (n)
    case "bar": return { name: "path", d: "M6 -8 6 8", fill: "none", stroke: color, "stroke-width": 1.5 };                         // one (1)
    case "crow-bar": return { name: "path", d: "M16 -8 2 0 16 8 M16 0 2 0 M14 -8 14 8", fill: "none", stroke: color, "stroke-width": 1.5 }; // one-or-many (1..n)
    case "bar-bar": return { name: "path", d: "M5 -8 5 8 M10 -8 10 8", fill: "none", stroke: color, "stroke-width": 1.5 };          // exactly one (1,1)
    // Story 2.4 — crow's foot zero-variants (DBML nullable FK).
    case "circle-bar": return { name: "path", d: "M14 -8 14 8 M9 0 a4 4 0 1 0 -8 0 a4 4 0 1 0 8 0", fill: "none", stroke: color, "stroke-width": 1.5 }; // zero-or-one (0..1)
    case "crow-circle": return { name: "path", d: "M18 -8 4 0 18 8 M18 0 4 0 M3 0 a3 3 0 1 0 -6 0 a3 3 0 1 0 6 0", fill: "none", stroke: color, "stroke-width": 1.5 }; // zero-or-many (0..n)
    // BPMN Default Flow marker — diagonal slash at source end (Đợt C).
    case "def-slash": return { name: "path", d: "M2 -6 10 6", fill: "none", stroke: color, "stroke-width": 1.8 };
    case "none": default: return null;
  }
}
const EDGE_MARKER_KINDS = ["none", "arrow", "arrow-open", "triangle", "triangle-f", "diamond", "diamond-o", "circle", "circle-f", "crow", "bar", "crow-bar", "bar-bar", "circle-bar", "crow-circle"] as const;
const EDGE_MARKER_LABEL: Record<string, string> = {
  none: "Không", arrow: "Mũi tên", "arrow-open": "Mũi tên hở", triangle: "Tam giác rỗng",
  "triangle-f": "Tam giác đặc", diamond: "Thoi đặc", "diamond-o": "Thoi rỗng", circle: "Tròn rỗng", "circle-f": "Tròn đặc",
  crow: "Crow nhiều (n)", bar: "Một (1)", "crow-bar": "Một-hoặc-nhiều (1..n)", "bar-bar": "Đúng một (1,1)",
  "circle-bar": "Không-hoặc-một (0..1)", "crow-circle": "Không-hoặc-nhiều (0..n)",
};
const EDGE_WIDTHS = [1.4, 2.4, 3.6];
// Line shape presets → router + connector.
const EDGE_SHAPES: Record<string, { router: unknown; connector: unknown }> = {
  orthogonal: { router: AVOID_ROUTER, connector: { name: "rounded", args: { radius: 6 } } },
  elbow: { router: AVOID_ROUTER, connector: { name: "normal" } },
  straight: { router: { name: "normal" }, connector: { name: "normal" } },
  curved: { router: { name: "normal" }, connector: { name: "smooth" } },
};
// Line-crossing jumps (X6 native jumpover connector — no manual intersection math).
const EDGE_JUMPS: Record<string, "none" | "arc" | "gap" | "cubic"> = { none: "none", arc: "arc", gap: "gap" };

// Arrow / message presets for the rail "Mũi tên" flyout (sequence-diagram messages).
// Picking one drops a standalone straight arrow on the canvas; drag its ends onto
// two lifelines to make a message (the seq-msg connector then takes over).
const ARROW_TYPES: Array<{ key: string; label: string; style: EdgeStyle }> = [
  { key: "sync", label: "Đồng bộ", style: { end: "arrow", dash: "solid", shape: "straight" } },
  { key: "async", label: "Bất đồng bộ", style: { end: "arrow-open", dash: "solid", shape: "straight" } },
  { key: "reply", label: "Phản hồi", style: { end: "arrow-open", dash: "dashed", shape: "straight" } },
  { key: "line", label: "Đường thẳng", style: { end: "none", dash: "solid", shape: "straight" } },
];
/** Small horizontal-arrow preview for an arrow flyout cell. */
function arrowPreview(style: EdgeStyle): string {
  const dash = style.dash === "dashed" ? ` stroke-dasharray="3 3"` : style.dash === "dotted" ? ` stroke-dasharray="1 3"` : "";
  const head = style.end === "none" ? ""
    : style.end === "arrow-open" ? `<path d="M20 4 27 9 20 14" fill="none" stroke="currentColor" stroke-width="1.8"/>`
      : `<path d="M20 4 28 9 20 14Z" fill="currentColor"/>`;
  return `<svg viewBox="0 0 32 18" fill="none" stroke="currentColor"><line x1="3" y1="9" x2="24" y2="9" stroke-width="1.8"${dash}/>${head}</svg>`;
}

type ConnectedEndpointEvent = {
  type: Edge.TerminalType;
  currentCell?: { id?: string } | null;
  currentPort?: string | null;
};

/** The lane `id` at any nesting depth. */
function findLaneDeep<T extends { id: string; lanes?: T[] }>(lanes: readonly T[], id: string): T | undefined {
  for (const ln of lanes) {
    if (ln.id === id) return ln;
    const hit = ln.lanes ? findLaneDeep(ln.lanes, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

export class OmniboardCanvas {
  private graph: Graph;
  private root: HTMLElement;
  private graphMount: HTMLElement;
  private contextBar: HTMLElement;
  private edgeBar: HTMLElement | null = null;
  private edgeBarDebounce: number | null = null;   // debounce showEdgeBar() during continuous segment/vertex drags
  private popupLayer: HTMLElement;
  private categories: ShapeCategory[];
  private onChange: () => void;
  private labelInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  private propsBody: HTMLElement | null = null;
  private propsPanel: HTMLElement | null = null;
  private propsFab: HTMLElement | null = null;
  private selectionChangeHandler: (() => void) | null = null;
  private zoomLabel: HTMLElement | null = null;
  private appState: BoardAppState = {};
  private minimap: HTMLElement | null = null;
  private minimapSvg: SVGSVGElement | null = null;
  private minimapVp: HTMLElement | null = null;
  private mm = { scale: 1, ox: 0, oy: 0, bx: 0, by: 0 }; // minimap↔graph mapping
  private tool: "select" | "pan" | "space" = "select";
  private railSpace: HTMLElement | null = null;
  private railSelect: HTMLElement | null = null;
  private railHand: HTMLElement | null = null;
  private panStart: { px: number; py: number; tx: number; ty: number; id: number } | null = null;
  private pendingShape: PaletteItem | null = null;
  private pendingHint: HTMLElement | null = null;
  private selDrag: { id: number; node: Node; px: number; py: number; nx: number; ny: number; moved: boolean; wasSelected: boolean } | null = null;
  private dragBatch = false;   // an X6 history batch is open around the current touch-drag
  private mbar: HTMLElement | null = null;   // mobile bottom toolbar
  // Two-finger pinch: zoom around the finger midpoint while also panning with it.
  private pinch: { d0: number; scale0: number; lx: number; ly: number } | null = null;
  private wheelPan?: (e: WheelEvent) => void;
  private mmFabs: HTMLElement | null = null;
  private padLayer: HTMLElement | null = null;
  private pendingDrop: Edge | null = null; // dangling edge awaiting a shape pick (drag-to-blank)
  private lastSelectedAt = new Map<string, number>(); // when each node became selected (for click-to-edit)
  private docListeners: Array<{ type: string; fn: EventListener }> = []; // document-scoped listeners to remove on destroy()
  // Mobile-only HTML overlay: WebKit/iOS mis-positions <foreignObject> HTML content
  // (position:absolute, clip-path, transform, %-height flex all jump to 0,0). We hide
  // the foreignObject visuals on mobile and render each node into a real <div> overlay
  // (where that CSS works), positioned to match. Interaction stays on the SVG hit rect.
  private readonly isMobile = typeof document !== "undefined" && !!document.body?.classList.contains("is-mobile");
  private htmlLayer: HTMLElement | null = null;
  private htmlNodes = new Map<string, HTMLElement>();
  private flyout: HTMLElement | null = null;
  private flyoutTimer: number | null = null;

  constructor(root: HTMLElement, categories: ShapeCategory[], onChange: () => void) {
    this.root = root;
    this.categories = categories;
    this.onChange = onChange;
    this.root.classList.add("lk-root");

    this.graphMount = el("div", "lk-graph-mount");
    this.root.appendChild(this.graphMount);

    // Stop touch gestures on the canvas from bubbling to Obsidian's mobile
    // workspace, whose drawer-swipe handler (open file tree / right sidebar) is a
    // JS touch listener that `touch-action:none` alone does not suppress. X6 and
    // our own pan use pointer/mouse events, so blocking *touch* events is safe.
    const stopTouch = (e: Event) => e.stopPropagation();
    for (const t of ["touchstart", "touchmove", "touchend"] as const) {
      this.graphMount.addEventListener(t, stopTouch, { passive: true });
    }

    ensureSeqConnector();
    ensureMindmapConnector();
    registerAvoidRouter();
    this.graph = this.initGraph();
    this.guardRenderQueue();
    if (this.isMobile) {
      // Excalidraw-style single bottom bar (thumb zone); no left rail / zoom +/-.
      this.buildMobileToolbar();
    } else {
      this.buildLeftToolbar();
      this.buildBottomControls();
    }
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
    this.enablePinch();       // mobile: two-finger pinch-zoom + pan
    this.enableLabelDrag();
    this.enableLaneResize();
    this.enableInlineLabelEdit();
    this.refreshProps();
    this.setTool("select");   // wire the touch select/move handlers
    this.initHtmlOverlay();   // mobile-only: real-div node rendering (no-op on desktop)
  }

  // ── Graph ──────────────────────────────────────────────────────────────
  private initGraph(): Graph {
    const graph = new Graph({
      container: this.graphMount,
      autoResize: true,
      panning: { enabled: true, modifiers: ["space"] },
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], zoomAtMousePosition: true },
      // Allow user to drag edge labels (bpmn.io behaviour — avoid label overlap on busy intersections).
      interacting: this.isMobile ? { nodeMovable: false } : { edgeLabelMovable: true },
      grid: { visible: true, type: "dot", size: 22, args: { color: GRID_DOT.light, thickness: 2 } },
      background: { color: "transparent" },
      connecting: {
        // 20px snap radius: the port circles are r=2.75 and hidden until hover,
        // so a tighter radius made them nearly impossible to hit. Dropping on
        // the node BODY also connects (handleDragToBlank → nearest fixed port),
        // and the hovered node is ringed via .lk-drop-target for feedback.
        snap: { radius: 20 },
        allowBlank: true,             // drop on empty canvas → "pick shape" picker
        allowLoop: false,             // no self-loops
        allowNode: false,             // endpoints must resolve to one of the 12 ports
        allowEdge: false,
        allowMulti: true,
        highlight: true,
        // Use the port/anchor point directly. Boundary cropping can recut a
        // port-based endpoint to a nearby bbox/ellipse intersection, which made
        // BPMN circle ports appear to snap off-centre.
        anchor: "center",
        connectionPoint: "anchor",
        router: SMART_ROUTER, connector: CONNECTOR,
        createEdge() { return this.createEdge({ attrs: EDGE_ATTRS }); },
        // Accept drops on fixed node ports, plus empty-canvas drops so allowBlank
        // still opens the "Chèn hình" picker.
        validateConnection: ({ sourceCell, targetCell }) => {
          if (!targetCell) return true;
          if (!targetCell.isNode() || sourceCell === targetCell) return false;
          return !this.isPortDisabledNode(targetCell.id);
        },
        // Only port circles may start a connection drag; body clicks stay normal
        // selection/edit interactions.
        validateMagnet: ({ magnet, cell }) => {
          // Port circles carry class `x6-port-body`; the body hit rect doesn't.
          if (!magnet || !(magnet as Element).classList?.contains("x6-port-body")) return false;
          if (!cell?.isNode?.()) return false;
          return !this.isPortDisabledNode(cell.id);
        },
      },
      highlighting: {
        // No magnet highlights at all. magnetAvailable stacked into a kaleidoscope
        // when every node had 13 magnets (body + 12 ports); magnetAdsorbed drew
        // a fat stroke around whichever magnet the cursor snapped to — a big
        // blue ring orbiting the cursor that the user (rightly) complained about.
        // The arrow line itself is the only visual feedback during drag; X6 also
        // switches the cursor to crosshair over valid drop targets, which is the
        // bpmn.io convention.
      },
    });

    // Story 6.1 — multi-select. [Review][Patch P9] X6 v2 has TWO modifier configs:
    //  • `modifiers` gates RUBBERBAND activation (which modifier must be held to
    //     start a rubberband-drag). Leave UNSET so plain click-drag-on-blank
    //     starts a rubberband (AC#7) — setting it to "shift" would force users
    //     to hold Shift just to drag-select, breaking the rubberband UX.
    //  • `multipleSelectionModifiers` gates CLICK-TOGGLE (which modifier toggles
    //     a clicked cell in/out of the selection). We set this to "shift" so
    //     Shift+click toggles (bpmn.io / Figma / mxGraph convention — AC#1).
    //     Default would be ["ctrl", "meta"] which conflicts with copy/paste.
    //  • Rubberband + Shift unions the new box with the existing selection
    //    via the multipleSelectionModifiers path.
    graph.use(new Selection({
      enabled: true,
      multiple: true,
      rubberband: true,
      multipleSelectionModifiers: "shift",
      showNodeSelectionBox: true,
      pointerEvents: "none",
    } as unknown as ConstructorParameters<typeof Selection>[0]));
    graph.use(new History());
    graph.use(new Keyboard());
    graph.use(new Snapline({ enabled: true }));
    graph.use(new Transform({ resizing: { enabled: true, minWidth: 24, minHeight: 24 }, rotating: false }));
    graph.use(new Clipboard({ useLocalStorage: true })); // Cmd/Ctrl+C/V/X — survives reload

    graph.bindKey(["backspace", "delete"], () => {
      const cells = graph.getSelectedCells();
      if (!cells.length) return;
      // Batch the removal — without it, a 30+ cell delete (e.g. Ctrl+A then
      // Delete on a BPMN import) fires onChange/save once PER cell and freezes
      // the UI while ports/anchors recompute. Also pre-deselect so the
      // selection plugin doesn't keep stale references to removed cells.
      graph.cleanSelection();
      graph.startBatch("delete");
      try { graph.removeCells(cells); }
      finally { graph.stopBatch("delete"); }
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
    graph.bindKey("esc", () => { this.hidePopup(); this.commitLabel(); this.setPending(null); graph.cleanSelection(); });
    // Tool shortcuts (ignored while typing in an inline editor — keyboard plugin guards inputs).
    graph.bindKey("v", () => { this.setTool("select"); });
    graph.bindKey("h", () => { this.setTool("pan"); });
    graph.bindKey("s", () => { this.setTool(this.tool === "space" ? "select" : "space"); });
    graph.bindKey(["ctrl+f", "cmd+f"], () => { this.openSearch(); return false; });

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
    if (kind === "mm-root") return { w: 180, h: 50, label: "Trung tâm" };
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
    // A pool / lane is a container, not a flow step: no "+ next shape" on its border.
    if (this.nodeKind(node) === "bpmn-pool" || this.nodeKind(node) === "bpmn-lane") { this.padLayer.style.display = "none"; return; }
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

  /** Shared "Insert shape" grid (skips mindmap kinds).
   *  `withLoadMore=true` keeps advanced palette items collapsed behind a button,
   *  mirroring the left toolbar flyout behavior for dense BPMN sets. */
  private buildShapeGrid(onPick: (item: PaletteItem) => void, onlyCats?: string[], withLoadMore = false): HTMLElement {
    const grid = el("div", "lk-shape-grid");
    const common: PaletteItem[] = [];
    const advanced: PaletteItem[] = [];
    for (const cat of this.categories) {
      if (onlyCats && !onlyCats.includes(cat.title)) continue;
      for (const item of cat.items) {
        if (item.shape.startsWith("mm-")) continue; // mindmap has its own flow
        if (withLoadMore && item.advanced) advanced.push(item);
        else common.push(item);
      }
    }
    const mkCell = (item: PaletteItem) => {
      const cell = el("div", "lk-shape-cell", shapeIcon(item.shape, item.seed));
      cell.title = item.label;
      cell.onclick = () => onPick(item);
      return cell;
    };
    for (const item of common) grid.appendChild(mkCell(item));
    if (withLoadMore && advanced.length > 0) {
      const more = el("button", "lk-flyout-more", `Load more (${advanced.length})`);
      more.onclick = () => {
        const frag = document.createDocumentFragment();
        for (const item of advanced) frag.appendChild(mkCell(item));
        more.parentElement?.insertBefore(frag, more);
        more.remove();
      };
      grid.appendChild(more);
    }
    return grid;
  }

  /** Click a directional handle → pick a shape → spawn it connected in that direction. */
  /** Map source-node kind → palette categories to show (Basic + same diagram type). */
  private categoriesFor(node: Node): string[] {
    const k = this.nodeKind(node);
    if (k.startsWith("bpmn-")) return ["Cơ bản", "BPMN"];
    if (k.startsWith("erd-")) return ["Cơ bản", "ERD"];
    if (k.startsWith("uml-")) return ["Cơ bản", "UML"];
    if (k.startsWith("st-")) return ["Cơ bản", "State"];
    if (k.startsWith("sq-")) return ["Cơ bản", "Sequence"];
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
  private handleDragToBlank(edge: Edge): "removed" | "connected" | "pending" | "pool" {
    const srcId = edge.getSourceCellId();
    const src = srcId ? this.graph.getCellById(srcId) : null;
    if (!src || !src.isNode()) { edge.remove(); return "removed"; }
    const pt = edge.getTargetPoint(); // graph coords of the drop
    if (!pt) { edge.remove(); return "removed"; }
    const srcPort = (edge.getSource() as { port?: string } | undefined)?.port;

    // If the drop point lands inside another node, bind to the nearest of that
    // node's fixed 12 ports instead of creating a free-position anchor.
    const candidates: Node[] = [];
    for (const n of this.graph.getNodes()) {
      if (n.id === src.id) continue;
      if (this.isPortDisabledNode(n.id)) continue;
      const b = n.getBBox();
      if (pt.x < b.x || pt.x > b.x + b.width || pt.y < b.y || pt.y > b.y + b.height) continue;
      candidates.push(n as Node);
    }
    // When multiple nodes overlap (e.g. task inside pool/lane), prefer the
    // smallest bbox so regular flow nodes win over big containers.
    const best = pickDropTarget(candidates.map((n) => ({ n, bbox: n.getBBox() })), pt)?.n;
    if (best) {
      edge.setTarget(portEndpoint(best.id, nearestFixedPort(best, pt)) as never);
      return "connected";
    }
    // Dropped on a pool (black-box: anywhere; with lanes: near its top /
    // bottom border) → a message flow ending on the pool's border.
    if (this.endOnPool(edge, src as Node, pt)) return "pool";

    this.pendingDrop = edge;          // removed on dismiss unless a shape is picked
    const wrap = el("div", "lk-shape-popup");
    wrap.appendChild(el("div", "lk-flyout-title", "Chèn hình"));
    wrap.appendChild(this.buildShapeGrid((item) => {
      this.pendingDrop = null;        // resolved — keep the edge
      // Snap new node's axis to the source port so the manhattan router emits
      // a perfectly straight arrow (no awkward Y/X jog right before the arrowhead).
      const sb = (src as Node).getBBox();
      let nx = pt.x - item.w / 2;
      let ny = pt.y - item.h / 2;
      if (srcPort === "right" || srcPort === "left") {
        ny = sb.y + sb.height / 2 - item.h / 2;   // horizontal flow → align Y
      } else if (srcPort === "top" || srcPort === "bottom") {
        nx = sb.x + sb.width / 2 - item.w / 2;    // vertical flow → align X
      }
      const created = this.addHtmlNode(item.shape, nx, ny, item.w, item.h, "", undefined, undefined, item.seed as NodeExtra);
      const sb2 = (src as Node).getBBox();
      const hint = oppositePort(srcPort) ?? nearestFixedPort(created, { x: sb2.x + sb2.width / 2, y: sb2.y + sb2.height / 2 });
      const targetPort = this.isBpmnEventNode(created.id) ? (collapsePortToSideCenter(hint) ?? hint) : hint;
      edge.setTarget(portEndpoint(created.id, targetPort) as never);
      edge.setData({ ...(edge.getData() as object) });
      this.normalizeRegularEdgeEndpoints(edge, {
        type: "target",
        currentCell: { id: created.id },
        currentPort: targetPort,
      });
      this.applyMindmapRoutingIfNeeded(edge); this.applySeqRoutingIfNeeded(edge);
      this.hidePopup();
      this.graph.resetSelection([created]);
      this.editLabel(created);
      this.onChange();
    }, this.categoriesFor(src as Node), true)); // picker = basic + same diagram type as source + load-more for advanced
    const sc = this.graph.scale().sx; const tr = this.graph.translate();
    this.showPopupAt(wrap, pt.x * sc + tr.tx, pt.y * sc + tr.ty);
    return "pending";
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
    const created = this.addHtmlNode(item.shape, x, y, item.w, item.h, "", undefined, undefined, item.seed as NodeExtra);
    const opp: Record<SpawnDir, SpawnDir> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    this.graph.addEdge({
      source: portEndpoint(source.id, dir), target: portEndpoint(created.id, opp[dir]),
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
   * Two-finger pinch on touch: zoom around the finger midpoint and pan with it.
   * A single transform handles both — we re-anchor the graph-local point that was
   * under the midpoint at gesture start back under the (possibly moved) midpoint.
   * Touch's native page pinch-zoom is suppressed via preventDefault (non-passive).
   */
  private enablePinch() {
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const m = mid(e.touches);
      const lp = this.graph.clientToLocal(m.x, m.y);
      this.pinch = { d0: dist(e.touches) || 1, scale0: this.graph.scale().sx, lx: lp.x, ly: lp.y };
      if (this.dragBatch) { this.graph.stopBatch("move"); this.dragBatch = false; }   // close any open drag batch
      this.selDrag = null; this.panStart = null;   // cancel any one-finger gesture
      e.preventDefault();
    };
    const moveFn = (e: TouchEvent) => {
      const p = this.pinch; if (!p || e.touches.length !== 2) return;
      e.preventDefault();
      const m = mid(e.touches);
      const next = Math.min(3, Math.max(0.2, p.scale0 * (dist(e.touches) / p.d0)));
      this.graph.zoom(next, { absolute: true });
      const cur = this.graph.localToClient(p.lx, p.ly);
      this.graph.translateBy(m.x - cur.x, m.y - cur.y);
      this.updateZoom();
    };
    const end = (e: TouchEvent) => { if (e.touches.length < 2) this.pinch = null; };
    this.graphMount.addEventListener("touchstart", start, { passive: false });
    this.graphMount.addEventListener("touchmove", moveFn, { passive: false });
    this.graphMount.addEventListener("touchend", end, { passive: true });
    this.graphMount.addEventListener("touchcancel", end, { passive: true });
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
        // margin, not transform — transform makes the label a WebKit compositing
        // layer that jumps to the SVG origin on iOS (matches lblStyle()).
        lbl.style.margin = `${base.y + dy}px 0 0 ${base.x + dx}px`;
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
   * Drag the line between two lanes of a BPMN pool to move height from one
   * lane to the other (pool keeps its size). Result lands in
   * `lanes[i].height` as one undo step.
   */
  private enableLaneResize(): void {
    const MIN_LANE = 60;   // = CSS min-height of .bp-pool-lane
    this.root.addEventListener("pointerdown", (e: PointerEvent) => {
      const handle = (e.target as HTMLElement | null)?.closest?.(".bp-pool-lane-divider") as HTMLElement | null;
      if (!handle) return;
      const cellId = handle.closest(".x6-node")?.getAttribute("data-cell-id");
      const node = cellId ? this.graph.getCellById(cellId) : null;
      if (!node || !node.isNode()) return;
      const lanes = this.nodeExtra(node).lanes ?? [];
      // Rows in a horizontal pool (drag along y), columns in a vertical one (x).
      const horizontal = this.nodeExtra(node).poolHorizontal !== false;
      const poolExtent = horizontal ? node.getSize().height : node.getSize().width;
      // Top-level divider (data-lane-idx="i") or, at any depth, a divider
      // between sibling lanes (data-lane-path="a/b/.../j"): resize the two
      // siblings within the band they share.
      const path = handle.getAttribute("data-lane-path");
      const steps = path ? path.split("/").map(Number) : [Number(handle.getAttribute("data-lane-idx"))];
      const idx = steps[steps.length - 1];
      if (steps.some((n) => !Number.isInteger(n))) return;
      let level: typeof lanes = lanes;
      let parentId: string | null = null;
      for (const i of steps.slice(0, -1)) { parentId = level[i]?.id ?? null; level = level[i]?.lanes ?? []; }
      const siblings = level;
      if (idx >= siblings.length - 1) return;
      const band = laneBandOf(asStackLanes(lanes, horizontal), siblings[0].id, poolExtent);
      if (!band) return;
      const write = (sized: ReturnType<typeof resizeLaneBoundary>) =>
        setSiblings(lanes, parentId, (kids) => fromStackLanes(kids, sized, horizontal));
      e.preventDefault(); e.stopPropagation();
      handle.classList.add("is-dragging");
      const container = handle.closest(parentId ? ".bp-pool-sublanes" : ".bp-pool-body");
      const laneEls = Array.from(container?.querySelectorAll<HTMLElement>(":scope > .bp-pool-lane") ?? []);
      const at = (ev: PointerEvent) => (horizontal ? ev.clientY : ev.clientX);
      const start = at(e);
      const scale = (horizontal ? this.graph.scale().sy : this.graph.scale().sx) || 1;
      const resized = (ev: PointerEvent) =>
        resizeLaneBoundary(asStackLanes(siblings, horizontal), band.extent, idx, (at(ev) - start) / scale, MIN_LANE / (parentId ? 2 : 1));
      const mv = (ev: PointerEvent) => {
        resized(ev).forEach((ln, i) => { if (laneEls[i]) laneEls[i].style.flex = `${ln.height} 1 0px`; });
      };
      const up = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", mv);
        document.removeEventListener("pointerup", up);
        handle.classList.remove("is-dragging");
        if (Math.abs(at(ev) - start) < 1) return;
        this.graph.startBatch("lane-resize");
        try {
          node.setData({ ...node.getData(), lanes: write(resized(ev)) }, { deep: false });
          this.rerender(node);
        } finally { this.graph.stopBatch("lane-resize"); }
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

  /** Events, gateways and data shapes carry their name OUTSIDE the icon (bpmn-js):
   *  edit it where it is drawn — or, while still empty, where it will appear
   *  (below the shape, or on its chosen side) — never on top of the icon. */
  private editExternalLabel(node: Node): boolean {
    const view = this.graph.findViewByCell(node) as unknown as { container?: HTMLElement } | null;
    const shape = view?.container?.querySelector(".bp-event, .bp-gw, .bp-dataobj, .bp-datastore");
    if (!shape) return false;
    const W = 120, H = 28, GAP = 6;
    const rr = this.root.getBoundingClientRect();
    const lbl = shape.querySelector(".bp-elabel") as HTMLElement | null;
    let box: { left: number; top: number };
    if (lbl && lbl.textContent?.trim()) {
      const r = lbl.getBoundingClientRect();
      box = { left: r.left + r.width / 2 - rr.left - W / 2, top: r.top - rr.top };
    } else {
      const b = (shape as HTMLElement).getBoundingClientRect();
      const side = this.nodeExtra(node).labelSide ?? "bottom";
      const cx = b.left + b.width / 2 - rr.left, cy = b.top + b.height / 2 - rr.top;
      box = side === "top" ? { left: cx - W / 2, top: b.top - rr.top - GAP - H }
        : side === "left" ? { left: b.left - rr.left - GAP - W, top: cy - H / 2 }
        : side === "right" ? { left: b.right - rr.left + GAP, top: cy - H / 2 }
        : { left: cx - W / 2, top: b.bottom - rr.top + GAP };
    }
    this.inlineEdit({
      ...box, width: W, height: H, value: this.nodeLabel(node), multiLine: true,
      onCommit: (v) => { node.setData({ ...node.getData(), label: v }); this.rerender(node); this.onChange(); },
    });
    return true;
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
    // While the user is actively drawing/dragging an arrow from a port magnet,
    // dim port circles on every node so magnets stay snap-active without turning
    // the canvas into a field of blue dots. Toggle via a class on .lk-root that
    // the CSS rule reads. Two trigger paths:
    //   (1) node:magnet:mousedown — new edge drag from a port circle
    //   (2) capture-phase DOM mousedown on a magnet OR an edge arrowhead tool —
    //       catches existing-edge endpoint drag (re-routing arrow), which X6
    //       doesn't surface via node:magnet:mousedown.
    const startDrag = () => this.root.classList.add("lk-dragging-edge");
    this.graph.on("node:magnet:mousedown", startDrag);
    const onDomDown = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.closest !== "function") return;
      if (t.closest('.x6-port-body, .x6-edge-tool-source-arrowhead, .x6-edge-tool-target-arrowhead, [magnet]')) {
        startDrag();
      }
    };
    this.graphMount.addEventListener("mousedown", onDomDown, true);
    this.graphMount.addEventListener("touchstart", onDomDown, true);
    // Drop-target feedback (bpmn.io convention): while an arrow is being
    // dragged, ring ONLY the node under the cursor if it is a valid target.
    // Done at the DOM level (mouseover on the node's SVG hit rect) so it works
    // regardless of which X6 events fire mid-drag; magnet highlights stay off.
    const clearDropTarget = () => {
      this.graphMount.querySelectorAll(".lk-drop-target").forEach((el) => el.classList.remove("lk-drop-target"));
    };
    this.graphMount.addEventListener("mouseover", (e: Event) => {
      if (!this.root.classList.contains("lk-dragging-edge")) return;
      const t = e.target as Element | null;
      const g = t && typeof t.closest === "function" ? t.closest<Element>(".x6-node") : null;
      const id = g?.getAttribute("data-cell-id") ?? undefined;
      const dangling = this.graph.getEdges().find((ed) => !ed.getSourceCellId() !== !ed.getTargetCellId());
      const otherEnd = dangling?.getSourceCellId() ?? dangling?.getTargetCellId() ?? undefined;
      const ok = !!id && id !== otherEnd && !this.isPortDisabledNode(id) && !!this.graph.getCellById(id)?.isNode?.();
      if (g?.classList.contains("lk-drop-target") && ok) return;
      clearDropTarget();
      if (ok) g!.classList.add("lk-drop-target");
    }, true);
    // Pools have no ports, so mouseover never rings them; ring a pool while
    // the pointer is where a drop would end the arrow on it (black-box: on
    // it; with lanes: near its top / bottom border).
    this.graphMount.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.root.classList.contains("lk-dragging-edge")) return;
      const dangling = this.graph.getEdges().find((ed) => !ed.getSourceCellId() !== !ed.getTargetCellId());
      if (!dangling) return;
      const otherId = dangling.getSourceCellId() ?? dangling.getTargetCellId() ?? undefined;
      const otherPt = dangling.getSourceCellId() ? dangling.getSourcePoint() : dangling.getTargetPoint();
      const hit = otherPt ? this.poolAt(this.graph.clientToLocal(e.clientX, e.clientY), otherPt, otherId) : null;
      const viewOf = (n: Node) => (this.graph.findViewByCell(n) as { container?: Element } | null)?.container;
      for (const n of this.graph.getNodes()) {
        if (this.nodeKind(n) !== "bpmn-pool") continue;
        viewOf(n)?.classList.toggle("lk-drop-target", n === hit?.pool);
      }
    }, true);
    // Register a document-scoped capture listener AND record it so destroy()
    // can remove it — otherwise every board re-open leaks another listener that
    // keeps firing (and references a disposed graph), compounding into jank.
    const addDoc = (type: string, fn: EventListener) => { document.addEventListener(type, fn, true); this.docListeners.push({ type, fn }); };

    const clearDrag = () => {
      this.root.classList.remove("lk-dragging-edge");
      clearDropTarget();
      let changedAny = false;
      this.graph.getEdges().forEach((edge) => {
        const e = edge as any;
        if (e.__selVertsUserChanged && !e.__selVertsChangeSaved) {
          e.__selVertsChangeSaved = true;
          changedAny = true;
        }
      });
      if (changedAny) {
        this.onChange();
      }
    };
    addDoc("mouseup", clearDrag);
    addDoc("touchend", clearDrag);
    addDoc("touchcancel", clearDrag);

    // Edges behave like nodes: click to select (highlighted), Delete to remove.
    // Double-click edits the label. No floating delete button.
    this.graph.on("edge:click", ({ edge }) => this.graph.select(edge));
    this.graph.on("edge:selected", ({ edge }) => {
      this.applyEdgeStyle(edge, true); // highlight without losing custom color
      // Snapshot vertices so we can revert auto-materialized bends if the user
      // just clicks the edge and clicks away without actually reshaping.
      const originalVerts = edge.getVertices().map((p) => ({ x: p.x, y: p.y }));
      (edge as any).__selVertsSnapshot = originalVerts;
      (edge as any).__selVertsUserChanged = false;
      (edge as any).__selVertsChangeSaved = false;
      // Lark-style per-segment handles: if the edge uses an orthogonal router
      // and has no explicit vertices, materialize the router-generated bends
      // as vertices so the `segments` tool renders one handle per visible
      // segment instead of nothing. Reverted on unselect if user didn't drag.
      if (this.isOrthogonalEdge(edge) && originalVerts.length === 0) {
        const bends = this.materializeEditableBends(edge);
        if (bends.length > 0) {
          edge.setVertices(bends, { ui: false, toolId: "auto-segments" } as any);
        }
      }
      // Reshape tools:
      //  - `segments`: drag a whole orthogonal segment. With router bends now
      //    materialized on select, every visible segment has a handle.
      //  - `vertices`: drag/add/remove individual bends. Keep this enabled;
      //    without it users lose the normal edge reshape affordance.
      //  - endpoint round handles: drag-reconnect the endpoints.
      const dot = { tagName: "circle", attrs: { r: 5, fill: "#fff", stroke: ACCENT, "stroke-width": 1.6, cursor: "move" } };
      const isOrth = this.isOrthogonalEdge(edge);
      const tools: any[] = [
        { name: "source-arrowhead", args: dot },
        { name: "target-arrowhead", args: dot },
      ];
      if (isOrth) {
        tools.push({ name: "segments", args: { threshold: 8 } });
      } else {
        tools.push({ name: "vertices", args: { attrs: { r: 5, fill: "#fff", stroke: ACCENT, "stroke-width": 1.6, cursor: "move" }, addable: true, removable: true } });
      }
      edge.addTools(tools);
      this.showEdgeBar(edge);
      this.refreshProps();
      if (this.padLayer) this.padLayer.style.display = "none";
    });
    this.graph.on("edge:unselected", ({ edge }) => {
      this.applyEdgeStyle(edge, false);
      edge.removeTools();
      this.hideEdgeBar();
      this.refreshProps();
      const snap = (edge as any).__selVertsSnapshot;
      const changed = (edge as any).__selVertsUserChanged;
      if (snap !== undefined && !changed) {
        edge.setVertices(snap, { ui: false, toolId: "auto-segments-revert" } as any);
      }
      delete (edge as any).__selVertsSnapshot;
      delete (edge as any).__selVertsUserChanged;
      delete (edge as any).__selVertsChangeSaved;
    });
    const canResetEdgeVertices = (edge: Edge) => {
      if (this.isSeqLifeline(edge.getSourceCellId() ?? undefined) ||
          this.isSeqLifeline(edge.getTargetCellId() ?? undefined)) return false;
      if (this.isMindmapNode(edge.getSourceCellId() ?? undefined) ||
          this.isMindmapNode(edge.getTargetCellId() ?? undefined)) return false;
      return true;
    };
    const resetEdgeVertices = (edge: Edge) => {
      if (!canResetEdgeVertices(edge)) return;
      if (edge.getVertices().length) edge.setVertices([]);
    };
    const finalizeConnectedEdge = (edge: Edge, connected?: ConnectedEndpointEvent) => {
      this.normalizeRegularEdgeEndpoints(edge, connected);
      resetEdgeVertices(edge);
      this.applySeqRoutingIfNeeded(edge);
      this.applyMindmapRoutingIfNeeded(edge);
    };
    // Endpoint drag (source-arrowhead / target-arrowhead) changes source/target
    // continuously. The X6 segments tool also updates terminal anchors while a
    // segment is dragged; clearing vertices in response fights that tool every
    // pointermove and makes the drag freeze. Tool-originated source/target
    // changes only move the bar here; endpoint reconnect cleanup happens on
    // edge:connected below.
    const onEndpointMoved = ({ edge, options }: { edge: Edge; options?: Record<string, unknown> }) => {
      if ((options as any)?.toolId) {
        this.scheduleEdgeBar(edge);
        return;
      }
      resetEdgeVertices(edge);
      this.scheduleEdgeBar(edge);   // debounced — change:source/target fires continuously during an arrowhead drag
    };
    this.graph.on("edge:change:source", onEndpointMoved);
    this.graph.on("edge:change:target", onEndpointMoved);
    for (const end of ["source", "target"] as const) {
      this.graph.on(`edge:change:${end}`, ({ edge, current }: { edge: Edge; current?: { cell?: string } }) => {
        if (!current?.cell || this.graph.model.hasActiveBatch("load" as never)) return;
        const changed = this.graph.getCellById(current.cell);
        if (!changed?.isNode() || this.nodeKind(changed as Node) === "bpmn-pool") return;
        this.realignPoolEnd(edge, end === "source" ? "target" : "source");
      });
    }
    // Reshape (segments tool) → reposition the bar so it tracks the new bbox.
    // A segment/vertex drag fires this continuously; rebuilding the whole edge
    // bar (innerHTML + ~10 SVG buttons + a getBoundingClientRect reflow) on every
    // change froze the drag. Debounce: rebuild once, ~110ms after the drag
    // settles. The bar stays static (slightly stale position) mid-drag — the
    // user is focused on the handle, not the bar — then snaps correct on release.
    this.graph.on("edge:change:vertices", ({ edge, options }) => {
      const tid = (options as any)?.toolId;
      if (tid !== "auto-segments" && tid !== "auto-segments-revert") {
        (edge as any).__selVertsUserChanged = true;
      }
      this.scheduleEdgeBar(edge);
    });
    this.graph.on("edge:dblclick", ({ edge, e }) => { e.stopPropagation(); this.editEdgeLabel(edge); });

    this.graph.on("node:selected", () => { this.refreshContextBar(); this.refreshProps(); this.refreshMindmapFabs(); this.refreshContextPad(); });
    this.graph.on("node:unselected", () => { this.refreshContextBar(); this.refreshProps(); this.refreshMindmapFabs(); this.refreshContextPad(); });
    this.graph.on("node:moved", ({ node }) => { this.settleBoundaryEvent(node as Node); this.adoptIntoSubprocess(node as Node); });
    this.graph.on("node:added", ({ node }) => {
      if (!this.graph.model.hasActiveBatch("load" as never)) this.adoptIntoSubprocess(node as Node);
    });
    this.graph.on("node:moved", () => {
      // Pinned-port endpoints follow the port (X6 native); body-drop endpoints
      // re-dock automatically via the edge's anchor=center + boundary crop. No
      // per-edge fixup needed.
      this.refreshContextBar(); this.refreshProps(); this.refreshMindmapFabs(); this.refreshContextPad();
    });
    // Boundary events stay on their host's border (boundaryLayout): the host
    // moving takes them along, dragging the event itself slides it along the
    // border. Hooked on the per-tick position change.
    this.graph.on("node:change:position", ({ node, current, previous, options }) => {
      // Skip our own re-positioning calls (re-entry guards) and X6's silent moves.
      if (options?.["__boundary_follow"]) return;
      if (options?.["__bulk_follow"]) return;
      if (!current || !previous) return;
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      if (dx === 0 && dy === 0) return;
      this.followBoundaryEvents(node, { ...previous, ...node.getSize() }, options);
      this.snapBoundaryEvent(node, options);
    });
    this.graph.on("node:resized", () => { this.refreshContextBar(); this.refreshContextPad(); this.refreshBpmnEventLabels(); });
    // Resizing a pool by its top / bottom edge changes only the lane on that
    // edge (like bpmn-js); the other lanes and their shapes stay put. X6's
    // Transform passes the dragged handle as options.direction.
    // (A vertical pool: its left / right edge, the first / last column.)
    this.graph.on("node:change:size", ({ node, previous, current, options }) => {
      if (this.nodeKind(node) !== "bpmn-pool" || !previous || !current) return;
      const horizontal = this.nodeExtra(node).poolHorizontal !== false;
      const [before, after] = horizontal ? [previous.height, current.height] : [previous.width, current.width];
      if (before === after) return;
      const dir = String((options as { direction?: string } | undefined)?.direction ?? "");
      const [first, last] = horizontal ? ["top", "bottom"] : ["left", "right"];
      const edge = dir.includes(first) ? "top" : dir.includes(last) ? "bottom" : null;
      const lanes = this.nodeExtra(node).lanes;
      if (!edge || !lanes || lanes.length < 2) return;
      const sized = resizePoolLanes(asStackLanes(lanes, horizontal), before, after, edge);
      node.setData({ ...node.getData(), lanes: fromStackLanes(lanes, sized, horizontal) }, { deep: false });
      this.rerender(node);
    });
    // Resizing a host keeps its boundary events at the same spot on its border.
    this.graph.on("node:change:size", ({ node, previous, options }) => {
      if (!previous || options?.["__boundary_follow"]) return;
      this.followBoundaryEvents(node, { ...node.getPosition(), ...previous }, options);
    });
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
      if ((e.target as HTMLElement | null)?.closest?.("[data-sub-drill]")) return;
      if (this.tryEditChildLabel(e.target as HTMLElement | null, node as Node)) return;
      this.editLabel(node as Node);
    });
    // X6 fires node:click on every click (incl. the one that selects it).
    // Open child-label editor only when the node was already selected BEFORE this click.
    this.graph.on("node:click", ({ node, e }) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-sub-drill]")) {
        e.stopPropagation();
        this.enterSubprocess(node as Node);
        return;
      }
      if (this.lastSelectedAt.get(node.id) === undefined) return;
      const sinceSel = Date.now() - (this.lastSelectedAt.get(node.id) ?? 0);
      if (sinceSel < 80) return; // too fresh — this click is the selection itself
      if (this.tryEditChildLabel(e.target as HTMLElement | null, node as Node)) e.stopPropagation();
    });
    this.graph.on("node:selected", ({ node }) => { this.lastSelectedAt.set(node.id, Date.now()); });
    this.graph.on("node:unselected", ({ node }) => { this.lastSelectedAt.delete(node.id); });

    // Click on empty canvas → deselect. X6's rubberband Selection doesn't
    // reliably clear on a plain blank click, so do it explicitly (this is the
    // "can't unselect" the user hit). blank:click only fires on a click without
    // a drag, so it won't fight rubberband box-select.
    // Story 6.1 AC7 — Shift+blank-click MUST preserve current selection (only a
    // plain blank-click clears it). X6's blank:click handler receives the native
    // MouseEvent in `e`; we gate cleanSelection on the shift modifier.
    this.graph.on("blank:click", ({ e }: { e?: MouseEvent }) => {
      this.hidePopup();
      this.commitLabel();
      if (!e?.shiftKey) this.graph.cleanSelection();
    });
    this.graph.on("blank:mousedown", () => this.hidePopup());

    // Sequence messages: when both endpoints are sequence lifelines, swap the
    // edge's connector to "seq-msg" so the arrow stays horizontal at source Y.
    this.graph.on("edge:connected", ({ edge, isNew, type, currentCell, currentPort }) => {
      // Dropped on empty canvas → show shape picker at the drop point (Omniboard).
      if (isNew && !edge.getTargetCellId()) {
        const state = this.handleDragToBlank(edge);
        if (state !== "connected") return;
        const targetId = edge.getTargetCellId() ?? undefined;
        const connectedFromBlank = targetId
          ? {
              type: "target" as const,
              currentCell: { id: targetId },
              currentPort: this.endpointPort(edge, "target") ?? null,
            }
          : undefined;
        finalizeConnectedEdge(edge, connectedFromBlank);
        return;
      }
      finalizeConnectedEdge(edge, {
        type,
        currentCell: (currentCell as { id?: string } | null | undefined) ?? null,
        currentPort: currentPort ?? null,
      });
    });
    // Source arrowhead dragged off any port: remember where it was so a drop
    // on blank canvas can put it back (see settleDroppedSource).
    const sourceBefore = new Map<string, unknown>();
    this.graph.on("edge:change:source", ({ edge, previous, current }) => {
      const prevCell = (previous as { cell?: string } | undefined)?.cell;
      const curCell = (current as { cell?: string } | undefined)?.cell;
      if (prevCell && !curCell && !sourceBefore.has(edge.id)) sourceBefore.set(edge.id, previous);
      if (curCell) sourceBefore.delete(edge.id);
    });
    // Robust fallback: some X6 builds don't emit edge:connected for a blank drop.
    // After any mouseup, scan for a freshly dangling edge (source cell, target point)
    // and open the picker for it.
    this.graphMount.addEventListener("mouseup", () => {
      window.setTimeout(() => {
        const looseSource = this.graph.getEdges().find((e) => !e.getSourceCellId() && !!e.getTargetCellId());
        if (looseSource) {
          this.settleDroppedSource(looseSource, sourceBefore.get(looseSource.id));
          sourceBefore.delete(looseSource.id);
        }
        if (this.pendingDrop) return; // already handling one
        const dangling = this.graph.getEdges().find((e) => !!e.getSourceCellId() && !e.getTargetCellId());
        if (!dangling) return;
        const state = this.handleDragToBlank(dangling);
        if (state !== "connected") return;
        const targetId = dangling.getTargetCellId() ?? undefined;
        const connectedFromFallback = targetId
          ? {
              type: "target" as const,
              currentCell: { id: targetId },
              currentPort: this.endpointPort(dangling, "target") ?? null,
            }
          : undefined;
        finalizeConnectedEdge(dangling, connectedFromFallback);
      }, 0);
    });

    this.graph.on("node:contextmenu", ({ node, e }) => {
      e.preventDefault();
      this.graph.select(node);
      // Right-click on a pool lane's title strip → that lane's menu.
      const laneId = (e.target as HTMLElement | null)?.closest?.(".bp-pool-lane-head")
        ?.closest(".bp-pool-lane")?.getAttribute("data-lane-id");
      if (laneId && this.nodeKind(node as Node) === "bpmn-pool") { this.showLaneMenu(node as Node, laneId, e.clientX, e.clientY); return; }
      this.showContextMenu(e.clientX, e.clientY);
    });
  }

  // Reveal/hide a node's connect ports by writing inline visibility straight to
  // the rendered DOM (X6 setPortProp + silent did not flush, so ports stayed
  // hidden and connections were impossible).
  private togglePorts(node: Node, visible: boolean) {
    const view = this.graph.findViewByCell(node);
    if (!view) return;
    const canConnect = !this.isPortDisabledNode(node.id);
    // ERD entities: ONLY show per-column ports (col:*) at row centres — cleaner
    // visual + edges always neo theo cột, không cần 12 cardinal nữa.
    // All other shapes (BPMN/flowchart/UML/state/sequence/mindmap): keep the
    // legacy 12 fixed cardinal ports behaviour.
    const isErd = this.nodeKind(node) === "erd-entity";
    (view.container as Element).querySelectorAll<SVGElement>(".x6-port circle").forEach((c) => {
      const id = c.getAttribute("port") ?? "";
      const isFixed = FIXED_PORT_IDS.includes(id as FixedPortId);
      const isErdCol = id.startsWith("col:");
      const allowed = isErd ? isErdCol : isFixed;
      const show = visible && canConnect && allowed;
      c.style.visibility = show ? "visible" : "hidden";
      if (isErdCol) {
        if (show) {
          c.setAttribute("r", "4");
          c.setAttribute("fill", "#fff");
          c.setAttribute("stroke", "#5E8FB9");
          c.setAttribute("stroke-width", "1.2");
        } else {
          c.setAttribute("r", "11");
          c.setAttribute("fill", "rgba(94,143,185,0.001)");
          c.setAttribute("stroke-width", "0");
        }
      }
    });
  }

  // ── Left tool dock (design "PHẦN TỬ" — labeled vertical list) ─────────────
  // Compact icon rail (Omniboard-style): one icon per category; hover reveals a
  // flyout grid of that category's shapes (draggable onto the canvas).
  private buildLeftToolbar() {
    const rail = el("div", "lk-rail");

    const sel = el("div", "lk-rail-item is-active");
    sel.innerHTML = CURSOR_ICON;
    sel.title = "Chọn (V)";
    sel.onclick = () => this.setTool("select");
    sel.onmouseenter = () => this.scheduleFlyoutClose();
    rail.appendChild(sel);
    this.railSelect = sel;

    // Hand / pan tool — drag the board (essential on touch where there's no Space key).
    const hand = el("div", "lk-rail-item");
    hand.innerHTML = HAND_ICON;
    hand.title = "Kéo board (H)";
    hand.onclick = () => this.setTool(this.tool === "pan" ? "select" : "pan");
    hand.onmouseenter = () => this.scheduleFlyoutClose();
    rail.appendChild(hand);
    this.railHand = hand;

    // Space tool — drag across the board to open or close room (bpmn-js style).
    const space = el("div", "lk-rail-item");
    space.innerHTML = SPACE_ICON;
    space.title = "Giãn / thu khoảng cách (S)";
    space.onclick = () => this.setTool(this.tool === "space" ? "select" : "space");
    space.onmouseenter = () => this.scheduleFlyoutClose();
    rail.appendChild(space);
    this.railSpace = space;

    // Arrow / message tool (directly below pan): hover (desktop) or tap (mobile) →
    // pick an arrow type. Generic arrows are orthogonal; sequence lifelines still
    // switch to a horizontal sequence connector.
    const arrow = el("div", "lk-rail-item");
    arrow.innerHTML = ARROW_ICON;
    arrow.title = "Mũi tên";
    arrow.onmouseenter = () => this.openArrowFlyout(arrow);
    arrow.onmouseleave = () => this.scheduleFlyoutClose();
    arrow.onclick = () => this.openArrowFlyout(arrow);
    rail.appendChild(arrow);

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

  // Representative shape icon for each diagram category (rail + mobile bar).
  private static readonly CAT_REP: Record<string, string> = {
    "Cơ bản": "bs-rect", "Flowchart": "fc-decision", "ERD": "erd-entity", "UML": "uml-class",
    "State": "st-state", "Sequence": "sq-actor", "Mindmap": "mm-root", "BPMN": "bpmn-gateway-x",
  };
  // Diagram categories that get a dedicated button on the mobile bottom bar (rest → "Sơ đồ khác" sheet).
  private static readonly QUICK_CATS = ["Cơ bản", "Flowchart", "ERD", "BPMN"];

  /**
   * Mobile toolbar (Excalidraw-style): one bottom bar in the thumb zone.
   * Tools (select / pan / arrow) · quick shapes (Flowchart, BPMN) · "Sơ đồ khác"
   * sheet for the rest · fit-to-frame. Zoom +/- is omitted — pinch handles zoom.
   */
  private buildMobileToolbar() {
    const FIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/></svg>`;
    const MORE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;
    const bar = el("div", "lk-mbar");
    const btn = (html: string, title: string, onClick: () => void) => {
      const b = el("div", "lk-mbar-item"); b.innerHTML = html; b.title = title; b.onclick = onClick;
      bar.appendChild(b); return b;
    };
    const sep = () => bar.appendChild(el("div", "lk-mbar-sep"));

    this.railSelect = btn(CURSOR_ICON, "Chọn", () => this.setTool("select"));
    this.railSelect.classList.add("is-active");
    this.railHand = btn(HAND_ICON, "Kéo board", () => this.setTool(this.tool === "pan" ? "select" : "pan"));
    const arrow = btn(ARROW_ICON, "Mũi tên", () => { });
    arrow.onclick = () => this.openArrowFlyout(arrow);

    sep();

    const byTitle = (t: string) => this.categories.find((c) => c.title === t);
    for (const title of OmniboardCanvas.QUICK_CATS) {
      const cat = byTitle(title); if (!cat) continue;
      const b = btn(shapeIcon(OmniboardCanvas.CAT_REP[title] ?? cat.items[0].shape), title, () => { });
      b.onclick = () => this.openFlyout(cat, b);
    }
    const more = btn(MORE, "Sơ đồ khác", () => { });
    more.onclick = () => this.openMoreSheet(more);

    sep();

    btn(FIT, "Vừa khung", () => { this.graph.zoomToFit({ padding: 40, maxScale: 1.2 }); this.updateZoom(); });

    this.root.appendChild(bar);
    this.mbar = bar;
  }

  /** Bottom-sheet of the remaining diagram categories (mobile "Sơ đồ khác"). */
  private openMoreSheet(anchor: HTMLElement) {
    this.cancelFlyoutClose();
    this.closeFlyoutNow();
    const rest = this.categories.filter((c) => !OmniboardCanvas.QUICK_CATS.includes(c.title));
    const fly = el("div", "lk-flyout");
    fly.appendChild(el("div", "lk-flyout-title", "Sơ đồ khác"));
    const grid = el("div", "lk-flyout-grid");
    for (const cat of rest) {
      const cell = el("div", "lk-flyout-cell",
        `${shapeIcon(OmniboardCanvas.CAT_REP[cat.title] ?? cat.items[0].shape)}<span class="lbl">${cat.title}</span>`);
      cell.style.cursor = "pointer";
      cell.onclick = () => this.openFlyout(cat, anchor);
      grid.appendChild(cell);
    }
    fly.appendChild(grid);
    this.root.appendChild(fly);
    this.positionFlyout(fly, anchor);
    this.flyout = fly;
  }

  /** Arrow-type flyout (mirrors openFlyout but drops edges, not nodes). */
  private openArrowFlyout(anchor: HTMLElement) {
    this.cancelFlyoutClose();
    this.closeFlyoutNow();
    const fly = el("div", "lk-flyout");
    fly.appendChild(el("div", "lk-flyout-title", "Mũi tên"));
    const grid = el("div", "lk-flyout-grid");
    for (const a of ARROW_TYPES) {
      const cell = el("div", "lk-flyout-cell", `${arrowPreview(a.style)}<span class="lbl">${a.label}</span>`);
      cell.title = `Thêm mũi tên "${a.label}"`;
      cell.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); this.placeArrow(a.style); this.closeFlyoutNow(); });
      grid.appendChild(cell);
    }
    fly.appendChild(grid);
    fly.onmouseenter = () => this.cancelFlyoutClose();
    fly.onmouseleave = () => this.scheduleFlyoutClose();
    this.root.appendChild(fly);
    this.positionFlyout(fly, anchor);
    this.flyout = fly;
  }

  /** Drop a standalone arrow at the centre of the visible canvas. */
  private placeArrow(style: EdgeStyle) {
    // Viewport centre → graph coords via rect + translate + scale (robust on iOS,
    // unlike X6's getScreenCTM-based clientToLocal).
    const r = this.graphMount.getBoundingClientRect();
    const t = this.graph.translate(); const s = this.graph.scale().sx || 1;
    const cx = (r.width / 2 - t.tx) / s, cy = (r.height / 2 - t.ty) / s;
    const edge = this.graph.addEdge({
      source: { x: Math.round(cx - 70), y: Math.round(cy) },
      target: { x: Math.round(cx + 70), y: Math.round(cy) },
      router: { name: "normal" }, connector: { name: "normal" },
      attrs: EDGE_ATTRS,
      data: { style },
    });
    this.applyEdgeStyle(edge);
    this.graph.resetSelection([edge]);
    this.onChange();
  }

  /**
   * Switch between the select tool and a free-pan ("hand") tool. In pan mode the
   * board is draggable anywhere without a modifier key (essential on touch, where
   * there is no Space key) and node interaction is suspended so drags always pan.
   */
  private setTool(tool: "select" | "pan" | "space"): void {
    this.cancelSpaceDrag();
    this.tool = tool;
    const pan = tool === "pan";
    const idle = tool !== "select";   // pan and space: nodes are not draggable, no rubberband
    // Suspend node interaction so a drag pans rather than moving a node. On mobile,
    // X6's native node-drag stays OFF even in select mode — we move nodes ourselves
    // via Pointer Events, and leaving X6's mouse-based drag on let it grab the
    // selected node off iOS-synthesised mouse events (the "node jumps to an empty
    // tap" bug). Arrowhead/magnet interaction stays on so edges still connect.
    (this.graph.options as { interacting?: unknown }).interacting =
      idle ? false : (this.isMobile ? { nodeMovable: false } : { edgeLabelMovable: true });
    // Disable the rubberband (blue selection box) while panning.
    const g = this.graph as unknown as { enableRubberband?: () => void; disableRubberband?: () => void };
    if (idle) g.disableRubberband?.(); else g.enableRubberband?.();
    // [Review][Patch P11] AC#7 — preserve selection across tool switches
    // (pan/zoom → select). Previously `cleanSelection()` ran on every switch
    // to pan, wiping the user's multi-selection. Selection indicators stay
    // visible during pan (Figma/Excalidraw convention).
    // Pan is implemented manually via Pointer Events (X6's built-in panning only
    // listens for mouse, so it doesn't work on touch). touch-action:none stops
    // the browser from turning the drag into a page scroll.
    const m = this.graphMount;
    // Detach both handler sets, then attach the active one. On touch we drive
    // selection/move/placement ourselves via Pointer Events because X6's touch
    // support is unreliable in the Obsidian webview (and our touch-event block,
    // needed to stop Obsidian's drawer swipe, also suppresses X6's touch drag).
    m.removeEventListener("pointerdown", this.onPanDown);
    m.removeEventListener("pointermove", this.onPanMove);
    m.removeEventListener("pointerup", this.onPanUp);
    m.removeEventListener("pointercancel", this.onPanUp);
    m.removeEventListener("pointerdown", this.onSelDown);
    m.removeEventListener("pointermove", this.onSelMove);
    m.removeEventListener("pointerup", this.onSelUp);
    m.removeEventListener("pointercancel", this.onSelUp);
    m.removeEventListener("pointerdown", this.onSpaceDown);
    m.removeEventListener("pointermove", this.onSpaceMove);
    m.removeEventListener("pointerup", this.onSpaceUp);
    m.removeEventListener("pointercancel", this.onSpaceUp);
    if (tool === "space") {
      m.addEventListener("pointerdown", this.onSpaceDown);
      m.addEventListener("pointermove", this.onSpaceMove);
      m.addEventListener("pointerup", this.onSpaceUp);
      m.addEventListener("pointercancel", this.onSpaceUp);
      m.style.cursor = "col-resize";
      this.setPending(null);
    } else if (pan) {
      m.addEventListener("pointerdown", this.onPanDown);
      m.addEventListener("pointermove", this.onPanMove);
      m.addEventListener("pointerup", this.onPanUp);
      m.addEventListener("pointercancel", this.onPanUp);
      m.style.cursor = "grab";   // touch-action:none is permanent via CSS (.lk-graph-mount)
      this.setPending(null);
    } else {
      m.addEventListener("pointerdown", this.onSelDown);
      m.addEventListener("pointermove", this.onSelMove);
      m.addEventListener("pointerup", this.onSelUp);
      m.addEventListener("pointercancel", this.onSelUp);
      m.style.cursor = "";
      this.panStart = null;
    }
    this.railSelect?.classList.toggle("is-active", tool === "select");
    this.railHand?.classList.toggle("is-active", pan);
    this.railSpace?.classList.toggle("is-active", tool === "space");
  }

  /**
   * Node under a client point — geometric bbox test, NOT elementFromPoint.
   * On mobile the node body is a foreignObject hidden via `visibility:hidden`
   * (WebKit overlay fix), so it isn't returned by elementFromPoint and ERD/UML
   * nodes became unselectable. Bbox containment works regardless. Topmost wins.
   */
  private nodeAtPoint(x: number, y: number): Node | null {
    const p = this.graph.clientToLocal(x, y);
    let hit: Node | null = null; let hitZ = -Infinity;
    for (const n of this.graph.getNodes()) {
      const b = n.getBBox();
      if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) {
        const z = (n.getZIndex?.() as number) ?? 0;
        if (z >= hitZ) { hit = n; hitZ = z; }
      }
    }
    return hit;
  }

  /**
   * Edge near a client point — geometric distance to each edge's rendered path
   * (EdgeView.getClosestPoint covers manhattan bends). A thin ~2px line is hard to
   * tap, so accept anything within ~14 screen px. Closest edge wins.
   */
  private edgeAtPoint(x: number, y: number): Edge | null {
    const p = this.graph.clientToLocal(x, y);
    let best: Edge | null = null;
    let bestD = 14 / (this.graph.scale().sx || 1);   // ~14px tolerance, in local units
    for (const edge of this.graph.getEdges()) {
      const view = this.graph.findViewByCell(edge) as { getClosestPoint?: (pt: { x: number; y: number }) => { x: number; y: number } | null } | null;
      const cp = view?.getClosestPoint?.(p);
      if (!cp) continue;
      const d = Math.hypot(cp.x - p.x, cp.y - p.y);
      if (d <= bestD) { bestD = d; best = edge; }
    }
    return best;
  }

  /** Arm a shape for tap-to-place (mobile-friendly add); shows a hint banner. */
  private setPending(item: PaletteItem | null): void {
    this.pendingShape = item;
    this.graphMount.style.cursor = item ? "copy" : (this.tool === "pan" ? "grab" : this.tool === "space" ? "col-resize" : "");
    if (item && !this.pendingHint) {
      this.pendingHint = el("div", "lk-place-hint", "Chạm vào canvas để đặt hình");
      this.root.appendChild(this.pendingHint);
    } else if (!item && this.pendingHint) {
      this.pendingHint.remove(); this.pendingHint = null;
    }
  }

  // ── Touch interaction (select tool): tap-select, drag-move, tap-to-place ──
  private onSelDown = (e: PointerEvent): void => {
    // Defensive: a prior gesture may have left a drag open (pointerup/cancel with a
    // mismatched pointerId, a mid-gesture tool switch…). Start every pointerdown
    // clean so a recycled iOS pointerId can't resume moving a stale node on what
    // should be a plain tap (caused "node jumps to the empty tap" intermittently).
    if (this.selDrag) {
      if (this.dragBatch) { this.graph.stopBatch("move"); this.dragBatch = false; }
      this.selDrag = null;
    }
    const node = this.nodeAtPoint(e.clientX, e.clientY);
    // Tap-to-place a pending shape — ONLY when nothing is selected. If a node/edge
    // is selected, an empty tap means "deselect" (and cancel any armed shape), NOT
    // "drop a node here" (that bug made the selected node appear to jump to the tap).
    if (this.pendingShape && !node && this.graph.getSelectedCells().length === 0) {
      const it = this.pendingShape;
      const p = this.graph.clientToLocal(e.clientX, e.clientY);
      const created = this.addPaletteNode(it, p);
      this.graph.resetSelection([created]);
      this.setPending(null);
      this.onChange();
      e.preventDefault();
      return;
    }
    if (e.pointerType === "mouse") return;   // desktop mouse select/move → X6 handles it
    if (node) {
      this.setPending(null);   // selecting a node cancels any armed tap-to-place shape
      const wasSelected = this.graph.isSelected(node);   // tap-on-already-selected → edit (mobile)
      this.graph.resetSelection([node]);
      const pos = node.position();
      this.selDrag = { id: e.pointerId, node, px: e.clientX, py: e.clientY, nx: pos.x, ny: pos.y, moved: false, wasSelected };
      // Batch the whole drag into ONE undo step (each pointermove fires node.position()
      // → without this, one drag = dozens of micro history commands).
      this.graph.startBatch("move"); this.dragBatch = true;
      try { this.graphMount.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
      e.preventDefault();
      return;
    }
    const edge = this.edgeAtPoint(e.clientX, e.clientY);
    if (edge) {
      this.setPending(null);
      this.graph.resetSelection([edge]);   // fires edge:selected → reshape tools + edge bar
      e.preventDefault();
    } else {
      // Tap on blank canvas → dismiss any open shape flyout / popup picker, cancel
      // any armed tap-to-place shape, and clear selection (touch has no hover-out
      // or reliable X6 blank:click).
      this.setPending(null);
      this.closeFlyoutNow();
      this.hidePopup();
      this.graph.cleanSelection();
      e.preventDefault();   // stop iOS from synthesising mouse events that X6 could act on
    }
  };
  private onSelMove = (e: PointerEvent): void => {
    if (this.pinch) return;   // two fingers down → gesture owns the move
    const d = this.selDrag; if (!d || e.pointerId !== d.id) return;
    const s = this.graph.scale().sx || 1;
    const was = d.moved;
    if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 3) d.moved = true;
    // Drag just started → hide the floating affordances so they don't lag behind
    // the node (the "+" quick-connect pads + the style bar). Re-shown on drop.
    if (d.moved && !was) { if (this.padLayer) this.padLayer.style.display = "none"; this.contextBar.style.display = "none"; }
    d.node.position(d.nx + (e.clientX - d.px) / s, d.ny + (e.clientY - d.py) / s);
    e.preventDefault();
  };
  private onSelUp = (e: PointerEvent): void => {
    const d = this.selDrag; if (!d || e.pointerId !== d.id) return;
    try { this.graphMount.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (this.dragBatch) { this.graph.stopBatch("move"); this.dragBatch = false; }   // close the 1-drag = 1-undo batch
    if (d.moved) { this.onChange(); this.refreshContextBar(); this.refreshContextPad(); } // re-show at the new spot
    else if (d.wasSelected) { this.editAtPoint(d.node, d.px, d.py); }   // tap an already-selected node → edit label
    this.selDrag = null;
  };

  /**
   * Mobile inline-edit: foreignObject is hidden on mobile so X6's node:dblclick /
   * DOM hit-test can't tell WHICH sub-label was tapped. Instead hit-test against the
   * real overlay div's children (visible, correct rects) and route to the matching
   * editor. Falls back to the node's main label.
   */
  private editAtPoint(node: Node, clientX: number, clientY: number): void {
    const overlay = this.htmlNodes.get(node.id);
    let target: HTMLElement | null = null;
    if (overlay) {
      const SEL = ".bp-pool-head, .bp-pool-lane-head, .erd-th, .erd-col .kk, .erd-col .cname, .erd-col .ctype, .uml-name, .uml-comp .ln, .bp-elabel, .sq-actor-lbl, .sq-pill, .sq-who";
      let bestArea = Infinity;
      overlay.querySelectorAll<HTMLElement>(SEL).forEach((elm) => {
        const r = elm.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          const a = r.width * r.height;
          if (a < bestArea) { bestArea = a; target = elm; }   // smallest containing = most specific
        }
      });
    }
    if (target && this.tryEditChildLabel(target, node)) return;
    this.editLabel(node);
  }

  private onPanDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.closeFlyoutNow(); this.hidePopup();   // tapping canvas dismisses overlays
    const t = this.graph.translate();
    this.panStart = { px: e.clientX, py: e.clientY, tx: t.tx, ty: t.ty, id: e.pointerId };
    try { this.graphMount.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
    this.graphMount.style.cursor = "grabbing";
    e.preventDefault();
  };
  private onPanMove = (e: PointerEvent): void => {
    if (this.pinch) return;   // two fingers down → gesture owns the move
    const s = this.panStart; if (!s || e.pointerId !== s.id) return;
    this.graph.translate(s.tx + (e.clientX - s.px), s.ty + (e.clientY - s.py));
    e.preventDefault();
  };
  private onPanUp = (e: PointerEvent): void => {
    if (!this.panStart || e.pointerId !== this.panStart.id) return;
    try { this.graphMount.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    this.panStart = null;
    if (this.tool === "pan") this.graphMount.style.cursor = "grab";
  };

  // ── Space tool ───────────────────────────────────────────────────────────
  private space: {
    id: number; sx: number; sy: number; axis: Axis | null; line: number; last: number;
    move: Node[]; resize: Array<{ node: Node; w: number; h: number }>; edges: Array<{ edge: Edge; verts: Array<{ x: number; y: number }> }>;
    guide: HTMLElement; boxes: SpaceBox[]; plan: ReturnType<typeof planSpace> | null;
    pools: Array<{ node: Node; lanes: NonNullable<ReturnType<OmniboardCanvas["nodeExtra"]>["lanes"]>; horizontal: boolean; extent: number; rel: number }>; floor: number;
  } | null = null;

  private onSpaceDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.closeFlyoutNow(); this.hidePopup();
    const p = this.graph.clientToLocal(e.clientX, e.clientY);
    const guide = el("div", "lk-space-guide");
    guide.style.display = "none";
    this.graphMount.appendChild(guide);
    this.space = { id: e.pointerId, sx: p.x, sy: p.y, axis: null, line: 0, last: 0, move: [], resize: [], edges: [], guide, boxes: [], plan: null, pools: [], floor: -Infinity };
    try { this.graphMount.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
    e.preventDefault();
  };

  private onSpaceMove = (e: PointerEvent): void => {
    const s = this.space; if (!s || e.pointerId !== s.id) return;
    const p = this.graph.clientToLocal(e.clientX, e.clientY);
    if (!s.axis) {
      if (Math.hypot(p.x - s.sx, p.y - s.sy) < 6 / (this.graph.scale().sx || 1)) return;
      this.beginSpace(s, Math.abs(p.x - s.sx) >= Math.abs(p.y - s.sy) ? "x" : "y");
    }
    const axis = s.axis!;
    const want = (axis === "x" ? p.x - s.sx : p.y - s.sy);
    const delta = Math.max(Math.round(clampDelta(want, s.boxes, s.plan!.resize, axis)), s.floor);
    const step = delta - s.last;
    if (step === 0) { e.preventDefault(); return; }
    s.last = delta;
    for (const n of s.move) n.translate(axis === "x" ? step : 0, axis === "y" ? step : 0);
    for (const r of s.resize) r.node.resize(r.w + (axis === "x" ? delta : 0), r.h + (axis === "y" ? delta : 0));
    // The lane the line crosses takes the room; the others (and their shapes) keep their size.
    for (const pl of s.pools) {
      const grown = growLaneAt(asStackLanes(pl.lanes, pl.horizontal), pl.extent, pl.rel, delta);
      pl.node.setData({ ...pl.node.getData(), lanes: fromStackLanesDeep(pl.lanes, grown, pl.horizontal) }, { deep: false });
      this.rerender(pl.node);
    }
    for (const it of s.edges) it.edge.setVertices(shiftVertices(it.verts, axis, s.line, delta));
    e.preventDefault();
  };

  /** Fix the axis and line, snapshot what the drag acts on, open one undo step. */
  private beginSpace(s: NonNullable<OmniboardCanvas["space"]>, axis: Axis): void {
    s.axis = axis;
    s.line = axis === "x" ? s.sx : s.sy;
    const nodes = this.graph.getNodes().filter((n) => n.isVisible());
    s.boxes = nodes.map((n) => {
      const b = n.getBBox();
      return { id: n.id, x: b.x, y: b.y, w: b.width, h: b.height, frame: FRAME_KINDS.has(this.nodeKind(n)), parentId: n.getParent()?.id };
    });
    s.plan = planSpace(s.boxes, axis, s.line);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    s.move = s.plan.move.map((id) => byId.get(id)!);
    s.resize = s.plan.resize.map((id) => { const n = byId.get(id)!; const z = n.getSize(); return { node: n, w: z.width, h: z.height }; });
    // A pool cut along its stacking axis: remember its lanes and where the line falls.
    for (const r of s.resize) {
      const ex = this.nodeExtra(r.node);
      const horizontal = ex.poolHorizontal !== false;
      if (this.nodeKind(r.node) !== "bpmn-pool" || !ex.lanes?.length || (horizontal ? "y" : "x") !== axis) continue;
      const extent = horizontal ? r.h : r.w;
      const rel = s.line - r.node.getPosition()[axis];
      s.pools.push({ node: r.node, lanes: ex.lanes, horizontal, extent, rel });
      s.floor = Math.max(s.floor, 30 - leafLaneSize(asStackLanes(ex.lanes, horizontal), extent, rel));
    }
    s.edges = this.graph.getEdges().filter((e) => e.getVertices().length).map((edge) => ({ edge, verts: edge.getVertices().map((v) => ({ x: v.x, y: v.y })) }));
    // the guide line sits on the start point, across the whole board
    s.guide.style.display = "block";
    const c = this.graph.localToClient(s.sx, s.sy);
    const r = this.graphMount.getBoundingClientRect();
    s.guide.style.cssText = axis === "x"
      ? `display:block;left:${c.x - r.left}px;top:0;bottom:0;width:0;border-left:1.5px dashed var(--pg-accent)`
      : `display:block;top:${c.y - r.top}px;left:0;right:0;height:0;border-top:1.5px dashed var(--pg-accent)`;
    this.graph.cleanSelection();
    this.graph.startBatch("space");
  }

  private onSpaceUp = (e: PointerEvent): void => {
    const s = this.space; if (!s || e.pointerId !== s.id) return;
    try { this.graphMount.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    this.endSpace(true);
  };
  private cancelSpaceDrag(): void { if (this.space) this.endSpace(false); }
  private endSpace(commit: boolean): void {
    const s = this.space; if (!s) return;
    this.space = null;
    s.guide.remove();
    if (!s.axis) return;
    this.graph.stopBatch("space");
    if (!commit) { if (s.last !== 0) this.graph.undo(); return; }
    for (const r of s.resize) this.rerender(r.node);
    if (s.last !== 0) this.onChange();
  }

  // ── Find on the board (Ctrl+F) ───────────────────────────────────────────
  private searchBox: HTMLElement | null = null;
  openSearch(): void {
    if (this.searchBox) { (this.searchBox.querySelector("input") as HTMLInputElement).select(); return; }
    const box = el("div", "lk-search");
    const input = el("input", "lk-pinput") as HTMLInputElement;
    input.placeholder = "Tìm phần tử…";
    const count = el("span", "lk-search-count", "");
    const prev = el("button", "lk-cb-btn", "↑"); prev.title = "Kết quả trước (Shift+Enter)";
    const next = el("button", "lk-cb-btn", "↓"); next.title = "Kết quả sau (Enter)";
    const close = el("button", "lk-cb-btn", "✕"); close.title = "Đóng (Esc)";
    box.append(input, count, prev, next, close);
    this.root.appendChild(box);
    this.searchBox = box;
    let matches: Node[] = [];
    let cur = -1;
    const show = () => {
      count.textContent = input.value.trim() ? (matches.length ? `${cur + 1}/${matches.length}` : "0") : "";
      const n = matches[cur];
      if (!n) return;
      this.graph.resetSelection([n]);
      this.graph.centerCell(n);
    };
    const search = () => {
      const items = this.graph.getNodes().filter((n) => n.isVisible()).map((n) => ({ id: n.id, label: this.nodeLabel(n), x: n.getPosition().x, y: n.getPosition().y, node: n }));
      matches = findMatches(items, input.value).map((m) => m.node);
      cur = matches.length ? 0 : -1;
      show();
    };
    const step = (dir: 1 | -1) => { cur = stepIndex(cur, matches.length, dir); show(); };
    const closeBox = () => { box.remove(); this.searchBox = null; };
    input.oninput = search;
    input.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); step(ev.shiftKey ? -1 : 1); }
      else if (ev.key === "Escape") { ev.preventDefault(); closeBox(); }
    };
    prev.onclick = () => step(-1); next.onclick = () => step(1); close.onclick = closeBox;
    input.focus();
  }

  private openFlyout(cat: ShapeCategory, anchor: HTMLElement) {
    this.cancelFlyoutClose();
    this.closeFlyoutNow();
    const fly = el("div", "lk-flyout");
    fly.appendChild(el("div", "lk-flyout-title", cat.title));
    const grid = el("div", "lk-flyout-grid");
    const mkCell = (item: PaletteItem) => {
      const cell = el("div", "lk-flyout-cell", `${shapeIcon(item.shape, item.seed)}<span class="lbl">${item.label}</span>`);
      cell.title = `Kéo "${item.label}" vào canvas`;
      cell.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") this.startDrag(e, item, cell); });
      cell.addEventListener("touchstart", (e) => this.startTouchDrag(e, item, cell), { passive: false });
      return cell;
    };
    const common = cat.items.filter((i) => !i.advanced);
    const advanced = cat.items.filter((i) => i.advanced);
    for (const item of common) grid.appendChild(mkCell(item));
    if (advanced.length > 0) {
      const more = el("button", "lk-flyout-more", `Load more (${advanced.length})`);
      more.onclick = () => {
        const frag = document.createDocumentFragment();
        for (const it of advanced) frag.appendChild(mkCell(it));
        more.parentElement?.insertBefore(frag, more);
        more.remove();
        // Re-position so the now-taller flyout still fits in the board view.
        this.positionFlyout(fly, anchor);
      };
      grid.appendChild(more);
    }
    fly.appendChild(grid);
    fly.onmouseenter = () => this.cancelFlyoutClose();
    fly.onmouseleave = () => this.scheduleFlyoutClose();
    this.root.appendChild(fly);
    this.positionFlyout(fly, anchor);
    this.flyout = fly;
  }
  /** Place a flyout just to the right of its rail anchor, clamped within the root. */
  private positionFlyout(fly: HTMLElement, anchor: HTMLElement) {
    const ir = anchor.getBoundingClientRect();
    const rr = this.root.getBoundingClientRect();
    // Cap the flyout height to the actual board-view height so it never extends
    // past the visible area (root.height ≠ 100vh inside Obsidian's leaf layout).
    // Set BEFORE reading offsetHeight so the read reflects the post-clamp size.
    fly.style.maxHeight = Math.max(160, rr.height - 24) + "px";
    if (this.isMobile) {
      // Bottom bar → open the flyout ABOVE the anchor, centered and clamped.
      const w = fly.offsetWidth;
      const left = Math.min(Math.max(8, ir.left - rr.left + ir.width / 2 - w / 2), Math.max(8, rr.width - w - 8));
      fly.style.left = left + "px";
      fly.style.top = Math.max(8, ir.top - rr.top - fly.offsetHeight - 10) + "px";
      return;
    }
    fly.style.left = (ir.right - rr.left + 8) + "px";
    const maxTop = rr.height - fly.offsetHeight - 12;
    fly.style.top = Math.min(Math.max(8, ir.top - rr.top - 6), Math.max(8, maxTop)) + "px";
  }
  private closeFlyoutNow() { this.flyout?.remove(); this.flyout = null; }
  private cancelFlyoutClose() { if (this.flyoutTimer !== null) { window.clearTimeout(this.flyoutTimer); this.flyoutTimer = null; } }
  private scheduleFlyoutClose() {
    this.cancelFlyoutClose();
    this.flyoutTimer = window.setTimeout(() => this.closeFlyoutNow(), 160);
  }

  // Add a shape from the palette to the canvas.
  /**
   * Two ways to add, both via Pointer Events (mouse + touch):
   *  - DRAG the cell onto the bare canvas → drop the node at the release point.
   *  - TAP the cell (no real drag, or release still over the flyout) → arm the
   *    shape for tap-to-place; the next tap on the canvas drops it there. This is
   *    the mobile path and also fixes the old bug where a tap created the node at
   *    the flyout's location (top-left) because the flyout overlays the canvas.
   */
  private startDrag(e: PointerEvent, item: PaletteItem, source: HTMLElement) {
    e.preventDefault();
    const ghost = el("div", "lk-drag-ghost", shapeIcon(item.shape, item.seed));
    document.body.appendChild(ghost);
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > 6) moved = true;
      ghost.style.left = ev.clientX + 8 + "px"; ghost.style.top = ev.clientY + 8 + "px";
    };
    move(e);
    try { source.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
    const end = (ev: PointerEvent) => {
      source.removeEventListener("pointermove", move);
      source.removeEventListener("pointerup", end);
      source.removeEventListener("pointercancel", end);
      try { source.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      ghost.remove();
      const onCanvas = this.pointInGraph(ev.clientX, ev.clientY);
      const onFlyout = this.flyout ? this.pointInRect(ev.clientX, ev.clientY, this.flyout) : false;
      this.closeFlyoutNow();
      // A real DRAG onto the canvas (mouse or touch) drops the node at the release
      // point — `moved` (>6px) rules out finger-jitter on a tap, and pointer capture
      // on the source keeps pointermove firing once the finger is over the canvas.
      // A pure TAP (no drag) falls back to tap-to-place: arm the shape, next canvas
      // tap positions it. This avoids the old "node lands at top-left" jitter bug.
      if (moved && onCanvas && !onFlyout) {
        const p = this.graph.clientToLocal(ev.clientX, ev.clientY);
        const node = this.addPaletteNode(item, p);
        this.graph.resetSelection([node]);
        this.onChange();
      } else {
        if (this.tool === "pan") this.setTool("select");
        this.setPending(item);
      }
    };
    source.addEventListener("pointermove", move);
    source.addEventListener("pointerup", end);
    source.addEventListener("pointercancel", end);
  }

  /**
   * Touch counterpart of startDrag (iOS WebKit). touchmove/touchend reliably fire
   * on the touchstart target even after the finger leaves it, so a single press →
   * drag → release drops the node at the release point. No second tap needed.
   */
  private startTouchDrag(e: TouchEvent, item: PaletteItem, source: HTMLElement) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const t0 = e.touches[0];
    const ghost = el("div", "lk-drag-ghost", shapeIcon(item.shape, item.seed));
    document.body.appendChild(ghost);
    const place = (x: number, y: number) => { ghost.style.left = x + 8 + "px"; ghost.style.top = y + 8 + "px"; };
    place(t0.clientX, t0.clientY);
    let moved = false;
    const move = (ev: TouchEvent) => {
      const t = ev.touches[0]; if (!t) return;
      if (Math.abs(t.clientX - t0.clientX) + Math.abs(t.clientY - t0.clientY) > 6) moved = true;
      place(t.clientX, t.clientY);
      ev.preventDefault();
    };
    const end = (ev: TouchEvent) => {
      source.removeEventListener("touchmove", move);
      source.removeEventListener("touchend", end);
      source.removeEventListener("touchcancel", end);
      ghost.remove();
      const t = ev.changedTouches[0];
      const onCanvas = !!t && this.pointInGraph(t.clientX, t.clientY);
      const onFlyout = !!t && !!this.flyout && this.pointInRect(t.clientX, t.clientY, this.flyout);
      this.closeFlyoutNow();
      if (moved && onCanvas && !onFlyout && t) {
        const p = this.graph.clientToLocal(t.clientX, t.clientY);
        const node = this.addPaletteNode(item, p);
        this.graph.resetSelection([node]);
        this.onChange();
      } else {
        if (this.tool === "pan") this.setTool("select");
        this.setPending(item);
      }
    };
    source.addEventListener("touchmove", move, { passive: false });
    source.addEventListener("touchend", end);
    source.addEventListener("touchcancel", end);
  }

  private pointInRect(x: number, y: number, el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  private pointInGraph(x: number, y: number): boolean {
    return this.pointInRect(x, y, this.graphMount);
  }

  // ── Zoom control (bottom-left, design style) ─────────────────────────────
  private buildBottomControls() {
    const SVG = (path: string) =>
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const ICON_MINUS = SVG(`<path d="M5 12h14"/>`);
    const ICON_PLUS = SVG(`<path d="M12 5v14M5 12h14"/>`);
    const ICON_FIT = SVG(`<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>`);

    const wrap = el("div", "lk-zoomctl");
    const mk = (icon: string, title: string, fn: () => void) => {
      const b = el("button", "lk-ctrl-btn"); b.innerHTML = icon; b.title = title; b.onclick = fn; return b;
    };
    wrap.appendChild(mk(ICON_MINUS, "Thu nhỏ", () => { this.graph.zoom(-0.1); this.updateZoom(); }));
    this.zoomLabel = el("span", "lk-zoom-lvl", "100%");
    wrap.appendChild(this.zoomLabel);
    wrap.appendChild(mk(ICON_PLUS, "Phóng to", () => { this.graph.zoom(0.1); this.updateZoom(); }));
    wrap.appendChild(mk(ICON_FIT, "Vừa khung", () => { this.graph.zoomToFit({ padding: 40, maxScale: 1.2 }); this.updateZoom(); }));
    const menuBtn = mk(ICON_MENU, "Menu board", () => this.openBoardMenu(menuBtn));
    wrap.prepend(menuBtn, el("span", "lk-zoom-sep"));
    this.root.appendChild(wrap);
    this.graph.on("scale", () => this.updateZoom());
  }
  /** Change the board look (merged into the current state) and save it with the file. */
  private setAppState(patch: BoardAppState): void {
    const next: BoardAppState = { ...this.appState, ...patch };
    for (const k of Object.keys(next) as (keyof BoardAppState)[]) if (next[k] === undefined) delete next[k];
    this.applyAppState(next);
    this.onChange();
  }

  private applyAppState(state: BoardAppState): void {
    this.appState = { ...state };
    const dark = state.theme === "dark";
    this.root.classList.toggle("lk-dark", dark);
    this.graph.drawGrid({ type: "dot", args: { color: dark ? GRID_DOT.dark : GRID_DOT.light, thickness: 2 } });
    const bg = dark ? state.backgroundDark : state.background;
    if (bg) this.root.style.setProperty("--lk-board-bg", bg);
    else this.root.style.removeProperty("--lk-board-bg");
  }

  /** ☰ menu, like Excalidraw's: board background swatches + dark mode toggle. */
  private openBoardMenu(anchor: HTMLElement): void {
    const wrap = el("div", "lk-color-popup lk-board-menu");
    wrap.appendChild(el("div", "lk-popup-title", "Màu nền board"));
    const row = el("div", "lk-color-grid");
    const dark = this.appState.theme === "dark";
    // Each theme keeps its own background, so switching never shows a light paper in dark mode.
    const key = dark ? "backgroundDark" : "background";
    const swatches = dark ? BOARD_BG_SWATCHES_DARK : BOARD_BG_SWATCHES;
    const cur = this.appState[key];
    for (const c of swatches) {
      const sw = el("div", "lk-swatch" + ((cur ?? swatches[0]) === c ? " is-active" : ""));
      sw.style.background = c;
      sw.title = c;
      sw.onclick = () => { this.setAppState({ [key]: c === swatches[0] ? undefined : c }); this.openBoardMenu(anchor); };
      row.appendChild(sw);
    }
    const plus = el("div", "lk-swatch lk-swatch-add", "+");
    plus.onclick = () => this.openColorWheel(cur ?? swatches[0], (hx) => this.setAppState({ [key]: hx }), anchor);
    row.appendChild(plus);
    wrap.appendChild(row);
    const item = el("button", "lk-menu-item");
    item.innerHTML = `${dark ? ICON_SUN : ICON_MOON}<span>${dark ? "Chế độ sáng" : "Chế độ tối"}</span>`;
    item.onclick = () => { this.setAppState({ theme: dark ? undefined : "dark" }); this.openBoardMenu(anchor); };
    wrap.appendChild(item);
    this.showPopup(wrap, anchor);
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

  setSelectionChangeHandler(handler: (() => void) | null): void {
    this.selectionChangeHandler = handler;
  }

  private notifySelectionChanged(): void {
    this.selectionChangeHandler?.();
  }

  getSelectedNodeSnapshot(): SelectedNodeSnapshot | null {
    const nodes = this.graph.getSelectedCells().filter((c) => c.isNode()) as Node[];
    if (nodes.length !== 1) return null;
    const node = nodes[0];
    const p = node.getPosition();
    const s = node.getSize();
    return {
      id: node.id,
      kind: this.nodeKind(node),
      label: this.nodeLabel(node),
      attrs: { ...(node.getData() ?? {}) },
      style: this.nodeStyle(node),
      position: { x: p.x, y: p.y },
      size: { width: s.width, height: s.height },
    };
  }

  // Story 6.1 — Returns ALL selected node snapshots (empty array when none).
  // PropertiesPanel uses this for multi-select UX. Single-cell callers should
  // keep using getSelectedNodeSnapshot() for backwards compatibility.
  getSelectedNodesSnapshot(): SelectedNodeSnapshot[] {
    const nodes = this.graph.getSelectedCells().filter((c) => c.isNode()) as Node[];
    return nodes.map((node) => {
      const p = node.getPosition();
      const s = node.getSize();
      return {
        id: node.id,
        kind: this.nodeKind(node),
        label: this.nodeLabel(node),
        attrs: { ...(node.getData() ?? {}) },
        style: this.nodeStyle(node),
        position: { x: p.x, y: p.y },
        size: { width: s.width, height: s.height },
      };
    });
  }

  // Story 6.1 — Apply the same style patch to every cell in `ids` inside one
  // X6 batch so undo treats it as a single step. Callers compute the patch
  // (e.g. from PropertiesPanel) and we just iterate-and-write. Cells with
  // unknown ids are silently skipped.
  // [Review][Patch P8] `setStyle` calls `onChange` + `rerender` per cell — N
  // cells × M keystrokes = N×M re-saves. Use silent in-place update + a single
  // onChange() at the end of the batch. Also skip onChange when zero patches
  // landed (all ids resolved to nothing).
  // [Review][Patch P13] Don't pre-merge here — `setStyle` already merges
  // prev+patch internally; passing a pre-merged object is wasted work and
  // bypasses future setStyle normalization.
  patchNodesBulk(ids: string[], style: Partial<NodeStyle>): void {
    if (!ids.length) return;
    let applied = 0;
    this.graph.startBatch("bulk-style");
    try {
      for (const id of ids) {
        const cell = this.graph.getCellById(id);
        if (!cell?.isNode()) continue;
        const node = cell as Node;
        const next = { ...this.nodeStyle(node), ...style };
        node.setData({ ...node.getData(), style: next });
        this.rerender(node);
        applied++;
      }
    } finally { this.graph.stopBatch("bulk-style"); }
    if (applied > 0) this.onChange();
  }

  patchSelectedNode(patch: {
    label?: string;
    attrs?: Record<string, unknown>;
    style?: Partial<NodeStyle>;
    position?: Partial<{ x: number; y: number }>;
    size?: Partial<{ width: number; height: number }>;
  }): void {
    const nodes = this.graph.getSelectedCells().filter((c) => c.isNode()) as Node[];
    if (nodes.length !== 1) return;
    const node = nodes[0];
    if (patch.label !== undefined) node.setData({ ...node.getData(), label: patch.label });
    if (patch.attrs) node.setData({ ...node.getData(), ...patch.attrs });
    if (patch.style) this.setStyle(node, patch.style);
    if (patch.position) {
      const p = node.getPosition();
      node.setPosition(patch.position.x ?? p.x, patch.position.y ?? p.y);
    }
    if (patch.size) {
      const s = node.getSize();
      node.resize(patch.size.width ?? s.width, patch.size.height ?? s.height);
    }
    this.rerender(node);
    this.onChange();
    this.refreshProps();
    this.notifySelectionChanged();
  }

  private refreshProps() {
    const body = this.propsBody;
    if (!body) return;
    body.innerHTML = "";
    const cells = this.graph.getSelectedCells();
    const nodes = cells.filter((c) => c.isNode()) as Node[];
    if (cells.length === 1 && cells[0].isEdge() && this.buildSequenceFlowEditor(cells[0] as Edge, body)) return;
    if (nodes.length !== 1) {
      const empty = el("div", "lk-props-empty");
      empty.innerHTML = `<div class="lk-props-empty-ic">◇</div>Chọn một phần tử trên canvas để chỉnh nội dung, màu và vị trí.`;
      body.appendChild(empty);
      this.notifySelectionChanged();
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

    // Data-driven editors (ERD columns / UML members / BPMN properties)
    const kind = this.nodeKind(node);
    if (kind === "erd-entity") this.buildErdEditor(node, body);
    else if (kind === "uml-class" || kind === "uml-interface") this.buildUmlEditor(node, body);
    if (kind.startsWith("bpmn-")) this.buildBpmnPropsEditor(node, body);

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
    const fontIn = el("input", "lk-pinput") as HTMLInputElement;
    fontIn.type = "number"; fontIn.min = "6"; fontIn.max = "96"; fontIn.step = "1";
    fontIn.value = String(st.fontSize || defaultFontSizeFor(node));
    const applyFont = () => {
      const v = Math.max(6, Math.min(96, Math.round(Number(fontIn.value)) || defaultFontSizeFor(node)));
      fontIn.value = String(v);
      this.setStyle(node, { fontSize: v });
    };
    fontIn.oninput = () => { const n = Number(fontIn.value); if (Number.isFinite(n) && n >= 6 && n <= 96) this.setStyle(node, { fontSize: Math.round(n) }); };
    fontIn.onblur = applyFont;
    field(s2, "Cỡ chữ", fontIn);

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
    this.notifySelectionChanged();
  }

  // ── BPMN Properties editor (Phase D) ──────────────────────────────────────
  /** Condition of a BPMN sequence flow (bpmn:conditionExpression body). False
   *  when the edge is not one, so the caller shows the empty state. */
  private buildSequenceFlowEditor(edge: Edge, body: HTMLElement): boolean {
    const d = (edge.getData() as { bpmnKind?: string; bpmnAttrs?: Record<string, unknown> } | undefined) ?? {};
    const ft = this.edgeStyle(edge).flowType;
    const ends = [edge.getSourceCell(), edge.getTargetCell()];
    const isSequence = !d.bpmnKind || d.bpmnKind === "sequence";
    if (!isSequence || ft === "message" || ft === "association"
      || !ends.every((c) => c?.isNode() && this.nodeKind(c as Node).startsWith("bpmn-"))) return false;
    const s = el("div", "lk-psec"); s.appendChild(el("div", "lk-psec-h", "Sequence flow")); body.appendChild(s);
    const f = el("div", "lk-pfield"); f.appendChild(el("label", undefined, "Điều kiện")); s.appendChild(f);
    const ta = el("textarea", "lk-ptextarea") as HTMLTextAreaElement;
    ta.rows = 3; ta.placeholder = "${amount > 1000}";
    ta.value = (d.bpmnAttrs?.condition as string | undefined) ?? "";
    ta.oninput = () => {
      const cur = (edge.getData() as typeof d | undefined) ?? {};
      const attrs = { ...(cur.bpmnAttrs ?? {}), condition: ta.value.trim() || undefined };
      if (!attrs.condition) delete attrs.condition;
      edge.setData({ ...cur, bpmnAttrs: Object.keys(attrs).length ? attrs : undefined }, { deep: false });
      this.onChange();
    };
    f.appendChild(ta);
    return true;
  }

  private buildBpmnPropsEditor(node: Node, body: HTMLElement): void {
    const kind = this.nodeKind(node);
    const ex = this.nodeExtra(node);
    const d = (node.getData() ?? {}) as Record<string, unknown>;
    const sec = (title: string) => {
      const s = el("div", "lk-psec"); s.appendChild(el("div", "lk-psec-h", title)); body.appendChild(s); return s;
    };
    const field = (parent: HTMLElement, label: string, control: HTMLElement) => {
      const f = el("div", "lk-pfield");
      f.appendChild(el("label", undefined, label));
      f.appendChild(control); parent.appendChild(f);
    };
    const save = (patch: Record<string, unknown>) => {
      node.setData({ ...node.getData(), ...patch });
      this.rerender(node); this.onChange();
    };

    // ── BPMN color ───────────────────────────────────────────────────────────
    const bpmnFill = d.bpmnFill as string | undefined;
    const bpmnStroke = d.bpmnStroke as string | undefined;
    if (!kind.endsWith("-lane") && !kind.endsWith("-pool")) {
      const sColor = sec("Màu BPMN");
      const makeColor = (label: string, key: "bpmnFill" | "bpmnStroke", cur: string | undefined) => {
        const wrap = el("div", "lk-prow2");
        const inp = el("input", "lk-pinput lk-pcolor") as HTMLInputElement;
        inp.type = "text"; inp.placeholder = "#ffffff"; inp.value = cur ?? "";
        inp.oninput = () => { save({ [key]: inp.value.trim() || undefined }); };
        const swatch = el("div", "lk-pswatch lk-pcolor-swatch");
        swatch.style.background = cur ?? "transparent";
        inp.addEventListener("input", () => { swatch.style.background = inp.value.trim() || "transparent"; });
        wrap.appendChild(swatch); wrap.appendChild(inp);
        field(sColor, label, wrap);
      };
      makeColor("Fill", "bpmnFill", bpmnFill);
      makeColor("Stroke", "bpmnStroke", bpmnStroke);
    }

    // ── Event trigger (for event nodes) ─────────────────────────────────────
    if (kind === "bpmn-event-start" || kind === "bpmn-event-intermediate" || kind === "bpmn-event-end") {
      const sTrig = sec("Trigger sự kiện");
      const sel = el("select", "lk-pselect") as HTMLSelectElement;
      for (const t of triggerChoices(kind, ex)) {
        const opt = document.createElement("option"); opt.value = t === "none" ? "" : t;
        opt.textContent = t === "none" ? "(none)" : t; if ((ex.trigger ?? "") === opt.value) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => { save({ trigger: sel.value || undefined }); };
      field(sTrig, "Trigger", sel);
      if (kind === "bpmn-event-intermediate") {
        const thrChk = el("input") as HTMLInputElement;
        thrChk.type = "checkbox"; thrChk.checked = ex.throwing === true;
        // The trigger list depends on throwing — rebuild the panel.
        thrChk.onchange = () => { save({ throwing: thrChk.checked }); this.refreshProps(); };
        field(sTrig, "Throwing", thrChk);
      }
    }

    // ── Loop type (activities) ───────────────────────────────────────────────
    const isActivity = kind.startsWith("bpmn-task") || kind === "bpmn-subprocess"
      || kind === "bpmn-transaction" || kind === "bpmn-adhoc-subprocess"
      || kind === "bpmn-event-subprocess" || kind === "bpmn-call-activity";
    if (isActivity) {
      const sLoop = sec("Đặc tính vòng lặp");
      const LOOP_OPTS: Array<[string, string]> = [
        ["", "Không"], ["loop", "Vòng lặp"], ["mi-par", "Multi-instance //"], ["mi-seq", "Multi-instance ≡"],
      ];
      const sel = el("select", "lk-pselect") as HTMLSelectElement;
      const curLoop = ex.markers?.find(m => m === "loop" || m === "mi-par" || m === "mi-seq") ?? "";
      for (const [v, l] of LOOP_OPTS) {
        const opt = document.createElement("option"); opt.value = v; opt.textContent = l;
        if (curLoop === v) opt.selected = true; sel.appendChild(opt);
      }
      sel.onchange = () => {
        const other = (ex.markers ?? []).filter(m => m !== "loop" && m !== "mi-par" && m !== "mi-seq");
        save({ markers: sel.value ? [...other, sel.value as "loop" | "mi-par" | "mi-seq"] : other });
      };
      field(sLoop, "Kiểu", sel);
      const compChk = el("input") as HTMLInputElement;
      compChk.type = "checkbox"; compChk.checked = (ex.markers ?? []).includes("compensation");
      compChk.onchange = () => {
        const others = (ex.markers ?? []).filter(m => m !== "compensation");
        save({ markers: compChk.checked ? [...others, "compensation" as const] : others });
      };
      field(sLoop, "Compensation", compChk);
    }

    // ── Identity: ID + called element ───────────────────────────────────────
    const sId = sec("Định danh");
    const idInp = el("input", "lk-pinput") as HTMLInputElement;
    idInp.value = node.id;
    idInp.onchange = () => {
      const next = idInp.value.trim();
      if (this.renameNode(node.id, next)) return;
      idInp.setCustomValidity(`ID "${next}" không hợp lệ hoặc đã có.`);
      idInp.reportValidity();
      idInp.setCustomValidity("");
      idInp.value = node.id;
    };
    field(sId, "ID", idInp);
    if (kind === "bpmn-call-activity") {
      const callInp = el("input", "lk-pinput") as HTMLInputElement;
      callInp.placeholder = "ID process được gọi";
      callInp.value = (d.calledElement as string | undefined) ?? "";
      callInp.oninput = () => { save({ calledElement: callInp.value.trim() || undefined }); };
      field(sId, "calledElement", callInp);
    }

    // ── BPMN Documentation ───────────────────────────────────────────────────
    const sDocs = sec("Mô tả (documentation)");
    const docTa = el("textarea", "lk-ptextarea") as HTMLTextAreaElement;
    docTa.rows = 4; docTa.placeholder = "Nhập mô tả phần tử BPMN...";
    docTa.value = (d.bpmnDoc as string | undefined) ?? "";
    docTa.oninput = () => { save({ bpmnDoc: docTa.value.trim() || undefined }); };
    sDocs.appendChild(docTa);

    // ── Camunda properties ───────────────────────────────────────────────────
    const camunda = (d.camunda as Record<string, string> | undefined) ?? {};
    const CAMUNDA_FIELDS: Array<[string, string]> = [
      ["assignee", "Assignee"], ["candidateUsers", "Candidate users"], ["candidateGroups", "Candidate groups"],
      ["formKey", "Form key"], ["dueDate", "Due date"], ["priority", "Priority"],
    ];
    const hasCamundaData = CAMUNDA_FIELDS.some(([k]) => camunda[k]);
    if (hasCamundaData || kind === "bpmn-task-user") {
      const sCam = sec("Camunda");
      for (const [key, label] of CAMUNDA_FIELDS) {
        const inp = el("input", "lk-pinput") as HTMLInputElement;
        inp.value = camunda[key] ?? ""; inp.placeholder = label;
        inp.oninput = () => {
          const updated = { ...camunda, [key]: inp.value.trim() || undefined };
          save({ camunda: Object.fromEntries(Object.entries(updated).filter(([, v]) => v !== undefined)) });
        };
        field(sCam, label, inp);
      }
    }

    // ── Custom bpmnProps ─────────────────────────────────────────────────────
    const bpmnProps = (d.bpmnProps as Array<{ name: string; value: string }> | undefined) ?? [];
    if (bpmnProps.length) {
      const sProps = sec("Properties");
      for (const p of bpmnProps) {
        const row = el("div", "lk-prow2");
        const kIn = el("input", "lk-pinput") as HTMLInputElement; kIn.value = p.name; kIn.readOnly = true;
        const vIn = el("input", "lk-pinput") as HTMLInputElement; vIn.value = p.value;
        vIn.oninput = () => {
          const updated = bpmnProps.map(q => q.name === p.name ? { ...q, value: vIn.value } : q);
          save({ bpmnProps: updated });
        };
        row.appendChild(kIn); row.appendChild(vIn); sProps.appendChild(row);
      }
    }
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
  // [Review][Patch P14] Rubberband-select 100+ cells fires one node:selected
  // per cell → without coalescing, refreshContextBar runs N times and each call
  // rebuilds the DOM + scans every selected node's bbox = O(N²) jank. RAF-debounce
  // collapses an event burst into a single render once the call stack drains.
  private refreshContextBar() {
    if (this.contextBarRaf != null) return;
    this.contextBarRaf = requestAnimationFrame(() => {
      this.contextBarRaf = null;
      this.renderContextBarNow();
    });
  }
  private contextBarRaf: number | null = null;
  private renderContextBarNow() {
    const nodes = this.graph.getSelectedCells().filter((c) => c.isNode()) as Node[];
    // Story 6.1 AC5 — multi-select bulk toolbar: align (≥2) + distribute (≥3).
    if (nodes.length >= 2) { this.renderBulkBar(nodes); return; }
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
    const TRASH_ICON = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6m5 4v6m4-6v6"/></svg>`;
    this.contextBar.appendChild(mkBtn(TRASH_ICON, "Xóa", () => { this.graph.removeCells(this.graph.getSelectedCells()); }));
    this.contextBar.appendChild(mkBtn("⋯", "Thêm", (ev) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); this.showContextMenu(r.left, r.bottom + 4); }));

    // BPMN Event — trigger picker + interrupting toggle (Đợt D, 2026-06-01).
    const kindNow = this.nodeKind(node);
    if (kindNow === "bpmn-event-start" || kindNow === "bpmn-event-intermediate" || kindNow === "bpmn-event-end") {
      this.contextBar.appendChild(el("div", "lk-cb-sep"));
      const cur = this.nodeExtra(node).trigger ?? "none";
      this.contextBar.appendChild(mkBtn(
        `<span style="font-size:11px;font-weight:600">${BPMN_TRIGGER_LABEL[cur] ?? "Trigger"}</span><span class="lk-cb-caret">▾</span>`,
        "Trigger sự kiện", (ev) => this.openBpmnTriggerPopup(node, ev.currentTarget as HTMLElement)));
      // Interrupting toggle (only meaningful for start events in event-subprocess or boundary)
      const interr = this.nodeExtra(node).interrupting !== false;
      this.contextBar.appendChild(mkBtn(
        `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="10" r="7" stroke-dasharray="${interr ? "" : "3 2"}"/></svg>`,
        interr ? "Đang: Interrupting (click để Non-Interrupting)" : "Đang: Non-Interrupting (click để Interrupting)",
        () => this.toggleEventInterrupting(node)));
      // Đợt E — Boundary attachment (intermediate events only — start/end can't be boundary)
      if (kindNow === "bpmn-event-intermediate") {
        const isBoundary = !!this.nodeExtra(node).attachedTo;
        this.contextBar.appendChild(mkBtn(
          `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="11" height="8"/><circle cx="15" cy="14" r="3" fill="${isBoundary ? "currentColor" : "none"}"/></svg>`,
          isBoundary ? "Bỏ đính khỏi activity" : "Đính vào activity gần nhất (boundary)",
          () => this.toggleBoundaryAttach(node)));
      }
    }
    // BPMN Task / Sub-process / Transaction / Call activity / Event sub-process — markers (Đợt D).
    if (BPMN_ACTIVITY_KINDS.has(kindNow)) {
      this.contextBar.appendChild(el("div", "lk-cb-sep"));
      this.contextBar.appendChild(mkBtn(
        `<svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor"><rect x="3" y="8" width="3" height="3"/><rect x="8.5" y="8" width="3" height="3"/><rect x="14" y="8" width="3" height="3"/></svg><span class="lk-cb-caret">▾</span>`,
        "Activity markers (loop / MI / ad-hoc / compensation)",
        (ev) => this.openBpmnMarkerPopup(node, ev.currentTarget as HTMLElement)));
    }
    if (this.isSubprocessNode(node)) {
      this.contextBar.appendChild(mkBtn(
        `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="11" height="11"/><path d="M10 3h7v7M17 3l-7 7"/></svg>`,
        "Mở trang riêng", () => this.enterSubprocess(node)));
      const closed = this.nodeKind(node) === "bpmn-task" || node.getData()?.collapsed === true;
      this.contextBar.appendChild(mkBtn(closed
        ? `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="4.5" width="15" height="11"/><path d="M7 10h6M10 7v6"/></svg>`
        : `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="4.5" width="15" height="11"/><path d="M7 10h6"/></svg>`,
        closed ? "Mở rộng tại chỗ (expanded)" : "Thu gọn (collapsed)", () => this.toggleSubprocess(node)));
    }

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

    this.contextBar.style.display = "flex";
    // Mobile (Excalidraw-style): dock the element toolbar in a fixed strip just
    // above the bottom bar — only while a node is selected. Doesn't float over the
    // node, doesn't ride the keyboard.
    if (this.isMobile) { this.dockBarAboveMbar(this.contextBar); return; }
    // Desktop: float above the node.
    const bbox = node.getBBox();
    const s = this.graph.scale().sx; const t = this.graph.translate();
    const left = bbox.x * s + t.tx + (bbox.width * s) / 2;
    const top = bbox.y * s + t.ty;
    const bw = this.contextBar.offsetWidth || 280;
    const bh = this.contextBar.offsetHeight || 40;
    const rw = this.root.clientWidth;
    this.contextBar.style.left = Math.max(8, Math.min(left - bw / 2, rw - bw - 8)) + "px";
    // Sit above the top "+" pad (pad center at top-24, r≈11) so they don't overlap.
    this.contextBar.style.top = Math.max(8, top - 42 - bh) + "px";
  }

  // Story 6.1 — Bulk toolbar rendered when 2+ nodes are selected.
  // Action buttons compute new (x, y) via pure bulkAlign helpers and apply
  // them inside ONE batch so undo/redo treats the operation as a single step.
  private renderBulkBar(nodes: Node[]) {
    this.contextBar.innerHTML = "";
    const mkBtn = (svg: string, title: string, fn: () => void, disabled = false) => {
      const b = el("button", "lk-cb-btn", svg); b.title = title;
      if (disabled) b.setAttribute("disabled", "true");
      else b.onclick = fn;
      return b;
    };
    const apply = (op: (cells: AlignCell[]) => AlignResult, opName: string) => {
      // [Review][Patch P6] Re-fetch the live selection at click time — the
      // closure `nodes` is captured at bar-render time and may include cells
      // that have since been deleted, deselected, or replaced. Stale Cell
      // refs will throw inside getPosition().
      const live = this.graph.getSelectedCells().filter((c) => c.isNode?.()) as Node[];
      if (live.length < 2) return;
      const input: AlignCell[] = live.map((n) => {
        const p = n.getPosition(); const s = n.getSize();
        return { id: n.id, x: p.x, y: p.y, width: s.width, height: s.height };
      });
      const out = op(input);
      this.graph.startBatch(opName);
      try {
        for (const r of out) {
          const cell = this.graph.getCellById(r.id);
          // Pass `__bulk_follow` so node:change:position's bulk-move handler
          // skips this update (otherwise the per-iter delta gets fan-out to
          // peers and the loop fights itself, leaving cells off-position).
          if (cell?.isNode()) cell.setPosition(r.x, r.y, { "__bulk_follow": true } as Record<string, unknown>);
        }
      } finally { this.graph.stopBatch(opName); }
      this.onChange();
    };
    // Icons: simple, monochrome SVG — match existing context-bar style.
    const I = (paths: string) => `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    const ICN_AL = I('<path d="M3 3v14"/><rect x="5" y="5" width="9" height="4"/><rect x="5" y="11" width="13" height="4"/>');
    const ICN_AC = I('<path d="M10 3v14"/><rect x="6" y="5" width="8" height="4"/><rect x="3" y="11" width="14" height="4"/>');
    const ICN_AR = I('<path d="M17 3v14"/><rect x="6" y="5" width="9" height="4"/><rect x="2" y="11" width="13" height="4"/>');
    const ICN_AT = I('<path d="M3 3h14"/><rect x="5" y="5" width="4" height="9"/><rect x="11" y="5" width="4" height="13"/>');
    const ICN_AM = I('<path d="M3 10h14"/><rect x="5" y="6" width="4" height="8"/><rect x="11" y="3" width="4" height="14"/>');
    const ICN_AB = I('<path d="M3 17h14"/><rect x="5" y="6" width="4" height="9"/><rect x="11" y="2" width="4" height="13"/>');
    const ICN_DH = I('<rect x="2" y="6" width="3" height="8"/><rect x="8.5" y="6" width="3" height="8"/><rect x="15" y="6" width="3" height="8"/>');
    const ICN_DV = I('<rect x="6" y="2" width="8" height="3"/><rect x="6" y="8.5" width="8" height="3"/><rect x="6" y="15" width="8" height="3"/>');

    this.contextBar.appendChild(mkBtn(ICN_AL, "Căn trái",            () => apply(alignLeft,     "bulk-align-left")));
    this.contextBar.appendChild(mkBtn(ICN_AC, "Căn giữa (ngang)",    () => apply(alignCenterH,  "bulk-align-center-h")));
    this.contextBar.appendChild(mkBtn(ICN_AR, "Căn phải",            () => apply(alignRight,    "bulk-align-right")));
    this.contextBar.appendChild(el("div", "lk-cb-sep"));
    this.contextBar.appendChild(mkBtn(ICN_AT, "Căn trên",            () => apply(alignTop,      "bulk-align-top")));
    this.contextBar.appendChild(mkBtn(ICN_AM, "Căn giữa (dọc)",      () => apply(alignMiddleV,  "bulk-align-middle-v")));
    this.contextBar.appendChild(mkBtn(ICN_AB, "Căn dưới",            () => apply(alignBottom,   "bulk-align-bottom")));
    this.contextBar.appendChild(el("div", "lk-cb-sep"));
    const can3 = nodes.length >= 3;
    this.contextBar.appendChild(mkBtn(ICN_DH, can3 ? "Phân bố đều theo chiều ngang" : "Phân bố ngang (cần ≥3 element)", () => apply(distributeH, "bulk-distribute-h"), !can3));
    this.contextBar.appendChild(mkBtn(ICN_DV, can3 ? "Phân bố đều theo chiều dọc"   : "Phân bố dọc (cần ≥3 element)",   () => apply(distributeV, "bulk-distribute-v"), !can3));

    this.contextBar.style.display = "flex";
    if (this.isMobile) { this.dockBarAboveMbar(this.contextBar); return; }
    // Float above the bounding box of the whole selection.
    const xs = nodes.map((n) => n.getBBox());
    const minX = Math.min(...xs.map((b) => b.x));
    const minY = Math.min(...xs.map((b) => b.y));
    const maxX = Math.max(...xs.map((b) => b.x + b.width));
    const s = this.graph.scale().sx; const t = this.graph.translate();
    const cx = ((minX + maxX) / 2) * s + t.tx;
    const top = minY * s + t.ty;
    const bw = this.contextBar.offsetWidth || 320;
    const bh = this.contextBar.offsetHeight || 40;
    const rw = this.root.clientWidth;
    this.contextBar.style.left = Math.max(8, Math.min(cx - bw / 2, rw - bw - 8)) + "px";
    this.contextBar.style.top = Math.max(8, top - 12 - bh) + "px";
  }

  /**
   * Mobile: while a label editor is open, hide only the floating "+" quick-connect
   * pads (the toolbars stay visible — user preference). Restore on close.
   */
  private setEditingChrome(editing: boolean): void {
    // Keep both toolbars (bottom bar + element/edge bar) visible while editing — only
    // hide the floating "+" quick-connect pads around the node for tidiness.
    if (editing) { if (this.padLayer) this.padLayer.style.display = "none"; }
    else { this.refreshContextPad(); }
  }

  /** Mobile: pin a toolbar as a centered strip directly above the bottom bar. */
  private dockBarAboveMbar(bar: HTMLElement): void {
    const gap = (this.mbar?.offsetHeight || 54) + 8;   // `|| 54` also guards a 0 before reflow
    bar.style.left = "50%";
    bar.style.transform = "translateX(-50%)";
    bar.style.top = "auto";
    bar.style.bottom = `calc(${gap}px + (3px + env(safe-area-inset-bottom)) / 2)`;   // matches .lk-mbar bottom
  }

  // ── Popups ───────────────────────────────────────────────────────────────
  private openShapePopup(node: Node, anchor: HTMLElement) {
    // Show only shapes from the same diagram family as the selected node
    // (Basic + BPMN/ERD/UML/State/Sequence/Flowchart) — picking a BPMN task
    // from an ERD entity makes no sense and clutters the picker.
    const grid = this.buildShapeGrid(
      (item) => { this.morphShape(node, item.shape); this.hidePopup(); this.refreshContextBar(); },
      this.categoriesFor(node),
    );
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
    // Free-form font size — number input with ± nudge buttons. Bounded
    // [6, 96] to keep the UI sane while still allowing fine-grained control.
    const szRow = el("div", "lk-line-row lk-fs-row");
    const dec = el("div", "lk-line-cell lk-fs-btn", "−");
    const szIn = el("input", "lk-fs-input") as HTMLInputElement;
    szIn.type = "number"; szIn.min = "6"; szIn.max = "96"; szIn.step = "1";
    szIn.value = String(st.fontSize ?? defaultFontSizeFor(node));
    const inc = el("div", "lk-line-cell lk-fs-btn", "+");
    const apply = (v: number) => {
      const clamped = Math.max(6, Math.min(96, Math.round(v) || defaultFontSizeFor(node)));
      szIn.value = String(clamped);
      this.setStyle(node, { fontSize: clamped });
      this.refreshContextBar();
    };
    szIn.oninput = () => { const n = Number(szIn.value); if (Number.isFinite(n) && n >= 6 && n <= 96) apply(n); };
    szIn.onblur = () => apply(Number(szIn.value));
    szIn.onkeydown = (e) => { if (e.key === "Enter") { apply(Number(szIn.value)); e.preventDefault(); } };
    dec.onclick = () => apply((Number(szIn.value) || 13) - 1);
    inc.onclick = () => apply((Number(szIn.value) || 13) + 1);
    szRow.appendChild(dec); szRow.appendChild(szIn); szRow.appendChild(inc);
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
    // Alignment — lucide `align-left/center/right`. Three glyphs with
    // visibly different line widths so the user can tell them apart at a
    // glance (the previous `≡ × 3 + text-align` trick rendered identical
    // icons in a fixed-width cell).
    const alRow = el("div", "lk-line-row");
    const ALIGN_SVG = {
      left: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="3" y1="6"  x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>`,
      center: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="3" y1="6"  x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>`,
      right: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="3" y1="6"  x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>`,
    };
    ([["left", "Trái"], ["center", "Giữa"], ["right", "Phải"]] as Array<["left" | "center" | "right", string]>).forEach(([al, title]) => {
      const b = el("div", "lk-line-cell" + ((st.align ?? "center") === al ? " on" : ""), ALIGN_SVG[al]);
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
    const below = r.bottom - rootRect.top + 6;
    // Anchors near the bottom edge (zoom bar) open upward instead of off-board.
    const h = this.popupLayer.offsetHeight;
    this.popupLayer.style.top = (below + h > rootRect.height ? Math.max(8, r.top - rootRect.top - 6 - h) : below) + "px";
  }

  private hidePopup() {
    if (this.pendingDrop) { this.pendingDrop.remove(); this.pendingDrop = null; } // cancel drag-to-blank
    this.popupLayer.style.display = "none"; this.popupLayer.innerHTML = "";
  }

  // ── Right-click context menu ─────────────────────────────────────────────
  /** Menu for one lane of a pool: split into / merge child lanes, add /
   *  remove a child lane. One undo step each. */
  private showLaneMenu(pool: Node, laneId: string, clientX: number, clientY: number): void {
    const lanes = this.nodeExtra(pool).lanes ?? [];
    const lane = findLaneDeep(lanes, laneId);
    const topLevel = lanes.some((l) => l.id === laneId);
    const apply = (next: typeof lanes) => {
      this.graph.startBatch("lane-edit");
      try {
        pool.setData({ ...pool.getData(), lanes: next }, { deep: false });
        this.rerender(pool);
      } finally { this.graph.stopBatch("lane-edit"); }
      this.onChange();
    };
    const items: Array<[string, () => void]> = [
      lane?.lanes?.length
        ? ["Gộp các lane con", () => apply(mergeChildLanes(lanes, laneId))]
        : ["Chia thành 2 lane con", () => apply(splitLane(lanes, laneId, [this.newLaneId(), this.newLaneId()]))],
      ...(topLevel ? [] : [
        ["Thêm lane con bên dưới", () => apply(addChildLane(lanes, laneId, this.newLaneId()))] as [string, () => void],
        ["Xoá lane con này", () => apply(removeChildLane(lanes, laneId))] as [string, () => void],
      ]),
    ];
    const menu = el("div", "lk-context-menu");
    for (const [label, fn] of items) {
      const item = el("div", "lk-menu-item");
      item.appendChild(el("span", undefined, label));
      item.onclick = () => { fn(); this.hidePopup(); };
      menu.appendChild(item);
    }
    const rootRect = this.root.getBoundingClientRect();
    this.popupLayer.innerHTML = "";
    this.popupLayer.appendChild(menu);
    this.popupLayer.style.display = "block";
    this.popupLayer.style.left = (clientX - rootRect.left) + "px";
    this.popupLayer.style.top = (clientY - rootRect.top) + "px";
  }

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
    add("Lật ngang", "", () => { });
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
  /** A palette item dropped / tapped onto the board, centred on `at`. Every
   *  placement path goes through here so the item's seed (event trigger…) is kept. */
  private addPaletteNode(item: PaletteItem, at: { x: number; y: number }): Node {
    return this.addHtmlNode(item.shape, at.x - item.w / 2, at.y - item.h / 2, item.w, item.h, item.label, undefined, undefined, item.seed as NodeExtra);
  }
  private addHtmlNode(kind: string, x: number, y: number, w: number, h: number, label: string, style?: NodeStyle, id?: string, extra?: NodeExtra, source?: unknown): Node {
    const ex = this.mergeExtra(kind, extra);
    const hasPorts = !NON_CONNECTABLE_PORT_KINDS.has(kind);
    const node = this.graph.addNode({
      id, shape: "html-node", x, y, width: w, height: h,
      ports: hasPorts ? undefined : { items: [] },
      // `__source` carries import provenance (BPMN pool kind, original ids) and
      // MUST survive the load→getModel round-trip — otherwise re-saving the
      // board (e.g. when opened on another device) drops it and the pool/lane
      // identity + export fidelity are lost.
      data: { kind, label, style: style ?? {}, ...ex, ...(source !== undefined ? { __source: source } : {}) },
      attrs: { content: { html: nodeHtml(kind, label, style, ex), class: "hn" } },
    });
    if (this.autoGrowSelector(kind)) {
      this.scheduleMindmapAutoGrow(node);
    }
    // Container/frame shapes (fragments, sub-process, lanes, pool, annotation)
    // sit behind regular nodes so they visually group them.
    if (FRAME_KINDS.has(kind)) node.setZIndex(frameZ(kind));
    // Story 2.2 — ERD per-column ports. Add absolute-positioned col:NAME-left/-right
    // ports on top of the 12 cardinal ports so edges can dock at row Y.
    if (kind === "erd-entity" && ex.cols?.length) {
      const colPorts = buildErdColumnPorts(ex.cols, w);
      if (colPorts.length) {
        // setPorts merges groups + items; existing 12 cardinal ports from
        // makePorts() are preserved (no group-name collision).
        for (const [groupId, groupSpec] of Object.entries(ERD_COL_PORT_GROUPS)) {
          (node as never as { setPortProp: (id: string, path: string, val: unknown) => void });
          // X6 lacks a stable per-group add API; use the Node.addPorts shortcut.
          // Empty groups are ignored, real groups defined via prop "ports/groups".
          node.prop(`ports/groups/${groupId}`, groupSpec);
        }
        node.addPorts(colPorts);
      }
    }
    return node;
  }

  /** Defer autoGrow past X6's mount + fitWhenReady race so DOM is measurable. */
  private scheduleMindmapAutoGrow(node: Node): void {
    setTimeout(() => {
      const sel = this.autoGrowSelector(this.nodeKind(node));
      if (sel) this.autoGrowNodeToContent(node, sel);
    }, 60);
  }
  // Seed default rows for data-driven kinds; keep only defined incoming overrides.
  private seedExtra(kind: string): NodeExtra {
    if (kind === "erd-entity") return { cols: defaultErdCols() };
    if (kind === "uml-class" || kind === "uml-interface") return defaultUml(kind);
    if (kind === "bpmn-pool") return { lanes: [{ id: this.newLaneId(), label: "Lane 1" }] };
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
    if (data?.lanes) out.lanes = data.lanes;
    if (data?.poolHorizontal !== undefined) out.poolHorizontal = data.poolHorizontal;
    if (data?.blackBox !== undefined) out.blackBox = data.blackBox;
    if (out.blackBox) delete out.lanes;
    // BPMN extras (Đợt A)
    if (data?.trigger) out.trigger = data.trigger;
    if (data?.throwing !== undefined) out.throwing = data.throwing;
    if (data?.interrupting !== undefined) out.interrupting = data.interrupting;
    if (data?.attachedTo) out.attachedTo = data.attachedTo;
    if (data?.markers && data.markers.length > 0) out.markers = data.markers;
    if (data?.collapsed !== undefined) out.collapsed = data.collapsed;
    return out;
  }
  private nodeKind(n: Node): string { return (n.getData()?.kind as string) ?? "bs-rect"; }
  private nodeLabel(n: Node): string { return (n.getData()?.label as string) ?? ""; }
  private nodeStyle(n: Node): NodeStyle { return (n.getData()?.style as NodeStyle) ?? {}; }
  private nodeExtra(n: Node): NodeExtra {
    const d = n.getData() ?? {};
    return {
      cols: d.cols, fields: d.fields, methods: d.methods, who: d.who,
      labelOffset: d.labelOffset, lanes: d.lanes,
      trigger: d.trigger, throwing: d.throwing, interrupting: d.interrupting,
      attachedTo: d.attachedTo, markers: d.markers,
      collapsed: d.collapsed,
      poolHorizontal: d.poolHorizontal,
      blackBox: d.blackBox,
    };
  }
  private rerender(n: Node) {
    // Render now (async: false): the HTML is replaced, and event / gateway /
    // data labels lose the side refreshBpmnEventLabels put them on — re-apply
    // it right away instead of leaving the label on the default side.
    n.attr("content/html", nodeHtml(this.nodeKind(n), this.nodeLabel(n), this.nodeStyle(n), this.nodeExtra(n)), { async: false });
    if (hasExternalLabel(this.nodeKind(n))) this.refreshBpmnEventLabels();
    // Mindmap nodes wrap text — re-measure on the next paint so the bbox grows
    // to fit content (otherwise long labels overflow the visible frame).
    const k = this.nodeKind(n);
    if (k === "mm-root" || k === "mm-branch" || k === "mm-leaf") {
      this.scheduleMindmapAutoGrow(n);
    }
    this.upsertHtmlNode(n);   // keep the mobile HTML overlay in sync (no-op on desktop)
  }

  // ── Mobile HTML overlay (real <div> mirror of node content) ──────────────
  private initHtmlOverlay(): void {
    if (!this.isMobile) return;
    this.root.classList.add("lk-mobile");          // CSS hides the buggy foreignObject visuals
    this.htmlLayer = el("div", "lk-html-layer");
    this.graphMount.appendChild(this.htmlLayer);
    const xform = () => this.syncHtmlTransform();
    this.graph.on("scale", xform);
    this.graph.on("translate", xform);
    this.graph.on("resize", xform);
    this.graph.on("node:added", ({ node }) => this.upsertHtmlNode(node));
    this.graph.on("node:removed", ({ node }) => this.removeHtmlNode(node.id));
    this.graph.on("node:change:position", ({ cell }) => this.placeHtmlNode(cell as Node));
    this.graph.on("node:change:size", ({ cell }) => this.placeHtmlNode(cell as Node));
    this.graph.on("node:change:zIndex", ({ cell }) => this.placeHtmlNode(cell as Node));
    this.graph.on("node:change:data", ({ cell }) => this.upsertHtmlNode(cell as Node));
    this.resyncHtmlNodes();
  }
  /** Rebuild the whole overlay from the current node set (after loadModel). */
  private resyncHtmlNodes(): void {
    if (!this.htmlLayer) return;
    const live = new Set<string>();
    for (const n of this.graph.getNodes()) { this.upsertHtmlNode(n); live.add(n.id); }
    for (const id of [...this.htmlNodes.keys()]) if (!live.has(id)) this.removeHtmlNode(id);
    this.syncHtmlTransform();
  }
  private syncHtmlTransform(): void {
    if (!this.htmlLayer) return;
    const t = this.graph.translate(); const s = this.graph.scale().sx || 1;
    this.htmlLayer.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${s})`;
  }
  private upsertHtmlNode(node: Node): void {
    if (!this.htmlLayer) return;
    let div = this.htmlNodes.get(node.id);
    if (!div) {
      div = el("div", "lk-hnode");
      this.htmlLayer.appendChild(div);
      this.htmlNodes.set(node.id, div);
    }
    div.innerHTML = `<div class="hn">${nodeHtml(this.nodeKind(node), this.nodeLabel(node), this.nodeStyle(node), this.nodeExtra(node))}</div>`;
    this.placeHtmlNode(node);
  }
  private placeHtmlNode(node: Node): void {
    const div = this.htmlNodes.get(node.id); if (!div) return;
    const p = node.position(); const sz = node.size();
    div.style.left = p.x + "px"; div.style.top = p.y + "px";
    div.style.width = sz.width + "px"; div.style.height = sz.height + "px";
    div.style.zIndex = String((node.getZIndex?.() as number) ?? 1);
  }
  private removeHtmlNode(id: string): void {
    const div = this.htmlNodes.get(id);
    if (div) { div.remove(); this.htmlNodes.delete(id); }
  }
  private setStyle(n: Node, patch: NodeStyle) { n.setData({ ...n.getData(), style: { ...this.nodeStyle(n), ...patch } }); this.rerender(n); this.onChange(); }

  // Update ERD cols / UML members, then re-render + grow node height to fit.
  private setExtra(n: Node, patch: NodeExtra) {
    // Snapshot OLD cols + edges BEFORE setData — needed to re-route edges to
    // renamed col ports after the rebuild (Story 4.2, Option B).
    const isErd = this.nodeKind(n) === "erd-entity";
    const oldCols: ErdCol[] | null = isErd ? (this.nodeExtra(n).cols ?? []).slice() : null;
    // CRITICAL: X6 setData defaults to deep-merge via ObjectExt.merge — for
    // array fields (cols, fields, methods, lanes...) it MERGES BY INDEX and
    // keeps extra elements from prev. That broke deletes silently: passing
    // [a,b,c] over prev [a,b,c,d] yielded [a,b,c,d]. Force shallow merge
    // (deep:false → Object.assign) so the new array fully replaces the old.
    n.setData({ ...n.getData(), ...patch }, { deep: false });
    this.rerender(n);
    this.autoHeight(n);
    if (isErd) this.refreshErdPorts(n, oldCols);
    this.onChange();
  }

  /** Rebuild col:* ports from current `cols` and re-attach edges that were
   *  connected to the OLD col ports. Re-attach by INDEX — rename works,
   *  insert/delete in the middle reflows correctly; orphaned edges (col
   *  deleted) keep their old endpoint and X6 falls back to nearest anchor. */
  private refreshErdPorts(node: Node, oldCols: ErdCol[] | null) {
    const ex = this.nodeExtra(node);
    const newCols = ex.cols ?? [];
    // Capture edges currently connected to this node's col:* ports.
    type EdgeSnapshot = { edge: Edge; terminal: Edge.TerminalType; oldPortId: string; side: "left" | "right" };
    const snapshots: EdgeSnapshot[] = [];
    for (const edge of this.graph.getEdges()) {
      for (const terminal of ["source", "target"] as Edge.TerminalType[]) {
        const term = (terminal === "source" ? edge.getSource() : edge.getTarget()) as { cell?: string; port?: string };
        if (term?.cell !== node.id) continue;
        const port = term?.port;
        if (!port || !port.startsWith("col:")) continue;
        const m = /^col:(.+)-(left|right)$/.exec(port);
        if (!m) continue;
        snapshots.push({ edge, terminal, oldPortId: port, side: m[2] as "left" | "right" });
      }
    }
    // STEP A — DETACH edges from col ports before rewriting the port list.
    // X6 auto-removes edges whose terminal port disappears during setPropByPath
    // (saw 6→5 edges + corrupted {} src on rename via dev:cdp test). Detaching
    // (cell preserved, port cleared) tells X6 the edge is intentionally
    // node-anchored, so the port rewrite doesn't trigger cleanup.
    for (const s of snapshots) {
      const term = { cell: node.id };  // no port → node-anchored, no auto-cleanup
      if (s.terminal === "source") s.edge.setSource(term);
      else s.edge.setTarget(term);
    }
    // STEP B — Replace ports atomically via ONE setPropByPath. removePort +
    // addPort each trigger their own reactive update — even inside batchUpdate,
    // the port manager runs validation between them and throws "Duplicated
    // port id". Building the complete new list (cardinal + col) and writing
    // once avoids the intermediate invalid state entirely.
    const allCurrent = node.getPorts();
    const nonCol = allCurrent.filter((p) => !(typeof p.id === "string" && p.id.startsWith("col:")));
    const w = node.getSize().width;
    const newColPorts = newCols.length ? buildErdColumnPorts(newCols, w) : [];
    (node as never as { setPropByPath: (path: string, val: unknown, opts?: { rewrite?: boolean }) => void })
      .setPropByPath("ports/items", [...nonCol, ...newColPorts], { rewrite: true });
    // STEP C — Re-attach saved edges. Strategy depends on the change kind:
    //   • RENAME (same length): re-route by index — newCols[oldIdx] is the
    //     renamed col, even if it has a different name now.
    //   • ADD/DELETE (length changed): re-route by NAME match — if oldName
    //     still exists in newCols, reconnect to it; otherwise the col was
    //     deleted/replaced and the edge stays node-anchored (orphan-safe).
    //     Avoids the semantic surprise of an edge silently jumping to the
    //     col that just happened to shift into the deleted col's slot.
    if (!oldCols) return;
    const isPureRename = oldCols.length === newCols.length;
    for (const s of snapshots) {
      const oldName = /^col:(.+)-(left|right)$/.exec(s.oldPortId)?.[1];
      if (!oldName) continue;
      let newName: string | undefined;
      if (isPureRename) {
        const idx = oldCols.findIndex((c) => c.name === oldName);
        if (idx < 0) continue;
        newName = newCols[idx]?.name;
      } else {
        // Length changed — only reconnect if same name still exists.
        newName = newCols.find((c) => c.name === oldName)?.name;
      }
      if (!newName) continue;  // col gone — leave edge node-anchored
      const newPortId = `col:${newName}-${s.side}`;
      if (s.terminal === "source") {
        s.edge.setSource({ cell: node.id, port: newPortId });
      } else {
        s.edge.setTarget({ cell: node.id, port: newPortId });
      }
    }
  }

  private autoHeight(n: Node) {
    const kind = this.nodeKind(n); const ex = this.nodeExtra(n);
    let h = 0;
    // ERD constants MUST stay in sync with erdPorts.ts (HEAD_H=38, ROW_H=27,
    // +12 padding bottom) or col ports compute Y past the node height edge.
    if (kind === "erd-entity") h = 38 + (ex.cols?.length ?? 0) * 27 + 12;
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

  // ── Sub-process expand / collapse (bpmn-js "change type") ──────────────
  /** Expanded ⇄ collapsed sub-process, as bpmn-js's replace menu does it: an
   *  expanded one shows its steps in a frame on the board; a collapsed one is
   *  task-sized with ⊞ and its steps open on their own page (drill-down).
   *  Nothing around it moves. A ⊞ task expands as an empty sub-process; one
   *  collapsed with no steps goes back to that task. */
  private toggleSubprocess(node: Node): void {
    const opening = this.nodeKind(node) === "bpmn-task" || node.getData()?.collapsed === true;
    this.graph.startBatch("subprocess-toggle");
    try {
      if (opening) this.openSubprocess(node); else { this.closeSubprocess(node); this.refreshSubprocessVisibility(); }
    } finally { this.graph.stopBatch("subprocess-toggle"); }
    this.onChange(); this.refreshContextBar(); this.refreshContextPad();
  }
  private openSubprocess(node: Node): void {
    const d = node.getData() ?? {};
    const markers = ((d.markers ?? []) as string[]).filter((m) => m !== "subprocess");
    node.setData(this.nodeKind(node) === "bpmn-task"
      ? { ...d, kind: "bpmn-subprocess", markers: markers.length ? markers : undefined, collapsed: undefined }
      : { ...d, collapsed: undefined }, { deep: false });
    // Notes live at process level (bpmn-js moves them out of the sub-process too).
    for (const c of node.getChildren() ?? []) {
      if (!c.isNode() || this.nodeKind(c) !== "bpmn-annotation") continue;
      node.unembed(c);
      node.getParent()?.embed(c);
      c.setData({ ...c.getData(), parentId: node.getParent()?.id }, { deep: false });
    }
    // Show the steps before moving them: arrows re-route only to visible ends.
    this.refreshSubprocessVisibility();
    const kids = (node.getChildren() ?? []).filter((c): c is Node => c.isNode());
    const lay = openLayout(node.getBBox(), kids.map((k) => ({ ...k.getPosition(), ...k.getSize() })));
    node.setPosition(lay.x, lay.y, { deep: false });
    kids.forEach((k) => k.translate(lay.dx, lay.dy));
    node.resize(lay.width, lay.height);
    node.setZIndex(frameZ(this.nodeKind(node), this.ancestorCount(node)));
    this.rerender(node);
  }
  private closeSubprocess(node: Node): void {
    const d = node.getData() ?? {};
    const empty = !(node.getChildren() ?? []).some((c) => c.isNode());
    const toTask = empty && this.nodeKind(node) === "bpmn-subprocess";
    node.setData(toTask
      ? { ...d, kind: "bpmn-task", markers: [...((d.markers ?? []) as string[]), "subprocess"], collapsed: true }
      : { ...d, collapsed: true }, { deep: false });
    const b = closedLayout(node.getBBox());
    node.setPosition(b.x, b.y, { deep: false });
    node.resize(b.width, b.height);
    if (toTask) node.toFront();
    this.rerender(node);
  }
  private ancestorCount(node: Node): number {
    let d = 0;
    for (let p = node.getParent(); p && d < 32; p = p.getParent()) d++;
    return d;
  }
  /** Steps inside a closed sub-process are hidden, with every arrow touching them. */
  private refreshSubprocessVisibility(): void {
    const root = this.drillRoot;
    // Shown: outside any closed sub-process — or, on a sub-process's own page,
    // inside it and not inside a closed one below it.
    const shown = (n: Node): boolean => {
      for (let p = n.getParent(); p; p = p.getParent()) {
        if (p.id === root) return true;
        if (p.getData()?.collapsed === true) return false;
      }
      return !root;
    };
    for (const n of this.graph.getNodes()) {
      const show = shown(n);
      if (n.isVisible() === show) continue;
      n.setVisible(show);
      if (!show) this.graph.unselect(n);
    }
    for (const e of this.graph.getEdges()) {
      const ends = [e.getSourceCell(), e.getTargetCell()];
      const show = ends.every((c) => !c || c.isVisible());
      if (e.isVisible() === show) continue;
      e.setVisible(show);
      // X6 only toggles CSS: a path laid out while its ends were display:none is stale.
      if (show) (this.graph.findViewByCell(e) as EdgeView | null)?.update();
    }
  }
  /** A sub-process, or a task with the ⊞ marker (an empty one). */
  private isSubprocessNode(node: Node): boolean {
    const k = this.nodeKind(node);
    return SUBPROCESS_KINDS.has(k) || (k === "bpmn-task" && !!(node.getData()?.markers as string[] | undefined)?.includes("subprocess"));
  }
  /** Sub-process whose steps are shown on their own page (null = the whole process). */
  private drillRoot: string | null = null;
  private crumbs: HTMLElement | null = null;
  /** "Mở trang riêng": show only this sub-process's steps, with a breadcrumb
   *  back — the same canvas, every other shape hidden (bpmn-js drill-down). */
  private enterSubprocess(node: Node): void {
    if (this.nodeKind(node) === "bpmn-task") {
      // An empty ⊞ task becomes a closed sub-process so it can hold steps.
      const d = node.getData() ?? {};
      const markers = ((d.markers ?? []) as string[]).filter((m) => m !== "subprocess");
      node.setData({ ...d, kind: "bpmn-subprocess", markers: markers.length ? markers : undefined, collapsed: true }, { deep: false });
      this.rerender(node);
    }
    this.setDrillRoot(node.id);
  }
  /** View of each level above the current page, saved when going deeper. */
  private drillViews: Array<{ id: string | null; scale: number; tx: number; ty: number }> = [];
  private setDrillRoot(id: string | null): void {
    const prev = this.drillRoot ? this.graph.getCellById(this.drillRoot) : null;
    const back = this.drillViews.findIndex((v) => v.id === id);
    const saved = back >= 0 ? this.drillViews[back] : null;
    if (saved) this.drillViews = this.drillViews.slice(0, back);
    else this.drillViews = [...this.drillViews, { id: this.drillRoot, scale: this.graph.scale().sx, ...this.graph.translate() }];
    this.drillRoot = id;
    // Left a closed sub-process with no steps: back to the ⊞ task it came from.
    if (prev?.isNode() && prev.id !== id && prev.getData()?.collapsed === true
      && this.nodeKind(prev) === "bpmn-subprocess" && !(prev.getChildren() ?? []).some((c) => c.isNode())) {
      const d = prev.getData() ?? {};
      prev.setData({ ...d, kind: "bpmn-task", markers: [...((d.markers ?? []) as string[]), "subprocess"] }, { deep: false });
      this.rerender(prev);
    }
    this.graph.cleanSelection();
    this.refreshSubprocessVisibility();
    this.renderCrumbs();
    const shown = this.graph.getNodes().filter((n) => n.isVisible());
    if (saved) { this.graph.zoomTo(saved.scale); this.graph.translate(saved.tx, saved.ty); }
    else if (id && shown.length) this.graph.zoomToRect(this.graph.getCellsBBox(shown)!.inflate(80), { maxScale: 1 });
    else if (id) this.graph.centerCell(this.graph.getCellById(id));
    else if (prev) this.graph.centerCell(prev);
  }
  /** "Process › Sub A › Sub B" over the canvas while inside a sub-process. */
  private renderCrumbs(): void {
    if (!this.drillRoot) { this.crumbs?.remove(); this.crumbs = null; return; }
    if (!this.crumbs) { this.crumbs = el("div", "lk-crumbs"); this.graphMount.appendChild(this.crumbs); }
    this.crumbs.innerHTML = "";
    const path: Node[] = [];
    for (let c: Cell | null = this.graph.getCellById(this.drillRoot); c?.isNode(); c = c.getParent()) {
      if (this.isSubprocessNode(c)) path.unshift(c);
    }
    const seg = (label: string, id: string | null, current: boolean) => {
      const b = el("button", "lk-crumb" + (current ? " is-current" : ""), "");
      b.textContent = label;
      if (!current) b.onclick = () => this.setDrillRoot(id);
      this.crumbs!.appendChild(b);
    };
    seg("Process", null, false);
    path.forEach((n, i) => {
      this.crumbs!.appendChild(el("span", "lk-crumb-sep", "›"));
      seg(this.nodeLabel(n) || "Sub-process", n.id, i === path.length - 1);
    });
  }
  /** A shape dropped inside an open sub-process becomes one of its steps;
   *  dragged out of it, it stops being one. */
  private adoptIntoSubprocess(node: Node): void {
    const kind = this.nodeKind(node);
    // Notes stay at process level, as in bpmn-js.
    if (kind === "bpmn-pool" || kind === "bpmn-lane" || kind === "bpmn-annotation" || !node.isVisible()) return;
    const c = node.getBBox().center;
    const own = new Set([node.id, ...node.getDescendants().map((x) => x.id), node.getData()?.attachedTo]);
    const host = this.graph.getNodes()
      .filter((f) => !own.has(f.id) && SUBPROCESS_KINDS.has(this.nodeKind(f)) && f.getData()?.collapsed !== true
        && f.isVisible() && f.getBBox().containsPoint(c))
      .sort((a, b) => a.getBBox().width * a.getBBox().height - b.getBBox().width * b.getBBox().height)[0];
    // On a sub-process's own page every shape belongs to it.
    const drill = this.drillRoot && !own.has(this.drillRoot) ? this.graph.getCellById(this.drillRoot) as Node : undefined;
    const target = host ?? drill;
    const cur = node.getParent();
    const curIsSub = !!cur?.isNode() && SUBPROCESS_KINDS.has(this.nodeKind(cur as Node));
    if (target ? cur === target : !curIsSub) return;
    if (cur) cur.unembed(node);
    if (target) target.embed(node);
    node.setData({ ...node.getData(), parentId: target?.id }, { deep: false });
    if (FRAME_KINDS.has(kind)) node.setZIndex(frameZ(kind, this.ancestorCount(node)));
  }

  // ── BPMN Đợt D — Trigger / Marker / Interrupting pickers ────────────────
  /** Open the trigger picker for an event node (popup grid of 12 OMG triggers). */
  private openBpmnTriggerPopup(node: Node, anchor: HTMLElement): void {
    const list = el("div", "lk-line-list");
    const ex = this.nodeExtra(node);
    const cur = ex.trigger ?? "none";
    for (const t of triggerChoices(this.nodeKind(node), ex)) {
      const row = el("button", "lk-line-row" + (t === cur ? " on" : ""), `<span>${BPMN_TRIGGER_LABEL[t] ?? t}</span>`);
      row.onclick = () => {
        const data = node.getData() ?? {};
        const nextTrigger = t === "none" ? undefined : t;
        node.setData({ ...data, trigger: nextTrigger });
        this.rerender(node);
        this.onChange();
        this.hidePopup();
        this.refreshContextBar();
      };
      list.appendChild(row);
    }
    this.showPopup(list, anchor);
  }
  /** Toggle Interrupting ↔ Non-Interrupting on event nodes (boundary / event-subprocess start). */
  private toggleEventInterrupting(node: Node): void {
    const data = node.getData() ?? {};
    const cur = data.interrupting !== false;
    node.setData({ ...data, interrupting: !cur ? undefined : false });
    this.rerender(node);
    this.onChange();
    this.refreshContextBar();
  }
  /** Đợt E — Toggle boundary attachment. Picks the nearest BPMN activity bbox
   *  (Manhattan distance from event center to nearest bbox edge ≤ 60px) and
   *  sets extra.attachedTo. Snaps the event onto the activity's right edge by
   *  default so it visually overlaps per OMG. */
  private toggleBoundaryAttach(node: Node): void {
    const data = node.getData() ?? {};
    if (data.attachedTo) {
      // Detach (deep: false — a deep merge would keep the old attachedTo)
      node.setData({ ...data, attachedTo: undefined }, { deep: false });
      this.rerender(node);
      this.onChange();
      this.refreshContextBar();
      return;
    }
    // Find nearest activity
    const p = node.getPosition(); const s = node.getSize();
    const cx = p.x + s.width / 2; const cy = p.y + s.height / 2;
    let bestId: string | null = null; let bestDist = Infinity;
    let bestParent: { x: number; y: number; w: number; h: number } | null = null;
    for (const cand of this.graph.getNodes()) {
      if (cand.id === node.id) continue;
      if (!BPMN_ACTIVITY_KINDS.has(this.nodeKind(cand))) continue;
      const cp = cand.getPosition(); const cs = cand.getSize();
      // Manhattan distance from event center to bbox (0 if inside)
      const dx = Math.max(cp.x - cx, 0, cx - (cp.x + cs.width));
      const dy = Math.max(cp.y - cy, 0, cy - (cp.y + cs.height));
      const d = dx + dy;
      if (d < bestDist) { bestDist = d; bestId = cand.id; bestParent = { x: cp.x, y: cp.y, w: cs.width, h: cs.height }; }
    }
    if (!bestId || !bestParent || bestDist > 80) {
      // Too far / no candidate — user feedback via title only (no toast infra here)
      return;
    }
    // Snap the event onto the nearest edge of the parent (centre on the border per OMG)
    const snap = snapToHostBorder(this.boxOf(node), { x: bestParent.x, y: bestParent.y, width: bestParent.w, height: bestParent.h });
    node.setPosition(snap.x, snap.y);
    node.setData({ ...data, attachedTo: bestId });
    this.raiseBoundaryEvents();
    this.rerender(node);
    this.refreshBpmnEventLabels();
    this.onChange();
    this.refreshContextBar();
  }
  /** Open the activity-marker picker (multi-select: loop / MI-par / MI-seq / ad-hoc / compensation). */
  private openBpmnMarkerPopup(node: Node, anchor: HTMLElement): void {
    const list = el("div", "lk-line-list");
    const cur = new Set(this.nodeExtra(node).markers ?? []);
    for (const mk of BPMN_MARKERS) {
      const on = cur.has(mk);
      const row = el("button", "lk-line-row" + (on ? " on" : ""), `<span>${on ? "☑" : "☐"} ${BPMN_MARKER_LABEL[mk]}</span>`);
      row.onclick = () => {
        const data = node.getData() ?? {};
        const next = new Set<string>(data.markers ?? []);
        if (on) next.delete(mk); else next.add(mk);
        // MI-par and MI-seq are mutually exclusive (BPMN spec: one loopCharacteristics per activity)
        if (mk === "mi-par" && !on) next.delete("mi-seq");
        if (mk === "mi-seq" && !on) next.delete("mi-par");
        if ((mk === "mi-par" || mk === "mi-seq") && !on) next.delete("loop");
        if (mk === "loop" && !on) { next.delete("mi-par"); next.delete("mi-seq"); }
        const arr = Array.from(next);
        node.setData({ ...data, markers: arr.length ? arr : undefined });
        this.rerender(node);
        this.onChange();
        this.openBpmnMarkerPopup(node, anchor); // re-render popup with the new state
      };
      list.appendChild(row);
    }
    this.showPopup(list, anchor);
  }

  // ── BPMN Pool lane operations ───────────────────────────────────────────
  private newLaneId(): string { return "l" + Math.random().toString(36).slice(2, 8); }

  /**
   * Rename duplicate lane ids across pools (heal-on-load). Pool defaults used
   * to hardcode "l1" so files with multiple pools collide. We keep the FIRST
   * pool's lane id and rename collisions in later pools with `newLaneId()`.
   * Also update child nodes whose `laneId` references the renamed lane within
   * the same pool — best-effort by spatial containment (pool bbox).
   */
  private dedupeLaneIdsAcrossPools(model: CanvasModel): CanvasModel {
    const seen = new Set<string>();
    let changed = false;
    const newNodes = model.nodes.map((n) => {
      if (n.shape !== "bpmn-pool") return n;
      const lanes = (n.attrs?.lanes as Array<{ id: string; label?: string }> | undefined) ?? [];
      if (!lanes.length) return n;
      const remap: Record<string, string> = {};
      const newLanes = lanes.map((ln) => {
        if (!seen.has(ln.id)) {
          seen.add(ln.id);
          return ln;
        }
        const fresh = this.newLaneId();
        remap[ln.id] = fresh;
        seen.add(fresh);
        changed = true;
        return { ...ln, id: fresh };
      });
      if (!Object.keys(remap).length) return n;
      // Heuristic: remap any child node whose laneId points to a renamed lane
      // AND sits inside this pool's bbox. Children outside this pool keep
      // their (still-valid) laneId — they belong to a different pool.
      const poolBox = { x: n.x, y: n.y, w: n.width, h: n.height };
      for (const child of model.nodes) {
        const childLane = child.laneId;
        if (!childLane || !remap[childLane]) continue;
        const cx = child.x + child.width / 2;
        const cy = child.y + child.height / 2;
        if (cx >= poolBox.x && cx <= poolBox.x + poolBox.w && cy >= poolBox.y && cy <= poolBox.y + poolBox.h) {
          (child as { laneId?: string }).laneId = remap[childLane];
        }
      }
      return { ...n, attrs: { ...(n.attrs ?? {}), lanes: newLanes } };
    });
    if (!changed) return model;
    console.info("[omniboard] dedupeLaneIdsAcrossPools: renamed duplicate lane ids on load");
    return { ...model, nodes: newNodes };
  }

  private addLaneToPool(node: Node, where: "above" | "below"): void {
    const ex = this.nodeExtra(node);
    const s = node.getSize();
    const NEW_LANE_H = 70;
    const prev = ex.lanes ?? [{ id: "l1", label: "Lane 1" }];
    // A vertical pool adds a column (width), a horizontal one a row (height).
    const horizontal = ex.poolHorizontal !== false;
    const stack = asStackLanes(prev, horizontal);
    // Lanes with their own size keep it: the pool grows by exactly the new lane.
    const sized = stack.some((ln) => ln.height)
      ? fromStackLanes(prev, laneHeights(stack, horizontal ? s.height : s.width).map((h) => ({ id: "", height: Math.round(h) })), horizontal)
      : null;
    const lanes = [...(sized ?? prev)];
    const next = { id: this.newLaneId(), label: `Lane ${lanes.length + 1}`, ...(sized ? { [horizontal ? "height" : "width"]: NEW_LANE_H } : {}) };
    if (where === "above") lanes.unshift(next); else lanes.push(next);
    node.setData({ ...node.getData(), lanes }, { deep: false });
    if (horizontal) node.resize(s.width, s.height + NEW_LANE_H); // grow to fit new lane
    else node.resize(s.width + NEW_LANE_H, s.height);
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
    /** Pass empty strings through to onCommit too (so the caller can clear the field). Default false. */
    allowEmpty?: boolean;
    /** Edit in place inside this element (bpmn-js): same font, centred, transparent, its text hidden meanwhile. */
    inBox?: HTMLElement;
    onCommit: (next: string) => void;
  }): void {
    this.commitLabel(); // close any previous editor
    if (this.isMobile) this.setEditingChrome(true);   // hide the "+" pads (toolbars stay)
    const ta = el("textarea", "lk-label-input" + (opts.vertical ? " is-vertical" : "")) as HTMLTextAreaElement;
    ta.value = opts.value;
    ta.style.left = opts.left + "px";
    ta.style.top = opts.top + "px";
    ta.style.width = opts.width + "px";
    ta.style.height = opts.height + "px";
    ta.rows = 1;
    const box = opts.inBox;
    if (box) {
      const cs = getComputedStyle(box); const k = this.graph.scale().sx;
      ta.classList.add("is-inbox");
      ta.style.fontSize = parseFloat(cs.fontSize) * k + "px";
      ta.style.fontWeight = cs.fontWeight;
      ta.style.lineHeight = cs.lineHeight;
      ta.style.paddingLeft = ta.style.paddingRight = parseFloat(cs.paddingLeft) * k + "px";
      box.classList.add("is-label-editing");
    }
    const autoGrow = () => {
      if (box) {
        // keep the text vertically centred like the static label
        ta.style.paddingTop = ta.style.paddingBottom = "0"; ta.style.height = "auto";
        const content = ta.scrollHeight; const h = Math.max(opts.height, content);
        ta.style.paddingTop = ta.style.paddingBottom = (h - content) / 2 + "px"; ta.style.height = h + "px";
      } else if (opts.vertical) {
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
        if (v || opts.allowEmpty) opts.onCommit(v);
      }
      this.graph.off("scale", abort); this.graph.off("translate", abort);
      ta.remove(); this.labelInput = null;
      box?.classList.remove("is-label-editing");
      if (this.isMobile) this.setEditingChrome(false);   // restore the "+" pads
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
    const lanes = ex.lanes ?? [];
    const current = findLaneDeep(lanes, laneId);
    if (!current) return;
    const relabel = (list: typeof lanes, v: string): typeof lanes => list.map((l) => (l.id === laneId
      ? { ...l, label: v }
      : l.lanes ? { ...l, lanes: relabel(l.lanes, v) } : l));
    const r = anchor.getBoundingClientRect(); const rr = this.root.getBoundingClientRect();
    this.inlineEdit({
      left: r.left - rr.left, top: r.top - rr.top, width: r.width, height: r.height,
      value: current.label, vertical: ex.poolHorizontal !== false,
      onCommit: (v) => {
        node.setData({ ...node.getData(), lanes: relabel(lanes, v) }, { deep: false });
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
    if (this.editExternalLabel(node)) return;
    const bbox = node.getBBox(); const s = this.graph.scale().sx; const t = this.graph.translate();
    const kind = this.nodeKind(node);
    const isMindmap = kind === "mm-root" || kind === "mm-branch" || kind === "mm-leaf";
    const view = this.graph.findViewByCell(node) as unknown as { container?: HTMLElement } | null;
    const task = view?.container?.querySelector(".bp-task") as HTMLElement | null;
    this.inlineEdit({
      inBox: task ?? undefined,
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
    this.autoGrowNodeToContent(node, ".mm");
  }

  /**
   * Grow a content-driven HTML node (mindmap / uml / erd) so its box fits the
   * rendered inner element — content was being clipped when the initial height
   * (from a parser estimate) was too small. Only grows, never shrinks.
   */
  private autoGrowNodeToContent(node: Node, selector: string): void {
    const view = this.graph.findViewByCell(node) as unknown as { container?: HTMLElement } | null;
    const inner = view?.container?.querySelector?.(selector) as HTMLElement | null;
    if (!inner) return;
    const desired = inner.scrollHeight;
    const cur = node.getSize().height;
    if (desired > cur + 1) node.resize(node.getSize().width, desired);
  }

  /** Selector of the measurable inner element for content-driven kinds. */
  private autoGrowSelector(kind: string): string | null {
    if (kind === "mm-root" || kind === "mm-branch" || kind === "mm-leaf") return ".mm";
    if (kind === "uml-class" || kind === "uml-interface") return ".uml";
    if (kind === "erd-entity") return ".erd-table";
    return null;
  }
  private commitLabel() { if (this.labelInput) this.labelInput.blur(); }

  // Inline-edit an edge's label (double-click the arrow). Multi-line via Shift+Enter
  // (Enter commits, Escape cancels). Empty commit clears the label. Long lines wrap
  // automatically at the EDGE_LABEL_TEXT.textWrap.width in the rendered SVG.
  private editEdgeLabel(edge: Edge) {
    const bbox = edge.getBBox();
    const s = this.graph.scale().sx, t = this.graph.translate();
    const cx = (bbox.x + bbox.width / 2) * s + t.tx;
    const cy = (bbox.y + bbox.height / 2) * s + t.ty;
    const cur = (edge.getLabels()?.[0] as { attrs?: { label?: { text?: string } } } | undefined)?.attrs?.label?.text;
    const W = 220;
    this.inlineEdit({
      left: cx - W / 2, top: cy - 18, width: W, height: 32,
      value: cur ? String(cur) : "",
      multiLine: true,
      allowEmpty: true,   // empty string clears the label (matches old <input> behaviour)
      onCommit: (v) => {
        edge.setLabels(v ? [{ attrs: { body: EDGE_LABEL_BODY, label: { ...EDGE_LABEL_TEXT, text: v } } }] : []);
        if (v) this.applyEdgeTextAngle(edge); // keep 90° rotation if set
        this.onChange();
      },
    });
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
  // Apply the selected line shape (orthogonal/elbow/straight/curved) to normal
  // edges. Sequence and mindmap edges keep their special routing.
  // A line jump (arc/gap) overrides the connector with X6's native jumpover.
  private applyEdgeShape(edge: Edge) {
    const sid = edge.getSourceCellId() ?? undefined;
    if (this.isSeqLifeline(sid) || this.isMindmapNode(sid)) return;
    const st = this.edgeStyle(edge);
    const shape = EDGE_SHAPES[st.shape ?? "orthogonal"] ?? EDGE_SHAPES.orthogonal;
    edge.setRouter(shape.router as never);
    const jump = EDGE_JUMPS[st.jump ?? "none"];
    if (jump && jump !== "none") {
      edge.setConnector({ name: "jumpover", args: { type: jump, size: 6 } } as never);
    } else {
      edge.setConnector(shape.connector as never);
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

  /** Debounced showEdgeBar — coalesces the continuous change:vertices /
   *  change:source / change:target events of a drag into ONE rebuild after the
   *  drag settles. Rebuilding the bar (innerHTML + ~10 SVG buttons +
   *  getBoundingClientRect reflow) on every event froze segment AND endpoint
   *  drags. */
  private scheduleEdgeBar(edge: Edge) {
    if (!this.graph.getSelectedCells().some((c) => c.id === edge.id)) return;
    if (this.edgeBarDebounce != null) window.clearTimeout(this.edgeBarDebounce);
    this.edgeBarDebounce = window.setTimeout(() => {
      this.edgeBarDebounce = null;
      if (this.graph.getSelectedCells().some((c) => c.id === edge.id)) this.showEdgeBar(edge);
    }, 110);
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
    // 4.5) BPMN flow type ▾ (Đợt C — Sequence/Default/Message/Conditional/Association)
    const ft = st.flowType ?? "sequence";
    bar.appendChild(mkBtn(
      `<span style="font-size:11px;font-weight:600">${FLOW_TYPE_LABEL[ft] ?? "Sequence"}</span>` + caret,
      "Loại flow (BPMN)", (ev) => this.openEdgeFlowTypePopup(edge, ev.currentTarget as HTMLElement)));
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
    const TRASH_ICON = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6m5 4v6m4-6v6"/></svg>`;
    bar.appendChild(mkBtn(TRASH_ICON, "Xóa", () => { this.graph.removeCells([edge]); this.hideEdgeBar(); }));

    bar.style.display = "flex";
    // Mobile: dock above the bottom bar (same as the node context bar).
    if (this.isMobile) { this.dockBarAboveMbar(bar); return; }
    // Position OUTSIDE the edge bbox (above the top, or below the bottom) so the
    // bar never overlays the line itself. Read the rendered SVG path's screen
    // rect — edge.getBBox() includes the highlight halo and over-estimates.
    const s = this.graph.scale().sx; const t = this.graph.translate();
    const view = this.graph.findViewByCell(edge) as { container?: SVGElement } | null;
    const pathEl = view?.container?.querySelector?.("path.x6-edge-selection, path[joint-selector='line'], path") as SVGGraphicsElement | null;
    const rootRect = this.root.getBoundingClientRect();
    let cx: number, yTop: number, yBot: number;
    if (pathEl?.getBoundingClientRect) {
      const r = pathEl.getBoundingClientRect();
      cx = r.left - rootRect.left + r.width / 2;
      yTop = r.top - rootRect.top;
      yBot = r.bottom - rootRect.top;
    } else {
      const bbox = edge.getBBox();
      cx = (bbox.x + bbox.width / 2) * s + t.tx;
      yTop = bbox.y * s + t.ty;
      yBot = (bbox.y + bbox.height) * s + t.ty;
    }
    const bw = bar.offsetWidth || 360;
    const bh = bar.offsetHeight || 46;
    const rw = this.root.clientWidth; const rh = this.root.clientHeight;
    const gap = 18;
    let top = yTop - bh - gap;                     // prefer above the bbox
    if (top < 8) top = yBot + gap;                 // not enough room above → below the bbox
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
  /** End `edge`'s `end` (target by default) on the pool under `pt`, straight
   *  above / below the other end, as a message flow (the only flow BPMN
   *  allows to a participant). The topLeft anchor keeps its offset when the
   *  pool moves. */
  private endOnPool(edge: Edge, other: Node, pt: { x: number; y: number }, end: "source" | "target" = "target"): boolean {
    const otherPt = this.dockPoint(edge, end === "target" ? "source" : "target") ?? other.getBBox().center;
    const hit = this.poolAt(pt, otherPt, other.id);
    if (!hit) return false;
    const terminal = { cell: hit.pool.id, anchor: { name: "topLeft", args: hit.anchor }, connectionPoint: { name: "anchor" } };
    if (end === "target") edge.setTarget(terminal as never); else edge.setSource(terminal as never);
    edge.setVertices([]);
    this.applyFlowType(edge, "message");
    this.onChange();
    return true;
  }

  /** Where `end` of the arrow is drawn. (Edge.getSourcePoint() of a cell end
   *  is the cell's centre, not the port / anchor the arrow leaves from.) */
  private dockPoint(edge: Edge, end: "source" | "target"): { x: number; y: number } | null {
    const view = this.graph.findViewByCell(edge) as EdgeView | null;
    const p = end === "source" ? view?.sourcePoint : view?.targetPoint;
    return p ? { x: p.x, y: p.y } : null;
  }

  /** bpmn-js keeps a message flow to a pool vertical: when the arrow's other end
   *  moves to another port, slide the pool end along its border to stay above / below it. */
  private realignPoolEnd(edge: Edge, poolEnd: "source" | "target"): void {
    const term = (poolEnd === "source" ? edge.getSource() : edge.getTarget()) as { cell?: string; anchor?: { name?: string; args?: { dx: number; dy: number } } };
    const pool = term.cell ? this.graph.getCellById(term.cell) : null;
    if (!pool?.isNode() || this.nodeKind(pool as Node) !== "bpmn-pool" || term.anchor?.name !== "topLeft" || !term.anchor.args) return;
    const view = this.graph.findViewByCell(edge) as EdgeView | null;
    view?.confirmUpdate(view.getFlag(["source", "target", "update"]), {});   // X6 renders async: dock the moved end now
    const other = this.dockPoint(edge, poolEnd === "source" ? "target" : "source");
    if (!other) return;
    const b = (pool as Node).getBBox();
    const dx = Math.min(Math.max(other.x - b.x, 0), b.width);
    if (Math.abs(dx - term.anchor.args.dx) < 0.5) return;
    const next = { ...term, anchor: { ...term.anchor, args: { ...term.anchor.args, dx } } };
    if (poolEnd === "source") edge.setSource(next as never); else edge.setTarget(next as never);
  }

  /** The (smallest) pool that takes an arrow end dropped at `pt`. */
  private poolAt(pt: { x: number; y: number }, otherPt: { x: number; y: number }, excludeId?: string): { pool: Node; anchor: { dx: number; dy: number } } | null {
    let hit: { pool: Node; anchor: { dx: number; dy: number }; area: number } | null = null;
    for (const n of this.graph.getNodes()) {
      if (n.id === excludeId || this.nodeKind(n) !== "bpmn-pool") continue;
      const b = n.getBBox();
      const anchor = poolDropAnchor({ x: b.x, y: b.y, width: b.width, height: b.height, blackBox: !!this.nodeExtra(n).blackBox }, pt, otherPt);
      if (anchor && (!hit || b.width * b.height < hit.area)) hit = { pool: n, anchor, area: b.width * b.height };
    }
    return hit;
  }

  /**
   * The source end of an existing arrow was dropped where X6 found no port
   * (it leaves a bare point). On a pool → message flow from the pool's
   * border; on a node → its nearest port; elsewhere → back where it was.
   */
  private settleDroppedSource(edge: Edge, before: unknown): void {
    const tgtId = edge.getTargetCellId();
    const tgt = tgtId ? this.graph.getCellById(tgtId) : null;
    const pt = edge.getSourcePoint();
    if (!tgt || !tgt.isNode() || !pt) return;
    if (this.endOnPool(edge, tgt as Node, pt, "source")) return;
    const best = pickDropTarget(
      this.graph.getNodes()
        .filter((n) => n.id !== tgt.id && !this.isPortDisabledNode(n.id))
        .map((n) => ({ n, bbox: n.getBBox() })),
      pt,
    )?.n;
    if (best) edge.setSource(portEndpoint(best.id, nearestFixedPort(best, pt)) as never);
    else if (before) edge.setSource(before as never);
    this.onChange();
  }

  /** Set an edge's BPMN flow type: visual preset + semantic kind / attrs. */
  private applyFlowType(edge: Edge, key: "sequence" | "default" | "message" | "conditional" | "association"): void {
    this.setEdgeStyle(edge, { flowType: key, ...FLOW_TYPE_PRESETS[key] });
    // Phase A — keep semantic bpmnKind + bpmnAttrs in sync so export emits
    // the right BPMN element (SequenceFlow vs MessageFlow vs Association)
    // and the right marker (default / conditional placeholder).
    const data = (edge.getData() as { bpmnKind?: string; bpmnAttrs?: Record<string, unknown> } | undefined) ?? {};
    const nextAttrs = { ...(data.bpmnAttrs ?? {}) };
    delete nextAttrs.isDefault;
    // Preserve user-typed condition body across visual switches; clear only
    // when the new visual implies "not a sequence flow".
    if (key === "message" || key === "association") delete nextAttrs.condition;
    if (key === "default") nextAttrs.isDefault = true;
    const nextKind = key === "message" ? "message" : key === "association" ? "association" : undefined;
    edge.setData({ ...data, bpmnKind: nextKind, bpmnAttrs: Object.keys(nextAttrs).length ? nextAttrs : undefined });
  }
  /** BPMN flow-type popup — applies a preset (Sequence/Default/Message/Conditional/Association). Đợt C. */
  private openEdgeFlowTypePopup(edge: Edge, anchor: HTMLElement) {
    const list = el("div", "lk-line-list");
    const cur = this.edgeStyle(edge).flowType ?? "sequence";
    for (const key of ["sequence", "default", "message", "conditional", "association"] as const) {
      const row = el("button", "lk-line-row" + (key === cur ? " on" : ""), `<span>${FLOW_TYPE_LABEL[key]}</span>`);
      row.onclick = () => {
        this.applyFlowType(edge, key);
        this.hidePopup();
        this.showEdgeBar(edge);
      };
      list.appendChild(row);
    }
    this.showPopup(list, anchor);
  }
  // Line popup: shape + dash + weight + jumps.
  private openEdgeLinePopup(edge: Edge, anchor: HTMLElement) {
    const st = this.edgeStyle(edge);
    const wrap = el("div", "lk-line-popup");
    const shapeRow = el("div", "lk-line-row");
    const shapeOptions: Array<[string, string, string]> = [
      ["orthogonal", "Vuông bo", `<path d="M2 12 H8 V2 H16" fill="none" stroke="currentColor" stroke-width="1.8"/>`],
      ["elbow", "Gấp khúc", `<path d="M2 12 H9 V2 H16" fill="none" stroke="currentColor" stroke-width="1.8"/>`],
      ["straight", "Thẳng", `<line x1="2" y1="12" x2="16" y2="2" stroke="currentColor" stroke-width="1.8"/>`],
      ["curved", "Cong", `<path d="M2 12 C6 2 12 2 16 12" fill="none" stroke="currentColor" stroke-width="1.8"/>`],
    ];
    for (const [key, title, path] of shapeOptions) {
      const active = (st.shape ?? "orthogonal") === key;
      const b = el("div", "lk-line-cell" + (active ? " on" : ""),
        `<svg viewBox="0 0 18 14" width="22" height="16">${path}</svg>`);
      b.title = title;
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

  // Edges with an orthogonal router emit polyline routePoints we can materialize
  // as vertices so the X6 `segments` tool renders one handle per visible segment.
  // Non-orthogonal special routers don't produce meaningful bends here.
  private isOrthogonalEdge(edge: Edge): boolean {
    const r = edge.getRouter() as any;
    const name = typeof r === "string" ? r : r?.name;
    return name === "orth" || name === "avoid" || name === "manhattan" || name === "metro" || name === "er";
  }

  private materializeEditableBends(edge: Edge): Array<{ x: number; y: number }> {
    const view = this.graph.findViewByCell(edge) as any;
    const route = view?.routePoints;
    if (Array.isArray(route) && route.length > 2) {
      return route.slice(1, -1).map((p: any) => ({ x: p.x, y: p.y }));
    }

    const source = edge.getSourcePoint();
    const target = edge.getTargetPoint();
    if (!source || !target) return [];
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return [];

    if (Math.abs(dx) >= Math.abs(dy)) {
      const midX = source.x + dx / 2;
      return [{ x: midX, y: source.y }, { x: midX, y: target.y }];
    }
    const midY = source.y + dy / 2;
    return [{ x: source.x, y: midY }, { x: target.x, y: midY }];
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

  private boxOf(n: Node): Box { return { ...n.getPosition(), ...n.getSize() }; }

  /** Re-seat every boundary event of `host` after it went from `before` to
   *  its current box. Placement is absolute (same edge, same fraction along
   *  it), so applying it twice is harmless. Events the X6 Selection is
   *  already translating together with the host are left to it. */
  private followBoundaryEvents(host: Node, before: Box, options?: Record<string, unknown>): void {
    const groupMove = !!(options?.["ui"] || options?.["selection"]);
    for (const child of this.graph.getNodes()) {
      if (child.id === host.id || child.getData()?.attachedTo !== host.id) continue;
      if (groupMove && this.graph.isSelected(child)) continue;
      const p = followHost(this.boxOf(child), before, this.boxOf(host));
      child.setPosition(p.x, p.y, { "__boundary_follow": true } as Record<string, unknown>);
    }
  }

  /** While the user drags a boundary event, keep it on its host's border —
   *  also after Snapline nudges it (`snapped`). Moves the X6 Selection makes
   *  alongside the host (`selection`) are left alone. */
  private snapBoundaryEvent(node: Node, options?: Record<string, unknown>): void {
    if (options?.["selection"]) return;
    const direct = options?.["ui"] && options?.["translateBy"] === node.id;
    if (!direct && !options?.["snapped"]) return;
    const hostId = node.getData()?.attachedTo as string | undefined;
    const host = hostId ? this.graph.getCellById(hostId) : null;
    if (!host || !host.isNode()) return;
    // Pulled further than ATTACH_DISTANCE: let it go (it detaches on drop).
    if (distanceToBorder(this.boxOf(node), this.boxOf(host)) > ATTACH_DISTANCE) return;
    const p = snapToHostBorder(this.boxOf(node), this.boxOf(host));
    const cur = node.getPosition();
    if (p.x !== cur.x || p.y !== cur.y) node.setPosition(p.x, p.y, { "__boundary_follow": true } as Record<string, unknown>);
  }

  /** A boundary event was dropped: onto (near) an activity's border → attach
   *  to that activity, like bpmn-js; clear of every activity → detach.
   *  Free events are never auto-attached (use the attach toggle). */
  private settleBoundaryEvent(node: Node): void {
    const cur = node.getData()?.attachedTo as string | undefined;
    if (!cur) return;
    const hosts = this.graph.getNodes()
      .filter((n) => n.id !== node.id && BPMN_ACTIVITY_KINDS.has(this.nodeKind(n)))
      .map((n) => ({ id: n.id, box: this.boxOf(n) }));
    const next = pickHost(this.boxOf(node), hosts);
    // deep: false — a deep merge keeps the old attachedTo when the new one is undefined
    if (next !== cur) node.setData({ ...node.getData(), attachedTo: next ?? undefined }, { deep: false });
    const host = next ? this.graph.getCellById(next) : null;
    if (host && host.isNode()) {
      const p = snapToHostBorder(this.boxOf(node), this.boxOf(host));
      node.setPosition(p.x, p.y, { "__boundary_follow": true } as Record<string, unknown>);
      this.raiseBoundaryEvents();
    }
    if (next !== cur) { this.rerender(node); this.refreshContextBar(); this.onChange(); }
    this.refreshBpmnEventLabels();
  }

  /** Boundary events must paint above their host, or the host hides them. */
  private raiseBoundaryEvents(): void {
    for (const ev of this.graph.getNodes()) {
      const hostId = ev.getData()?.attachedTo as string | undefined;
      const host = hostId ? this.graph.getCellById(hostId) : null;
      if (!host || !host.isNode()) continue;
      const hz = host.getZIndex() ?? 0;
      if ((ev.getZIndex() ?? 0) <= hz) ev.setZIndex(hz + 1);
    }
  }

  /**
   * Auto-flip BPMN event labels to the opposite side of any connected edge
   * (mimics bpmn.io). If an edge enters/exits below the node centre, label moves
   * up; if above, label stays at the default bottom.
   */
  private refreshBpmnEventLabels(): void {
    for (const n of this.graph.getNodes()) {
      const k = this.nodeKind(n);
      const isEvent = BPMN_EVENT_KINDS.has(k);
      const isGw = k.startsWith("bpmn-gateway");
      const isData = k.startsWith("bpmn-data-");
      if (!isEvent && !isGw && !isData) continue;
      const hostId = isEvent ? n.getData()?.attachedTo as string | undefined : undefined;
      const host = hostId ? this.graph.getCellById(hostId) : null;
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
      // Boundary event → label outside its host; else flip up only when
      // bottom is busy and top is free.
      const side = eventLabelSide({
        boundary: host && host.isNode() ? hostSide(this.boxOf(n), this.boxOf(host as Node)) : undefined,
        edgeBelow: bottom, edgeAbove: top,
      });
      const view = this.graph.findViewByCell(n) as { container?: Element } | null;
      const el = view?.container?.querySelector?.(isGw ? ".bp-gw" : isData ? ".bp-dataobj, .bp-datastore" : ".bp-event") as HTMLElement | null;
      if (el) {
        el.classList.toggle("label-top", side === "top");
        el.classList.toggle("label-left", side === "left");
        el.classList.toggle("label-right", side === "right");
      }
    }
  }

  private isMindmapNode(cellId: string | undefined): boolean {
    if (!cellId) return false;
    const c = this.graph.getCellById(cellId);
    if (!c || !c.isNode()) return false;
    const k = (c as Node).getData()?.kind as string | undefined;
    return !!k && MM_KINDS.has(k);
  }

  private isBpmnEventNode(cellId: string | undefined): boolean {
    if (!cellId) return false;
    const c = this.graph.getCellById(cellId);
    if (!c || !c.isNode()) return false;
    return BPMN_EVENT_KINDS.has(this.nodeKind(c as Node));
  }

  private isPortDisabledNode(cellId: string | undefined): boolean {
    if (!cellId) return false;
    const c = this.graph.getCellById(cellId);
    if (!c || !c.isNode()) return false;
    return NON_CONNECTABLE_PORT_KINDS.has(this.nodeKind(c as Node));
  }

  private endpointPort(edge: Edge, type: Edge.TerminalType): string | undefined {
    const terminal = (type === "source" ? edge.getSource() : edge.getTarget()) as { port?: string } | undefined;
    return terminal?.port;
  }

  private inferEventEndpointSide(edge: Edge, type: Edge.TerminalType): PortSide | undefined {
    const eventId = type === "source" ? edge.getSourceCellId() ?? undefined : edge.getTargetCellId() ?? undefined;
    const peerId = type === "source" ? edge.getTargetCellId() ?? undefined : edge.getSourceCellId() ?? undefined;
    if (!eventId || !peerId) return undefined;
    const eventCell = this.graph.getCellById(eventId);
    const peerCell = this.graph.getCellById(peerId);
    if (!eventCell || !eventCell.isNode() || !peerCell || !peerCell.isNode()) return undefined;
    const eventNode = eventCell as Node;
    const peerNode = peerCell as Node;
    const ePos = eventNode.getPosition();
    const eSize = eventNode.getSize();
    const pPos = peerNode.getPosition();
    const pSize = peerNode.getSize();
    const dx = (pPos.x + pSize.width / 2) - (ePos.x + eSize.width / 2);
    const dy = (pPos.y + pSize.height / 2) - (ePos.y + eSize.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "bottom" : "top";
  }

  /** Regular-edge contract: BPMN event endpoints always use side center ports. */
  private normalizeRegularEdgeEndpoints(edge: Edge, connected?: ConnectedEndpointEvent): void {
    const srcId = edge.getSourceCellId() ?? undefined;
    const tgtId = edge.getTargetCellId() ?? undefined;
    if (!srcId || !tgtId) return;
    if (this.isSeqLifeline(srcId) || this.isSeqLifeline(tgtId)) return;
    if (this.isMindmapNode(srcId) || this.isMindmapNode(tgtId)) return;

    (["source", "target"] as const).forEach((type) => {
      const cellId = type === "source" ? srcId : tgtId;
      if (!this.isBpmnEventNode(cellId)) return;
      const fromConnect =
        connected?.type === type && connected.currentCell?.id === cellId
          ? collapsePortToSideCenter(connected.currentPort)
          : undefined;
      const fromTerminal = collapsePortToSideCenter(this.endpointPort(edge, type));
      const inferredSide = this.inferEventEndpointSide(edge, type);
      const normalized = fromConnect ?? fromTerminal ?? (inferredSide ? centerPortForSide(inferredSide) : undefined);
      if (!normalized) return;
      if (this.endpointPort(edge, type) === normalized) return;
      if (type === "source") edge.setSource(portEndpoint(cellId, normalized) as never);
      else edge.setTarget(portEndpoint(cellId, normalized) as never);
    });
  }

  /** Board-load migration: collapse legacy quarter ports on BPMN events to side center. */
  private normalizeLegacyBpmnEventPort(cellId: string, port?: string): string | undefined {
    if (!port) return undefined;
    if (!this.isBpmnEventNode(cellId)) return port;
    if (!port.endsWith("-1") && !port.endsWith("-2")) return port;
    return collapsePortToSideCenter(port) ?? port;
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
    edge.setSource(portEndpoint(srcId!, right ? "right" : "left") as never);
    edge.setTarget(portEndpoint(tgtId!, right ? "left" : "right") as never);
    edge.setRouter("normal");
    edge.setConnector("mm-edge");
  }

  // ── Model load / serialize ───────────────────────────────────────────────
  /**
   * X6's async render loop (JobQueue.flushJobs) has no try/catch: one render
   * job that throws leaves the queue marked "flushing" forever, so nothing new
   * is ever drawn again (cells reach the model, never the screen) — a frozen
   * canvas. Keep the loop alive: log the error and carry on with the rest.
   */
  private guardRenderQueue(): void {
    type Queue = { flushJobs: () => void; isFlushing: boolean; queue: unknown[]; queueFlush: () => void };
    const q = (this.graph as unknown as { renderer?: { schedule?: { queue?: Queue } } }).renderer?.schedule?.queue;
    if (!q || typeof q.flushJobs !== "function") return;
    const flush = q.flushJobs.bind(q);
    q.flushJobs = () => {
      try { flush(); }
      catch (err) {
        console.error("[omniboard] X6 render job failed; rendering continues", err);
        q.isFlushing = false;
        if (q.queue.length) q.queueFlush();
      }
    };
  }

  /**
   * Run X6's queued (async) render jobs now. A load that lands while the
   * previous load's cells are still waiting to render (board opening:
   * mount + onCanvasReady; file reloaded from disk) would otherwise clear
   * those cells first; their render jobs still run afterwards and throw for an
   * edge whose source node is gone ("Edge's source node … not exists").
   * X6's async flush has no try/catch, so that throw leaves its queue stuck
   * "flushing" and X6 never renders again — the canvas freezes and stops
   * answering clicks / right-clicks. (`queueFlushSync` is a no-op while an
   * async flush is pending, hence flushJobsSync.)
   */
  private flushPendingRender(): void {
    const queue = (this.graph as unknown as { renderer?: { schedule?: { queue?: { flushJobsSync?: () => void } } } })
      .renderer?.schedule?.queue;
    queue?.flushJobsSync?.();
  }

  loadModel(model: CanvasModel, opts?: { keepView?: boolean }) {
    this.applyAppState(model.appState ?? {});
    this.drillRoot = null;   // a fresh model opens on the whole process
    this.drillViews = [];
    this.renderCrumbs();
    // Migration: legacy pool defaults hardcoded lane id "l1", so files with
    // ≥2 pools have duplicate lane ids across pools. exportBpmn dồn lanes
    // vào 1 laneSet → invalid BPMN (Canvas._ensureValid: "element already
    // exists"). Rename collisions BEFORE rendering so subsequent exports
    // emit unique ids. Children's `data.laneId` is recomputed by spatial
    // overlap during `getModel()`, so we only need to rename pool lanes.
    model = fixInnerMessageFlows(this.dedupeLaneIdsAcrossPools(model));
    this.flushPendingRender();
    this.graph.clearCells();
    this.graph.startBatch("load");
    for (const n of model.nodes) {
      const a = n.attrs ?? {};
      const style = (a.style as NodeStyle) ?? {};
      const extra: NodeExtra = {
        cols: a.cols as ErdCol[] | undefined,
        fields: a.fields as string[] | undefined,
        methods: a.methods as string[] | undefined,
        who: a.who as string | undefined,
        labelOffset: a.labelOffset as { x: number; y: number } | undefined,
        lanes: a.lanes as Array<{ id: string; label: string }> | undefined,
        poolHorizontal: a.poolHorizontal as boolean | undefined,
        blackBox: a.blackBox as boolean | undefined,
        trigger: a.trigger as NodeExtra["trigger"],
        throwing: a.throwing as boolean | undefined,
        interrupting: a.interrupting as boolean | undefined,
        attachedTo: a.attachedTo as string | undefined,
        markers: a.markers as NodeExtra["markers"],
        collapsed: a.collapsed as boolean | undefined,
        // Story 2.1 — ERD cluster header color from DBML TableGroup.
        headerColor: a.__headerColor as string | undefined,
      };
      // Migration shim (Đợt A, 2026-06-01): collapse legacy event kinds to the
      // unified bpmn-event-{start,intermediate,end} + trigger/throwing in extra.
      // Keeps old .board files rendering identically while consolidating the schema.
      const migrated = migrateBpmnEventKind(n.shape, extra);
      const node = this.addHtmlNode(migrated.kind, n.x, n.y, n.width, n.height, n.label, style, n.id, migrated.extra, a.__source);
      // Phase D — store metadata attrs directly on node.data for round-trip.
      const phaseD: Record<string, unknown> = {};
      if (a.bpmnDoc) phaseD.bpmnDoc = a.bpmnDoc;
      if (a.calledElement) phaseD.calledElement = a.calledElement;
      if (a.bpmnFill) phaseD.bpmnFill = a.bpmnFill;
      if (a.bpmnStroke) phaseD.bpmnStroke = a.bpmnStroke;
      if (a.camunda) phaseD.camunda = a.camunda;
      if (a.bpmnProps) phaseD.bpmnProps = a.bpmnProps;
      if (Object.keys(phaseD).length) node.setData({ ...node.getData(), ...phaseD });
    }
    // Build a center-point index for auto port inference (used below).
    const nodeCenterMap = new Map<string, { cx: number; cy: number }>();
    for (const n of model.nodes) {
      nodeCenterMap.set(n.id, { cx: n.x + n.width / 2, cy: n.y + n.height / 2 });
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
      const data: { y?: number; ret?: boolean; style?: EdgeStyle; bpmnKind?: string; bpmnAttrs?: Record<string, unknown> } = {};
      if (seq) { data.y = typeof e.y === "number" ? e.y : undefined; data.ret = e.ret || undefined; }
      if (e.style) data.style = e.style;
      // Phase A — BPMN edge semantic round-trip. `kind` + `attrs` are persisted
      // on edge.data; visual style is derived from kind unless the user already
      // set style.flowType explicitly. Priority: explicit user style > kind > default.
      if (e.kind && e.kind !== "sequence") data.bpmnKind = e.kind;
      if (e.attrs && Object.keys(e.attrs).length) data.bpmnAttrs = { ...e.attrs };
      if (!data.style?.flowType) {
        // Derive visual flowType from semantic kind + attrs.
        const ft: EdgeStyle["flowType"] | undefined =
          e.kind === "message" ? "message" :
            e.kind === "association" ? "association" :
              e.attrs?.isDefault ? "default" :
                e.attrs?.condition ? "conditional" :
                  undefined;
        if (ft) {
          data.style = { ...(data.style ?? {}), flowType: ft, ...FLOW_TYPE_PRESETS[ft] };
        }
      }
      const forcedRouter = e.router === "normal" ? { name: "normal" } : e.router === "orth" ? { name: "orth" } : e.router === "avoid" ? AVOID_ROUTER : null;
      // Legacy/import-only precise anchoring: when `sourceAnchor`/`targetAnchor`
      // is set, pin the endpoint to that exact offset from the node's top-left.
      // Newly drawn canvas edges use the fixed 12-port grid instead.
      // connectionPoint "anchor" (not "boundary"): keep the endpoint exactly at
      // the stored offset. "boundary" re-cropped it to wherever the route hit
      // the bbox, which ignored the offset for edges approaching from above
      // (collapsed onto the top edge).
      const sourcePort = this.normalizeLegacyBpmnEventPort(e.source, e.sourcePort);
      const targetPort = this.normalizeLegacyBpmnEventPort(e.target, e.targetPort);
      const sourceEnd: Record<string, unknown> = { cell: e.source };
      if (e.sourceAnchor) {
        // NOTE: must NOT set `port` here — X6's topLeft anchor would resolve
        // its (dx, dy) against the PORT's tiny bbox (~5x5px) instead of the
        // node's bbox, collapsing the endpoint to a stub near the port marker.
        // The sourcePort is still preserved on canvas data for export.
        sourceEnd.anchor = { name: "topLeft", args: { dx: e.sourceAnchor.dx, dy: e.sourceAnchor.dy } };
        sourceEnd.connectionPoint = { name: "anchor" };
      } else if (sourcePort) {
        sourceEnd.port = sourcePort;
        sourceEnd.connectionPoint = PORT_CONNECTION_POINT;
      } else if (!seq && !mm) {
        // Auto-infer port from center-to-center direction so the orth router
        // produces clean straight segments instead of S-curves.
        //
        // Three cases:
        //  • Loop-back  (target is to the LEFT, dx < 0)
        //      → exit from BOTTOM, enter from BOTTOM — routes cleanly below both nodes.
        //  • Clearly horizontal (|dy| < 0.5 * |dx|, angle < ~27° from horizontal)
        //      → right → left
        //  • Diagonal / vertical (significant vertical component)
        //      → bottom → top  (or top → bottom for upward arrows)
        const sc = nodeCenterMap.get(e.source);
        const tc = nodeCenterMap.get(e.target);
        if (sc && tc) {
          const dx = tc.cx - sc.cx;
          const dy = tc.cy - sc.cy;
          if (dx < 0) {
            // Loop-back: route under the diagram
            sourceEnd.port = "bottom";
          } else if (Math.abs(dy) < Math.abs(dx) * 0.5) {
            // Primarily horizontal (forward)
            sourceEnd.port = "right";
          } else {
            // Primarily vertical
            sourceEnd.port = dy >= 0 ? "bottom" : "top";
          }
        }
      }
      const targetEnd: Record<string, unknown> = { cell: e.target };
      if (e.targetAnchor) {
        // Same caveat as sourceAnchor — never set `port` alongside the
        // topLeft anchor (X6 would resolve dx/dy against the port's bbox).
        targetEnd.anchor = { name: "topLeft", args: { dx: e.targetAnchor.dx, dy: e.targetAnchor.dy } };
        targetEnd.connectionPoint = { name: "anchor" };
      } else if (targetPort) {
        targetEnd.port = targetPort;
        targetEnd.connectionPoint = PORT_CONNECTION_POINT;
      } else if (!seq && !mm) {
        const sc = nodeCenterMap.get(e.source);
        const tc = nodeCenterMap.get(e.target);
        if (sc && tc) {
          const dx = tc.cx - sc.cx;
          const dy = tc.cy - sc.cy;
          if (dx < 0) {
            // Loop-back: both ends attach to bottom port
            targetEnd.port = "bottom";
          } else if (Math.abs(dy) < Math.abs(dx) * 0.5) {
            // Primarily horizontal
            targetEnd.port = "left";
          } else {
            // Primarily vertical
            targetEnd.port = dy >= 0 ? "top" : "bottom";
          }
        }
      }
      const created = this.graph.addEdge({
        id: e.id,
        source: sourceEnd as never, target: targetEnd as never,
        router: forcedRouter ?? (seq || mm ? "normal" : SMART_ROUTER),
        connector: seq ? "seq-msg" : mm ? "mm-edge" : CONNECTOR,
        attrs: edgeAttrs,
        labels: labelSpec,
        vertices: e.vertices ?? [],
        // Sequence Y is read by the seq-msg connector from edge data at draw time.
        data,
      });
      // Apply edge style if either the user/importer set `e.style` directly
      // OR Phase A derived one from semantic `kind`/`attrs` (data.style was
      // populated above for message/association/default/conditional).
      if (e.style || data.style) this.applyEdgeStyle(created);
      if (mm) this.applyMindmapRoutingIfNeeded(created); // re-anchor right/left ports (old boards had none)
      // ERD edges (both endpoints are erd-entity): push to back so arrows
      // don't cover col port circles and tables sit on top visually —
      // matches dbdiagram.io's "edges under nodes" rendering.
      const srcNode = this.graph.getCellById(e.source);
      const tgtNode = this.graph.getCellById(e.target);
      const srcKind = srcNode && (srcNode as Node).getData?.()?.kind;
      const tgtKind = tgtNode && (tgtNode as Node).getData?.()?.kind;
      if (srcKind === "erd-entity" && tgtKind === "erd-entity") {
        created.setZIndex(-1);
      }
      // Generic edges: saved ports (sourcePort/targetPort) are honoured as-is.
      // Body-drop endpoints (no port) float via the edge's anchor=center + boundary crop.
    }
    // Phase B — preserve subprocess containment + lane membership on every
    // node's data so getModel can round-trip them, then ALSO embed the
    // node into its X6 parent (subprocess) for visual drag-follow. Lanes
    // aren't X6 nodes (they live as `attrs.lanes` on the pool), so laneId
    // is stored on data only; export.ts rebuilds lane.flowNodeRef from it.
    for (const n of model.nodes) {
      if (!n.parentId && !n.laneId) continue;
      const child = this.graph.getCellById(n.id);
      if (!child || !child.isNode()) continue;
      const prev = (child.getData() as Record<string, unknown> | undefined) ?? {};
      child.setData({
        ...prev,
        ...(n.parentId ? { parentId: n.parentId } : {}),
        ...(n.laneId ? { laneId: n.laneId } : {}),
      });
      if (n.parentId) {
        const parent = this.graph.getCellById(n.parentId);
        if (parent && parent.isNode()) parent.addChild(child);
      }
    }
    // Phase C — fix nested-frame z-order. All FRAME_KINDS were `toBack()`-ed
    // at creation, so a nested sub-process (sp2 inside sp1) ends up BEHIND
    // its parent and its border disappears. Walk parentId depth and assign
    // increasing z to deeper frames so each level renders on top of its
    // container. Non-frame nodes stay above all frames (handled by their
    // default zIndex which is higher than toBack()-ed frames).
    const parentById = new Map<string, string | undefined>(model.nodes.map((n) => [n.id, n.parentId]));
    const depthOf = (id: string): number => {
      let d = 0;
      let cur: string | undefined = parentById.get(id);
      while (cur && d < 32) { d++; cur = parentById.get(cur); }
      return d;
    };
    for (const n of model.nodes) {
      if (!FRAME_KINDS.has(n.shape)) continue;
      const cell = this.graph.getCellById(n.id);
      if (!cell || !cell.isNode()) continue;
      cell.setZIndex(frameZ(n.shape, depthOf(n.id)));
    }
    this.raiseBoundaryEvents();
    this.refreshSubprocessVisibility();
    this.graph.stopBatch("load");
    // Loading is not an edit: drop the clear + add records (and any earlier
    // edits of the previous board), or Ctrl+Z walks back to an empty board.
    this.graph.cleanHistory();
    this.resyncHtmlNodes();   // rebuild the mobile overlay from the freshly loaded nodes
    // Auto-grow every mindmap node once the foreignObject DOM is mounted &
    // measurable — covers long labels saved with too-small initial height.
    setTimeout(() => {
      this.graph.getNodes().forEach((n) => {
        const sel = this.autoGrowSelector(this.nodeKind(n));
        if (sel) this.autoGrowNodeToContent(n, sel);
      });
      this.refreshMinimap();
      this.refreshBpmnEventLabels();
    }, 80);
    if (model.nodes.length && !opts?.keepView) this.fitWhenReady();
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

  /**
   * Merge an external CanvasModel into the current board. Imported nodes get
   * fresh ids (to avoid colliding with existing ones), edge endpoints are
   * rewired, and the whole cluster is offset so it lands near the viewport
   * centre instead of overlapping existing content.
   */
  mergeModel(incoming: CanvasModel): { added: number } {
    if (!incoming.nodes.length && !incoming.edges.length) return { added: 0 };

    // Compute incoming bbox, then where to drop it on the canvas (current viewport centre).
    const xs = incoming.nodes.map((n) => n.x);
    const ys = incoming.nodes.map((n) => n.y);
    const minX = Math.min(...xs, 0);
    const minY = Math.min(...ys, 0);

    const rect = this.graphMount.getBoundingClientRect();
    const sc = this.graph.scale().sx || 1;
    const tr = this.graph.translate();
    const viewCx = (rect.width / 2 - tr.tx) / sc;
    const viewCy = (rect.height / 2 - tr.ty) / sc;
    const w = Math.max(...incoming.nodes.map((n) => n.x + n.width), 0) - minX;
    const h = Math.max(...incoming.nodes.map((n) => n.y + n.height), 0) - minY;
    const dx = viewCx - w / 2 - minX;
    const dy = viewCy - h / 2 - minY;

    const current = this.getModel();

    // Only rename when an id actually collides with something already on the
    // board. Preserving original ids is critical for round-trip with
    // structured formats (BPMN lanes reference flow nodes by id; renaming
    // every node breaks those refs even when there's no real collision).
    const stamp = Date.now().toString(36);
    let seq = 0;
    const existingIds = new Set<string>([
      ...current.nodes.map((n) => n.id),
      ...current.edges.map((e) => e.id),
    ]);
    const idMap = new Map<string, string>();
    const idFor = (oldId: string) => {
      let mapped = idMap.get(oldId);
      if (!mapped) {
        mapped = existingIds.has(oldId) ? `${oldId}_imp_${stamp}_${(++seq).toString(36)}` : oldId;
        idMap.set(oldId, mapped);
      }
      return mapped;
    };

    // Remap nested source-meta sourceId so exporters that consult __source can
    // still tell which originals these belonged to and patch them correctly on
    // round-trip. When no collision, idFor returns the original id so sourceId
    // stays pointing at the original source-file element (immutable identity).
    const remapAttrs = (attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
      if (!attrs) return attrs;
      const src = attrs.__source as { sourceId?: string } | undefined;
      if (!src?.sourceId) return attrs;
      return {
        ...attrs,
        __source: { ...src, sourceId: idFor(src.sourceId) },
      };
    };
    const merged: CanvasModel = {
      nodes: [
        ...current.nodes,
        ...incoming.nodes.map((n) => ({
          ...n,
          id: idFor(n.id),
          x: n.x + dx,
          y: n.y + dy,
          attrs: remapAttrs(n.attrs),
        })),
      ],
      edges: [
        ...current.edges,
        ...incoming.edges.map((e) => ({
          ...e,
          id: idFor(e.id),
          source: idFor(e.source),
          target: idFor(e.target),
          vertices: e.vertices?.map((v) => ({ x: v.x + dx, y: v.y + dy })),
        })),
      ],
    };
    this.loadModel(merged);
    return { added: incoming.nodes.length };
  }

  /** Change a node's id. X6 ids are fixed, so the node is replaced by a copy
   *  under the new id, with arrows, steps and references moved over in one undo
   *  step. The BPMN export finds the old file element through `__source.sourceId`,
   *  so nothing only the file had is lost. */
  renameNode(oldId: string, newId: string): boolean {
    if (newId === oldId) return true;
    const old = this.graph.getCellById(oldId);
    if (!old?.isNode() || !/^[A-Za-z_][\w.-]*$/.test(newId) || this.graph.getCellById(newId)) return false;
    const REFS = ["attachedTo", "parentId", "laneId", "poolId"];
    this.graph.startBatch("rename");
    const { parent: _p, children: _c, ...json } = old.toJSON();
    const next = this.graph.addNode({ ...json, id: newId });
    old.getParent()?.embed(next);
    for (const c of old.getChildren() ?? []) { old.unembed(c); next.embed(c); }
    for (const e of this.graph.getConnectedEdges(old)) {
      if (e.getSourceCellId() === oldId) e.setSource({ ...e.getSource(), cell: newId } as Edge.TerminalCellData);
      if (e.getTargetCellId() === oldId) e.setTarget({ ...e.getTarget(), cell: newId } as Edge.TerminalCellData);
    }
    for (const n of this.graph.getNodes()) {
      const d = n.getData() ?? {};
      const hit = REFS.filter((k) => d[k] === oldId);
      if (hit.length) n.setData(Object.fromEntries(hit.map((k) => [k, newId])));
    }
    old.remove();
    this.graph.stopBatch("rename");
    if (this.drillRoot === oldId) this.setDrillRoot(newId);
    this.rerender(next);
    this.graph.resetSelection([next]);
    this.onChange();
    return true;
  }

  getModel(): CanvasModel {
    const nodes = this.graph.getNodes().map((n) => {
      const p = n.getPosition(); const s = n.getSize(); const ex = this.nodeExtra(n);
      // Phase B — parentId / laneId round-trip via node.data (set in loadModel).
      // Live X6 parent (set by user dragging a node into a subprocess) takes
      // precedence over the cached data, so post-drag state is always current.
      const data = (n.getData() as { parentId?: string; laneId?: string } | undefined) ?? {};
      const x6Parent = n.getParent();
      const parentId = x6Parent && x6Parent.isNode() ? x6Parent.id : data.parentId;
      
      // Live laneId determination based on physical pool overlap (Phase B).
      // Since lanes are not X6 nodes, we find the pool node that contains this node's center,
      // and determine which lane it falls into from each lane's own height (laneLayout).
      let laneId = data.laneId;
      if (
        this.nodeKind(n) !== "bpmn-pool" &&
        this.nodeKind(n) !== "bpmn-lane" &&
        this.nodeKind(n) !== "bpmn-subprocess" &&
        this.nodeKind(n) !== "bpmn-group" &&
        this.nodeKind(n) !== "bpmn-annotation"
      ) {
        const cx = p.x + s.width / 2;
        const cy = p.y + s.height / 2;
        const pools = this.graph.getNodes().filter((node) => this.nodeKind(node) === "bpmn-pool");
        for (const pool of pools) {
          const poolPos = pool.getPosition();
          const poolSize = pool.getSize();
          if (
            cx >= poolPos.x && cx <= poolPos.x + poolSize.width &&
            cy >= poolPos.y && cy <= poolPos.y + poolSize.height
          ) {
            const poolExtra = this.nodeExtra(pool);
            const poolLanes = poolExtra.lanes ?? [{ id: "l1", label: "Lane 1" }];
            if (poolLanes.length > 0) {
              // Rows by y in a horizontal pool, columns by x in a vertical one.
              const horizontal = poolExtra.poolHorizontal !== false;
              // The leaf lane: a child lane when the lane under it has children.
              laneId = horizontal
                ? leafLaneAt(poolLanes, poolSize.height, cy - poolPos.y)
                : leafLaneAt(asStackLanes(poolLanes, false), poolSize.width, cx - poolPos.x);
              
              // Keep the cached data in sync silently
              if (laneId !== data.laneId) {
                n.setData({ ...data, laneId }, { silent: true });
              }
              break;
            }
          }
        }
      }
      return {
        id: n.id, shape: this.nodeKind(n), x: p.x, y: p.y, width: s.width, height: s.height,
        label: this.nodeLabel(n),
        ...(parentId ? { parentId } : {}),
        ...(laneId ? { laneId } : {}),
        attrs: {
          style: this.nodeStyle(n),
          cols: ex.cols, fields: ex.fields, methods: ex.methods, who: ex.who,
          labelOffset: ex.labelOffset, lanes: ex.lanes,
          poolHorizontal: ex.poolHorizontal,
          blackBox: ex.blackBox,
          // BPMN extras (Đợt A)
          trigger: ex.trigger, throwing: ex.throwing, interrupting: ex.interrupting,
          attachedTo: ex.attachedTo, markers: ex.markers,
          collapsed: ex.collapsed,
          // Phase D — BPMN metadata (live on node.data, not NodeExtra)
          bpmnDoc: n.getData()?.bpmnDoc,
          calledElement: n.getData()?.calledElement,
          bpmnFill: n.getData()?.bpmnFill,
          bpmnStroke: n.getData()?.bpmnStroke,
          camunda: n.getData()?.camunda,
          bpmnProps: n.getData()?.bpmnProps,
          __source: n.getData()?.__source,
        },
      };
    });
    const edges = this.graph.getEdges().map((e) => {
      const src = e.getSource() as { cell: string; port?: string };
      const tgt = e.getTarget() as { cell: string; port?: string };
      const srcFull = e.getSource() as { cell?: string; port?: string; anchor?: { name?: string; args?: { dx?: number; dy?: number } } };
      const tgtFull = e.getTarget() as { cell?: string; port?: string; anchor?: { name?: string; args?: { dx?: number; dy?: number } } };
      const d = (e.getData() as { y?: number; ret?: boolean; style?: EdgeStyle; bpmnKind?: string; bpmnAttrs?: Record<string, unknown> } | undefined) ?? {};
      const verts = e.getVertices();
      const lbl = e.getLabels()?.[0] as { attrs?: { label?: { text?: string } }; position?: { distance?: number; offset?: number | { x: number; y: number } } } | undefined;
      const labelPos = lbl?.position && (lbl.position.distance != null || lbl.position.offset != null)
        ? { distance: lbl.position.distance, offset: lbl.position.offset }
        : undefined;
      const r = e.getRouter() as { name?: string } | string | undefined;
      const routerName = typeof r === "string" ? r : r?.name;
      const router: "normal" | "orth" | "avoid" | undefined =
        routerName === "normal" ? "normal" : routerName === "orth" ? "orth" : routerName === "avoid" ? "avoid" : undefined;
      // Round-trip bpmn.io-style precise anchor offsets (topLeft + dx/dy).
      const srcAnchor = srcFull.anchor?.name === "topLeft" && typeof srcFull.anchor.args?.dx === "number" && typeof srcFull.anchor.args?.dy === "number"
        ? { dx: srcFull.anchor.args.dx, dy: srcFull.anchor.args.dy } : undefined;
      const tgtAnchor = tgtFull.anchor?.name === "topLeft" && typeof tgtFull.anchor.args?.dx === "number" && typeof tgtFull.anchor.args?.dy === "number"
        ? { dx: tgtFull.anchor.args.dx, dy: tgtFull.anchor.args.dy } : undefined;
      // Phase A — derive semantic kind + attrs. Priority: explicit data.bpmnKind
      // (set at load time or by future Phase D UI) > visual style.flowType (the
      // legacy on-canvas picker). Conditional/default visual presets map to
      // sequence kind + attrs.condition/isDefault for BPMN serialization.
      let bpmnKind = d.bpmnKind as "sequence" | "message" | "association" | undefined;
      const bpmnAttrs: Record<string, unknown> = { ...(d.bpmnAttrs ?? {}) };
      const ft = d.style?.flowType;
      if (!bpmnKind) {
        if (ft === "message") bpmnKind = "message";
        else if (ft === "association") bpmnKind = "association";
      }
      if (ft === "default" && bpmnAttrs.isDefault === undefined) bpmnAttrs.isDefault = true;
      // (Don't synthesize a placeholder condition body when ft === "conditional"
      // and no body is set — that's a Phase D editor concern.)
      return {
        id: e.id, source: src.cell, sourcePort: src.port, target: tgt.cell, targetPort: tgt.port,
        sourceAnchor: srcAnchor, targetAnchor: tgtAnchor,
        label: lbl?.attrs?.label?.text,
        labelPos,
        y: typeof d.y === "number" ? d.y : undefined,
        ret: d.ret ? true : undefined,
        style: d.style && Object.keys(d.style).length ? d.style : undefined,
        vertices: verts && verts.length ? verts.map((v) => ({ x: v.x, y: v.y })) : undefined,
        router,
        ...(bpmnKind && bpmnKind !== "sequence" ? { kind: bpmnKind } : {}),
        ...(Object.keys(bpmnAttrs).length ? { attrs: bpmnAttrs as CanvasModel["edges"][number]["attrs"] } : {}),
      };
    });
    return { nodes, edges, ...(Object.keys(this.appState).length ? { appState: { ...this.appState } } : {}) };
  }

  nodeCount(): number { return this.graph.getNodes().length; }

  focusCellById(id: string): boolean {
    const cell = this.graph.getCellById(id);
    if (!cell) return false;
    this.graph.resetSelection([cell]);
    if (cell.isNode()) {
      const b = (cell as Node).getBBox();
      this.flyTo({ x: b.x - 160, y: b.y - 120, width: b.width + 320, height: b.height + 240 }, 1.2);
    }
    this.refreshContextBar();
    this.refreshProps();
    return true;
  }

  private flyAnim = 0;
  /** Pan + zoom to a rect with an ease-out (≈460ms); a newer call cancels the running one. */
  private flyTo(r: { x: number; y: number; width: number; height: number }, maxScale: number): void {
    const box = this.graphMount.getBoundingClientRect();
    const s1 = Math.max(0.1, Math.min(maxScale, (box.width - 120) / r.width, (box.height - 120) / r.height));
    const a = this.graph.getGraphArea();
    const s0 = this.graph.scale().sx;
    const c0 = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const c1 = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const id = ++this.flyAnim;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const step = (now: number): void => {
      if (id !== this.flyAnim) return;
      const t = reduce ? 1 : 1 - Math.pow(1 - Math.min(1, (now - t0) / 460), 4);
      this.graph.zoomTo(s0 + (s1 - s0) * t);
      this.graph.centerPoint(c0.x + (c1.x - c0.x) * t, c0.y + (c1.y - c0.y) * t);
      this.updateZoom();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

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

    // 7. Reset edges (vertices + router/connector + ports to the flow direction) — skip mindmap/seq.
    const srcPort = horiz ? "right" : "bottom", tgtPort = horiz ? "left" : "top";
    for (const e of this.graph.getEdges()) {
      const sId = e.getSourceCellId(), tId = e.getTargetCellId();
      if (!sId || !tId) continue;
      if (this.isMindmapNode(sId) && this.isMindmapNode(tId)) continue;
      if (this.isSeqLifeline(sId) && this.isSeqLifeline(tId)) continue;
      e.setVertices([]);
      e.setSource(portEndpoint(sId, srcPort) as never);
      e.setTarget(portEndpoint(tId, tgtPort) as never);
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

  /**
   * "Tự sắp xếp". A board with horizontal BPMN pools is arranged lane-aware
   * (laneAwareLayout): left→right flow, every shape stays in its lane, lanes
   * grow to fit, pools keep their order. Other boards: autoLayout. One undo
   * step.
   */
  autoArrange(): void {
    const poolNodes = this.graph.getNodes().filter((n) => this.nodeKind(n) === "bpmn-pool" && this.nodeExtra(n).poolHorizontal !== false);
    if (!poolNodes.length) { this.autoLayout("LR"); return; }
    const model = this.getModel();     // fresh leaf laneIds from positions
    const pools: LayoutPool[] = poolNodes.map((p) => ({
      ...p.getPosition(), ...p.getSize(), id: p.id, lanes: this.nodeExtra(p).lanes ?? [], blackBox: !!this.nodeExtra(p).blackBox,
    }));
    const laneOwner = new Map<string, string>();
    for (const p of pools) for (const id of allLaneIds(p.lanes)) laneOwner.set(id, p.id);
    const inPoolWithoutLanes = (n: CanvasModel["nodes"][number]) => pools.find((p) => !p.lanes.length
      && n.x + n.width / 2 >= p.x && n.x + n.width / 2 <= p.x + p.width && n.y + n.height / 2 >= p.y && n.y + n.height / 2 <= p.y + p.height)?.id;
    // Annotations / data shapes hang off a task (association): dagre would push
    // them to the last column, so they follow their task (its column, the row
    // after it, in their own lane).
    const isArtifact = (shape: string) => shape === "bpmn-annotation" || shape.startsWith("bpmn-data-");
    const toLayout = (n: CanvasModel["nodes"][number]): LayoutNode => ({
      id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, laneId: n.laneId,
      poolId: (n.laneId && laneOwner.get(n.laneId)) || inPoolWithoutLanes(n),
    });
    const flowNodes = model.nodes
      .filter((n) => !CONTAINER_KINDS.has(n.shape) && !n.attrs?.attachedTo && !isArtifact(n.shape))
      .map(toLayout)
      .filter((n) => !!n.poolId);
    const flowIds = new Set(flowNodes.map((n) => n.id));
    const followers = model.nodes
      .filter((n) => isArtifact(n.shape))
      .map((n) => ({ ...toLayout(n), follow: model.edges
        .map((e) => (e.source === n.id ? e.target : e.target === n.id ? e.source : null))
        .find((id): id is string => !!id && flowIds.has(id)) }))
      // no arrow to a task: a free note — keeps its x, after the lane's rows
      .map((n) => (n.follow ? n : { ...n, keepX: true }))
      .filter((n) => !!n.poolId && (!!n.follow || !!n.laneId));
    const layoutNodes: LayoutNode[] = [...flowNodes, ...followers];
    if (!layoutNodes.length) return;
    const result = layoutInLanes(pools, layoutNodes, model.edges.map((e) => ({ source: e.source, target: e.target })));
    const moved = new Set(result.nodes.keys());
    this.graph.startBatch("auto-layout");
    try {
      for (const [id, p] of result.pools) {
        const pool = this.graph.getCellById(id) as Node;
        pool.setPosition(p.x, p.y);
        pool.resize(p.width, p.height);
        pool.setData({ ...pool.getData(), lanes: p.lanes }, { deep: false });
        this.rerender(pool);
      }
      // Shapes outside the lanes (annotations, data objects…) tied to an
      // arranged shape by an arrow move with it, keeping their offset.
      for (const n of model.nodes) {
        if (moved.has(n.id) || n.shape === "bpmn-pool" || CONTAINER_KINDS.has(n.shape) || n.attrs?.attachedTo) continue;
        const partner = model.edges
          .map((e) => (e.source === n.id ? e.target : e.target === n.id ? e.source : null))
          .find((id): id is string => !!id && moved.has(id));
        const before = partner ? model.nodes.find((x) => x.id === partner) : undefined;
        const after = partner ? result.nodes.get(partner) : undefined;
        if (before && after) (this.graph.getCellById(n.id) as Node).setPosition(n.x + after.x - before.x, n.y + after.y - before.y);
      }
      for (const [id, p] of result.nodes) (this.graph.getCellById(id) as Node).setPosition(p.x, p.y);
      // Re-wire arrows between arranged shapes: sequence flows right → left;
      // message flows (between pools) bottom → top or top → bottom, so they
      // run vertically between the pools; both route around shapes.
      // Associations and arrows anchored on a pool keep their ends.
      for (const e of this.graph.getEdges()) {
        const sId = e.getSourceCellId(), tId = e.getTargetCellId();
        if (!sId || !tId || !moved.has(sId) || !moved.has(tId)) continue;
        e.setVertices([]);
        const kind = (e.getData() as { bpmnKind?: string } | undefined)?.bpmnKind;
        if (kind === "association") continue;
        let [sp, tp] = ["right", "left"];
        if (kind === "message") {
          const down = (result.nodes.get(sId)?.y ?? 0) < (result.nodes.get(tId)?.y ?? 0);
          [sp, tp] = down ? ["bottom", "top"] : ["top", "bottom"];
        }
        e.setSource(portEndpoint(sId, sp) as never);
        e.setTarget(portEndpoint(tId, tp) as never);
        e.setRouter(SMART_ROUTER as never);
      }
    } finally { this.graph.stopBatch("auto-layout"); }
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
    // `overflow:visible` stops each node's <foreignObject> from shaving the
    // edges off round events / drop-shadows when the SVG is rasterized
    // (foreignObject clips to its node-sized bounds by default).
    style.textContent = collectPluginCss() + "\nforeignObject{overflow:visible}";
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
    this.cancelSpaceDrag();
    this.searchBox?.remove(); this.searchBox = null;
    if (this.wheelPan) this.graphMount.removeEventListener("wheel", this.wheelPan);
    // Remove document-scoped listeners so they don't pile up (and keep firing
    // against a disposed graph) every time a board is re-opened.
    for (const { type, fn } of this.docListeners) document.removeEventListener(type, fn, true);
    this.docListeners = [];
    if (this.edgeBarDebounce != null) { window.clearTimeout(this.edgeBarDebounce); this.edgeBarDebounce = null; }
    this.graph.dispose();
  }
}
