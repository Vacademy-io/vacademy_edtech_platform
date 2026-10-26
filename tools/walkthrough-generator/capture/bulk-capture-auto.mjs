/**
 * bulk-capture-auto — unattended, guarded capture across the full flow set.
 *
 * Reads capture/flows-auto.json (produced by auto-spec.mjs), dedupes flows by
 * their resolved URL (many flows share a landing screen — e.g. all /settings
 * sub-tabs, or the /dashboard fallbacks), navigates to each UNIQUE url exactly
 * once, screenshots it, then fans the shot out to every flow's own folder so the
 * generation stage finds screenshots/<slug>/01-landing.png as it expects.
 *
 * Same safety model as run-batch.mjs / capture.mjs:
 *   - reuse demo-admin session; assert demo institute up front AND before every
 *     shot; abort on mismatch
 *   - network guard blocks ALL real integrations (payment/domain/comms/etc.) and
 *     every mutating verb (DELETE/PUT/PATCH/POST) — this is a READ-ONLY sweep
 *   - never submits anything (pure navigation + screenshot)
 *
 * Usage:
 *   node capture/bulk-capture-auto.mjs            # admin side (default)
 *   node capture/bulk-capture-auto.mjs --limit=20 # first 20 unique URLs (smoke)
 *   node capture/bulk-capture-auto.mjs --side=all # include learner (needs learner base)
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';
import { routeToUrl } from './route-map.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const LEARNER_BASE = (env.VACADEMY_LEARNER_BASE_URL || '').replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const authPath = join(TOOL_ROOT, 'auth-state.json');
if (!existsSync(authPath)) {
    console.error('No auth-state.json — run: node capture/smoke-login.mjs first.');
    process.exit(1);
}

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const sideArg = (args.find((a) => a.startsWith('--side=')) || '--side=admin').split('=')[1];

const flows = JSON.parse(readFileSync(join(here, 'flows-auto.json'), 'utf8'));

// Which flows can we capture? Admin always; learner only if a learner base is set.
const captureable = flows.filter((f) => {
    if (f.side === 'admin') return sideArg === 'admin' || sideArg === 'all';
    if (f.side === 'learner') return sideArg === 'all' && !!LEARNER_BASE;
    return false;
});
const skippedLearner = flows.filter((f) => f.side === 'learner' && !(sideArg === 'all' && LEARNER_BASE)).length;

// Group flows by their resolved URL so each unique screen is captured once.
const byUrl = new Map();
for (const f of captureable) {
    const base = f.side === 'learner' ? LEARNER_BASE : BASE;
    const url = routeToUrl(base, f.route, f.tab);
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(f);
}
let uniqueUrls = [...byUrl.keys()];
if (Number.isFinite(LIMIT)) uniqueUrls = uniqueUrls.slice(0, LIMIT);

const BLOCK = [
    /razorpay/i, /stripe/i, /cashfree/i, /payment-?gateway/i, /\/pay(ment)?s?\b/i, /checkout/i, /\/order/i,
    /whatsapp/i, /\bsms\b/i, /exotel/i, /telephony/i, /\bwati\b/i,
    /\bdomain\b/i, /subdomain/i, /\bdns\b/i, /custom-?domain/i,
    /oauth/i, /\bsmtp\b/i, /\bgtm\b/i, /youtube/i, /facebook|meta-?ads|lead-?ads/i,
    /\/send\b/i, /dispatch/i, /notification-service\/.*(send|whatsapp|email|sms)/i,
];
// POST to one of these paths = a write. Read POSTs (list/search/filter) are allowed
// so list pages actually populate for the screenshot.
const MUTATING_PATH = /\/(add|create|update|edit|save|delete|remove|destroy|send|dispatch|invite|enroll|import|upload|merge|assign|approve|reject|publish|deactivate|activate|generate)\b/i;
function installGuard(context) {
    // Read-only navigation sweep. Gate ONLY data calls (xhr/fetch) — never the
    // page's own document/scripts/styles/assets (blocking those breaks the SPA).
    return context.route('**', (route) => {
        const req = route.request();
        const type = req.resourceType();
        const m = req.method();
        const url = req.url();
        if (type === 'document' || type === 'stylesheet' || type === 'script' ||
            type === 'image' || type === 'font' || type === 'media' || type === 'manifest') {
            return route.continue();
        }
        if (m === 'DELETE' || m === 'PUT' || m === 'PATCH') {
            console.log('    [guard] blocked', m, url.slice(0, 70));
            return route.abort();
        }
        if (m === 'POST' && MUTATING_PATH.test(url)) {
            console.log('    [guard] blocked', m, url.slice(0, 70));
            return route.abort();
        }
        if (BLOCK.some((re) => re.test(url))) {
            console.log('    [guard] blocked', m, url.slice(0, 70));
            return route.abort();
        }
        return route.continue();
    });
}
const wait = (page, ms) => page.waitForTimeout(ms);
const urlKey = (url) => url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: authPath, viewport: { width: 1440, height: 900 } });
    await installGuard(context);
    const page = await context.newPage();

    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await wait(page, 2000);
    const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
    if (active !== INSTITUTE_ID) {
        console.error(`ABORT: active institute "${active}" !== demo "${INSTITUTE_ID}"`);
        await browser.close();
        process.exit(2);
    }
    console.log(`institute lock OK (${active})`);
    console.log(`flows: ${flows.length} | captureable: ${captureable.length} | unique URLs: ${byUrl.size} (capturing ${uniqueUrls.length}) | learner skipped: ${skippedLearner}\n`);

    const sharedDir = join(TOOL_ROOT, 'screenshots', '_by-url');
    mkdirSync(sharedDir, { recursive: true });
    const report = [];
    let done = 0;

    for (const url of uniqueUrls) {
        const group = byUrl.get(url);
        const key = urlKey(url);
        const sharedShot = join(sharedDir, `${key}.png`);
        let ok = false;
        try {
            await page.goto(url, { waitUntil: 'commit', timeout: 35000 });
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForLoadState('networkidle').catch(() => {});
            await wait(page, 2600);
            // re-assert institute lock before every shot (cheap safety net)
            const cur = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
            if (cur !== INSTITUTE_ID) throw new Error(`institute drifted to ${cur}`);
            await page.screenshot({ path: sharedShot });
            ok = true;
        } catch (e) {
            console.log(`  ! ${url.slice(0, 70)} -> ${e.message.split('\n')[0]}`);
        }

        // fan the shared shot out to each flow that uses this URL
        for (const f of group) {
            const flowDir = join(TOOL_ROOT, 'screenshots', f.slug);
            mkdirSync(flowDir, { recursive: true });
            if (ok) {
                try { copyFileSync(sharedShot, join(flowDir, '01-landing.png')); } catch {}
            }
            report.push({ slug: f.slug, side: f.side, title: f.title, route: f.route, tab: f.tab, url, captured: ok });
        }
        done += 1;
        console.log(`  [${done}/${uniqueUrls.length}] ${ok ? 'shot' : 'FAIL'}  ${group.length}x  ${url.replace(BASE, '')}`);
    }

    writeFileSync(join(TOOL_ROOT, 'screenshots', 'bulk-capture-report.json'), JSON.stringify({
        base: BASE, institute: INSTITUTE_ID, total_flows: flows.length, captureable: captureable.length,
        unique_urls: byUrl.size, captured_urls: done, learner_skipped: skippedLearner, flows: report,
    }, null, 2));
    const okFlows = report.filter((r) => r.captured).length;
    await browser.close();
    console.log(`\nbulk capture done. ${okFlows}/${report.length} flow-shots written.`);
    console.log('report -> screenshots/bulk-capture-report.json');
})();
