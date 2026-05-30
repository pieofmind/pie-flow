import { Plugin, MarkdownView, Editor, MarkdownPostProcessorContext, Menu, Notice, TFile, normalizePath, setIcon } from "obsidian";
import { BoardView, BOARD_VIEW_TYPE, BOARD_EXTENSION } from "./view/BoardView";
import { renderModelToSvg } from "./canvas/staticRender";
import type { CanvasModel } from "./canvas/types";
import { render, h } from "preact";
import { AdapterRegistry } from "./core/registry";
import { EditModal } from "./core/modal";
import { readObsidianTheme } from "./core/theme";
import { DiagramCard } from "./ui/DiagramCard";
import type { DiagramAdapter } from "./core/adapter";
import { DiagramsSettings, DEFAULT_SETTINGS, DiagramsSettingTab } from "./settings";

import { bpmnAdapter } from "./adapters/bpmn";
import { erdAdapter } from "./adapters/erd";
import { flowchartAdapter } from "./adapters/flowchart";
import { umlAdapter } from "./adapters/uml";
import { sequenceAdapter } from "./adapters/sequence";
import { stateAdapter } from "./adapters/state";
import { mindmapAdapter } from "./adapters/mindmap";
import { mermaidAdapter } from "./adapters/mermaid";

const ALL_ADAPTERS: DiagramAdapter[] = [
  bpmnAdapter,
  erdAdapter,
  flowchartAdapter,
  umlAdapter,
  sequenceAdapter,
  stateAdapter,
  mindmapAdapter,
  mermaidAdapter,
];

export default class DiagramsPlugin extends Plugin {
  registry = new AdapterRegistry();
  settings: DiagramsSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // ── Excalidraw-style board: full-screen view + dedicated file extension ──
    this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf));
    this.registerExtensions([BOARD_EXTENSION], BOARD_VIEW_TYPE);

    // Ribbon → create a new board file and open it immediately.
    this.addRibbonIcon("shapes", "New board", () => this.createAndOpenBoard());

    this.addCommand({
      id: "new-board",
      name: "New board",
      callback: () => this.createAndOpenBoard(),
    });

    this.addCommand({
      id: "insert-board-embed",
      name: "Insert new board (embed in note)",
      editorCallback: (editor: Editor) => this.insertNewBoardEmbed(editor),
    });

    // Read-mode: render ![[x.board]] embeds as a live preview card.
    this.registerMarkdownPostProcessor((el, ctx) => {
      el.querySelectorAll<HTMLElement>('.internal-embed[src$=".board"]').forEach(
        (node) => void this.renderBoardEmbed(node, ctx.sourcePath)
      );
    });

    // ── Inline code-block diagrams (spec model) — kept alongside the board ──
    for (const adapter of ALL_ADAPTERS) {
      this.registry.register(adapter);
      this.registerCodeBlock(adapter);
    }
    for (const adapter of this.registry.all()) {
      this.addCommand({
        id: `insert-${adapter.id}`,
        name: `Insert ${adapter.displayName} (in note)`,
        editorCallback: (editor: Editor) => this.insertDiagram(editor, adapter),
      });
    }

    this.addSettingTab(new DiagramsSettingTab(this.app, this));
  }

  /** Create a fresh, empty .board file and return it (or null on failure). */
  private async createBoardFile(): Promise<TFile | null> {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const path = normalizePath(`Board ${stamp}.${BOARD_EXTENSION}`);
    const content = JSON.stringify({ nodes: [], edges: [] }, null, 2);
    try {
      return await this.app.vault.create(path, content);
    } catch {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) return existing;
      new Notice("Không tạo được file board.");
      return null;
    }
  }

  /** Create a new .board file (Excalidraw-style) and open it in the board view. */
  private async createAndOpenBoard(): Promise<void> {
    const file = await this.createBoardFile();
    if (!file) return;
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  /** Create a board, embed it at the cursor (`![[...]]`), and open it. */
  private async insertNewBoardEmbed(editor: Editor): Promise<void> {
    const file = await this.createBoardFile();
    if (!file) return;
    editor.replaceSelection(`![[${file.path}]]\n`);
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  /** Render an `![[x.board]]` internal embed as a preview card in read mode. */
  private async renderBoardEmbed(host: HTMLElement, sourcePath: string): Promise<void> {
    if (host.dataset.daRendered === "1") return; // guard against re-processing
    const src = host.getAttribute("src");
    if (!src) return;
    const file = this.app.metadataCache.getFirstLinkpathDest(src.replace(/#.*$/, ""), sourcePath);
    if (!(file instanceof TFile)) return;
    host.dataset.daRendered = "1";
    host.empty();
    host.addClass("da-embed");

    const card = host.createDiv({ cls: "da-embed-card" });
    const head = card.createDiv({ cls: "da-embed-head" });
    head.createSpan({ cls: "da-embed-ttl", text: file.basename });
    const meta = head.createSpan({ cls: "da-embed-meta" });
    const open = head.createEl("button", { cls: "da-embed-open" });
    setIcon(open, "external-link");
    open.createSpan({ text: "Mở" });
    open.onclick = (e) => { e.preventDefault(); void this.app.workspace.getLeaf("tab").openFile(file); };

    const body = card.createDiv({ cls: "da-embed-body" });
    try {
      const raw = await this.app.vault.cachedRead(file);
      const model = JSON.parse(raw) as CanvasModel;
      const nodes = model.nodes?.length ?? 0;
      meta.setText(`${nodes} phần tử · ${model.edges?.length ?? 0} nối`);
      if (!nodes) { body.createDiv({ cls: "da-embed-empty", text: "Board trống — bấm Mở để vẽ." }); return; }
      // Inline SVG inside the document inherits the loaded plugin stylesheet,
      // so no CSS needs embedding — just the `lk-root` class (set by the renderer).
      const wrap = body.createDiv({ cls: "da-embed-svg" });
      wrap.innerHTML = renderModelToSvg(model, "", 16, "transparent");
    } catch {
      body.createDiv({ cls: "da-embed-empty", text: "Không đọc được board." });
    }
  }

  /** Insert from the ribbon menu — needs to find the active markdown editor itself. */
  private insertDiagramIntoActiveEditor(adapter: DiagramAdapter): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Mở một note (Editing mode) rồi chèn diagram.");
      return;
    }
    this.insertDiagram(view.editor, adapter);
  }

  private registerCodeBlock(adapter: DiagramAdapter): void {
    this.registerMarkdownCodeBlockProcessor(
      adapter.codeBlockLanguage,
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        const theme = readObsidianTheme();
        const mount = el.createDiv({ cls: "diagrams-card-mount" });

        render(
          h(DiagramCard, {
            adapter,
            source,
            theme,
            onEdit: () => this.openEditor(adapter, source, el, ctx),
          }),
          mount
        );
      }
    );
  }

  private openEditor(
    adapter: DiagramAdapter,
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): void {
    new EditModal(this.app, adapter, source, (newText) => {
      this.replaceCodeBlock(el, ctx, adapter.codeBlockLanguage, newText);
    }).open();
  }

  /** Rewrite the fenced block that produced `el` with new content. */
  private replaceCodeBlock(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    lang: string,
    newText: string
  ): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const info = ctx.getSectionInfo(el);
    if (!info) return;

    const editor = view.editor;
    const fence = "```";
    const block = `${fence}${lang}\n${newText}\n${fence}`;
    editor.replaceRange(
      block,
      { line: info.lineStart, ch: 0 },
      { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length }
    );
  }

  private insertDiagram(editor: Editor, adapter: DiagramAdapter): void {
    const block = `\`\`\`${adapter.codeBlockLanguage}\n${adapter.emptyTemplate()}\n\`\`\`\n`;
    editor.replaceSelection(block);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
