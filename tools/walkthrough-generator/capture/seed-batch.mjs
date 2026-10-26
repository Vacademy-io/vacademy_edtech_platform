/**
 * seed-batch — creates a batch for the seeded course+session. Multi-step:
 * Step1 Select Course (preselected) -> Step2 Select Session -> finish/create.
 * Guarded; demo-institute-locked; captures each step; completes if possible.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const sdir = join(TOOL_ROOT, 'screenshots', 'create-batch');
mkdirSync(sdir, { recursive: true });

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
let n = 0;
const shot = async (l) => { n++; await page.screenshot({ path: join(sdir, `${String(n).padStart(2, '0')}-${l}.png`) }); console.log('  shot', l); };

await page.goto(BASE + '/manage-institute/batches', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await wait(2500);
const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
if (active !== INSTITUTE_ID) { console.error('ABORT institute', active); await browser.close(); process.exit(2); }

await page.getByText('Create Batch', { exact: false }).first().click();
await wait(1600);
await shot('step1');
// Step 1: course preselected -> Next Step
await page.getByRole('button', { name: 'Next Step', exact: false }).first().click().catch((e) => console.log('  ! next1', e.message.split('\n')[0]));
await wait(1800);
await shot('step2');

// Step 2: open the session dropdown and pick the seeded session
try {
    await page.getByText('Select a session', { exact: false }).first().click({ timeout: 5000 });
    await wait(900);
    await page.getByText('2025-26', { exact: false }).first().click({ timeout: 5000 });
    console.log('  picked session 2025-26');
} catch (e) { console.log('  ! session pick:', e.message.split('\n')[0]); }
await wait(700);
await shot('step2-session');

// advance; some flows go straight to a create button
for (let step = 0; step < 3; step++) {
    const next = page.getByRole('button', { name: 'Next Step', exact: false }).first();
    const create = page.getByRole('button', { name: /^(Create|Done|Finish|Create Batch|Add Batch|Submit)$/i }).last();
    if (await create.isVisible().catch(() => false) && await create.isEnabled().catch(() => false)) {
        await create.click().catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await wait(2800);
        await shot('created');
        console.log('  batch create submitted');
        break;
    } else if (await next.isVisible().catch(() => false) && await next.isEnabled().catch(() => false)) {
        await next.click().catch(() => {});
        await wait(1800);
        await shot('next' + step);
    } else {
        console.log('  no enabled Next/Create at step', step);
        await shot('stuck' + step);
        break;
    }
}

await browser.close();
console.log('seed-batch done');
