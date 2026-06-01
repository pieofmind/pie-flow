import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const errs = [];
p.on('pageerror', e => errs.push('pe: '+e.message));
p.on('console', m => { if (m.type()==='error') errs.push('ce: '+m.text()); });
await p.goto('http://localhost:9876/tests/e2e-bpmn-phaseD.html?v=hl1');
await p.waitForFunction(() => window.__done === true, { timeout: 30000 });
const r = await p.evaluate(() => window.__results);
console.log(`${r.passed}/${r.total}`);
for (const x of r.results) console.log(`${x.ok?'✅':'❌'} ${x.name}  ${x.info||x.err||''}`);
if (errs.length) { console.log('--ERRORS--'); errs.slice(0,5).forEach(e=>console.log(e)); }
await b.close();
