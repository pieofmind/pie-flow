import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('tests/screenshots', { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto('http://localhost:9876/harness/index.html');
await page.waitForFunction(() => (window).__ob);

const HEADER = '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="d" targetNamespace="x">';

const scenarios = {
  'S1-linear': HEADER + `<bpmn:process id="P"><bpmn:startEvent id="s"/><bpmn:task id="t" name="Process"/><bpmn:endEvent id="e"/><bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="t"/><bpmn:sequenceFlow id="f2" sourceRef="t" targetRef="e"/></bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P"><bpmndi:BPMNShape bpmnElement="s"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="t"><dc:Bounds x="220" y="92" width="100" height="52"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="e"><dc:Bounds x="380" y="100" width="36" height="36"/></bpmndi:BPMNShape><bpmndi:BPMNEdge bpmnElement="f1"><di:waypoint x="136" y="118"/><di:waypoint x="220" y="118"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge bpmnElement="f2"><di:waypoint x="320" y="118"/><di:waypoint x="380" y="118"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`,
  'S2-gateway-cond-default': HEADER + `<bpmn:process id="P"><bpmn:exclusiveGateway id="g" default="fd" name="ok?"/><bpmn:task id="ta" name="Yes"/><bpmn:task id="tb" name="No"/><bpmn:sequenceFlow id="fc" sourceRef="g" targetRef="ta" name="\${x}"><bpmn:conditionExpression xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="bpmn:tFormalExpression">\${ok}</bpmn:conditionExpression></bpmn:sequenceFlow><bpmn:sequenceFlow id="fd" sourceRef="g" targetRef="tb"/></bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P"><bpmndi:BPMNShape bpmnElement="g"><dc:Bounds x="120" y="120" width="50" height="50"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="ta"><dc:Bounds x="260" y="60" width="100" height="60"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="tb"><dc:Bounds x="260" y="180" width="100" height="60"/></bpmndi:BPMNShape><bpmndi:BPMNEdge bpmnElement="fc"><di:waypoint x="170" y="135"/><di:waypoint x="260" y="90"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge bpmnElement="fd"><di:waypoint x="170" y="155"/><di:waypoint x="260" y="210"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`,
  'S3-message-pools': HEADER + `<bpmn:collaboration id="C"><bpmn:participant id="pA" name="Customer" processRef="PA"/><bpmn:participant id="pB" name="Vendor" processRef="PB"/><bpmn:messageFlow id="mf" name="Order" sourceRef="tA" targetRef="tB"/></bpmn:collaboration><bpmn:process id="PA"><bpmn:task id="tA" name="Send"/></bpmn:process><bpmn:process id="PB"><bpmn:task id="tB" name="Receive"/></bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="C"><bpmndi:BPMNShape bpmnElement="pA" isHorizontal="true"><dc:Bounds x="40" y="40" width="700" height="140"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="pB" isHorizontal="true"><dc:Bounds x="40" y="220" width="700" height="140"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="tA"><dc:Bounds x="180" y="80" width="100" height="60"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="tB"><dc:Bounds x="180" y="270" width="100" height="60"/></bpmndi:BPMNShape><bpmndi:BPMNEdge bpmnElement="mf"><di:waypoint x="230" y="140"/><di:waypoint x="230" y="270"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`,
  'S4-annotation': HEADER + `<bpmn:process id="P"><bpmn:task id="t" name="Pay invoice"/><bpmn:textAnnotation id="an"><bpmn:text>Manual review required</bpmn:text></bpmn:textAnnotation><bpmn:association id="as" sourceRef="an" targetRef="t" associationDirection="One"/></bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P"><bpmndi:BPMNShape bpmnElement="t"><dc:Bounds x="300" y="160" width="120" height="60"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="an"><dc:Bounds x="80" y="80" width="180" height="60"/></bpmndi:BPMNShape><bpmndi:BPMNEdge bpmnElement="as"><di:waypoint x="170" y="140"/><di:waypoint x="300" y="190"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`,
};

for (const [name, xml] of Object.entries(scenarios)) {
  await page.evaluate(async (x) => { await (window).__import.bpmn(x); }, xml);
  await page.waitForTimeout(200);
  await page.locator('#host').screenshot({ path: `tests/screenshots/${name}.png` });
  console.log('saved', name);
}
await browser.close();
