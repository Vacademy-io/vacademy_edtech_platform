/**
 * grind — resilient capture runner for a FLAKY app.
 *
 * The demo app hangs intermittently (even mid-run). Capturing many flows in one
 * browser means a single hang kills every later flow. grind instead gives EACH flow
 * its OWN fresh browser + health-gate, and RETRIES it (fresh session each time) until
 * it reaches a real success — so a hang only costs one retry, not the queue. On
 * success it auto-builds the .html into walkthroughs-v2/.
 *
 * A flow "succeeds" when cursors resolved (>=2) AND, if it declares `expect` (a
 * success-toast regex), that toast is present right after the final submit.
 *
 * Usage:
 *   node capture/grind.mjs                       # every authored-v2 flow
 *   node capture/grind.mjs --slugs=a,b           # specific flows
 *   node capture/grind.mjs --attempts=10         # max attempts per flow (default 8)
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { launchHealthyPage, runFlow } from './engine.mjs';
import { FLOWS } from './authored-v2.mjs';
import { TOOL_ROOT } from './env.mjs';

const args = process.argv.slice(2);
const slugArg = args.find((a) => a.startsWith('--slugs='));
const onlySlugs = slugArg ? slugArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
const attArg = args.find((a) => a.startsWith('--attempts='));
const MAX = attArg ? parseInt(attArg.split('=')[1], 10) : 8;

const pick = onlySlugs ? FLOWS.filter((f) => onlySlugs.includes(f.slug)) : FLOWS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, a) => new Promise((res) => { const p = spawn(cmd, a, { cwd: TOOL_ROOT, stdio: 'ignore' }); p.on('close', (c) => res(c)); });
const buildVideo = (slug) => run('node', [join(TOOL_ROOT, 'capture', 'build-video.mjs'), slug, '--out=walkthroughs-v2']);
const overlay = (slug) => run('node', [join(TOOL_ROOT, 'capture', 'overlay-cursor.mjs'), slug]);

console.log(`grind: ${pick.length} flow(s), up to ${MAX} attempts each\n`);
const report = [];

for (const flow of pick) {
    let ok = false, frames = 0, attempt = 0, why = '';
    for (attempt = 1; attempt <= MAX && !ok; attempt++) {
        const h = await launchHealthyPage({ maxWaitMin: 4 }).catch(() => null);
        if (!h) { why = 'app down'; console.log(`  ${flow.slug} · attempt ${attempt}/${MAX}: app down`); await sleep(10000); continue; }
        const { browser, page } = h;
        try {
            const r = await runFlow(page, flow);
            frames = r.frames;
            const cursorsOk = r.frames <= 2 || r.withCursor >= 2;
            let expectOk = true;
            if (cursorsOk && flow.expect) expectOk = (await page.getByText(new RegExp(flow.expect, 'i')).count().catch(() => 0)) > 0;
            ok = cursorsOk && expectOk;
            why = ok ? '' : (!cursorsOk ? `hung (${r.withCursor}/${r.frames})` : `no success match /${flow.expect}/`);
        } catch (e) { why = e.message.split('\n')[0]; }
        await browser.close().catch(() => {});
        console.log(`  ${flow.slug} · attempt ${attempt}/${MAX}: ${ok ? `OK ✓ (${frames}f)` : 'retry — ' + why}`);
        if (!ok) await sleep(8000);
    }
    if (ok) { await overlay(flow.slug); await buildVideo(flow.slug); console.log(`  ▶ BUILT ${flow.slug}\n`); }
    else console.log(`  ✗ GAVE UP ${flow.slug} after ${MAX} attempts (${why})\n`);
    report.push({ slug: flow.slug, ok, attempts: attempt - 1, frames, why });
}

writeFileSync(join(TOOL_ROOT, 'grind-report.json'), JSON.stringify(report, null, 2));
const won = report.filter((r) => r.ok);
console.log('=== grind summary ===');
report.forEach((r) => console.log(` ${r.ok ? '✅' : '❌'} ${r.slug}${r.ok ? '' : ' — ' + r.why}`));
console.log(`\nbuilt ${won.length}/${pick.length} this run → walkthroughs-v2/`);
