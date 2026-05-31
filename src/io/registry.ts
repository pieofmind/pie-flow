import type { FormatDescriptor, FormatId } from "./types";
import { importBpmn } from "./bpmn/import";
import { exportBpmn } from "./bpmn/export";
import { importDbml } from "./dbml/import";
import { exportDbml } from "./dbml/export";

export const FORMATS: FormatDescriptor[] = [
  { id: "bpmn", displayName: "BPMN 2.0", extensions: ["bpmn", "bpmn2", "xml"], importer: importBpmn, exporter: exportBpmn },
  { id: "dbml", displayName: "DBML (dbdiagram.io)", extensions: ["dbml"], importer: importDbml, exporter: exportDbml },
];

export function findByExtension(filename: string): FormatDescriptor | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  // For `.xml`, only treat as BPMN if it has BPMN-namespace markers (caller checks).
  return FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
}

export function findById(id: FormatId): FormatDescriptor | null {
  return FORMATS.find((f) => f.id === id) ?? null;
}
