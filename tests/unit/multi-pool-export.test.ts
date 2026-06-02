/**
 * End-to-end smoke for the multi-pool processRef fix:
 *
 * 1. Load the canvas model from the user's actual file (`omniboard-data`
 *    block in the wrapper markdown).
 * 2. Run `exportBpmn(canvas)` through the patched emitMinimal.
 * 3. Parse the emitted XML back through bpmn-moddle.
 * 4. Walk the parsed tree counting IDs — assert no duplicates.
 *
 * Before the fix: 2 participants shared one process → bpmn-js's BpmnImporter
 * walked the process twice and threw "element already exists" for every
 * flow node + lane + sequence flow.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:fs";
import * as zlib from "node:zlib";
import { exportBpmn } from "../../src/io/bpmn/export";
import { BpmnModdle } from "bpmn-moddle";
import { deserializeBoard } from "../../src/view/boardSerde";
import type { CanvasModel } from "../../src/canvas/types";

const FILE = "/Users/linhji/dev/obsidian-omniboard-bmad/obsidian-vault-test/Omniboard 20260602-143606.omniboard.md";

function loadCanvas(): CanvasModel {
  const md = readFileSync(FILE, "utf8");
  const m = deserializeBoard(md);
  if (!m) throw new Error("Failed to deserialize canvas from " + FILE);
  return m;
}

function walkIds(node: unknown, seen: Map<string, string>, path = "root"): void {
  if (!node || typeof node !== "object") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = node as Record<string, any>;
  if (typeof obj.id === "string") {
    if (seen.has(obj.id)) {
      seen.set(obj.id + "::DUP::" + Math.random(), `${path}/${obj.$type ?? "?"} dupOf=${seen.get(obj.id)}`);
    } else {
      seen.set(obj.id, `${path}/${obj.$type ?? "?"}`);
    }
  }
  for (const k of Object.keys(obj)) {
    if (k.startsWith("$")) continue;
    const v = obj[k];
    if (Array.isArray(v)) v.forEach((x, i) => walkIds(x, seen, `${path}/${k}[${i}]`));
    else if (v && typeof v === "object") walkIds(v, seen, `${path}/${k}`);
  }
}

describe("multi-pool export → re-parse: no duplicate IDs (user file 143606)", () => {
  it("loads, exports, and parses with no duplicate elements", async () => {
    const canvas = loadCanvas();
    const pools = canvas.nodes.filter((n) => n.shape === "bpmn-pool");
    expect(pools.length, "fixture file must have ≥2 pools to exercise the bug").toBeGreaterThanOrEqual(2);

    const xml = await exportBpmn(canvas);

    // Sanity: per-pool process emission
    const processIds = [...xml.matchAll(/<bpmn:process\s+[^/>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(processIds.length).toBeGreaterThanOrEqual(pools.length);

    // Each participant must reference a DISTINCT process
    const refs = [...xml.matchAll(/<bpmn:participant\s+[^/>]*\bprocessRef="([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBe(pools.length);
    expect(new Set(refs).size).toBe(refs.length);

    // Parse with moddle and assert no duplicate IDs anywhere in the tree
    const moddle = new BpmnModdle();
    const { rootElement, warnings } = await moddle.fromXML(xml);
    expect(warnings.length).toBe(0);

    const seen = new Map<string, string>();
    walkIds(rootElement, seen);
    const dups = [...seen.keys()].filter((k) => k.includes("::DUP::"));
    if (dups.length) {
      console.error("Duplicates:", dups.map((k) => `${k.split("::DUP::")[0]} → ${seen.get(k)}`));
    }
    expect(dups).toEqual([]);
  });
});
