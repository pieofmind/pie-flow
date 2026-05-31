/** Map BPMN element local-name → Omniboard shape id. */
export const BPMN_TO_SHAPE: Record<string, string> = {
  startEvent: "bpmn-start",
  endEvent: "bpmn-end",
  intermediateThrowEvent: "bpmn-intermediate",
  intermediateCatchEvent: "bpmn-intermediate",
  boundaryEvent: "bpmn-intermediate",
  exclusiveGateway: "bpmn-gateway-x",
  parallelGateway: "bpmn-gateway-parallel",
  inclusiveGateway: "bpmn-gateway-x",
  eventBasedGateway: "bpmn-gateway-x",
  task: "bpmn-task",
  userTask: "bpmn-task-user",
  serviceTask: "bpmn-task-service",
  scriptTask: "bpmn-task-service",
  sendTask: "bpmn-task-service",
  receiveTask: "bpmn-task-service",
  manualTask: "bpmn-task",
  businessRuleTask: "bpmn-task-service",
  callActivity: "bpmn-task",
  subProcess: "bpmn-task",
};

/** Reverse map for export: shape id → preferred BPMN element name. */
export const SHAPE_TO_BPMN: Record<string, string> = {
  "bpmn-start": "startEvent",
  "bpmn-end": "endEvent",
  "bpmn-intermediate": "intermediateThrowEvent",
  "bpmn-gateway-x": "exclusiveGateway",
  "bpmn-gateway-parallel": "parallelGateway",
  "bpmn-task": "task",
  "bpmn-task-user": "userTask",
  "bpmn-task-service": "serviceTask",
};
