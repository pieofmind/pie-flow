import type { CanvasModel } from "../../canvas/types";
import { lintExtra } from "./validatorExtra";

export interface BpmnIssue {
  id: string;
  severity: "error" | "warn";
  code: string;
  message: string;
  targetType: "node" | "edge";
  targetId: string;
}

function nodeById(model: CanvasModel): Map<string, CanvasModel["nodes"][number]> {
  return new Map(model.nodes.map((n) => [n.id, n]));
}

function incomingByNode(model: CanvasModel): Map<string, CanvasModel["edges"][number][]> {
  const map = new Map<string, CanvasModel["edges"][number][]>();
  for (const e of model.edges) {
    const arr = map.get(e.target) ?? [];
    arr.push(e);
    map.set(e.target, arr);
  }
  return map;
}

function outgoingByNode(model: CanvasModel): Map<string, CanvasModel["edges"][number][]> {
  const map = new Map<string, CanvasModel["edges"][number][]>();
  for (const e of model.edges) {
    const arr = map.get(e.source) ?? [];
    arr.push(e);
    map.set(e.source, arr);
  }
  return map;
}

function poolIdOf(node: CanvasModel["nodes"][number]): string | undefined {
  const src = (node.attrs?.__source as { poolId?: string } | undefined)?.poolId;
  if (src) return src;
  const own = node.attrs?.poolId;
  return typeof own === "string" ? own : undefined;
}

export function validateBpmnModel(model: CanvasModel): BpmnIssue[] {
  const issues: BpmnIssue[] = [];
  const byId = nodeById(model);
  const inMap = incomingByNode(model);
  const outMap = outgoingByNode(model);
  const mk = (
    severity: "error" | "warn",
    code: string,
    message: string,
    targetType: "node" | "edge",
    targetId: string,
  ): void => {
    issues.push({ id: `${code}:${targetType}:${targetId}`, severity, code, message, targetType, targetId });
  };

  for (const n of model.nodes) {
    const incoming = inMap.get(n.id) ?? [];
    const outgoing = outMap.get(n.id) ?? [];
    if (n.shape === "bpmn-event-start" && outgoing.length === 0) {
      mk("error", "START_NO_OUTGOING", "Start event should have at least one outgoing flow.", "node", n.id);
    }
    if (n.shape === "bpmn-event-end" && incoming.length === 0) {
      mk("error", "END_NO_INCOMING", "End event should have at least one incoming flow.", "node", n.id);
    }
    if (n.shape === "bpmn-subprocess" || n.shape === "bpmn-transaction" || n.shape === "bpmn-adhoc-subprocess" || n.shape === "bpmn-event-subprocess") {
      const hasChildren = model.nodes.some((child) => child.parentId === n.id);
      if (!hasChildren) mk("warn", "SUBPROCESS_EMPTY", "Subprocess has no child flow elements.", "node", n.id);
    }
    if (n.shape === "bpmn-event-intermediate") {
      const attached = n.attrs?.attachedTo;
      if (typeof attached === "string" && !byId.has(attached)) {
        mk("error", "BOUNDARY_NO_HOST", "Boundary event has attachedToRef that does not exist.", "node", n.id);
      }
    }
    if (n.shape === "bpmn-gateway-event") {
      for (const e of outgoing) {
        const tgt = byId.get(e.target);
        const isCatchEvent = tgt?.shape === "bpmn-event-intermediate" && tgt.attrs?.throwing !== true;
        if (!isCatchEvent) {
          mk("warn", "EVENT_GW_TARGET_NON_CATCH", "Event-based gateway should lead to a catching intermediate event.", "edge", e.id);
        }
      }
    }
    if (n.shape === "bpmn-gateway-x" || n.shape === "bpmn-gateway-inclusive") {
      if (outgoing.length > 1) {
        const hasDefault = outgoing.some((e) => e.attrs?.isDefault === true);
        const conditionalCount = outgoing.filter((e) => typeof e.attrs?.condition === "string" && e.attrs.condition.trim()).length;
        if (!hasDefault && conditionalCount < outgoing.length) {
          mk("warn", "GATEWAY_MISSING_DEFAULT_OR_CONDITIONS", "Gateway split should provide default flow or conditions on all branches.", "node", n.id);
        }
      }
    }
  }

  for (const e of model.edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) continue;
    if ((e.kind ?? "sequence") === "sequence") {
      const srcPool = poolIdOf(src);
      const tgtPool = poolIdOf(tgt);
      if (srcPool && tgtPool && srcPool !== tgtPool) {
        mk("error", "SEQUENCE_CROSSES_POOL", "SequenceFlow cannot cross pool boundaries; use MessageFlow.", "edge", e.id);
      }
    }
  }
  lintExtra(model, mk);
  return issues;
}
