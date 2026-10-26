/**
 * capture-flow — drives a real flow on the DEMO institute and records, per step:
 *   - a real screenshot frame (the actual UI),
 *   - the on-screen pixel coordinates of the element the cursor should click next,
 *   - a caption + the faux address-bar path.
 * Output: screenshots/flows/<slug>/NN.png + screenshots/flows/<slug>/manifest.json
 *
 * The video is then 100% real UI (build-video.mjs animates a cursor over these
 * frames). No UI is recreated or invented.
 *
 * Safety: institute-locked to the demo; allows in-demo interaction (clicks/tabs/
 * submits with demo data) per owner direction, but still blocks anything that
 * reaches a third party or another institute (live payment charge / domain-DNS /
 * real comms send). Screenshots are viewport-sized at scale 1 so element
 * bounding boxes map 1:1 to screenshot pixels.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';
import { LEARNER_PROFILE_FLOW } from './flow-specs.mjs';

const SPECS = { 'learner-profile': LEARNER_PROFILE_FLOW };

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;

const which = process.argv[2] || 'learner-profile';
const spec = SPECS[which];
if (!spec) { console.error('unknown spec', which, '— have:', Object.keys(SPECS).join(', ')); process.exit(1); }

const VIEW = { width: 1440, height: 900 };
const outDir = join(TOOL_ROOT, 'screenshots', 'flows', spec.slug);
mkdirSync(outDir, { recursive: true });

// Block only third-party / cross-institute side effects; allow in-demo writes.
const HARD_BLOCK = [
    /razorpay|stripe|cashfree|phonepe|payment-?gateway|\/charge\b|\/capture\b/i,
    /\bdns\b|custom-?domain|\/domain\/(add|update|verify)/i,
    /notification-service\/.*(send|dispatch)\b/i,
    /\/sms\/send|\/whatsapp\/send|\/email\/send/i,
];
function installGuard(context) {
    return context.route('**', (route) => {
        const url = route.request().url();
        if (HARD_BLOCK.some((re) => re.test(url))) { console.log('  [guard] blocked', url.slice(0, 70)); return route.abort(); }
        return route.continue();
    });
}

const wait = (page, ms) => page.waitForTimeout(ms);

// locate a clickable by text, optionally restricted to the right-hand slide-over
async function findByText(page, text, opts = {}) {
    const handles = await page.locator(`text="${text}"`).elementHandles().catch(() => []);
    let best = null, bestX = -1;
    for (const h of handles) {
        const box = await h.boundingBox().catch(() => null);
        if (!box || box.width === 0) continue;
        if (opts.minX != null && box.x < opts.minX) continue;
        if (opts.rightmost) { if (box.x > bestX) { bestX = box.x; best = h; } }
        else { best = h; break; }
    }
    return best;
}

// the row "open profile" icon in the Details column (validated heuristic)
async function findOpenIcon(page) {
    const cand = await page.locator('button:has(svg), a:has(svg), [role="button"]:has(svg)').elementHandles();
    for (const h of cand) {
        const box = await h.boundingBox().catch(() => null);
        if (!box) continue;
        if (box.width > 0 && box.width < 50 && box.x > 380 && box.x < 760 && box.y > 380 && box.y < 900) return h;
    }
    return null;
}

async function resolveTarget(page, step) {
    if (step.openIcon) return await findOpenIcon(page);
    if (step.clickText) return await findByText(page, step.clickText, { minX: step.minX, rightmost: step.rightmost });
    return null;
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: join(TOOL_ROOT, 'auth-state.json'), viewport: VIEW, deviceScaleFactor: 1 });
    await installGuard(context);
    const page = await context.newPage();

    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await wait(page, 2000);
    const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
    if (active !== INSTITUTE_ID) { console.error('ABORT institute', active); await browser.close(); process.exit(2); }
    console.log('institute lock OK', active, '\nflow:', spec.slug, '-', spec.title, '\n');

    const manifestSteps = [];
    let curPath = '/dashboard';
    let n = 0;

    for (const step of spec.steps) {
        if (step.goto) {
            await page.goto(BASE + step.goto, { waitUntil: 'commit', timeout: 35000 });
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForLoadState('networkidle').catch(() => {});
            await wait(page, step.settle || 2400);
            curPath = step.goto;
        } else if (step.wait) {
            await wait(page, step.wait);
        }
        if (step.path) curPath = step.path;

        // resolve the element the cursor will point at on THIS frame (if any)
        let cursor = null;
        if (!step.final) {
            const target = await resolveTarget(page, step);
            if (target) {
                await target.scrollIntoViewIfNeeded().catch(() => {});
                await wait(page, 350);
                const box = await target.boundingBox().catch(() => null);
                if (box) cursor = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
                // keep a handle to click after the screenshot
                step.__target = target;
            } else {
                console.log(`  ! could not resolve target for: ${JSON.stringify(step).slice(0, 80)}`);
            }
        }

        // screenshot the frame (viewport, scale 1 → coords map 1:1)
        n += 1;
        const img = `${String(n).padStart(2, '0')}.png`;
        await page.screenshot({ path: join(outDir, img) });
        manifestSteps.push({ img, caption: step.caption || '', address: curPath, cursor, click: !step.final && !!cursor });
        console.log(`  [${n}] ${img}  ${cursor ? `cursor(${cursor.x},${cursor.y})` : 'final'}  "${(step.caption || '').replace(/<[^>]+>/g, '')}"`);

        // perform the click to advance to the next frame
        if (step.__target) {
            await step.__target.click({ timeout: 6000 }).catch((e) => console.log('  ! click failed:', e.message.split('\n')[0]));
            await page.waitForLoadState('networkidle').catch(() => {});
            await wait(page, step.after || 1600);
        }
    }

    const manifest = {
        slug: spec.slug, title: spec.title,
        urlBase: (env.VACADEMY_BASE_URL || 'dash.vacademy.io').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
        viewport: VIEW, steps: manifestSteps,
    };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await browser.close();
    console.log(`\ncaptured ${manifestSteps.length} real frames → ${outDir}`);
})();
