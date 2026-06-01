import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('tests/screenshots', { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto('http://localhost:9876/harness/index.html');
await page.waitForFunction(() => (window).__ob);

const H = '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="d" targetNamespace="x">';

const scenarios = {
  'S5-boundary-multiinstance': H + `<bpmn:process id="P"><bpmn:userTask id="host" name="Review batch"><bpmn:multiInstanceLoopCharacteristics isSequential="false"/></bpmn:userTask><bpmn:boundaryEvent id="bnd" attachedToRef="host" cancelActivity="false"><bpmn:timerEventDefinition/></bpmn:boundaryEvent><bpmn:task id="comp" name="Refund" isForCompensation="true"/></bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P"><bpmndi:BPMNShape bpmnElement="host"><dc:Bounds x="200" y="120" width="160" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="bnd"><dc:Bounds x="320" y="180" width="36" height="36"/></bpmndi:BPMNShape><bpmndi:BPMNShape bpmnElement="comp"><dc:Bounds x="460" y="120" width="120" height="80"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`,
  'S6-event-triggers': H + `<bpmn:process id="P">` +
    ['message','timer','signal','error','escalation','compensate','conditional','link','cancel','terminate']
    .map((t,i)=>`<bpmn:intermediateThrowEvent id="ev${i}"><bpmn:${t}EventDefinition/></bpmn:intermediateThrowEvent>`).join('')
    + `</bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P">`
    + ['message','timer','signal','error','escalation','compensate','conditional','link','cancel','terminate']
    .map((t,i)=>`<bpmndi:BPMNShape bpmnElement="ev${i}"><dc:Bounds x="${80+i*70}" y="200" width="36" height="36"/></bpmndi:BPMNShape>`).join('')
    + `</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`,
};

for (const [name, xml] of Object.entries(scenarios)) {
  await page.evaluate(async (x) => { await (window).__import.bpmn(x); }, xml);
  await page.waitForTimeout(300);
  await page.locator('#host').screenshot({ path: `tests/screenshots/${name}.png` });
  console.log('saved', name);
}
await browser.close();
