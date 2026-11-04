import pako from "pako";
import type { CanvasModel } from "../canvas/types";

export const BOARD_EXT = "pieflow.md";
export const BOARD_SUFFIX = `.${BOARD_EXT}`;
/** Pre-rename (Omniboard) suffix: still opened, never written for new boards. */
export const LEGACY_BOARD_SUFFIX = ".omniboard.md";
export function isBoardPath(path: string): boolean {
  return path.endsWith(BOARD_SUFFIX) || path.endsWith(LEGACY_BOARD_SUFFIX);
}
const DATA_LANG = "pie-flow-data";
const META_LANG = "pie-flow-source-meta";
const BPMN_LANG = "pie-flow-bpmn-xml";
export const REQUIRED_FM_KEY = "pie-flow-plugin";
const LEGACY_FM_KEY = "omniboard-plugin";
const REQUIRED_FM_VAL = "parsed";
/** Readers accept both the current `pie-flow-*` and pre-rename `omniboard-*` names. */
const LANG_PREFIX = "(?:pie-flow|omniboard)";
const FM_KEY_RE = "(?:pie-flow|omniboard)-plugin";
const BOARD_TAG = "pie-flow";

function blockRe(suffix: string): RegExp {
  return new RegExp("```" + LANG_PREFIX + "-" + suffix + "\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```", "m");
}
const DRAWING_RE = blockRe("data");
const META_RE = blockRe("source-meta");
const BPMN_RE = blockRe("bpmn-xml");
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface ParsedFrontmatter {
  raw: Record<string, string>;
  order: string[];
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return { raw: {}, order: [] };
  const body = m[1];
  const out: Record<string, string> = {};
  const order: string[] = [];
  // Simple line-based key: value parser (no nested YAML — sufficient for the
  // frontmatter shapes Obsidian users typically write here).
  let pendingKey: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*-\s/.test(line) && pendingKey) {
      out[pendingKey] += "\n" + line;
      continue;
    }
    const mm = /^([A-Za-z0-9_\-]+)\s*:(.*)$/.exec(line);
    if (!mm) { pendingKey = null; continue; }
    const k = mm[1];
    const v = mm[2].trim();
    if (!(k in out)) order.push(k);
    out[k] = v.length ? v : "";
    pendingKey = v.length ? null : k;
  }
  return { raw: out, order };
}

/** Keep the user's tags; swap the legacy `omniboard` tag for `pie-flow`, add it if missing. */
export function boardTags(tags: string | undefined): string {
  if (!tags) return `[${BOARD_TAG}]`;
  const swapped = tags.replace(/(^|[\s,\[])omniboard(?=$|[\s,\]])/g, `$1${BOARD_TAG}`);
  if (new RegExp(`(^|[\\s,\\[])${BOARD_TAG}($|[\\s,\\]])`).test(swapped)) return swapped;
  const inline = /^\[(.*)\]$/.exec(swapped.trim());
  if (inline) return inline[1].trim() ? `[${BOARD_TAG}, ${inline[1].trim()}]` : `[${BOARD_TAG}]`;
  if (swapped.startsWith("\n")) return `${swapped}\n- ${BOARD_TAG}`;
  return `[${BOARD_TAG}, ${swapped}]`;
}

function emitFrontmatter(fm: ParsedFrontmatter): string {
  const keys = new Set(fm.order);
  // Ensure required keys are present and stamped first.
  const lines: string[] = ["---"];
  lines.push(`${REQUIRED_FM_KEY}: ${REQUIRED_FM_VAL}`);
  keys.delete(REQUIRED_FM_KEY);
  keys.delete(LEGACY_FM_KEY);

  lines.push(`tags: ${boardTags(fm.raw.tags)}`);
  keys.delete("tags");

  for (const k of fm.order) {
    if (!keys.has(k)) continue;
    const v = fm.raw[k];
    if (v.includes("\n")) {
      lines.push(`${k}:`);
      for (const sub of v.split("\n")) if (sub.trim()) lines.push(sub);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function compressFn(json: string): string {
  const deflated = pako.deflate(new TextEncoder().encode(json));
  // btoa accepts a binary string; convert in chunks to avoid call-stack blow up.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < deflated.length; i += CHUNK) {
    bin += String.fromCharCode(...deflated.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function decompress(b64: string): string | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(pako.inflate(bytes));
  } catch {
    return null;
  }
}

function parseMaybeCompressedJson(block: string): unknown | null {
  const inflated = decompress(block);
  if (inflated !== null) {
    try { return JSON.parse(inflated); } catch { /* fall through */ }
  }
  // Fallback: allow raw JSON content when compression is disabled or when AI/agents
  // write the block directly.
  try { return JSON.parse(block); } catch { return null; }
}

function escapeMd(s: string): string {
  // Strip newlines from labels so each Text Element stays on a single line
  // (preserves block-reference parsing). Spaces and unicode are fine as-is.
  return s.replace(/\s*\r?\n\s*/g, " ").trim();
}

/**
 * Serialize a canvas model as a `.pieflow.md` document. Existing frontmatter
 * (passed via `previousRaw`) is preserved so user-added fields survive a save.
 */
/** Read the source-meta block (from a previous import) or null if absent. */
export function deserializeSourceMeta(raw: string): unknown {
  const m = META_RE.exec(raw);
  if (!m) return null;
  return parseMaybeCompressedJson(m[1]);
}

/**
 * Read the derived BPMN-XML block (regenerated by the plugin on every save from
 * the canvas master). Returns null if the block is absent or empty — the caller
 * should lazily regenerate it from the canvas model in that case.
 */
export function deserializeBpmnXml(raw: string): string | null {
  const m = BPMN_RE.exec(raw);
  if (!m) return null;
  const trimmed = m[1].trim();
  return trimmed.length ? trimmed : null;
}

export interface SerializeBoardOpts {
  compressDrawingData?: boolean;
  /**
   * Derived BPMN 2.0 XML to embed alongside the canvas-data block. Set to
   * `null`/`undefined` to preserve any pre-existing BPMN block from
   * `previousRaw`. Set to an empty string to explicitly drop the block.
   */
  bpmnXml?: string | null;
}

export function serializeBoard(
  model: CanvasModel,
  previousRaw = "",
  sourceMeta?: unknown,
  opts?: SerializeBoardOpts,
): string {
  const useCompression = opts?.compressDrawingData !== false;
  const fm = parseFrontmatter(previousRaw);
  // If caller didn't pass meta, preserve the previous meta block.
  const meta = sourceMeta ?? deserializeSourceMeta(previousRaw);
  // If caller didn't pass BPMN XML, preserve the previous BPMN block (lazy regen
  // happens elsewhere — serde just round-trips whatever it was given).
  const bpmnXml = opts?.bpmnXml !== undefined
    ? opts.bpmnXml
    : deserializeBpmnXml(previousRaw);
  const parts: string[] = [];
  parts.push(emitFrontmatter(fm));
  parts.push("");
  parts.push("==⚠ Switch to PIE FLOW VIEW in the MORE OPTIONS menu of this document. ⚠==");
  parts.push("");
  parts.push("# Pie Flow");
  parts.push("");

  parts.push("## Text Elements");
  const seenIds = new Set<string>();
  for (const n of model.nodes) {
    const label = n.label ? escapeMd(n.label) : "";
    if (!label) continue;
    if (seenIds.has(n.id)) continue;
    seenIds.add(n.id);
    parts.push(`${label} ^${n.id}`);
  }
  parts.push("");

  const labeledEdges = model.edges.filter((e) => e.label && e.label.trim());
  if (labeledEdges.length) {
    parts.push("## Edges");
    for (const e of labeledEdges) {
      parts.push(`- ${e.source} → ${e.target} : ${escapeMd(e.label!)}`);
    }
    parts.push("");
  }

  const json = JSON.stringify(model);
  parts.push("%%");
  parts.push("## Drawing");
  parts.push("```" + DATA_LANG);
  parts.push(useCompression ? compressFn(json) : json);
  parts.push("```");
  if (bpmnXml && bpmnXml.trim().length) {
    parts.push("");
    parts.push("## BPMN XML");
    parts.push("```" + BPMN_LANG);
    parts.push(bpmnXml.trim());
    parts.push("```");
  }
  if (meta) {
    parts.push("");
    parts.push("## Source Meta");
    parts.push("```" + META_LANG);
    const metaJson = JSON.stringify(meta);
    parts.push(useCompression ? compressFn(metaJson) : metaJson);
    parts.push("```");
  }
  parts.push("%%");
  parts.push("");
  return parts.join("\n");
}

/**
 * Parse a `.pieflow.md` document back to a CanvasModel. Returns null if the
 * drawing block is missing or corrupt (caller should preserve the raw data and
 * surface an error rather than overwriting).
 *
 * Supports two formats for the pie-flow-data block:
 *  1. Gzip + Base64 (normal plugin output) — decompressed via `decompress()`.
 *  2. Plain JSON — written directly by AI agents that cannot Gzip. The plugin
 *     will re-compress on the next save automatically.
 */
export function deserializeBoard(raw: string): CanvasModel | null {
  if (!raw.trim()) return { nodes: [], edges: [] };
  const m = DRAWING_RE.exec(raw);
  if (!m) return null;
  const parsed = parseMaybeCompressedJson(m[1]) as CanvasModel | null;
  if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) return parsed;
  return null;
}

/** Quick check for the marker frontmatter without a full parse. */
export function isPieFlowMarkdown(raw: string): boolean {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return false;
  return new RegExp(`^${FM_KEY_RE}\\s*:\\s*["']?${REQUIRED_FM_VAL}\\b`, "m").test(m[1]);
}
