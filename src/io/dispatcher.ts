import type { ImportResult } from "./types";
import { FORMATS, findByExtension } from "./registry";

/** Detect format from raw content if extension didn't pin it. */
function detectByContent(raw: string): typeof FORMATS[number] | null {
  const head = raw.slice(0, 4096);
  if (/<\?xml/i.test(head) && /bpmn/i.test(head)) return FORMATS.find((f) => f.id === "bpmn") ?? null;
  if (/^\s*(?:\/\/|\/\*|Project\s|Table\s|Ref\s*:)/m.test(head)) return FORMATS.find((f) => f.id === "dbml") ?? null;
  return null;
}

export async function importFromFile(filename: string, raw: string): Promise<ImportResult> {
  const byExt = findByExtension(filename);
  const fmt = byExt ?? detectByContent(raw);
  if (!fmt) throw new Error(`Không nhận diện được định dạng của "${filename}".`);
  return await fmt.importer(raw);
}
