/** Map BPMN element local-name → Omniboard shape id.
 *  Đợt F (2026-06-01) — 1-to-1 so Camunda/Signavio imports keep task subtype +
 *  the right gateway. Events flow through bpmn-event-{start,intermediate,end}
 *  + extra.trigger (filled by import.ts from `eventDefinitions[0]`). */
export const BPMN_TO_SHAPE: Record<string, string> = {
  // Events — base position; importer overlays extra.trigger/throwing.
  startEvent: "bpmn-event-start",
  endEvent: "bpmn-event-end",
  intermediateThrowEvent: "bpmn-event-intermediate",
  intermediateCatchEvent: "bpmn-event-intermediate",
  boundaryEvent: "bpmn-event-intermediate",
  // Gateways
  exclusiveGateway: "bpmn-gateway-x",
  parallelGateway: "bpmn-gateway-parallel",
  inclusiveGateway: "bpmn-gateway-inclusive",
  eventBasedGateway: "bpmn-gateway-event",
  complexGateway: "bpmn-gateway-complex",
  // Tasks — subtype preserved
  task: "bpmn-task",
  userTask: "bpmn-task-user",
  serviceTask: "bpmn-task-service",
  scriptTask: "bpmn-task-script",
  sendTask: "bpmn-task-send",
  receiveTask: "bpmn-task-receive",
  manualTask: "bpmn-task-manual",
  businessRuleTask: "bpmn-task-rule",
  // Activities — sibling types
  callActivity: "bpmn-call-activity",
  subProcess: "bpmn-subprocess",
  transaction: "bpmn-transaction",
  adHocSubProcess: "bpmn-adhoc-subprocess",
  // Data artifacts
  dataObjectReference: "bpmn-data-object",
  dataStoreReference: "bpmn-data-store",
  dataInput: "bpmn-data-input",
  dataOutput: "bpmn-data-output",
  // Misc
  textAnnotation: "bpmn-annotation",
  group: "bpmn-group",
  participant: "bpmn-pool",
  lane: "bpmn-lane",
};

/** Reverse map: shape id → preferred BPMN element name. Đợt F. */
export const SHAPE_TO_BPMN: Record<string, string> = {
  // Events — unified Đợt A kinds
  "bpmn-event-start": "startEvent",
  "bpmn-event-intermediate": "intermediateThrowEvent",
  "bpmn-event-end": "endEvent",
  // Legacy kinds — accepted if migration shim is bypassed
  "bpmn-start": "startEvent",
  "bpmn-start-message": "startEvent",
  "bpmn-start-timer": "startEvent",
  "bpmn-intermediate": "intermediateThrowEvent",
  "bpmn-intermediate-message": "intermediateCatchEvent",
  "bpmn-intermediate-timer": "intermediateCatchEvent",
  "bpmn-end": "endEvent",
  "bpmn-end-message": "endEvent",
  "bpmn-end-terminate": "endEvent",
  // Gateways
  "bpmn-gateway-x": "exclusiveGateway",
  "bpmn-gateway-parallel": "parallelGateway",
  "bpmn-gateway-inclusive": "inclusiveGateway",
  "bpmn-gateway-event": "eventBasedGateway",
  "bpmn-gateway-complex": "complexGateway",
  // Tasks
  "bpmn-task": "task",
  "bpmn-task-user": "userTask",
  "bpmn-task-service": "serviceTask",
  "bpmn-task-script": "scriptTask",
  "bpmn-task-send": "sendTask",
  "bpmn-task-receive": "receiveTask",
  "bpmn-task-manual": "manualTask",
  "bpmn-task-rule": "businessRuleTask",
  // Activities
  "bpmn-subprocess": "subProcess",
  "bpmn-transaction": "transaction",
  "bpmn-event-subprocess": "subProcess", // export.ts sets triggeredByEvent=true
  "bpmn-adhoc-subprocess": "adHocSubProcess",
  "bpmn-call-activity": "callActivity",
  // Data artifacts
  "bpmn-data-object": "dataObjectReference",
  "bpmn-data-collection": "dataObjectReference", // export.ts sets isCollection=true
  "bpmn-data-input": "dataInput",
  "bpmn-data-output": "dataOutput",
  "bpmn-data-store": "dataStoreReference",
  // Misc
  "bpmn-annotation": "textAnnotation",
  "bpmn-group": "group",
  "bpmn-pool": "participant",
  "bpmn-lane": "lane",
};

/** Map BPMN `eventDefinitions[0]` local-name → extra.trigger. Đợt F. */
export const EVENT_DEF_TO_TRIGGER: Record<string, string> = {
  messageEventDefinition: "message",
  timerEventDefinition: "timer",
  signalEventDefinition: "signal",
  errorEventDefinition: "error",
  escalationEventDefinition: "escalation",
  compensateEventDefinition: "compensation",
  conditionalEventDefinition: "conditional",
  linkEventDefinition: "link",
  cancelEventDefinition: "cancel",
  terminateEventDefinition: "terminate",
};
/** Reverse — trigger → BPMN event-definition element name. */
export const TRIGGER_TO_EVENT_DEF: Record<string, string> = Object.fromEntries(
  Object.entries(EVENT_DEF_TO_TRIGGER).map(([k, v]) => [v, k])
);
