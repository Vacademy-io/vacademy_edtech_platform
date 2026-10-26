/**
 * inspect-login — READ-ONLY. Opens the app's landing/login page, screenshots it,
 * and dumps the visible form controls so we can script the demo-institute login
 * correctly. Performs NO actions (no clicks, no submits, no typing).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const outDir = join(TOOL_ROOT, 'capture', '_inspect');
mkdirSync(outDir, { recursive: true });

function summarize(loc) {
    return loc;
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const targets = [BASE + '/', BASE + '/login'];
for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const shot = join(outDir, `0${i + 1}-${i === 0 ? 'landing' : 'login'}.png`);
        await page.screenshot({ path: shot, fullPage: false });

        const info = await page.evaluate(() => {
            const vis = (el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
            };
            const inputs = [...document.querySelectorAll('input,textarea,select')]
                .filter(vis)
                .map((el) => ({
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute('type') || '',
                    name: el.getAttribute('name') || '',
                    id: el.id || '',
                    placeholder: el.getAttribute('placeholder') || '',
                    ariaLabel: el.getAttribute('aria-label') || '',
                }));
            const buttons = [...document.querySelectorAll('button,[role="button"],a')]
                .filter(vis)
                .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim())
                .filter((t) => t && t.length < 40)
                .slice(0, 40);
            return {
                url: location.href,
                title: document.title,
                inputs,
                buttons: [...new Set(buttons)],
            };
        });

        console.log(`\n===== ${url} -> ${info.url} =====`);
        console.log('title:', info.title);
        console.log('inputs:', JSON.stringify(info.inputs, null, 2));
        console.log('buttons/links:', JSON.stringify(info.buttons));
        console.log('screenshot:', shot);
    } catch (e) {
        console.log(`ERROR at ${url}:`, e.message);
    }
}

await browser.close();
console.log('\ninspect-login done.');
