import { h } from "preact";
import type { DiagramAdapter, Theme } from "../core/adapter";

interface DiagramCardProps {
  adapter: DiagramAdapter;
  source: string;
  theme: Theme;
  onEdit: () => void;
}

/**
 * Read-mode card shown for a diagram code block.
 * M0: shows adapter name + an Edit button (Renderer is a placeholder until M1+).
 */
export function DiagramCard({ adapter, source, theme, onEdit }: DiagramCardProps) {
  const model = adapter.parse(source);
  const Renderer = adapter.Renderer;

  return (
    <div class="diagrams-card" onClick={onEdit}>
      <div class="diagrams-card-header">
        <span class="diagrams-card-type">{adapter.displayName}</span>
        <button
          class="diagrams-card-edit"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          Edit
        </button>
      </div>
      <div class="diagrams-card-preview">
        <Renderer model={model} theme={theme} />
      </div>
    </div>
  );
}
