import { App, Modal } from "obsidian";
import { render, h } from "preact";
import type { DiagramAdapter } from "./adapter";
import { readObsidianTheme } from "./theme";

/**
 * Full-screen editing modal shell. Hosts an adapter's <Editor> as a Preact tree.
 * The concrete drag-drop editors are mounted by each adapter (M1+).
 */
export class EditModal<TModel> extends Modal {
  private adapter: DiagramAdapter<TModel>;
  private model: TModel;
  private onCommit: (text: string) => void;

  constructor(
    app: App,
    adapter: DiagramAdapter<TModel>,
    source: string,
    onCommit: (text: string) => void
  ) {
    super(app);
    this.adapter = adapter;
    this.model = adapter.parse(source);
    this.onCommit = onCommit;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("diagrams-edit-modal");
    contentEl.empty();

    const theme = readObsidianTheme();
    const Editor = this.adapter.Editor;

    render(
      h(Editor, {
        initialModel: this.model,
        theme,
        onSave: (model: TModel) => {
          this.onCommit(this.adapter.serialize(model));
        },
        onClose: () => this.close(),
      }),
      contentEl
    );
  }

  onClose(): void {
    render(null, this.contentEl);
    this.contentEl.empty();
  }
}
