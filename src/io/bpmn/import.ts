import { XMLParser } from "fast-xml-parser";
import type { CanvasModel } from "../../canvas/types";
import type { ImportResult, SourceMeta } from "../types";
import { BPMN_TO_SHAPE } from "./shapes";

interface BpmnDiBounds { x: number; y: number; width: number; height: number; }
interface BpmnDiWaypoint { x: number; y: number; }

// Walk every object in the tree, collecting children matching local-name predicate.
function* walk(obj: unknown): Generator<{ key: string; value: Record<string, unknown> }> {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) yield* walk(item);
    return;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object") yield { key, value: item as Record<string, unknown> };
          yield* walk(item);
        }
      } else {
        yield { key, value: value as Record<string, unknown> };
        yield* walk(value);
      }
    }
  }
}

function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

function attr(node: Record<string, unknown>, name: string): string | undefined {
  const v = node[`@_${name}`];
  return v == null ? undefined : String(v);
}

function attrAny(node: Record<string, unknown>, names: string[]): string | undefined {
  for (const n of names) {
    const v = node[`@_${n}`];
    if (v != null) return String(v);
  }
  return undefined;
}

function parseBounds(node: Record<string, unknown>): BpmnDiBounds | null {
  for (const [k, v] of Object.entries(node)) {
    if (localName(k) === "Bounds" && v && typeof v === "object") {
      const b = v as Record<string, unknown>;
      const x = Number(attr(b, "x")), y = Number(attr(b, "y"));
      const w = Number(attr(b, "width")), h = Number(attr(b, "height"));
      if ([x, y, w, h].every(Number.isFinite)) return { x, y, width: w, height: h };
    }
  }
  return null;
}

function parseWaypoints(node: Record<string, unknown>): BpmnDiWaypoint[] {
  const out: BpmnDiWaypoint[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (localName(k) !== "waypoint") continue;
    const items = Array.isArray(v) ? v : [v];
    for (const item of items) {
      if (item && typeof item === "object") {
        const wp = item as Record<string, unknown>;
        const x = Number(attr(wp, "x")), y = Number(attr(wp, "y"));
        if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
      }
    }
  }
  return out;
}

const FLOW_NODE_TAGS = new Set(Object.keys(BPMN_TO_SHAPE));
const EDGE_TAG = "sequenceFlow";

export function importBpmn(raw: string): ImportResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: false,
    parseTagValue: false,
    trimValues: true,
    allowBooleanAttributes: true,
  });
  const doc = parser.parse(raw) as Record<string, unknown>;

  // Walk the tree once, collect flow nodes + sequence flows + DI shapes/edges.
  interface RawFlowNode { id: string; tag: string; name: string; node: Record<string, unknown>; }
  interface RawEdge { id: string; source: string; target: string; name: string; node: Record<string, unknown>; }
  const flowNodes: RawFlowNode[] = [];
  const edges: RawEdge[] = [];
  const diShapes = new Map<string, { bounds: BpmnDiBounds; fill?: string; stroke?: string }>();
  const diEdges = new Map<string, BpmnDiWaypoint[]>();

  for (const { key, value } of walk(doc)) {
    const ln = localName(key);
    if (FLOW_NODE_TAGS.has(ln)) {
      const id = attr(value, "id");
      if (id) flowNodes.push({ id, tag: ln, name: attr(value, "name") ?? "", node: value });
    } else if (ln === EDGE_TAG) {
      const id = attr(value, "id");
      const source = attr(value, "sourceRef");
      const target = attr(value, "targetRef");
      if (id && source && target) edges.push({ id, source, target, name: attr(value, "name") ?? "", node: value });
    } else if (ln === "BPMNShape") {
      const ref = attr(value, "bpmnElement");
      const bounds = parseBounds(value);
      if (ref && bounds) {
        // bpmn.io writes colours under two namespaces — pick whichever exists.
        // Attribute keys in fast-xml-parser keep namespace prefix: `@_color:background-color`, `@_bioc:fill`.
        const fill =
          attrAny(value, ["color:background-color", "background-color", "bioc:fill", "fill"]);
        const stroke =
          attrAny(value, ["color:border-color", "border-color", "bioc:stroke", "stroke"]);
        diShapes.set(ref, { bounds, fill, stroke });
      }
    } else if (ln === "BPMNEdge") {
      const ref = attr(value, "bpmnElement");
      const wps = parseWaypoints(value);
      if (ref && wps.length) diEdges.set(ref, wps);
    }
  }

  const model: CanvasModel = { nodes: [], edges: [] };
  const warnings: string[] = [];

  for (const fn of flowNodes) {
    const shape = BPMN_TO_SHAPE[fn.tag] ?? "bpmn-task";
    const di = diShapes.get(fn.id);
    const x = di?.bounds.x ?? 100;
    const y = di?.bounds.y ?? 100;
    const width = di?.bounds.width ?? (fn.tag.endsWith("Event") ? 36 : 100);
    const height = di?.bounds.height ?? (fn.tag.endsWith("Event") ? 36 : 60);
    const style: Record<string, string> = {};
    if (di?.fill) style.fill = di.fill;
    if (di?.stroke) style.stroke = di.stroke;
    model.nodes.push({
      id: fn.id,
      shape,
      x, y, width, height,
      label: fn.name.replace(/&#10;/g, "\n"),
      attrs: {
        __source: { format: "bpmn", sourceId: fn.id, tag: fn.tag },
        ...(Object.keys(style).length ? { style } : {}),
      },
    });
    if (!di) warnings.push(`BPMN flow node "${fn.id}" thiếu BPMNShape DI — đặt vị trí mặc định.`);
  }

  // Quick lookup so each edge can derive its source/target port from the BPMN DI
  // waypoint geometry — the first waypoint sits on the source node boundary, the
  // last on the target boundary, so we snap each to the nearest cardinal side.
  // Without this, every imported edge lands as a floating endpoint at the body
  // centre and all arrows into the same node stack on one boundary point.
  const nodeBox = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const n of model.nodes) nodeBox.set(n.id, { x: n.x, y: n.y, w: n.width, h: n.height });
  // Snap a waypoint to the nearest of 12 port docking positions: 4 cardinal
  // sides × 3 positions each (25% / 50% / 75%). Quarter ports are invisible in
  // the UI but valid connection targets, so multiple imported edges hitting the
  // same side spread across 3 dock points instead of stacking on the midpoint.
  const nearestPort = (pt: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }): string => {
    const dT = Math.abs(pt.y - b.y);
    const dB = Math.abs(pt.y - (b.y + b.h));
    const dL = Math.abs(pt.x - b.x);
    const dR = Math.abs(pt.x - (b.x + b.w));
    const m = Math.min(dT, dB, dL, dR);
    let side: "top" | "bottom" | "left" | "right";
    let pos: number; // 0..1 along the side
    if (m === dT)      { side = "top";    pos = b.w > 0 ? (pt.x - b.x) / b.w : 0.5; }
    else if (m === dB) { side = "bottom"; pos = b.w > 0 ? (pt.x - b.x) / b.w : 0.5; }
    else if (m === dL) { side = "left";   pos = b.h > 0 ? (pt.y - b.y) / b.h : 0.5; }
    else               { side = "right";  pos = b.h > 0 ? (pt.y - b.y) / b.h : 0.5; }
    if (pos < 0.375) return `${side}-1`;   // 25% bucket
    if (pos > 0.625) return `${side}-2`;   // 75% bucket
    return side;                            // 50% bucket (midpoint, legacy ID)
  };

  for (const e of edges) {
    const wps = diEdges.get(e.id);
    // BPMN DI waypoints are the full polyline. Keep all internal corners and
    // force the router to "normal" so they're drawn as-is (manhattan would
    // re-route end-to-end and ignore them, yielding the messy detours we saw).
    const vertices = wps && wps.length > 2 ? wps.slice(1, -1).map((p) => ({ x: p.x, y: p.y })) : undefined;
    const srcBox = nodeBox.get(e.source);
    const tgtBox = nodeBox.get(e.target);
    const sourcePort = wps && wps.length >= 2 && srcBox ? nearestPort(wps[0], srcBox) : undefined;
    const targetPort = wps && wps.length >= 2 && tgtBox ? nearestPort(wps[wps.length - 1], tgtBox) : undefined;
    model.edges.push({
      id: e.id,
      source: e.source,
      sourcePort,
      target: e.target,
      targetPort,
      label: e.name.replace(/&#10;/g, "\n") || undefined,
      vertices,
      router: "normal",
    });
  }

  const sourceMeta: SourceMeta = {
    format: "bpmn",
    payload: {
      // Keep the original raw XML so export can preserve unknown elements
      // (lanes, pools, data objects, message flows, custom namespaces).
      raw,
    },
  };

  return { model, warnings, sourceMeta };
}
