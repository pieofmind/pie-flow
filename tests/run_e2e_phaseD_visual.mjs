import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport:{ width:1280, height:800 }})).newPage();
await p.goto('http://localhost:9876/harness/index.html');
await p.waitForFunction(() => window.__ob);
const H = '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" id="d" targetNamespace="x">';
const XML = H + `<bpmn:process id="P"><bpmn:startEvent id="s"/><bpmn:task id="t1" name="Review"><bpmn:documentation>Check the invoice amount.</bpmn:documentation></bpmn:task><bpmn:userTask id="t2" name="Approve"/><bpmn:endEvent id="e"/><bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="t1"/><bpmn:sequenceFlow id="f2" sourceRef="t1" targetRef="t2"/><bpmn:sequenceFlow id="f3" sourceRef="t2" targetRef="e"/></bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P"><bpmndi:BPMNShape bpmnElement="s"><dc:Bounds x="60" y="140" width="36" height="36"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="t1" bioc:fill="#bbdefb" bioc:stroke="#1565c0"><dc:Bounds x="160" y="120" width="160" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="t2" bioc:fill="#f3e5f5" bioc:stroke="#6a1b9a"><dc:Bounds x="400" y="120" width="160" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="e"><dc:Bounds x="640" y="140" width="36" height="36"/></bpmndi:BPMNShape><bpmndi:BPMNEdge bpmnElement="f1"><dc:Point x="96" y="158"/><dc:Point x="160" y="160"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge bpmnElement="f2"><dc:Point x="320" y="160"/><dc:Point x="400" y="160"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge bpmnElement="f3"><dc:Point x="560" y="160"/><dc:Point x="640" y="158"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
await p.evaluate(async (x) => { await window.__import.bpmn(x); }, XML);
await p.waitForTimeout(200);
await p.locator('#host').screenshot({ path: 'tests/screenshots/D-bioc-colors.png' });
// Now select t1 to show properties panel
await p.evaluate(() => {
  const cell = window.__ob.graph.getCellById('t1');
  window.__ob.graph.select(cell);
});
await p.waitForTimeout(200);
await p.locator('#host').screenshot({ path: 'tests/screenshots/D-props-panel.png' });
console.log('saved D-bioc-colors, D-props-panel');
await b.close();
