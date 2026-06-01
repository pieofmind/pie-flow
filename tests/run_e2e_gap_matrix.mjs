import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push('pe: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('ce: ' + m.text()); });

await page.goto('http://localhost:9876/tests/e2e-bpmn-gap-matrix.html?v=hl1');
await page.waitForFunction(() => window.__done === true, { timeout: 30000 });
const r = await page.evaluate(() => window.__results);

console.log(`implemented: passed=${r.passed}/${r.total} failed=${r.failed} skipped=${r.skipped}`);
console.log(`not-yet-supported probes: supported=${r.nysObservedSupported}/${r.nysTotal} unsupported=${r.nysObservedUnsupported}`);
if (r.failedAt) console.log(`failedAt=${r.failedAt}`);
for (const x of r.results) {
  if (x.skipped) console.log(`⏭️ ${x.id}  skipped`);
  else if (x.level === 'not-yet-supported') console.log(`ℹ️ ${x.id}  observed=${x.probe}`);
  else console.log(`${x.ok ? '✅' : '❌'} ${x.id}  ${x.err || ''}`);
}
if (errs.length) {
  console.log('--ERRORS--');
  errs.slice(0, 10).forEach(e => console.log(e));
}

await browser.close();
if (r.failed > 0) process.exit(1);
