import { Modal, type App } from "obsidian";

/**
 * "File changed from outside while you were editing" — shared by the Board and
 * the BPMN native view. Resolves "reload" (take the file's version) or "keep"
 * (write this view's version over it). Closing without choosing (Esc) is the
 * safe option: reload.
 */
export function askExternalChange(app: App): Promise<"reload" | "keep"> {
  return new Promise((resolve) => new ExternalChangeModal(app, resolve).open());
}

class ExternalChangeModal extends Modal {
  private answered = false;
  constructor(app: App, private readonly done: (c: "reload" | "keep") => void) {
    super(app);
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "File đã đổi bên ngoài" });
    contentEl.createEl("p", { text: "File này vừa bị sửa ngoài tab (script / plugin / tab khác) trong lúc bạn đang có thay đổi chưa lưu." });
    const actions = contentEl.createDiv({ cls: "lk-prow2" });
    const btn = (text: string, choice: "reload" | "keep", cta = false) => {
      const b = actions.createEl("button", { text });
      if (cta) b.addClass("mod-cta");
      b.onclick = () => { this.answered = true; this.done(choice); this.close(); };
    };
    btn("Nạp lại từ file", "reload", true);
    btn("Giữ bản đang sửa (ghi đè file)", "keep");
  }
  onClose(): void {
    this.contentEl.empty();
    if (!this.answered) this.done("reload");
  }
}
