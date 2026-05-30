import { makeStubAdapter } from "../makeStubAdapter";

export const bpmnAdapter = makeStubAdapter({
  id: "bpmn",
  displayName: "BPMN 2.0",
  codeBlockLanguage: "bpmn",
  icon: "git-fork",
  exportFormats: ["svg", "png", "pdf"],
  template: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start"/>
  </bpmn:process>
</bpmn:definitions>`,
});
