/**
 * inspect-create-course — opens the Create Course UI and dumps its fields so we
 * can script the seed. Guarded (no real integrations); does NOT submit.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
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

await page.goto(BASE + '/study-library/courses', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2500);

try {
    await page.getByText('Create Course', { exact: false }).first().click();
    await page.waitForTimeout(2500);
} catch (e) {
    console.log('could not click Create Course:', e.message);
}

await page.screenshot({ path: join(outDir, 'create-course.png'), fullPage: false });

const info = await page.evaluate(() => {
    const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const inputs = [...document.querySelectorAll('input,textarea,select')]
        .filter(vis)
        .map((el) => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', name: el.getAttribute('name') || '', placeholder: el.getAttribute('placeholder') || '' }));
    const buttons = [...new Set([...document.querySelectorAll('button,[role="button"]')].filter(vis).map((b) => (b.innerText || '').trim()).filter((t) => t && t.length < 36))];
    const headings = [...document.querySelectorAll('h1,h2,h3,[class*="title"],label')].filter(vis).map((h) => (h.innerText || '').trim()).filter((t) => t && t.length < 50).slice(0, 25);
    return { url: location.href, inputs, buttons, headings };
});

console.log('url:', info.url);
console.log('inputs:', JSON.stringify(info.inputs, null, 2));
console.log('buttons:', JSON.stringify(info.buttons));
console.log('headings/labels:', JSON.stringify(info.headings));

await browser.close();
console.log('done -> capture/_inspect/create-course.png');
