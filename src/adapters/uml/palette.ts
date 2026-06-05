import type { PaletteSidebarItem } from "../../core/sidebarSchema";

export const umlPaletteItems: ReadonlyArray<PaletteSidebarItem> = [
  // PHẦN TỬ
  { id: "class", label: "Class", icon: "box", shortcut: "C", group: "PHẦN TỬ" },
  { id: "interface", label: "Interface", icon: "circle-dashed", shortcut: "I", group: "PHẦN TỬ" },
  { id: "enum", label: "Enum", icon: "list", group: "PHẦN TỬ" },

  // QUAN HỆ
  { id: "inheritance", label: "Inheritance", icon: "arrow-up", group: "QUAN HỆ" },
  { id: "association", label: "Association", icon: "arrow-right", group: "QUAN HỆ" },
];
