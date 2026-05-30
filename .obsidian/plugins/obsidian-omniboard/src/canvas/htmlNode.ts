import { Graph } from "@antv/x6";
import { makePorts } from "./shapes/ports";

const XHTML = "http://www.w3.org/1999/xhtml";

let registered = false;
/** One generic X6 node whose body is an HTML foreignObject (design DOM + CSS). */
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
      hit: { refWidth: "100%", refHeight: "100%", fill: "transparent", stroke: "none" },
      fo: { refWidth: "100%", refHeight: "100%" },
      content: { html: "", class: "hn" },
    },
    ports: makePorts(),
  }, true);
}

const esc = (s: string) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
// Convert newlines in an already-escaped string into <br> so multi-line labels render.
const nl = (s: string) => s.replace(/\n/g, "<br>");

export interface NodeStyle {
  fill?: string; stroke?: string; fontSize?: number;
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean;
  color?: string; align?: "left" | "center" | "right";
  borderWidth?: number; borderDash?: "solid" | "dashed" | "dotted";
}

/** One row of an ERD entity table. */
export interface ErdCol { k: "" | "PK" | "FK"; name: string; type: string; }
/** Editable per-node payload for data-driven shapes (ERD/UML). */
export interface NodeExtra {
  cols?: ErdCol[]; fields?: string[]; methods?: string[]; who?: string;
  labelOffset?: { x: number; y: number };
  lanes?: Array<{ id: string; label: string }>;  // BPMN pool lanes (top→bottom)
}

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
  if (ov.fill) p.push(`background:${ov.fill}`);
  if (ov.stroke) p.push(`border-color:${ov.stroke}`);
  if (ov.fontSize) p.push(`font-size:${ov.fontSize}px`);
  if (ov.bold) p.push("font-weight:700");
  if (ov.italic) p.push("font-style:italic");
  const deco = [ov.underline ? "underline" : "", ov.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) p.push(`text-decoration:${deco}`);
  if (ov.color) p.push(`color:${ov.color}`);
  if (ov.align) p.push(`text-align:${ov.align}`);
  if (ov.borderWidth) p.push(`border-width:${ov.borderWidth}px`);
  if (ov.borderDash && ov.borderDash !== "solid") p.push(`border-style:${ov.borderDash}`);
  return p.join(";");
}
// Inject/merge an inline style onto the template's root element
function withStyle(html: string, sty: string): string {
  if (!sty) return html;
  const existing = html.match(/^(\s*<[a-z][\w-]*\b[^>]*?)\sstyle="([^"]*)"([^>]*>)/i);
  if (existing) return html.replace(existing[0], `${existing[1]} style="${existing[2]};${sty}"${existing[3]}`);
  return html.replace(/^(\s*<[a-z][\w-]*\b[^>]*?)(>)/i, `$1 style="${sty}"$2`);
}
const svg = (inner: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const KEY = svg(`<circle cx="8" cy="15" r="4"/><path d="m10.5 12.5 7-7M16 5l3 3"/>`);
const BP_ICON: Record<string, string> = {
  msg: svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>`),
  gear: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/>`),
  user: svg(`<circle cx="12" cy="8" r="3"/><path d="M6 20a6 6 0 0 1 12 0"/>`),
  clock: svg(`<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>`),
  script: svg(`<path d="M7 3h8l3 3v15H7z"/><path d="M10 9h5M10 13h5M10 17h3"/>`),
  hand: svg(`<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10.5V5.5a1.5 1.5 0 0 1 3 0V11M13 11V6.5a1.5 1.5 0 0 1 3 0V13a5 5 0 0 1-5 5h-1a4 4 0 0 1-3.5-2L7 13"/>`),
  rule: svg(`<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M10 5v14"/>`),
  send: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v14H3z"/><path d="m3 6 9 6 9-6" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`,
  page: svg(`<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/>`),
  cyl: svg(`<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/>`),
};
const ACTOR = svg(`<circle cx="12" cy="6" r="3"/><path d="M12 9v7M7 12h10M12 16l-4 5M12 16l4 5"/>`);

/** Returns the design HTML for a given shape kind + label, with optional style overrides. */
export function nodeHtml(kind: string, label: string, ov?: NodeStyle, extra?: NodeExtra): string {
  return withStyle(nodeHtmlBase(kind, label, extra), styleStr(ov));
}

// ── Data-driven renderers ──
function erdHtml(label: string, cols: ErdCol[]): string {
  const rows = cols.map((c, i) =>
    `<div class="erd-col" data-col-idx="${i}"><span class="kk ${c.k.toLowerCase()}">${esc(c.k)}</span><span class="cname">${esc(c.name)}</span><span class="ctype">${esc(c.type)}</span></div>`
  ).join("");
  return `<div class="erd-table"><div class="erd-th">${KEY}${esc(label) || "Table"}</div>${rows}</div>`;
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
    case "erd-entity": return erdHtml(label, extra?.cols ?? defaultErdCols());
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
    case "sq-actor": return `<div class="sq-life"><div class="sq-actor-head"><div class="sq-actor-fig">${ACTOR}</div><div class="sq-actor-lbl">${L || "Actor"}</div></div><div class="sq-line"></div></div>`;
    case "sq-participant": {
      const who = extra?.who ?? "";
      return `<div class="sq-life"><div class="sq-head sq-pill">${L || "Participant"}${who ? `<span class="sq-who">${esc(who)}</span>` : ""}</div><div class="sq-line"></div></div>`;
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
    // Events (start green / intermediate amber-double / end red); optional trigger icon
    case "bpmn-start": return bpEvent("start", L, undefined, extra);
    case "bpmn-start-message": return bpEvent("start", L, BP_ICON.msg, extra);
    case "bpmn-start-timer": return bpEvent("start", L, BP_ICON.clock, extra);
    case "bpmn-intermediate": return bpEvent("inter", L, undefined, extra);
    case "bpmn-intermediate-message": return bpEvent("inter", L, BP_ICON.msg, extra);
    case "bpmn-intermediate-timer": return bpEvent("inter", L, BP_ICON.clock, extra);
    case "bpmn-end": return bpEvent("end", L, undefined, extra);
    case "bpmn-end-message": return bpEvent("end", L, BP_ICON.send, extra);
    case "bpmn-end-terminate": return bpEvent("end", L, `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="currentColor"/></svg>`, extra);
    // Gateways
    case "bpmn-gateway-x": return bpGateway("✕", L, extra);
    case "bpmn-gateway-parallel": return bpGateway("+", L, extra);
    case "bpmn-gateway-inclusive": return bpGateway("○", L, extra);
    // Pentagon + 6-spoke asterisk: drawn as SVG so macOS/iOS don't render them as emoji.
    case "bpmn-gateway-event":
      return bpGateway(`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4 20 10 17 19 7 19 4 10Z"/></svg>`, L, extra);
    case "bpmn-gateway-complex":
      return bpGateway(`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v16M4 12h16M6 6l12 12M18 6 6 18"/></svg>`, L, extra);
    // Tasks
    case "bpmn-task": return bpTask(L);
    case "bpmn-task-user": return bpTask(L, "user");
    case "bpmn-task-service": return bpTask(L, "gear");
    case "bpmn-task-script": return bpTask(L, "script");
    case "bpmn-task-manual": return bpTask(L, "hand");
    case "bpmn-task-send": return bpTask(L, "send");
    case "bpmn-task-receive": return bpTask(L, "msg");
    case "bpmn-task-rule": return bpTask(L, "rule");
    case "bpmn-subprocess": return `<div class="bp-frame bp-sub"><span class="bp-frame-lbl">${L || "Sub-process"}</span><span class="bp-plus">+</span></div>`;
    // Data
    case "bpmn-data-object": return `<div class="bp-dataobj"><span class="ic">${BP_ICON.page}</span><span class="lbl">${L}</span></div>`;
    case "bpmn-data-store": return `<div class="bp-datastore"><span class="ic">${BP_ICON.cyl}</span><span class="lbl">${L}</span></div>`;
    case "bpmn-annotation": return `<div class="bp-anno">${L || "Annotation"}</div>`;
    case "bpmn-lane": return `<div class="bp-lane"><span>${L}</span></div>`;
    case "bpmn-pool": return bpPool(L, extra);

    default: return `<div class="fc rect">${L}</div>`;
  }
}

const SQ_BOUNDARY = svg(`<circle cx="14" cy="9" r="5"/><path d="M5 4v10M5 9h4"/>`);
const SQ_CONTROL = svg(`<circle cx="12" cy="10" r="5"/><path d="M12 5l-2.5 1.5L12 7"/>`);
const SQ_ENTITY = svg(`<circle cx="12" cy="8" r="5"/><path d="M7 15h10"/>`);

/** Lifeline (actor-like) with a custom head icon + dashed line below. */
function seqLife(icon: string, label: string): string {
  return `<div class="sq-life"><div class="sq-actor-head"><div class="sq-actor-fig">${icon}</div><div class="sq-actor-lbl">${esc(label)}</div></div><div class="sq-line"></div></div>`;
}
/** Combined fragment frame (alt/opt/loop/par) with a label tab + optional divider. */
function seqFrag(tag: string, label: string, divider: boolean): string {
  return `<div class="sq-frag"><span class="sq-frag-tab">${esc(tag)}</span>${label ? `<span class="sq-frag-cond">[${esc(label)}]</span>` : ""}${divider ? `<div class="sq-frag-div"></div>` : ""}</div>`;
}
function lblStyle(extra?: NodeExtra): string {
  const o = extra?.labelOffset; if (!o) return "";
  return ` style="transform:translate(${o.x}px,${o.y}px)"`;
}
function bpEvent(kind: string, label: string, icon?: string, extra?: NodeExtra): string {
  const inner = icon ?? (kind === "inter" ? "" : svg(`<circle cx="12" cy="12" r="8"/>`));
  return `<div class="bp-event ${kind}" style="position:relative">${inner}<div class="bp-elabel"${lblStyle(extra)}>${esc(label)}</div></div>`;
}
function bpTask(label: string, iconKey?: string): string {
  const icon = iconKey && BP_ICON[iconKey] ? `<span class="ticon">${BP_ICON[iconKey]}</span>` : "";
  return `<div class="bp-task">${icon}${esc(label)}</div>`;
}
function bpGateway(mark: string, label: string, extra?: NodeExtra): string {
  return `<div class="bp-gw"><div class="gwbox"><span class="x">${mark}</span></div>${label ? `<div class="bp-elabel"${lblStyle(extra)}>${esc(label)}</div>` : ""}</div>`;
}
/** BPMN Pool with N lanes (composite). Default: 1 lane "Lane 1" when extra.lanes empty. */
function bpPool(label: string, extra?: NodeExtra): string {
  const lanes = extra?.lanes?.length ? extra.lanes : [{ id: "l1", label: "Lane 1" }];
  const laneHtml = lanes.map((ln) => `<div class="bp-pool-lane" data-lane-id="${esc(ln.id)}"><div class="bp-pool-lane-head">${esc(ln.label)}</div><div class="bp-pool-lane-body"></div></div>`).join("");
  return `<div class="bp-pool"><div class="bp-pool-head">${esc(label) || "Pool"}</div><div class="bp-pool-body">${laneHtml}</div></div>`;
}
