/**
 * inspect-dialog — generic: goto a route, optionally click a button, dump the
 * resulting form fields + screenshot. Guarded; no submit.
 * Usage: node capture/inspect-dialog.mjs "/manage-institute/sessions" "Add New Session" sessions
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const route = process.argv[2] || '/dashboard';
const btn = process.argv[3] || '';
const tag = process.argv[4] || 'dialog';
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
await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, `${tag}-before.png`) });

if (btn) {
    try {
        await page.getByText(btn, { exact: false }).first().click({ timeout: 8000 });
        await page.waitForTimeout(2200);
    } catch (e) {
        console.log('click failed:', e.message.split('\n')[0]);
    }
}
await page.screenshot({ path: join(outDir, `${tag}-after.png`) });

const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    return {
        url: location.href,
        inputs: [...document.querySelectorAll('input,textarea,select')].filter(vis).map((el) => ({ type: el.getAttribute('type') || el.tagName.toLowerCase(), placeholder: el.getAttribute('placeholder') || '', name: el.getAttribute('name') || '' })),
        buttons: [...new Set([...document.querySelectorAll('button,[role="button"]')].filter(vis).map((b) => (b.innerText || '').trim()).filter((t) => t && t.length < 40))],
        labels: [...document.querySelectorAll('h1,h2,h3,label,[class*="title"]')].filter(vis).map((h) => (h.innerText || '').trim()).filter((t) => t && t.length < 60).slice(0, 30),
    };
});
console.log(`[${tag}] url:`, info.url);
console.log('inputs:', JSON.stringify(info.inputs, null, 2));
console.log('buttons:', JSON.stringify(info.buttons));
console.log('labels:', JSON.stringify(info.labels));
await browser.close();
console.log(`done -> capture/_inspect/${tag}-after.png`);
