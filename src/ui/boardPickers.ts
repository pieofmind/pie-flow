import { App, FuzzySuggestModal, SuggestModal, TFile, setIcon } from "obsidian";
import type { DiagramAdapter } from "../core/adapter";
import { OMNIBOARD_SUFFIX } from "../view/boardSerde";

/** One entry in the "new board" type picker. `adapter === null` → blank board. */
export interface BoardTypeChoice {
  adapter: DiagramAdapter | null;
  label: string;
  icon: string;
}

/**
 * Quick picker shown when creating a new board — lets the user choose the
 * diagram type (or a blank board) in a single step instead of cluttering the
 * command palette with one command per type.
 */
export class BoardTypePicker extends SuggestModal<BoardTypeChoice> {
  constructor(
    app: App,
    private readonly choices: BoardTypeChoice[],
    private readonly onChoose: (choice: BoardTypeChoice) => void,
  ) {
    super(app);
    this.setPlaceholder("Chọn loại board…");
  }

  getSuggestions(query: string): BoardTypeChoice[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.choices;
    return this.choices.filter((c) => c.label.toLowerCase().includes(q));
  }

  renderSuggestion(choice: BoardTypeChoice, el: HTMLElement): void {
    el.addClass("omniboard-type-suggestion");
    const icon = el.createSpan({ cls: "omniboard-type-suggestion-icon" });
    setIcon(icon, choice.icon);
    el.createSpan({ cls: "omniboard-type-suggestion-label", text: choice.label });
  }

  onChooseSuggestion(choice: BoardTypeChoice): void {
    this.onChoose(choice);
  }
}

/**
 * Fuzzy picker over every existing `.omniboard.md` file in the vault — used to
 * embed an already-created board into the current note.
 */
export class ExistingBoardPicker extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onChoose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Tìm board đã có…");
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((f) => f.path.endsWith(OMNIBOARD_SUFFIX))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
