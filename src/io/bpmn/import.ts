import { BpmnModdle } from "bpmn-moddle";
import { getOrientation } from "diagram-js/lib/layout/LayoutUtil";
import type { CanvasModel } from "../../canvas/types";
import type { ImportResult, SourceMeta } from "../types";
import { BPMN_TO_SHAPE } from "./shapes";

/**
 * BPMN 2.0 importer — uses `bpmn-moddle` for XML parsing (same as bpmn.io) and
 * `diagram-js`'s `getOrientation` for proper port-side detection from waypoints.
 *
 * What we preserve from the source:
 *   - Flow node positions + sizes (BPMNShape bounds)
 *   - Edge waypoints (BPMNEdge waypoints → edge vertices)
 *   - Edge labels including their explicit DI positions (BPMNLabel bounds) so
 *     multiple arrows targeting the same node don't stack labels on each other
 *   - Custom fill/stroke colours (bpmn.io's color: and bioc: namespaces)
 *   - Original raw XML in SourceMeta — exporter can preserve elements we don't
 *     yet map (lanes, pools, data objects, message flows, custom namespaces).
 */

const FLOW_NODE_TYPES = new Set([
  "bpmn:StartEvent", "bpmn:EndEvent",
  "bpmn:IntermediateThrowEvent", "bpmn:IntermediateCatchEvent", "bpmn:BoundaryEvent",
  "bpmn:ExclusiveGateway", "bpmn:ParallelGateway", "bpmn:InclusiveGateway", "bpmn:EventBasedGateway",
  "bpmn:Task", "bpmn:UserTask", "bpmn:ServiceTask", "bpmn:ScriptTask",
  "bpmn:SendTask", "bpmn:ReceiveTask", "bpmn:ManualTask", "bpmn:BusinessRuleTask",
  "bpmn:CallActivity", "bpmn:SubProcess",
]);

interface ModdlePoint { x: number; y: number; }
interface ModdleBounds { x: number; y: number; width: number; height: number; }
interface ModdleElement {
  $type: string;
  id?: string;
  name?: string;
  sourceRef?: ModdleElement;
  targetRef?: ModdleElement;
  flowElements?: ModdleElement[];
  rootElements?: ModdleElement[];
  diagrams?: ModdleDiagram[];
  $attrs?: Record<string, string>;
}
interface ModdleDiagram { plane: { planeElement?: ModdleDiElement[] } }
interface ModdleDiElement {
  $type: string;
  bpmnElement?: ModdleElement;
  bounds?: ModdleBounds;
  waypoint?: ModdlePoint[];
  label?: { bounds?: ModdleBounds };
  $attrs?: Record<string, string>;
}

/** Snap a waypoint to one of 12 port positions (4 sides × 3 along each side).
 *  Uses diagram-js's `getOrientation` so corner waypoints get the same
 *  side-picking bpmn.io would apply. NOTE: getOrientation returns the side
 *  where the FIRST arg is positioned relative to the SECOND — we pass the
 *  waypoint first so the return value names the side of the node the
 *  waypoint touches (rather than its opposite). */
function portFor(wp: ModdlePoint, b: ModdleBounds): string {
  const o = getOrientation({ x: wp.x, y: wp.y, width: 0, height: 0 }, b, 0);
  let side: "top" | "bottom" | "left" | "right";
  let pos: number;
  if (o.indexOf("top") === 0)         { side = "top";    pos = b.width  > 0 ? (wp.x - b.x) / b.width  : 0.5; }
  else if (o.indexOf("bottom") === 0) { side = "bottom"; pos = b.width  > 0 ? (wp.x - b.x) / b.width  : 0.5; }
  else if (o === "left")              { side = "left";   pos = b.height > 0 ? (wp.y - b.y) / b.height : 0.5; }
  else if (o === "right")             { side = "right";  pos = b.height > 0 ? (wp.y - b.y) / b.height : 0.5; }
  else {
    // 'intersect' (point inside bbox) — fall back to nearest-side by raw distance.
    const dT = Math.abs(wp.y - b.y);
    const dB = Math.abs(wp.y - (b.y + b.height));
    const dL = Math.abs(wp.x - b.x);
    const dR = Math.abs(wp.x - (b.x + b.width));
    const m = Math.min(dT, dB, dL, dR);
    if (m === dT)      { side = "top";    pos = b.width  > 0 ? (wp.x - b.x) / b.width  : 0.5; }
    else if (m === dB) { side = "bottom"; pos = b.width  > 0 ? (wp.x - b.x) / b.width  : 0.5; }
    else if (m === dL) { side = "left";   pos = b.height > 0 ? (wp.y - b.y) / b.height : 0.5; }
    else               { side = "right";  pos = b.height > 0 ? (wp.y - b.y) / b.height : 0.5; }
  }
  if (pos < 0.375) return `${side}-1`;
  if (pos > 0.625) return `${side}-2`;
  return side;
}

/** Pull custom fill/stroke from BPMN DI attrs — bpmn.io writes either
 *  `color:background-color` / `color:border-color` (BPMN-in-Color spec) or its
 *  legacy `bioc:fill` / `bioc:stroke`. We accept both. */
function diColours(attrs: Record<string, string> | undefined): { fill?: string; stroke?: string } {
  if (!attrs) return {};
  const fill = attrs["color:background-color"] || attrs["background-color"] || attrs["bioc:fill"] || attrs["fill"];
  const stroke = attrs["color:border-color"] || attrs["border-color"] || attrs["bioc:stroke"] || attrs["stroke"];
  return { fill, stroke };
}

let moddleSingleton: BpmnModdle | null = null;
function moddle(): BpmnModdle {
  if (!moddleSingleton) moddleSingleton = new BpmnModdle();
  return moddleSingleton;
}

/** Hard cap on import size — guards the UI thread against parsing huge XML
 *  trees synchronously. 4 MB covers any realistic hand-authored BPMN diagram
 *  (enterprise files we've seen top out around 1 MB). */
const MAX_BPMN_BYTES = 4 * 1024 * 1024;

export async function importBpmn(raw: string): Promise<ImportResult> {
  if (raw.length > MAX_BPMN_BYTES) {
    throw new Error(`BPMN file quá lớn (${(raw.length / 1024 / 1024).toFixed(1)} MB). Giới hạn: 4 MB.`);
  }
  const { rootElement: definitions, warnings: parserWarnings } = await moddle().fromXML(raw, "bpmn:Definitions");
  const warnings: string[] = parserWarnings.map((w: { message?: string } | string) =>
    typeof w === "string" ? w : (w.message ?? String(w)),
  );

  // Walk every root element (process / collaboration) and collect flow nodes +
  // sequence flows recursively (subprocesses nest flowElements).
  const flowNodes: ModdleElement[] = [];
  const sequenceFlows: ModdleElement[] = [];
  const collectFlow = (parent: ModdleElement): void => {
    for (const fe of parent.flowElements ?? []) {
      if (FLOW_NODE_TYPES.has(fe.$type)) flowNodes.push(fe);
      else if (fe.$type === "bpmn:SequenceFlow") sequenceFlows.push(fe);
      // Recurse into subprocesses (still capture the subprocess itself if it's a flow node)
      if (fe.flowElements) collectFlow(fe);
    }
  };
  for (const root of (definitions as ModdleElement).rootElements ?? []) collectFlow(root);

  // Map BPMN element id → DI shape / edge so we can pull bounds + waypoints.
  const diShapes = new Map<string, ModdleDiElement>();
  const diEdges = new Map<string, ModdleDiElement>();
  for (const dia of (definitions as ModdleElement).diagrams ?? []) {
    for (const pe of dia.plane.planeElement ?? []) {
      const refId = pe.bpmnElement?.id;
      if (!refId) continue;
      if (pe.$type === "bpmndi:BPMNShape") diShapes.set(refId, pe);
      else if (pe.$type === "bpmndi:BPMNEdge") diEdges.set(refId, pe);
    }
  }

  const model: CanvasModel = { nodes: [], edges: [] };

  // Nodes — derive shape from BPMN element type + apply DI bounds and colours.
  for (const fn of flowNodes) {
    const id = fn.id!;
    const tag = fn.$type.replace(/^bpmn:/, "");
    const tagLc = tag.charAt(0).toLowerCase() + tag.slice(1);
    const shape = BPMN_TO_SHAPE[tagLc] ?? "bpmn-task";
    const di = diShapes.get(id);
    const bounds = di?.bounds;
    const x = bounds?.x ?? 100;
    const y = bounds?.y ?? 100;
    const width = bounds?.width ?? (tagLc.endsWith("Event") ? 36 : 100);
    const height = bounds?.height ?? (tagLc.endsWith("Event") ? 36 : 60);
    const { fill, stroke } = diColours(di?.$attrs);
    const style: Record<string, string> = {};
    if (fill) style.fill = fill;
    if (stroke) style.stroke = stroke;
    model.nodes.push({
      id,
      shape,
      x, y, width, height,
      label: (fn.name ?? "").replace(/&#10;/g, "\n"),
      attrs: {
        __source: { format: "bpmn", sourceId: id, tag: tagLc },
        ...(Object.keys(style).length ? { style } : {}),
      },
    });
    if (!di) warnings.push(`BPMN flow node "${id}" thiếu BPMNShape DI — đặt vị trí mặc định.`);
  }

  // Bbox lookup so each edge can derive its source/target port from waypoint
  // geometry (we no longer trust just the order of items in the list).
  const nodeBox = new Map<string, ModdleBounds>();
  for (const n of model.nodes) nodeBox.set(n.id, { x: n.x, y: n.y, width: n.width, height: n.height });

  // Edges — vertices + ports + label position.
  for (const sf of sequenceFlows) {
    const id = sf.id!;
    const sourceId = sf.sourceRef?.id;
    const targetId = sf.targetRef?.id;
    if (!sourceId || !targetId) continue;
    const di = diEdges.get(id);
    const wps = di?.waypoint ?? [];
    // Internal vertices only — X6 already has source/target endpoints.
    const vertices = wps.length > 2 ? wps.slice(1, -1).map((p) => ({ x: p.x, y: p.y })) : undefined;
    // bpmn.io-style precise anchoring: pin each endpoint to the exact
    // (dx, dy) offset of the BPMN waypoint from the node's top-left corner —
    // unlimited positions per side, not snapped to a 12-port grid. Falls
    // back to the legacy port string (for tests / sparse files) only when
    // no waypoint geometry is available.
    const srcBox = nodeBox.get(sourceId);
    const tgtBox = nodeBox.get(targetId);
    const sourceAnchor = wps.length >= 2 && srcBox
      ? { dx: wps[0].x - srcBox.x, dy: wps[0].y - srcBox.y }
      : undefined;
    const targetAnchor = wps.length >= 2 && tgtBox
      ? { dx: wps[wps.length - 1].x - tgtBox.x, dy: wps[wps.length - 1].y - tgtBox.y }
      : undefined;
    const sourcePort = sourceAnchor ? undefined : (wps.length >= 2 && srcBox ? portFor(wps[0], srcBox) : undefined);
    const targetPort = targetAnchor ? undefined : (wps.length >= 2 && tgtBox ? portFor(wps[wps.length - 1], tgtBox) : undefined);
    // BPMN DI may pin the edge label at a specific position via BPMNLabel.bounds.
    // Convert it to X6's label distance/offset: distance = 0.5 (centre along edge)
    // + offset = label bbox centre minus the edge's geometric midpoint. Lossy but
    // matches the visual placement bpmn.io renders.
    let labelPos: { distance?: number; offset?: { x: number; y: number } } | undefined;
    const lb = di?.label?.bounds;
    if (lb && wps.length >= 2) {
      const labelCx = lb.x + lb.width / 2;
      const labelCy = lb.y + lb.height / 2;
      // Midpoint of the polyline (rough — average of all waypoints' midpoint).
      let totalLen = 0;
      const segLens: number[] = [];
      for (let i = 1; i < wps.length; i++) {
        const dx = wps[i].x - wps[i - 1].x, dy = wps[i].y - wps[i - 1].y;
        const l = Math.sqrt(dx * dx + dy * dy);
        segLens.push(l); totalLen += l;
      }
      let cumLen = 0, midX = wps[0].x, midY = wps[0].y;
      for (let i = 0; i < segLens.length; i++) {
        if (cumLen + segLens[i] >= totalLen / 2) {
          const t = totalLen > 0 ? (totalLen / 2 - cumLen) / segLens[i] : 0;
          midX = wps[i].x + (wps[i + 1].x - wps[i].x) * t;
          midY = wps[i].y + (wps[i + 1].y - wps[i].y) * t;
          break;
        }
        cumLen += segLens[i];
      }
      labelPos = { distance: 0.5, offset: { x: labelCx - midX, y: labelCy - midY } };
    }
    model.edges.push({
      id,
      source: sourceId,
      sourcePort,
      sourceAnchor,
      target: targetId,
      targetPort,
      targetAnchor,
      label: (sf.name ?? "").replace(/&#10;/g, "\n") || undefined,
      labelPos,
      vertices,
      router: "normal",
    });
  }

  const sourceMeta: SourceMeta = { format: "bpmn", payload: { raw } };
  return { model, warnings, sourceMeta };
}
