import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:9876/harness/index.html');
await page.waitForFunction(() => window.__ob);

const H = '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="defs" targetNamespace="x">';

const BLACKBOX = H + `<bpmn:collaboration id="Collab"><bpmn:participant id="P_Blackbox" name="External Vendor"/></bpmn:collaboration><bpmndi:BPMNDiagram id="D1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collab"><bpmndi:BPMNShape id="S_P" bpmnElement="P_Blackbox"><dc:Bounds x="140" y="120" width="520" height="220"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

const VERTICAL = H + `<bpmn:collaboration id="CollabV"><bpmn:participant id="P_V" name="Ops Pool"/></bpmn:collaboration><bpmndi:BPMNDiagram id="D2"><bpmndi:BPMNPlane id="Plane_2" bpmnElement="CollabV"><bpmndi:BPMNShape id="S_PV" bpmnElement="P_V" isHorizontal="false"><dc:Bounds x="180" y="80" width="300" height="520"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

for (const [name, xml] of [['F-blackbox-pool', BLACKBOX], ['F-vertical-pool', VERTICAL]]) {
  await page.evaluate(async (x) => { await window.__import.bpmn(x); }, xml);
  await page.waitForTimeout(250);
  await page.locator('#host').screenshot({ path: `tests/screenshots/${name}.png` });
  console.log('saved', name);
}

await browser.close();
