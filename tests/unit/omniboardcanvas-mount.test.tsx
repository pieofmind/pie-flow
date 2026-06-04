// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, h } from "preact";
import type { CanvasModel, ShapeCategory } from "../../src/canvas/types";

/**
 * Story 7-3 — `<OmniboardCanvasMount>` lifecycle tests.
 *
 * `happy-dom` is enabled per-file via the directive at the top because this
 * test mounts a real Preact tree into a `document.body` element to verify
 * useEffect cleanup runs `canvas.destroy()`. Other unit tests in this repo
 * remain DOM-free; happy-dom is opt-in.
 *
 * We mock `OmniboardCanvas` to avoid pulling in the 4700-line X6 dependency
 * chain (which doesn't run cleanly in happy-dom anyway). The test exercises
 * the WRAPPER's lifecycle, not the canvas internals.
 */

// vi.mock() is hoisted to the top of the file — its factory cannot reference
// outer-scope variables. Use vi.hoisted() to declare the mock class and
// shared instance registry in a hoisted block, then expose them to tests.
const mockState = vi.hoisted(() => {
  // Inline the class shape; we re-declare its public surface here so the
  // hoisted factory has no external dependencies.
  class HoistedMockCanvas {
    root: HTMLElement;
    categories: unknown;
    onChange: () => void;
    destroyed = 0;
    loadedModels: unknown[] = [];
    currentModel: unknown = { nodes: [], edges: [] };

    constructor(root: HTMLElement, categories: unknown, onChange: () => void) {
      this.root = root;
      this.categories = categories;
      this.onChange = onChange;
      // Push to the shared registry (declared below) so tests can inspect.
      HoistedMockCanvas.instances.push(this);
    }

    loadModel(model: unknown): void {
      this.loadedModels.push(model);
      this.currentModel = model;
    }

    getModel(): unknown {
      return this.currentModel;
    }

    destroy(): void {
      this.destroyed += 1;
    }

    fireChange(next: unknown): void {
      this.currentModel = next;
      this.onChange();
    }

    static instances: HoistedMockCanvas[] = [];
  }
  return { MockCanvas: HoistedMockCanvas };
});

type MockCanvas = InstanceType<typeof mockState.MockCanvas>;
const canvasInstances = mockState.MockCanvas.instances as MockCanvas[];

vi.mock("../../src/canvas/OmniboardCanvas", () => ({
  OmniboardCanvas: mockState.MockCanvas,
}));

// Import AFTER the mock so the SUT picks up MockCanvas.
import { OmniboardCanvasMount } from "../../src/ui/OmniboardCanvasMount";

const CATS: ShapeCategory[] = [{ title: "demo", items: [] }];
const M1: CanvasModel = { nodes: [], edges: [] };
const M2: CanvasModel = { nodes: [{ id: "n1", shape: "x", x: 0, y: 0, width: 10, height: 10, label: "" }], edges: [] };

/**
 * Preact schedules useEffect callbacks asynchronously (via the options
 * hook + microtask queue). Flushing once is not enough — we need both
 * a microtask tick AND a macrotask tick to let the scheduler drain
 * pending effects in happy-dom.
 */
async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function mount(
  props: Parameters<typeof OmniboardCanvasMount>[0],
): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(h(OmniboardCanvasMount, props), host);
  await flushEffects();
  // Preact in happy-dom defers useEffect callbacks until the NEXT commit.
  // Trigger an idempotent re-render so the first effect runs before assertions.
  // (Same component + same props = same VNode key path, no re-mount, no
  // new canvas instance.)
  render(h(OmniboardCanvasMount, props), host);
  await flushEffects();
  return host;
}

async function unmount(host: HTMLDivElement): Promise<void> {
  render(null, host);
  await flushEffects();
  host.remove();
}

beforeEach(() => {
  canvasInstances.length = 0;
  document.body.innerHTML = "";
});

describe("OmniboardCanvasMount — AC1 / AC4 mount lifecycle", () => {
  it("creates exactly one OmniboardCanvas on mount and loads the initial model", async () => {
    const host = await mount({ categories: CATS, initialModel: M1 });
    expect(canvasInstances.length).toBe(1);
    expect(canvasInstances[0].loadedModels.length).toBe(1);
    expect(canvasInstances[0].loadedModels[0]).toBe(M1);
    await unmount(host);
  });

  it("invokes onCanvasReady with the canvas instance after mount", async () => {
    let received: MockCanvas | null = null;
    const host = await mount({
      categories: CATS,
      initialModel: M1,
      onCanvasReady: (c) => {
        received = c as unknown as MockCanvas;
      },
    });
    expect(received).not.toBeNull();
    expect(received).toBe(canvasInstances[0]);
    await unmount(host);
  });
});

describe("OmniboardCanvasMount — AC4 cleanup (P1)", () => {
  it("calls destroy() exactly once when the tree unmounts", async () => {
    const host = await mount({ categories: CATS, initialModel: M1 });
    const instance = canvasInstances[0];
    expect(instance.destroyed).toBe(0);
    await unmount(host);
    expect(instance.destroyed).toBe(1);
  });

  it("does not leak the canvas instance after unmount (ref cleared)", async () => {
    const host = await mount({ categories: CATS, initialModel: M1 });
    const instance = canvasInstances[0];
    await unmount(host);
    const host2 = await mount({ categories: CATS, initialModel: M1 });
    expect(canvasInstances.length).toBe(2);
    expect(canvasInstances[1]).not.toBe(instance);
    await unmount(host2);
  });
});

describe("OmniboardCanvasMount — AC1 onChange dispatch", () => {
  it("forwards canvas change events to props.onChange with the latest model", async () => {
    const onChange = vi.fn<(m: CanvasModel) => void>();
    const host = await mount({ categories: CATS, initialModel: M1, onChange });
    const instance = canvasInstances[0];
    instance.fireChange(M2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(M2);
    await unmount(host);
  });

  it("uses the LATEST onChange even after re-render (no stale closure)", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);

    render(
      h(OmniboardCanvasMount, {
        categories: CATS,
        initialModel: M1,
        onChange: first,
      }),
      host,
    );
    await flushEffects();
    // Re-render with a new onChange identity — wrapper should adopt it.
    render(
      h(OmniboardCanvasMount, {
        categories: CATS,
        initialModel: M1,
        onChange: second,
      }),
      host,
    );
    await flushEffects();

    const instance = canvasInstances[0];
    instance.fireChange(M2);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    // Also pin the model arg so a future refactor that captures stale model
    // via getModel() cannot regress silently (Blind Hunter MEDIUM).
    expect(second.mock.calls[0][0]).toBe(M2);

    render(null, host);
    await flushEffects();
    host.remove();
  });
});

describe("OmniboardCanvasMount — AC1 model updates without re-mount", () => {
  it("pushes a new initialModel via loadModel without creating a new canvas", async () => {
    const host = await mount({ categories: CATS, initialModel: M1 });
    expect(canvasInstances.length).toBe(1);
    const instance = canvasInstances[0];
    // Mount loadModel + first model-effect skip → exactly 1 call
    expect(instance.loadedModels.length).toBe(1);

    // Re-render with a new model. Double-render + flush to ensure the
    // model-update effect drains (same scheduling quirk as initial mount
    // — happy-dom defers Preact effects until the next commit).
    render(
      h(OmniboardCanvasMount, { categories: CATS, initialModel: M2 }),
      host,
    );
    await flushEffects();
    render(
      h(OmniboardCanvasMount, { categories: CATS, initialModel: M2 }),
      host,
    );
    await flushEffects();

    // Same canvas instance — no new one created.
    expect(canvasInstances.length).toBe(1);
    // loadModel called again with the new model.
    expect(instance.loadedModels.length).toBe(2);
    expect(instance.loadedModels[1]).toBe(M2);

    await unmount(host);
  });
});
