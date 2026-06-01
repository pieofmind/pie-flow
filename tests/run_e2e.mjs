import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: '+e.message));
page.on('console', m => { if (m.type()==='error') errors.push('console.error: '+m.text()); });
await page.goto('http://localhost:9876/tests/e2e-bpmn-scenarios.html?v=hl1');
await page.waitForFunction(() => (window).__done === true, { timeout: 30000 });
const r = await page.evaluate(() => window.__results);
console.log(`passed=${r.passed}/${r.total}`);
for (const x of r.results) console.log(`${x.ok?'✅':'❌'} ${x.name}  ${x.info||x.err||''}`);
if (errors.length) { console.log('--ERRORS--'); errors.forEach(e=>console.log(e)); }
await browser.close();
