import type { PaletteSidebarItem } from "../../core/sidebarSchema";

export const statePaletteItems: ReadonlyArray<PaletteSidebarItem> = [
  // TRẠNG THÁI
  { id: "state", label: "State", icon: "rectangle-horizontal", shortcut: "S", group: "TRẠNG THÁI" },
  { id: "initial", label: "Initial", icon: "circle-dot", group: "TRẠNG THÁI" },
  { id: "final", label: "Final", icon: "circle-x", group: "TRẠNG THÁI" },

  // CHUYỂN
  { id: "transition", label: "Transition", icon: "arrow-right", group: "CHUYỂN" },
];
