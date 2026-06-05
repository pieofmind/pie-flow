import type { PaletteSidebarItem } from "../../core/sidebarSchema";

/**
 * Static palette declaration for the Flowchart adapter (Story 7-15).
 * Groups: PHẦN TỬ (start/end/process/decision), LIÊN KẾT (connector),
 * DỮ LIỆU (data).
 */
export const flowchartPaletteItems: ReadonlyArray<PaletteSidebarItem> = [
  // PHẦN TỬ
  { id: "start", label: "Bắt đầu", icon: "circle-dot", shortcut: "S", group: "PHẦN TỬ" },
  { id: "end", label: "Kết thúc", icon: "circle-x", shortcut: "E", group: "PHẦN TỬ" },
  { id: "process", label: "Tiến trình", icon: "rectangle-horizontal", shortcut: "P", group: "PHẦN TỬ" },
  { id: "decision", label: "Quyết định", icon: "diamond", shortcut: "D", group: "PHẦN TỬ" },

  // LIÊN KẾT
  { id: "connector", label: "Mũi tên", icon: "arrow-right", group: "LIÊN KẾT" },

  // DỮ LIỆU
  { id: "data", label: "Dữ liệu", icon: "file-text", group: "DỮ LIỆU" },
];
