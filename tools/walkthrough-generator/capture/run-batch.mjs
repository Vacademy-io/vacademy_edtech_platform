/**
 * run-batch — guarded batch screenshot capture across multiple flow specs.
 *
 * Same safety model as capture.mjs:
 *   - reuse demo-admin session; assert demo institute; abort otherwise
 *   - network guard blocks ALL real integrations (payment/domain/WhatsApp/SMS/
 *     Exotel/OAuth/SMTP/GTM/YouTube/lead-ads) + DELETE/PUT/PATCH
 *   - submit steps run ONLY for flows flagged submit:true (non-destructive),
 *     and only when the button is enabled
 *
 * Usage:
 *   node capture/run-batch.mjs                 # all flows
 *   node capture/run-batch.mjs teams-invite learners-list   # subset by slug
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';
import { FLOWS } from './flows.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const authPath = join(TOOL_ROOT, 'auth-state.json');
if (!existsSync(authPath)) {
    console.error('No auth-state.json — run: node capture/smoke-login.mjs first.');
    process.exit(1);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flows = only.length ? FLOWS.filter((f) => only.includes(f.slug)) : FLOWS;

const BLOCK = [
    /razorpay/i, /stripe/i, /cashfree/i, /payment-?gateway/i, /\/pay(ment)?s?\b/i, /checkout/i, /\/order/i,
    /whatsapp/i, /\bsms\b/i, /exotel/i, /telephony/i, /\bwati\b/i,
    /\bdomain\b/i, /subdomain/i, /\bdns\b/i, /custom-?domain/i,
    /oauth/i, /\bsmtp\b/i, /\bgtm\b/i, /youtube/i, /facebook|meta-?ads|lead-?ads/i,
    /\/send\b/i, /dispatch/i, /notification-service\/.*(send|whatsapp|email|sms)/i,
];
function installGuard(context) {
    return context.route('**', (route) => {
        const m = route.request().method();
        const url = route.request().url();
        if (m === 'DELETE' || m === 'PUT' || m === 'PATCH') return route.abort();
        if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && BLOCK.some((re) => re.test(url))) {
            console.log('    [guard] blocked', m, url.slice(0, 70));
            return route.abort();
        }
        return route.continue();
    });
}
const wait = (page, ms) => page.waitForTimeout(ms);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: authPath, viewport: { width: 1440, height: 900 } });
    await installGuard(context);
    const page = await context.newPage();

    // institute lock (check once up front)
    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await wait(page, 2000);
    const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
    if (active !== INSTITUTE_ID) {
        console.error(`ABORT: active institute "${active}" !== demo "${INSTITUTE_ID}"`);
        await browser.close();
        process.exit(2);
    }
    console.log(`institute lock OK (${active})\n`);

    const report = [];
    for (const flow of flows) {
        console.log(`=== ${flow.slug} (${flow.title}) submit=${!!flow.submit} ===`);
        const outDir = join(TOOL_ROOT, 'screenshots', flow.slug);
        mkdirSync(outDir, { recursive: true });
        let n = 0;
        const shots = [];
        const shot = async (label) => {
            n += 1;
            const file = join(outDir, `${String(n).padStart(2, '0')}-${label}.png`);
            await page.screenshot({ path: file });
            shots.push(`${String(n).padStart(2, '0')}-${label}.png`);
            console.log(`  shot ${flow.slug}/${String(n).padStart(2, '0')}-${label}.png`);
        };

        for (const step of flow.steps) {
            try {
                if (step.goto) {
                    await page.goto(BASE + step.goto, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await page.waitForLoadState('networkidle').catch(() => {});
                    await wait(page, 2200);
                } else if (step.click) {
                    const loc = page.getByText(step.click, { exact: false }).first();
                    await loc.waitFor({ state: 'visible', timeout: 8000 });
                    await loc.scrollIntoViewIfNeeded().catch(() => {});
                    await loc.click();
                    await wait(page, 1500);
                } else if (step.fillPlaceholder) {
                    await page.getByPlaceholder(step.fillPlaceholder).first().fill(step.value ?? '');
                    await wait(page, 400);
                } else if (step.pickBelow) {
                    const label = step.pickBelow;
                    await page.evaluate((txt) => {
                        const els = [...document.querySelectorAll('div,li,span,button,a,[role]')];
                        const cand = els.find(
                            (el) => el.textContent && el.textContent.trim() === txt &&
                                el.getBoundingClientRect().top > 540 && el.getBoundingClientRect().width > 0 && el.offsetParent !== null
                        );
                        if (cand) cand.click();
                    }, label);
                    await wait(page, 600);
                    await page.keyboard.press('Escape').catch(() => {});
                    await wait(page, 400);
                } else if (step.submit) {
                    if (!flow.submit) {
                        console.log(`  (skip submit "${step.submit}" — flow.submit=false)`);
                    } else {
                        const btn = page.getByRole('button', { name: step.submit, exact: true }).last();
                        const enabled = await btn.isEnabled().catch(() => false);
                        if (enabled) {
                            await btn.click();
                            await page.waitForLoadState('networkidle').catch(() => {});
                            await wait(page, 2800);
                            console.log(`  submitted "${step.submit}" (guarded; test data only)`);
                        } else {
                            console.log(`  (submit "${step.submit}" disabled — skipped)`);
                        }
                    }
                } else if (step.wait) {
                    await wait(page, step.wait);
                }
                if (step.shot) await shot(step.shot);
            } catch (e) {
                console.log(`  ! step ${JSON.stringify(step).slice(0, 60)} -> ${e.message.split('\n')[0]}`);
                if (step.shot) await shot(step.shot + '-ERR').catch(() => {});
            }
        }
        report.push({ slug: flow.slug, title: flow.title, shots });
        console.log('');
    }

    writeFileSync(join(TOOL_ROOT, 'screenshots', 'capture-report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    console.log('batch capture done. report -> screenshots/capture-report.json');
})();
