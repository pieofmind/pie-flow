/**
 * Story 7-21 — Raw source editor modal for the "Sửa dạng mã nguồn"
 * 3-dot menu item on inline `<DiagramCard>`.
 *
 * Provides a minimal CodeMirror 6 editor over the code-block source.
 * Useful when:
 * - The diagram has parse errors (warning card) — user needs to fix
 *   syntax that the canvas modal can't represent.
 * - The user wants byte-level control (e.g., reformatting BPMN XML by
 *   hand) that the canvas editor doesn't expose.
 *
 * Out of scope: syntax highlighting per language. CM6's full language
 * pack landscape (`@codemirror/lang-xml`, `@codemirror/lang-json`, etc.)
 * adds significant bundle weight; we ship plain-text editing for now.
 * Future story can layer in language packs lazily per `adapter.id`.
 */

import { App, Modal, Notice, setIcon } from "obsidian";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, historyKeymap, history } from "@codemirror/commands";

export interface SourceEditorModalOptions {
  app: App;
  /** Initial source text. */
  initialText: string;
  /** Diagram language id, e.g. "bpmn" / "flowchart" — shown in the header chip. */
  language: string;
  /**
   * Called when the user clicks "Lưu". The modal closes after the
   * callback returns (synchronously or via the returned Promise).
   */
  onSave: (newText: string) => void | Promise<void>;
}

export class SourceEditorModal extends Modal {
  private view: EditorView | null = null;
  private readonly opts: SourceEditorModalOptions;

  constructor(opts: SourceEditorModalOptions) {
    super(opts.app);
    this.opts = opts;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("diagrams-source-editor-modal");
    contentEl.empty();

    // Header — chip + close button + Lưu button
    const header = contentEl.createDiv({ cls: "diagrams-source-editor-header" });
    const chip = header.createDiv({ cls: "diagrams-source-editor-chip" });
    const chipIcon = chip.createSpan({ cls: "diagrams-source-editor-chip-icon" });
    setIcon(chipIcon, "code");
    chip.createSpan({
      cls: "diagrams-source-editor-chip-label",
      text: `Sửa mã nguồn · ${this.opts.language}`,
    });

    header.createDiv({ cls: "diagrams-source-editor-spacer" });

    const cancel = header.createEl("button", {
      cls: "diagrams-source-editor-btn",
    });
    const cancelIcon = cancel.createSpan({ cls: "diagrams-source-editor-btn-icon" });
    setIcon(cancelIcon, "x");
    cancel.createSpan({ text: "Hủy" });
    cancel.onclick = () => this.close();

    const save = header.createEl("button", {
      cls:
        "diagrams-source-editor-btn diagrams-source-editor-btn-primary",
    });
    const saveIcon = save.createSpan({ cls: "diagrams-source-editor-btn-icon" });
    setIcon(saveIcon, "check");
    save.createSpan({ text: "Lưu" });
    save.onclick = () => void this.commit();

    // Body — CodeMirror 6 editor
    const editorHost = contentEl.createDiv({
      cls: "diagrams-source-editor-body",
    });

    const state = EditorState.create({
      doc: this.opts.initialText,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.theme(
          {
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": { fontFamily: "var(--font-monospace)" },
          },
          { dark: document.body.classList.contains("theme-dark") },
        ),
      ],
    });
    this.view = new EditorView({ state, parent: editorHost });
    // Focus the editor after mount so the user can start typing immediately.
    setTimeout(() => this.view?.focus(), 0);
  }

  private async commit(): Promise<void> {
    if (!this.view) return;
    const newText = this.view.state.doc.toString();
    try {
      await this.opts.onSave(newText);
      new Notice("Đã lưu mã nguồn");
      this.close();
    } catch (err) {
      console.warn("[omniboard] source-edit save failed", err);
      new Notice("Lưu mã nguồn thất bại — xem console.");
    }
  }

  onClose(): void {
    // CM6 EditorView holds DOM listeners + RAF callbacks — destroy()
    // releases them. Without this, repeatedly opening the modal leaks.
    this.view?.destroy();
    this.view = null;
    this.contentEl.empty();
  }
}
