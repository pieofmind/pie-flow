import type { DiagramAdapter, DiagramTypeId } from "./adapter";

/** Central registry of all diagram adapters. */
export class AdapterRegistry {
  private adapters = new Map<DiagramTypeId, DiagramAdapter>();

  register(adapter: DiagramAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: DiagramTypeId): DiagramAdapter | undefined {
    return this.adapters.get(id);
  }

  getByLanguage(lang: string): DiagramAdapter | undefined {
    for (const a of this.adapters.values()) {
      if (a.codeBlockLanguage === lang) return a;
    }
    return undefined;
  }

  all(): DiagramAdapter[] {
    return [...this.adapters.values()];
  }
}
