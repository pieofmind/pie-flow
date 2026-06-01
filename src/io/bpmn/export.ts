import { BpmnModdle } from "bpmn-moddle";
import type { CanvasModel } from "../../canvas/types";
import type { SourceMeta } from "../types";
import { SHAPE_TO_BPMN, TRIGGER_TO_EVENT_DEF } from "./shapes";

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

function shapeToBpmnType(shape: string, attrs?: { attachedTo?: string }): string {
  // Đợt F — if an intermediate event has attachedTo, export it as BoundaryEvent
  // (not IntermediateThrowEvent) per OMG.
  if (shape === "bpmn-event-intermediate" && attrs?.attachedTo) return "bpmn:BoundaryEvent";
  const tag = SHAPE_TO_BPMN[shape] ?? "task";
  return "bpmn:" + tag.charAt(0).toUpperCase() + tag.slice(1);
}

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
  for (const ls of process.laneSets ?? []) {
    const found = (ls.lanes ?? []).find((l) => l.id === id);
    if (found) return found;
  }
  return undefined;
}

const POOL_HEADER = 30;  // pool vertical title strip
const LANE_HEADER = 30;  // lane vertical title strip
const POOL_MARGIN = 40;  // padding between content bbox and pool edges

export async function exportBpmn(model: CanvasModel, meta?: SourceMeta | null): Promise<string> {
  const m = moddle();
  if (meta?.format === "bpmn") {
    const raw = String((meta.payload as { raw?: string })?.raw ?? "");
    const diagramIndex = Number((meta.payload as { diagramIndex?: number } | undefined)?.diagramIndex ?? 0);
    if (raw) return patchExisting(raw, model, m, Number.isFinite(diagramIndex) ? diagramIndex : 0);
  }
  return emitMinimal(model, m);
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
  const modelEdgeIds = new Set(model.edges.map((e) => e.id));
  // Split model edges by kind so each container (process flowElements,
  // process artifacts, collaboration messageFlows) is patched independently.
  const modelEdgeKind = new Map<string, EdgeKind>(model.edges.map((e) => [e.id, edgeKindOf(e)]));
  const modelSequenceEdgeIds = new Set(model.edges.filter((e) => edgeKindOf(e) === "sequence").map((e) => e.id));
  const modelAssociationEdgeIds = new Set(model.edges.filter((e) => edgeKindOf(e) === "association").map((e) => e.id));
  const modelMessageEdgeIds = new Set(model.edges.filter((e) => edgeKindOf(e) === "message").map((e) => e.id));

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
    if (srcKind === "pool") continue;
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
      di.label = nLabel ? ({ bounds: nLabel } as unknown as { bounds?: { x: number; y: number; width: number; height: number } }) : undefined;
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
      const fe = m.create(shapeToBpmnType(n.shape, n.attrs as BpmnNodeAttrs), { id: n.id, name: n.label ?? "" }) as ModdleElement;
      applyBpmnExtras(m, fe, n.shape, (n.attrs ?? {}) as BpmnNodeAttrs);
      (targetContainer.flowElements ??= []).push(fe);
      flowById.set(n.id, fe);
      containerOf.set(n.id, targetContainer);
      di = m.create("bpmndi:BPMNShape", {
        bpmnElement: fe,
        bounds: m.create("dc:Bounds", { x: n.x, y: n.y, width: n.width, height: n.height }),
      }) as ModdleElement;
      (mainPlane.planeElement ??= []).push(di);
      diShape.set(n.id, di);
    }
    // Phase B — if the user moved this node to/from a subprocess, detach
    // from the old container and re-push into the new one. Only act when
    // the actual parent element differs from the desired container.
    const existing = flowById.get(n.id);
    const curContainer = containerOf.get(n.id);
    if (existing && curContainer && curContainer !== targetContainer) {
      curContainer.flowElements = (curContainer.flowElements ?? []).filter((fe) => fe.id !== n.id);
      (targetContainer.flowElements ??= []).push(existing);
      containerOf.set(n.id, targetContainer);
    }
    // Patch name + BPMN extras (Đợt F) on existing nodes too — survives
    // re-export when user adds a trigger/marker after import.
    if (existing) {
      if (typeof n.label === "string") existing.name = n.label;
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
    const walkLanesForRewrite = (lanes: ModdleElement[] | undefined): void => {
      for (const ln of lanes ?? []) {
        const child = (ln as { childLaneSet?: { lanes?: ModdleElement[] } }).childLaneSet?.lanes;
        if (child?.length) { walkLanesForRewrite(child); continue; }
        const ids = ln.id ? byLaneId.get(ln.id) : undefined;
        if (!ids?.length) {
          ln.flowNodeRef = [];
          continue;
        }
        // Resolve each id to its moddle element so the serializer emits a
        // proper IDREF (`<flowNodeRef>id</flowNodeRef>`) tied to the actual
        // element. flowById already contains every surviving flow node.
        ln.flowNodeRef = ids
          .map((id) => flowById.get(id))
          .filter((fe): fe is ModdleElement => !!fe);
      }
    };
    for (const ls of process.laneSets ?? []) walkLanesForRewrite(ls.lanes);
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
  for (const e of model.edges) {
    const srcNode = model.nodes.find((n) => n.id === e.source);
    const tgtNode = model.nodes.find((n) => n.id === e.target);
    if (!srcNode || !tgtNode) continue;
    const kind = edgeKindOf(e);
    let de = diEdge.get(e.id);
    const wps = buildWaypoints(e, srcNode, tgtNode, m);
    // Resolve or create the bpmn:* edge element. Container differs by kind.
    let sf = flowById.get(e.id);
    if (!sf) {
      const sourceFe = flowById.get(e.source);
      const targetFe = flowById.get(e.target);
      sf = m.create(bpmnTypeForEdgeKind(kind), {
        id: e.id,
        name: e.label ?? "",
        sourceRef: sourceFe,
        targetRef: targetFe,
      }) as ModdleElement;
      if (kind === "message") {
        if (!collaboration) {
          // No collaboration → MessageFlow has no valid host. Fall back to
          // SequenceFlow on the process so the edge isn't silently dropped.
          // (Round-trip will downgrade kind on next import; user will see
          // a warning when validator lands in Phase E.)
          sf.$type = "bpmn:SequenceFlow";
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
    } else if (typeof e.label === "string") {
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
  for (const e of model.edges) {
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
): void {
  const pools = model.nodes.filter((n) => (n.attrs?.__source as { kind?: string } | undefined)?.kind === "pool");
  if (!pools.length) return;

  // bbox of all flow nodes (everything that isn't a pool).
  const flow = model.nodes.filter((n) => (n.attrs?.__source as { kind?: string } | undefined)?.kind !== "pool");
  if (!flow.length) return;
  const minX = Math.min(...flow.map((n) => n.x));
  const minY = Math.min(...flow.map((n) => n.y));
  const maxX = Math.max(...flow.map((n) => n.x + n.width));
  const maxY = Math.max(...flow.map((n) => n.y + n.height));

  const poolX = minX - POOL_HEADER - LANE_HEADER - POOL_MARGIN;
  const poolY = minY - POOL_MARGIN;
  const poolW = (maxX - minX) + POOL_HEADER + LANE_HEADER + POOL_MARGIN * 2;
  const poolH = (maxY - minY) + POOL_MARGIN * 2;

  // Single pool is the realistic case; for >1 just stack them (rare).
  for (const pool of pools) {
    const prefix: ModdleElement[] = [];

    // Participant shape — patch existing or create new.
    let pdi = diShape.get(pool.id);
    if (pdi?.bounds) {
      pdi.bounds.x = poolX; pdi.bounds.y = poolY; pdi.bounds.width = poolW; pdi.bounds.height = poolH;
    } else {
      const part = findParticipant(definitions, pool.id);
      pdi = m.create("bpmndi:BPMNShape", {
        bpmnElement: part ?? (m.create("bpmn:Participant", { id: pool.id }) as ModdleElement),
        bounds: m.create("dc:Bounds", { x: poolX, y: poolY, width: poolW, height: poolH }),
      }) as ModdleElement;
      const isHorizontal = (pool.attrs?.poolHorizontal as boolean | undefined) !== false;
      (pdi as { isHorizontal?: boolean }).isHorizontal = isHorizontal;
      diShape.set(pool.id, pdi);
      prefix.push(pdi);
    }

    // Lane shapes tile the pool interior (minus pool header). Per-lane band is
    // derived from each lane's member-node Y-range when available, else equal.
    const lanes = (pool.attrs?.lanes as Array<{ id: string; label?: string }> | undefined) ?? [];
    const laneX = poolX + POOL_HEADER;
    const laneW = poolW - POOL_HEADER;
    if (lanes.length) {
      // Build contiguous bands. If a lane has no member info we fall back to an
      // equal split so the bands always exactly tile poolH.
      const bands = laneBands(lanes, process, model, poolY, poolH);
      lanes.forEach((ln, i) => {
        if (!ln.id) return;
        const band = bands[i];
        let ldi = diShape.get(ln.id);
        if (ldi?.bounds) {
          ldi.bounds.x = laneX; ldi.bounds.y = band.y; ldi.bounds.width = laneW; ldi.bounds.height = band.h;
        } else {
          const laneEl = findLane(process, ln.id);
          ldi = m.create("bpmndi:BPMNShape", {
            bpmnElement: laneEl ?? (m.create("bpmn:Lane", { id: ln.id }) as ModdleElement),
            bounds: m.create("dc:Bounds", { x: laneX, y: band.y, width: laneW, height: band.h }),
          }) as ModdleElement;
          const isHorizontal = (pool.attrs?.poolHorizontal as boolean | undefined) !== false;
          (ldi as { isHorizontal?: boolean }).isHorizontal = isHorizontal;
          diShape.set(ln.id, ldi);
          prefix.push(ldi);
        }
      });
    }

    // Insert NEW shapes parent-first at the very front (participant then lanes).
    if (prefix.length) (mainPlane.planeElement ??= []).unshift(...prefix);
  }
}

/** Contiguous Y-bands tiling [poolY, poolY+poolH] — one per lane. Uses each
 *  lane's member-node Y-range when resolvable, else an equal split. */
function laneBands(
  lanes: Array<{ id: string }>,
  process: ModdleElement,
  model: CanvasModel,
  poolY: number,
  poolH: number,
): Array<{ y: number; h: number }> {
  if (lanes.length <= 1) return [{ y: poolY, h: poolH }];
  const nodeY = new Map(model.nodes.map((n) => [n.id, { top: n.y, bot: n.y + n.height }]));
  // Compute each lane's member mid-Y for ordering + extent.
  const mids: number[] = lanes.map((ln) => {
    const lane = findLane(process, ln.id);
    const refs = (lane?.flowNodeRef ?? []) as Array<ModdleElement | string>;
    const ys = refs.map((r) => nodeY.get(typeof r === "string" ? r : r.id ?? "")).filter(Boolean) as Array<{ top: number; bot: number }>;
    if (!ys.length) return NaN;
    return ys.reduce((s, v) => s + (v.top + v.bot) / 2, 0) / ys.length;
  });
  // If any lane lacks members, fall back to an equal split (still tiles exactly).
  if (mids.some((v) => Number.isNaN(v))) {
    const each = poolH / lanes.length;
    return lanes.map((_, i) => ({ y: poolY + i * each, h: each }));
  }
  // Split boundaries at midpoints between consecutive lane centres.
  const order = lanes.map((_, i) => i).sort((a, b) => mids[a] - mids[b]);
  const bounds: number[] = [poolY];
  for (let i = 0; i < order.length - 1; i++) {
    bounds.push((mids[order[i]] + mids[order[i + 1]]) / 2);
  }
  bounds.push(poolY + poolH);
  const bands: Array<{ y: number; h: number }> = new Array(lanes.length);
  order.forEach((laneIdx, k) => { bands[laneIdx] = { y: bounds[k], h: bounds[k + 1] - bounds[k] }; });
  return bands;
}

function buildWaypoints(
  e: CanvasModel["edges"][number],
  src: CanvasModel["nodes"][number],
  tgt: CanvasModel["nodes"][number],
  m: BpmnModdle,
): Array<{ x: number; y: number }> {
  const point = (x: number, y: number) => m.create("dc:Point", { x, y }) as unknown as { x: number; y: number };
  // Endpoints: honour the precise per-edge anchor captured at import time
  // (offset from the node's top-left corner). Without this we'd emit the node
  // CENTRE, so bpmn.io draws every arrow straight through the node body and
  // diagonally across the diagram. Fall back to centre only when no anchor.
  const start = e.sourceAnchor
    ? point(src.x + e.sourceAnchor.dx, src.y + e.sourceAnchor.dy)
    : point(src.x + src.width / 2, src.y + src.height / 2);
  const end = e.targetAnchor
    ? point(tgt.x + e.targetAnchor.dx, tgt.y + e.targetAnchor.dy)
    : point(tgt.x + tgt.width / 2, tgt.y + tgt.height / 2);
  const mid = (e.vertices ?? []).map((v) => point(v.x, v.y));
  return [start, ...mid, end];
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
  const off = node.attrs?.labelOffset as { x?: number; y?: number } | undefined;
  if (!off || (!off.x && !off.y)) return undefined;
  const textLen = (node.label ?? "").length;
  const width = Math.max(30, Math.min(320, textLen * 7 + 18));
  const height = 20;
  const cx = node.x + node.width / 2 + (off.x ?? 0);
  const cy = node.y + node.height / 2 + (off.y ?? 0);
  return m.create("dc:Bounds", { x: cx - width / 2, y: cy - height / 2, width, height }) as ModdleElement;
}

async function emitMinimal(model: CanvasModel, m: BpmnModdle): Promise<string> {
  const defs = m.create("bpmn:Definitions", {
    id: "Definitions_Export",
    targetNamespace: "http://omniboard.local/bpmn",
  }) as ModdleElement;
  const process = m.create("bpmn:Process", {
    id: "Process_Export",
    isExecutable: false,
  }) as ModdleElement;
  (defs.rootElements ??= []).push(process);

  // Flow nodes — Phase B: two-pass so a child node (parentId set) can be
  // pushed into its container even when the container appears LATER in the
  // model.nodes array. Pass 1 creates every element + indexes by id; Pass 2
  // assigns each to its parent.flowElements (top-level process or a sibling
  // subprocess element from pass 1).
  const feById = new Map<string, ModdleElement>();
  process.flowElements = [];
  for (const n of model.nodes) {
    const fe = m.create(shapeToBpmnType(n.shape, n.attrs as BpmnNodeAttrs), { id: n.id, name: n.label ?? "" }) as ModdleElement;
    applyBpmnExtras(m, fe, n.shape, (n.attrs ?? {}) as BpmnNodeAttrs);
    feById.set(n.id, fe);
  }
  for (const n of model.nodes) {
    const fe = feById.get(n.id)!;
    const parent = n.parentId ? feById.get(n.parentId) : undefined;
    const container = parent ?? process;
    (container.flowElements ??= []).push(fe);
  }
  // Edges — SequenceFlow on the process; Association as a process artifact;
  // MessageFlow downgrades to SequenceFlow in the minimal path (no
  // Collaboration root → nowhere for a MessageFlow to live).
  const sfById = new Map<string, ModdleElement>();
  for (const e of model.edges) {
    const kind = edgeKindOf(e);
    const typeStr = kind === "message" ? "bpmn:SequenceFlow" : bpmnTypeForEdgeKind(kind);
    const sf = m.create(typeStr, {
      id: e.id,
      name: e.label ?? "",
      sourceRef: feById.get(e.source),
      targetRef: feById.get(e.target),
    }) as ModdleElement;
    applyEdgeExtras(m, sf, kind === "message" ? "sequence" : kind, e.attrs);
    if (kind === "association") {
      (process.artifacts ??= []).push(sf);
    } else {
      process.flowElements.push(sf);
    }
    sfById.set(e.id, sf);
  }
  // `default` attribute on source gateway/activity for default sequence flows.
  for (const e of model.edges) {
    if (!e.attrs?.isDefault) continue;
    if (edgeKindOf(e) !== "sequence") continue;
    const srcFe = feById.get(e.source);
    const edgeFe = sfById.get(e.id);
    if (srcFe && edgeFe) srcFe.default = edgeFe;
  }
  // Diagram
  const plane = m.create("bpmndi:BPMNPlane", {
    id: "Plane_Export",
    bpmnElement: process,
    planeElement: [],
  }) as { planeElement?: ModdleElement[]; bpmnElement?: ModdleElement | string };
  for (const n of model.nodes) {
    const nLabel = nodeLabelBoundsFromModel(m, n);
    plane.planeElement!.push(m.create("bpmndi:BPMNShape", {
      id: n.id + "_di",
      bpmnElement: feById.get(n.id),
      bounds: m.create("dc:Bounds", { x: n.x, y: n.y, width: n.width, height: n.height }),
      ...(nLabel ? { label: m.create("bpmndi:BPMNLabel", { bounds: nLabel }) } : {}),
    }));
  }
  for (const e of model.edges) {
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
  const dia = m.create("bpmndi:BPMNDiagram", { id: "Diagram_Export", plane }) as ModdleElement;
  (defs.diagrams ??= []).push(dia as never);

  const { xml } = await m.toXML(defs as never, { format: true });
  return patchCamundaXml(xml, model);
}
