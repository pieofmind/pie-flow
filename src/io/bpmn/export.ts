import { BpmnModdle } from "bpmn-moddle";
import type { CanvasModel } from "../../canvas/types";
import type { SourceMeta } from "../types";
import { allLaneIds, asStackLanes, laneHeights, type PoolLane } from "../../canvas/laneLayout";
import { SHAPE_TO_BPMN, TRIGGER_TO_EVENT_DEF } from "./shapes";
import { defaultLabelDy, hasExternalLabel } from "./labelGeometry";

/**
 * BPMN 2.0 exporter — uses `bpmn-moddle` so all namespace handling, attribute
 * escaping and unknown-element preservation comes for free.
 *
 * Round-trip path (when a sourceMeta with the original XML is present):
 *   1. Parse raw XML back into the moddle tree (preserves everything: lanes,
 *      pools, data objects, message flows, custom namespaces, unknown attrs).
 *   2. Patch every flow node's BPMNShape bounds to the model's current
 *      x/y/width/height. Add new flow nodes the user created (with shape +
 *      waypoints). Drop nodes the user deleted from the model.
 *   3. Patch / add BPMNEdge waypoints from edge vertices.
 *   4. Serialize back to XML.
 *
 * Cold path (no sourceMeta): build a minimal `bpmn:Definitions` tree from the
 * model directly. Result is a clean valid BPMN 2.0 file with a single process.
 */

interface ModdleElement {
  $type: string;
  id?: string;
  name?: string;
  sourceRef?: ModdleElement | string;
  targetRef?: ModdleElement | string;
  flowElements?: ModdleElement[];
  rootElements?: ModdleElement[];
  participants?: ModdleElement[];
  messageFlows?: ModdleElement[];
  artifacts?: ModdleElement[];
  laneSets?: ModdleElement[];
  lanes?: ModdleElement[];
  flowNodeRef?: Array<ModdleElement | string>;
  diagrams?: Array<{ $type: string; plane: { planeElement?: ModdleElement[]; bpmnElement?: ModdleElement | string }; }>;
  bpmnElement?: ModdleElement | string;
  bounds?: { x: number; y: number; width: number; height: number };
  waypoint?: Array<{ x: number; y: number }>;
  label?: { bounds?: { x: number; y: number; width: number; height: number } };
  // SequenceFlow extras (Phase A)
  conditionExpression?: ModdleElement;
  default?: ModdleElement | string;
  // Association extras (Phase A)
  associationDirection?: "None" | "One" | "Both";
  $attrs?: Record<string, string>;
  $parent?: ModdleElement;
}

let moddleSingleton: BpmnModdle | null = null;
function moddle(): BpmnModdle {
  if (!moddleSingleton) moddleSingleton = new BpmnModdle();
  return moddleSingleton;
}

function shapeToBpmnType(shape: string, attrs?: { attachedTo?: string; markers?: string[] }): string {
  // Đợt F — if an intermediate event has attachedTo, export it as BoundaryEvent
  // (not IntermediateThrowEvent) per OMG.
  if (shape === "bpmn-event-intermediate" && attrs?.attachedTo) return "bpmn:BoundaryEvent";
  // A task drawn with the ⊞ marker is a (collapsed) sub-process in BPMN.
  if (attrs?.markers?.includes("subprocess") && (SHAPE_TO_BPMN[shape] ?? "task") === "task") return "bpmn:SubProcess";
  const tag = SHAPE_TO_BPMN[shape] ?? "task";
  return "bpmn:" + tag.charAt(0).toUpperCase() + tag.slice(1);
}

const isCollapsed = (n: { attrs?: unknown }): boolean => (n.attrs as { collapsed?: boolean } | undefined)?.collapsed === true;

/** BPMN node attrs Đợt F — read by `applyBpmnExtras` to inject moddle children. */
interface BpmnNodeAttrs {
  trigger?: string;
  throwing?: boolean;
  interrupting?: boolean;
  attachedTo?: string;
  markers?: string[];
  // Phase D
  bpmnDoc?: string;
  camunda?: Record<string, string>;
  bpmnProps?: Array<{ name: string; value: string }>;
  bpmnFill?: string;
  bpmnStroke?: string;
}

/** BPMN edge kind tag → bpmn:* element type + container slot. Phase A. */
type EdgeKind = "sequence" | "message" | "association";
/** Black-box pool = participant with no process (attrs.blackBox, set by import.ts). */
function isBlackBoxPool(pool: { attrs?: Record<string, unknown> }): boolean {
  return pool.attrs?.blackBox === true;
}

function edgeKindOf(e: CanvasModel["edges"][number]): EdgeKind {
  return (e.kind as EdgeKind | undefined) ?? "sequence";
}
function bpmnTypeForEdgeKind(kind: EdgeKind): string {
  if (kind === "message") return "bpmn:MessageFlow";
  if (kind === "association") return "bpmn:Association";
  return "bpmn:SequenceFlow";
}

/** Apply Phase A edge extras (conditionExpression, associationDirection) onto
 *  a moddle element. `default` is set on the SOURCE gateway, handled separately. */
function applyEdgeExtras(m: BpmnModdle, fe: ModdleElement, kind: EdgeKind, attrs: CanvasModel["edges"][number]["attrs"] | undefined): void {
  if (kind === "sequence") {
    if (attrs?.condition) {
      const ce = m.create("bpmn:FormalExpression", { body: attrs.condition }) as ModdleElement;
      fe.conditionExpression = ce;
    } else {
      // Strip prior condition if it was removed.
      delete fe.conditionExpression;
    }
  }
  if (kind === "association") {
    if (attrs?.associationDirection) {
      fe.associationDirection = attrs.associationDirection;
    } else {
      delete fe.associationDirection;
    }
  }
}

/** Locate (or lazily create) the Collaboration root in the definitions tree.
 *  Required to host MessageFlows. Returns null when no Collaboration exists
 *  and one cannot be inferred (no pool nodes in the model → no collaboration
 *  context, so MessageFlow would be invalid BPMN). */
function findCollaboration(defs: ModdleElement): ModdleElement | null {
  for (const root of defs.rootElements ?? []) {
    if (root.$type === "bpmn:Collaboration") return root;
  }
  return null;
}

/** Inject eventDefinitions + loopCharacteristics + isInterrupting + isForCompensation
 *  + triggeredByEvent + isCollection onto a freshly-created or patched moddle element.
 *  Đợt F. */
function applyBpmnExtras(m: BpmnModdle, fe: ModdleElement, shape: string, attrs: BpmnNodeAttrs): void {
  // Event trigger → <bpmn:xxxEventDefinition/> (idempotent; replaces existing if present)
  if (attrs.trigger && TRIGGER_TO_EVENT_DEF[attrs.trigger]) {
    const defName = TRIGGER_TO_EVENT_DEF[attrs.trigger];
    const defType = "bpmn:" + defName.charAt(0).toUpperCase() + defName.slice(1);
    const def = m.create(defType, {}) as ModdleElement;
    (fe as ModdleElement & { eventDefinitions?: ModdleElement[] }).eventDefinitions = [def];
  }
  // Loop / multi-instance
  const markers = attrs.markers ?? [];
  if (markers.includes("mi-par") || markers.includes("mi-seq")) {
    const loop = m.create("bpmn:MultiInstanceLoopCharacteristics", { isSequential: markers.includes("mi-seq") }) as ModdleElement;
    (fe as ModdleElement & { loopCharacteristics?: ModdleElement }).loopCharacteristics = loop;
  } else if (markers.includes("loop")) {
    const loop = m.create("bpmn:StandardLoopCharacteristics", {}) as ModdleElement;
    (fe as ModdleElement & { loopCharacteristics?: ModdleElement }).loopCharacteristics = loop;
  }
  if (markers.includes("compensation")) {
    (fe as ModdleElement & { isForCompensation?: boolean }).isForCompensation = true;
  }
  // Interrupting (event-subprocess start + boundary)
  if (attrs.interrupting === false) {
    if (shape === "bpmn-event-start") {
      (fe as ModdleElement & { isInterrupting?: boolean }).isInterrupting = false;
    } else {
      // boundary uses cancelActivity (true=interrupting per spec; false=non-interrupting)
      (fe as ModdleElement & { cancelActivity?: boolean }).cancelActivity = false;
    }
  }
  // Boundary attachment
  if (attrs.attachedTo) {
    (fe as ModdleElement & { attachedToRef?: { id: string } }).attachedToRef = { id: attrs.attachedTo };
  }
  // Event sub-process: subProcess + triggeredByEvent=true
  if (shape === "bpmn-event-subprocess") {
    (fe as ModdleElement & { triggeredByEvent?: boolean }).triggeredByEvent = true;
  }
  // Collection flag for data object collection
  if (shape === "bpmn-data-collection") {
    (fe as ModdleElement & { isCollection?: boolean }).isCollection = true;
  }
  // Phase D — documentation text.
  if (typeof attrs.bpmnDoc === "string" && attrs.bpmnDoc.trim()) {
    const doc = m.create("bpmn:Documentation", { text: attrs.bpmnDoc.trim() }) as ModdleElement;
    (fe as ModdleElement & { documentation?: ModdleElement[] }).documentation = [doc];
  } else {
    // Clear stale documentation when user deleted the text.
    delete (fe as ModdleElement & { documentation?: unknown }).documentation;
  }
  // Phase D — Camunda extensionElements. We preserve the raw extensionElements
  // from the source XML (bpmn-moddle keeps unknown namespaces intact), so here
  // we only need to UPDATE the known scalar fields when the user changed them.
  // This avoids clobbering listener configs that the importer doesn't surface.
  if (attrs.camunda && Object.keys(attrs.camunda).length) {
    const existing = (fe as ModdleElement & {
      extensionElements?: { values?: Array<Record<string, unknown>> };
    }).extensionElements;
    // Find existing camunda:TaskDefinition / camunda:ExecutionListener parent or
    // just patch the first value that has a matching key; fall back to no-op if
    // structure isn't recognised (round-trip through raw moddle is sufficient).
    if (existing?.values) {
      for (const v of existing.values) {
        for (const [k, val] of Object.entries(attrs.camunda)) {
          if (k in v) v[k] = val;
        }
      }
    }
  }
}

function escAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]!));
}

function escText(value: string): string {
  return value.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
}

const BPMN_ID_START_RE = /^[A-Za-z_]/;
const BPMN_ID_CHAR_RE = /[^A-Za-z0-9_.-]/g;

function normalizeBpmnId(raw: string, prefix: string, used: Set<string>): string {
  const seed = String(raw ?? "").trim();
  let base = seed ? seed.replace(BPMN_ID_CHAR_RE, "_") : prefix;
  if (!base) base = prefix;
  if (!BPMN_ID_START_RE.test(base)) base = `${prefix}_${base}`;
  let out = base;
  let n = 1;
  while (used.has(out)) out = `${base}_${++n}`;
  used.add(out);
  return out;
}

function normalizeModelIdsForBpmn(model: CanvasModel): CanvasModel {
  const used = new Set<string>();
  const nodeMap = new Map<string, string>();
  const edgeMap = new Map<string, string>();
  const laneMap = new Map<string, string>();

  for (const n of model.nodes) nodeMap.set(n.id, normalizeBpmnId(n.id, "N", used));
  for (const e of model.edges) edgeMap.set(e.id, normalizeBpmnId(e.id, "E", used));
  for (const n of model.nodes) {
    const lanes = (n.attrs?.lanes as ModelLane[] | undefined) ?? [];
    for (const id of allLaneIds(lanes)) {
      if (!id || laneMap.has(id)) continue;
      laneMap.set(id, normalizeBpmnId(id, "L", used));
    }
  }
  for (const n of model.nodes) {
    if (!n.laneId || laneMap.has(n.laneId)) continue;
    laneMap.set(n.laneId, normalizeBpmnId(n.laneId, "L", used));
  }

  return {
    nodes: model.nodes.map((n) => {
      const renameLanes = (list: ModelLane[]): ModelLane[] => list.map((ln) => ({
        ...ln,
        id: laneMap.get(ln.id) ?? ln.id,
        ...(ln.lanes ? { lanes: renameLanes(ln.lanes) } : {}),
      }));
      const lanes = n.attrs?.lanes ? renameLanes(n.attrs.lanes as ModelLane[]) : undefined;
      return {
        ...n,
        id: nodeMap.get(n.id) ?? n.id,
        ...(n.parentId ? { parentId: nodeMap.get(n.parentId) ?? n.parentId } : {}),
        ...(n.laneId ? { laneId: laneMap.get(n.laneId) ?? n.laneId } : {}),
        attrs: lanes ? { ...(n.attrs ?? {}), lanes } : n.attrs,
      };
    }),
    edges: model.edges.map((e) => ({
      ...e,
      id: edgeMap.get(e.id) ?? e.id,
      source: nodeMap.get(e.source) ?? e.source,
      target: nodeMap.get(e.target) ?? e.target,
    })),
  };
}

function patchCamundaXml(xml: string, model: CanvasModel): string {
  const nodes = model.nodes.filter((n) => {
    const attrs = (n.attrs ?? {}) as BpmnNodeAttrs;
    return (attrs.camunda && Object.keys(attrs.camunda).length > 0) || (attrs.bpmnProps?.length ?? 0) > 0;
  });
  if (!nodes.length) return xml;

  let out = xml;
  if (!/\sxmlns:camunda=/.test(out)) {
    out = out.replace(/<bpmn:definitions\b([^>]*)>/, `<bpmn:definitions$1 xmlns:camunda="http://camunda.org/schema/1.0/bpmn">`);
  }

  for (const n of nodes) {
    const attrs = (n.attrs ?? {}) as BpmnNodeAttrs;
    const camunda = attrs.camunda ?? {};
    const props = attrs.bpmnProps?.filter((p) => p.name) ?? [];
    const id = escAttr(n.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tagRe = new RegExp(`<bpmn:([A-Za-z]+)\\b([^>]*)\\bid="${id}"([^>]*)>`);
    const match = tagRe.exec(out);
    if (!match) continue;

    const [full, tagName, beforeId, afterId] = match;
    let open = full;
    for (const [key, value] of Object.entries(camunda)) {
      if (!value) continue;
      const attrName = `camunda:${key}`;
      const attrRe = new RegExp(`\\s${attrName}="[^"]*"`);
      const encoded = ` ${attrName}="${escAttr(String(value))}"`;
      open = attrRe.test(open) ? open.replace(attrRe, encoded) : open.replace(/\/?>$/, `${encoded}$&`);
    }
    if (open !== full) out = out.slice(0, match.index) + open + out.slice(match.index + full.length);

    if (!props.length) continue;
    const rematch = new RegExp(`<bpmn:${tagName}\\b[^>]*\\bid="${id}"[^>]*>`).exec(out);
    if (!rematch) continue;
    const currentOpen = rematch[0];
    const propsXml = `<camunda:properties>${props.map((p) => `<camunda:property name="${escAttr(p.name)}" value="${escAttr(p.value ?? "")}" />`).join("")}</camunda:properties>`;

    if (currentOpen.endsWith("/>")) {
      const expanded = currentOpen.replace(/\s*\/>$/, `><bpmn:extensionElements>${propsXml}</bpmn:extensionElements></bpmn:${tagName}>`);
      out = out.slice(0, rematch.index) + expanded + out.slice(rematch.index + currentOpen.length);
      continue;
    }

    const closeRe = new RegExp(`</bpmn:${tagName}>`);
    const close = closeRe.exec(out.slice(rematch.index + currentOpen.length));
    if (!close) continue;
    const blockStart = rematch.index;
    const blockEnd = rematch.index + currentOpen.length + close.index + close[0].length;
    const block = out.slice(blockStart, blockEnd);
    let nextBlock: string;
    if (/<bpmn:extensionElements\b[\s\S]*?<\/bpmn:extensionElements>/.test(block)) {
      nextBlock = block.replace(
        /<camunda:properties\b[\s\S]*?<\/camunda:properties>/,
        propsXml,
      );
      if (nextBlock === block) {
        nextBlock = block.replace(/<bpmn:extensionElements\b[^>]*>/, (m0) => `${m0}${propsXml}`);
      }
    } else {
      nextBlock = block.replace(currentOpen, `${currentOpen}<bpmn:extensionElements>${propsXml}</bpmn:extensionElements>`);
    }
    out = out.slice(0, blockStart) + nextBlock + out.slice(blockEnd);
  }
  return out;
}

/** Locate an existing <participant> by id inside any collaboration. */
function findParticipant(defs: ModdleElement, id: string): ModdleElement | undefined {
  for (const root of defs.rootElements ?? []) {
    if (root.$type !== "bpmn:Collaboration") continue;
    const found = (root.participants ?? []).find((p) => p.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Locate an existing <lane> by id inside a process's laneSets. */
function findLane(process: ModdleElement, id: string): ModdleElement | undefined {
  const inLanes = (lanes: ModdleElement[] | undefined): ModdleElement | undefined => {
    for (const l of lanes ?? []) {
      if (l.id === id) return l;
      const hit = inLanes((l as { childLaneSet?: { lanes?: ModdleElement[] } }).childLaneSet?.lanes);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const ls of process.laneSets ?? []) {
    const found = inLanes(ls.lanes);
    if (found) return found;
  }
  return undefined;
}

type ModelLane = PoolLane & { width?: number; lanes?: ModelLane[] };

/** A bpmn:Lane for a model lane, with a childLaneSet holding its child lanes. */
function createLaneEl(m: BpmnModdle, ln: ModelLane, idOf: (id: string) => string = (id) => id): ModdleElement {
  const el = m.create("bpmn:Lane", { id: idOf(ln.id), name: ln.label ?? ln.id }) as ModdleElement;
  if (ln.lanes?.length) {
    (el as { childLaneSet?: ModdleElement }).childLaneSet = m.create("bpmn:LaneSet", {
      id: `LaneSet_${el.id}`,
      lanes: ln.lanes.map((c) => createLaneEl(m, c, idOf)),
    }) as ModdleElement;
  }
  return el;
}

/** Set every lane's flowNodeRef from the shapes' (leaf) laneId; a lane with
 *  child lanes references the union of its children's shapes. */
function fillLaneRefs(lanes: ModdleElement[] | undefined, refsOf: (laneId: string) => ModdleElement[]): ModdleElement[] {
  const all: ModdleElement[] = [];
  for (const ln of lanes ?? []) {
    const children = (ln as { childLaneSet?: { lanes?: ModdleElement[] } }).childLaneSet?.lanes;
    const own = ln.id ? refsOf(ln.id) : [];
    const refs = children?.length ? [...fillLaneRefs(children, refsOf), ...own] : own;
    ln.flowNodeRef = refs;
    all.push(...refs);
  }
  return all;
}

// pool vertical title strip width — MUST match bpmn-js's internal participant
// header constant (30px). Using a different value causes bpmn-js to draw its
// default divider line at x=30 while our lanes start at x=POOL_HEADER, leaving
// an empty band that looks like a second nested pool frame.
const POOL_HEADER = 30;
const LANE_HEADER = 30;  // lane vertical title strip
const POOL_MARGIN = 40;  // padding between content bbox and pool edges

export async function exportBpmn(model: CanvasModel, meta?: SourceMeta | null): Promise<string> {
  const normalizedModel = normalizeModelIdsForBpmn(model);
  const m = moddle();
  if (meta?.format === "bpmn") {
    const raw = String((meta.payload as { raw?: string })?.raw ?? "");
    const diagramIndex = Number((meta.payload as { diagramIndex?: number } | undefined)?.diagramIndex ?? 0);
    if (raw) {
      try {
        return await patchExisting(raw, normalizedModel, m, Number.isFinite(diagramIndex) ? diagramIndex : 0);
      } catch (err) {
        // Safety net: malformed/partial raw XML (or unsupported legacy DI bits)
        // should not block export entirely. Fall back to minimal emit so users
        // still get a valid BPMN document instead of a hard crash.
        console.warn("[omniboard:bpmn] patchExisting failed; falling back to minimal export", err);
      }
    }
  }
  return emitMinimal(normalizedModel, m);
}

/** Round-trip the original XML, patching bounds + waypoints, adding new flow
 *  nodes and edges, dropping deleted ones. */
async function patchExisting(raw: string, model: CanvasModel, m: BpmnModdle, diagramIndex = 0): Promise<string> {
  const { rootElement: defs } = await m.fromXML(raw, "bpmn:Definitions");
  const definitions = defs as ModdleElement;

  // Index DI shapes/edges by referenced bpmnElement id.
  const diShape = new Map<string, ModdleElement>();
  const diEdge = new Map<string, ModdleElement>();
  let mainPlane: { planeElement?: ModdleElement[]; bpmnElement?: ModdleElement | string } | null = null;
  const diagrams = definitions.diagrams ?? [];
  if (diagrams.length) {
    mainPlane = diagrams[Math.max(0, Math.min(diagramIndex, diagrams.length - 1))].plane;
  }
  if (!mainPlane && diagrams[0]) mainPlane = diagrams[0].plane;
  if (mainPlane) {
    for (const pe of mainPlane.planeElement ?? []) {
      const refId = typeof pe.bpmnElement === "string" ? pe.bpmnElement : pe.bpmnElement?.id;
      if (!refId) continue;
      if (pe.$type === "bpmndi:BPMNShape") diShape.set(refId, pe);
      else if (pe.$type === "bpmndi:BPMNEdge") diEdge.set(refId, pe);
    }
  }
  if (!mainPlane) throw new Error("BPMN export: source document has no BPMNPlane.");

  // Find the first root process (most BPMN docs have exactly one).
  const process = (definitions.rootElements ?? []).find((r) => r.$type === "bpmn:Process") ?? null;
  if (!process) throw new Error("BPMN export: source document has no bpmn:Process.");

  // Index existing flow elements by id so we can patch/drop/keep.
  // Phase B — also track each element's direct parent container so we can
  // detach + reattach when the model's parentId changes (e.g. user dragged
  // a task out of a subprocess).
  const flowById = new Map<string, ModdleElement>();
  const containerOf = new Map<string, ModdleElement>();
  const collect = (parent: ModdleElement): void => {
    for (const fe of parent.flowElements ?? []) {
      if (fe.id) { flowById.set(fe.id, fe); containerOf.set(fe.id, parent); }
      if (fe.flowElements) collect(fe);
    }
    for (const ar of parent.artifacts ?? []) {
      if (ar.id && ar.$type === "bpmn:Association") { flowById.set(ar.id, ar); containerOf.set(ar.id, parent); }
    }
  };
  collect(process);
  // MessageFlows live on the Collaboration root, not the Process.
  const collaboration = findCollaboration(definitions);
  if (collaboration) {
    for (const mf of collaboration.messageFlows ?? []) {
      if (mf.id) flowById.set(mf.id, mf);
    }
  }

  const modelNodeIds = new Set(model.nodes.map((n) => n.id));
  const endpointIds = new Set<string>(flowById.keys());
  for (const ar of process.artifacts ?? []) if (ar.id) endpointIds.add(ar.id);
  for (const p of collaboration?.participants ?? []) if (p.id) endpointIds.add(p.id);
  // Keep only edges whose endpoints still exist either in the current canvas
  // nodes or as preserved BPMN endpoints from the source XML (e.g. imported
  // text annotations/participants that are not editable nodes yet).
  const validModelEdges = model.edges.filter((e) =>
    (modelNodeIds.has(e.source) || endpointIds.has(e.source)) &&
    (modelNodeIds.has(e.target) || endpointIds.has(e.target)),
  );
  const modelEdgeIds = new Set(validModelEdges.map((e) => e.id));
  // Split model edges by kind so each container (process flowElements,
  // process artifacts, collaboration messageFlows) is patched independently.
  const modelEdgeKind = new Map<string, EdgeKind>(validModelEdges.map((e) => [e.id, edgeKindOf(e)]));
  const modelSequenceEdgeIds = new Set(validModelEdges.filter((e) => edgeKindOf(e) === "sequence").map((e) => e.id));
  const modelAssociationEdgeIds = new Set(validModelEdges.filter((e) => edgeKindOf(e) === "association").map((e) => e.id));
  const modelMessageEdgeIds = new Set(validModelEdges.filter((e) => edgeKindOf(e) === "message").map((e) => e.id));

  // (1) Patch existing nodes' bounds; add new ones; drop deleted.
  for (const n of model.nodes) {
    // Pool nodes are containers (participants), not flow elements — they
    // already live in the source <collaboration>. Don't emit a bpmn:task for
    // them; just patch (or add) their Participant BPMNShape DI bounds so the
    // pool wraps its contents at the size Omniboard computed.
    // Pool nodes are containers (participants), not flow elements. Defer them
    // to a dedicated pass AFTER all flow-node shapes are patched, so the pool
    // bbox can be computed from final bounds (see emitPoolLaneShapes).
    const srcKind = (n.attrs?.__source as { kind?: string } | undefined)?.kind;
    const isPool = n.shape === "bpmn-pool" || srcKind === "pool";
    const isLane = n.shape === "bpmn-lane" || srcKind === "lane";
    if (isPool || isLane) continue;
    // Phase B — choose the BPMN container for this node based on parentId.
    // parentId references the id of a subprocess (already in flowById once
    // patched). If unset OR target container missing → fall back to top-level
    // process. If parentId points to a node not yet processed in this loop
    // (rare; only when caller emits children before their container), the
    // fallback is still safe because the next outer-iteration patch will
    // relocate anything mis-rooted.
    const targetContainer: ModdleElement = (n.parentId && flowById.get(n.parentId)) || process;
    let di = diShape.get(n.id);
    if (di?.bounds) {
      di.bounds.x = n.x; di.bounds.y = n.y; di.bounds.width = n.width; di.bounds.height = n.height;
      const nLabel = nodeLabelBoundsFromModel(m, n);
      di.label = nLabel ? (m.create("bpmndi:BPMNLabel", { bounds: nLabel }) as never) : undefined;
      // Phase C — write isExpanded back from model.attrs.collapsed.
      const collapsed = (n.attrs as { collapsed?: boolean } | undefined)?.collapsed === true;
      (di as ModdleElement & { isExpanded?: boolean }).isExpanded = !collapsed;
      // Phase D — bioc/color-spec colors: write from bpmnFill/bpmnStroke
      // (set by the properties panel) back onto DI $attrs so bpmn.io renders them.
      const bpmnFill = (n.attrs as BpmnNodeAttrs | undefined)?.bpmnFill;
      const bpmnStroke = (n.attrs as BpmnNodeAttrs | undefined)?.bpmnStroke;
      const shapeAttrs = (di.$attrs ??= {});
      if (bpmnFill) shapeAttrs["bioc:fill"] = bpmnFill;
      else { delete shapeAttrs["bioc:fill"]; delete shapeAttrs["color:background-color"]; }
      if (bpmnStroke) shapeAttrs["bioc:stroke"] = bpmnStroke;
      else { delete shapeAttrs["bioc:stroke"]; delete shapeAttrs["color:border-color"]; }
    } else {
      const fe = m.create(shapeToBpmnType(n.shape, n.attrs as BpmnNodeAttrs), n.shape === "bpmn-annotation" ? { id: n.id, text: n.label ?? "" } : n.shape === "bpmn-group" ? { id: n.id } : { id: n.id, name: n.label ?? "" }) as ModdleElement;
      applyBpmnExtras(m, fe, n.shape, (n.attrs ?? {}) as BpmnNodeAttrs);
      (targetContainer.flowElements ??= []).push(fe);
      flowById.set(n.id, fe);
      containerOf.set(n.id, targetContainer);
      di = m.create("bpmndi:BPMNShape", {
        bpmnElement: fe,
        bounds: m.create("dc:Bounds", { x: n.x, y: n.y, width: n.width, height: n.height }),
        ...(isCollapsed(n) ? { isExpanded: false } : {}),
      }) as ModdleElement;
      (mainPlane.planeElement ??= []).push(di);
      diShape.set(n.id, di);
    }
    // Phase B — if the user moved this node to/from a subprocess, detach
    // from the old container and re-push into the new one. Only act when
    // the actual parent element differs from the desired container.
    let existing = flowById.get(n.id);
    const curContainer = containerOf.get(n.id);
    // The ⊞ marker was added to a task read from the file: swap in a
    // sub-process with the same id and properties (refs serialise by id).
    if (existing?.$type === "bpmn:Task" && curContainer && shapeToBpmnType(n.shape, n.attrs as BpmnNodeAttrs) === "bpmn:SubProcess") {
      const { $type: _t, ...props } = Object.fromEntries(Object.entries(existing)) as Record<string, unknown>;
      const sub = m.create("bpmn:SubProcess", props) as ModdleElement;
      const old = existing;
      curContainer.flowElements = (curContainer.flowElements ?? []).map((fe) => (fe === old ? sub : fe));
      if (di) di.bpmnElement = sub;
      flowById.set(n.id, sub);
      existing = sub;
    }
    if (existing && curContainer && curContainer !== targetContainer) {
      curContainer.flowElements = (curContainer.flowElements ?? []).filter((fe) => fe.id !== n.id);
      (targetContainer.flowElements ??= []).push(existing);
      containerOf.set(n.id, targetContainer);
    }
    // Patch name + BPMN extras (Đợt F) on existing nodes too — survives
    // re-export when user adds a trigger/marker after import.
    if (existing) {
      if (typeof n.label === "string") {
        if (n.shape === "bpmn-annotation") (existing as { text?: string }).text = n.label; else if (n.shape !== "bpmn-group") existing.name = n.label;
      }
      applyBpmnExtras(m, existing, n.shape, (n.attrs ?? {}) as BpmnNodeAttrs);
    }
  }
  // Drop deleted flow nodes from process + DI — but preserve any element a
  // surviving SequenceFlow still references via sourceRef/targetRef (e.g.
  // DataObjects, TextAnnotations, sub-process children the importer doesn't
  // map to canvas nodes). Otherwise the export would leave dangling refs.
  const refIdOf = (r: ModdleElement | string | undefined): string | undefined =>
    typeof r === "string" ? r : r?.id;
  // Build `referenced` from every surviving edge (sequence + association +
  // message). `flowById` is a stale snapshot taken before new nodes/edges
  // were appended, so don't gate on it — use modelEdgeIds as the SoT.
  const referenced = new Set<string>();
  const collectRefs = (fe: ModdleElement): void => {
    if (!fe.id || !modelEdgeIds.has(fe.id)) return;
    const src = refIdOf(fe.sourceRef);
    const tgt = refIdOf(fe.targetRef);
    if (src) referenced.add(src);
    if (tgt) referenced.add(tgt);
  };
  for (const fe of process.flowElements ?? []) {
    if (fe.$type === "bpmn:SequenceFlow") collectRefs(fe);
  }
  for (const ar of process.artifacts ?? []) {
    if (ar.$type === "bpmn:Association") collectRefs(ar);
  }
  if (collaboration) {
    for (const mf of collaboration.messageFlows ?? []) collectRefs(mf);
  }

  // Phase B — drop deleted flow elements recursively through nested
  // subprocesses (not only at top level). Otherwise a node deleted from
  // inside a subProcess would survive the export.
  const filterFlowElements = (parent: ModdleElement): void => {
    parent.flowElements = (parent.flowElements ?? []).filter((fe) => {
      if (fe.$type === "bpmn:SequenceFlow") return modelSequenceEdgeIds.has(fe.id!);
      const survives = modelNodeIds.has(fe.id!) || referenced.has(fe.id!);
      return survives;
    });
    for (const fe of parent.flowElements) {
      if (fe.flowElements) filterFlowElements(fe);
    }
  };
  filterFlowElements(process);
  // Phase B — rebuild every Lane's flowNodeRef from the model's laneId field.
  // The exporter is the single source of truth: any stale ref in the source
  // XML is dropped, and every node with laneId set is added to its lane.
  // Lane elements themselves are preserved; we only rewrite their member list.
  {
    const byLaneId = new Map<string, string[]>();
    for (const n of model.nodes) {
      if (!n.laneId) continue;
      const arr = byLaneId.get(n.laneId) ?? [];
      arr.push(n.id);
      byLaneId.set(n.laneId, arr);
    }
    // Resolve each id to its moddle element so the serializer emits a proper
    // IDREF (`<flowNodeRef>id</flowNodeRef>`) tied to the actual element.
    // flowById already contains every surviving flow node.
    const refsOf = (laneId: string) => (byLaneId.get(laneId) ?? [])
      .map((id) => flowById.get(id))
      .filter((fe): fe is ModdleElement => !!fe);
    for (const ls of process.laneSets ?? []) fillLaneRefs(ls.lanes, refsOf);
  }
  // Filter artifacts (Associations + TextAnnotation + Group). Keep Associations
  // only if still in the model; keep non-Association artifacts verbatim
  // (TextAnnotation/Group survive even if Omniboard doesn't track them yet).
  if (process.artifacts) {
    process.artifacts = process.artifacts.filter((ar) => {
      if (ar.$type === "bpmn:Association") return modelAssociationEdgeIds.has(ar.id!);
      return true;
    });
  }
  // Filter MessageFlows on the Collaboration.
  if (collaboration?.messageFlows) {
    collaboration.messageFlows = collaboration.messageFlows.filter((mf) => modelMessageEdgeIds.has(mf.id!));
  }
  // Track which ids belong to flow nodes (the things the canvas owns/once
  // owned). Anything else referenced by a BPMNShape — pools (participants),
  // lanes, groups, data objects, text annotations — is a CONTAINER element
  // that lives outside `process.flowElements`. We must preserve those DI
  // shapes verbatim; without the pool/lane shape the importer in bpmn.io
  // has nothing to anchor the rendered diagram to and every node floats.
  const flowNodeIdSet = new Set<string>([...flowById.keys(), ...modelNodeIds]);
  mainPlane.planeElement = (mainPlane.planeElement ?? []).filter((pe: ModdleElement) => {
    const refId = typeof pe.bpmnElement === "string" ? pe.bpmnElement : pe.bpmnElement?.id;
    if (!refId) return true;
    if (pe.$type === "bpmndi:BPMNEdge") return modelEdgeIds.has(refId);
    if (pe.$type === "bpmndi:BPMNShape") {
      // Only filter shapes for flow nodes — keep pool/lane/group/etc.
      if (!flowNodeIdSet.has(refId)) return true;
      return modelNodeIds.has(refId) || referenced.has(refId);
    }
    return true;
  });

  // (1b) Pool/lane DI — emit AFTER flow shapes are patched so the pool bbox is
  //      computed from final bounds. Verified against bpmn-js@17: this renders
  //      the swimlane correctly (parent-first order + exact lane tiling).
  emitPoolLaneShapes(model, definitions, process, mainPlane, diShape, m);

  // (2) Patch edges — waypoints from model.vertices (+ endpoint anchors derived
  //     from node bounds). Add new ones; drop deleted (already handled above).
  for (const e of validModelEdges) {
    const srcNode = model.nodes.find((n) => n.id === e.source);
    const tgtNode = model.nodes.find((n) => n.id === e.target);
    if (!srcNode || !tgtNode) continue;
    const kind = edgeKindOf(e);
    let de = diEdge.get(e.id);
    const wps = buildWaypoints(e, srcNode, tgtNode, m);
    // Resolve or create the bpmn:* edge element. Container differs by kind.
    let sf = flowById.get(e.id);
    if (!sf) {
      // MessageFlow may end on a participant (black-box pool) — BPMN 2.0 §9.3.
      const refOf = (id: string) => flowById.get(id)
        ?? (kind === "message" ? collaboration?.participants?.find((p: ModdleElement) => p.id === id) : undefined);
      const sourceFe = refOf(e.source);
      const targetFe = refOf(e.target);
      if (!sourceFe || !targetFe) {
        console.warn(`[omniboard:bpmn] dropped ${kind} flow "${e.id}": endpoint has no BPMN element (${e.source} → ${e.target})`);
        continue;
      }
      // No collaboration → a MessageFlow has no valid host: write it as a
      // SequenceFlow on the process so the edge isn't silently dropped.
      const orphanMessage = kind === "message" && !collaboration;
      sf = m.create(orphanMessage ? "bpmn:SequenceFlow" : bpmnTypeForEdgeKind(kind), {
        id: e.id,
        // bpmn:Association is an artifact with no `name` in the BPMN schema.
        ...(kind === "association" ? {} : { name: e.label ?? "" }),
        sourceRef: sourceFe,
        targetRef: targetFe,
      }) as ModdleElement;
      if (kind === "message") {
        if (!collaboration) {
          // (Round-trip will downgrade kind on next import.)
          (process.flowElements ??= []).push(sf);
        } else {
          (collaboration.messageFlows ??= []).push(sf);
        }
      } else if (kind === "association") {
        (process.artifacts ??= []).push(sf);
      } else {
        (process.flowElements ??= []).push(sf);
      }
      flowById.set(e.id, sf);
    } else if (typeof e.label === "string" && kind !== "association") {
      // Associations carry no `name`; re-export must not re-stamp one.
      sf.name = e.label;
    }
    // Apply Phase A extras (condition / associationDirection) every export.
    applyEdgeExtras(m, sf, kind, e.attrs);
    if (de) {
      de.waypoint = wps;
      const lb = edgeLabelBoundsFromModel(m, e, wps);
      de.label = lb ? (m.create("bpmndi:BPMNLabel", { bounds: lb }) as unknown as { bounds?: { x: number; y: number; width: number; height: number } }) : undefined;
    } else {
      const lb = edgeLabelBoundsFromModel(m, e, wps);
      de = m.create("bpmndi:BPMNEdge", {
        bpmnElement: sf,
        waypoint: wps,
        ...(lb ? { label: m.create("bpmndi:BPMNLabel", { bounds: lb }) } : {}),
      }) as ModdleElement;
      (mainPlane.planeElement ??= []).push(de);
      diEdge.set(e.id, de);
    }
  }
  // Patch `default` attribute on source gateways/activities. Reset any stale
  // pointers first (an edge that LOST isDefault must clear its source's
  // default ref), then set fresh ones from edge.attrs.isDefault.
  for (const n of model.nodes) {
    const fe = flowById.get(n.id);
    if (fe && fe.default) delete fe.default;
  }
  for (const e of validModelEdges) {
    if (!e.attrs?.isDefault) continue;
    if (edgeKindOf(e) !== "sequence") continue;
    const srcFe = flowById.get(e.source);
    const edgeFe = flowById.get(e.id);
    if (srcFe && edgeFe) srcFe.default = edgeFe;
  }

  const { xml } = await m.toXML(definitions as never, { format: true });
  return patchCamundaXml(xml, model);
}

/**
 * Emit (or patch) Participant + Lane BPMNShapes for every pool node in the
 * model. Must run AFTER flow-node shapes are patched (it derives the pool bbox
 * from the model's flow nodes). Shapes are inserted parent-first
 * (participant → lanes → existing flow shapes) which bpmn-js requires to
 * resolve the container hierarchy — getting this order wrong produces a
 * misaligned, offset lane.
 */
function emitPoolLaneShapes(
  model: CanvasModel,
  definitions: ModdleElement,
  process: ModdleElement,
  mainPlane: { planeElement?: ModdleElement[]; bpmnElement?: ModdleElement | string },
  diShape: Map<string, ModdleElement>,
  m: BpmnModdle,
  processByPoolId?: Map<string, ModdleElement>,
  laneIdByPool?: Map<string, Map<string, string>>,
): void {
  const pools = model.nodes.filter((n) =>
    n.shape === "bpmn-pool" ||
    (n.attrs?.__source as { kind?: string } | undefined)?.kind === "pool",
  );
  if (!pools.length) return;
  let collaboration = findCollaboration(definitions);
  const ensureCollaboration = (): ModdleElement => {
    if (collaboration) return collaboration;
    collaboration = m.create("bpmn:Collaboration", { id: "Collaboration_Export" }) as ModdleElement;
    (definitions.rootElements ??= []).push(collaboration);
    return collaboration;
  };
  // Resolve "process for this pool" — falls back to the single shared
  // `process` arg when no per-pool map is provided (legacy single-pool path).
  const processForPool = (poolId: string): ModdleElement =>
    processByPoolId?.get(poolId) ?? process;
  const ensureLaneSetIn = (proc: ModdleElement): ModdleElement => {
    if ((proc.laneSets ?? []).length) return proc.laneSets![0];
    const laneSet = m.create("bpmn:LaneSet", { id: `LaneSet_${proc.id ?? "Process_Export"}` }) as ModdleElement;
    (proc.laneSets ??= []).push(laneSet);
    return laneSet;
  };

  // Flow nodes (everything that isn't a pool).
  const flow = model.nodes.filter((n) =>
    n.shape !== "bpmn-pool" &&
    (n.attrs?.__source as { kind?: string } | undefined)?.kind !== "pool",
  );

  // Each participant / lane is written at its Board rectangle, so switching to
  // the native view and back gives the same layout. Only a pool without a
  // usable size (hand-written model) falls back to hugging the flow nodes.
  const fallbackBox = () => {
    const minX = Math.min(...flow.map((n) => n.x));
    const minY = Math.min(...flow.map((n) => n.y));
    const maxX = Math.max(...flow.map((n) => n.x + n.width));
    const maxY = Math.max(...flow.map((n) => n.y + n.height));
    return {
      x: minX - POOL_HEADER - LANE_HEADER - POOL_MARGIN,
      y: minY - POOL_MARGIN,
      width: (maxX - minX) + POOL_HEADER + LANE_HEADER + POOL_MARGIN * 2,
      height: (maxY - minY) + POOL_MARGIN * 2,
    };
  };

  for (const pool of pools) {
    const prefix: ModdleElement[] = [];
    const poolProcess = processForPool(pool.id);
    const sized = pool.width > 0 && pool.height > 0;
    if (!sized && !flow.length) continue;
    const box = sized ? pool : fallbackBox();
    const poolX = box.x, poolY = box.y, poolW = box.width, poolH = box.height;
    const lanes = (pool.attrs?.lanes as ModelLane[] | undefined) ?? [];

    // Participant shape — patch existing or create new.
    let pdi = diShape.get(pool.id);
    if (pdi?.bounds) {
      pdi.bounds.x = poolX; pdi.bounds.y = poolY; pdi.bounds.width = poolW; pdi.bounds.height = poolH;
    } else {
      let part = findParticipant(definitions, pool.id);
      if (!part) {
        part = m.create("bpmn:Participant", {
          id: pool.id,
          name: pool.label ?? "Pool",
          // Each participant references its OWN process when multi-pool.
          ...(isBlackBoxPool(pool) ? {} : { processRef: poolProcess }),
        }) as ModdleElement;
        (ensureCollaboration().participants ??= []).push(part);
      }
      pdi = m.create("bpmndi:BPMNShape", {
        bpmnElement: part,
        bounds: m.create("dc:Bounds", { x: poolX, y: poolY, width: poolW, height: poolH }),
      }) as ModdleElement;
      const isHorizontal = (pool.attrs?.poolHorizontal as boolean | undefined) !== false;
      (pdi as { isHorizontal?: boolean }).isHorizontal = isHorizontal;
      diShape.set(pool.id, pdi);
      prefix.push(pdi);
    }

    // Lane shapes tile the pool interior (minus pool header) exactly as the
    // Board draws them: each lane's own height, else an equal split.
    if (lanes.length) {
      const horizontal = (pool.attrs?.poolHorizontal as boolean | undefined) !== false;
      const renamed = laneIdByPool?.get(pool.id);
      const emitLane = (ln: ModelLane, r: { x: number; y: number; width: number; height: number }, parentEl?: ModdleElement): void => {
        if (!ln.id) return;
        // The emitted id: a lane id duplicated across pools was renamed.
        const laneId = renamed?.get(ln.id) ?? ln.id;
        // Lane lives in THIS pool's process (multi-pool) or the shared
        // process (single-pool). findLane must look in the right process,
        // else we'd create a duplicate lane element when emitting DI.
        let laneEl = findLane(poolProcess, laneId);
        if (!laneEl) {
          laneEl = m.create("bpmn:Lane", { id: laneId, name: ln.label ?? ln.id }) as ModdleElement;
          if (parentEl) {
            const holder = parentEl as { childLaneSet?: ModdleElement };
            holder.childLaneSet ??= m.create("bpmn:LaneSet", { id: `LaneSet_${parentEl.id}`, lanes: [] }) as ModdleElement;
            (holder.childLaneSet.lanes ??= []).push(laneEl);
          } else {
            (ensureLaneSetIn(poolProcess).lanes ??= []).push(laneEl);
          }
        }
        let ldi = diShape.get(laneId);
        if (ldi?.bounds) {
          ldi.bounds.x = r.x; ldi.bounds.y = r.y; ldi.bounds.width = r.width; ldi.bounds.height = r.height;
        } else {
          ldi = m.create("bpmndi:BPMNShape", {
            bpmnElement: laneEl,
            bounds: m.create("dc:Bounds", { x: r.x, y: r.y, width: r.width, height: r.height }),
          }) as ModdleElement;
          (ldi as { isHorizontal?: boolean }).isHorizontal = horizontal;
          diShape.set(laneId, ldi);
          prefix.push(ldi);
        }
        // Child lanes tile the parent's band after its own title strip.
        if (ln.lanes?.length) {
          const inner = horizontal
            ? { x: r.x + LANE_HEADER, y: r.y, width: r.width - LANE_HEADER, height: r.height }
            : { x: r.x, y: r.y + LANE_HEADER, width: r.width, height: r.height - LANE_HEADER };
          const childRects = laneRects(ln.lanes, inner, horizontal, 0);
          ln.lanes.forEach((c, j) => emitLane(c, childRects[j], laneEl));
        }
      };
      const rects = laneRects(lanes, { x: poolX, y: poolY, width: poolW, height: poolH }, horizontal);
      lanes.forEach((ln, i) => emitLane(ln, rects[i]));
    }

    // Insert NEW shapes parent-first at the very front (participant then lanes).
    if (prefix.length) (mainPlane.planeElement ??= []).unshift(...prefix);
  }
}

/** One rectangle per lane, tiling the pool minus its title strip: rows
 *  (top→bottom) in a horizontal pool, columns (left→right) in a vertical one
 *  — each lane's own size, else an equal split (see laneLayout). */
function laneRects(
  lanes: Array<PoolLane & { width?: number }>,
  pool: { x: number; y: number; width: number; height: number },
  horizontal: boolean,
  header = POOL_HEADER,
): Array<{ x: number; y: number; width: number; height: number }> {
  const extent = horizontal ? pool.height : pool.width;
  let at = horizontal ? pool.y : pool.x;
  return laneHeights(asStackLanes(lanes, horizontal), extent).map((size) => {
    const r = horizontal
      ? { x: pool.x + header, y: at, width: pool.width - header, height: size }
      : { x: at, y: pool.y + header, width: size, height: pool.height - header };
    at += size;
    return r;
  });
}

function getPortOffset(portId: string | undefined, width: number, height: number): { dx: number; dy: number } {
  if (!portId) return { dx: width / 2, dy: height / 2 };
  switch (portId) {
    case "top":      return { dx: width / 2, dy: 0 };
    case "top-1":    return { dx: width / 3, dy: 0 };
    case "top-2":    return { dx: (2 * width) / 3, dy: 0 };
    
    case "bottom":   return { dx: width / 2, dy: height };
    case "bottom-1": return { dx: width / 3, dy: height };
    case "bottom-2": return { dx: (2 * width) / 3, dy: height };
    
    case "left":     return { dx: 0, dy: height / 2 };
    case "left-1":   return { dx: 0, dy: height / 3 };
    case "left-2":   return { dx: 0, dy: (2 * height) / 3 };
    
    case "right":    return { dx: width, dy: height / 2 };
    case "right-1":  return { dx: width, dy: height / 3 };
    case "right-2":  return { dx: width, dy: (2 * height) / 3 };
    
    default:         return { dx: width / 2, dy: height / 2 };
  }
}

function portIsHorizontal(portId: string | undefined, start: { x: number; y: number }, end: { x: number; y: number }, isSource: boolean): boolean {
  if (portId) {
    return portId.startsWith("left") || portId.startsWith("right");
  }
  if (isSource) {
    return Math.abs(end.x - start.x) > Math.abs(end.y - start.y);
  } else {
    return Math.abs(end.y - start.y) > Math.abs(end.x - start.x);
  }
}

function getOrthogonalWaypoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourcePort: string | undefined,
  targetPort: string | undefined
): Array<{ x: number; y: number }> {
  const isHorizontalSource = portIsHorizontal(sourcePort, start, end, true);
  const isHorizontalTarget = portIsHorizontal(targetPort, start, end, false);
  
  if (isHorizontalSource && !isHorizontalTarget) {
    return [start, { x: end.x, y: start.y }, end];
  } else if (!isHorizontalSource && isHorizontalTarget) {
    return [start, { x: start.x, y: end.y }, end];
  } else if (isHorizontalSource && isHorizontalTarget) {
    const mx = (start.x + end.x) / 2;
    return [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end];
  } else {
    const my = (start.y + end.y) / 2;
    return [start, { x: start.x, y: my }, { x: end.x, y: my }, end];
  }
}

function buildWaypoints(
  e: CanvasModel["edges"][number],
  src: CanvasModel["nodes"][number],
  tgt: CanvasModel["nodes"][number],
  m: BpmnModdle,
): Array<{ x: number; y: number }> {
  const point = (x: number, y: number) => m.create("dc:Point", { x, y }) as unknown as { x: number; y: number };
  // Endpoints: honour the precise per-edge anchor captured at import time.
  // If no anchor is set, calculate the coordinate of the port connected on the node border.
  // Fall back to center only when no anchor and no port are available.
  const srcOffset = e.sourceAnchor ?? getPortOffset(e.sourcePort, src.width, src.height);
  const tgtOffset = e.targetAnchor ?? getPortOffset(e.targetPort, tgt.width, tgt.height);

  const start = { x: src.x + srcOffset.dx, y: src.y + srcOffset.dy };
  const end = { x: tgt.x + tgtOffset.dx, y: tgt.y + tgtOffset.dy };

  let waypoints: Array<{ x: number; y: number }>;
  if (e.router === "orth" && (!e.vertices || e.vertices.length === 0)) {
    waypoints = getOrthogonalWaypoints(start, end, e.sourcePort, e.targetPort);
  } else {
    const mid = (e.vertices ?? []);
    waypoints = [start, ...mid, end];
  }

  // Drop consecutive duplicates (a straight orth line yields a bend that
  // coincides with an endpoint → zero-length tail segment → bent arrowhead
  // after round-trip).
  const clean = waypoints.filter((w, i) => i === 0 || Math.hypot(w.x - waypoints[i - 1].x, w.y - waypoints[i - 1].y) > 0.5);
  return clean.map((w) => point(w.x, w.y));
}

function pointAtDistance(wps: Array<{ x: number; y: number }>, distance: number): { x: number; y: number } {
  if (!wps.length) return { x: 0, y: 0 };
  if (wps.length === 1) return { x: wps[0].x, y: wps[0].y };
  const total = wps.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - wps[i].x, p.y - wps[i].y), 0);
  const target = Math.max(0, Math.min(1, distance)) * total;
  let walked = 0;
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + seg >= target) {
      const t = seg === 0 ? 0 : (target - walked) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += seg;
  }
  return { x: wps[wps.length - 1].x, y: wps[wps.length - 1].y };
}

function edgeLabelBoundsFromModel(
  m: BpmnModdle,
  edge: CanvasModel["edges"][number],
  wps: Array<{ x: number; y: number }>,
): ModdleElement | undefined {
  if (!edge.labelPos && !edge.label) return undefined;
  const distance = edge.labelPos?.distance ?? 0.5;
  const base = pointAtDistance(wps, distance);
  let dx = 0, dy = 0;
  const off = edge.labelPos?.offset;
  if (typeof off === "number") dy = off;
  else if (off && typeof off.x === "number" && typeof off.y === "number") { dx = off.x; dy = off.y; }
  const textLen = (edge.label ?? "").length;
  const width = Math.max(30, Math.min(300, textLen * 7 + 18));
  const height = 20;
  return m.create("dc:Bounds", {
    x: base.x + dx - width / 2,
    y: base.y + dy - height / 2,
    width,
    height,
  }) as ModdleElement;
}

function nodeLabelBoundsFromModel(
  m: BpmnModdle,
  node: CanvasModel["nodes"][number],
): ModdleElement | undefined {
  // Only export label bounds for shapes whose label sits outside the shape
  // (events, gateways, data objects / stores).
  if (!hasExternalLabel(node.shape)) return undefined;

  const textLen = (node.label ?? "").length;
  if (!textLen) return undefined;

  const off = (node.attrs?.labelOffset as { x?: number; y?: number } | undefined) ?? { x: 0, y: 0 };
  const width = Math.max(30, Math.min(320, textLen * 7 + 18));
  const height = 20;

  // Detect if the label is positioned on top (e.g., negative offset or if flipped)
  const isTop = (off.y ?? 0) < -10;
  const defaultY = defaultLabelDy(node.shape, node.height);
  const dy = (isTop ? -defaultY : defaultY) + (off.y ?? 0);
  const dx = (off.x ?? 0);

  const cx = node.x + node.width / 2 + dx;
  const cy = node.y + node.height / 2 + dy;
  return m.create("dc:Bounds", { x: cx - width / 2, y: cy - height / 2, width, height }) as ModdleElement;
}

async function emitMinimal(model: CanvasModel, m: BpmnModdle): Promise<string> {
  const defs = m.create("bpmn:Definitions", {
    id: "Definitions_Export",
    targetNamespace: "http://omniboard.local/bpmn",
  }) as ModdleElement;
  const pools = model.nodes.filter((n) =>
    n.shape === "bpmn-pool" ||
    (n.attrs?.__source as { kind?: string } | undefined)?.kind === "pool",
  );
  /** Per pool: model lane id → emitted lane id (duplicates across pools renamed). */
  const laneIdByPool = new Map<string, Map<string, string>>();

  // ── Process(es) ────────────────────────────────────────────────────────
  // Multi-pool BPMN spec rule: each participant MUST reference its own
  // process. Sharing a single process across N participants is invalid —
  // bpmn-js's BpmnImporter walks DI per-participant and re-adds the shared
  // process's elements N times, throwing "element X already exists" for
  // every flow node, lane, and sequence flow. With ≥2 pools we emit one
  // bpmn:Process per pool; with 0–1 pools we keep the single Process_Export.
  const processByPoolId = new Map<string, ModdleElement>();
  const multiPool = pools.length >= 2;
  let process: ModdleElement;
  if (multiPool) {
    for (const pool of pools) {
      // Black-box participant: no process of its own (pie-flow#1).
      if (isBlackBoxPool(pool)) continue;
      const proc = m.create("bpmn:Process", {
        id: `Process_${pool.id}`,
        isExecutable: false,
      }) as ModdleElement;
      proc.flowElements = [];
      (defs.rootElements ??= []).push(proc);
      processByPoolId.set(pool.id, proc);
    }
    // `process` (the variable) below is used by legacy single-pool code paths
    // for orphan handling and `emitPoolLaneShapes`. Use the first pool's
    // process as the default sink for elements that can't be mapped to any
    // pool (rare; usually means model is inconsistent).
    const firstWhiteBox = pools.find((p) => !isBlackBoxPool(p));
    if (firstWhiteBox) {
      process = processByPoolId.get(firstWhiteBox.id)!;
    } else {
      process = m.create("bpmn:Process", { id: "Process_Export", isExecutable: false }) as ModdleElement;
      process.flowElements = [];
      (defs.rootElements ??= []).push(process);
    }
  } else {
    process = m.create("bpmn:Process", {
      id: "Process_Export",
      isExecutable: false,
    }) as ModdleElement;
    process.flowElements = [];
    (defs.rootElements ??= []).push(process);
  }

  if (pools.length) {
    const collaboration = m.create("bpmn:Collaboration", { id: "Collaboration_Export" }) as ModdleElement;
    collaboration.participants = pools.map((pool) => m.create("bpmn:Participant", {
      id: pool.id,
      name: pool.label ?? "Pool",
      // Multi-pool: each participant → its own process. Single-pool: shared.
      ...(isBlackBoxPool(pool) ? {} : { processRef: multiPool ? processByPoolId.get(pool.id) : process }),
    }) as ModdleElement);
    (defs.rootElements ??= []).push(collaboration);

    // Lane sets — per pool when multi-pool, single laneSet on shared process
    // when single-pool. Dedupe lane ids GLOBALLY (across all pools): bpmn-js's
    // Canvas elementRegistry is per-modeler, not per-process, so two lanes
    // with the same id in different processes still collide on import.
    const globalSeenLaneIds = new Set<string>();
    const uniqueLaneId = (id: string): string => {
      if (!globalSeenLaneIds.has(id)) { globalSeenLaneIds.add(id); return id; }
      let suffix = 2;
      while (globalSeenLaneIds.has(`${id}_${suffix}`)) suffix += 1;
      globalSeenLaneIds.add(`${id}_${suffix}`);
      return `${id}_${suffix}`;
    };
    for (const pool of pools) {
      const lanes = (pool.attrs?.lanes as ModelLane[] | undefined) ?? [];
      if (!lanes.length) continue;
      const targetProcess = multiPool ? processByPoolId.get(pool.id)! : process;
      if (!targetProcess.laneSets || !targetProcess.laneSets.length) {
        targetProcess.laneSets = [m.create("bpmn:LaneSet", {
          id: `LaneSet_${targetProcess.id}`,
          lanes: [],
        }) as ModdleElement];
      }
      const laneSet = targetProcess.laneSets[0];
      laneSet.lanes ??= [];
      // Remember renames so the DI pass finds this pool's (renamed) lanes.
      const renames = new Map<string, string>();
      laneIdByPool.set(pool.id, renames);
      const idOf = (id: string) => { const u = uniqueLaneId(id); renames.set(id, u); return u; };
      for (const ln of lanes) laneSet.lanes.push(createLaneEl(m, ln, idOf));
    }
  }

  // Helper: which pool (process) owns a given node? Resolution order:
  //  1. n.parentId pointing to a pool
  //  2. n.laneId matching a lane inside some pool's `attrs.lanes`
  //  3. Spatial containment (node center inside pool bbox)
  //  4. Default = `process` (single-pool case or orphan in multi-pool)
  const findOwningProcess = (n: CanvasModel["nodes"][number]): ModdleElement => {
    if (!multiPool) return process;
    if (n.parentId && processByPoolId.has(n.parentId)) return processByPoolId.get(n.parentId)!;
    if (n.laneId) {
      for (const pool of pools) {
        const ls = (pool.attrs?.lanes as ModelLane[] | undefined) ?? [];
        if (allLaneIds(ls).includes(n.laneId)) return processByPoolId.get(pool.id)!;
      }
    }
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    for (const pool of pools) {
      if (cx >= pool.x && cx <= pool.x + pool.width && cy >= pool.y && cy <= pool.y + pool.height) {
        return processByPoolId.get(pool.id)!;
      }
    }
    return process; // fallback to first pool's process
  };

  // Flow nodes — two-pass: create + index, then push into owning container.
  // Container = parent subprocess (n.parentId points to subprocess) OR the
  // owning pool's process.
  const feById = new Map<string, ModdleElement>();
  for (const n of model.nodes) {
    const srcKind = (n.attrs?.__source as { kind?: string } | undefined)?.kind;
    if (n.shape === "bpmn-pool" || n.shape === "bpmn-lane" || srcKind === "pool" || srcKind === "lane") continue;
    const fe = m.create(shapeToBpmnType(n.shape, n.attrs as BpmnNodeAttrs), n.shape === "bpmn-annotation" ? { id: n.id, text: n.label ?? "" } : n.shape === "bpmn-group" ? { id: n.id } : { id: n.id, name: n.label ?? "" }) as ModdleElement;
    applyBpmnExtras(m, fe, n.shape, (n.attrs ?? {}) as BpmnNodeAttrs);
    feById.set(n.id, fe);
  }
  for (const n of model.nodes) {
    const srcKind = (n.attrs?.__source as { kind?: string } | undefined)?.kind;
    if (n.shape === "bpmn-pool" || n.shape === "bpmn-lane" || srcKind === "pool" || srcKind === "lane") continue;
    const fe = feById.get(n.id)!;
    const parent = n.parentId ? feById.get(n.parentId) : undefined;
    const container = parent ?? findOwningProcess(n);
    (container.flowElements ??= []).push(fe);
  }
  // Backfill flowNodeRef on every Lane across every process.
  const allProcesses = multiPool ? [...processByPoolId.values()] : [process];
  for (const proc of allProcesses) {
    const refsOf = (laneId: string) => model.nodes
      .filter((n) => n.laneId === laneId)
      .map((n) => feById.get(n.id))
      .filter((fe): fe is ModdleElement => !!fe);
    for (const ls of proc.laneSets ?? []) fillLaneRefs(ls.lanes as ModdleElement[] | undefined, refsOf);
  }
  // Edges — route by source node's owning process. Cross-pool sequence flow
  // is invalid BPMN; upgrade to MessageFlow on the collaboration root.
  const sfById = new Map<string, ModdleElement>();
  const nodeIdSet = new Set(model.nodes.map((n) => n.id));
  const validEdges = model.edges.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
  const collaborationRoot = (defs.rootElements ?? []).find((r) => r.$type === "bpmn:Collaboration") ?? null;
  const nodeById = new Map(model.nodes.map((n) => [n.id, n] as const));

  for (const e of validEdges) {
    const kind = edgeKindOf(e);
    const srcNode = nodeById.get(e.source);
    const tgtNode = nodeById.get(e.target);
    const srcProc = srcNode ? findOwningProcess(srcNode) : process;
    const tgtProc = tgtNode ? findOwningProcess(tgtNode) : process;
    const isCrossPool = multiPool && srcProc !== tgtProc;

    let typeStr = bpmnTypeForEdgeKind(kind);
    if (kind === "message" && !collaborationRoot) typeStr = "bpmn:SequenceFlow";
    // Cross-pool sequence/conditional flow must be a MessageFlow per BPMN spec.
    if (isCrossPool && kind === "sequence" && collaborationRoot) {
      typeStr = "bpmn:MessageFlow";
    }

    // MessageFlow may end on a participant (black-box pool) — BPMN 2.0 §9.3.
    const refOf = (id: string) => feById.get(id)
      ?? (typeStr === "bpmn:MessageFlow" ? collaborationRoot?.participants?.find((p: ModdleElement) => p.id === id) : undefined);
    const sf = m.create(typeStr, {
      id: e.id,
      // bpmn:Association is an artifact with no `name` in the BPMN schema.
      ...(kind === "association" ? {} : { name: e.label ?? "" }),
      sourceRef: refOf(e.source),
      targetRef: refOf(e.target),
    }) as ModdleElement;
    if (!sf.sourceRef || !sf.targetRef) {
      console.warn(`[omniboard:bpmn] dropped ${typeStr} "${e.id}": endpoint has no BPMN element (${e.source} → ${e.target})`);
      continue;
    }
    const extrasKind = (typeStr === "bpmn:MessageFlow")
      ? "sequence"
      : (kind === "message" && !collaborationRoot)
        ? "sequence"
        : kind;
    applyEdgeExtras(m, sf, extrasKind, e.attrs);
    if (typeStr === "bpmn:MessageFlow" && collaborationRoot) {
      (collaborationRoot.messageFlows ??= []).push(sf);
    } else if (kind === "association") {
      (srcProc.artifacts ??= []).push(sf);
    } else if (kind === "message" && collaborationRoot) {
      (collaborationRoot.messageFlows ??= []).push(sf);
    } else {
      (srcProc.flowElements ??= []).push(sf);
    }
    sfById.set(e.id, sf);
  }
  // `default` attribute on source gateway/activity for default sequence flows.
  for (const e of validEdges) {
    if (!e.attrs?.isDefault) continue;
    if (edgeKindOf(e) !== "sequence") continue;
    const srcFe = feById.get(e.source);
    const edgeFe = sfById.get(e.id);
    if (srcFe && edgeFe) srcFe.default = edgeFe;
  }
  const plane = m.create("bpmndi:BPMNPlane", {
    id: "Plane_Export",
    bpmnElement: collaborationRoot ?? process,
    planeElement: [],
  }) as { planeElement?: ModdleElement[]; bpmnElement?: ModdleElement | string };
  const diShape = new Map<string, ModdleElement>();
  for (const n of model.nodes) {
    const srcKind = (n.attrs?.__source as { kind?: string } | undefined)?.kind;
    if (n.shape === "bpmn-pool" || n.shape === "bpmn-lane" || srcKind === "pool" || srcKind === "lane") continue;
    const nLabel = nodeLabelBoundsFromModel(m, n);
    const di = m.create("bpmndi:BPMNShape", {
      id: n.id + "_di",
      bpmnElement: feById.get(n.id),
      bounds: m.create("dc:Bounds", { x: n.x, y: n.y, width: n.width, height: n.height }),
      ...(nLabel ? { label: m.create("bpmndi:BPMNLabel", { bounds: nLabel }) } : {}),
      ...(isCollapsed(n) ? { isExpanded: false } : {}),
    }) as ModdleElement;
    plane.planeElement!.push(di);
    diShape.set(n.id, di);
  }
  for (const e of validEdges) {
    const src = model.nodes.find((n) => n.id === e.source);
    const tgt = model.nodes.find((n) => n.id === e.target);
    const sf = sfById.get(e.id);
    if (!src || !tgt || !sf) continue;
    const waypoints = buildWaypoints(e, src, tgt, m);
    const eLabel = edgeLabelBoundsFromModel(m, e, waypoints);
    plane.planeElement!.push(m.create("bpmndi:BPMNEdge", {
      id: e.id + "_di",
      bpmnElement: sf,
      waypoint: waypoints,
      ...(eLabel ? { label: m.create("bpmndi:BPMNLabel", { bounds: eLabel }) } : {}),
    }));
  }
  emitPoolLaneShapes(model, defs, process, plane, diShape, m, multiPool ? processByPoolId : undefined, laneIdByPool);
  const dia = m.create("bpmndi:BPMNDiagram", { id: "Diagram_Export", plane }) as ModdleElement;
  (defs.diagrams ??= []).push(dia as never);

  const { xml } = await m.toXML(defs as never, { format: true });
  return patchCamundaXml(xml, model);
}
