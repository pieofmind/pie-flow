import { useEffect, useRef } from "preact/hooks";
import { type VNode } from "preact";
import { OmniboardCanvas } from "../canvas/OmniboardCanvas";
import type { CanvasModel, ShapeCategory } from "../canvas/types";
import { registerAllShapes } from "../canvas/shapes/index";

// Register X6 custom shapes (fc-*, bpmn-*, etc.) exactly once at module load.
// This is the canonical home: any host that mounts OmniboardCanvas via this
// component (BoardView tab, EditModal canvas branch) gets shapes registered
// regardless of adapter import order. registerAllShapes() is idempotent.
registerAllShapes();

/**
 * Props for `<OmniboardCanvasMount>`.
 *
 * This is the Preact ⇄ X6 boundary: the imperative OmniboardCanvas class
 * lives on the X6 side, this component owns its lifecycle declaratively.
 */
export interface OmniboardCanvasMountProps {
  /**
   * Shape catalog driving the X6 palette + spawning behavior. Captured
   * ONCE at mount — subsequent changes are ignored (see JSDoc on the
   * component). To swap adapters at runtime, the caller must remount via
   * a different React/Preact `key`.
   */
  categories: ReadonlyArray<ShapeCategory>;
  /**
   * Model to load on initial mount. Subsequent changes (by reference)
   * are pushed via `canvas.loadModel()` WITHOUT re-creating the canvas
   * instance.
   *
   * Caller is responsible for model identity stability — passing a freshly
   * constructed object on every render will trigger a full reload each
   * render (defeating undo/redo). Memoize or hold the reference in a ref.
   */
  initialModel: CanvasModel;
  /**
   * Fired whenever the canvas emits a change. Latest callback identity
   * wins (no stale closure) — implementation uses a "latest ref" pattern.
   */
  onChange?: (model: CanvasModel) => void;
  /**
   * Escape hatch returning the underlying OmniboardCanvas instance once
   * mount is complete. Latest callback identity wins (parents that
   * lazy-provide this prop will still receive the canvas).
   *
   * **CAUTION:** holding the returned reference past unmount keeps the
   * full X6 graph in memory. Clear the reference in the same cleanup
   * effect that re-renders without `onCanvasReady`.
   */
  onCanvasReady?: (canvas: OmniboardCanvas) => void;
}

/**
 * Bridges the imperative `OmniboardCanvas` class into Preact's declarative
 * tree.
 *
 * **Lifecycle contract:**
 * - On mount: instantiates `OmniboardCanvas` into a ref'd host div, loads
 *   the initial model, fires `onCanvasReady`.
 * - On unmount: calls `canvas.destroy()` once. The wrapper guards against
 *   double-destroy (e.g. Preact StrictMode-equivalent dev double-invoke)
 *   via an internal `destroyed` flag — `OmniboardCanvas.destroy()` is NOT
 *   intrinsically idempotent, so we defend at this layer.
 * - On `initialModel` reference change: pushes via `loadModel()` (no
 *   re-mount). Uses a `prevModelRef` to compare identity rather than a
 *   first-render skip flag (more robust against effect-ordering races).
 * - On `categories` change: ignored at runtime. A `console.warn` fires in
 *   development to surface accidental swaps; production builds remount-by-
 *   key are the supported migration path.
 * - On `onChange` / `onCanvasReady` change: handled via "latest ref"
 *   pattern; the long-lived canvas instance always dispatches to the
 *   freshest callback identity.
 */
export function OmniboardCanvasMount(props: OmniboardCanvasMountProps): VNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<OmniboardCanvas | null>(null);
  const destroyedRef = useRef(false);

  // Latest-ref pattern for both callbacks. Updated post-commit so the
  // long-lived canvas instance dispatches to the freshest closure without
  // re-mounting on identity churn. (Refs are mutated inside `useEffect`
  // rather than during render to avoid the React/Preact "don't write
  // refs during render" footgun.)
  const latestOnChangeRef = useRef(props.onChange);
  const latestOnCanvasReadyRef = useRef(props.onCanvasReady);
  useEffect(() => {
    latestOnChangeRef.current = props.onChange;
    latestOnCanvasReadyRef.current = props.onCanvasReady;
  });

  // Track categories identity for the dev-warning effect below. We do NOT
  // re-init the canvas on categories change — that would destroy user
  // state. Callers wanting an adapter swap must remount via a different key.
  const capturedCategoriesRef = useRef<ReadonlyArray<ShapeCategory> | null>(
    null,
  );

  // Mount-once effect. Empty deps array — wrapper is intentionally insensitive
  // to prop identity churn on `categories`, `onChange`, `onCanvasReady`.
  useEffect(() => {
    if (!hostRef.current) return;
    capturedCategoriesRef.current = props.categories;
    const canvas = new OmniboardCanvas(
      hostRef.current,
      // Spread to a mutable copy — OmniboardCanvas expects a mutable array
      // internally. We accept ReadonlyArray at the prop boundary for type
      // safety; the conversion is intentional and contained here.
      [...props.categories],
      () => {
        const next = canvas.getModel();
        // Read into a local before dispatch to avoid a torn read if the
        // ref is reassigned mid-call (defense in depth).
        const fn = latestOnChangeRef.current;
        fn?.(next);
      },
    );
    canvasRef.current = canvas;
    destroyedRef.current = false;
    canvas.loadModel(props.initialModel);
    // Initialize the prev-model marker so the model-update effect below
    // skips the redundant initial loadModel call.
    prevModelRef.current = props.initialModel;
    latestOnCanvasReadyRef.current?.(canvas);

    return () => {
      if (destroyedRef.current) return; // idempotency guard
      destroyedRef.current = true;
      canvas.destroy();
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push model updates without re-mounting. Compare identity to the
  // previously-loaded model — this is more robust than a "first-render
  // skip" flag, which can flip prematurely under unusual effect-ordering
  // (e.g. rapid prop changes before the mount effect drains).
  const prevModelRef = useRef<CanvasModel | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return; // not yet mounted
    if (prevModelRef.current === props.initialModel) return; // already loaded
    prevModelRef.current = props.initialModel;
    canvasRef.current.loadModel(props.initialModel);
  }, [props.initialModel]);

  // Dev-only warning if a caller swaps categories at runtime. Silent
  // ignore would be a confusing bug; remount-by-key is the supported path.
  useEffect(() => {
    if (
      capturedCategoriesRef.current !== null &&
      capturedCategoriesRef.current !== props.categories
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        "OmniboardCanvasMount: `categories` prop changed after mount, but " +
          "categories are captured ONCE for performance. To swap adapters, " +
          "remount the component via a different React/Preact `key` prop.",
      );
    }
  }, [props.categories]);

  return (
    <div
      ref={hostRef}
      class="diagrams-canvas-mount"
      data-testid="diagrams-canvas-mount"
    />
  );
}

export default OmniboardCanvasMount;
