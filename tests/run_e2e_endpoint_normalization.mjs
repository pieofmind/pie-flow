import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('tests/screenshots', { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:9876/harness/index.html');
await page.waitForFunction(() => window.__ob);

const result = await page.evaluate(() => {
  const ob = window.__ob;
  const graph = ob.graph;
  const edgeAttrs = { line: { stroke: '#9c8b7e', strokeWidth: 1.8, targetMarker: { name: 'block', width: 11, height: 8 } } };

  ob.loadModel({
    nodes: [
      { id: 'task', shape: 'bpmn-task', x: 180, y: 80, width: 180, height: 100, label: 'Task' },
      { id: 'end', shape: 'bpmn-event-end', x: 280, y: 280, width: 48, height: 48, label: '' },
    ],
    edges: [],
  });

  const edge = graph.addEdge({
    id: 'e-connect',
    source: { cell: 'task', port: 'bottom', connectionPoint: { name: 'anchor' } },
    target: { cell: 'end', port: 'left-2', connectionPoint: { name: 'anchor' } },
    router: { name: 'orth', args: { padding: 16 } },
    connector: { name: 'rounded', args: { radius: 6 } },
    attrs: edgeAttrs,
  });
  graph.trigger('edge:connected', {
    edge,
    isNew: true,
    type: 'target',
    currentCell: graph.getCellById('end'),
    currentPort: 'left-2',
  });
  const afterConnect = edge.getTarget().port ?? null;

  edge.setTarget({ cell: 'end', port: 'right-1', connectionPoint: { name: 'anchor' } });
  graph.trigger('edge:connected', {
    edge,
    isNew: false,
    type: 'target',
    currentCell: graph.getCellById('end'),
    currentPort: 'right-1',
  });
  const afterReconnect = edge.getTarget().port ?? null;

  const sourceEdge = graph.addEdge({
    id: 'e-source',
    source: { cell: 'end', port: 'top-1', connectionPoint: { name: 'anchor' } },
    target: { cell: 'task', port: 'bottom', connectionPoint: { name: 'anchor' } },
    router: { name: 'orth', args: { padding: 16 } },
    connector: { name: 'rounded', args: { radius: 6 } },
    attrs: edgeAttrs,
  });
  graph.trigger('edge:connected', {
    edge: sourceEdge,
    isNew: true,
    type: 'source',
    currentCell: graph.getCellById('end'),
    currentPort: 'top-1',
  });
  const sourceNormalized = sourceEdge.getSource().port ?? null;

  ob.loadModel({
    nodes: [
      { id: 'task-a', shape: 'bpmn-task', x: 560, y: 80, width: 180, height: 100, label: 'Task A' },
      { id: 'task-b', shape: 'bpmn-task', x: 860, y: 80, width: 180, height: 100, label: 'Task B' },
    ],
    edges: [],
  });
  const plainEdge = graph.addEdge({
    id: 'e-plain',
    source: { cell: 'task-a', port: 'right-2', connectionPoint: { name: 'anchor' } },
    target: { cell: 'task-b', port: 'left-1', connectionPoint: { name: 'anchor' } },
    router: { name: 'orth', args: { padding: 16 } },
    connector: { name: 'rounded', args: { radius: 6 } },
    attrs: edgeAttrs,
  });
  graph.trigger('edge:connected', {
    edge: plainEdge,
    isNew: true,
    type: 'target',
    currentCell: graph.getCellById('task-b'),
    currentPort: 'left-1',
  });
  const plainTargetPort = plainEdge.getTarget().port ?? null;

  ob.loadModel({
    nodes: [
      { id: 'task', shape: 'bpmn-task', x: 560, y: 120, width: 180, height: 100, label: 'Task 2' },
      { id: 'end', shape: 'bpmn-event-end', x: 820, y: 220, width: 48, height: 48, label: '' },
    ],
    edges: [
      { id: 'e-legacy', source: 'task', sourcePort: 'right', target: 'end', targetPort: 'top-2' },
    ],
  });
  const legacy = graph.getCellById('e-legacy');
  const legacyPort = legacy?.isEdge?.() ? legacy.getTarget().port ?? null : null;

  return { afterConnect, afterReconnect, sourceNormalized, plainTargetPort, legacyPort };
});

await page.waitForTimeout(200);
await page.locator('#host').screenshot({ path: 'tests/screenshots/endpoint-normalization.png' });
await browser.close();

console.log(result);

const pass =
  result.afterConnect === 'left' &&
  result.afterReconnect === 'right' &&
  result.sourceNormalized === 'top' &&
  result.plainTargetPort === 'left-1' &&
  result.legacyPort === 'top';

if (!pass) {
  throw new Error(`Endpoint normalization failed: ${JSON.stringify(result)}`);
}
