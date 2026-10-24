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

export interface BoardAppState {
  /** "dark" draws the board with its own dark palette (n8n-style); omitted = light. */
  theme?: "dark";
  /** Light board background (#rrggbb); omitted = cream paper. */
  background?: string;
  /** Dark board background (#rrggbb); omitted = charcoal. */
  backgroundDark?: string;
}

export interface CanvasModel {
  nodes: Array<{
    id: string; shape: string; x: number; y: number; width: number; height: number; label: string;
    /** Phase B — Subprocess containment. If set, this node belongs INSIDE the
     *  flow element with this id (a subProcess / transaction / adhoc /
     *  event-subprocess). Importer fills this when recursing into nested
     *  flowElements; exporter pushes the node into the right parent's
     *  flowElements instead of the top-level process. Null/undefined = top-level. */
    parentId?: string;
    /** Phase B — Lane membership (BPMN swimlane). Independent of `parentId`:
     *  a node can be in a lane (laneId set) AND inside a subprocess (parentId
     *  set). Importer fills this from `lane.flowNodeRef`; exporter rebuilds
     *  `laneSet.lane.flowNodeRef` from the union of nodes sharing a laneId. */
    laneId?: string;
    attrs?: Record<string, unknown>;
  }>;
  /** Per-board look, saved in the file. Absent = light theme on the cream paper. */
  appState?: BoardAppState;
  edges: Array<{
    id: string; source: string; sourcePort?: string; target: string; targetPort?: string;
    /** Legacy/import-only precise anchor on the source/target node.
     *  Offset is in graph pixels from the node's top-left corner.
     *  When set, takes precedence over the discrete `sourcePort` / `targetPort`
     *  string. Used by importers to preserve the exact waypoint position the
     *  source file specified; newly drawn canvas edges use fixed ports. */
    sourceAnchor?: { dx: number; dy: number };
    targetAnchor?: { dx: number; dy: number };
    label?: string; labelPos?: { distance?: number; offset?: number | { x: number; y: number } }; y?: number; ret?: boolean;
    style?: { stroke?: string; width?: number; dash?: string; start?: string; end?: string };
    vertices?: Array<{ x: number; y: number }>;
    /** Optional override of the canvas router. Used by importers to preserve DI waypoints byte-for-byte. */
    router?: "manhattan" | "normal" | "orth" | "avoid";
    /** BPMN edge type (Phase A). Default "sequence" when omitted.
     *  - "sequence": bpmn:SequenceFlow (solid arrow inside a process)
     *  - "message": bpmn:MessageFlow (dashed arrow across pool boundary)
     *  - "association": bpmn:Association (dotted, optionally directional) */
    kind?: "sequence" | "message" | "association";
    /** BPMN-specific edge attrs (Phase A):
     *  - condition: conditionExpression body on a SequenceFlow (string body).
     *  - isDefault: this flow is the default branch of its source gateway/activity.
     *  - associationDirection: "None" | "One" | "Both" (Association only). */
    attrs?: {
      condition?: string;
      isDefault?: boolean;
      associationDirection?: "None" | "One" | "Both";
      [key: string]: unknown;
    };
  }>;
}
