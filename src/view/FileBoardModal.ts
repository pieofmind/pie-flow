import { App, Modal, Notice, TFile } from "obsidian";
import type { CanvasModel } from "../canvas/types";
import { mountBoardSurface } from "../ui/boardSurface";
import {
  deserializeBoard,
  deserializeSourceMeta,
  serializeBoard,
} from "./boardSerde";
import type DiagramsPlugin from "../main";

/**
 * Popup editor for a `.omniboard.md` file.
 *
 * Unlike the inline `EditModal` (which round-trips text inside a host note),
 * this modal is bound to a real file and is the SINGLE source of truth: it
 * mounts the SAME unified board surface as the full-tab `BoardView`
 * (`mountBoardSurface`) and saves straight back to the file via
 * `vault.modify`. Because both the popup and the full view write the same
 * file, every edit stays in sync automatically.
 *
 * The topbar carries an extra "Sửa toàn màn hình" button that saves the
 * current edits and opens the original file in the full-tab BoardView.
 */
export class FileBoardModal extends Modal {
  private teardown: (() => void) | null = null;
  /** Raw file content at open time — preserved so frontmatter / source-meta /
   *  derived BPMN blocks survive a save. */
  private previousRaw = "";

  constructor(
    app: App,
    private readonly plugin: DiagramsPlugin,
    private readonly file: TFile,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("diagrams-edit-modal");
    contentEl.empty();
    void this.openSurface();
  }

  private async openSurface(): Promise<void> {
    const { contentEl } = this;
    const hint = contentEl.createDiv({
      cls: "diagrams-placeholder-render",
      text: "Đang mở board…",
    });

    let model: CanvasModel | null;
    try {
      this.previousRaw = await this.app.vault.read(this.file);
      model = deserializeBoard(this.previousRaw);
    } catch (e: unknown) {
      hint.setText(
        "Không đọc được board: " + (e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    if (!model) {
      hint.setText("File không đúng định dạng Omniboard.");
      return;
    }
    // The modal may have been closed while the async read ran.
    if (!contentEl.isConnected) return;
    contentEl.empty();

    let title = this.file.basename;

    this.teardown = mountBoardSurface(contentEl, {
      initialModel: model,
      badgeLabel: title,
      badgeIcon: "shapes",
      title,
      onTitleChange: (t) => {
        title = t;
      },
      onClose: () => this.close(),
      onSave: (m) => {
        void this.persist(m);
        this.close();
      },
      extraButtons: [
        {
          icon: "maximize-2",
          tip: "Sửa toàn màn hình",
          onClick: (m) => {
            void (async () => {
              await this.persist(m);
              this.close();
              await this.plugin.openBoardFile(this.file);
            })();
          },
        },
      ],
    });
  }

  /** Serialize + write the model back to the file, preserving prior blocks. */
  private async persist(model: CanvasModel): Promise<void> {
    try {
      const content = serializeBoard(
        model,
        this.previousRaw,
        deserializeSourceMeta(this.previousRaw) ?? undefined,
        { compressDrawingData: this.plugin.settings.compressDrawingData },
      );
      await this.app.vault.modify(this.file, content);
    } catch (e: unknown) {
      console.error("[omniboard] FileBoardModal save failed", e);
      new Notice("Lưu board thất bại — xem console.");
    }
  }

  onClose(): void {
    if (this.teardown) {
      this.teardown();
      this.teardown = null;
    }
    this.contentEl.empty();
  }
}
