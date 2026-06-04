/**
 * Story 7-12 — Live Preview embed rendering for `.omniboard` /
 * `.omniboard.md` files.
 *
 * **Problem:** `registerMarkdownPostProcessor` fires reliably for
 * Reading mode but is unreliable for embed widgets in Live Preview —
 * Obsidian's Live Preview renders internal-embed widgets via
 * CodeMirror 6, NOT through the markdown rendering pipeline. Embeds
 * therefore render as raw markdown content (the .omniboard.md file's
 * frontmatter warning + "Text Elements" list) instead of a preview
 * card.
 *
 * **Solution:** Register a CodeMirror 6 `ViewPlugin` that scans the
 * syntax tree for `![[*.omniboard]]` / `![[*.omniboard.md]]` wikilinks
 * and replaces them with a `WidgetType` rendering the preview card.
 * Reading mode keeps using the post-processor route (already working)
 * — the two routes are mutually exclusive at runtime.
 *
 * **Lifecycle:** Obsidian's `registerEditorExtension` automatically
 * tears the extension down when the plugin unloads (P1 compliance).
 * Widget cleanup releases the host DOM via `destroy(dom)` + cancels
 * any in-flight `vault.cachedRead` via a mounted-flag check.
 */

import { Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { TFile, setIcon } from "obsidian";
import type DiagramsPlugin from "../main";
import { deserializeBoard } from "../view/boardSerde";
import { renderModelToSvg } from "../canvas/staticRender";
import { isOmniboardLink } from "./linkUtils";

// Re-export the pure check so existing callers needn't switch imports.
export { isOmniboardLink };

/**
 * Widget rendering the live-preview embed card for one `.omniboard.md`
 * file. Identity is keyed by file path so CodeMirror reuses the widget
 * across rapid re-renders (scroll, edit) instead of churning DOM.
 */
class OmniboardEmbedWidget extends WidgetType {
  /** Tracks attached DOM so we can abort an in-flight cachedRead. */
  private mounted: HTMLElement | null = null;

  constructor(
    private readonly file: TFile,
    private readonly plugin: DiagramsPlugin,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof OmniboardEmbedWidget &&
      other.file.path === this.file.path
    );
  }

  toDOM(_view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.addClass("omniboard-embed-host");
    host.addClass("da-embed");
    this.mounted = host;

    const card = host.createDiv({ cls: "da-embed-card" });
    const head = card.createDiv({ cls: "da-embed-head" });
    head.createSpan({ cls: "da-embed-ttl", text: this.file.basename });
    const meta = head.createSpan({ cls: "da-embed-meta" });
    const open = head.createEl("button", { cls: "da-embed-open" });
    setIcon(open, "external-link");
    open.createSpan({ text: "Mở" });
    open.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.plugin.app.workspace.getLeaf("tab").openFile(this.file);
    };

    const body = card.createDiv({ cls: "da-embed-body" });
    const loading = body.createDiv({
      cls: "da-embed-loading",
      text: "Đang tải…",
    });

    // Read asynchronously so toDOM() returns synchronously — required by
    // CodeMirror's widget contract. Abort on unmount via mounted check.
    void (async () => {
      try {
        const raw = await this.plugin.app.vault.cachedRead(this.file);
        // Widget may have been destroyed (scrolled out, file closed)
        // before the read resolved.
        if (this.mounted !== host || !host.isConnected) return;
        const model = deserializeBoard(raw);
        if (!model) throw new Error("invalid omniboard");
        loading.remove();
        const nodes = model.nodes?.length ?? 0;
        meta.setText(`${nodes} phần tử · ${model.edges?.length ?? 0} nối`);
        if (!nodes) {
          body.createDiv({
            cls: "da-embed-empty",
            text: "Board trống — bấm Mở để vẽ.",
          });
          return;
        }
        const wrap = body.createDiv({ cls: "da-embed-svg" });
        wrap.innerHTML = renderModelToSvg(model, "", 16, "transparent");
      } catch {
        if (this.mounted !== host) return;
        loading.remove();
        body.createDiv({
          cls: "da-embed-empty",
          text: "Không đọc được board.",
        });
      }
    })();

    return host;
  }

  destroy(_dom: HTMLElement): void {
    // Signal in-flight async reads to abort. Story 7-11 will mount a
    // Preact tree here and add `render(null, _dom)` for proper unmount.
    this.mounted = null;
  }

  // The widget is purely decorative — events on it shouldn't end up in
  // the editor's text manipulation pipeline (selection, drag, etc.).
  ignoreEvent(_event: Event): boolean {
    return true;
  }
}

/**
 * Build a DecorationSet by walking the CodeMirror syntax tree for
 * internal-embed wikilinks targeting `.omniboard` / `.omniboard.md`
 * files. Each match becomes a block-level `Decoration.replace` with
 * an `OmniboardEmbedWidget`.
 *
 * Why syntax tree and not regex: regex on raw text fails for escaped
 * brackets, links inside code fences, and is brittle across Obsidian
 * versions. Lezer's syntax tree handles all of this correctly.
 */
function buildDecorations(
  view: EditorView,
  plugin: DiagramsPlugin,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? "";

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        // Obsidian's tokenizer marks the inside of `![[…]]` with the
        // `hmd-internal-link` node type (and adjacent formatting nodes
        // for `![[` and `]]`). We only need the link target text.
        const typeName = node.type.name;
        if (!typeName.includes("hmd-internal-link")) return;

        // Skip plain `[[link]]` (not embedded) — we only want
        // image-style `![[link]]` embeds.
        const startOfLink = node.from - 3; // back over `![[`
        if (startOfLink < 0) return;
        if (doc.sliceString(startOfLink, node.from) !== "![[") return;

        const linkText = doc.sliceString(node.from, node.to).trim();
        if (!isOmniboardLink(linkText)) return;

        // Resolve target file via Obsidian's link resolver. Skip when
        // the file doesn't exist (fall back to default rendering).
        const file = plugin.app.metadataCache.getFirstLinkpathDest(
          linkText.replace(/#.*$/, ""),
          sourcePath,
        );
        if (!(file instanceof TFile)) return;

        // Replace the whole `![[link]]` token (otherwise CodeMirror
        // keeps showing the brackets next to the widget).
        const fullStart = startOfLink;
        const fullEnd = node.to + 2; // skip `]]`

        builder.add(
          fullStart,
          fullEnd,
          Decoration.replace({
            widget: new OmniboardEmbedWidget(file, plugin),
            block: true,
            inclusive: false,
          }),
        );
      },
    });
  }

  return builder.finish();
}

/**
 * Returns the CodeMirror 6 `Extension` array to pass to
 * `this.registerEditorExtension(...)` in `main.ts`. Built as a
 * `ViewPlugin` so it has access to `view.visibleRanges` for viewport-
 * aware scanning (avoids walking the entire doc on every keystroke).
 */
export function omniboardEmbedEditorExtension(
  plugin: DiagramsPlugin,
): Extension[] {
  const pluginExt = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, plugin);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.geometryChanged) {
          this.decorations = buildDecorations(u.view, plugin);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [pluginExt];
}
