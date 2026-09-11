import { ItemView, WorkspaceLeaf } from "obsidian";
import { validateBpmnModel } from "../io/bpmn/validator";
import type { OmniboardCanvas } from "../canvas/OmniboardCanvas";

export const OMNIBOARD_ISSUES_VIEW_TYPE = "omniboard-bpmn-issues";
const BOARD_VIEW_TYPE = "omniboard-board";
const ISSUE_EVENT = "omniboard-bpmn-issues-refresh";

export function emitBpmnIssuesRefresh(): void {
  window.dispatchEvent(new CustomEvent(ISSUE_EVENT));
}

export class BpmnIssuesView extends ItemView {
  private readonly onRefresh = () => this.render();

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return OMNIBOARD_ISSUES_VIEW_TYPE; }
  getDisplayText(): string { return "BPMN Issues"; }
  getIcon(): string { return "alert-triangle"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("omniboard-issues-view");
    window.addEventListener(ISSUE_EVENT, this.onRefresh);
    this.render();
  }

  async onClose(): Promise<void> {
    window.removeEventListener(ISSUE_EVENT, this.onRefresh);
  }

  private boardView(): { getCanvas?: () => OmniboardCanvas | null; focusCellId?: (id: string) => boolean } | null {
    const active = this.app.workspace.activeLeaf?.view as { getViewType?: () => string; getCanvas?: () => OmniboardCanvas | null; focusCellId?: (id: string) => boolean } | undefined;
    if (active?.getViewType?.() === BOARD_VIEW_TYPE) return active;
    return (this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE)[0]?.view as { getCanvas?: () => OmniboardCanvas | null; focusCellId?: (id: string) => boolean } | undefined) ?? null;
  }

  private render(): void {
    this.contentEl.empty();
    const board = this.boardView();
    const canvas = board?.getCanvas?.() ?? null;
    if (!canvas) {
      this.contentEl.createDiv({ cls: "obp-empty", text: "Mở một board Pie Flow BPMN để xem semantic issues." });
      return;
    }
    const model = canvas.getModel();
    const issues = validateBpmnModel(model);
    const head = this.contentEl.createDiv({ cls: "obp-title" });
    head.createSpan({ cls: "obp-kind", text: "BPMN Validator" });
    head.createEl("strong", { text: `${issues.length} issues` });
    if (!issues.length) {
      this.contentEl.createDiv({ cls: "obp-empty", text: "Không phát hiện lỗi semantic." });
      return;
    }
    for (const i of issues) {
      const row = this.contentEl.createEl("button", { cls: `obi-row ${i.severity}` });
      row.type = "button";
      row.createSpan({ cls: "obi-code", text: i.code });
      row.createSpan({ cls: "obi-msg", text: i.message });
      row.onclick = () => {
        if (board?.focusCellId) board.focusCellId(i.targetId);
      };
    }
  }
}
