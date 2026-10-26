/**
 * render-check — loads generated walkthrough HTML files headlessly and captures
 * frames across the timeline so their playback can be inspected. Fully local
 * (file:// only); never touches the app/backend/network beyond Google Fonts.
 *
 * Usage:
 *   node capture/render-check.mjs <slug> [<slug> ...]
 *   node capture/render-check.mjs --all          # every file in walkthroughs/
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOL_ROOT } from './env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wkDir = join(TOOL_ROOT, 'walkthroughs');
const outRoot = join(TOOL_ROOT, 'render-check');

const args = process.argv.slice(2);
let slugs;
if (args.includes('--all')) {
    slugs = readdirSync(wkDir).filter((f) => f.endsWith('.html')).map((f) => basename(f, '.html'));
} else {
    slugs = args.filter((a) => !a.startsWith('--'));
}
if (!slugs.length) { console.error('no slugs given'); process.exit(1); }

// frame capture offsets (ms from load) — span autostart → mid → end
const OFFSETS = [900, 4000, 8000, 13000, 19000, 26000];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 1 });

for (const slug of slugs) {
    const file = join(wkDir, `${slug}.html`);
    if (!existsSync(file)) { console.log(`! missing ${slug}.html`); continue; }
    const outDir = join(outRoot, slug);
    mkdirSync(outDir, { recursive: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });

    await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 20000 });
    let n = 0;
    let prev = 0;
    for (const t of OFFSETS) {
        await page.waitForTimeout(t - prev);
        prev = t;
        n += 1;
        await page.screenshot({ path: join(outDir, `f${n}-${t}ms.png`) });
    }
    // simple bug heuristics from the DOM
    const diag = await page.evaluate(() => {
        const body = document.body;
        const scroll = body.scrollHeight > window.innerHeight + 4;
        const stages = document.querySelectorAll('.stage').length;
        const cursor = !!document.querySelector('[class*="cursor"],[id*="cursor"]');
        const player = !!document.querySelector('[class*="player"],[class*="control"]');
        return { scroll, stages, cursor, player };
    }).catch((e) => ({ err: e.message }));
    console.log(`${slug}: frames=${n} stages=${diag.stages} cursor=${diag.cursor} player=${diag.player} pageScroll=${diag.scroll} errors=${errors.length}${errors.length ? ' :: ' + errors.slice(0, 3).join(' | ') : ''}`);
    await page.close();
}
await browser.close();
console.log(`\nframes -> render-check/<slug>/`);
