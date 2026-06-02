import { ItemView, WorkspaceLeaf } from "obsidian";
import { BPMN_NATIVE_VIEW_TYPE, BpmnNativeView } from "./BpmnNativeView";

export const BPMN_PROPERTIES_VIEW_TYPE = "bpmn-properties";
const SELECTION_EVENT = "bpmn-native-selection-change";
const BPMN_ID_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class BpmnPropertiesView extends ItemView {
  private readonly onSelection = () => this.render();

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return BPMN_PROPERTIES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "BPMN Properties";
  }

  getIcon(): string {
    return "sliders-horizontal";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("bpmn-properties-view");
    window.addEventListener(SELECTION_EVENT, this.onSelection);
    this.render();
  }

  async onClose(): Promise<void> {
    window.removeEventListener(SELECTION_EVENT, this.onSelection);
  }

  private activeView(): BpmnNativeView | null {
    const active = this.app.workspace.activeLeaf?.view;
    if (active?.getViewType?.() === BPMN_NATIVE_VIEW_TYPE) {
      return active as BpmnNativeView;
    }
    return null;
  }

  private render(): void {
    this.contentEl.empty();
    const view = this.activeView();
    if (!view) {
      this.contentEl.createDiv({
        cls: "obp-empty",
        text: "Mở một file BPMN Native để chỉnh sửa properties.",
      });
      return;
    }

    const controller = view.getController();
    const element = controller.getSelectedElement();

    if (!element || !element.businessObject) {
      this.contentEl.createDiv({
        cls: "obp-empty",
        text: "Chọn một element trên diagram để chỉnh sửa properties (Name, ID, Type, Documentation).",
      });
      return;
    }

    this.renderElement(controller, element);
  }

  private renderElement(controller: any, element: any): void {
    const bo = element.businessObject;
    const typeStr = bo.$type ? bo.$type.replace("bpmn:", "") : "Element";

    const title = this.contentEl.createDiv({ cls: "obp-title" });
    title.createSpan({ cls: "obp-kind", text: typeStr });
    title.createEl("strong", { text: bo.name || bo.id });

    const section = (name: string) => {
      const s = this.contentEl.createDiv({ cls: "lk-psec" });
      s.createDiv({ cls: "lk-psec-h", text: name });
      return s;
    };

    const field = (parent: HTMLElement, label: string, control: HTMLElement) => {
      const wrap = parent.createDiv({ cls: "lk-pfield" });
      wrap.createEl("label", { text: label });
      wrap.appendChild(control);
    };

    const textInput = (value: string, placeholder: string, onInput: (value: string) => void) => {
      const input = el("input", "lk-pinput") as HTMLInputElement;
      input.value = value || "";
      input.placeholder = placeholder;
      input.oninput = () => onInput(input.value);
      return input;
    };

    // ── Group 1: General Properties ──
    const general = section("General");

    // ID property
    field(
      general,
      "ID",
      textInput(bo.id, "ID", (val) => {
        const nextId = val.trim();
        if (!nextId || nextId === bo.id) return;
        if (!BPMN_ID_RE.test(nextId)) {
          return;
        }
        if (!controller.hasElementId(nextId, element)) {
          controller.updateProperties(element, { id: nextId });
        }
      })
    );

    // Name / Label property
    field(
      general,
      "Name",
      textInput(bo.name, "Name", (val) => {
        controller.updateProperties(element, { name: val });
      })
    );

    // ── Group 2: Element Types & Markers ──
    // Task Type & Loop Characteristics
    const isTask = bo.$type && (
      bo.$type === "bpmn:Task" ||
      bo.$type === "bpmn:UserTask" ||
      bo.$type === "bpmn:ServiceTask" ||
      bo.$type === "bpmn:ScriptTask" ||
      bo.$type === "bpmn:SendTask" ||
      bo.$type === "bpmn:ReceiveTask" ||
      bo.$type === "bpmn:ManualTask" ||
      bo.$type === "bpmn:BusinessRuleTask"
    );

    if (isTask) {
      const taskSec = section("Task Options");
      const typeSelect = el("select", "lk-pinput") as HTMLSelectElement;

      const types = [
        { val: "bpmn:Task", name: "None (Generic Task)" },
        { val: "bpmn:UserTask", name: "User Task" },
        { val: "bpmn:ServiceTask", name: "Service Task" },
        { val: "bpmn:ScriptTask", name: "Script Task" },
        { val: "bpmn:SendTask", name: "Send Task" },
        { val: "bpmn:ReceiveTask", name: "Receive Task" },
        { val: "bpmn:ManualTask", name: "Manual Task" },
        { val: "bpmn:BusinessRuleTask", name: "Business Rule Task" },
      ];

      for (const t of types) {
        const option = document.createElement("option");
        option.value = t.val;
        option.textContent = t.name;
        option.selected = bo.$type === t.val;
        typeSelect.appendChild(option);
      }

      typeSelect.onchange = () => {
        const newEl = controller.replaceElement(element, typeSelect.value);
        if (newEl) {
          // Trigger selection update with new element
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(SELECTION_EVENT));
          }, 50);
        }
      };

      field(taskSec, "Task Type", typeSelect);

      // Loop characteristics
      const loopSelect = el("select", "lk-pinput") as HTMLSelectElement;
      const loops = [
        { val: "", name: "None" },
        { val: "standard", name: "Standard Loop" },
        { val: "parallel", name: "Multi-instance Parallel" },
        { val: "sequential", name: "Multi-instance Sequential" }
      ];

      const currentLoopType = bo.loopCharacteristics
        ? (bo.loopCharacteristics.$type === "bpmn:StandardLoopCharacteristics"
            ? "standard"
            : (bo.loopCharacteristics.isSequential ? "sequential" : "parallel"))
        : "";

      for (const l of loops) {
        const option = document.createElement("option");
        option.value = l.val;
        option.textContent = l.name;
        option.selected = currentLoopType === l.val;
        loopSelect.appendChild(option);
      }

      loopSelect.onchange = () => {
        controller.updateLoopCharacteristics(element, loopSelect.value);
      };

      field(taskSec, "Loop Type", loopSelect);
    }

    // Gateway type options
    const isGateway = bo.$type && (
      bo.$type === "bpmn:ExclusiveGateway" ||
      bo.$type === "bpmn:ParallelGateway" ||
      bo.$type === "bpmn:InclusiveGateway" ||
      bo.$type === "bpmn:EventBasedGateway" ||
      bo.$type === "bpmn:ComplexGateway"
    );

    if (isGateway) {
      const gatewaySec = section("Gateway Options");
      const gatewaySelect = el("select", "lk-pinput") as HTMLSelectElement;

      const gateways = [
        { val: "bpmn:ExclusiveGateway", name: "Exclusive Gateway (XOR)" },
        { val: "bpmn:ParallelGateway", name: "Parallel Gateway (AND)" },
        { val: "bpmn:InclusiveGateway", name: "Inclusive Gateway (OR)" },
        { val: "bpmn:EventBasedGateway", name: "Event-Based Gateway" },
        { val: "bpmn:ComplexGateway", name: "Complex Gateway" },
      ];

      for (const g of gateways) {
        const option = document.createElement("option");
        option.value = g.val;
        option.textContent = g.name;
        option.selected = bo.$type === g.val;
        gatewaySelect.appendChild(option);
      }

      gatewaySelect.onchange = () => {
        const newEl = controller.replaceElement(element, gatewaySelect.value);
        if (newEl) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(SELECTION_EVENT));
          }, 50);
        }
      };

      field(gatewaySec, "Gateway Type", gatewaySelect);
    }

    // Call Activity called element property
    if (bo.$type === "bpmn:CallActivity") {
      const callSec = section("Call Activity Options");
      field(
        callSec,
        "Called Element (Process ID)",
        textInput(bo.calledElement, "Process ID", (val) => {
          controller.updateProperties(element, { calledElement: val.trim() });
        })
      );
    }

    // Sequence Flow Conditional Expressions leaving Gateways
    const isSequenceFlow = bo.$type === "bpmn:SequenceFlow";
    const isConditional = isSequenceFlow && bo.sourceRef && (
      bo.sourceRef.$type === "bpmn:ExclusiveGateway" ||
      bo.sourceRef.$type === "bpmn:InclusiveGateway"
    );

    if (isConditional) {
      const flowSec = section("Condition Options");
      field(
        flowSec,
        "Condition Expression",
        textInput(bo.conditionExpression?.body ?? "", "e.g. ${approved == true}", (val) => {
          controller.updateConditionExpression(element, val);
        })
      );
    }

    // Event Definition Trigger Selection
    const isEvent = bo.$type && (
      bo.$type === "bpmn:StartEvent" ||
      bo.$type === "bpmn:EndEvent" ||
      bo.$type === "bpmn:IntermediateCatchEvent" ||
      bo.$type === "bpmn:IntermediateThrowEvent" ||
      bo.$type === "bpmn:BoundaryEvent"
    );

    if (isEvent) {
      const eventSec = section("Event Options");
      
      // Event Type Switcher
      const typeSelect = el("select", "lk-pinput") as HTMLSelectElement;
      const eventTypes = [
        { val: "bpmn:StartEvent", name: "Start Event" },
        { val: "bpmn:IntermediateCatchEvent", name: "Intermediate Catch Event" },
        { val: "bpmn:IntermediateThrowEvent", name: "Intermediate Throw Event" },
        { val: "bpmn:EndEvent", name: "End Event" },
        { val: "bpmn:BoundaryEvent", name: "Boundary Event" },
      ];

      for (const et of eventTypes) {
        const option = document.createElement("option");
        option.value = et.val;
        option.textContent = et.name;
        option.selected = bo.$type === et.val;
        typeSelect.appendChild(option);
      }

      typeSelect.onchange = () => {
        const newEl = controller.replaceElement(element, typeSelect.value);
        if (newEl) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(SELECTION_EVENT));
          }, 50);
        }
      };

      field(eventSec, "Event Type", typeSelect);

      const eventSelect = el("select", "lk-pinput") as HTMLSelectElement;
      const eventDefs = [
        { val: "", name: "None (Generic Event)" },
        { val: "bpmn:MessageEventDefinition", name: "Message" },
        { val: "bpmn:TimerEventDefinition", name: "Timer" },
        { val: "bpmn:SignalEventDefinition", name: "Signal" },
        { val: "bpmn:ErrorEventDefinition", name: "Error" },
        { val: "bpmn:EscalationEventDefinition", name: "Escalation" },
        { val: "bpmn:ConditionalEventDefinition", name: "Conditional" },
        { val: "bpmn:TerminateEventDefinition", name: "Terminate" }
      ];

      const currentEventDef = bo.eventDefinitions?.[0]?.$type ?? "";

      for (const ed of eventDefs) {
        const option = document.createElement("option");
        option.value = ed.val;
        option.textContent = ed.name;
        option.selected = currentEventDef === ed.val;
        eventSelect.appendChild(option);
      }

      eventSelect.onchange = () => {
        controller.updateEventDefinition(element, eventSelect.value);
        // Refresh properties view to show trigger definition
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(SELECTION_EVENT));
        }, 50);
      };

      field(eventSec, "Trigger Definition", eventSelect);
    }

    // ── Group 3: Documentation ──
    const docSec = section("Documentation");
    const docTextArea = el("textarea", "lk-pinput obp-textarea") as HTMLTextAreaElement;
    docTextArea.rows = 5;
    docTextArea.placeholder = "Enter documentation here...";
    docTextArea.value = bo.documentation?.[0]?.text ?? "";

    docTextArea.oninput = () => {
      controller.updateDocumentation(element, docTextArea.value);
    };

    docSec.appendChild(docTextArea);
  }
}
