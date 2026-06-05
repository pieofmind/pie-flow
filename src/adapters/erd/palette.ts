import type { PaletteSidebarItem } from "../../core/sidebarSchema";

export const erdPaletteItems: ReadonlyArray<PaletteSidebarItem> = [
  // BẢNG
  { id: "table", label: "Table", icon: "table", shortcut: "T", group: "BẢNG" },

  // CỘT
  { id: "pk-col", label: "PK Column", icon: "key", group: "CỘT" },
  { id: "fk-col", label: "FK Column", icon: "link", group: "CỘT" },
  { id: "col", label: "Cột", icon: "columns", group: "CỘT" },

  // QUAN HỆ
  { id: "ref", label: "Ref", icon: "arrow-right", group: "QUAN HỆ" },
];
