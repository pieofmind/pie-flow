import type { PaletteSidebarItem } from "../../core/sidebarSchema";

export const mermaidPaletteItems: ReadonlyArray<PaletteSidebarItem> = [
  // PHẦN TỬ FLOWCHART
  { id: "process", label: "Process", icon: "rectangle-horizontal", shortcut: "P", group: "PHẦN TỬ" },
  { id: "decision", label: "Decision", icon: "diamond", shortcut: "D", group: "PHẦN TỬ" },
  { id: "subgraph", label: "Subgraph", icon: "frame", group: "PHẦN TỬ" },

  // LIÊN KẾT
  { id: "arrow", label: "Arrow", icon: "arrow-right", group: "LIÊN KẾT" },
  { id: "dotted", label: "Dotted", icon: "dot", group: "LIÊN KẾT" },
];
