import type { CanvasModel } from "../../canvas/OmniboardCanvas";

/**
 * Provisional serialization: JSON CanvasModel inside the ```flowchart block.
 * (Spec §4.3 YAML+Mermaid format is deferred — see VĐ-A in quyet-dinh-thiet-ke.)
 */
export function parseFlowchart(source: string): CanvasModel {
  const trimmed = source.trim();
  if (!trimmed) return { nodes: [], edges: [] };
  try {
    const data = JSON.parse(trimmed) as CanvasModel;
    if (Array.isArray(data.nodes) && Array.isArray(data.edges)) return data;
  } catch {
    /* fall through */
  }
  return { nodes: [], edges: [] };
}

export function serializeFlowchart(model: CanvasModel): string {
  return JSON.stringify(model, null, 2);
}

export function emptyFlowchart(): string {
  const model: CanvasModel = {
    nodes: [{ id: "n1", shape: "fc-start", x: 80, y: 80, width: 44, height: 44, label: "Start" }],
    edges: [],
  };
  return JSON.stringify(model, null, 2);
}
