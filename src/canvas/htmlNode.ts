import { Graph } from "@antv/x6";
import { makePorts } from "./shapes/ports";
import { asStackLanes, laneWeights } from "./laneLayout";

const XHTML = "http://www.w3.org/1999/xhtml";

let registered = false;
/** One generic X6 node whose body is an HTML foreignObject (design DOM + CSS). */
/** Default label size for BPMN html nodes (task/event/gateway/annotation/data) — keep in sync with styles.css .bp-* rules. */
export const BPMN_DEFAULT_FONT_SIZE = 9;

export function registerHtmlNode(): void {
  if (registered) return;
  registered = true;
  Graph.registerNode("html-node", {
    markup: [
      { tagName: "rect", selector: "hit" },
      {
        tagName: "foreignObject", selector: "fo",
        children: [{ tagName: "div", ns: XHTML, selector: "content" }],
      },
    ],
    attrs: {
      // The transparent hit rect owns selection/edit pointer events only. Edges
      // connect through the 12 fixed ports supplied by makePorts().
      hit: { refWidth: "100%", refHeight: "100%", fill: "transparent", stroke: "none", pointerEvents: "all" },
      fo: { refWidth: "100%", refHeight: "100%" },
      content: { html: "", class: "hn" },
    },
    ports: makePorts(),
  }, true);
}

// Attribute-safe escape: also escapes quotes so values are safe inside HTML
// attributes (not just text nodes). Nodes are rendered via innerHTML, so any
// model-derived string that reaches an attribute must be quote-escaped.
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
// Strip characters that could break out of the style="" attribute (keeps
// parens so rgb()/hsl() colors still work; the only breakout char is a quote).
const cssSafe = (v: unknown) => String(v ?? "").replace(/["'<>\\]/g, "");
const px = (v: unknown) => Number(v) || 0;
// Convert newlines in an already-escaped string into <br> so multi-line labels render.
const nl = (s: string) => s.replace(/\n/g, "<br>");

export interface NodeStyle {
  fill?: string; stroke?: string; fontSize?: number;
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean;
  color?: string; align?: "left" | "center" | "right";
  borderWidth?: number; borderDash?: "solid" | "dashed" | "dotted";
}

/** A pool lane on the Board; `lanes` = child lanes (one level). */
export interface PoolLaneExtra { id: string; label: string; height?: number; width?: number; lanes?: PoolLaneExtra[] }

/** One row of an ERD entity table. */
export interface ErdCol { k: "" | "PK" | "FK"; name: string; type: string; }
/** Editable per-node payload for data-driven shapes (ERD/UML/BPMN). */
export interface NodeExtra {
  cols?: ErdCol[]; fields?: string[]; methods?: string[]; who?: string;
  /** ERD cluster header color (Story 2.1). 6-color palette cycling per TableGroup.
   *  Set by importDbml when DBML has `TableGroup` blocks. */
  headerColor?: string;
  labelOffset?: { x: number; y: number };
  /** BPMN pool lanes (top→bottom; left→right in a vertical pool). Own size
   *  optional — `height` (horizontal pool) / `width` (vertical) — absent = equal split. */
  lanes?: PoolLaneExtra[];
  poolHorizontal?: boolean;
  blackBox?: boolean;
  // ── BPMN 2.0 extras (Đợt A, 2026-06-01) ──
  /** Event trigger type (OMG): message, timer, signal, error, escalation, compensation,
   *  conditional, link, cancel, terminate, multiple, parallel-multiple. Empty = "none/plain". */
  trigger?: BpmnTrigger;
  /** Intermediate event only: true = throwing (filled icon), false/undefined = catching (outline). */
  throwing?: boolean;
  /** Event interrupting flag (for boundary + event-subprocess start events).
   *  Default true; false renders dashed border per OMG. */
  interrupting?: boolean;
  /** Boundary event: id of the activity this event is attached to. */
  attachedTo?: string;
  /** Side of an event its label goes (static render of boundary events; the
   *  live canvas toggles the same classes in refreshBpmnEventLabels). */
  labelSide?: "top" | "right" | "bottom" | "left";
  /** Activity markers stacked at the bottom of a task/sub-process (multi-select):
   *  "loop" | "mi-par" | "mi-seq" | "adhoc" | "compensation" | "subprocess". */
  markers?: BpmnMarker[];
  /** BPMN DI.isExpanded flag (Phase C). Sub-process / Transaction / Event-sub.
   *  true (default) → render frame with children in-place. false → render as a
   *  task-sized collapsed box with a [+] marker. Round-trips to BPMNShape.isExpanded. */
  collapsed?: boolean;
}

export type BpmnTrigger =
  | "message" | "timer" | "signal" | "error" | "escalation" | "compensation"
  | "conditional" | "link" | "cancel" | "terminate" | "multiple" | "parallel-multiple";
export type BpmnMarker =
  | "loop" | "mi-par" | "mi-seq" | "adhoc" | "compensation" | "subprocess";

export function defaultErdCols(): ErdCol[] {
  return [
    { k: "PK", name: "id", type: "int" },
    { k: "FK", name: "ref_id", type: "int" },
    { k: "", name: "name", type: "varchar" },
  ];
}
export function defaultUml(kind: string): NodeExtra {
  if (kind === "uml-interface") return { fields: [], methods: ["+ method(): void"] };
  return { fields: ["+ id: int", "+ name: string"], methods: ["+ method(): void"] };
}

function styleStr(ov?: NodeStyle): string {
  if (!ov) return "";
  const p: string[] = [];
  if (ov.fill) p.push(`background:${cssSafe(ov.fill)}`);
  if (ov.stroke) p.push(`border-color:${cssSafe(ov.stroke)}`);
  if (ov.fontSize) p.push(`font-size:${px(ov.fontSize)}px`);
  if (ov.bold) p.push("font-weight:700");
  if (ov.italic) p.push("font-style:italic");
  const deco = [ov.underline ? "underline" : "", ov.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) p.push(`text-decoration:${deco}`);
  if (ov.color) p.push(`color:${cssSafe(ov.color)}`);
  if (ov.align === "left" || ov.align === "center" || ov.align === "right") p.push(`text-align:${ov.align}`);
  if (ov.borderWidth) p.push(`border-width:${px(ov.borderWidth)}px`);
  if (ov.borderDash === "dashed" || ov.borderDash === "dotted") p.push(`border-style:${ov.borderDash}`);
  return p.join(";");
}
// Inject/merge an inline style onto the template's root element
function withStyle(html: string, sty: string): string {
  if (!sty) return html;
  const existing = html.match(/^(\s*<[a-z][\w-]*\b[^>]*?)\sstyle="([^"]*)"([^>]*>)/i);
  if (existing) return html.replace(existing[0], `${existing[1]} style="${existing[2]};${sty}"${existing[3]}`);
  return html.replace(/^(\s*<[a-z][\w-]*\b[^>]*?)(>)/i, `$1 style="${sty}"$2`);
}
const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const KEY = svg(`<circle cx="8" cy="15" r="4"/><path d="m10.5 12.5 7-7M16 5l3 3"/>`);
const BP_ICON: Record<string, string> = {
  msg: svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>`),
  gear: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/>`),
  user: svg(`<circle cx="12" cy="8" r="3"/><path d="M6 20a6 6 0 0 1 12 0"/>`),
  clock: svg(`<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>`),
  script: svg(`<path d="M7 3h8l3 3v15H7z"/><path d="M10 9h5M10 13h5M10 17h3"/>`),
  hand: svg(`<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10.5V5.5a1.5 1.5 0 0 1 3 0V11M13 11V6.5a1.5 1.5 0 0 1 3 0V13a5 5 0 0 1-5 5h-1a4 4 0 0 1-3.5-2L7 13"/>`),
  rule: svg(`<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M10 5v14"/>`),
  send: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v14H3z"/><path d="m3 6 9 6 9-6" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`,
  page: svg(`<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/>`),
  cyl: svg(`<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/>`),
};
const ACTOR = svg(`<circle cx="12" cy="6" r="3"/><path d="M12 9v7M7 12h10M12 16l-4 5M12 16l4 5"/>`);

// ── BPMN 2.0 event trigger icons (OMG-faithful, fits inside event circle, viewBox 0 0 24 24) ──
// Two variants per trigger: outline (catching/start) + filled (throwing/end).
// `bpEvent` picks the variant from `throwing` + the event position.
const TRIG_OUT: Record<string, string> = {
  message: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="7" width="14" height="10"/><path d="m5 8 7 5 7-5"/></svg>`,
  timer: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="7"/><path d="M12 7v5l3 2"/><path d="M12 5v1M12 18v1M5 12h1M18 12h1" stroke-width="1.2"/></svg>`,
  signal: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 5 21 19H3Z"/></svg>`,
  error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 18 10 8l3 6 3-4 4 10"/></svg>`,
  escalation: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 5 19 19 12 14 5 19Z"/></svg>`,
  compensation: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13 6 6 12 13 18ZM20 6 13 12 20 18Z"/></svg>`,
  conditional: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="14" height="14"/><path d="M7 9h10M7 12h10M7 15h6"/></svg>`,
  link: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12h11l-3-3M15 12l-3 3"/></svg>`,
  cancel: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  terminate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>`,
  multiple: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 4 20 10 17 19H7L4 10Z"/></svg>`,
  "parallel-multiple": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>`,
};
const TRIG_FILL: Record<string, string> = {
  message: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="7" width="14" height="10"/><path d="m5 8 7 5 7-5" fill="none" stroke="#fff" stroke-width="1.4"/></svg>`,
  signal: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5 21 19H3Z"/></svg>`,
  error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 18 10 8l3 6 3-4 4 10Z"/></svg>`,
  escalation: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5 19 19 12 14 5 19Z"/></svg>`,
  compensation: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13 6 6 12 13 18ZM20 6 13 12 20 18Z"/></svg>`,
  link: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 12h11l-3-3M15 12l-3 3" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M4 10h11v4H4z"/></svg>`,
  multiple: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4 20 10 17 19H7L4 10Z"/></svg>`,
  cancel: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 6 6 6-6 2 2-6 6 6 6-2 2-6-6-6 6-2-2 6-6-6-6Z"/></svg>`,
};
function trigIcon(trigger: BpmnTrigger | undefined, filled: boolean): string {
  if (!trigger) return "";
  const t = trigger;
  // terminate is always filled; parallel-multiple, timer, conditional have no filled variant
  if (t === "terminate") return TRIG_OUT.terminate;
  if (filled && TRIG_FILL[t]) return TRIG_FILL[t];
  return TRIG_OUT[t] ?? "";
}

// ── Activity marker icons (rendered at the bottom of a task/sub-process) ──
const MARKER_ICON: Record<BpmnMarker, string> = {
  loop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 9a4 4 0 1 0 1-3M5 5V3M5 5H3"/></svg>`,
  "mi-par": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="2.4" height="10"/><rect x="6.8" y="3" width="2.4" height="10"/><rect x="10.6" y="3" width="2.4" height="10"/></svg>`,
  "mi-seq": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="2.4"/><rect x="3" y="6.8" width="10" height="2.4"/><rect x="3" y="10.6" width="10" height="2.4"/></svg>`,
  adhoc: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 10c2-4 4-4 6 0s4 4 6 0"/></svg>`,
  compensation: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M9 3 3 8l6 5ZM15 3 9 8l6 5Z"/></svg>`,
  subprocess: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="10" height="10"/><path d="M8 5.5v5M5.5 8h5"/></svg>`,
};
function renderMarkers(markers?: BpmnMarker[]): string {
  if (!markers || markers.length === 0) return "";
  // The ⊞ marker is a marker only (bpmn-js); "Mở rộng tại chỗ" / "Mở trang riêng" open it.
  const items = markers.map((m) => !MARKER_ICON[m] ? ""
    : `<span class="bp-mk-ic">${MARKER_ICON[m]}</span>`).join("");
  return items ? `<div class="bp-markers">${items}</div>` : "";
}

/** Returns the design HTML for a given shape kind + label, with optional style overrides. */
export function nodeHtml(kind: string, label: string, ov?: NodeStyle, extra?: NodeExtra): string {
  return withStyle(nodeHtmlBase(kind, label, extra), styleStr(ov));
}

// ── Data-driven renderers ──
function erdHtml(label: string, cols: ErdCol[], headerColor?: string): string {
  const rows = cols.map((c, i) => {
    // Whitelist the key marker so it can never inject into the class attribute.
    const k = c.k === "PK" || c.k === "FK" ? c.k : "";
    return `<div class="erd-col" data-col-idx="${i}" data-col-name="${esc(c.name)}"><span class="kk ${k.toLowerCase()}">${k}</span><span class="cname">${esc(c.name)}</span><span class="ctype">${esc(c.type)}</span></div>`;
  }).join("");
  const headerStyle = headerColor ? ` style="background:${cssSafe(headerColor)}"` : "";
  return `<div class="erd-table"><div class="erd-th"${headerStyle}>${KEY}${esc(label) || "Table"}</div>${rows}</div>`;
}
function umlLine(s: string, comp: string, idx: number): string {
  const m = String(s).match(/^\s*([+\-#~])\s*(.*)$/);
  return m
    ? `<div class="ln" data-line-comp="${comp}" data-line-idx="${idx}"><span class="vis">${esc(m[1])}</span>${esc(m[2])}</div>`
    : `<div class="ln" data-line-comp="${comp}" data-line-idx="${idx}">${esc(s)}</div>`;
}
function umlComp(lines: string[], comp: string): string {
  return `<div class="uml-comp">${lines.map((s, i) => umlLine(s, comp, i)).join("")}</div>`;
}
function umlHtml(label: string, fields: string[], methods: string[], stereo?: string): string {
  const name = `<div class="uml-name">${stereo ? `<span class="stereo">${stereo}</span>` : ""}${esc(label) || "ClassName"}</div>`;
  const comps = stereo
    ? umlComp(methods, "methods")
    : (fields.length ? umlComp(fields, "fields") : "") + (methods.length ? umlComp(methods, "methods") : "");
  return `<div class="uml">${name}${comps}</div>`;
}

function nodeHtmlBase(kind: string, label: string, extra?: NodeExtra): string {
  const L = esc(label);
  switch (kind) {
    // ── Basic ──
    case "bs-rect": return `<div class="fc rect">${L}</div>`;
    case "bs-rounded": return `<div class="fc proc">${L}</div>`;
    case "bs-ellipse": return `<div class="fc round">${L}</div>`;
    case "bs-diamond": return `<div class="fc diamond">${L}</div>`;
    case "bs-text": return `<div style="width:100%;height:100%;display:grid;place-items:center;font-size:14px;color:var(--pg-text)">${L}</div>`;
    case "bs-sticky": return `<div class="fc rect" style="background:#fff3bf;border-color:#f0c000">${L}</div>`;

    // ── Flowchart ──
    case "fc-start": case "fc-end": return `<div class="fc term">${L}</div>`;
    case "fc-process": return `<div class="fc proc">${L}</div>`;
    case "fc-io": return `<div class="fc para">${L}</div>`;
    case "fc-decision": return `<div class="fc diamond">${L}</div>`;
    case "fc-document": return `<div class="fc doc">${L}</div>`;
    case "fc-database": return `<div class="fc-db">${L}</div>`;
    case "fc-predefined": return `<div class="fc proc pred">${L}</div>`;
    case "fc-preparation": return `<div class="fc hex">${L}</div>`;
    case "fc-manual-input": return `<div class="fc maninput">${L}</div>`;
    case "fc-manual-op": return `<div class="fc manop">${L}</div>`;
    case "fc-offpage": return `<div class="fc offpage">${L}</div>`;
    case "fc-delay": return `<div class="fc delay">${L}</div>`;
    case "fc-display": return `<div class="fc display">${L}</div>`;
    case "fc-connector": return `<div class="fc round" style="font-size:11px">${L}</div>`;

    // ── ERD ──
    case "erd-entity": return erdHtml(label, extra?.cols ?? defaultErdCols(), extra?.headerColor);
    case "erd-relationship": return `<div class="fc diamond">${L}</div>`;
    case "erd-attribute": return `<div class="fc round">${L}</div>`;
    case "erd-key": return `<div class="fc round" style="text-decoration:underline;font-weight:700">${L}</div>`;

    // ── UML ──
    case "uml-class": {
      const u = extra?.fields || extra?.methods ? extra : defaultUml(kind);
      return umlHtml(label, u.fields ?? [], u.methods ?? []);
    }
    case "uml-interface": {
      const u = extra?.fields || extra?.methods ? extra : defaultUml(kind);
      return umlHtml(label || "Interface", u.fields ?? [], u.methods ?? [], "«interface»");
    }
    case "uml-actor": return `<div style="width:100%;height:100%;display:grid;place-items:center;color:var(--pg-text);position:relative">
      <div style="width:34px;height:46px;color:var(--pg-accent)">${ACTOR}</div>
      <div style="position:absolute;top:calc(100% + 2px);left:50%;transform:translateX(-50%);font-size:11px;font-weight:600;white-space:nowrap">${L}</div></div>`;
    case "uml-usecase": return `<div class="fc round" style="background:#e3f2fd;border-color:#0d47a1">${L}</div>`;

    // ── State ──
    case "st-initial": return `<div class="st-dot"></div>`;
    case "st-final": return `<div class="st-final"></div>`;
    case "st-state": return `<div class="st">${L}</div>`;
    case "st-choice": return `<div class="fc diamond" style="font-size:11px">${L}</div>`;

    // ── Mindmap ── Hierarchical pills (l0 root accent, l1 branch with color stripe, l2 leaf)
    case "mm-root":   return `<div class="mm l0">${nl(L) || "Trung tâm"}</div>`;
    case "mm-branch": return `<div class="mm l1">${nl(L) || "Nhánh"}</div>`;
    case "mm-leaf":   return `<div class="mm l2">${nl(L) || "Lá"}</div>`;

    // ── Sequence ── (Claude Pie design tokens)
    // Actor/Participant: compact pill on top + dashed lifeline below
    // Optional `extra.who` renders the subtitle ("actor" / "KALIX" / "ERP" …)
    case "sq-actor": return `<div class="sq-life"><div class="sq-actor-head"><div class="sq-actor-fig">${ACTOR}</div><div class="sq-actor-lbl">${L || "Actor"}</div></div>${SQ_LINE}</div>`;
    case "sq-participant": {
      const who = extra?.who ?? "";
      return `<div class="sq-life"><div class="sq-head sq-pill">${L || "Participant"}${who ? `<span class="sq-who">${esc(who)}</span>` : ""}</div>${SQ_LINE}</div>`;
    }
    case "sq-activation": return `<div class="sq-act"></div>`;
    case "sq-note": return `<div class="sq-note">${L || "Ghi chú"}</div>`;
    case "sq-boundary": return seqLife(SQ_BOUNDARY, L || "Boundary");
    case "sq-control": return seqLife(SQ_CONTROL, L || "Control");
    case "sq-entity": return seqLife(SQ_ENTITY, L || "Entity");
    case "sq-destroy": return `<div class="sq-destroy">✕</div>`;
    case "sq-frag-alt": return seqFrag("alt", L, true);
    case "sq-frag-opt": return seqFrag("opt", L, false);
    case "sq-frag-loop": return seqFrag("loop", L, false);
    case "sq-frag-par": return seqFrag("par", L, true);

    // ── BPMN (bpmn.io look, warm) ──
    // Events — unified kinds (Đợt A, 2026-06-01). Trigger + throwing + interrupting come from `extra`.
    case "bpmn-event-start": return bpEvent("start", L, undefined, extra);
    case "bpmn-event-intermediate": return bpEvent("inter", L, undefined, extra);
    case "bpmn-event-end": return bpEvent("end", L, undefined, extra);
    // Legacy event kinds (pre-Đợt-A) — kept for back-compat when a board file
    // skips the migration shim in OmniboardCanvas.loadModel for any reason.
    // Render path matches the unified output so visuals stay identical.
    case "bpmn-start": return bpEvent("start", L, undefined, extra);
    case "bpmn-start-message": return bpEvent("start", L, undefined, { ...extra, trigger: "message" });
    case "bpmn-start-timer": return bpEvent("start", L, undefined, { ...extra, trigger: "timer" });
    case "bpmn-intermediate": return bpEvent("inter", L, undefined, extra);
    case "bpmn-intermediate-message": return bpEvent("inter", L, undefined, { ...extra, trigger: "message" });
    case "bpmn-intermediate-timer": return bpEvent("inter", L, undefined, { ...extra, trigger: "timer" });
    case "bpmn-end": return bpEvent("end", L, undefined, extra);
    case "bpmn-end-message": return bpEvent("end", L, undefined, { ...extra, trigger: "message", throwing: true });
    case "bpmn-end-terminate": return bpEvent("end", L, undefined, { ...extra, trigger: "terminate" });
    // Gateways
    case "bpmn-gateway-x": return bpGateway("✕", L, extra);
    case "bpmn-gateway-parallel": return bpGateway("+", L, extra);
    case "bpmn-gateway-inclusive": return bpGateway("○", L, extra);
    // Pentagon + 6-spoke asterisk: drawn as SVG so macOS/iOS don't render them as emoji.
    case "bpmn-gateway-event":
      return bpGateway(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4 20 10 17 19 7 19 4 10Z"/></svg>`, L, extra);
    case "bpmn-gateway-complex":
      return bpGateway(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v16M4 12h16M6 6l12 12M18 6 6 18"/></svg>`, L, extra);
    // Tasks (extra.markers renders the marker row at the bottom)
    case "bpmn-task": return bpTask(L, undefined, extra);
    case "bpmn-task-user": return bpTask(L, "user", extra);
    case "bpmn-task-service": return bpTask(L, "gear", extra);
    case "bpmn-task-script": return bpTask(L, "script", extra);
    case "bpmn-task-manual": return bpTask(L, "hand", extra);
    case "bpmn-task-send": return bpTask(L, "send", extra);
    case "bpmn-task-receive": return bpTask(L, "msg", extra);
    case "bpmn-task-rule": return bpTask(L, "rule", extra);
    // Sub-process & sibling Activity types (Đợt A — Transaction / Event-Sub / Call)
    case "bpmn-subprocess": return bpSub("", L || "Sub-process", extra);
    case "bpmn-transaction": return bpSub(" is-transaction", L || "Transaction", extra);
    case "bpmn-event-subprocess": return bpSub(" is-event-sub", L || "Event sub-process", extra);
    case "bpmn-adhoc-subprocess": return bpSub(" is-adhoc", L || "Ad-hoc sub-process", extra, `<span class="bp-adhoc-mark">∼</span>`);
    case "bpmn-call-activity": return `<div class="bp-task is-call">${nl(L) || "Call activity"}${renderMarkers(extra?.markers)}</div>`;
    // Data artifacts (Đợt A — Collection/Input/Output)
    case "bpmn-data-object": return bpData("", dataShape(kind, "9 5 13 22"), L, extra);
    case "bpmn-data-collection": return bpData(" is-collection", dataShape(kind, "9 5 13 22"), L, extra);
    case "bpmn-data-input": return bpData(" is-input", dataShape(kind, "9 5 13 22"), L || "Input", extra);
    case "bpmn-data-output": return bpData(" is-output", dataShape(kind, "9 5 13 22"), L || "Output", extra);
    case "bpmn-data-store": return bpData("", dataShape(kind, "7 6 18 20"), L, extra, "bp-datastore");
    case "bpmn-annotation": return `<div class="bp-anno">${L || "Annotation"}</div>`;
    case "bpmn-group": return `<div class="bp-group">${L ? `<span class="bp-group-lbl">${L}</span>` : ""}</div>`;
    case "bpmn-lane": return `<div class="bp-lane"><span>${L}</span></div>`;
    case "bpmn-pool": return bpPool(L, extra);

    default: return `<div class="fc rect">${L}</div>`;
  }
}

// Lifeline drawn as an inline SVG line (NOT a flex div) — Safari's flex algorithm
// treats the column parent's %-height as indefinite and collapses a flex:1 line to 0.
// An absolute-inset SVG with a y2="100%" line has no flex/%-height dependency.
const SQ_LINE = `<svg class="sq-line" preserveAspectRatio="none"><line x1="50%" y1="0" x2="50%" y2="100%"></line></svg>`;
const SQ_BOUNDARY = svg(`<circle cx="14" cy="9" r="5"/><path d="M5 4v10M5 9h4"/>`);
const SQ_CONTROL = svg(`<circle cx="12" cy="10" r="5"/><path d="M12 5l-2.5 1.5L12 7"/>`);
const SQ_ENTITY = svg(`<circle cx="12" cy="8" r="5"/><path d="M7 15h10"/>`);

/** Lifeline (actor-like) with a custom head icon + dashed line below. */
function seqLife(icon: string, label: string): string {
  return `<div class="sq-life"><div class="sq-actor-head"><div class="sq-actor-fig">${icon}</div><div class="sq-actor-lbl">${esc(label)}</div></div>${SQ_LINE}</div>`;
}
/** Combined fragment frame (alt/opt/loop/par) with a label tab + optional divider. */
function seqFrag(tag: string, label: string, divider: boolean): string {
  return `<div class="sq-frag"><span class="sq-frag-tab">${esc(tag)}</span>${label ? `<span class="sq-frag-cond">[${esc(label)}]</span>` : ""}${divider ? `<div class="sq-frag-div"></div>` : ""}</div>`;
}
function lblStyle(extra?: NodeExtra): string {
  const o = extra?.labelOffset; if (!o) return "";
  // margin (not transform) so a dragged label offset doesn't become a WebKit
  // compositing layer that paints at the SVG origin on iOS.
  return ` style="margin:${px(o.y)}px 0 0 ${px(o.x)}px"`;
}
// NOTE: bpEvent/bpTask/bpGateway receive `label` ALREADY escaped by
// nodeHtmlBase (it computes `L = esc(label)` and passes that as `label`).
// Don't re-escape here or characters like `<`/`>` get double-encoded
// (e.g. imported BPMN with `(<50%)` would render as literal `&lt;50%`).
// We do still convert `\n` → `<br>` so multi-line labels render on the task
// surface (CSS `place-items: center` collapses raw newlines).
function bpEvent(kind: string, label: string, icon?: string, extra?: NodeExtra): string {
  // Trigger from extra (Đợt A unified path) takes precedence over the legacy
  // hard-coded `icon` argument used by `bpmn-start-message` etc.
  const pos = kind; // "start" | "inter" | "end"
  const filledByPos = pos === "end" || extra?.throwing === true;
  const trigIc = extra?.trigger ? trigIcon(extra.trigger, filledByPos) : null;
  const inner = trigIc ?? icon ?? (pos === "inter" ? "" : svg(`<circle cx="12" cy="12" r="8"/>`));
  const interrupt = extra?.interrupting === false ? " is-non-interrupting" : "";
  const lblSide = extra?.labelSide && extra.labelSide !== "bottom" ? ` label-${extra.labelSide}` : "";
  return `<div class="bp-event ${kind}${lblSide}${interrupt}" style="position:relative">${inner}<div class="bp-elabel"${lblStyle(extra)}>${nl(label)}</div></div>`;
}
// Data object / store: the palette's icon, cropped to the shape so it fills
// the node box (like bpmn-js, node box = shape) and ports / arrows meet it;
// colours come from the theme tokens (styles.css). The label is external,
// below it (draggable, auto-flips up like event labels).
const PAGE = `<path d="M9 5h8l5 5v17H9z" fill="#fff" stroke="#607d8b" stroke-width="2"/>`;
const FOLD = `<path d="M17 5v5h5" fill="none" stroke="#607d8b" stroke-width="2"/>`;
const ARROW = `<path d="M11 9 16 9 16 7 20 10 16 13 16 11 11 11Z"`;
/** Shared with the shape palette (shapes/index.ts) — one drawing for both. */
export const DATA_ICON: Record<string, string> = {
  "bpmn-data-object": PAGE + FOLD,
  "bpmn-data-collection": PAGE + FOLD + `<path d="M12 23v3M16 23v3M20 23v3" stroke="#607d8b" stroke-width="1.4"/>`,
  "bpmn-data-input": PAGE + `${ARROW} fill="none" stroke="#607d8b" stroke-width="1.3"/>`,
  "bpmn-data-output": PAGE + `${ARROW} fill="#607d8b"/>`,
  // Body first, filled, so the lid sits on top of it.
  "bpmn-data-store": `<path d="M7 9v14c0 1.6 4 3 9 3s9-1.4 9-3V9" fill="#fff" stroke="#607d8b" stroke-width="2"/><ellipse cx="16" cy="9" rx="9" ry="3" fill="#fff" stroke="#607d8b" stroke-width="2"/>`,
};
const dataShape = (shape: string, viewBox: string) =>
  `<svg class="bp-data-shape" viewBox="${viewBox}" preserveAspectRatio="none">${DATA_ICON[shape]}</svg>`;
function bpData(mod: string, shape: string, label: string, extra?: NodeExtra, cls = "bp-dataobj"): string {
  const lbl = label ? `<div class="bp-elabel"${lblStyle(extra)}>${nl(label)}</div>` : "";
  return `<div class="${cls}${mod}">${shape}${lbl}</div>`;
}
/** Sub-process, as bpmn-js draws it: expanded = a frame around its steps;
 *  collapsed = task-sized with the ⊞ marker plus the drill-down button on its
 *  bottom-right corner (`data-sub-drill` opens its steps on their own page). */
function bpSub(mod: string, label: string, extra?: NodeExtra, tail = ""): string {
  if (extra?.collapsed !== true) return `<div class="bp-frame bp-sub${mod}"><span class="bp-frame-lbl">${label}</span>${renderMarkers(extra?.markers)}${tail}</div>`;
  const plus = `<span class="bp-plus">+</span>`;
  const drill = `<button type="button" class="bp-drill" data-sub-drill title="Mở trang riêng"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.81 1.5h6.38L8 6.43 4.81 1.5Zm0 6.6h6.38L8 13.03 4.81 8.1Z"/></svg></button>`;
  return `<div class="bp-task bp-sub-closed${mod}">${nl(label)}${plus}${drill}${renderMarkers(extra?.markers)}${tail}</div>`;
}
function bpTask(label: string, iconKey?: string, extra?: NodeExtra): string {
  const icon = iconKey && BP_ICON[iconKey] ? `<span class="ticon">${BP_ICON[iconKey]}</span>` : "";
  return `<div class="bp-task">${icon}${nl(label)}${renderMarkers(extra?.markers)}</div>`;
}
function bpGateway(mark: string, label: string, extra?: NodeExtra): string {
  return `<div class="bp-gw"><div class="gwbox"><span class="x">${mark}</span></div>${label ? `<div class="bp-elabel"${lblStyle(extra)}>${nl(label)}</div>` : ""}</div>`;
}
/** BPMN Pool with N lanes (composite). Default: 1 lane "Lane 1" when extra.lanes empty. */
function bpPool(label: string, extra?: NodeExtra): string {
  if (extra?.blackBox) {
    const orient = extra.poolHorizontal === false ? " is-vertical" : "";
    return `<div class="bp-pool is-blackbox${orient}"><div class="bp-pool-head">${esc(label) || "Pool"}</div><div class="bp-pool-blackbox-body"><span>Black-box participant</span></div></div>`;
  }
  const lanes = extra?.lanes?.length ? extra.lanes : [{ id: "l1", label: "Lane 1" }];
  const orient = extra?.poolHorizontal === false ? " is-vertical" : "";
  // Own height → flex weight, so lanes stay proportional when the pool is resized
  // (same rule as laneHeights()). Divider handle between lanes = drag to resize.
  // A vertical pool lines its lanes up as columns, sized by `width`.
  const horizontal = extra?.poolHorizontal !== false;
  // Lanes (and a lane's child lanes inside it, at any depth): own size → flex
  // weight. Dividers between siblings: data-lane-idx="i" (top level) or
  // data-lane-path="i/j/k" (the k-th divider among the children of lane i/j).
  const laneList = (list: PoolLaneExtra[], path: number[] = []): string => {
    const weights = laneWeights(asStackLanes(list, horizontal));
    return list.map((ln, i) => {
      const flex = weights ? ` style="flex: ${weights[i]} 1 0px"` : "";
      const at = path.length ? `data-lane-path="${[...path, i].join("/")}"` : `data-lane-idx="${i}"`;
      const divider = i < list.length - 1 ? `<div class="bp-pool-lane-divider" ${at}></div>` : "";
      const body = ln.lanes?.length
        ? `<div class="bp-pool-sublanes">${laneList(ln.lanes, [...path, i])}</div>`
        : `<div class="bp-pool-lane-body"></div>`;
      const cls = path.length ? "bp-pool-lane is-child" : "bp-pool-lane";
      return `<div class="${cls}" data-lane-id="${esc(ln.id)}"${flex}><div class="bp-pool-lane-head">${esc(ln.label)}</div>${body}${divider}</div>`;
    }).join("");
  };
  const laneHtml = laneList(lanes);
  return `<div class="bp-pool${orient}"><div class="bp-pool-head">${esc(label) || "Pool"}</div><div class="bp-pool-body">${laneHtml}</div></div>`;
}
