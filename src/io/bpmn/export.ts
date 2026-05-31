import { BpmnModdle } from "bpmn-moddle";
import type { CanvasModel } from "../../canvas/types";
import type { SourceMeta } from "../types";
import { SHAPE_TO_BPMN } from "./shapes";

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
  laneSets?: ModdleElement[];
  lanes?: ModdleElement[];
  flowNodeRef?: Array<ModdleElement | string>;
  diagrams?: Array<{ $type: string; plane: { planeElement?: ModdleElement[]; bpmnElement?: ModdleElement | string }; }>;
  bpmnElement?: ModdleElement | string;
  bounds?: { x: number; y: number; width: number; height: number };
  waypoint?: Array<{ x: number; y: number }>;
  label?: { bounds?: { x: number; y: number; width: number; height: number } };
  $attrs?: Record<string, string>;
  $parent?: ModdleElement;
}

let moddleSingleton: BpmnModdle | null = null;
function moddle(): BpmnModdle {
  if (!moddleSingleton) moddleSingleton = new BpmnModdle();
  return moddleSingleton;
}

function shapeToBpmnType(shape: string): string {
  const tag = SHAPE_TO_BPMN[shape] ?? "task";
  // SHAPE_TO_BPMN returns local names like "startEvent" → moddle wants "bpmn:StartEvent".
  return "bpmn:" + tag.charAt(0).toUpperCase() + tag.slice(1);
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
    if (raw) return patchExisting(raw, model, m);
  }
  return emitMinimal(model, m);
}

/** Round-trip the original XML, patching bounds + waypoints, adding new flow
 *  nodes and edges, dropping deleted ones. */
async function patchExisting(raw: string, model: CanvasModel, m: BpmnModdle): Promise<string> {
  const { rootElement: defs } = await m.fromXML(raw, "bpmn:Definitions");
  const definitions = defs as ModdleElement;

  // Index DI shapes/edges by referenced bpmnElement id.
  const diShape = new Map<string, ModdleElement>();
  const diEdge = new Map<string, ModdleElement>();
  let mainPlane: { planeElement?: ModdleElement[]; bpmnElement?: ModdleElement | string } | null = null;
  for (const dia of definitions.diagrams ?? []) {
    if (!mainPlane) mainPlane = dia.plane;
    for (const pe of dia.plane.planeElement ?? []) {
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
  const flowById = new Map<string, ModdleElement>();
  const collect = (parent: ModdleElement): void => {
    for (const fe of parent.flowElements ?? []) {
      if (fe.id) flowById.set(fe.id, fe);
      if (fe.flowElements) collect(fe);
    }
  };
  collect(process);

  const modelNodeIds = new Set(model.nodes.map((n) => n.id));
  const modelEdgeIds = new Set(model.edges.map((e) => e.id));

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
    let di = diShape.get(n.id);
    if (di?.bounds) {
      di.bounds.x = n.x; di.bounds.y = n.y; di.bounds.width = n.width; di.bounds.height = n.height;
      // Drop any stale external-label bounds. The source file's BPMNLabel
      // coordinates are frequently garbage (left over from an earlier layout)
      // and Omniboard doesn't track independent node-label positions, so we
      // let bpmn.io auto-place the label next to the patched element instead
      // of honouring stale coordinates that scatter labels across the canvas.
      di.label = undefined;
    } else {
      // New node — add bpmn:* element + BPMNShape DI
      const fe = m.create(shapeToBpmnType(n.shape), { id: n.id, name: n.label ?? "" }) as ModdleElement;
      (process.flowElements ??= []).push(fe);
      di = m.create("bpmndi:BPMNShape", {
        bpmnElement: fe,
        bounds: m.create("dc:Bounds", { x: n.x, y: n.y, width: n.width, height: n.height }),
      }) as ModdleElement;
      (mainPlane.planeElement ??= []).push(di);
      diShape.set(n.id, di);
    }
    // Patch name if changed.
    const existing = flowById.get(n.id);
    if (existing && typeof n.label === "string") existing.name = n.label;
  }
  // Drop deleted flow nodes from process + DI — but preserve any element a
  // surviving SequenceFlow still references via sourceRef/targetRef (e.g.
  // DataObjects, TextAnnotations, sub-process children the importer doesn't
  // map to canvas nodes). Otherwise the export would leave dangling refs.
  const refIdOf = (r: ModdleElement | string | undefined): string | undefined =>
    typeof r === "string" ? r : r?.id;
  // Build `referenced` from every SequenceFlow that will SURVIVE export
  // (i.e. is in modelEdgeIds). `flowById` is a stale snapshot taken before
  // new nodes/edges were appended, so don't gate on it — use modelEdgeIds
  // as the single source of truth.
  const referenced = new Set<string>();
  for (const fe of process.flowElements ?? []) {
    if (fe.$type !== "bpmn:SequenceFlow") continue;
    if (!modelEdgeIds.has(fe.id!)) continue;
    const src = refIdOf(fe.sourceRef);
    const tgt = refIdOf(fe.targetRef);
    if (src) referenced.add(src);
    if (tgt) referenced.add(tgt);
  }

  process.flowElements = (process.flowElements ?? []).filter((fe) => {
    if (fe.$type === "bpmn:SequenceFlow") return modelEdgeIds.has(fe.id!);
    return modelNodeIds.has(fe.id!) || referenced.has(fe.id!);
  });
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
    let de = diEdge.get(e.id);
    const wps = buildWaypoints(e, srcNode, tgtNode, m);
    if (de) {
      de.waypoint = wps;
      // Drop stale edge-label bounds too (same reasoning as node labels) —
      // bpmn.io re-centres the label on the midpoint of the new waypoints.
      de.label = undefined;
    } else {
      // Resolve / create the bpmn:SequenceFlow element.
      let sf = flowById.get(e.id);
      if (!sf) {
        const sourceFe = flowById.get(e.source);
        const targetFe = flowById.get(e.target);
        sf = m.create("bpmn:SequenceFlow", {
          id: e.id,
          name: e.label ?? "",
          sourceRef: sourceFe,
          targetRef: targetFe,
        }) as ModdleElement;
        (process.flowElements ??= []).push(sf);
      } else if (typeof e.label === "string") {
        sf.name = e.label;
      }
      de = m.create("bpmndi:BPMNEdge", { bpmnElement: sf, waypoint: wps }) as ModdleElement;
      (mainPlane.planeElement ??= []).push(de);
      diEdge.set(e.id, de);
    }
  }

  const { xml } = await m.toXML(definitions as never, { format: true });
  return xml;
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
      (pdi as { isHorizontal?: boolean }).isHorizontal = true;
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
          (ldi as { isHorizontal?: boolean }).isHorizontal = true;
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

  // Flow nodes
  const feById = new Map<string, ModdleElement>();
  process.flowElements = [];
  for (const n of model.nodes) {
    const fe = m.create(shapeToBpmnType(n.shape), { id: n.id, name: n.label ?? "" }) as ModdleElement;
    process.flowElements.push(fe);
    feById.set(n.id, fe);
  }
  // Sequence flows — keep them indexed so the matching BPMNEdge can reference
  // the actual sf element (not the source node) via `bpmnElement`.
  const sfById = new Map<string, ModdleElement>();
  for (const e of model.edges) {
    const sf = m.create("bpmn:SequenceFlow", {
      id: e.id,
      name: e.label ?? "",
      sourceRef: feById.get(e.source),
      targetRef: feById.get(e.target),
    }) as ModdleElement;
    process.flowElements.push(sf);
    sfById.set(e.id, sf);
  }
  // Diagram
  const plane = m.create("bpmndi:BPMNPlane", {
    id: "Plane_Export",
    bpmnElement: process,
    planeElement: [],
  }) as { planeElement?: ModdleElement[]; bpmnElement?: ModdleElement | string };
  for (const n of model.nodes) {
    plane.planeElement!.push(m.create("bpmndi:BPMNShape", {
      id: n.id + "_di",
      bpmnElement: feById.get(n.id),
      bounds: m.create("dc:Bounds", { x: n.x, y: n.y, width: n.width, height: n.height }),
    }));
  }
  for (const e of model.edges) {
    const src = model.nodes.find((n) => n.id === e.source);
    const tgt = model.nodes.find((n) => n.id === e.target);
    const sf = sfById.get(e.id);
    if (!src || !tgt || !sf) continue;
    plane.planeElement!.push(m.create("bpmndi:BPMNEdge", {
      id: e.id + "_di",
      bpmnElement: sf,
      waypoint: buildWaypoints(e, src, tgt, m),
    }));
  }
  const dia = m.create("bpmndi:BPMNDiagram", { id: "Diagram_Export", plane }) as ModdleElement;
  (defs.diagrams ??= []).push(dia as never);

  const { xml } = await m.toXML(defs as never, { format: true });
  return xml;
}
