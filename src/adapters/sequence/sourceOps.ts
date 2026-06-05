/**
 * Source-level operations on Mermaid sequenceDiagram raw text (Story 7-16).
 * Sync, never-throw, mirrors BPMN/Flowchart pattern.
 */

import type { ParseIssue } from "../../core/adapter";

const MAX_VALIDATE_SOURCE_LENGTH = 4 * 1024 * 1024; // 4 MB
const HEADER_RE = /^\s*sequenceDiagram\b/m;
const TITLE_LINE_RE = /^title\s+(.+)$/m;

export function validateSequenceSource(source: string): ParseIssue[] {
  if (!source || !source.trim()) {
    return [{ severity: "error", message: "Source rỗng" }];
  }
  if (source.length > MAX_VALIDATE_SOURCE_LENGTH) {
    return [{ severity: "error", message: "File quá lớn để kiểm tra nhanh (>4 MB)" }];
  }
  if (!HEADER_RE.test(source)) {
    return [{ severity: "error", message: "Thiếu `sequenceDiagram` header" }];
  }
  return [];
}

export function getSequenceTitle(source: string): string | undefined {
  const m = source.match(TITLE_LINE_RE);
  if (!m) return undefined;
  const t = m[1].trim();
  return t === "" ? undefined : t;
}

/**
 * Insert/replace/remove `title <X>` line right after the
 * `sequenceDiagram` header. Immutable.
 *
 * - Empty title: remove existing `title <X>` line (no-op if absent).
 * - Missing header: return source unchanged.
 */
export function setSequenceTitle(source: string, title: string): string {
  if (!HEADER_RE.test(source)) return source;

  const hasTitle = TITLE_LINE_RE.test(source);

  if (title === "") {
    if (!hasTitle) return source;
    // Remove the title line (and any single trailing newline).
    return source.replace(/^title\s+.+\n?/m, "");
  }

  if (hasTitle) {
    return source.replace(TITLE_LINE_RE, () => `title ${title}`);
  }

  // Insert title line right after the header.
  return source.replace(
    /^(\s*sequenceDiagram\b[^\n]*\n?)/m,
    (_m, head: string) => `${head}title ${title}\n`,
  );
}
