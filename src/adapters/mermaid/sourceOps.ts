/**
 * Source-level ops on Mermaid-dx raw text (Story 7-19).
 *
 * Title support via Mermaid v10+ frontmatter:
 *   ---
 *   title: My Diagram
 *   ---
 *   flowchart LR
 *     A --> B
 */

import type { ParseIssue } from "../../core/adapter";

const MAX = 4 * 1024 * 1024;
// Recognised Mermaid headers (broad list — enough to validate presence).
const HEADER_RE = /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v[12])?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|requirementDiagram|sankey-beta|c4Context|c4Container|c4Component|c4Deployment|xychart-beta|block-beta|quadrantChart)\b/m;
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;
const FRONTMATTER_TITLE_RE = /(^|\n)title:\s*(.+?)(?=\n|$)/;

export function validateMermaidSource(source: string): ParseIssue[] {
  if (!source || !source.trim()) return [{ severity: "error", message: "Source rỗng" }];
  if (source.length > MAX) return [{ severity: "error", message: "File quá lớn để kiểm tra nhanh (>4 MB)" }];
  if (!HEADER_RE.test(source)) return [{ severity: "error", message: "Thiếu header Mermaid (flowchart/graph/sequenceDiagram/...)" }];
  return [];
}

export function getMermaidTitle(source: string): string | undefined {
  const fm = source.match(FRONTMATTER_RE);
  if (!fm) return undefined;
  const inside = fm[1];
  const t = inside.match(FRONTMATTER_TITLE_RE);
  if (!t) return undefined;
  let v = t[2].trim();
  // Strip surrounding quotes if present.
  v = v.replace(/^["'](.*)["']$/, "$1");
  return v === "" ? undefined : v;
}

/**
 * Write title into a `---\ntitle: X\n---` frontmatter block at the top of the source.
 *
 * - No frontmatter + non-empty title: prepend new frontmatter.
 * - Frontmatter exists + has title: replace the title value.
 * - Frontmatter exists + no title: insert `title: X` line.
 * - Empty title + frontmatter has title: remove just the title line.
 * - Empty title + no frontmatter: no-op.
 */
export function setMermaidTitle(source: string, title: string): string {
  const fmMatch = source.match(FRONTMATTER_RE);

  if (!fmMatch) {
    if (title === "") return source;
    const quoted = needsQuoting(title) ? `'${title.replace(/'/g, "''")}'` : title;
    return `---\ntitle: ${quoted}\n---\n${source}`;
  }

  const fmBody = fmMatch[1];
  const hasTitle = FRONTMATTER_TITLE_RE.test(fmBody);

  let newBody: string;
  if (title === "") {
    if (!hasTitle) return source;
    // Remove the title line (and its line separator), then any orphaned leading newline.
    newBody = fmBody.replace(/(^|\n)title:\s*.+(?=\n|$)/, "").replace(/^\n/, "");
  } else {
    const quoted = needsQuoting(title) ? `'${title.replace(/'/g, "''")}'` : title;
    if (hasTitle) {
      newBody = fmBody.replace(FRONTMATTER_TITLE_RE, (_m, lead: string) => `${lead}title: ${quoted}`);
    } else {
      newBody = fmBody.trim() === "" ? `title: ${quoted}` : `${fmBody}\ntitle: ${quoted}`;
    }
  }

  // Use a function replacement so `$` chars in newBody are never interpreted as
  // special replacement patterns. On full removal, also strip the now-leading newline.
  if (newBody.trim() === "") {
    return source.replace(FRONTMATTER_RE, "").replace(/^\n/, "");
  }
  return source.replace(FRONTMATTER_RE, () => `---\n${newBody}\n---`);
}

function needsQuoting(s: string): boolean {
  return /[:#&*!|>'"%@`{}\[\]]|^\s|\s$/.test(s);
}
