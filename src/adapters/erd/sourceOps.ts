/**
 * Source-level operations on ERD (DBML-lite) raw text (Story 7-18).
 * Sync, never-throw.
 */

import type { ParseIssue } from "../../core/adapter";

const MAX_VALIDATE_SOURCE_LENGTH = 4 * 1024 * 1024; // 4 MB
const TABLE_RE = /^Table\s+\S+/m;
const TITLE_COMMENT_RE = /^\/\/\s*@diagram-title:\s*(.+)$/m;

export function validateErdSource(source: string): ParseIssue[] {
  if (!source || !source.trim()) {
    return [{ severity: "error", message: "Source rỗng" }];
  }
  if (source.length > MAX_VALIDATE_SOURCE_LENGTH) {
    return [{ severity: "error", message: "File quá lớn để kiểm tra nhanh (>4 MB)" }];
  }
  if (!TABLE_RE.test(source)) {
    return [{ severity: "error", message: "Thiếu khai báo Table" }];
  }
  return [];
}

export function getErdTitle(source: string): string | undefined {
  const m = source.match(TITLE_COMMENT_RE);
  if (!m) return undefined;
  const t = m[1].trim();
  return t === "" ? undefined : t;
}

/**
 * Set/replace/remove `// @diagram-title: <X>` comment line.
 * Inserted at the top of file when absent (before other content).
 */
export function setErdTitle(source: string, title: string): string {
  const hasTitle = TITLE_COMMENT_RE.test(source);

  if (title === "") {
    if (!hasTitle) return source;
    return source.replace(/^\/\/\s*@diagram-title:\s*.+\n?/m, "");
  }

  if (hasTitle) {
    return source.replace(TITLE_COMMENT_RE, () => `// @diagram-title: ${title}`);
  }

  // Insert at top of file.
  return `// @diagram-title: ${title}\n${source}`;
}
