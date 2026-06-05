/**
 * Source-level ops on Markdown-heading-tree mindmap source (Story 7-19).
 * Central topic = first H1 (`# <X>`).
 */

import type { ParseIssue } from "../../core/adapter";

const MAX = 4 * 1024 * 1024;
// `[^\S\n]+` = horizontal whitespace only — prevents `\s+` from crossing a
// newline and capturing the next heading line as the title.
const H1_RE = /^#[^\S\n]+(.+)$/m;

export function validateMindmapSource(source: string): ParseIssue[] {
  if (!source || !source.trim()) return [{ severity: "error", message: "Source rỗng" }];
  if (source.length > MAX) return [{ severity: "error", message: "File quá lớn để kiểm tra nhanh (>4 MB)" }];
  if (!H1_RE.test(source)) return [{ severity: "error", message: "Thiếu chủ đề trung tâm (`# ...`)" }];
  return [];
}

export function getMindmapTitle(source: string): string | undefined {
  const m = source.match(H1_RE);
  if (!m) return undefined;
  const t = m[1].trim();
  return t === "" ? undefined : t;
}

/**
 * Replace the first H1 line. If absent and title is non-empty, prepend a new H1.
 * Empty title with existing H1 = remove the H1 line entirely (a `# ` stub would
 * leave a structurally broken root that getTitle re-reads as the next heading).
 * Empty title with no H1 = source unchanged.
 */
export function setMindmapTitle(source: string, title: string): string {
  const hasH1 = H1_RE.test(source);

  if (title === "") {
    if (!hasH1) return source;
    return source.replace(/^#[^\S\n]+.+\n?/m, "");
  }
  if (hasH1) {
    return source.replace(H1_RE, () => `# ${title}`);
  }
  return `# ${title}\n${source}`;
}
