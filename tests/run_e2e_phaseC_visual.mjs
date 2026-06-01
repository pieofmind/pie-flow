import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }})).newPage();
await p.goto('http://localhost:9876/harness/index.html');
await p.waitForFunction(() => window.__ob);
const H = '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="d" targetNamespace="x">';
const ADHOC = H + `<bpmn:process id="P"><bpmn:adHocSubProcess id="ah" name="Brainstorm ideas"/></bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P"><bpmndi:BPMNShape bpmnElement="ah" isExpanded="true"><dc:Bounds x="140" y="120" width="320" height="180"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
const NESTED = H + `<bpmn:process id="P"><bpmn:task id="outer" name="Outside"/><bpmn:subProcess id="sp1" name="Order Process"><bpmn:task id="inner1" name="Validate"/><bpmn:subProcess id="sp2" name="Payment"><bpmn:task id="inner2" name="Charge card"/></bpmn:subProcess></bpmn:subProcess></bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P"><bpmndi:BPMNShape bpmnElement="outer"><dc:Bounds x="60" y="80" width="120" height="60"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="sp1" isExpanded="true"><dc:Bounds x="220" y="60" width="500" height="240"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="inner1"><dc:Bounds x="260" y="120" width="120" height="60"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="sp2" isExpanded="true"><dc:Bounds x="440" y="100" width="260" height="160"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="inner2"><dc:Bounds x="490" y="150" width="160" height="60"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
for (const [name, xml] of [['C-adhoc-subprocess', ADHOC], ['C-nested-frame-fix', NESTED]]) {
  await p.evaluate(async (x) => { await window.__import.bpmn(x); }, xml);
  await p.waitForTimeout(300);
  await p.locator('#host').screenshot({ path: `tests/screenshots/${name}.png` });
  console.log('saved', name);
}
await b.close();
