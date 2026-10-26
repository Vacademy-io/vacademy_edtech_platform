/**
 * capture — guarded screenshot capture of a flow on the demo institute.
 *
 * SAFETY (all enforced here):
 *  - Reuses the saved demo-admin session (auth-state.json).
 *  - Asserts the active institute === the configured demo institute; aborts otherwise.
 *  - NETWORK GUARD blocks every REAL integration / side-effect:
 *      payment gateways (Razorpay/Stripe/Cashfree), custom domain/DNS,
 *      WhatsApp/Meta/Wati, SMS, Exotel telephony, OAuth connects, SMTP, GTM,
 *      YouTube connect, FB/Meta lead ads — plus ALL DELETE/PUT/PATCH writes.
 *  - The ONLY write allowed is the team-invite email (explicitly approved),
 *    and only when run with `--submit`. It is sent to a reserved example.com
 *    address that cannot reach a real person.
 *
 * Usage: node capture/capture.mjs teams-invite [--submit]
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const authPath = join(TOOL_ROOT, 'auth-state.json');
if (!existsSync(authPath)) {
    console.error('No auth-state.json — run: node capture/smoke-login.mjs first.');
    process.exit(1);
}

const args = process.argv.slice(2);
const flow = args.find((a) => !a.startsWith('--')) || 'teams-invite';
const allowSubmit = args.includes('--submit');

// ---- Network safety guard: block ALL real integrations / side-effects -------
// (invite-email is intentionally NOT in this list — it's the one approved write.)
const BLOCK = [
    /razorpay/i, /stripe/i, /cashfree/i, /payment-?gateway/i, /\/pay(ment)?s?\b/i, /checkout/i, /\/order/i,
    /whatsapp/i, /\bsms\b/i, /exotel/i, /telephony/i, /\bwati\b/i,
    /\bdomain\b/i, /subdomain/i, /\bdns\b/i, /custom-?domain/i,
    /oauth/i, /\bsmtp\b/i, /\bgtm\b/i, /youtube/i, /facebook|meta-?ads|lead-?ads/i,
    /\/send\b/i, /dispatch/i, /notification-service\/.*(send|whatsapp|email|sms)/i,
];
function installGuard(context) {
    return context.route('**', (route) => {
        const req = route.request();
        const m = req.method();
        const url = req.url();
        if (m === 'DELETE' || m === 'PUT' || m === 'PATCH') {
            console.log('  [guard] blocked write', m, url.slice(0, 80));
            return route.abort();
        }
        if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && BLOCK.some((re) => re.test(url))) {
            console.log('  [guard] blocked integration', m, url.slice(0, 80));
            return route.abort();
        }
        return route.continue();
    });
}

const wait = (page, ms) => page.waitForTimeout(ms);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        storageState: authPath,
        viewport: { width: 1440, height: 900 },
    });
    await installGuard(context);
    const page = await context.newPage();

    const outDir = join(TOOL_ROOT, 'screenshots', flow);
    mkdirSync(outDir, { recursive: true });
    let n = 0;
    const shot = async (label) => {
        n += 1;
        const file = join(outDir, `${String(n).padStart(2, '0')}-${label}.png`);
        await page.screenshot({ path: file });
        console.log(`  shot ${file}`);
    };
    const clickText = async (text, opts = {}) => {
        const loc = page.getByText(text, { exact: opts.exact ?? false }).first();
        await loc.waitFor({ state: 'visible', timeout: opts.timeout ?? 8000 });
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click();
    };

    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await wait(page, 2500);

    // ---- INSTITUTE LOCK -----------------------------------------------------
    const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
    if (active !== INSTITUTE_ID) {
        console.error(`ABORT: active institute "${active}" !== demo "${INSTITUTE_ID}"`);
        await browser.close();
        process.exit(2);
    }
    console.log(`institute lock OK (${active}) | submit=${allowSubmit}`);

    if (flow === 'teams-invite') {
        await shot('dashboard');

        await clickText('Manage Institute').catch((e) => console.log('  ! Manage Institute:', e.message));
        await wait(page, 1200);
        await shot('manage-institute-open');

        await clickText('Teams', { exact: true }).catch((e) => console.log('  ! Teams:', e.message));
        await wait(page, 2500);
        await page.waitForLoadState('networkidle').catch(() => {});
        await shot('teams');

        await clickText('Invite Users').catch((e) => console.log('  ! Invite Users:', e.message));
        await wait(page, 1800);
        await shot('invite-modal');

        // Fill name + email (modal-scoped placeholders → unambiguous)
        await page.getByPlaceholder('Full name (First and Last)').fill('Priya Sharma').catch((e) => console.log('  ! name:', e.message));
        await page.getByPlaceholder('Enter Email').fill('walkthrough.demo@example.com').catch((e) => console.log('  ! email:', e.message));
        await wait(page, 500);
        await shot('filled');

        // Pick a role (needed to enable submit)
        await clickText('Select options').catch((e) => console.log('  ! role open:', e.message));
        await wait(page, 900);
        await shot('role-open');
        // The options are a plain floating list below the trigger; "Admin" also
        // appears in the table behind, so pick the one positioned below the trigger.
        const rolePicked = await page.evaluate(() => {
            const els = [...document.querySelectorAll('div,li,span,button,a,[role]')];
            const cand = els.find(
                (el) =>
                    el.textContent &&
                    el.textContent.trim() === 'Admin' &&
                    el.getBoundingClientRect().top > 545 &&
                    el.getBoundingClientRect().width > 0 &&
                    el.offsetParent !== null
            );
            if (cand) {
                cand.click();
                return true;
            }
            return false;
        });
        console.log('  role picked:', rolePicked);
        await wait(page, 700);
        await page.keyboard.press('Escape').catch(() => {});
        await wait(page, 600);
        await shot('role-picked');

        // Submit — only if explicitly allowed AND the button is enabled
        const submitBtn = page.getByRole('button', { name: 'Invite User', exact: true }).last();
        const enabled = await submitBtn.isEnabled().catch(() => false);
        console.log('  submit enabled:', enabled, '| allowSubmit:', allowSubmit);
        if (allowSubmit && enabled) {
            await submitBtn.click().catch((e) => console.log('  ! submit:', e.message));
            await page.waitForLoadState('networkidle').catch(() => {});
            await wait(page, 3000);
            await shot('success');
            console.log('  invite submitted (example.com — no real recipient).');
        } else {
            console.log('  NOT submitting (either --submit not passed or button disabled).');
        }

        console.log('teams-invite capture done.');
    } else {
        console.error('Unknown flow:', flow);
    }

    await browser.close();
    console.log('capture done.');
})();
