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
  zoom: (value?: number | "fit-viewport") => number | void;
};

export class BpmnNativeController {
  private modeler: InstanceType<typeof BpmnModeler> | null = null;
  private onChanged: ChangeCallback | null = null;

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

      // Fit to viewport
      this.zoom("fit-viewport");

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

  /** Destroy modeler, release DOM and listeners. */
  dispose(): void {
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
