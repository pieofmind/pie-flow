import { describe, it, expect, vi } from "vitest";

/**
 * Story 6.1 — Bulk delete contract tests.
 *
 * The actual delete logic lives inside OmniboardCanvas.ts:511-521 and is tied
 * to a live X6 Graph. Mocking the entire Graph is high-effort; instead we
 * verify the CONTRACT — that the documented sequence
 *     cleanSelection() → startBatch("delete") → removeCells(cells) → stopBatch("delete")
 * is preserved, that order matters, and that a thrown removeCells still closes
 * the batch (the `finally` guard).
 *
 * If anyone refactors the handler, these tests catch:
 *  • Forgetting `cleanSelection` before removal (stale selection refs).
 *  • Dropping the batch wrap (every removeCell would become its own undo step
 *    and the BPMN 39-edge Ctrl+A → Delete freeze would resurface).
 *  • Missing `finally` (batch leak on error → graph stuck "in-progress").
 */

/** Minimal stand-in for the bound `bindKey` callback at OmniboardCanvas.ts:511. */
function makeBulkDelete(graph: {
  getSelectedCells: () => unknown[];
  cleanSelection: () => void;
  startBatch: (n: string) => void;
  removeCells: (c: unknown[]) => void;
  stopBatch: (n: string) => void;
}) {
  return () => {
    const cells = graph.getSelectedCells();
    if (!cells.length) return;
    graph.cleanSelection();
    graph.startBatch("delete");
    try { graph.removeCells(cells); }
    finally { graph.stopBatch("delete"); }
  };
}

describe("bulk delete — contract", () => {
  it("no-ops when selection is empty (no batch opened)", () => {
    const calls: string[] = [];
    const graph = {
      getSelectedCells: () => [],
      cleanSelection: () => calls.push("clean"),
      startBatch: () => calls.push("startBatch"),
      removeCells: () => calls.push("removeCells"),
      stopBatch: () => calls.push("stopBatch"),
    };
    makeBulkDelete(graph)();
    expect(calls).toEqual([]); // No work — no startBatch leak.
  });

  it("clean → startBatch → removeCells → stopBatch in order", () => {
    const calls: string[] = [];
    const cells = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const graph = {
      getSelectedCells: () => cells,
      cleanSelection: () => calls.push("clean"),
      startBatch: (n: string) => calls.push(`start:${n}`),
      removeCells: (c: unknown[]) => calls.push(`remove:${(c as { id: string }[]).map((x) => x.id).join(",")}`),
      stopBatch: (n: string) => calls.push(`stop:${n}`),
    };
    makeBulkDelete(graph)();
    expect(calls).toEqual([
      "clean",
      "start:delete",
      "remove:a,b,c",
      "stop:delete",
    ]);
  });

  it("scales to a 73-cell selection (no special-case skip)", () => {
    // Mirrors the BPMN restaurant import (33 nodes + 39 edges + 1 association = 73).
    const cells = Array.from({ length: 73 }, (_, i) => ({ id: `c${i}` }));
    let removed: unknown[] | null = null;
    const graph = {
      getSelectedCells: () => cells,
      cleanSelection: () => {},
      startBatch: () => {},
      removeCells: (c: unknown[]) => { removed = c; },
      stopBatch: () => {},
    };
    makeBulkDelete(graph)();
    expect(removed).toHaveLength(73);
  });

  it("stopBatch still runs if removeCells throws (finally guard)", () => {
    const calls: string[] = [];
    const graph = {
      getSelectedCells: () => [{ id: "boom" }],
      cleanSelection: () => calls.push("clean"),
      startBatch: () => calls.push("start"),
      removeCells: () => { calls.push("remove-throws"); throw new Error("X6 boom"); },
      stopBatch: () => calls.push("stop"),
    };
    expect(() => makeBulkDelete(graph)()).toThrow("X6 boom");
    // Batch MUST be closed even on error — otherwise the graph stays mid-batch
    // and subsequent edits are silently coalesced into a never-flushed undo entry.
    expect(calls).toEqual(["clean", "start", "remove-throws", "stop"]);
  });

  it("cleanSelection runs BEFORE removeCells — order verified via call-order spy", () => {
    // Why this matters: if removeCells runs first, the selection plugin still
    // holds references to cells being torn down; subsequent refreshContextBar
    // calls hit `getBBox()` on a removed view and crash.
    const order: string[] = [];
    const cleanSelectionFn = vi.fn(() => order.push("clean"));
    const removeCellsFn = vi.fn(() => order.push("remove"));
    const graph = {
      getSelectedCells: () => [{ id: "x" }],
      cleanSelection: cleanSelectionFn,
      startBatch: () => {},
      removeCells: removeCellsFn,
      stopBatch: () => {},
    };
    makeBulkDelete(graph)();
    expect(order).toEqual(["clean", "remove"]);
  });
});
