import { ItemView, WorkspaceLeaf } from "obsidian";
import type { OmniboardCanvas, SelectedNodeSnapshot } from "../canvas/OmniboardCanvas";

export const OMNIBOARD_PROPERTIES_VIEW_TYPE = "omniboard-properties";
const BOARD_VIEW_TYPE = "omniboard-board";

const SELECTION_EVENT = "omniboard-selection-change";

export function emitOmniboardSelectionChange(): void {
  window.dispatchEvent(new CustomEvent(SELECTION_EVENT));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cleanObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}

function isBpmnActivity(kind: string): boolean {
  return kind.startsWith("bpmn-task")
    || kind === "bpmn-subprocess"
    || kind === "bpmn-transaction"
    || kind === "bpmn-adhoc-subprocess"
    || kind === "bpmn-event-subprocess"
    || kind === "bpmn-call-activity";
}

export class OmniboardPropertiesView extends ItemView {
  private readonly onSelection = () => this.render();

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return OMNIBOARD_PROPERTIES_VIEW_TYPE; }
  getDisplayText(): string { return "Omniboard Properties"; }
  getIcon(): string { return "sliders-horizontal"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("omniboard-properties-view");
    window.addEventListener(SELECTION_EVENT, this.onSelection);
    this.render();
  }

  async onClose(): Promise<void> {
    window.removeEventListener(SELECTION_EVENT, this.onSelection);
  }

  private activeCanvas(): OmniboardCanvas | null {
    const active = this.app.workspace.activeLeaf?.view as { getViewType?: () => string; getCanvas?: () => OmniboardCanvas | null } | undefined;
    if (active?.getViewType?.() === BOARD_VIEW_TYPE) return active.getCanvas?.() ?? null;
    const leaf = this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE)[0];
    return (leaf?.view as { getCanvas?: () => OmniboardCanvas | null } | undefined)?.getCanvas?.() ?? null;
  }

  private render(): void {
    this.contentEl.empty();
    const canvas = this.activeCanvas();
    const snap = canvas?.getSelectedNodeSnapshot() ?? null;
    if (!canvas || !snap) {
      this.contentEl.createDiv({
        cls: "obp-empty",
        text: "Chọn một node trên Omniboard để chỉnh BPMN metadata, màu DI và Camunda extensions.",
      });
      return;
    }
    this.renderNode(canvas, snap);
  }

  private renderNode(canvas: OmniboardCanvas, snap: SelectedNodeSnapshot): void {
    const title = this.contentEl.createDiv({ cls: "obp-title" });
    title.createSpan({ cls: "obp-kind", text: snap.kind });
    title.createEl("strong", { text: snap.label || snap.id });

    const saveAttrs = (attrs: Record<string, unknown>) => canvas.patchSelectedNode({ attrs });
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
      input.value = value;
      input.placeholder = placeholder;
      input.oninput = () => onInput(input.value);
      return input;
    };

    const content = section("Content");
    field(content, "Label", textInput(snap.label, "Label", (value) => canvas.patchSelectedNode({ label: value })));

    if (!snap.kind.startsWith("bpmn-")) {
      this.contentEl.createDiv({ cls: "obp-empty", text: "Properties leaf currently exposes BPMN-specific metadata." });
      return;
    }

    const color = section("BPMN DI Color");
    const colorRow = (key: "bpmnFill" | "bpmnStroke", label: string) => {
      const row = el("div", "lk-prow2");
      const sw = el("div", "lk-pswatch");
      const current = String(snap.attrs[key] ?? "");
      sw.style.background = current || "transparent";
      const input = textInput(current, "#ffffff", (value) => {
        sw.style.background = value.trim() || "transparent";
        saveAttrs({ [key]: value.trim() || undefined });
      });
      row.appendChild(sw);
      row.appendChild(input);
      field(color, label, row);
    };
    colorRow("bpmnFill", "Fill");
    colorRow("bpmnStroke", "Stroke");

    if (snap.kind === "bpmn-event-start" || snap.kind === "bpmn-event-intermediate" || snap.kind === "bpmn-event-end") {
      const event = section("Event");
      const select = el("select", "lk-pinput") as HTMLSelectElement;
      const triggers = ["", "message", "timer", "signal", "error", "escalation", "compensation", "conditional", "link", "cancel", "terminate", "multiple", "parallel-multiple"];
      for (const trigger of triggers) {
        const option = document.createElement("option");
        option.value = trigger;
        option.textContent = trigger || "(none)";
        option.selected = snap.attrs.trigger === trigger || (!snap.attrs.trigger && trigger === "");
        select.appendChild(option);
      }
      select.onchange = () => saveAttrs({ trigger: select.value || undefined });
      field(event, "Trigger", select);
    }

    if (isBpmnActivity(snap.kind)) {
      const activity = section("Activity");
      const markers = Array.isArray(snap.attrs.markers) ? snap.attrs.markers.map(String) : [];
      const loop = el("select", "lk-pinput") as HTMLSelectElement;
      for (const [value, label] of [["", "None"], ["loop", "Standard loop"], ["mi-par", "Multi-instance parallel"], ["mi-seq", "Multi-instance sequential"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = markers.includes(value);
        loop.appendChild(option);
      }
      loop.onchange = () => {
        const rest = markers.filter((m) => m !== "loop" && m !== "mi-par" && m !== "mi-seq");
        saveAttrs({ markers: loop.value ? [...rest, loop.value] : rest });
      };
      field(activity, "Loop type", loop);

      const comp = el("input") as HTMLInputElement;
      comp.type = "checkbox";
      comp.checked = markers.includes("compensation");
      comp.onchange = () => {
        const rest = markers.filter((m) => m !== "compensation");
        saveAttrs({ markers: comp.checked ? [...rest, "compensation"] : rest });
      };
      field(activity, "isForCompensation", comp);
    }

    const docs = section("Documentation");
    const doc = el("textarea", "lk-pinput obp-textarea") as HTMLTextAreaElement;
    doc.rows = 5;
    doc.value = String(snap.attrs.bpmnDoc ?? "");
    doc.oninput = () => saveAttrs({ bpmnDoc: doc.value.trim() || undefined });
    docs.appendChild(doc);

    const cam = section("Camunda Extension Elements");
    const currentCamunda = (snap.attrs.camunda && typeof snap.attrs.camunda === "object" ? snap.attrs.camunda : {}) as Record<string, string>;
    const camundaFields = ["assignee", "candidateUsers", "candidateGroups", "formKey", "dueDate", "priority"];
    for (const key of camundaFields) {
      field(cam, key, textInput(currentCamunda[key] ?? "", key, (value) => {
        saveAttrs({ camunda: cleanObject({ ...currentCamunda, [key]: value.trim() }) });
      }));
    }

    const props = Array.isArray(snap.attrs.bpmnProps)
      ? snap.attrs.bpmnProps as Array<{ name: string; value: string }>
      : [];
    const propsHost = cam.createDiv({ cls: "obp-kv" });
    const renderPropRows = () => {
      propsHost.empty();
      const current = Array.isArray(canvas.getSelectedNodeSnapshot()?.attrs.bpmnProps)
        ? canvas.getSelectedNodeSnapshot()!.attrs.bpmnProps as Array<{ name: string; value: string }>
        : props;
      current.forEach((prop, index) => {
        const row = propsHost.createDiv({ cls: "lk-prow2" });
        const name = textInput(prop.name, "name", (value) => {
          const next = current.map((p, i) => i === index ? { ...p, name: value.trim() } : p).filter((p) => p.name);
          saveAttrs({ bpmnProps: next.length ? next : undefined });
        });
        const value = textInput(prop.value, "value", (v) => {
          const next = current.map((p, i) => i === index ? { ...p, value: v } : p).filter((p) => p.name);
          saveAttrs({ bpmnProps: next.length ? next : undefined });
        });
        row.appendChild(name);
        row.appendChild(value);
      });
    };
    renderPropRows();
    const add = el("button", "lk-padd", "+ Add camunda:property");
    add.onclick = () => {
      const current = Array.isArray(canvas.getSelectedNodeSnapshot()?.attrs.bpmnProps)
        ? canvas.getSelectedNodeSnapshot()!.attrs.bpmnProps as Array<{ name: string; value: string }>
        : [];
      saveAttrs({ bpmnProps: [...current, { name: "property", value: "" }] });
      this.render();
    };
    cam.appendChild(add);

    const raw = section("Raw Metadata JSON");
    const json = el("textarea", "lk-pinput obp-textarea") as HTMLTextAreaElement;
    json.rows = 8;
    json.value = JSON.stringify({
      documentation: snap.attrs.bpmnDoc ?? "",
      camunda: currentCamunda,
      bpmnProps: props,
    }, null, 2);
    json.onchange = () => {
      try {
        const parsed = JSON.parse(json.value) as { documentation?: string; camunda?: Record<string, string>; bpmnProps?: Array<{ name: string; value: string }> };
        saveAttrs({
          bpmnDoc: parsed.documentation || undefined,
          camunda: parsed.camunda ? cleanObject(parsed.camunda) : undefined,
          bpmnProps: parsed.bpmnProps?.filter((p) => p.name) || undefined,
        });
      } catch {
        json.addClass("obp-invalid");
      }
    };
    raw.appendChild(json);
  }
}
