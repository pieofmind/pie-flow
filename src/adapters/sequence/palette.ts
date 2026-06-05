import type { PaletteSidebarItem } from "../../core/sidebarSchema";

export const sequencePaletteItems: ReadonlyArray<PaletteSidebarItem> = [
  // PHẦN TỬ
  { id: "participant", label: "Participant", icon: "rectangle-horizontal", shortcut: "P", group: "PHẦN TỬ" },
  { id: "actor", label: "Actor", icon: "user", shortcut: "A", group: "PHẦN TỬ" },

  // THÔNG ĐIỆP
  { id: "msg-sync", label: "Sync msg", icon: "arrow-right", group: "THÔNG ĐIỆP" },
  { id: "msg-async", label: "Async msg", icon: "arrow-up-right", group: "THÔNG ĐIỆP" },
  { id: "self-loop", label: "Self-loop", icon: "rotate-cw", group: "THÔNG ĐIỆP" },

  // KHỐI
  { id: "note", label: "Note", icon: "sticky-note", group: "KHỐI" },
  { id: "alt-block", label: "Alt block", icon: "split", group: "KHỐI" },
  { id: "loop-block", label: "Loop block", icon: "repeat", group: "KHỐI" },
];
