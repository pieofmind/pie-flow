import type { PaletteSidebarItem } from "../../core/sidebarSchema";

export const dbmlPaletteItems: ReadonlyArray<PaletteSidebarItem> = [
  // BẢNG
  { id: "table", label: "Table", icon: "table", shortcut: "T", group: "BẢNG" },

  // QUAN HỆ
  { id: "ref-one-to-one", label: "Ref 1↔1", icon: "arrow-left-right", group: "QUAN HỆ" },
  { id: "ref-one-to-many", label: "Ref 1↔n", icon: "git-fork", group: "QUAN HỆ" },
  { id: "ref-many-to-many", label: "Ref n↔n", icon: "network", group: "QUAN HỆ" },

  // KHÁC
  { id: "enum", label: "Enum", icon: "list", group: "KHÁC" },
  { id: "table-group", label: "Table Group", icon: "layers", group: "KHÁC" },
];
