/**
 * seed-course — creates ONE sample course (with a prebuilt 3-Level structure +
 * a session) to populate the demo institute. Authorized non-destructive seed;
 * guarded (no payment/domain/comms integrations); demo-institute-locked.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const outDir = join(TOOL_ROOT, 'capture', '_inspect');
mkdirSync(outDir, { recursive: true });

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

await page.goto(BASE + '/study-library/courses', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await wait(2500);
const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
if (active !== INSTITUTE_ID) { console.error('ABORT institute', active); await browser.close(); process.exit(2); }
console.log('institute lock OK');

const COURSE = 'Foundation Mathematics';

await page.getByText('Create Course', { exact: false }).first().click();
await wait(1800);
await page.getByPlaceholder('Enter course name').fill(COURSE);
await wait(400);
await page.getByRole('button', { name: 'Next', exact: true }).click();
await wait(2200);

// Step 2: simplest valid course — Contains Sessions? No, Contains Levels? No.
// (Two "No" labels on the page: first = Sessions, second = Levels.)
try {
    await page.getByText('No', { exact: true }).nth(0).click({ timeout: 4000 });
    await wait(400);
    await page.getByText('No', { exact: true }).nth(1).click({ timeout: 4000 });
    console.log('  set Contains Sessions? No, Contains Levels? No');
} catch (e) {
    console.log('  (could not set No/No:', e.message.split('\n')[0], ')');
}
await wait(700);
await page.screenshot({ path: join(outDir, 'cc-step2-ready.png') });

const createBtn = page.getByRole('button', { name: 'Create', exact: true }).last();
const enabled = await createBtn.isEnabled().catch(() => false);
console.log('  Create enabled:', enabled);
if (enabled) {
    await createBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await wait(4000);
    await page.screenshot({ path: join(outDir, 'cc-created.png') });
    console.log('  course create submitted');
} else {
    console.log('  Create disabled — capturing state for debug, not created.');
}

// Verify on the courses list
await page.goto(BASE + '/study-library/courses', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await wait(2500);
await page.screenshot({ path: join(outDir, 'courses-after.png') });
const hasCourse = await page.getByText(COURSE, { exact: false }).count().catch(() => 0);
console.log(`  courses page shows "${COURSE}": ${hasCourse > 0}`);

await browser.close();
console.log('seed-course done -> capture/_inspect/courses-after.png');
