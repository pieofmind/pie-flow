/**
 * Source-level operations on PlantUML Class diagram raw text (Story 7-19).
 */

import type { ParseIssue } from "../../core/adapter";

const MAX = 4 * 1024 * 1024;
const START_RE = /^@startuml\b/m;
const END_RE = /^@enduml\b/m;
const TITLE_RE = /^title\s+(.+)$/m;

export function validateUmlSource(source: string): ParseIssue[] {
  if (!source || !source.trim()) return [{ severity: "error", message: "Source rỗng" }];
  if (source.length > MAX) return [{ severity: "error", message: "File quá lớn để kiểm tra nhanh (>4 MB)" }];
  if (!START_RE.test(source) || !END_RE.test(source)) {
    return [{ severity: "error", message: "Thiếu cặp @startuml/@enduml" }];
  }
  return [];
}

export function getUmlTitle(source: string): string | undefined {
  const m = source.match(TITLE_RE);
  if (!m) return undefined;
  const t = m[1].trim();
  return t === "" ? undefined : t;
}

export function setUmlTitle(source: string, title: string): string {
  if (!START_RE.test(source)) return source;
  const hasTitle = TITLE_RE.test(source);

  if (title === "") {
    if (!hasTitle) return source;
    return source.replace(/^title\s+.+\n?/m, "");
  }
  if (hasTitle) {
    return source.replace(TITLE_RE, () => `title ${title}`);
  }
  return source.replace(/^(@startuml\b[^\n]*\n?)/m, (_m, head: string) => `${head}title ${title}\n`);
}
