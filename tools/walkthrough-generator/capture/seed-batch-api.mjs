/**
 * seed-batch-api — completes a batch via UI ONCE while logging the real write
 * requests (URL + payload + response), so the create-batch / enroll APIs can be
 * replayed for fast bulk seeding. Guarded; demo-institute-locked.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const sdir = join(TOOL_ROOT, 'screenshots', 'create-batch');
const idir = join(TOOL_ROOT, 'capture', '_inspect');
mkdirSync(sdir, { recursive: true });
mkdirSync(idir, { recursive: true });

const BLOCK = [/razorpay/i, /stripe/i, /cashfree/i, /payment-?gateway/i, /\bdomain\b/i, /\bdns\b/i, /oauth/i, /\bsmtp\b/i, /whatsapp/i, /\bsms\b/i, /exotel/i, /youtube/i, /\/send\b/i];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: join(TOOL_ROOT, 'auth-state.json'), viewport: { width: 1440, height: 900 } });
await ctx.route('**', (r) => {
    const m = r.request().method();
    if (m === 'DELETE' || m === 'PUT' || m === 'PATCH') return r.abort();
    if (m !== 'GET' && m !== 'HEAD' && BLOCK.some((re) => re.test(r.request().url()))) return r.abort();
    return r.continue();
});
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);

// ---- log write requests (POST) to admin/auth services ----
const writes = [];
page.on('request', (req) => {
    const m = req.method();
    const u = req.url();
    if (m === 'POST' && /(admin-core-service|auth-service)/.test(u) && !/login|refresh|get|list|search|distinct|users-of-status/i.test(u)) {
        writes.push({ method: m, url: u, body: (req.postData() || '').slice(0, 4000) });
    }
});

let n = 0;
const shot = async (l) => { n++; await page.screenshot({ path: join(sdir, `${String(n).padStart(2, '0')}-${l}.png`) }); };
const clickByTextBelow = async (text, yMin = 0) =>
    page.evaluate(({ text, yMin }) => {
        const els = [...document.querySelectorAll('div,span,button,li,[role],p')];
        const el = els.find((e) => e.textContent && e.textContent.trim() === text && e.getBoundingClientRect().top > yMin && e.offsetParent !== null && e.getBoundingClientRect().width > 0);
        if (el) { el.click(); return true; }
        return false;
    }, { text, yMin });

await page.goto(BASE + '/manage-institute/batches', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await wait(2500);
const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
if (active !== INSTITUTE_ID) { console.error('ABORT institute', active); await browser.close(); process.exit(2); }

await page.getByText('Create Batch', { exact: false }).first().click();
await wait(1600);
await page.getByRole('button', { name: 'Next Step', exact: false }).first().click().catch(() => {});
await wait(1800);
await shot('step2');

// open the session selector (custom combobox) then pick the seeded session
await clickByTextBelow('Select a session', 200).catch(() => {});
await wait(900);
let picked = await clickByTextBelow('2025-26', 200);
if (!picked) {
    // fallback: click the first listbox option
    picked = await page.evaluate(() => {
        const opt = document.querySelector('[role="option"]');
        if (opt) { opt.click(); return true; }
        return false;
    });
}
console.log('  session picked:', picked);
await wait(800);
await shot('session-picked');

// advance / create
for (let i = 0; i < 4; i++) {
    const created = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && !b.disabled);
        const create = btns.find((b) => /^(create|done|finish|create batch|add batch|submit)$/i.test(b.innerText.trim()));
        if (create) { create.click(); return 'create'; }
        const next = btns.find((b) => /next step/i.test(b.innerText.trim()));
        if (next) { next.click(); return 'next'; }
        return 'none';
    });
    await wait(2000);
    await shot('adv' + i + '-' + created);
    console.log('  step', i, '->', created);
    if (created === 'create') { await page.waitForLoadState('networkidle').catch(() => {}); await wait(2500); break; }
    if (created === 'none') break;
}

writeFileSync(join(idir, 'batch-writes.json'), JSON.stringify(writes, null, 2));
console.log('  captured write requests:', writes.length);
for (const w of writes) console.log('   ', w.method, w.url.replace(BASE, '').slice(0, 80));

await browser.close();
console.log('seed-batch-api done -> capture/_inspect/batch-writes.json');
