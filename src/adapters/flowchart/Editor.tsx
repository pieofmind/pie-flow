import { h } from "preact";
import { useRef, useEffect } from "preact/hooks";
import type { EditorProps } from "../../core/adapter";
import type { CanvasModel } from "../../canvas/LarkCanvas";
import { LarkCanvas } from "../../canvas/LarkCanvas";
import { registerAllShapes, SHAPE_CATEGORIES } from "../../canvas/shapes/index";

registerAllShapes();

export function FlowchartEditor({ initialModel, onSave, onClose }: EditorProps<CanvasModel>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<LarkCanvas | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const canvas = new LarkCanvas(hostRef.current, SHAPE_CATEGORIES, () => { dirtyRef.current = true; });
    canvasRef.current = canvas;
    canvas.loadModel(initialModel);
    return () => { canvas.destroy(); canvasRef.current = null; };
  }, []);

  const save = (close: boolean) => {
    if (canvasRef.current) onSave(canvasRef.current.getModel());
    if (close) onClose();
  };

  return (
    <div class="diagrams-editor-shell">
      <div class="diagrams-editor-toolbar">
        <button class="diagrams-btn" onClick={() => { save(false); onClose(); }}>← Close</button>
        <span class="diagrams-editor-title">Flowchart</span>
        <button class="diagrams-btn diagrams-btn-primary" onClick={() => save(true)}>Save</button>
      </div>
      <div ref={hostRef} class="diagrams-canvas-host" />
    </div>
  );
}
