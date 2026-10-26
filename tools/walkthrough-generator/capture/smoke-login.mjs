/**
 * smoke-login — logs in as the demo admin, verifies the session is scoped to the
 * configured demo institute, screenshots the landing page, and saves the auth
 * state for reuse. The safety network guard is active (blocks comms/payment
 * sends + any DELETE). No flow actions are performed.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_USERNAME', 'VACADEMY_PASSWORD', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const outDir = join(TOOL_ROOT, 'capture', '_inspect');
mkdirSync(outDir, { recursive: true });

// ---- Safety guard: block side-effecting writes (never reached in this smoke) --
const BLOCK = [
    /whatsapp/i, /\/sms\b/i, /exotel/i, /telephony.*call/i, /\/send\b/i, /notification-service\/.*(send|dispatch)/i,
    /razorpay/i, /stripe/i, /cashfree/i, /payment-?gateway/i, /\/pay(ment)?\b/i, /checkout/i,
    /user-invitation\/invite/i,
];
function installGuard(context) {
    return context.route('**', (route) => {
        const req = route.request();
        const method = req.method();
        const url = req.url();
        if (method === 'DELETE') return route.abort();
        if (method !== 'GET' && method !== 'HEAD' && BLOCK.some((re) => re.test(url))) {
            console.log('  [guard] blocked', method, url.slice(0, 90));
            return route.abort();
        }
        return route.continue();
    });
}

function decodeJwt(token) {
    try {
        const p = token.split('.')[1];
        const json = Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        return JSON.parse(json);
    } catch {
        return null;
    }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await installGuard(context);
const page = await context.newPage();

console.log('-> opening login');
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('input[name="username"]', { timeout: 15000 });
await page.fill('input[name="username"]', env.VACADEMY_USERNAME);
await page.fill('input[name="password"]', env.VACADEMY_PASSWORD);
console.log('-> submitting login');
await Promise.all([
    page.getByRole('button', { name: 'Login', exact: true }).click(),
]);

// Wait for client-side navigation away from /login (or up to 18s).
await page.waitForTimeout(1500);
try {
    await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 18000 });
} catch {
    /* may stay on /login if an extra step appears; we report below */
}
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2500);

const url = page.url();
console.log('post-login url:', url);

// Cookies + localStorage + token/institute check
const cookies = await context.cookies();
const cookieNames = cookies.map((c) => c.name);
console.log('cookies:', JSON.stringify(cookieNames));

const ls = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        o[k] = (localStorage.getItem(k) || '').slice(0, 40);
    }
    return o;
});
console.log('localStorage keys:', JSON.stringify(Object.keys(ls)));

// Find a JWT among cookies + localStorage and check the institute
const candidates = [];
for (const c of cookies) candidates.push(c.value);
const lsFull = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
});
for (const v of Object.values(lsFull)) if (typeof v === 'string') candidates.push(v);

let instituteOk = false;
let tokenSeen = false;
for (const val of candidates) {
    if (!val || val.split('.').length !== 3) continue;
    const payload = decodeJwt(val);
    if (!payload) continue;
    tokenSeen = true;
    const blob = JSON.stringify(payload);
    if (blob.includes(INSTITUTE_ID)) instituteOk = true;
    if (payload.authorities) console.log('token authorities institutes:', JSON.stringify(Object.keys(payload.authorities)));
    if ('is_root_user' in payload) console.log('token is_root_user:', payload.is_root_user);
}
console.log('JWT found:', tokenSeen, '| matches demo institute:', instituteOk);

await page.screenshot({ path: join(outDir, '03-postlogin.png'), fullPage: false });
console.log('screenshot:', join(outDir, '03-postlogin.png'));

// If we appear NOT logged in (still on /login) dump page controls to iterate.
if (url.includes('/login')) {
    const probe = await page.evaluate(() => ({
        buttons: [...document.querySelectorAll('button,[role="button"],a')]
            .map((b) => (b.innerText || '').trim()).filter((t) => t && t.length < 40).slice(0, 30),
        bodyText: document.body.innerText.slice(0, 400),
    }));
    console.log('STILL ON LOGIN. controls:', JSON.stringify(probe.buttons));
    console.log('bodyText:', probe.bodyText);
}

if (!url.includes('/login')) {
    await context.storageState({ path: join(TOOL_ROOT, 'auth-state.json') });
    console.log('saved auth-state.json');
}

await browser.close();
console.log('smoke-login done.');
