// Screenshot every general diagram (and each pipeline step) of a paper: npm run shots -- <paperId> [outDir] [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [id, out = 'scratch/shots', base = 'http://localhost:5173'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}/#/p/${id}`); await page.waitForSelector('.toc .ti');
const n = await page.locator('.toc .grp').first().locator('.ti').count();
for (let i = 0; i < n; i++) {
  await page.locator('.toc .grp').first().locator('.ti').nth(i).click(); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${id}-g${i + 1}.png` });
  const steps = await page.locator('.stage .node.sel').count();
  if (i < n - 1 && steps && await page.locator('.stage .s-mut.f-sheet').count()) {
    for (let s = 1; s < Math.min(steps, 7); s++) { await page.locator('.stage .node.sel').nth(s).click(); await page.waitForTimeout(250); await page.locator('.stagewrap').screenshot({ path: `${out}/${id}-g${i + 1}-step${s + 1}.png` }); }
  }
}
await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.toc .grp').first().locator('.ti').nth(0).click(); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/${id}-mobile.png`, fullPage: false });
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
await browser.close();
