export interface PaletteItem {
  shape: string; label: string; w: number; h: number;
  /** Optional seed for `NodeExtra` baked into the palette entry. Lets us list
   *  every BPMN event-trigger variant (message/timer/signal/…) without minting
   *  one shape kind per variant — the canvas spawns `bpmn-event-{start,inter,end}`
   *  + this seed copied onto the node's extras (e.g. `{ trigger: "message" }`). */
  seed?: { trigger?: string; throwing?: boolean; interrupting?: boolean };
  /** Hidden behind "Hiện thêm" in the flyout. Used for the rarer BPMN event
   *  triggers (signal/error/escalation/compensation/conditional/link/cancel/
   *  multiple/parallel-multiple) so the flyout doesn't run off-screen. */
  advanced?: boolean;
}
export interface ShapeCategory { title: string; items: PaletteItem[]; }

export interface CanvasModel {
  nodes: Array<{ id: string; shape: string; x: number; y: number; width: number; height: number; label: string; attrs?: Record<string, unknown> }>;
  edges: Array<{
    id: string; source: string; sourcePort?: string; target: string; targetPort?: string;
    /** Precise anchor on the source/target node (bpmn.io-style unlimited
     *  positioning). Offset is in graph pixels from the node's top-left corner.
     *  When set, takes precedence over the discrete `sourcePort` / `targetPort`
     *  string. Used by importers to preserve the exact waypoint position the
     *  source file specified. */
    sourceAnchor?: { dx: number; dy: number };
    targetAnchor?: { dx: number; dy: number };
    label?: string; labelPos?: { distance?: number; offset?: number | { x: number; y: number } }; y?: number; ret?: boolean;
    style?: { stroke?: string; width?: number; dash?: string; start?: string; end?: string };
    vertices?: Array<{ x: number; y: number }>;
    /** Optional override of the canvas router. Used by importers to preserve DI waypoints byte-for-byte. */
    router?: "manhattan" | "normal" | "orth";
  }>;
}
