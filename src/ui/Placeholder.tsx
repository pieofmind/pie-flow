import { h } from "preact";
import { useState } from "preact/hooks";
import type { RendererProps, EditorProps } from "../core/adapter";

/**
 * M0 placeholders. The model is the raw code-block text (string) until each
 * adapter ships its real parse/serialize + WYSIWYG editor in M1+.
 */

export function PlaceholderRenderer({ model }: RendererProps<string>) {
  return (
    <pre class="diagrams-placeholder-render">
      {model.trim() || "(empty diagram)"}
    </pre>
  );
}

export function PlaceholderEditor({ initialModel, onSave, onClose }: EditorProps<string>) {
  const [text, setText] = useState(initialModel);

  return (
    <div class="diagrams-editor-shell">
      <div class="diagrams-editor-toolbar">
        <button class="diagrams-btn" onClick={onClose}>← Close</button>
        <span class="diagrams-editor-title">Source editor (M0 placeholder)</span>
        <button
          class="diagrams-btn diagrams-btn-primary"
          onClick={() => { onSave(text); onClose(); }}
        >
          Save
        </button>
      </div>
      <textarea
        class="diagrams-editor-source"
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        spellcheck={false}
      />
    </div>
  );
}
