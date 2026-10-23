/**
 * Test doubles for "file changed from outside" tests.
 *
 * `FaithfulTextFileView` ports the part of Obsidian 1.14.5's TextFileView that
 * matters here (save / onModify / loadFileInternal / setData — read from the
 * installed app.js), including the detail that `onModify` is ignored while a
 * save is in flight. `FakeVault` is an in-memory vault that fires `modify`
 * like Obsidian (before the write promise settles, while the view is still
 * `saving`). Use with:
 *
 *   vi.mock("obsidian", async (importOriginal) => ({
 *     ...(await importOriginal<object>()),
 *     ...(await import("./_helpers/obsidian-faithful")).faithfulOverrides(),
 *   }));
 *
 * (Don't import ./obsidian-stub here: vitest aliases `obsidian` to it, so it IS
 * the mocked module and importing it from the factory deadlocks.)
 */

export class FakeVault {
  text = "";
  writes: string[] = [];
  views: Array<{ onModify(f: unknown): void }> = [];
  /** Runs after a write has landed, before modify() resolves (inject races here). */
  afterWrite: (() => Promise<void>) | null = null;
  /** Runs right after a read returns (inject a write that lands "between
   *  the check and the write"). */
  afterRead: (() => void) | null = null;
  async read(_f: unknown): Promise<string> {
    const t = this.text;
    const hook = this.afterRead; this.afterRead = null;
    if (hook) queueMicrotask(hook);
    return t;
  }
  /** Obsidian's atomic read-modify-write. */
  async process(f: unknown, fn: (data: string) => string): Promise<string> {
    const next = fn(this.text);
    if (next !== this.text) await this.modify(f, next);
    return next;
  }
  async modify(f: unknown, t: string): Promise<void> {
    this.text = t; this.writes.push(t);
    for (const v of this.views) v.onModify(f);
    if (this.afterWrite) await this.afterWrite();
  }
  on(): object { return {}; }
  /** Another tool rewrites the file. `silent` = no modify event reaches the views. */
  external(f: unknown, t: string, silent = false): void {
    this.text = t;
    if (!silent) for (const v of this.views) v.onModify(f);
  }
}

class FaithfulTextFileView {
  contentEl = document.createElement("div");
  file: unknown = null;
  app: unknown;
  leaf: unknown;
  data = "";
  lastSavedData: string | null = null;
  dirty = false;
  saving = false;
  saveAgain = false;
  constructor(leaf: unknown) { this.leaf = leaf; }
  getViewData(): string { return ""; }
  setViewData(_d: string, _c: boolean): void {}
  clear(): void {}
  registerEvent(_e: unknown): void {}
  registerDomEvent(): void {}
  // Obsidian debounces this (2 s); tests call save() themselves.
  requestSave = (): void => { this.dirty = true; };
  async save(clear?: boolean): Promise<void> {
    this.dirty = false;
    const file = this.file;
    const vault = (this.app as { vault: FakeVault }).vault;
    if (!file) return;
    if (this.saving) { if (!clear) this.saveAgain = true; return; }
    this.saveAgain = false;
    const o = this.getViewData();
    if (this.lastSavedData === o || this.lastSavedData === null) return;
    const prev = this.lastSavedData;
    this.data = o; this.lastSavedData = o; this.saving = true;
    try { await vault.modify(file, o); }
    catch (e) { this.lastSavedData = prev; throw e; }
    finally { this.saving = false; if (this.saveAgain && !clear) void this.save(); }
  }
  onModify(file: unknown): void {
    if (this.saving) return;
    if (file === this.file) void this.loadFileInternal(file, false);
  }
  async loadFileInternal(file: unknown, clear: boolean): Promise<void> {
    const n = await (this.app as { vault: FakeVault }).vault.read(file);
    const i = this.lastSavedData;
    this.lastSavedData = n;
    if (!clear && i) {
      if (i === n) return;
      if (this.dirty && this.getViewData() === n) return;
    }
    this.setData(n, clear);
  }
  setData(e: string, t: boolean): void {
    if (this.data !== e || t) { this.data = e; void this.setViewData(e, t); }
  }
}

class ItemView { contentEl = document.createElement("div"); constructor(public leaf: unknown) {} }

/** Obsidian's HTMLElement helpers (createDiv, createEl, empty, addClass…). */
function installDomHelpers(): void {
  const P = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (P.createEl) return;
  type Opts = { cls?: string; text?: string; attr?: Record<string, string> } | undefined;
  P.createEl = function (this: HTMLElement, tag: string, o?: Opts) {
    const el = document.createElement(tag);
    if (o?.cls) el.className = o.cls;
    if (o?.text) el.textContent = o.text;
    for (const [k, v] of Object.entries(o?.attr ?? {})) el.setAttribute(k, v);
    this.appendChild(el);
    return el;
  };
  P.createDiv = function (this: HTMLElement, o?: Opts) { return (this as unknown as { createEl(t: string, o?: Opts): HTMLElement }).createEl("div", o); };
  P.createSpan = function (this: HTMLElement, o?: Opts) { return (this as unknown as { createEl(t: string, o?: Opts): HTMLElement }).createEl("span", o); };
  P.empty = function (this: HTMLElement) { this.innerHTML = ""; };
  P.addClass = function (this: HTMLElement, ...c: string[]) { this.classList.add(...c); };
  P.removeClass = function (this: HTMLElement, ...c: string[]) { this.classList.remove(...c); };
  P.toggleClass = function (this: HTMLElement, c: string, on: boolean) { this.classList.toggle(c, on); };
  P.setText = function (this: HTMLElement, t: string) { this.textContent = t; };
}

export function faithfulOverrides(): Record<string, unknown> {
  installDomHelpers();
  return { TextFileView: FaithfulTextFileView, ItemView };
}
