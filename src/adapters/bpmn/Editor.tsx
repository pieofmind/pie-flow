import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { EditorProps } from "../../core/adapter";
import type { CanvasModel } from "../../canvas/types";
import { OmniboardCanvasMount } from "../../ui/OmniboardCanvasMount";
import { importBpmn } from "../../io/bpmn/import";
import { exportBpmn } from "../../io/bpmn/export";
import type { SourceMeta } from "../../io/types";

interface AsyncState {
  status: "loading" | "ready" | "error";
  initial?: CanvasModel;
  meta?: SourceMeta;
  error?: string;
}

/**
 * BPMN Editor — mounts `<OmniboardCanvasMount>` mutable, async parses
 * the raw XML on mount, and serializes back to XML on save via
 * `exportBpmn`. Disables the Save button while async work is in flight.
 */
export function BpmnEditor({ initialModel, onSave, onClose }: EditorProps<string>) {
  const [state, setState] = useState<AsyncState>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const currentModelRef = useRef<CanvasModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    importBpmn(initialModel)
      .then((result) => {
        if (cancelled) return;
        currentModelRef.current = result.model;
        setState({ status: "ready", initial: result.model, meta: result.sourceMeta });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [initialModel]);

  const onCanvasChange = (m: CanvasModel): void => {
    currentModelRef.current = m;
  };

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    const m = currentModelRef.current;
    if (!m) return;
    setSaving(true);
    try {
      const xml = await exportBpmn(m, state.meta ?? null);
      onSave(xml);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "error", error: `Lỗi khi xuất BPMN: ${message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="diagrams-editor-shell bpmn-adapter-editor">
      <div class="diagrams-editor-toolbar">
        <button class="diagrams-btn" onClick={onClose}>← Đóng</button>
        <span class="diagrams-editor-title">BPMN 2.0 — chỉnh sửa</span>
        <button
          class="diagrams-btn diagrams-btn-primary"
          disabled={state.status !== "ready" || saving}
          onClick={() => {
            void handleSave();
          }}
        >
          {saving ? "Đang lưu…" : "Lưu & đóng"}
        </button>
      </div>
      {state.status === "loading" && (
        <div class="diagrams-placeholder-render" data-testid="bpmn-editor-loading">
          Đang phân tích BPMN…
        </div>
      )}
      {state.status === "error" && (
        <div class="diagrams-placeholder-render diagrams-error" data-testid="bpmn-editor-error">
          {state.error}
        </div>
      )}
      {state.status === "ready" && (
        <div class="bpmn-adapter-editor-canvas" data-testid="bpmn-editor-ready">
          <OmniboardCanvasMount
            categories={[]}
            initialModel={state.initial!}
            onChange={onCanvasChange}
          />
        </div>
      )}
    </div>
  );
}
