/**
 * seed-session — creates an academic session linked to the seeded course's
 * default level. Guarded; demo-institute-locked; authorized non-destructive seed.
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

await page.goto(BASE + '/manage-institute/sessions', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await wait(2500);
const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
if (active !== INSTITUTE_ID) { console.error('ABORT institute', active); await browser.close(); process.exit(2); }

await page.getByText('Add New Session', { exact: false }).first().click();
await wait(1800);
await page.getByPlaceholder('Eg. 2024-2025').fill('2025-26');
await wait(400);
// associate with the course's default level (custom checkbox → click the label)
let levelChecked = false;
for (const attempt of [
    () => page.getByRole('checkbox').first().click({ timeout: 3000 }),
    () => page.getByText('default', { exact: true }).first().click({ timeout: 3000 }),
    () => page.locator('input[type="checkbox"]').first().click({ force: true, timeout: 3000 }),
]) {
    try { await attempt(); levelChecked = true; break; } catch { /* next */ }
}
console.log('  level checked:', levelChecked);
await wait(600);
await page.screenshot({ path: join(outDir, 'session-ready.png') });

const addBtn = page.getByRole('button', { name: 'Add', exact: true }).last();
const enabled = await addBtn.isEnabled().catch(() => false);
console.log('  Add enabled:', enabled);
if (enabled) {
    await addBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await wait(3500);
    await page.screenshot({ path: join(outDir, 'session-created.png') });
    console.log('  session create submitted');
} else {
    console.log('  Add disabled — not created (see session-ready.png).');
}
await browser.close();
console.log('seed-session done');
