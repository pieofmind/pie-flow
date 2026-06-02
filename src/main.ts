import { Plugin, MarkdownView, Editor, MarkdownPostProcessorContext, Menu, Notice, TFile, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import { BoardView, BOARD_VIEW_TYPE } from "./view/BoardView";
import { serializeBoard, deserializeBoard, OMNIBOARD_SUFFIX } from "./view/boardSerde";
import { importBpmn } from "./io/bpmn/import";
import { renderModelToSvg } from "./canvas/staticRender";
import { render, h } from "preact";
import { AdapterRegistry } from "./core/registry";
import { EditModal } from "./core/modal";
import { readObsidianTheme } from "./core/theme";
import { DiagramCard } from "./ui/DiagramCard";
import { OMNIBOARD_PROPERTIES_VIEW_TYPE, OmniboardPropertiesView } from "./ui/PropertiesPanel";
import { BpmnIssuesView, OMNIBOARD_ISSUES_VIEW_TYPE } from "./ui/BpmnIssuesView";
import type { DiagramAdapter } from "./core/adapter";
import { DiagramsSettings, DEFAULT_SETTINGS, DiagramsSettingTab } from "./settings";
import { BpmnNativeView, BPMN_NATIVE_VIEW_TYPE } from "./bpmn-native/BpmnNativeView";
import { MINIMAL_BPMN_XML } from "./bpmn-native/BpmnNativeController";
import { BpmnPropertiesView, BPMN_PROPERTIES_VIEW_TYPE } from "./bpmn-native/BpmnPropertiesView";
import { registerBpmnIcons } from "./bpmn-native/bpmn-icons";

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
    registerBpmnIcons();

    // ── Excalidraw-style board: shares the .md extension with Obsidian, but
    // auto-swaps to the board view when the file's frontmatter marks it as one.
    this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf, this));
    this.registerView(OMNIBOARD_PROPERTIES_VIEW_TYPE, (leaf) => new OmniboardPropertiesView(leaf));
    this.registerView(OMNIBOARD_ISSUES_VIEW_TYPE, (leaf) => new BpmnIssuesView(leaf));
    // ── BPMN Native Mode (spike): dedicated view for .bpmn files
    this.registerView(BPMN_NATIVE_VIEW_TYPE, (leaf) => new BpmnNativeView(leaf, this));
    this.registerView(BPMN_PROPERTIES_VIEW_TYPE, (leaf) => new BpmnPropertiesView(leaf));
    this.registerExtensions(["bpmn"], BPMN_NATIVE_VIEW_TYPE);
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        void this.maybeSwapToBoardView(file);
        void this.maybeSwapToBpmnNativeView(file);
      })
    );

    // Add "Open as Omniboard" entry to the file's More-options menu (and
    // File Explorer context menu) for any *.omniboard.md file.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (!(file instanceof TFile) || !file.path.endsWith(OMNIBOARD_SUFFIX)) return;
        const leaf = this.findLeafForFile(file);
        const inBoardView = leaf?.view?.getViewType() === BOARD_VIEW_TYPE;
        menu.addItem((item) => {
          item
            .setTitle(inBoardView ? "Open as Markdown" : "Open as Omniboard")
            .setIcon(inBoardView ? "file-text" : "shapes")
            .setSection?.("pane")
            .onClick(async () => {
              const target = leaf ?? this.app.workspace.getLeaf("tab");
              if (!leaf) await target.openFile(file);
              await target.setViewState({
                type: inBoardView ? "markdown" : BOARD_VIEW_TYPE,
                state: { file: file.path },
              });
            });
        });
      })
    );

    // Ribbon → create a new board file and open it immediately.
    this.addRibbonIcon("shapes", "New board", () => this.createAndOpenBoard());

    this.addCommand({
      id: "new-board",
      name: "New board",
      callback: () => this.createAndOpenBoard(),
    });

    this.addCommand({
      id: "new-bpmn",
      name: "New BPMN diagram",
      callback: () => this.createAndOpenBpmn(),
    });

    this.addCommand({
      id: "insert-board-embed",
      name: "Insert new board (embed in note)",
      editorCallback: (editor: Editor) => this.insertNewBoardEmbed(editor),
    });

    this.addCommand({
      id: "open-as-markdown",
      name: "Open current board as Markdown",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view?.getViewType() !== BOARD_VIEW_TYPE) return false;
        if (checking) return true;
        void (leaf.view as BoardView).openAsMarkdown();
        return true;
      },
    });

    this.addCommand({
      id: "open-as-board",
      name: "Open current markdown as board",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view?.getViewType() !== "markdown") return false;
        const file = (leaf.view as MarkdownView).file;
        if (!file || !file.path.endsWith(OMNIBOARD_SUFFIX)) return false;
        if (checking) return true;
        void leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: file.path } });
        return true;
      },
    });

    this.addCommand({
      id: "open-omniboard-properties",
      name: "Open Omniboard BPMN properties",
      callback: async () => {
        const existing = this.app.workspace.getLeavesOfType(OMNIBOARD_PROPERTIES_VIEW_TYPE)[0];
        const leaf = existing ?? this.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: OMNIBOARD_PROPERTIES_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addCommand({
      id: "open-bpmn-native-properties",
      name: "Open BPMN Native properties",
      callback: async () => {
        const existing = this.app.workspace.getLeavesOfType(BPMN_PROPERTIES_VIEW_TYPE)[0];
        const leaf = existing ?? this.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: BPMN_PROPERTIES_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addCommand({
      id: "open-omniboard-bpmn-issues",
      name: "Open Omniboard BPMN issues",
      callback: async () => {
        const existing = this.app.workspace.getLeavesOfType(OMNIBOARD_ISSUES_VIEW_TYPE)[0];
        const leaf = existing ?? this.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: OMNIBOARD_ISSUES_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addCommand({
      id: "open-bpmn-native",
      name: "Open BPMN file in native mode",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        // @ts-expect-error view.file is available on FileView at runtime
        const file = leaf.view?.file as TFile | undefined;
        if (!file || !file.path.endsWith(".bpmn")) return false;
        if (checking) return true;
        void leaf.setViewState({ type: BPMN_NATIVE_VIEW_TYPE, state: { file: file.path } });
        return true;
      },
    });

    this.addCommand({
      id: "open-bpmn-source",
      name: "Open BPMN file as source",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        // @ts-expect-error view.file is available on FileView at runtime
        const file = leaf.view?.file as TFile | undefined;
        if (!file || !file.path.endsWith(".bpmn")) return false;
        if (checking) return true;
        void leaf.setViewState({ type: "markdown", state: { file: file.path } });
        return true;
      },
    });

    // Story 4.5 — Switch commands for wrapper format `.omniboard.md`.
    this.addCommand({
      id: "switch-to-bpmn-native",
      name: "Switch to BPMN Native view",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view?.getViewType() !== BOARD_VIEW_TYPE) return false;
        const file = (leaf.view as BoardView).file;
        if (!file || !file.path.endsWith(OMNIBOARD_SUFFIX)) return false;
        if (checking) return true;
        void (leaf.view as BoardView).switchToBpmnNativeView();
        return true;
      },
    });

    this.addCommand({
      id: "switch-to-board",
      name: "Switch to Omniboard view",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view?.getViewType() !== BPMN_NATIVE_VIEW_TYPE) return false;
        const view = leaf.view as BpmnNativeView;
        if (!view.isWrapperMode()) return false;
        if (checking) return true;
        void view.switchToBoardView();
        return true;
      },
    });

    this.addCommand({
      id: "convert-bpmn-to-wrapper",
      name: "Convert .bpmn to Omniboard wrapper (.omniboard.md)",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        // @ts-expect-error view.file is available on FileView at runtime
        const file = leaf.view?.file as TFile | undefined;
        if (!file || !file.path.endsWith(".bpmn")) return false;
        if (checking) return true;
        void this.convertBpmnToWrapper(file);
        return true;
      },
    });

    // Read-mode: render ![[x.omniboard.md]] embeds as a live preview card.
    this.registerMarkdownPostProcessor((el, ctx) => {
      el.querySelectorAll<HTMLElement>('.internal-embed[src$=".omniboard.md"]').forEach(
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

  onunload(): void {
    const styles = document.getElementById("bpmn-native-styles");
    if (styles) styles.remove();
  }

  /** Create a fresh, empty .omniboard.md file and return it (or null on failure). */
  /**
   * Convert a raw `.bpmn` file into a `.omniboard.md` wrapper next to it, then
   * open the wrapper in BoardView. Master block is canvas-data imported from
   * the BPMN XML; the original XML is embedded verbatim as the derived block.
   */
  private async convertBpmnToWrapper(bpmnFile: TFile): Promise<void> {
    try {
      const xml = await this.app.vault.read(bpmnFile);
      const { model, sourceMeta } = await importBpmn(xml);
      const basename = bpmnFile.basename;
      const dir = bpmnFile.parent?.path ?? "";
      const wrapperPath = normalizePath(
        (dir ? dir + "/" : "") + `${basename}${OMNIBOARD_SUFFIX}`,
      );
      const content = serializeBoard(model, "", sourceMeta, {
        compressDrawingData: this.settings.compressDrawingData,
        bpmnXml: xml,
      });
      let wrapperFile: TFile | null = null;
      try {
        wrapperFile = await this.app.vault.create(wrapperPath, content);
      } catch {
        const existing = this.app.vault.getAbstractFileByPath(wrapperPath);
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, content);
          wrapperFile = existing;
        }
      }
      if (!wrapperFile) {
        new Notice("Không tạo được file wrapper .omniboard.md.");
        return;
      }
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: wrapperFile.path } });
      new Notice(`Đã tạo wrapper: ${wrapperFile.path}`);
    } catch (err) {
      console.error("[omniboard] convertBpmnToWrapper failed", err);
      new Notice("Convert BPMN → wrapper thất bại. Xem console để biết chi tiết.");
    }
  }

  private async createBoardFile(): Promise<TFile | null> {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const path = normalizePath(`Omniboard ${stamp}${OMNIBOARD_SUFFIX}`);
    const content = serializeBoard({ nodes: [], edges: [] }, "", undefined, {
      compressDrawingData: this.settings.compressDrawingData,
    });
    try {
      return await this.app.vault.create(path, content);
    } catch {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) return existing;
      new Notice("Không tạo được file omniboard.");
      return null;
    }
  }

  /**
   * When Obsidian opens a `.omniboard.md` file in the default markdown view,
   * swap the leaf over to the dedicated board view. Lookup goes through
   * metadataCache so a manual edit removing the marker frontmatter cleanly
   * falls back to the markdown view.
   */
  private async maybeSwapToBoardView(file: TFile | null): Promise<void> {
    if (!file || !file.path.endsWith(OMNIBOARD_SUFFIX)) return;
    const ok = await this.hasOmniboardFrontmatter(file);
    if (!ok) return;
    const leaf = this.findLeafForFile(file);
    if (!leaf || leaf.view?.getViewType() === BOARD_VIEW_TYPE) return;
    await leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: file.path } });
  }

  /** Auto-swap .bpmn files to the BPMN Native view. */
  private async maybeSwapToBpmnNativeView(file: TFile | null): Promise<void> {
    if (!file || !file.path.endsWith(".bpmn")) return;
    const leaf = this.findLeafForFile(file);
    if (!leaf || leaf.view?.getViewType() === BPMN_NATIVE_VIEW_TYPE) return;
    await leaf.setViewState({ type: BPMN_NATIVE_VIEW_TYPE, state: { file: file.path } });
  }

  /** Resolve the marker frontmatter. metadataCache may not have indexed the
   *  file yet (freshly created / vault sync), so fall back to a quick raw read. */
  private async hasOmniboardFrontmatter(file: TFile): Promise<boolean> {
    const cache = this.app.metadataCache.getFileCache(file);
    const cached = cache?.frontmatter?.["omniboard-plugin"];
    if (cached === "parsed") return true;
    if (cached !== undefined) return false; // metadataCache present but doesn't have the marker
    try {
      const raw = await this.app.vault.cachedRead(file);
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
      if (!m) return false;
      // Accept bare or quoted YAML value: `omniboard-plugin: parsed` /
      // `omniboard-plugin: "parsed"` / `omniboard-plugin: 'parsed'`.
      return /^omniboard-plugin\s*:\s*["']?parsed["']?\s*$/m.test(m[1]);
    } catch {
      return false;
    }
  }

  private findLeafForFile(file: TFile): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((l) => {
      // @ts-expect-error - view.file is available on FileView/MarkdownView at runtime
      if (l.view?.file?.path === file.path) found = l;
    });
    return found;
  }

  /** Create a new .board file (Excalidraw-style) and open it in the board view. */
  private async createAndOpenBoard(): Promise<void> {
    const file = await this.createBoardFile();
    if (!file) return;
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  /** Create a new .bpmn file with template XML and open it in BPMN Native view. */
  private async createAndOpenBpmn(): Promise<void> {
    const folder = this.app.fileManager.getNewFileParent("");
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
    const path = normalizePath(`${folder.path}/BPMN-${ts}.bpmn`);
    try {
      const file = await this.app.vault.create(path, MINIMAL_BPMN_XML);
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch {
      new Notice("Không tạo được file BPMN.");
    }
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
      const model = deserializeBoard(raw);
      if (!model) throw new Error("invalid omniboard");
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
