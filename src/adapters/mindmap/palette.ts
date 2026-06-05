import type { PaletteSidebarItem } from "../../core/sidebarSchema";

export const mindmapPaletteItems: ReadonlyArray<PaletteSidebarItem> = [
  // CẤU TRÚC
  { id: "central", label: "Chủ đề chính", icon: "circle-dot", shortcut: "C", group: "CẤU TRÚC" },
  { id: "branch", label: "Nhánh", icon: "git-branch", shortcut: "B", group: "CẤU TRÚC" },
  { id: "leaf", label: "Lá", icon: "leaf", shortcut: "L", group: "CẤU TRÚC" },
];
