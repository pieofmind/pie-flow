import type { CanvasModel } from "../../canvas/types";

/**
 * Mermaid `sequenceDiagram` ⇄ CanvasModel (sq-* lifelines + message edges).
 *
 *   participant A as Khách      → sq-participant lifeline (id "A", label "Khách")
 *   actor B as Hệ thống         → sq-actor lifeline
 *   A->>B: Đặt hàng             → solid message edge (y = time)
 *   B-->>A: Xác nhận            → dashed/return message edge (ret = true)
 *
 * Messages carry an absolute `y` (the canvas uses it to slot the horizontal
 * message line on the lifelines) and `ret` (dashed reply).
 */

const PARTICIPANT_RE = /^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/;
const MESSAGE_RE = /^(\S+?)\s*(-{1,2}>>?|-{1,2}x)\s*(\S+?)\s*:\s*(.+)$/;

const LIFELINE_H_BASE = 120;
const MSG_STEP = 48;
const MSG_TOP = 88;
const COL_W = 130;
const COL_GAP = 70;

interface Lifeline {
  seqId: string;
  label: string;
  kind: "sq-participant" | "sq-actor";
}

export function parseSequenceToCanvas(source: string): CanvasModel {
  const lifelines: Lifeline[] = [];
  const order = new Map<string, number>(); // seqId → column index
  const messages: Array<{ from: string; to: string; arrow: string; label: string }> = [];

  const ensure = (seqId: string): void => {
    if (order.has(seqId)) return;
    order.set(seqId, lifelines.length);
    lifelines.push({ seqId, label: seqId, kind: "sq-participant" });
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || /^sequenceDiagram\b/.test(line) || /^title\b/.test(line) || line === "---") continue;
    const pm = line.match(PARTICIPANT_RE);
    if (pm) {
      const [, kw, id, label] = pm;
      ensure(id);
      const ll = lifelines[order.get(id)!];
      ll.label = (label ?? id).trim();
      ll.kind = kw === "actor" ? "sq-actor" : "sq-participant";
      continue;
    }
    const mm = line.match(MESSAGE_RE);
    if (mm) {
      const [, from, arrow, to, label] = mm;
      ensure(from);
      ensure(to);
      messages.push({ from, to, arrow, label: label.trim() });
    }
  }

  const lifelineH = LIFELINE_H_BASE + messages.length * MSG_STEP;
  const model: CanvasModel = { nodes: [], edges: [] };
  lifelines.forEach((ll, i) => {
    model.nodes.push({
      id: ll.seqId,
      shape: ll.kind,
      x: i * (COL_W + COL_GAP) + 20,
      y: 0,
      width: COL_W,
      height: lifelineH,
      label: ll.label,
      attrs: { seqId: ll.seqId },
    });
  });
  messages.forEach((m, i) => {
    const ret = m.arrow.startsWith("--");
    model.edges.push({
      id: `m${i}`,
      source: m.from,
      target: m.to,
      label: m.label,
      y: MSG_TOP + i * MSG_STEP,
      ret,
    });
  });
  return model;
}

export function serializeSequenceFromCanvas(model: CanvasModel): string {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const lifelines = model.nodes
    .filter((n) => n.shape === "sq-participant" || n.shape === "sq-actor")
    .sort((a, b) => a.x - b.x);

  const lines: string[] = ["sequenceDiagram"];
  for (const ll of lifelines) {
    const kw = ll.shape === "sq-actor" ? "actor" : "participant";
    const seqId = (ll.attrs?.seqId as string) ?? ll.id;
    lines.push(`  ${kw} ${seqId} as ${ll.label}`);
  }

  const seqIdOf = (id: string): string =>
    (byId.get(id)?.attrs?.seqId as string) ?? id;
  const msgs = model.edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  for (const e of msgs) {
    const arrow = e.ret ? "-->>" : "->>";
    lines.push(`  ${seqIdOf(e.source)}${arrow}${seqIdOf(e.target)}: ${e.label ?? ""}`);
  }
  return lines.join("\n");
}
