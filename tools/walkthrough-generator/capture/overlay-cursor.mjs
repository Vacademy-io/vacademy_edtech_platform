/**
 * overlay-cursor — QA helper. Stamps the ghost cursor onto each REAL frame at the
 * exact coordinate recorded in the manifest, so you can SEE whether the cursor lands
 * on the right control (the .html player positions the cursor the same way, just
 * scaled). Output: render-check/<slug>/cursor-NN.png — one composited frame per step.
 *
 * Pure rendering: loads each PNG at natural 1440x900 and draws the cursor over it in
 * a headless page. No app, no network, no institute touched.
 *
 * Usage: node capture/overlay-cursor.mjs <flow-slug-dir>
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_ROOT } from './env.mjs';

const dirName = process.argv[2];
if (!dirName) { console.error('usage: node capture/overlay-cursor.mjs <flow-slug-dir>'); process.exit(1); }
const flowDir = join(TOOL_ROOT, 'screenshots', 'flows', dirName);
if (!existsSync(join(flowDir, 'manifest.json'))) { console.error('no manifest in', flowDir); process.exit(1); }
const man = JSON.parse(readFileSync(join(flowDir, 'manifest.json'), 'utf8'));
const VW = man.viewport.width, VH = man.viewport.height;
const outDir = join(TOOL_ROOT, 'render-check', dirName);
mkdirSync(outDir, { recursive: true });
const pad = (n) => String(n).padStart(2, '0');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });

for (let i = 0; i < man.steps.length; i++) {
    const s = man.steps[i];
    const b64 = readFileSync(join(flowDir, s.img)).toString('base64');
    const c = s.cursor;
    const overlay = c ? `
      <div style="position:absolute;left:${c.x}px;top:${c.y}px;width:18px;height:18px;background:rgba(245,167,0,.45);
        border:2px solid #C77D00;border-radius:50%;transform:translate(-50%,-50%);z-index:9"></div>
      <div style="position:absolute;left:${c.x}px;top:${c.y}px;z-index:10;${s.click ? 'filter:drop-shadow(0 0 6px #F5A700)' : ''}">
        <svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 3l5.5 16 2.2-6.4L19 10.5 5 3z"
          fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg></div>
      <div style="position:absolute;left:6px;top:6px;z-index:11;background:#1B2333;color:#fff;font:600 13px sans-serif;
        padding:3px 8px;border-radius:6px">#${i + 1} ${c.x},${c.y}${s.click ? ' ·click' : ''}</div>` : `
      <div style="position:absolute;left:6px;top:6px;z-index:11;background:#475467;color:#fff;font:600 13px sans-serif;
        padding:3px 8px;border-radius:6px">#${i + 1} no-cursor</div>`;
    await page.setContent(`<body style="margin:0"><div style="position:relative;width:${VW}px;height:${VH}px">
      <img src="data:image/png;base64,${b64}" style="width:${VW}px;height:${VH}px;display:block">${overlay}</div></body>`);
    await page.screenshot({ path: join(outDir, `cursor-${pad(i + 1)}.png`) });
}
await browser.close();
console.log(`overlaid ${man.steps.length} frames → render-check/${dirName}/cursor-NN.png`);
