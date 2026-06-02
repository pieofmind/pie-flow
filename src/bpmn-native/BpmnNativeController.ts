/**
 * BpmnNativeController — thin wrapper around bpmn-js Modeler.
 *
 * Owns the modeler lifecycle: mount → importXML → saveXML → destroy.
 * View-local: one controller per BpmnNativeView instance, NO module-level state.
 */

import BpmnModeler from "bpmn-js/lib/Modeler";

export const MINIMAL_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
             id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <process id="Process_1" isExecutable="false">
    <startEvent id="Start_1" name="Start"/>
    <task id="Task_1" name="Do Something"/>
    <endEvent id="End_1" name="End"/>
    <sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1"/>
    <sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1"/>
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="180" y="160" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="280" y="138" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="450" y="160" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="216" y="178"/>
        <di:waypoint x="280" y="178"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="380" y="178"/>
        <di:waypoint x="450" y="178"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;

export type ChangeCallback = () => void;

type BpmnCanvas = {
  zoom: (value?: number | "fit-viewport", center?: { x: number; y: number } | "auto") => number | void;
  scroll: (delta: { dx: number; dy: number }) => void;
  viewbox: () => { x: number; y: number; width: number; height: number; scale: number };
  resized?: () => void;
};

export class BpmnNativeController {
  private modeler: InstanceType<typeof BpmnModeler> | null = null;
  private onChanged: ChangeCallback | null = null;
  /** Watches the container size — bpmn-js does NOT auto-detect resize. On
   *  mobile (rotate / keyboard show-hide / leaf split) the canvas would
   *  otherwise keep its old viewBox and look pinned to the top-left. */
  private resizeObserver: ResizeObserver | null = null;

  /**
   * Mount the modeler into a DOM container and import initial XML.
   * @param container — the DOM element to render into
   * @param xml — BPMN XML string (uses minimal template if empty)
   * @param onChanged — called on every commandStack change (caller should debounce)
   */
  async mount(
    container: HTMLElement,
    xml: string,
    onChanged?: ChangeCallback,
  ): Promise<{ warnings: string[] }> {
    this.dispose();
    this.onChanged = onChanged ?? null;
    this.modeler = new BpmnModeler({ container });

    const bpmnXml = xml.trim() || MINIMAL_BPMN_XML;

    try {
      const result = await this.modeler.importXML(bpmnXml);
      const warnings: string[] = result?.warnings ?? [];

      // Listen for edits
      if (this.onChanged) {
        this.modeler.on("commandStack.changed", this.onChanged);
      }

      // Listen for selection changes
      this.modeler.on("selection.changed", () => {
        window.dispatchEvent(new CustomEvent("bpmn-native-selection-change"));
      });

      // Mobile UX C3 fix: defer fit-viewport until the container has a
      // non-zero size. setViewData → mountModeler can race the WebView's
      // first layout pass on iOS, leaving `clientHeight=0` at this point;
      // calling fit-viewport against a zero bbox produces a fallback scale
      // anchored top-left (the "diagram dán cứng top" symptom).
      this.scheduleInitialFit(container);
      this.installResizeObserver(container);

      return { warnings };
    } catch (err: unknown) {
      // Cleanup on import failure
      this.dispose();
      throw err;
    }
  }

  /** Export current diagram as formatted BPMN XML. */
  async saveXml(): Promise<string> {
    if (!this.modeler) throw new Error("BpmnNativeController: modeler not mounted");
    const result = await this.modeler.saveXML({ format: true });
    return result?.xml ?? "";
  }

  /** Export current diagram as SVG string. */
  async saveSvg(): Promise<string> {
    if (!this.modeler) throw new Error("BpmnNativeController: modeler not mounted");
    const result = await this.modeler.saveSVG();
    return result?.svg ?? "";
  }

  /** Zoom the BPMN canvas without exposing the internal modeler instance. */
  zoom(value: number | "fit-viewport"): void {
    if (!this.modeler) return;
    const canvas = this.modeler.get("canvas") as BpmnCanvas;
    if (canvas && typeof canvas.zoom === "function") {
      canvas.zoom(value);
    }
  }

  /** Read current zoom level. */
  getZoom(): number {
    if (!this.modeler) return 1;
    const canvas = this.modeler.get("canvas") as BpmnCanvas;
    if (!canvas || typeof canvas.zoom !== "function") return 1;
    const current = canvas.zoom();
    return typeof current === "number" ? current : 1;
  }

  /**
   * Pan the canvas by a CSS-pixel delta (positive = pan toward bottom-right).
   * Mobile pan handler in BpmnNativeView wires this up.
   */
  panBy(dx: number, dy: number): void {
    if (!this.modeler) return;
    const canvas = this.modeler.get("canvas") as BpmnCanvas;
    if (canvas && typeof canvas.scroll === "function") {
      canvas.scroll({ dx, dy });
    }
  }

  /**
   * Zoom around a CSS-pixel client point (relative to the modeler container).
   * diagram-js's `canvas.zoom(level, center)` expects `center` in CSS-pixel
   * client space.
   */
  zoomAt(level: number, clientX: number, clientY: number): void {
    if (!this.modeler) return;
    const canvas = this.modeler.get("canvas") as BpmnCanvas;
    if (!canvas || typeof canvas.zoom !== "function") return;
    canvas.zoom(level, { x: clientX, y: clientY });
  }

  /**
   * Convert a CSS-pixel client point (relative to the canvas container) to
   * the diagram's local/canvas coordinate space. Used by the pinch-zoom
   * handler to lock a canvas point at gesture start and re-anchor it each
   * move (OmniboardCanvas / X6 pattern: more robust than passing a moving
   * center to `canvas.zoom()` because the center re-anchor only re-scales,
   * it does NOT re-translate when the midpoint moves during pinch).
   */
  clientToLocal(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.modeler) return { x: 0, y: 0 };
    const canvas = this.modeler.get("canvas") as BpmnCanvas;
    if (!canvas || typeof canvas.viewbox !== "function") return { x: 0, y: 0 };
    const vb = canvas.viewbox();
    return {
      x: vb.x + clientX / vb.scale,
      y: vb.y + clientY / vb.scale,
    };
  }

  /** Inverse of {@link clientToLocal}. */
  localToClient(x: number, y: number): { x: number; y: number } {
    if (!this.modeler) return { x: 0, y: 0 };
    const canvas = this.modeler.get("canvas") as BpmnCanvas;
    if (!canvas || typeof canvas.viewbox !== "function") return { x: 0, y: 0 };
    const vb = canvas.viewbox();
    return {
      x: (x - vb.x) * vb.scale,
      y: (y - vb.y) * vb.scale,
    };
  }

  /**
   * Activate the hand-tool (1-finger pan via bpmn-js itself). Our custom
   * touch gestures already pan the canvas, so this is mostly cosmetic on
   * mobile — but the bpmn-js hand cursor signals "you can drag" to users.
   */
  activateHand(event?: MouseEvent): void {
    if (!this.modeler) return;
    try {
      const handTool = this.modeler.get("handTool") as { activateHand?: (e?: MouseEvent) => void };
      handTool?.activateHand?.(event);
    } catch (err) {
      console.warn("[BpmnNative] activateHand failed", err);
    }
  }

  /** Start a global-connect drag from the given event. */
  activateConnect(event: MouseEvent): void {
    if (!this.modeler) return;
    try {
      const globalConnect = this.modeler.get("globalConnect") as { start?: (e: MouseEvent) => void };
      globalConnect?.start?.(event);
    } catch (err) {
      console.warn("[BpmnNative] activateConnect failed", err);
    }
  }

  /** Start creating a BPMN shape from a pointer event. */
  startCreateShape(event: MouseEvent, type: string, attrs?: Record<string, unknown>): void {
    if (!this.modeler) return;
    try {
      const create = this.modeler.get("create") as { start: (event: MouseEvent, shape: unknown) => void };
      const elementFactory = this.modeler.get("elementFactory") as {
        createShape: (attrs: Record<string, unknown>) => unknown;
      };
      create.start(event, elementFactory.createShape({ type, ...attrs }));
    } catch (err) {
      console.error("[BpmnNative] Create shape failed:", err);
    }
  }

  /** Get the currently selected element on the canvas. */
  getSelectedElement(): any {
    if (!this.modeler) return null;
    try {
      const selection = this.modeler.get("selection") as any;
      const selected = selection.get();
      return selected.length === 1 ? selected[0] : null;
    } catch {
      return null;
    }
  }

  /** Update properties of a BPMN element. */
  updateProperties(element: any, properties: any): void {
    if (!this.modeler) return;
    try {
      const modeling = this.modeler.get("modeling") as any;
      modeling.updateProperties(element, properties);
    } catch (err) {
      console.error("[BpmnNative] Update properties failed:", err);
    }
  }

  /** Check whether an element ID already exists in the current diagram. */
  hasElementId(id: string, exceptElement?: any): boolean {
    if (!this.modeler) return false;
    try {
      const registry = this.modeler.get("elementRegistry") as { get: (id: string) => any };
      const found = registry.get(id);
      return Boolean(found && found !== exceptElement);
    } catch {
      return false;
    }
  }

  /** Replace a BPMN element with a new type. */
  replaceElement(element: any, newType: string): any {
    if (!this.modeler) return null;
    try {
      const bpmnReplace = this.modeler.get("bpmnReplace") as any;
      return bpmnReplace.replaceElement(element, { type: newType });
    } catch (err) {
      console.error("[BpmnNative] Replace element failed:", err);
      return null;
    }
  }

  /** Update the documentation property of an element. */
  updateDocumentation(element: any, docText: string): void {
    if (!this.modeler) return;
    try {
      const modeling = this.modeler.get("modeling") as any;
      const bpmnFactory = this.modeler.get("bpmnFactory") as any;
      const newDocumentation = bpmnFactory.create("bpmn:Documentation", { text: docText });
      modeling.updateProperties(element, {
        documentation: [newDocumentation],
      });
    } catch (err) {
      console.error("[BpmnNative] Update documentation failed:", err);
    }
  }

  /** Update the condition expression on a sequence flow. */
  updateConditionExpression(element: any, conditionText: string): void {
    if (!this.modeler) return;
    try {
      const modeling = this.modeler.get("modeling") as any;
      const bpmnFactory = this.modeler.get("bpmnFactory") as any;
      if (conditionText.trim() === "") {
        modeling.updateProperties(element, { conditionExpression: undefined });
      } else {
        const formalExpression = bpmnFactory.create("bpmn:FormalExpression", {
          body: conditionText,
        });
        modeling.updateProperties(element, { conditionExpression: formalExpression });
      }
    } catch (err) {
      console.error("[BpmnNative] Update condition expression failed:", err);
    }
  }

  /** Update event definitions for events (Start/End/Intermediate/Boundary). */
  updateEventDefinition(element: any, eventType: string): void {
    if (!this.modeler) return;
    try {
      const modeling = this.modeler.get("modeling") as any;
      const bpmnFactory = this.modeler.get("bpmnFactory") as any;
      
      if (eventType === "") {
        modeling.updateProperties(element, { eventDefinitions: [] });
      } else {
        const definition = bpmnFactory.create(eventType);
        modeling.updateProperties(element, { eventDefinitions: [definition] });
      }
    } catch (err) {
      console.error("[BpmnNative] Update event definition failed:", err);
    }
  }

  /** Update loop characteristics (loop, parallel/sequential MI). */
  updateLoopCharacteristics(element: any, loopType: string): void {
    if (!this.modeler) return;
    try {
      const modeling = this.modeler.get("modeling") as any;
      const bpmnFactory = this.modeler.get("bpmnFactory") as any;
      
      if (loopType === "") {
        modeling.updateProperties(element, { loopCharacteristics: undefined });
      } else if (loopType === "standard") {
        const loop = bpmnFactory.create("bpmn:StandardLoopCharacteristics");
        modeling.updateProperties(element, { loopCharacteristics: loop });
      } else if (loopType === "parallel") {
        const loop = bpmnFactory.create("bpmn:MultiInstanceLoopCharacteristics", { isSequential: false });
        modeling.updateProperties(element, { loopCharacteristics: loop });
      } else if (loopType === "sequential") {
        const loop = bpmnFactory.create("bpmn:MultiInstanceLoopCharacteristics", { isSequential: true });
        modeling.updateProperties(element, { loopCharacteristics: loop });
      }
    } catch (err) {
      console.error("[BpmnNative] Update loop characteristics failed:", err);
    }
  }

  /**
   * Wait until the container has measurable size, then call fit-viewport.
   * If the container is already sized, defer one rAF so layout flushes
   * before we measure. If not yet sized, fall through to the ResizeObserver
   * which will fit on first non-zero entry.
   */
  private scheduleInitialFit(container: HTMLElement): void {
    const tryFit = (): boolean => {
      if (!this.modeler) return true;
      try {
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        this.zoom("fit-viewport");
        return true;
      } catch (err) {
        // jsdom mocks or torn-down containers reach here; not fatal.
        console.warn("[BpmnNative] Initial fit-viewport skipped", err);
        return true;
      }
    };
    // Tests run in jsdom without requestAnimationFrame — fall back to a
    // microtask so the unit suite still exercises this path.
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
    // First attempt after one frame so layout is up to date.
    raf(() => {
      if (!tryFit()) {
        // Second attempt next frame for slow WebViews (e.g. Obsidian mobile
        // leaf transitions).
        raf(() => { tryFit(); });
      }
    });
  }

  /**
   * Watch the container for resize and tell bpmn-js to re-measure. Covers
   * orientation change, keyboard show/hide, leaf split, and the initial
   * 0-size → first-paint transition on mobile.
   */
  private installResizeObserver(container: HTMLElement): void {
    if (typeof ResizeObserver === "undefined") return;
    if (!container || typeof (container as HTMLElement).getBoundingClientRect !== "function") return;
    let firstFitDone = false;
    this.resizeObserver = new ResizeObserver((entries) => {
      if (!this.modeler) return;
      const entry = entries[0];
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      try {
        const canvas = this.modeler.get("canvas") as { resized?: () => void };
        canvas.resized?.();
        // Auto-fit only on the first time the container becomes sized — after
        // that the user's manual zoom should not be clobbered by every resize.
        if (!firstFitDone) {
          this.zoom("fit-viewport");
          firstFitDone = true;
        }
      } catch (err) {
        console.warn("[BpmnNative] ResizeObserver re-fit failed", err);
      }
    });
    this.resizeObserver.observe(container);
  }

  /** Destroy modeler, release DOM and listeners. */
  dispose(): void {
    if (this.resizeObserver) {
      try { this.resizeObserver.disconnect(); } catch { /* ignore */ }
      this.resizeObserver = null;
    }
    if (this.modeler) {
      try {
        this.modeler.destroy();
      } catch {
        // Swallow destroy errors during cleanup
      }
      this.modeler = null;
    }
    this.onChanged = null;
  }

  /** Check if modeler is currently mounted. */
  get isMounted(): boolean {
    return this.modeler !== null;
  }
}
