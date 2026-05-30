import { nodeHtml, type NodeStyle, type NodeExtra, type ErdCol } from "./htmlNode";
import type { CanvasModel } from "./types";

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

// Anchor point on a node for a given port id (top/right/bottom/left); center if unknown.
function anchor(n: ModelNode, port?: string): Pt {
  const b = nodeBox(n);
  switch (port) {
    case "top": return { x: b.x + b.w / 2, y: b.y };
    case "bottom": return { x: b.x + b.w / 2, y: b.y + b.h };
    case "left": return { x: b.x, y: b.y + b.h / 2 };
    case "right": return { x: b.x + b.w, y: b.y + b.h / 2 };
    default: return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
}
function normal(port?: string): Pt {
  switch (port) {
    case "top": return { x: 0, y: -1 };
    case "bottom": return { x: 0, y: 1 };
    case "left": return { x: -1, y: 0 };
    case "right": return { x: 1, y: 0 };
    default: return { x: 0, y: 0 };
  }
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

/** Pure model → standalone styled SVG string (no live X6 graph needed). */
export function renderModelToSvg(model: CanvasModel, css: string, pad = 24, bg = "#ffffff"): string {
  const nodes = model.nodes ?? [];
  const edges = model.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 300; }
  const x = minX - pad, y = minY - pad;
  const w = Math.ceil(maxX - minX + pad * 2), h = Math.ceil(maxY - minY + pad * 2);

  const edgeSvg = edges.map((e) => {
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

  const nodeSvg = nodes.map((n) => {
    const style = (n.attrs?.style as NodeStyle) ?? {};
    const extra: NodeExtra = {
      cols: n.attrs?.cols as ErdCol[] | undefined,
      fields: n.attrs?.fields as string[] | undefined,
      methods: n.attrs?.methods as string[] | undefined,
    };
    const inner = nodeHtml(n.shape, n.label, style, extra);
    return `<foreignObject x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}"><div xmlns="${XHTMLNS}" class="hn" style="width:100%;height:100%">${inner}</div></foreignObject>`;
  }).join("");

  return `<svg xmlns="${SVGNS}" class="lk-root" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">`
    + `<defs><marker id="da-arrow" markerWidth="11" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="userSpaceOnUse">`
    + `<path d="M0 0 L11 4 L0 8 z" fill="${EDGE_STROKE}"/></marker></defs>`
    + (css ? `<style>${css}</style>` : "")
    + (bg && bg !== "transparent" ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>` : "")
    + edgeSvg + nodeSvg
    + `</svg>`;
}
