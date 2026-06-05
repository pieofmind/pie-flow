import { setIcon } from "obsidian";
import type { OmniboardCanvas } from "../canvas/OmniboardCanvas";

/**
 * Shared OmniBoard editor topbar (`.da-topbar`) — the SINGLE source of truth
 * used by BOTH the full-tab `BoardView` and the inline-card edit modal, so the
 * editing chrome is identical everywhere (no per-surface re-implementation).
 *
 * Buttons render only when their handler is supplied, so a host can show a
 * subset (e.g. the modal omits "switch to BPMN native" / "open as markdown").
 */
export interface BoardTopbarOptions {
  /** Returns the live canvas (undo/redo/duplicate/delete dispatch into it). */
  getCanvas: () => OmniboardCanvas | null;
  /** Badge label at the left (e.g. "BOARD", "BPMN 2.0"). */
  badgeLabel: string;
  /** Badge icon (Lucide). */
  badgeIcon?: string;
  /** Title text. */
  title: string;
  /** When provided, the title renders as an editable input calling this. */
  onTitleChange?: (next: string) => void;
  /** Close without saving. */
  onClose: () => void;
  /** Save & close. */
  onSave: () => void;
  /** Export menu (anchored at the click). Omit to hide the Export button. */
  onExport?: (e: MouseEvent) => void;
  /** Optional extra buttons before the divider (BoardView: properties/issues). */
  extraButtons?: Array<{ icon: string; tip: string; onClick: () => void }>;
}

/**
 * Build the topbar into `bar` (an element that already has class `da-topbar`).
 * Returns a `setTitle` updater for hosts that rename externally.
 */
export function buildBoardTopbar(
  bar: HTMLElement,
  opts: BoardTopbarOptions,
): { setTitle: (t: string) => void } {
  bar.empty();

  const close = bar.createEl("button", { cls: "da-tb-close" });
  setIcon(close, "x");
  close.createSpan({ text: "Đóng" });
  close.onclick = () => opts.onClose();

  const badge = bar.createDiv({ cls: "da-tb-badge" });
  setIcon(badge, opts.badgeIcon ?? "shapes");
  badge.createSpan({ text: opts.badgeLabel });

  let titleEl: HTMLElement;
  if (opts.onTitleChange) {
    const input = bar.createEl("input", { cls: "da-tb-title da-tb-title-input" });
    input.type = "text";
    input.value = opts.title;
    input.placeholder = "Tên sơ đồ";
    input.oninput = () => opts.onTitleChange!(input.value);
    titleEl = input;
  } else {
    titleEl = bar.createDiv({ cls: "da-tb-title", text: opts.title });
  }

  bar.createDiv({ cls: "da-tb-grow" });

  const iconBtn = (icon: string, tip: string, fn: () => void): void => {
    const b = bar.createEl("button", { cls: "da-tb-ic" });
    setIcon(b, icon);
    b.setAttribute("aria-label", tip);
    b.title = tip;
    b.onclick = fn;
  };

  iconBtn("undo-2", "Hoàn tác", () => opts.getCanvas()?.undo());
  iconBtn("redo-2", "Làm lại", () => opts.getCanvas()?.redo());
  iconBtn("copy", "Nhân bản", () => opts.getCanvas()?.duplicate());
  iconBtn("trash-2", "Xóa", () => opts.getCanvas()?.deleteSelection());
  iconBtn("layout-dashboard", "Tự sắp xếp", () => opts.getCanvas()?.autoLayout("LR"));
  iconBtn("maximize", "Vừa khung", () => opts.getCanvas()?.fit());

  if (opts.extraButtons?.length) {
    bar.createDiv({ cls: "da-tb-divider" });
    for (const eb of opts.extraButtons) iconBtn(eb.icon, eb.tip, eb.onClick);
  }

  if (opts.onExport) {
    bar.createDiv({ cls: "da-tb-divider" });
    const exp = bar.createEl("button", { cls: "da-tb-ic" });
    setIcon(exp, "download");
    exp.setAttribute("aria-label", "Export");
    exp.title = "Export (SVG / PNG / PDF)";
    exp.onclick = (e) => opts.onExport!(e);
  }

  const save = bar.createEl("button", { cls: "da-tb-save" });
  setIcon(save, "check");
  save.createSpan({ text: "Lưu & đóng" });
  save.onclick = () => opts.onSave();

  return {
    setTitle: (t: string) => {
      if (opts.onTitleChange && titleEl instanceof HTMLInputElement) titleEl.value = t;
      else titleEl.setText(t);
    },
  };
}
