import type { CanvasModel } from "../../canvas/types";
import type { SourceMeta } from "../types";
import { SHAPE_TO_BPMN } from "./shapes";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;");
}

function nodeBpmnTag(shape: string): string {
  return SHAPE_TO_BPMN[shape] ?? "task";
}

/**
 * Best-effort BPMN export. If a source-meta with the original XML is present,
 * we patch positions and add new elements; otherwise we emit a minimal but
 * valid BPMN 2.0 document.
 */
export function exportBpmn(model: CanvasModel, meta?: SourceMeta | null): string {
  // No source meta → emit minimal BPMN from scratch.
  if (!meta || meta.format !== "bpmn") return emitMinimal(model);
  const raw = String((meta.payload as { raw?: string })?.raw ?? "");
  if (!raw) return emitMinimal(model);

  // Patch DI positions for known nodes; append new BPMN elements + DI shapes
  // for nodes the source didn't contain. We do this via string surgery so we
  // don't have to round-trip the whole tree.
  let out = raw;

  for (const n of model.nodes) {
    const srcId = (n.attrs as { __source?: { sourceId?: string } } | undefined)?.__source?.sourceId;
    if (srcId) {
      // Replace existing dc:Bounds inside the shape entry for this element.
      const shapeRe = new RegExp(
        `(<[^>]*BPMNShape[^>]*bpmnElement="${escapeRegex(srcId)}"[^>]*>[\\s\\S]*?<[^>]*Bounds[^/>]*?)x="[^"]*"([^/>]*?)y="[^"]*"([^/>]*?)width="[^"]*"([^/>]*?)height="[^"]*"`,
        "m"
      );
      out = out.replace(
        shapeRe,
        (_m, p1, p2, p3, p4) => `${p1}x="${n.x}"${p2}y="${n.y}"${p3}width="${n.width}"${p4}height="${n.height}"`
      );
      continue;
    }
    // New node — inject element + DI shape just before </process> / </bpmndi:BPMNPlane>.
    const tag = nodeBpmnTag(n.shape);
    const elem = `    <${tag} id="${escapeXml(n.id)}" name="${escapeXml(n.label || "")}" />\n`;
    out = out.replace(/(<\/[a-zA-Z]*:?process>)/, `${elem}$1`);
    const di =
      `      <bpmndi:BPMNShape id="${escapeXml(n.id)}_di" bpmnElement="${escapeXml(n.id)}">\n` +
      `        <dc:Bounds x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" />\n` +
      `      </bpmndi:BPMNShape>\n`;
    out = out.replace(/(<\/[a-zA-Z]*:?BPMNPlane>)/, `${di}$1`);
  }

  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function emitMinimal(model: CanvasModel): string {
  const elems = model.nodes.map((n) => {
    const tag = nodeBpmnTag(n.shape);
    return `    <${tag} id="${escapeXml(n.id)}" name="${escapeXml(n.label || "")}" />`;
  });
  const flows = model.edges.map((e) =>
    `    <sequenceFlow id="${escapeXml(e.id)}" sourceRef="${escapeXml(e.source)}" targetRef="${escapeXml(e.target)}"${e.label ? ` name="${escapeXml(e.label)}"` : ""} />`
  );
  const shapes = model.nodes.map(
    (n) =>
      `      <bpmndi:BPMNShape id="${escapeXml(n.id)}_di" bpmnElement="${escapeXml(n.id)}">\n` +
      `        <dc:Bounds x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" />\n` +
      `      </bpmndi:BPMNShape>`
  );
  const diEdges = model.edges.map((e) => {
    const src = model.nodes.find((n) => n.id === e.source);
    const tgt = model.nodes.find((n) => n.id === e.target);
    if (!src || !tgt) return "";
    const sx = src.x + src.width / 2, sy = src.y + src.height / 2;
    const tx = tgt.x + tgt.width / 2, ty = tgt.y + tgt.height / 2;
    return (
      `      <bpmndi:BPMNEdge id="${escapeXml(e.id)}_di" bpmnElement="${escapeXml(e.id)}">\n` +
      `        <di:waypoint x="${sx}" y="${sy}" />\n` +
      `        <di:waypoint x="${tx}" y="${ty}" />\n` +
      `      </bpmndi:BPMNEdge>`
    );
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_Export" targetNamespace="http://omniboard.local/bpmn">
  <process id="Process_Export" isExecutable="false">
${elems.join("\n")}
${flows.join("\n")}
  </process>
  <bpmndi:BPMNDiagram id="Diagram_Export">
    <bpmndi:BPMNPlane id="Plane_Export" bpmnElement="Process_Export">
${shapes.join("\n")}
${diEdges.join("\n")}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
`;
}
