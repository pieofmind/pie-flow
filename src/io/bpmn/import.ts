import { BpmnModdle } from "bpmn-moddle";
import { getOrientation } from "diagram-js/lib/layout/LayoutUtil";
import type { CanvasModel } from "../../canvas/types";
import type { ImportOptions, ImportResult, SourceMeta } from "../types";
import { BPMN_TO_SHAPE, EVENT_DEF_TO_TRIGGER } from "./shapes";

/** BPMN extra attrs Đợt F — populated from moddle tree (eventDefinitions,
 *  loopCharacteristics, isInterrupting, attachedToRef, triggeredByEvent). */
interface BpmnElementShape {
  $type: string;
  id?: string;
  eventDefinitions?: Array<{ $type: string }>;
  loopCharacteristics?: { $type: string; isSequential?: boolean };
  isInterrupting?: boolean;
  cancelActivity?: boolean;
  attachedToRef?: { id: string };
  triggeredByEvent?: boolean;
  isForCompensation?: boolean;
  // Phase D — documentation + extensionElements
  documentation?: Array<{ text?: string }>;
  extensionElements?: {
    values?: Array<{
      $type: string;
      $instanceOf?: (t: string) => boolean;
      assignee?: string; candidateUsers?: string; candidateGroups?: string;
      formKey?: string; dueDate?: string; priority?: string;
      executionListener?: unknown[]; taskListener?: unknown[];
      properties?: { values?: Array<{ name?: string; value?: string }> };
      [key: string]: unknown;
    }>;
  };
}
/** Derive Đợt A BPMN extras from a flow node's moddle attrs. Pure — no side effects. */
function bpmnExtras(fn: BpmnElementShape, tagLc: string): {
  trigger?: string; throwing?: boolean; interrupting?: boolean;
  attachedTo?: string; markers?: string[]; kindOverride?: string;
} {
  const out: ReturnType<typeof bpmnExtras> = {};
  // Event trigger from eventDefinitions[0] — moddle $type is "bpmn:MessageEventDefinition",
  // lowercase the first char after the prefix so it matches the map keys.
  const defRaw = fn.eventDefinitions?.[0]?.$type?.replace(/^bpmn:/, "");
  const defLc = defRaw ? defRaw.charAt(0).toLowerCase() + defRaw.slice(1) : undefined;
  if (defLc && EVENT_DEF_TO_TRIGGER[defLc]) out.trigger = EVENT_DEF_TO_TRIGGER[defLc];
  // Throwing: only intermediate-throw + end events fire the icon as filled.
  if (tagLc === "intermediateThrowEvent" || tagLc === "endEvent") out.throwing = true;
  // Interrupting flag (boundary + event-subprocess start). Default true per OMG.
  if (tagLc === "boundaryEvent") {
    out.interrupting = fn.cancelActivity !== false;
    if (fn.attachedToRef?.id) out.attachedTo = fn.attachedToRef.id;
  } else if (fn.isInterrupting === false) {
    out.interrupting = false;
  }
  // Activity markers from loopCharacteristics + isForCompensation
  const markers: string[] = [];
  const loop = fn.loopCharacteristics;
  if (loop) {
    const lt = loop.$type.replace(/^bpmn:/, "");
    if (lt === "MultiInstanceLoopCharacteristics") markers.push(loop.isSequential ? "mi-seq" : "mi-par");
    else if (lt === "StandardLoopCharacteristics") markers.push("loop");
  }
  if (fn.isForCompensation) markers.push("compensation");
  if (markers.length > 0) out.markers = markers;
  // Event sub-process: subProcess with triggeredByEvent=true → override kind
  if (tagLc === "subProcess" && fn.triggeredByEvent) out.kindOverride = "bpmn-event-subprocess";
  return out;
}

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
  "bpmn:ExclusiveGateway", "bpmn:ParallelGateway", "bpmn:InclusiveGateway",
  "bpmn:EventBasedGateway", "bpmn:ComplexGateway",
  "bpmn:Task", "bpmn:UserTask", "bpmn:ServiceTask", "bpmn:ScriptTask",
  "bpmn:SendTask", "bpmn:ReceiveTask", "bpmn:ManualTask", "bpmn:BusinessRuleTask",
  "bpmn:CallActivity", "bpmn:SubProcess", "bpmn:Transaction", "bpmn:AdHocSubProcess",
  // Đợt F — data artifacts + annotations + groups round-trip through canvas
  "bpmn:DataObjectReference", "bpmn:DataStoreReference",
  "bpmn:DataInput", "bpmn:DataOutput",
  "bpmn:TextAnnotation", "bpmn:Group",
]);

interface ModdlePoint { x: number; y: number; }
interface ModdleBounds { x: number; y: number; width: number; height: number; }
interface ModdleElement {
  $type: string;
  id?: string;
  name?: string;
  sourceRef?: ModdleElement | Array<ModdleElement | string>;
  targetRef?: ModdleElement;
  flowElements?: ModdleElement[];
  rootElements?: ModdleElement[];
  diagrams?: ModdleDiagram[];
  // Collaboration → participants (pools). Participant.processRef → Process.
  participants?: ModdleElement[];
  // Collaboration → messageFlows. MessageFlow has sourceRef/targetRef like SequenceFlow.
  messageFlows?: ModdleElement[];
  // Process → artifacts → Association / TextAnnotation / Group.
  artifacts?: ModdleElement[];
  processRef?: ModdleElement;
  // Process → laneSets → lanes; Lane.flowNodeRef → member flow nodes.
  laneSets?: ModdleElement[];
  lanes?: ModdleElement[];
  flowNodeRef?: ModdleElement[];
  // Activity-local data associations (DataInputAssociation / DataOutputAssociation)
  dataInputAssociations?: ModdleElement[];
  dataOutputAssociations?: ModdleElement[];
  // SequenceFlow extras (Phase A)
  conditionExpression?: { body?: string; $type?: string };
  default?: ModdleElement | string;
  // Association extras (Phase A)
  associationDirection?: "None" | "One" | "Both";
  $attrs?: Record<string, string>;
}
interface ModdleDiagram { plane: { planeElement?: ModdleDiElement[]; bpmnElement?: ModdleElement } }
interface ModdleDiElement {
  $type: string;
  bpmnElement?: ModdleElement;
  bounds?: ModdleBounds;
  waypoint?: ModdlePoint[];
  label?: { bounds?: ModdleBounds };
  isExpanded?: boolean;
  // bioc namespace props — moddle resolves `bioc:fill` → `.fill` directly.
  fill?: string;
  stroke?: string;
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

/** Pull custom fill/stroke from BPMN DI shape element.
 *  bpmn.io writes colors in two ways:
 *  1. bioc namespace: `<bpmndi:BPMNShape bioc:fill="..." bioc:stroke="...">` → moddle parses
 *     these into direct properties (`pe.fill`, `pe.stroke`) on the DI element, NOT in $attrs.
 *  2. BPMN-in-Color spec: `color:background-color` / `color:border-color` → still in $attrs. */
function diColours(di: { $attrs?: Record<string, string>; fill?: string; stroke?: string } | undefined): { fill?: string; stroke?: string } {
  if (!di) return {};
  const attrs = di.$attrs ?? {};
  // bioc: namespace — moddle puts these as direct props after namespace resolution
  const fill = (di.fill as string | undefined)
    || attrs["color:background-color"] || attrs["background-color"]
    || attrs["bioc:fill"] || attrs["fill"];
  const stroke = (di.stroke as string | undefined)
    || attrs["color:border-color"] || attrs["border-color"]
    || attrs["bioc:stroke"] || attrs["stroke"];
  return { fill, stroke };
}

let moddleSingleton: BpmnModdle | null = null;
function moddle(): BpmnModdle {
  if (!moddleSingleton) moddleSingleton = new BpmnModdle();
  return moddleSingleton;
}

/** Phase D — Extract Camunda-specific properties from a flow element.
 *  bpmn-moddle without camunda extension keeps camunda:assignee etc. in `$attrs`
 *  as `"camunda:assignee"` keys. extensionElements.values items keep children
 *  in `$children` (not `.values` / `.properties`).
 *  Returns a flat object merged into node.attrs:
 *  - `camunda` : known scalar keys (assignee, formKey, candidateUsers, etc.)
 *  - `bpmnProps`: array of {name, value} from <camunda:property> children */
function parseCamundaExt(ext: BpmnElementShape["extensionElements"], nodeAttrs?: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const camunda: Record<string, string> = {};
  const bpmnProps: Array<{ name: string; value: string }> = [];
  // Path 1: known camunda attrs in $attrs (without camunda extension registered)
  const CAMUNDA_ATTRS: Record<string, string> = {
    "camunda:assignee": "assignee", "camunda:candidateUsers": "candidateUsers",
    "camunda:candidateGroups": "candidateGroups", "camunda:formKey": "formKey",
    "camunda:dueDate": "dueDate", "camunda:priority": "priority",
  };
  for (const [rawKey, shortKey] of Object.entries(CAMUNDA_ATTRS)) {
    const val = nodeAttrs?.[rawKey];
    if (typeof val === "string" && val) camunda[shortKey] = val;
  }
  // Path 2: extensionElements (may have $children array per moddle)
  if (ext?.values?.length) {
    for (const v of ext.values) {
      const children = (v as unknown as { $children?: Array<{ $type?: string; name?: string; value?: string }> }).$children ?? [];
      for (const child of children) {
        if (child.$type === "camunda:property" && typeof child.name === "string") {
          bpmnProps.push({ name: child.name, value: String(child.value ?? "") });
        }
      }
    }
  }
  if (Object.keys(camunda).length) out.camunda = camunda;
  if (bpmnProps.length) out.bpmnProps = bpmnProps;
  return out;
}

/** Hard cap on import size — guards the UI thread against parsing huge XML
 *  trees synchronously. 4 MB covers any realistic hand-authored BPMN diagram
 *  (enterprise files we've seen top out around 1 MB). */
const MAX_BPMN_BYTES = 4 * 1024 * 1024;

export async function inspectBpmnDiagrams(raw: string): Promise<{ diagramCount: number; diagrams: Array<{ index: number; id: string; planeRef?: string; elementCount: number }> }> {
  const { rootElement: definitions } = await moddle().fromXML(raw, "bpmn:Definitions");
  const diagrams = ((definitions as ModdleElement).diagrams ?? []).map((d, index) => ({
    index,
    id: (d as unknown as { id?: string }).id ?? `Diagram_${index + 1}`,
    planeRef: d.plane?.bpmnElement?.id,
    elementCount: d.plane?.planeElement?.length ?? 0,
  }));
  return { diagramCount: diagrams.length, diagrams };
}

export async function importBpmn(raw: string, options?: ImportOptions): Promise<ImportResult> {
  if (raw.length > MAX_BPMN_BYTES) {
    throw new Error(`BPMN file quá lớn (${(raw.length / 1024 / 1024).toFixed(1)} MB). Giới hạn: 4 MB.`);
  }
  const { rootElement: definitions, warnings: parserWarnings } = await moddle().fromXML(raw, "bpmn:Definitions");
  const warnings: string[] = parserWarnings.map((w: { message?: string } | string) =>
    typeof w === "string" ? w : (w.message ?? String(w)),
  );

  // Walk every root element (process / collaboration) and collect flow nodes +
  // sequence flows + associations recursively (subprocesses nest flowElements).
  // MessageFlows are collected separately from any Collaboration root.
  // Phase B — `parentId` tracks subprocess containment: only set when the
  // direct ancestor is a flow-node container (subProcess / transaction /
  // adhocSubProcess), NOT the top-level bpmn:Process (which is the diagram root).
  const flowNodes: ModdleElement[] = [];
  const flowNodeParentId = new Map<string, string>();
  const sequenceFlows: ModdleElement[] = [];
  const associations: ModdleElement[] = [];
  const messageFlows: ModdleElement[] = [];
  const collectFlow = (parent: ModdleElement, parentSubprocessId?: string): void => {
    for (const fe of parent.flowElements ?? []) {
      if (FLOW_NODE_TYPES.has(fe.$type)) {
        flowNodes.push(fe);
        if (parentSubprocessId && fe.id) flowNodeParentId.set(fe.id, parentSubprocessId);
        // Data associations are attached to activities/events, not process.artifacts.
        for (const da of fe.dataInputAssociations ?? []) associations.push(da);
        for (const da of fe.dataOutputAssociations ?? []) associations.push(da);
      } else if (fe.$type === "bpmn:SequenceFlow") sequenceFlows.push(fe);
      // Recurse into subprocesses (and Transaction / AdHocSubProcess).
      if (fe.flowElements) {
        const isContainer = fe.$type === "bpmn:SubProcess" || fe.$type === "bpmn:Transaction" || fe.$type === "bpmn:AdHocSubProcess";
        collectFlow(fe, isContainer && fe.id ? fe.id : parentSubprocessId);
      }
    }
    // Artifacts live alongside flowElements on Process / SubProcess.
    // TextAnnotation and Group are NODES (rendered shapes); Association is an EDGE.
    // Without this, an Association → TextAnnotation edge points at a missing
    // target cell, which crashes X6's edge render queue and silently drops
    // every edge that hasn't been processed yet (was 14/39 in a 3-pool BPMN).
    for (const ar of parent.artifacts ?? []) {
      if (ar.$type === "bpmn:Association") associations.push(ar);
      else if (ar.$type === "bpmn:TextAnnotation" || ar.$type === "bpmn:Group") flowNodes.push(ar);
    }
  };
  for (const root of (definitions as ModdleElement).rootElements ?? []) {
    collectFlow(root);
    if (root.$type === "bpmn:Collaboration") {
      for (const mf of root.messageFlows ?? []) messageFlows.push(mf);
    }
  }
  // Phase B — Lane membership. Walk every Process.laneSets.lanes and map each
  // flowNodeRef → lane.id. Nested lanes (childLaneSet) recurse to leaves so
  // deeply-nested membership still resolves to the innermost containing lane.
  const flowNodeLaneId = new Map<string, string>();
  const walkLanes = (lanes: ModdleElement[] | undefined): void => {
    for (const ln of lanes ?? []) {
      const childLanes = (ln as { childLaneSet?: { lanes?: ModdleElement[] } }).childLaneSet?.lanes;
      if (childLanes?.length) { walkLanes(childLanes); continue; }
      const laneId = ln.id;
      if (!laneId) continue;
      for (const ref of ln.flowNodeRef ?? []) {
        const refId = typeof ref === "string" ? ref : (ref as ModdleElement).id;
        if (refId) flowNodeLaneId.set(refId, laneId);
      }
    }
  };
  for (const root of (definitions as ModdleElement).rootElements ?? []) {
    if (root.$type !== "bpmn:Process") continue;
    for (const ls of root.laneSets ?? []) walkLanes(ls.lanes);
  }

  // Multi-diagram support (Phase F): pick the plane that contains the most
  // BPMN elements we actually import (flow nodes + flows + participants/lanes).
  const candidateIds = new Set<string>();
  for (const n of flowNodes) if (n.id) candidateIds.add(n.id);
  for (const e of sequenceFlows) if (e.id) candidateIds.add(e.id);
  for (const e of associations) if (e.id) candidateIds.add(e.id);
  for (const e of messageFlows) if (e.id) candidateIds.add(e.id);
  for (const root of (definitions as ModdleElement).rootElements ?? []) {
    if (root.$type !== "bpmn:Collaboration") continue;
    for (const p of root.participants ?? []) if (p.id) candidateIds.add(p.id);
  }
  for (const root of (definitions as ModdleElement).rootElements ?? []) {
    if (root.$type !== "bpmn:Process") continue;
    for (const ls of root.laneSets ?? []) {
      for (const ln of ls.lanes ?? []) if (ln.id) candidateIds.add(ln.id);
    }
  }
  const diagrams = (definitions as ModdleElement).diagrams ?? [];
  let chosenDiagramIndex = 0;
  const requested = options?.diagramIndex;
  if (typeof requested === "number" && requested >= 0 && requested < diagrams.length) {
    chosenDiagramIndex = requested;
  } else {
    let bestScore = -1;
    diagrams.forEach((dia, idx) => {
      let score = 0;
      for (const pe of dia.plane.planeElement ?? []) {
        const id = pe.bpmnElement?.id;
        if (id && candidateIds.has(id)) score++;
      }
      if (score > bestScore) { bestScore = score; chosenDiagramIndex = idx; }
    });
  }
  if (diagrams.length > 1) {
    warnings.push(`BPMN có ${diagrams.length} diagrams; đang import plane #${chosenDiagramIndex + 1} (nhiều phần tử nhất).`);
  }
  const chosenPlane = diagrams[chosenDiagramIndex]?.plane;

  // Map BPMN element id → DI shape / edge so we can pull bounds + waypoints.
  const diShapes = new Map<string, ModdleDiElement>();
  const diEdges = new Map<string, ModdleDiElement>();
  for (const pe of chosenPlane?.planeElement ?? []) {
      const refId = pe.bpmnElement?.id;
      if (!refId) continue;
      if (pe.$type === "bpmndi:BPMNShape") diShapes.set(refId, pe);
      else if (pe.$type === "bpmndi:BPMNEdge") diEdges.set(refId, pe);
  }

  const model: CanvasModel = { nodes: [], edges: [] };

  // Nodes — derive shape from BPMN element type + apply DI bounds and colours.
  for (const fn of flowNodes) {
    const id = fn.id!;
    const tag = fn.$type.replace(/^bpmn:/, "");
    const tagLc = tag.charAt(0).toLowerCase() + tag.slice(1);
    const extras = bpmnExtras(fn as unknown as BpmnElementShape, tagLc);
    const shape = extras.kindOverride ?? BPMN_TO_SHAPE[tagLc] ?? "bpmn-task";
    const di = diShapes.get(id);
    const bounds = di?.bounds;
    const x = bounds?.x ?? 100;
    const y = bounds?.y ?? 100;
    const width = bounds?.width ?? (tagLc.endsWith("Event") ? 36 : 100);
    const height = bounds?.height ?? (tagLc.endsWith("Event") ? 36 : 60);
    const isGw = shape.includes("gateway");
    const labelBounds = di?.label?.bounds;
    let nodeLabelOffset: { x: number; y: number } | undefined;
    if (labelBounds) {
      const labelCenterY = labelBounds.y + labelBounds.height / 2;
      const nodeCenterY = y + height / 2;
      const isTop = labelCenterY < nodeCenterY;
      const defaultY = isGw ? 37 : 36;
      const defaultOffset = { x: 0, y: isTop ? -defaultY : defaultY };
      const rawOffset = {
        x: (labelBounds.x + labelBounds.width / 2) - (x + width / 2) - defaultOffset.x,
        y: labelCenterY - nodeCenterY - defaultOffset.y,
      };
      // Snapping threshold: if offset is tiny, ignore it to keep HTML output clean
      if (Math.abs(rawOffset.x) >= 2.5 || Math.abs(rawOffset.y) >= 2.5) {
        nodeLabelOffset = rawOffset;
      }
    }
    const { fill, stroke } = diColours(di);
    const style: Record<string, string> = {};
    if (fill) style.fill = fill;
    if (stroke) style.stroke = stroke;
    model.nodes.push({
      id,
      shape,
      x, y, width, height,
      label: ((fn.$type === "bpmn:TextAnnotation" ? (fn as { text?: string }).text : fn.name) ?? "").replace(/&#10;/g, "\n"),
      ...(flowNodeParentId.get(id) ? { parentId: flowNodeParentId.get(id) } : {}),
      ...(flowNodeLaneId.get(id) ? { laneId: flowNodeLaneId.get(id) } : {}),
      attrs: {
        // Phase C — preserve DI.isExpanded so collapse state survives round-trip.
        ...(di?.isExpanded === false ? { collapsed: true } : {}),
        // Phase D — bioc/color-spec explicit fill/stroke stored separately so
        // the panel can write back named DI attrs (not just canvas node style).
        ...(fill ? { bpmnFill: fill } : {}),
        ...(stroke ? { bpmnStroke: stroke } : {}),
        // Phase D — documentation text (first <bpmn:documentation> element body).
        ...((fn as unknown as BpmnElementShape).documentation?.[0]?.text
          ? { bpmnDoc: (fn as unknown as BpmnElementShape).documentation![0].text! }
          : {}),
        // Phase D — Camunda attrs (in $attrs) + extensionElements property values.
        ...parseCamundaExt((fn as unknown as BpmnElementShape).extensionElements, fn.$attrs),
        __source: { format: "bpmn", sourceId: id, tag: tagLc },
        ...(Object.keys(style).length ? { style } : {}),
        // Đợt F — BPMN semantics preserved in NodeExtra for canvas + round-trip
        ...(extras.trigger ? { trigger: extras.trigger } : {}),
        ...(extras.throwing !== undefined ? { throwing: extras.throwing } : {}),
        ...(extras.interrupting !== undefined ? { interrupting: extras.interrupting } : {}),
        ...(extras.attachedTo ? { attachedTo: extras.attachedTo } : {}),
        ...(extras.markers ? { markers: extras.markers } : {}),
        ...(nodeLabelOffset ? { labelOffset: nodeLabelOffset } : {}),
      },
    });
    if (!di) warnings.push(`BPMN flow node "${id}" thiếu BPMNShape DI — đặt vị trí mặc định.`);
  }

  // Bbox lookup so each edge can derive its source/target port from waypoint
  // geometry (we no longer trust just the order of items in the list).
  const nodeBox = new Map<string, ModdleBounds>();
  for (const n of model.nodes) nodeBox.set(n.id, { x: n.x, y: n.y, width: n.width, height: n.height });
  // Pools are built after edges (below), but a MessageFlow may end on the
  // participant itself — without its box the pool-side anchor is lost and the
  // canvas snaps every such flow to the pool's mid-side.
  for (const root of (definitions as ModdleElement).rootElements ?? []) {
    for (const part of root.participants ?? []) {
      const b = part.id ? diShapes.get(part.id)?.bounds : undefined;
      if (b && part.id) nodeBox.set(part.id, b);
    }
  }

  // Edges — vertices + ports + label position. Phase A: handle SequenceFlow,
  // MessageFlow, and Association uniformly through `buildEdge`.
  type EdgeKind = "sequence" | "message" | "association";
  const buildEdge = (fe: ModdleElement, kind: EdgeKind): CanvasModel["edges"][number] | null => {
    const id = fe.id;
    const sourceId = Array.isArray(fe.sourceRef)
      ? ((typeof fe.sourceRef[0] === "string" ? fe.sourceRef[0] : fe.sourceRef[0]?.id) ?? undefined)
      : fe.sourceRef?.id;
    const targetId = fe.targetRef?.id;
    if (!id || !sourceId || !targetId) return null;
    const di = diEdges.get(id);
    const rawWps = di?.waypoint ?? [];
    // Interior waypoints that coincide with a neighbour (bpmn-js docking
    // artefacts, or an orth bend sitting on an endpoint) must not become
    // vertices — they create zero-length tail segments in the canvas.
    const wps = rawWps.filter((p, i) => i === 0 || Math.hypot(p.x - rawWps[i - 1].x, p.y - rawWps[i - 1].y) > 0.5);
    const vertices = wps.length > 2 ? wps.slice(1, -1).map((p) => ({ x: p.x, y: p.y })) : undefined;
    const srcBox = nodeBox.get(sourceId);
    const tgtBox = nodeBox.get(targetId);
    const wpStart = wps.length >= 2 ? wps[0] : undefined;
    const wpEnd = wps.length >= 2 ? wps[wps.length - 1] : undefined;
    let sourcePort = wpStart && srcBox ? portFor(wpStart, srcBox) : undefined;
    let targetPort = wpEnd && tgtBox ? portFor(wpEnd, tgtBox) : undefined;
    const sourceAnchor = (wpStart && srcBox)
      ? { dx: wpStart.x - srcBox.x, dy: wpStart.y - srcBox.y }
      : undefined;
    const targetAnchor = (wpEnd && tgtBox)
      ? { dx: wpEnd.x - tgtBox.x, dy: wpEnd.y - tgtBox.y }
      : undefined;
    // Fallback when DI waypoints are sparse/odd: infer side ports from center-to-center
    // direction to keep imported orthogonal routes stable (avoid S-curves/diagonals).
    if (!sourceAnchor && !targetAnchor && srcBox && tgtBox && (!sourcePort || !targetPort)) {
      const scx = srcBox.x + srcBox.width / 2;
      const scy = srcBox.y + srcBox.height / 2;
      const tcx = tgtBox.x + tgtBox.width / 2;
      const tcy = tgtBox.y + tgtBox.height / 2;
      const dx = tcx - scx;
      const dy = tcy - scy;
      if (Math.abs(dx) >= Math.abs(dy)) {
        sourcePort ??= dx >= 0 ? "right" : "left";
        targetPort ??= dx >= 0 ? "left" : "right";
      } else {
        sourcePort ??= dy >= 0 ? "bottom" : "top";
        targetPort ??= dy >= 0 ? "top" : "bottom";
      }
    }
    let labelPos: { distance?: number; offset?: { x: number; y: number } } | undefined;
    const lb = di?.label?.bounds;
    if (lb && wps.length >= 2) {
      const labelCx = lb.x + lb.width / 2;
      const labelCy = lb.y + lb.height / 2;
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
    // Phase A — SequenceFlow conditionExpression body + Association direction.
    const edgeAttrs: { condition?: string; isDefault?: boolean; associationDirection?: "None"|"One"|"Both" } = {};
    if (kind === "sequence" && fe.conditionExpression?.body) {
      edgeAttrs.condition = fe.conditionExpression.body;
    }
    if (kind === "association" && fe.associationDirection && fe.associationDirection !== "None") {
      edgeAttrs.associationDirection = fe.associationDirection;
    }
    return {
      id,
      source: sourceId,
      sourcePort,
      sourceAnchor,
      target: targetId,
      targetPort,
      targetAnchor,
      label: (fe.name ?? "").replace(/&#10;/g, "\n") || undefined,
      labelPos,
      vertices,
      router: "normal",
      ...(kind !== "sequence" ? { kind } : {}),
      ...(Object.keys(edgeAttrs).length ? { attrs: edgeAttrs } : {}),
    };
  };
  for (const sf of sequenceFlows) {
    const edge = buildEdge(sf, "sequence");
    if (edge) model.edges.push(edge);
  }
  for (const mf of messageFlows) {
    const edge = buildEdge(mf, "message");
    if (edge) model.edges.push(edge);
  }
  for (const ar of associations) {
    const edge = buildEdge(ar, "association");
    if (edge) model.edges.push(edge);
  }
  // Mark default-flow edges. The `default` attribute lives on the source
  // gateway/activity, not the flow itself — resolve here so downstream
  // consumers (export, validator, canvas styling) only need to read edge.attrs.
  const defaultEdgeIds = new Set<string>();
  for (const fn of flowNodes) {
    const def = fn.default;
    const defId = typeof def === "string" ? def : def?.id;
    if (defId) defaultEdgeIds.add(defId);
  }
  for (const edge of model.edges) {
    if (defaultEdgeIds.has(edge.id)) {
      edge.attrs = { ...(edge.attrs ?? {}), isDefault: true };
    }
  }

  // ── Pools (participants) + lanes ──────────────────────────────────────────
  // Each collaboration participant becomes a `bpmn-pool` node rendered BEHIND
  // the flow nodes (unshifted to the front of the list → lowest z-order). The
  // pool's bounds come from its BPMNShape DI when present; otherwise we wrap
  // the bounding box of its member flow nodes (+ header padding) so the
  // container hugs its contents. Lanes are mirrored into `attrs.lanes`.
  const defs = definitions as ModdleElement;
  const processById = new Map<string, ModdleElement>();
  for (const root of defs.rootElements ?? []) {
    if (root.$type === "bpmn:Process" && root.id) processById.set(root.id, root);
  }
  const pools: CanvasModel["nodes"] = [];
  const HEADER = 44;   // vertical pool title strip (matches CSS bp-pool-head width, fits 2-line titles)
  const LANE_HEAD = 24; // lane title strip
  const PAD = 30;
  const flowNodePoolId = new Map<string, string>();
  for (const root of defs.rootElements ?? []) {
    if (root.$type !== "bpmn:Collaboration") continue;
    for (const part of root.participants ?? []) {
      const processRefId = part.processRef?.id;
      const proc = processRefId ? processById.get(processRefId) : undefined;
      const lanes = (proc?.laneSets ?? []).flatMap((ls) => ls.lanes ?? []);
      const laneAttrs = lanes.map((ln) => ({ id: ln.id ?? "", label: ln.name ?? "" }));

      // Determine bounds: prefer the participant's own DI shape.
      let px: number, py: number, pw: number, ph: number;
      const partDi = part.id ? diShapes.get(part.id) : undefined;
      if (partDi?.bounds) {
        ({ x: px, y: py, width: pw, height: ph } = partDi.bounds);
      } else {
        // Wrap the bbox of every flow node belonging to this process.
        const members = model.nodes.filter((n) => {
          const sid = (n.attrs?.__source as { sourceId?: string } | undefined)?.sourceId;
          return sid && proc?.flowElements?.some((fe) => fe.id === sid);
        });
        const box = members.length ? members : model.nodes;
        if (!box.length) continue;
        const minX = Math.min(...box.map((n) => n.x));
        const minY = Math.min(...box.map((n) => n.y));
        const maxX = Math.max(...box.map((n) => n.x + n.width));
        const maxY = Math.max(...box.map((n) => n.y + n.height));
        px = minX - HEADER - LANE_HEAD - PAD;
        py = minY - PAD;
        pw = (maxX - minX) + HEADER + LANE_HEAD + PAD * 2;
        ph = (maxY - minY) + PAD * 2;
      }
      if (proc?.flowElements && part.id) {
        for (const fe of proc.flowElements) {
          if (fe.id) flowNodePoolId.set(fe.id, part.id);
        }
      }
      const isHorizontal = part.id ? ((diShapes.get(part.id) as { isHorizontal?: boolean } | undefined)?.isHorizontal !== false) : true;
      // `processRef` may exist as an unresolved reference object without `id`.
      // Treat participants without a concrete processRef id as black-box pools.
      const isBlackBox = !processRefId;
      pools.push({
        id: part.id ?? `pool_${pools.length}`,
        shape: "bpmn-pool",
        x: px, y: py, width: pw, height: ph,
        label: part.name ?? "",
        attrs: {
          lanes: laneAttrs.length ? laneAttrs : undefined,
          poolHorizontal: isHorizontal,
          blackBox: isBlackBox,
          __source: { format: "bpmn", sourceId: part.id, kind: "pool" },
        },
      });
    }
  }
  for (const n of model.nodes) {
    const pid = flowNodePoolId.get(n.id);
    if (pid) {
      n.attrs = { ...(n.attrs ?? {}), poolId: pid, __source: { ...((n.attrs?.__source as Record<string, unknown> | undefined) ?? {}), poolId: pid } };
    }
  }
  // Pools first → rendered at the back, flow nodes float on top.
  if (pools.length) model.nodes.unshift(...pools);

  const sourceMeta: SourceMeta = { format: "bpmn", payload: { raw, diagramIndex: chosenDiagramIndex } };
  return { model, warnings, sourceMeta };
}
