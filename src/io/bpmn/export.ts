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
  diagrams?: Array<{ $type: string; plane: { planeElement?: ModdleElement[]; bpmnElement?: ModdleElement | string }; }>;
  bpmnElement?: ModdleElement | string;
  bounds?: { x: number; y: number; width: number; height: number };
  waypoint?: Array<{ x: number; y: number }>;
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
    let di = diShape.get(n.id);
    if (di?.bounds) {
      di.bounds.x = n.x; di.bounds.y = n.y; di.bounds.width = n.width; di.bounds.height = n.height;
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
  // Drop deleted flow nodes from process + DI.
  process.flowElements = (process.flowElements ?? []).filter((fe) => {
    if (fe.$type === "bpmn:SequenceFlow") return modelEdgeIds.has(fe.id!);
    return modelNodeIds.has(fe.id!);
  });
  mainPlane.planeElement = (mainPlane.planeElement ?? []).filter((pe: ModdleElement) => {
    const refId = typeof pe.bpmnElement === "string" ? pe.bpmnElement : pe.bpmnElement?.id;
    if (!refId) return true;
    if (pe.$type === "bpmndi:BPMNShape") return modelNodeIds.has(refId);
    if (pe.$type === "bpmndi:BPMNEdge") return modelEdgeIds.has(refId);
    return true;
  });

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

function buildWaypoints(
  e: CanvasModel["edges"][number],
  src: CanvasModel["nodes"][number],
  tgt: CanvasModel["nodes"][number],
  m: BpmnModdle,
): Array<{ x: number; y: number }> {
  const point = (x: number, y: number) => m.create("dc:Point", { x, y }) as unknown as { x: number; y: number };
  const start = point(src.x + src.width / 2, src.y + src.height / 2);
  const end = point(tgt.x + tgt.width / 2, tgt.y + tgt.height / 2);
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
