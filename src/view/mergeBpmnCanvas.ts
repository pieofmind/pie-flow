/**
 * Merge a freshly-imported BPMN canvas (from the user's BPMN-view edit) back
 * into the previous wrapper canvas, preserving every element that lives only on
 * the omniboard side — sticky notes, free-form arrows, non-BPMN annotations.
 *
 * Strategy: treat `oldBpmnIds` (collected from the previous XML block) as the
 * set of BPMN-managed elements. Items in the previous canvas with those IDs
 * are owned by the BPMN view and reflect the BPMN edit verbatim. Items NOT in
 * that set are canvas-only and survive across the round-trip untouched.
 */

import type { CanvasModel } from "../canvas/types";

export interface BpmnMergeResult {
  model: CanvasModel;
  /** Count of nodes preserved from the canvas-only layer (sticky etc.). */
  preservedNodes: number;
  /** Count of edges preserved from the canvas-only layer (free-form). */
  preservedEdges: number;
  /** Count of nodes the BPMN edit added/removed/moved. */
  bpmnNodes: number;
  /** Count of edges the BPMN edit added/removed/moved. */
  bpmnEdges: number;
}

export function mergeBpmnImport(
  oldCanvas: CanvasModel,
  oldBpmnIds: ReadonlySet<string>,
  newImport: CanvasModel,
): BpmnMergeResult {
  const preservedNodes = oldCanvas.nodes.filter((n) => !oldBpmnIds.has(n.id));
  const preservedEdges = oldCanvas.edges.filter((e) => !oldBpmnIds.has(e.id));

  return {
    model: {
      nodes: [...newImport.nodes, ...preservedNodes],
      edges: [...newImport.edges, ...preservedEdges],
    },
    preservedNodes: preservedNodes.length,
    preservedEdges: preservedEdges.length,
    bpmnNodes: newImport.nodes.length,
    bpmnEdges: newImport.edges.length,
  };
}

/** Collect the IDs of every node + edge in a canvas model. */
export function collectIds(canvas: CanvasModel): Set<string> {
  const ids = new Set<string>();
  for (const n of canvas.nodes) ids.add(n.id);
  for (const e of canvas.edges) ids.add(e.id);
  return ids;
}
