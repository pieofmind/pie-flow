/**
 * Source-level operations on raw BPMN 2.0 XML strings — sync, side-effect
 * free, suitable for use inside the (sync) DiagramAdapter contract.
 *
 * Async work (full bpmn-moddle parse, semantic validation) lives elsewhere
 * and is invoked inside Renderer/Editor components via `useEffect`. This
 * module provides only the lightweight string-level operations the adapter
 * needs synchronously: validate-source, get/set title.
 */

import type { ParseIssue } from "../../core/adapter";

// Handles quoted attr values containing `>` — e.g. name="A &gt; B"
const PROCESS_TAG_RE = /<bpmn:process\b(?:[^>"']|"[^"]*"|'[^']*')*>/;
// Negative lookbehind for `:` prevents matching namespaced attrs (e.g. camunda:name)
const NAME_ATTR_RE = /(?<![:\w])name="([^"]*)"/;
const DEFINITIONS_RE = /<bpmn:definitions\b/;
const MAX_VALIDATE_SOURCE_LENGTH = 4 * 1024 * 1024; // 4 MB in code units

/**
 * Sync XML well-formedness check + minimal BPMN shape check.
 * Returns [] when source looks like a usable BPMN document.
 * Never throws.
 */
export function validateBpmnSource(source: string): ParseIssue[] {
  if (!source || !source.trim()) {
    return [{ severity: "error", message: "Source rỗng" }];
  }
  // Guard against blocking the main thread with very large documents.
  if (source.length > MAX_VALIDATE_SOURCE_LENGTH) {
    return [{ severity: "error", message: "File quá lớn để kiểm tra nhanh (>4 MB)" }];
  }

  const issues: ParseIssue[] = [];

  // Browser DOMParser is sync. In Node/test env we degrade to a regex
  // sanity check (no DOMParser without jsdom). Either way we never throw.
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(source, "application/xml");
      const errEl = doc.getElementsByTagName("parsererror")[0];
      if (errEl) {
        const msg = errEl.textContent?.trim() || "XML không hợp lệ";
        issues.push({ severity: "error", message: `XML lỗi: ${msg.slice(0, 200)}` });
      }
    } catch {
      // Tolerate environments where DOMParser is partial; the regex check below still runs.
    }
  }

  if (!DEFINITIONS_RE.test(source)) {
    issues.push({
      severity: "error",
      message: "Thiếu <bpmn:definitions> root element",
    });
  }

  return issues;
}

/**
 * Extract `<bpmn:process name="...">` value if present.
 * Decodes basic XML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`).
 */
export function getBpmnTitle(source: string): string | undefined {
  const m = source.match(PROCESS_TAG_RE);
  if (!m) return undefined;
  const tag = m[0];
  const nameMatch = tag.match(NAME_ATTR_RE);
  if (!nameMatch) return undefined;
  return decodeXmlEntities(nameMatch[1]);
}

/**
 * Return a NEW XML string with the first `<bpmn:process>` tag's `name`
 * attribute set to `title`. Immutable.
 *
 * - Empty title (`""`): remove the `name` attribute if present.
 * - No process tag found: return source unchanged.
 */
export function setBpmnTitle(source: string, title: string): string {
  const m = source.match(PROCESS_TAG_RE);
  if (!m) return source;

  const tag = m[0];
  const tagStart = m.index ?? 0;
  const tagEnd = tagStart + tag.length;

  const escaped = encodeXmlAttr(title);
  const hasName = NAME_ATTR_RE.test(tag);

  let newTag: string;
  if (title === "") {
    newTag = hasName
      ? tag.replace(NAME_ATTR_RE, "").replace(/\s+>/, ">").replace(/\s+\/>/, "/>")
      : tag;
  } else if (hasName) {
    newTag = tag.replace(NAME_ATTR_RE, `name="${escaped}"`);
  } else {
    // Insert name="..." after `<bpmn:process` (before other attrs or closing).
    newTag = tag.replace(/^<bpmn:process\b/, `<bpmn:process name="${escaped}"`);
  }

  return source.slice(0, tagStart) + newTag + source.slice(tagEnd);
}

function encodeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
