import { setIcon } from "obsidian";
import { validateBpmnModel } from "../io/bpmn/validator";
import { shapeIcon } from "../canvas/shapes/index";
import type { CanvasModel } from "../canvas/types";

type Node = CanvasModel["nodes"][number];
type Tab = "tree" | "issues";

export interface BoardSidePanelOptions {
  getModel: () => CanvasModel | null;
  /** Select + center a cell on the canvas (BoardView.focusCellId). */
  focus: (id: string) => void;
}

const label = (n: Node): string => (n.label || n.id).replace(/\s+/g, " ").trim();

/** Pool → lanes → steps (left to right). Nodes outside any pool are listed under "Ngoài pool". */
export function boardOutline(model: CanvasModel): Array<{ title: string; note?: string; lanes: Array<{ title: string; nodes: Node[] }> }> {
  const steps = model.nodes.filter((n) => n.shape !== "bpmn-pool" && n.shape !== "bpmn-annotation" && !n.parentId);
  const byX = (a: Node, b: Node) => a.x - b.x;
  const laneIds = new Set<string>();
  const pools = model.nodes.filter((n) => n.shape === "bpmn-pool").map((p) => {
    const lanes = ((p.attrs?.lanes as { id: string; label: string }[] | undefined) ?? []).map((l) => {
      laneIds.add(l.id);
      return { title: l.label, nodes: steps.filter((n) => n.laneId === l.id).sort(byX) };
    });
    return { title: label(p), note: lanes.length ? undefined : "Hộp đen · chỉ trao đổi tin", lanes };
  });
  const loose = steps.filter((n) => !n.laneId || !laneIds.has(n.laneId)).sort(byX);
  return loose.length ? [...pools, { title: "Ngoài pool", lanes: [{ title: "", nodes: loose }] }] : pools;
}

/**
 * Left panel of the board tab: "Cấu trúc" (outline, click → fly to the step)
 * and "Lỗi BPMN" (same validator + rows as BpmnIssuesView). Plain DOM, rebuilt
 * on refresh() — boards are small enough that diffing isn't worth it.
 */
export class BoardSidePanel {
  readonly el: HTMLElement;
  private tab: Tab = "tree";
  private selectedId: string | null = null;
  private readonly tabsEl: HTMLElement;
  private readonly paneEl: HTMLElement;

  constructor(parent: HTMLElement, private readonly opts: BoardSidePanelOptions) {
    this.el = parent.createDiv({ cls: "da-side" });
    this.tabsEl = this.el.createDiv({ cls: "da-side-tabs" });
    this.paneEl = this.el.createDiv({ cls: "da-side-pane" });
    this.paneEl.onclick = (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      if (row?.dataset.id) this.opts.focus(row.dataset.id);
    };
  }

  refresh(): void {
    const model = this.opts.getModel();
    const issues = model ? validateBpmnModel(model) : [];
    this.tabsEl.empty();
    const tabBtn = (t: Tab, text: string, count?: number) => {
      const b = this.tabsEl.createEl("button", { cls: `da-side-tab${this.tab === t ? " is-active" : ""}`, text });
      if (count !== undefined) b.createEl("b", { text: String(count) });
      b.onclick = () => { this.tab = t; this.refresh(); };
    };
    tabBtn("tree", "Cấu trúc");
    tabBtn("issues", "Lỗi BPMN", issues.length);

    this.paneEl.empty();
    if (!model) return;
    if (this.tab === "issues") {
      // Same rows/classes as the BPMN issues sidebar view, just placed here.
      const list = this.paneEl.createDiv({ cls: "da-side-issues omniboard-issues-view" });
      if (!issues.length) list.createDiv({ cls: "da-side-empty", text: "Không phát hiện lỗi semantic." });
      for (const i of issues) {
        const row = list.createEl("button", { cls: `obi-row ${i.severity}`, attr: { "data-id": i.targetId } });
        row.createSpan({ cls: "obi-code", text: i.code });
        row.createSpan({ cls: "obi-msg", text: i.message });
      }
    } else {
      const groups = boardOutline(model);
      if (!groups.length) this.paneEl.createDiv({ cls: "da-side-empty", text: "Board chưa có Pool hay bước nào." });
      for (const g of groups) {
        this.paneEl.createDiv({ cls: "da-side-pool", text: g.title });
        if (g.note) this.paneEl.createDiv({ cls: "da-side-empty", text: g.note });
        for (const l of g.lanes) {
          const box = this.paneEl.createEl("details", { cls: "da-side-lane" });
          box.open = true;
          const sum = box.createEl("summary");
          setIcon(sum, "chevron-right");
          sum.createSpan({ text: l.title || g.title });
          sum.createEl("em", { text: String(l.nodes.length) });
          for (const n of l.nodes) {
            const row = box.createDiv({ cls: "da-side-item", attr: { "data-id": n.id } });
            row.createSpan({ cls: "da-side-ico" }).innerHTML = shapeIcon(n.shape, n.attrs as { trigger?: string } | undefined);
            row.createSpan({ text: label(n) });
          }
        }
      }
    }
    this.markSelected(this.selectedId);
  }

  /** Highlight the row of the node selected on the canvas. */
  markSelected(id: string | null): void {
    this.selectedId = id;
    let first: HTMLElement | null = null;
    this.paneEl.querySelectorAll<HTMLElement>(".da-side-item[data-id]").forEach((r) => {
      const on = r.dataset.id === id;
      r.classList.toggle("is-active", on);
      if (on && !first) first = r;
    });
    (first as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
  }
}
