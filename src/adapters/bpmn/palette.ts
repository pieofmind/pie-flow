import type { PaletteSidebarItem } from "../../core/sidebarSchema";

/**
 * Static palette declaration for the BPMN adapter.
 * Items group into PHẦN TỬ (events/tasks/gateways), SUBPROCESS, FLOW, DATA.
 *
 * `onActivate` is intentionally omitted — dispatch happens at the
 * `<PaletteSidebar>` level via `onSelectItem`. Adapters that need
 * model-aware activation will move to a function form in a follow-up.
 */
export const bpmnPaletteItems: ReadonlyArray<PaletteSidebarItem> = [
  // PHẦN TỬ
  { id: "start-event", label: "Start", icon: "circle-dot", shortcut: "S", group: "PHẦN TỬ" },
  { id: "end-event", label: "End", icon: "circle-x", shortcut: "E", group: "PHẦN TỬ" },
  { id: "task", label: "Task", icon: "rectangle-horizontal", shortcut: "T", group: "PHẦN TỬ" },
  { id: "user-task", label: "User Task", icon: "user", group: "PHẦN TỬ" },
  { id: "service-task", label: "Service Task", icon: "cog", group: "PHẦN TỬ" },
  { id: "gateway", label: "Gateway", icon: "diamond", shortcut: "G", group: "PHẦN TỬ" },

  // SUBPROCESS
  { id: "subprocess", label: "Subprocess", icon: "frame", group: "SUBPROCESS" },
  { id: "event-subprocess", label: "Event Sub", icon: "square-dashed", group: "SUBPROCESS" },
  { id: "call-activity", label: "Call Activity", icon: "external-link", group: "SUBPROCESS" },

  // FLOW
  { id: "sequence-flow", label: "Sequence", icon: "arrow-right", group: "FLOW" },

  // DATA
  { id: "data-object", label: "Data Object", icon: "file-text", group: "DATA" },
  { id: "data-store", label: "Data Store", icon: "database", group: "DATA" },
];
