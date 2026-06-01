import pako from "pako";
import type { CanvasModel } from "../canvas/types";

export const OMNIBOARD_EXT = "omniboard.md";
export const OMNIBOARD_SUFFIX = `.${OMNIBOARD_EXT}`;
const DATA_LANG = "omniboard-data";
const META_LANG = "omniboard-source-meta";
const REQUIRED_FM_KEY = "omniboard-plugin";
const REQUIRED_FM_VAL = "parsed";

const DRAWING_RE = new RegExp(
  "```" + DATA_LANG + "\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```",
  "m"
);
const META_RE = new RegExp(
  "```" + META_LANG + "\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```",
  "m"
);
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

function emitFrontmatter(fm: ParsedFrontmatter): string {
  const keys = new Set(fm.order);
  // Ensure required keys are present and stamped first.
  const lines: string[] = ["---"];
  lines.push(`${REQUIRED_FM_KEY}: ${REQUIRED_FM_VAL}`);
  keys.delete(REQUIRED_FM_KEY);

  if (!fm.raw.tags || !/\bomniboard\b/.test(fm.raw.tags)) {
    lines.push(`tags: [omniboard]`);
  } else {
    lines.push(`tags: ${fm.raw.tags}`);
  }
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
 * Serialize a canvas model as a `.omniboard.md` document. Existing frontmatter
 * (passed via `previousRaw`) is preserved so user-added fields survive a save.
 */
/** Read the source-meta block (from a previous import) or null if absent. */
export function deserializeSourceMeta(raw: string): unknown {
  const m = META_RE.exec(raw);
  if (!m) return null;
  return parseMaybeCompressedJson(m[1]);
}

<<<<<<< HEAD
export function serializeBoard(model: CanvasModel, previousRaw = "", sourceMeta?: unknown, compress = true): string {
=======
export function serializeBoard(
  model: CanvasModel,
  previousRaw = "",
  sourceMeta?: unknown,
  opts?: { compressDrawingData?: boolean },
): string {
  const useCompression = opts?.compressDrawingData !== false;
>>>>>>> 59490c1 (Stabilize edge endpoint finalization to stop off-center BPMN snaps)
  const fm = parseFrontmatter(previousRaw);
  // If caller didn't pass meta, preserve the previous meta block.
  const meta = sourceMeta ?? deserializeSourceMeta(previousRaw);
  const parts: string[] = [];
  parts.push(emitFrontmatter(fm));
  parts.push("");
  parts.push("==⚠ Switch to OMNIBOARD VIEW in the MORE OPTIONS menu of this document. ⚠==");
  parts.push("");
  parts.push("# Omniboard");
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
<<<<<<< HEAD
  // When compress=false store plain JSON (Excalidraw "Decompress" mode).
  // AI agents can then read and write the file without a Gzip step.
  parts.push(compress ? compressFn(json) : json);
=======
  parts.push(useCompression ? compress(json) : json);
>>>>>>> 59490c1 (Stabilize edge endpoint finalization to stop off-center BPMN snaps)
  parts.push("```");
  if (meta) {
    parts.push("");
    parts.push("## Source Meta");
    parts.push("```" + META_LANG);
<<<<<<< HEAD
    parts.push(compress ? compressFn(JSON.stringify(meta)) : JSON.stringify(meta));
=======
    const metaJson = JSON.stringify(meta);
    parts.push(useCompression ? compress(metaJson) : metaJson);
>>>>>>> 59490c1 (Stabilize edge endpoint finalization to stop off-center BPMN snaps)
    parts.push("```");
  }
  parts.push("%%");
  parts.push("");
  return parts.join("\n");
}

/**
 * Parse a `.omniboard.md` document back to a CanvasModel. Returns null if the
 * drawing block is missing or corrupt (caller should preserve the raw data and
 * surface an error rather than overwriting).
 *
 * Supports two formats for the omniboard-data block:
 *  1. Gzip + Base64 (normal plugin output) — decompressed via `decompress()`.
 *  2. Plain JSON — written directly by AI agents that cannot Gzip. The plugin
 *     will re-compress on the next save automatically.
 */
export function deserializeBoard(raw: string): CanvasModel | null {
  if (!raw.trim()) return { nodes: [], edges: [] };
  const m = DRAWING_RE.exec(raw);
  if (!m) return null;
<<<<<<< HEAD

  // ── Path 1: Gzip + Base64 (standard compressed format) ──────────────────
  const json = decompress(m[1]);
  if (json !== null) {
    try {
      const model = JSON.parse(json) as CanvasModel;
      if (Array.isArray(model.nodes) && Array.isArray(model.edges)) return model;
    } catch {
      /* fall through to plain-JSON path */
    }
  }

  // ── Path 2: Plain JSON fallback (AI-agent authored files) ────────────────
  // If decompression failed the block may already be a raw JSON string.
  // Accept it so agents can write uncompressed data; the plugin will compress
  // on the next save.
  try {
    const candidate = m[1].trim();
    const model = JSON.parse(candidate) as CanvasModel;
    if (Array.isArray(model.nodes) && Array.isArray(model.edges)) return model;
  } catch {
    /* fall through */
  }

=======
  const parsed = parseMaybeCompressedJson(m[1]) as CanvasModel | null;
  if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) return parsed;
>>>>>>> 59490c1 (Stabilize edge endpoint finalization to stop off-center BPMN snaps)
  return null;
}

/** Quick check for the marker frontmatter without a full parse. */
export function isOmniboardMarkdown(raw: string): boolean {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return false;
  return new RegExp(`^${REQUIRED_FM_KEY}\\s*:\\s*${REQUIRED_FM_VAL}\\b`, "m").test(m[1]);
}
