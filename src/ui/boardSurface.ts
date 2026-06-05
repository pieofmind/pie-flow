import { OmniboardCanvas } from "../canvas/OmniboardCanvas";
import type { CanvasModel } from "../canvas/types";
import { SHAPE_CATEGORIES } from "../canvas/shapes/index";
import { buildBoardTopbar } from "./boardTopbar";

/**
 * The unified OmniBoard editing surface = the shared `.da-topbar` topbar + a
 * live `OmniboardCanvas`, mounted into any container. Used by the inline-card
 * edit modal so it is IDENTICAL to the full-tab BoardView (same topbar, same
 * canvas) — no per-diagram custom editor.
 */
export interface BoardSurfaceOptions {
  initialModel: CanvasModel;
  badgeLabel: string;
  badgeIcon?: string;
  /** Initial title shown in the (editable) topbar field. */
  title: string;
  /** Fires on every title keystroke; omit to render a read-only title. */
  onTitleChange?: (next: string) => void;
  /** Close without saving. */
  onClose: () => void;
  /** Save & close — receives the current canvas model. */
  onSave: (model: CanvasModel) => void;
  /** Optional export menu. */
  onExport?: (model: CanvasModel, e: MouseEvent) => void;
  /**
   * Optional extra icon buttons in the topbar (before the divider). Each
   * handler receives the live canvas model so the host can act on the current
   * edit state (e.g. "Edit full board" saves then opens the full-tab view).
   */
  extraButtons?: Array<{
    icon: string;
    tip: string;
    onClick: (model: CanvasModel) => void;
  }>;
}

/** Mount the surface into `container`. Returns a teardown function. */
export function mountBoardSurface(
  container: HTMLElement,
  opts: BoardSurfaceOptions,
): () => void {
  container.empty();
  container.addClass("diagrams-board-surface");
  const bar = container.createDiv({ cls: "da-topbar" });
  const host = container.createDiv({ cls: "diagrams-board-surface-canvas" });

  const canvas = new OmniboardCanvas(host, [...SHAPE_CATEGORIES], () => {});
  canvas.loadModel(opts.initialModel);

  buildBoardTopbar(bar, {
    getCanvas: () => canvas,
    badgeLabel: opts.badgeLabel,
    badgeIcon: opts.badgeIcon,
    title: opts.title,
    onTitleChange: opts.onTitleChange,
    onClose: opts.onClose,
    onSave: () => opts.onSave(canvas.getModel()),
    onExport: opts.onExport
      ? (e: MouseEvent) => opts.onExport!(canvas.getModel(), e)
      : undefined,
    extraButtons: opts.extraButtons?.map((eb) => ({
      icon: eb.icon,
      tip: eb.tip,
      onClick: () => eb.onClick(canvas.getModel()),
    })),
  });

  return () => {
    try {
      canvas.destroy();
    } finally {
      container.empty();
      container.removeClass("diagrams-board-surface");
    }
  };
}
