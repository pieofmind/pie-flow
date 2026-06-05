import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { RendererProps } from "../../core/adapter";
import type { CanvasModel } from "../../canvas/types";
import { CanvasPreview } from "../_shared/CanvasPreview";
import { importBpmn } from "../../io/bpmn/import";
import { hasDegenerateLayout, layoutWithDagre } from "../_shared/layout";

interface AsyncState {
  status: "loading" | "ready" | "error";
  model?: CanvasModel;
  error?: string;
}

/**
 * BPMN Renderer — read-only inline preview.
 *
 * Adapter contract is sync (TModel = raw XML string). The expensive
 * `importBpmn` parse runs inside `useEffect` and the component shows a
 * loading placeholder until the CanvasModel is ready, then mounts
 * `<OmniboardCanvasMount>` in a `pointer-events: none` wrapper so the
 * preview does not accept input.
 */
export function BpmnRenderer({ model }: RendererProps<string>) {
  const [state, setState] = useState<AsyncState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    // Only show the loading placeholder when no model is available yet.
    // On re-imports (model prop changed), keep the existing canvas mounted
    // so OmniboardCanvasMount can update via loadModel() instead of destroy+recreate.
    setState((prev) => (prev.model ? prev : { status: "loading" }));
    importBpmn(model)
      .then((result) => {
        if (cancelled) return;
        // BPMN XML without BPMNDI lays every node at the same point — fall
        // back to dagre so the preview isn't a single stacked node.
        if (hasDegenerateLayout(result.model)) layoutWithDagre(result.model, "LR");
        setState({ status: "ready", model: result.model });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [model]);

  if (state.status === "loading") {
    return (
      <div class="diagrams-placeholder-render" data-testid="bpmn-renderer-loading">
        Đang phân tích BPMN…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div class="diagrams-placeholder-render diagrams-error" data-testid="bpmn-renderer-error">
        Lỗi khi đọc BPMN: {state.error}
      </div>
    );
  }
  return <CanvasPreview model={state.model!} />;
}
