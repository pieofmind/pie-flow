/**
 * Source-level operations on DBML raw text (Story 7-17).
 * Sync, never-throw, mirrors BPMN/Flowchart pattern.
 */

import type { ParseIssue } from "../../core/adapter";

const MAX_VALIDATE_SOURCE_LENGTH = 4 * 1024 * 1024; // 4 MB
const TABLE_RE = /^Table\s+\S+/m;
// Name capture handles both bare identifiers and double-quoted names (which may
// contain spaces), matching what setDbmlTitle writes when a title needs quoting.
const PROJECT_TAG_RE = /^Project\s+("[^"]*"|\S+)\s*\{[^}]*\}/m;

export function validateDbmlSource(source: string): ParseIssue[] {
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

export function getDbmlTitle(source: string): string | undefined {
  const m = source.match(PROJECT_TAG_RE);
  if (!m) return undefined;
  let name = m[1].trim();
  // Strip surrounding double quotes (the form setDbmlTitle writes for names
  // containing spaces/special chars).
  if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
    name = name.slice(1, -1);
  }
  return name === "" ? undefined : name;
}

/**
 * Set the DBML Project name. DBML identifier syntax does not allow spaces
 * or quote characters — when the title contains them we wrap in double
 * quotes (DBML supports `Project "with spaces" { ... }`).
 *
 * - Empty title: NO-OP (DBML does not allow empty Project name).
 * - No Project block + non-empty title: insert at top.
 */
export function setDbmlTitle(source: string, title: string): string {
  if (title === "") return source;

  // DBML double-quoted identifiers have no escape sequence for an embedded `"`,
  // so strip any double quotes from the title before wrapping.
  const safeTitle = title.replace(/"/g, "");
  const escaped = needsQuoting(safeTitle) ? `"${safeTitle}"` : safeTitle;
  const hasProject = PROJECT_TAG_RE.test(source);

  if (hasProject) {
    // Replace only the `Project <name>` prefix; match bare or quoted name.
    return source.replace(PROJECT_TAG_RE, (full) =>
      full.replace(/^Project\s+("[^"]*"|\S+)/, () => `Project ${escaped}`),
    );
  }

  return `Project ${escaped} {\n  database_type: 'omniboard'\n}\n\n${source}`;
}

function needsQuoting(s: string): boolean {
  return /[\s'{}()\[\]]/.test(s);
}
