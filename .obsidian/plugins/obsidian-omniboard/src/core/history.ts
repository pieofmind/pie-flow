/**
 * Generic undo/redo stack over immutable model snapshots.
 * Adapters push a new snapshot on every committed change.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private present: T;
  private readonly limit: number;

  constructor(initial: T, limit = 100) {
    this.present = initial;
    this.limit = limit;
  }

  get current(): T {
    return this.present;
  }

  /** Record a new state. Clears the redo branch. */
  push(next: T): void {
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): T {
    if (!this.canUndo()) return this.present;
    this.future.unshift(this.present);
    this.present = this.past.pop() as T;
    return this.present;
  }

  redo(): T {
    if (!this.canRedo()) return this.present;
    this.past.push(this.present);
    this.present = this.future.shift() as T;
    return this.present;
  }

  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.present = state;
  }
}
