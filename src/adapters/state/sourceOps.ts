/**
 * Source-level ops on Mermaid stateDiagram with optional YAML frontmatter (Story 7-19).
 *
 * Title strategy: prefer `title <X>` line inside the Mermaid block; if a
 * YAML frontmatter `title:` exists, also recognise that. Setter writes
 * `title <X>` inside the block.
 */

import type { ParseIssue } from "../../core/adapter";

const MAX = 4 * 1024 * 1024;
const HEADER_RE = /^\s*stateDiagram(?:-v[12])?\b/m;
const TITLE_LINE_RE = /^title\s+(.+)$/m;
const FRONTMATTER_TITLE_RE = /^---\s*\n([\s\S]*?\btitle:\s*(.+)[\s\S]*?)\n---/m;

export function validateStateSource(source: string): ParseIssue[] {
  if (!source || !source.trim()) return [{ severity: "error", message: "Source rỗng" }];
  if (source.length > MAX) return [{ severity: "error", message: "File quá lớn để kiểm tra nhanh (>4 MB)" }];
  if (!HEADER_RE.test(source)) return [{ severity: "error", message: "Thiếu `stateDiagram` header" }];
  return [];
}

export function getStateTitle(source: string): string | undefined {
  const inline = source.match(TITLE_LINE_RE);
  if (inline) {
    const t = inline[1].trim();
    if (t !== "") return t;
  }
  const fm = source.match(FRONTMATTER_TITLE_RE);
  if (fm) {
    const t = fm[2].trim().replace(/^["'](.*)["']$/, "$1");
    if (t !== "") return t;
  }
  return undefined;
}

/**
 * Write title via Mermaid block `title <X>` line (inserted right after the
 * stateDiagram header). Empty title removes the line.
 *
 * The inline `title` line is the single source of truth: any pre-existing
 * frontmatter `title:` is stripped so getStateTitle (which falls back to
 * frontmatter) can never resurface a stale value after setTitle("").
 */
export function setStateTitle(source: string, title: string): string {
  if (!HEADER_RE.test(source)) return source;
  const cleaned = stripFrontmatterTitle(source);
  const hasTitle = TITLE_LINE_RE.test(cleaned);

  if (title === "") {
    if (!hasTitle) return cleaned;
    return cleaned.replace(/^title\s+.+\n?/m, "");
  }
  if (hasTitle) {
    return cleaned.replace(TITLE_LINE_RE, () => `title ${title}`);
  }
  return cleaned.replace(
    /^(\s*stateDiagram(?:-v[12])?\b[^\n]*\n?)/m,
    (_m, head: string) => `${head}title ${title}\n`,
  );
}

/** Remove a `title:` line inside the leading YAML frontmatter block, if present. */
function stripFrontmatterTitle(source: string): string {
  const fm = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return source;
  const body = fm[1];
  if (!/(^|\n)title:\s*.+/.test(body)) return source;
  const newBody = body.replace(/(^|\n)title:\s*.+(?=\n|$)/, "").replace(/^\n/, "");
  if (newBody.trim() === "") {
    // Frontmatter held only the title — drop the whole block + its trailing newline.
    return source.replace(/^---\s*\n[\s\S]*?\n---\n?/, "");
  }
  return source.replace(/^---\s*\n[\s\S]*?\n---/, () => `---\n${newBody}\n---`);
}
