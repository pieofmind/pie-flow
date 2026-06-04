/**
 * Minimal `obsidian` module stub for Vitest. Production builds use the
 * real obsidian module injected at runtime; tests that need richer
 * behavior should `vi.mock("obsidian", ...)` to override this stub.
 *
 * Kept intentionally small — add stubs only as new tests require them.
 */

export class Menu {
  addItem(_cb: unknown): this {
    return this;
  }
  addSeparator(): this {
    return this;
  }
  showAtMouseEvent(_e: unknown): this {
    return this;
  }
  showAtPosition(_p: unknown): this {
    return this;
  }
}

export class Notice {
  constructor(_msg: unknown, _timeout?: number) {}
}

export const setIcon = (_el: unknown, _name: string): void => {
  // no-op
};

export class Modal {
  app: unknown;
  contentEl: HTMLElement = (typeof document !== "undefined"
    ? document.createElement("div")
    : ({} as HTMLElement));
  modalEl: HTMLElement = (typeof document !== "undefined"
    ? document.createElement("div")
    : ({} as HTMLElement));

  constructor(app: unknown) {
    this.app = app;
  }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class TFile {
  path = "";
  basename = "";
  extension = "";
  parent: unknown = null;
}

export class TextFileView {
  contentEl: HTMLElement = (typeof document !== "undefined"
    ? document.createElement("div")
    : ({} as HTMLElement));
  file: TFile | null = null;
  app: unknown;
  leaf: unknown;
  constructor(leaf: unknown) {
    this.leaf = leaf;
  }
  getViewType(): string {
    return "stub";
  }
  getDisplayText(): string {
    return "stub";
  }
  getIcon(): string {
    return "shapes";
  }
  getViewData(): string {
    return "";
  }
  setViewData(_d: string, _c: boolean): void {}
  clear(): void {}
  save(_clear?: boolean): Promise<void> {
    return Promise.resolve();
  }
  onOpen(): Promise<void> {
    return Promise.resolve();
  }
  onClose(): Promise<void> {
    return Promise.resolve();
  }
  requestSave(): void {}
  registerEvent(_e: unknown): void {}
  registerDomEvent(): void {}
}

export class Plugin {
  app: unknown;
  manifest: unknown;
  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }
  registerMarkdownPostProcessor(_fn: unknown): void {}
  registerMarkdownCodeBlockProcessor(_lang: string, _fn: unknown): void {}
  registerView(_type: string, _fn: unknown): void {}
  registerExtensions(_exts: string[], _viewType: string): void {}
  registerEditorExtension(_ext: unknown): void {}
  registerEvent(_e: unknown): void {}
  addCommand(_c: unknown): void {}
  addRibbonIcon(_icon: string, _tip: string, _fn: unknown): void {}
  addSettingTab(_tab: unknown): void {}
  loadData(): Promise<unknown> {
    return Promise.resolve({});
  }
  saveData(_d: unknown): Promise<void> {
    return Promise.resolve();
  }
}

export class MarkdownView {
  editor: unknown;
  file: TFile | null = null;
}

export class WorkspaceLeaf {
  view: unknown;
  detach(): void {}
  setViewState(_s: unknown): Promise<void> {
    return Promise.resolve();
  }
  openFile(_f: TFile, _o?: unknown): Promise<void> {
    return Promise.resolve();
  }
}

export type Editor = unknown;
export type MarkdownPostProcessorContext = unknown;
export type App = unknown;
export type PluginManifest = unknown;

export const normalizePath = (p: string): string => p;
export const requestUrl = (): Promise<unknown> => Promise.resolve({});
