import type { CanvasModel } from "../../canvas/types";
import type { BpmnIssue } from "./validator";

type N = CanvasModel["nodes"][number];
type E = CanvasModel["edges"][number];
type Mk = (severity: BpmnIssue["severity"], code: string, message: string, targetType: "node" | "edge", targetId: string) => void;

const isSequence = (e: E) => (e.kind ?? "sequence") === "sequence";
const isGateway = (n: N) => n.shape.startsWith("bpmn-gateway");
const isTask = (n: N) => n.shape.startsWith("bpmn-task");
const isEvent = (n: N) => n.shape.startsWith("bpmn-event-") && n.shape !== "bpmn-event-subprocess";
const SUBS = new Set(["bpmn-subprocess", "bpmn-transaction", "bpmn-adhoc-subprocess"]);
const isFlowNode = (n: N) => isTask(n) || isEvent(n) || isGateway(n) || SUBS.has(n.shape) || n.shape === "bpmn-call-activity";

const poolOf = (n: N): string => {
  const own = (n.attrs?.__source as { poolId?: string } | undefined)?.poolId ?? n.attrs?.poolId;
  return typeof own === "string" ? own : "";
};
const attr = (n: N, k: string) => (n.attrs as Record<string, unknown> | undefined)?.[k];

function adjacency(edges: E[]): { out: Map<string, string[]>; inn: Map<string, string[]> } {
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const e of edges.filter(isSequence)) {
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    inn.set(e.target, [...(inn.get(e.target) ?? []), e.source]);
  }
  return { out, inn };
}

/** A flow node no start event (or other entry point) of its own scope leads to. */
function unreachable(model: CanvasModel, mk: Mk, out: Map<string, string[]>): void {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const messageTargets = new Set(model.edges.filter((e) => e.kind === "message").map((e) => e.target));
  const scopeOf = (n: N) => `${n.parentId ?? ""}|${poolOf(n)}`;
  const scoped = model.nodes.filter((n) => isFlowNode(n) && byId.get(n.parentId ?? "")?.shape !== "bpmn-adhoc-subprocess");
  const isRoot = (n: N) =>
    n.shape === "bpmn-event-start" || !!attr(n, "attachedTo") || attr(n, "trigger") === "link"
    || messageTargets.has(n.id) || (attr(n, "markers") as string[] | undefined)?.includes("compensation") === true;
  const reached = new Set<string>();
  const queue = scoped.filter(isRoot).map((n) => n.id);
  const scopesWithRoot = new Set(queue.map((id) => scopeOf(byId.get(id)!)));
  while (queue.length) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    queue.push(...(out.get(id) ?? []));
  }
  for (const n of scoped) {
    if (!reached.has(n.id) && scopesWithRoot.has(scopeOf(n))) {
      mk("warn", "UNREACHABLE_NODE", "No start event leads to this element.", "node", n.id);
    }
  }
}

const GW_KIND = (n: N) => (n.shape === "bpmn-gateway-parallel" ? "and" : n.shape === "bpmn-gateway-x" ? "xor" : "");

/** First join each branch of a split reaches (nested split/join pairs skipped). */
function joinsOf(split: string, byId: Map<string, N>, out: Map<string, string[]>, inn: Map<string, string[]>): Set<string | null> {
  const found = new Set<string | null>();
  for (const first of out.get(split) ?? []) {
    let hit: string | null = null;
    const seen = new Set<string>();
    const stack: Array<[string, number]> = [[first, 0]];
    while (stack.length && !hit) {
      const [id, depth] = stack.pop()!;
      const key = `${id}:${depth}`;
      if (seen.has(key) || seen.size > 500) continue;
      seen.add(key);
      const n = byId.get(id);
      let d = depth;
      if (n && isGateway(n)) {
        if ((inn.get(id)?.length ?? 0) > 1) { if (d === 0) { hit = id; break; } d -= 1; }
        if ((out.get(id)?.length ?? 0) > 1) d += 1;
      }
      for (const next of out.get(id) ?? []) stack.push([next, d]);
    }
    found.add(hit);
  }
  return found;
}

/** A parallel split closed by an exclusive join (or the reverse): the branches
 *  are either run twice after the join or wait for each other forever. */
function pairMismatch(model: CanvasModel, mk: Mk, out: Map<string, string[]>, inn: Map<string, string[]>): void {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const s of model.nodes) {
    if (!GW_KIND(s) || (out.get(s.id)?.length ?? 0) < 2) continue;
    const found = joinsOf(s.id, byId, out, inn);
    const joinId = found.size === 1 ? [...found][0] : null;
    const j = joinId ? byId.get(joinId) : undefined;
    if (j && GW_KIND(j) && GW_KIND(j) !== GW_KIND(s)) {
      const msg = "Split and join gateway types differ (parallel vs exclusive).";
      mk("warn", "GATEWAY_PAIR_MISMATCH", msg, "node", s.id);
      mk("warn", "GATEWAY_PAIR_MISMATCH", msg, "node", j.id);
    }
  }
}

/** Tasks, sub-processes, call activities and gateways that decide something
 *  (a split) need a name; events, joins and parallel gateways do not. */
function unnamed(model: CanvasModel, mk: Mk, out: Map<string, string[]>): void {
  for (const n of model.nodes) {
    const needsName = isTask(n) || SUBS.has(n.shape) || n.shape === "bpmn-event-subprocess" || n.shape === "bpmn-call-activity"
      || (["bpmn-gateway-x", "bpmn-gateway-inclusive", "bpmn-gateway-complex"].includes(n.shape) && (out.get(n.id)?.length ?? 0) > 1);
    if (needsName && !(n.label ?? "").trim()) mk("warn", "UNNAMED_ELEMENT", "Element has no name.", "node", n.id);
  }
}

export function lintExtra(model: CanvasModel, mk: Mk): void {
  const { out, inn } = adjacency(model.edges);
  unreachable(model, mk, out);
  pairMismatch(model, mk, out, inn);
  unnamed(model, mk, out);
}
