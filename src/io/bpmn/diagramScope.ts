/** A BPMN file may hold several top-level diagrams (planes), each drawing its
 *  own part of the model. The Board shows one at a time, so what is drawn only
 *  on the other ones is "foreign": not imported, and left alone on export. */

type PlaneLike = { planeElement?: Array<{ bpmnElement?: { id?: string } | string }> };

const refOf = (pe: { bpmnElement?: { id?: string } | string }): string | undefined =>
  typeof pe.bpmnElement === "string" ? pe.bpmnElement : pe.bpmnElement?.id;

/** Ids drawn on a top-level plane other than `shown`, and not on `shown` (or on a sub-process plane). */
export function foreignIds(topPlanes: readonly PlaneLike[], shown: readonly PlaneLike[]): Set<string> {
  const mine = new Set<string>();
  for (const pl of shown) for (const pe of pl.planeElement ?? []) { const id = refOf(pe); if (id) mine.add(id); }
  const out = new Set<string>();
  for (const pl of topPlanes) {
    if (shown.includes(pl)) continue;
    for (const pe of pl.planeElement ?? []) { const id = refOf(pe); if (id && !mine.has(id)) out.add(id); }
  }
  return out;
}

/** A flow with both ends foreign belongs to the other diagram even when its own edge is not drawn. */
export function addForeignFlows(foreign: Set<string>, flows: ReadonlyArray<{ id?: string; sourceRef?: unknown; targetRef?: unknown }>): void {
  const idOf = (r: unknown): string | undefined => (typeof r === "string" ? r : (r as { id?: string } | undefined)?.id);
  for (const f of flows) {
    const a = idOf(f.sourceRef), b = idOf(f.targetRef);
    if (f.id && a && b && foreign.has(a) && foreign.has(b)) foreign.add(f.id);
  }
}
