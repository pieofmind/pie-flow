import { ItemView, WorkspaceLeaf } from "obsidian";
import type { OmniboardCanvas, SelectedNodeSnapshot } from "../canvas/OmniboardCanvas";
import { triggerChoices } from "../io/bpmn/eventTriggers";

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
  getDisplayText(): string { return "Pie Flow Properties"; }
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
    if (!canvas) {
      this.contentEl.createDiv({
        cls: "obp-empty",
        text: "Chọn một node trên Pie Flow để chỉnh BPMN metadata, màu DI và Camunda extensions.",
      });
      return;
    }
    // Story 6.1 — Multi-select branch: when ≥2 nodes selected, render bulk
    // style editor instead of single-node panel.
    const all = canvas.getSelectedNodesSnapshot();
    if (all.length >= 2) { this.renderMulti(canvas, all); return; }
    const snap = canvas.getSelectedNodeSnapshot();
    if (!snap) {
      this.contentEl.createDiv({
        cls: "obp-empty",
        text: "Chọn một node trên Pie Flow để chỉnh BPMN metadata, màu DI và Camunda extensions.",
      });
      return;
    }
    this.renderNode(canvas, snap);
  }

  // Story 6.1 — Multi-select bulk style editor (AC #6).
  // Shows only the fields shared by ALL selected nodes (Fill/Stroke for now).
  // Values that differ across cells show "—" (mixed); typing replaces ALL.
  private renderMulti(canvas: OmniboardCanvas, snaps: SelectedNodeSnapshot[]): void {
    const title = this.contentEl.createDiv({ cls: "obp-title" });
    title.createSpan({ cls: "obp-kind", text: `${snaps.length} selected` });
    title.createEl("strong", { text: "Multi-edit" });

    // Same-kind guard: bulk style only applies cleanly when all cells share a kind.
    const firstKind = snaps[0].kind;
    const allSameKind = snaps.every((s) => s.kind === firstKind);
    if (!allSameKind) {
      this.contentEl.createDiv({
        cls: "obp-empty",
        text: "Chọn các node CÙNG LOẠI để chỉnh hàng loạt (hiện đang trộn nhiều loại).",
      });
      return;
    }

    const mixed = <T,>(get: (s: SelectedNodeSnapshot) => T): T | null => {
      const first = get(snaps[0]);
      for (let i = 1; i < snaps.length; i++) if (get(snaps[i]) !== first) return null;
      return first;
    };

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

    const ids = snaps.map((s) => s.id);

    // [Review][Patch P12] After a bulk patch, emit selection-change so the
    // panel re-renders — otherwise the "— (mixed)" placeholder stays even
    // when all values are now equal.
    const commit = (patch: Partial<Record<string, unknown>>) => {
      canvas.patchNodesBulk(ids, patch as Partial<import("../canvas/htmlNode").NodeStyle>);
      emitOmniboardSelectionChange();
    };

    // [Review][Patch P2] Validate before commit; switch to onchange (blur) so
    // typing "#ffaa00" doesn't fire 7 batches and 7 undo entries. We still
    // give visual swatch feedback on every keystroke (preview only).
    const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const styleColorRow = (key: "fill" | "stroke", label: string) => {
      const row = el("div", "lk-prow2");
      const sw = el("div", "lk-pswatch");
      const current = mixed((s) => s.style[key] as string | undefined);
      sw.style.background = current ?? "transparent";
      const input = el("input", "lk-pinput") as HTMLInputElement;
      input.value = current ?? "";
      input.placeholder = current === null ? "— (mixed)" : "#ffffff";
      // Preview only — no commit.
      input.oninput = () => {
        const v = input.value.trim();
        if (!v || HEX_RE.test(v) || v === "transparent") sw.style.background = v || "transparent";
      };
      // Commit on blur / Enter — one undo entry per intentional edit.
      input.onchange = () => {
        const v = input.value.trim();
        if (v === "") { commit({ [key]: undefined }); return; }
        if (v === "transparent" || HEX_RE.test(v)) { commit({ [key]: v }); return; }
        // Invalid input → revert UI to current value, no commit.
        input.value = current ?? "";
        sw.style.background = current ?? "transparent";
      };
      input.onkeydown = (ev) => { if (ev.key === "Enter") input.blur(); };
      row.appendChild(sw);
      row.appendChild(input);
      field(this.contentEl, label, row);
    };

    // [Review][Patch P1] Numeric fields (stroke-width, font-size) — same
    // commit-on-blur pattern with NaN guard.
    const styleNumberRow = (key: "borderWidth" | "fontSize", label: string, min: number, max: number) => {
      const input = el("input", "lk-pinput") as HTMLInputElement;
      input.type = "number"; input.min = String(min); input.max = String(max); input.step = "1";
      const current = mixed((s) => (s.style as Record<string, unknown>)[key] as number | undefined);
      input.value = current != null ? String(current) : "";
      input.placeholder = current === null ? "— (mixed)" : "";
      input.onchange = () => {
        const v = input.value.trim();
        if (v === "") { commit({ [key]: undefined }); return; }
        const n = Number(v);
        if (Number.isFinite(n) && n >= min && n <= max) commit({ [key]: n });
        else input.value = current != null ? String(current) : "";
      };
      input.onkeydown = (ev) => { if (ev.key === "Enter") input.blur(); };
      field(this.contentEl, label, input);
    };

    const sec = section("Bulk style");
    sec.createDiv({ cls: "obp-empty", text: `Áp dụng cho ${snaps.length} node cùng loại "${firstKind}". Trường giá trị khác nhau hiển thị placeholder "— (mixed)". Edit commit on blur/Enter.` });
    styleColorRow("fill", "Fill");
    styleColorRow("stroke", "Stroke");
    styleNumberRow("borderWidth", "Border width", 0, 20);
    styleNumberRow("fontSize", "Font size", 8, 72);
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

    const idInput = el("input", "lk-pinput") as HTMLInputElement;
    idInput.value = snap.id;
    idInput.onchange = () => {
      if (canvas.renameNode(snap.id, idInput.value.trim())) return;
      idInput.setCustomValidity(`ID "${idInput.value.trim()}" không hợp lệ hoặc đã có.`);
      idInput.reportValidity();
      idInput.setCustomValidity("");
      idInput.value = snap.id;
    };
    field(content, "ID", idInput);
    if (snap.kind === "bpmn-call-activity") {
      field(content, "calledElement", textInput(String(snap.attrs.calledElement ?? ""), "ID process được gọi",
        (value) => saveAttrs({ calledElement: value.trim() || undefined })));
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
      const triggers = triggerChoices(snap.kind, snap.attrs).map((t) => (t === "none" ? "" : t));
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
