import { nodeHtml, type NodeStyle, type NodeExtra, type ErdCol } from "./htmlNode";
import type { CanvasModel } from "./types";
import { hostSide } from "./boundaryLayout";

const SVGNS = "http://www.w3.org/2000/svg";
const XHTMLNS = "http://www.w3.org/1999/xhtml";
const EDGE_STROKE = "#9c8b7e";

/** Pull the plugin's own stylesheet text (design tokens + node CSS) for standalone SVG. */
export function collectPluginCss(): string {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      let text = ""; let ours = false;
      for (const r of Array.from(rules)) {
        const t = r.cssText;
        if (t.includes(".lk-root") || t.includes("--pg-accent")) ours = true;
        text += t + "\n";
      }
      if (ours) return text;
    } catch { /* cross-origin sheet — skip */ }
  }
  return "";
}

type Pt = { x: number; y: number };
type ModelNode = CanvasModel["nodes"][number];

function nodeBox(n: ModelNode): { x: number; y: number; w: number; h: number } {
  return { x: n.x, y: n.y, w: n.width, h: n.height };
}

// Anchor point on a node for a fixed port id (3 per side); center if unknown.
function anchor(n: ModelNode, port?: string): Pt {
  const b = nodeBox(n);
  switch (port) {
    case "top-1": return { x: b.x + b.w * 0.25, y: b.y };
    case "top": return { x: b.x + b.w / 2, y: b.y };
    case "top-2": return { x: b.x + b.w * 0.75, y: b.y };
    case "bottom-1": return { x: b.x + b.w * 0.25, y: b.y + b.h };
    case "bottom": return { x: b.x + b.w / 2, y: b.y + b.h };
    case "bottom-2": return { x: b.x + b.w * 0.75, y: b.y + b.h };
    case "left-1": return { x: b.x, y: b.y + b.h * 0.25 };
    case "left": return { x: b.x, y: b.y + b.h / 2 };
    case "left-2": return { x: b.x, y: b.y + b.h * 0.75 };
    case "right-1": return { x: b.x + b.w, y: b.y + b.h * 0.25 };
    case "right": return { x: b.x + b.w, y: b.y + b.h / 2 };
    case "right-2": return { x: b.x + b.w, y: b.y + b.h * 0.75 };
    default: return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
}
function normal(port?: string): Pt {
  const side = port?.split("-")[0];
  if (side === "top") return { x: 0, y: -1 };
  if (side === "bottom") return { x: 0, y: 1 };
  if (side === "left") return { x: -1, y: 0 };
  if (side === "right") return { x: 1, y: 0 };
  return { x: 0, y: 0 };
}

// A simple orthogonal route: leave each endpoint along its side normal, bend once.
function edgePath(s: Pt, sPort: string | undefined, t: Pt, tPort: string | undefined): string {
  const ext = 18;
  const sn = normal(sPort), tn = normal(tPort);
  const p1 = { x: s.x + sn.x * ext, y: s.y + sn.y * ext };
  const p2 = { x: t.x + tn.x * ext, y: t.y + tn.y * ext };
  // Horizontal-dominant source → travel in X first, else Y first.
  const horizFirst = sn.x !== 0 || (sn.y === 0 && Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y));
  const bend = horizFirst ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
  return `M ${s.x} ${s.y} L ${p1.x} ${p1.y} L ${bend.x} ${bend.y} L ${p2.x} ${p2.y} L ${t.x} ${t.y}`;
}

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const num = (v: unknown): number => Number(v) || 0;

type Bounds = { x: number; y: number; w: number; h: number };

/** Diagram bounding box padded by `pad`. `x`/`y` are the top-left origin. */
function computeBounds(nodes: ModelNode[], pad: number): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 300; }
  return {
    x: minX - pad, y: minY - pad,
    w: Math.ceil(maxX - minX + pad * 2), h: Math.ceil(maxY - minY + pad * 2),
  };
}

/** Edge `<path>` + optional label markup in absolute model coordinates.
 *  Shared by both the foreignObject SVG (export) and the card composite (mobile). */
function edgesMarkup(edges: CanvasModel["edges"], byId: Map<string, ModelNode>): string {
  return (edges ?? []).map((e) => {
    const sn = byId.get(e.source), tn = byId.get(e.target);
    if (!sn || !tn) return "";
    const s = anchor(sn, e.sourcePort), t = anchor(tn, e.targetPort);
    const d = edgePath(s, e.sourcePort, t, e.targetPort);
    const line = `<path d="${d}" fill="none" stroke="${EDGE_STROKE}" stroke-width="1.8" marker-end="url(#da-arrow)"/>`;
    const label = e.label
      ? `<text x="${(s.x + t.x) / 2}" y="${(s.y + t.y) / 2 - 4}" text-anchor="middle" font-size="12" fill="#1f2329" style="font-family:var(--font-body,system-ui)">${esc(e.label)}</text>`
      : "";
    return line + label;
  }).join("");
}

/** Map a model node's `attrs` to the NodeExtra payload + design HTML. Mirrors
 *  OmniboardCanvas.nodeExtra() so static renders emit the SAME BPMN glyphs /
 *  activity markers / lanes as the live canvas (otherwise events render as empty
 *  rings and pools lose their lane bands). */
function nodeInnerHtml(n: ModelNode, byId: Map<string, ModelNode>): string {
  const a = (n.attrs ?? {}) as Record<string, unknown>;
  const host = typeof a.attachedTo === "string" ? byId.get(a.attachedTo) : undefined;
  const style = (a.style as NodeStyle) ?? {};
  const extra: NodeExtra = {
    cols: a.cols as ErdCol[] | undefined,
    fields: a.fields as string[] | undefined,
    methods: a.methods as string[] | undefined,
    who: a.who as NodeExtra["who"],
    labelOffset: a.labelOffset as NodeExtra["labelOffset"],
    lanes: a.lanes as NodeExtra["lanes"],
    poolHorizontal: a.poolHorizontal as NodeExtra["poolHorizontal"],
    blackBox: a.blackBox as NodeExtra["blackBox"],
    trigger: a.trigger as NodeExtra["trigger"],
    throwing: a.throwing as NodeExtra["throwing"],
    interrupting: a.interrupting as NodeExtra["interrupting"],
    attachedTo: a.attachedTo as NodeExtra["attachedTo"],
    markers: a.markers as NodeExtra["markers"],
    collapsed: a.collapsed as NodeExtra["collapsed"],
    // Boundary event: label outside its host, like the live canvas.
    ...(host ? { labelSide: hostSide(n, host) } : {}),
  };
  return nodeHtml(n.shape, n.label, style, extra);
}

/** Boundary events (attachedTo) paint after every other node so their host
 *  never covers them, whatever order the model lists them in. */
function paintOrder(nodes: ModelNode[]): ModelNode[] {
  const isBoundary = (n: ModelNode) => typeof (n.attrs as Record<string, unknown> | undefined)?.attachedTo === "string";
  return [...nodes.filter((n) => !isBoundary(n)), ...nodes.filter(isBoundary)];
}

const ARROW_DEF = `<marker id="da-arrow" markerWidth="11" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L11 4 L0 8 z" fill="${EDGE_STROKE}"/></marker>`;

/** Pure model → standalone styled SVG string (no live X6 graph needed).
 *  Uses one `<foreignObject>` per node — correct on desktop WebKit/Chromium and
 *  required for SVG→PNG/PDF rasterization. NOT safe on iOS WebKit, where multiple
 *  offset foreignObjects collapse toward the SVG origin; mobile previews use
 *  `renderModelToCard` instead (see Error Pattern #8 in project-context.md). */
export function renderModelToSvg(model: CanvasModel, css: string, pad = 24, bg = "#ffffff"): string {
  const nodes = model.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { x, y, w, h } = computeBounds(nodes, pad);

  const edgeSvg = edgesMarkup(model.edges, byId);
  const nodeSvg = paintOrder(nodes).map((n) => {
    const inner = nodeInnerHtml(n, byId);
    return `<foreignObject x="${num(n.x)}" y="${num(n.y)}" width="${num(n.width)}" height="${num(n.height)}"><div xmlns="${XHTMLNS}" class="hn" style="width:100%;height:100%">${inner}</div></foreignObject>`;
  }).join("");

  return `<svg xmlns="${SVGNS}" class="lk-root" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">`
    + `<defs>${ARROW_DEF}</defs>`
    // `overflow:visible` keeps each node's foreignObject from clipping round
    // event borders / drop-shadows / external event labels when rasterized.
    + `<style>foreignObject{overflow:visible}${css}</style>`
    + (bg && bg !== "transparent" ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>` : "")
    + edgeSvg + nodeSvg
    + `</svg>`;
}

/**
 * Pure model → two-layer HTML card composite, for the MOBILE preview path.
 *
 * WHY (Error Pattern #8): iOS WebKit mis-positions offset `<foreignObject>`
 * elements, collapsing every node toward the SVG origin while `<path>` edges
 * (absolute coords) still draw correctly — producing the "edges spread out,
 * node boxes piled at the top-left" garble. This renderer avoids foreignObject
 * for nodes entirely: edges stay in an SVG layer (fine on iOS), and each node
 * becomes a real absolutely-positioned `<div>` reusing the SAME `nodeHtml()` so
 * the visuals never drift from the live canvas / desktop preview.
 *
 * Output is a fixed-pixel `.ob-card-stage` wrapped in `.ob-card-fit`. Fit-to-card
 * scaling is applied at runtime by `fitCardStage` (transform: scale on a real
 * HTML element — safe on iOS, unlike transforms INSIDE foreignObject).
 */
export function renderModelToCard(model: CanvasModel, pad = 16, bg = "transparent"): string {
  const nodes = model.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { x, y, w, h } = computeBounds(nodes, pad);

  const edgeSvg = `<svg xmlns="${SVGNS}" class="ob-card-edges" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" `
    + `style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:visible;pointer-events:none">`
    + `<defs>${ARROW_DEF}</defs>${edgesMarkup(model.edges, byId)}</svg>`;

  const nodeDivs = paintOrder(nodes).map((n) => {
    const inner = nodeInnerHtml(n, byId);
    // Offset into stage-local coordinates (stage origin = bounds top-left).
    const left = num(n.x) - x, top = num(n.y) - y;
    return `<div class="hn" style="position:absolute;left:${left}px;top:${top}px;width:${num(n.width)}px;height:${num(n.height)}px">${inner}</div>`;
  }).join("");

  const stageBg = bg && bg !== "transparent" ? `;background:${bg}` : "";
  return `<div class="ob-card-fit lk-root">`
    + `<div class="ob-card-stage" data-ob-w="${w}" data-ob-h="${h}" `
    + `style="position:relative;width:${w}px;height:${h}px;transform-origin:top left${stageBg}">`
    + edgeSvg + nodeDivs
    + `</div></div>`;
}

/**
 * Scale a `renderModelToCard` composite to fit its container width. Reads the
 * natural size from the stage's `data-ob-w`/`data-ob-h` attrs, applies a CSS
 * `transform: scale(k)` (k ≤ 1) on the real `.ob-card-stage` div, and reserves
 * the scaled height on `.ob-card-fit` (transform doesn't affect layout box).
 *
 * Returns a cleanup function that disconnects the ResizeObserver — the caller
 * MUST register it (e.g. `plugin.register(cleanup)`) so it's released on unload.
 */
export function fitCardStage(root: HTMLElement): () => void {
  const fit = root.querySelector<HTMLElement>(".ob-card-fit");
  const stage = root.querySelector<HTMLElement>(".ob-card-stage");
  if (!fit || !stage) return () => {};
  const natW = num(stage.dataset.obW), natH = num(stage.dataset.obH);
  if (natW <= 0 || natH <= 0) return () => {};

  const apply = (): void => {
    const avail = fit.clientWidth;
    if (avail <= 0) return;
    const k = Math.min(1, avail / natW);
    stage.style.transform = `scale(${k})`;
    fit.style.height = `${Math.round(natH * k)}px`;
  };

  apply();
  const ResizeObs = typeof ResizeObserver !== "undefined" ? ResizeObserver : null;
  if (!ResizeObs) return () => {};
  const ro = new ResizeObs(() => apply());
  ro.observe(fit);
  return () => ro.disconnect();
}
