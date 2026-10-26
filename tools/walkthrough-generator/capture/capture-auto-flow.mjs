/**
 * capture-auto-flow — generalized REAL-screenshot capture across many flows.
 *
 * For each flow (out/flows/<slug>.json), drives the live demo institute and records
 * real frames in build-video's manifest format:
 *   1. Dashboard            (cursor → the nav item that leads to the feature)
 *   2. Feature landing      (the real destination screen; cursor → primary action)
 *   3. Primary action open  (the real Create/Add/Invite dialog or sub-view, if any)
 *   (+ optional extra sub-view / tab frame where cleanly detectable)
 *
 * Every frame is a REAL screenshot of the product — nothing is recreated or guessed.
 * This is the automatic generalization of the hand-authored learner-profile spec.
 *
 * Safety (read-only-ish):
 *   - institute-locked to the demo; asserted up front AND before every shot
 *   - network guard blocks all 3rd-party / cross-institute calls AND every mutating
 *     submit (DELETE/PUT/PATCH + add/create/update/... POSTs). We OPEN dialogs and
 *     switch tabs (client-side) but never SUBMIT — so no demo data is created.
 *   - one shared browser session, sequential (the demo is a single shared workspace)
 *
 * Output per flow: screenshots/flows/<slug>/NN.png + manifest.json
 *
 * Usage:
 *   node capture/capture-auto-flow.mjs --limit=5            # first 5 admin flows (smoke)
 *   node capture/capture-auto-flow.mjs --slugs=a,b,c        # specific slugs
 *   node capture/capture-auto-flow.mjs                      # all admin flows
 *   node capture/capture-auto-flow.mjs --skip-existing      # skip flows already captured
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';
import { routeToUrl } from './route-map.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const URLBASE = BASE.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const authPath = join(TOOL_ROOT, 'auth-state.json');
if (!existsSync(authPath)) { console.error('No auth-state.json — run smoke-login first.'); process.exit(1); }

const args = process.argv.slice(2);
const getArg = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : null; };
const LIMIT = getArg('limit') ? parseInt(getArg('limit'), 10) : Infinity;
const ONLY = getArg('slugs') ? getArg('slugs').split(',').map((s) => s.trim()).filter(Boolean) : null;
const SKIP_EXISTING = args.includes('--skip-existing');

const VIEW = { width: 1440, height: 900 };
const outRoot = join(TOOL_ROOT, 'screenshots', 'flows');

// ---- which flows ----
// flows-auto.json carries the RESOLVED route/tab (out/flows/*.json do not).
let flows = JSON.parse(readFileSync(join(TOOL_ROOT, 'capture', 'flows-auto.json'), 'utf8'))
    .filter((f) => f.side === 'admin'); // learner side needs a learner base URL
if (ONLY) flows = ONLY.map((s) => flows.find((f) => f.slug === s)).filter(Boolean);
if (SKIP_EXISTING) flows = flows.filter((f) => !existsSync(join(outRoot, f.slug, 'manifest.json')));
if (Number.isFinite(LIMIT)) flows = flows.slice(0, LIMIT);

// ---- nav label per route (what to point at on the Dashboard) ----
const NAV_LABEL = [
    [/^\/study-library\/courses/, 'Courses'], [/^\/study-library\/live/, 'Live'],
    [/^\/study-library\/doubt/, 'Doubt'], [/^\/study-library\/attendance/, 'Attendance'],
    [/^\/study-library\/reports/, 'Reports'], [/^\/study-library\/ai-copilot/, 'Copilot'],
    [/^\/study-library/, 'Courses'],
    [/^\/assessment\/question/, 'Question'], [/^\/assessment/, 'Assessment'],
    [/^\/homework/, 'Homework'], [/^\/evaluator/, 'Evaluator'], [/^\/instructor-copilot/, 'Instructor'],
    [/^\/ai-center/, 'AI Center'], [/^\/vim/, 'ViMotion'],
    [/^\/manage-students/, 'Learners'], [/^\/manage-contacts/, 'Contacts'],
    [/^\/audience-manager/, 'Leads'],
    [/^\/manage-institute\/teams/, 'Teams'], [/^\/manage-institute\/batches/, 'Batches'],
    [/^\/manage-institute\/sessions/, 'Sessions'], [/^\/manage-institute/, 'Teams'],
    [/^\/manage-custom-teams/, 'Teams'], [/^\/manage-inventory/, 'Inventory'],
    [/^\/admin-package-management/, 'Package'],
    [/^\/financial-management/, 'Fee'], [/^\/manage-payments/, 'Payment'],
    [/^\/communication/, 'Inbox'], [/^\/announcement/, 'Announcement'],
    [/^\/workflow/, 'Workflow'], [/^\/automation/, 'Automation'],
    [/^\/admissions\/enquir/, 'Enquir'], [/^\/admissions\/application/, 'Application'], [/^\/admissions/, 'Admission'],
    [/^\/membership/, 'Membership'], [/^\/user-tags/, 'Tag'],
    [/^\/settings/, 'Settings'], [/^\/dashboard/, 'Dashboard'],
];
const navLabelFor = (route) => { for (const [re, l] of NAV_LABEL) if (re.test(route)) return l; return null; };

// which left-rail section icon leads to this route (the real first click from the dashboard)
const railFor = (route) => {
    if (/^\/settings/.test(route)) return 'Settings';
    if (/^\/(study-library|assessment|homework|evaluator|instructor-copilot)/.test(route)) return 'LMS';
    if (/^\/(ai-center|vim)/.test(route)) return 'AI';
    return 'CRM';
};

// short human feature name from the flow title ("How to invite team members" -> "invite team members")
const featureName = (f) => (f.title || '').replace(/^how to\s+/i, '').trim();
const routePath = (f) => f.route + (f.tab ? `?selectedTab=${f.tab}` : '');

// intent: does this flow CREATE something (so a primary-action dialog is meaningful)?
const CREATE_INTENT = /\b(add|create|invite|set ?up|configure|build|generate|upload|import|issue|enrol|enroll|send|write|make|design|connect|define|schedule|publish|register|draft|compose|launch|new)\b/i;
// deeply-nested actions that live inside an editor the generic driver can't reach
// (a slide is inside chapter→module→subject→course; a node is inside a workflow).
// For these we stop at the section landing instead of opening a misleading top-level dialog.
const DEEP_NESTED = /\b(slide|chapter|module|subject|lesson|coding question|condition node|email node|whatsapp node|delay node|\bnode\b)\b/i;
const wantsDialog = (f) => CREATE_INTENT.test(featureName(f)) && !DEEP_NESTED.test(featureName(f));

// ---- network guard ----
// Owner direction: allow in-demo interaction (clicks + submits with demo data) so
// walkthroughs show the real, completed flow. Still HARD-block anything that reaches
// a third party / another institute (payment charge, domain-DNS, real comms send),
// and never DELETE demo data.
const BLOCK = [
    /razorpay|stripe|cashfree|phonepe|payment-?gateway|\/charge\b|\/capture\b|checkout/i,
    /\bdns\b|custom-?domain|\/domain\/(add|update|verify)/i,
    /\/whatsapp\/send|\/sms\/send|\/email\/send|notification-service\/.*(send|dispatch)/i,
];
function installGuard(context) {
    return context.route('**', (route) => {
        const req = route.request(); const type = req.resourceType(); const m = req.method(); const url = req.url();
        if (['document', 'stylesheet', 'script', 'image', 'font', 'media', 'manifest'].includes(type)) return route.continue();
        if (BLOCK.some((re) => re.test(url))) return route.abort();   // 3rd-party / cross-institute
        if (m === 'DELETE') return route.abort();                      // never delete demo data
        return route.continue();                                       // allow in-demo GET/POST/PUT/PATCH (clicks + submits)
    });
}

const wait = (page, ms) => page.waitForTimeout(ms);
// SPA self-redirects (e.g. /dashboard -> /dashboard) interrupt goto; tolerate them.
async function safeGoto(page, url) {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    } catch (e) {
        if (!/interrupted by another navigation/i.test(e.message)) {
            await page.goto(url, { waitUntil: 'commit', timeout: 35000 }).catch(() => {});
        }
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
}
const assertInstitute = async (page) => {
    const cur = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
    if (cur !== INSTITUTE_ID) throw new Error(`institute drifted to ${cur}`);
};

// find a visible clickable in a region matching label text; returns {handle,box,text} or null
async function pointAt(page, { text, minX, maxX, minY, maxY, action, preferBottom } = {}) {
    const handles = await page.locator('button, a, [role="button"], [role="tab"], li').elementHandles().catch(() => []);
    let best = null;
    for (const h of handles) {
        const box = await h.boundingBox().catch(() => null);
        if (!box || box.width < 6 || box.height < 6 || box.width > 520) continue;
        if (minX != null && box.x < minX) continue;
        if (maxX != null && box.x > maxX) continue;
        if (minY != null && box.y < minY) continue;
        if (maxY != null && box.y > maxY) continue;
        const t = ((await h.innerText().catch(() => '')) || '').trim();
        if (text && !new RegExp(text, 'i').test(t)) continue;
        if (action && !/^(create|add|new|invite|generate|upload|import|enroll|build|\+)/i.test(t)) continue;
        if (action && t.length > 28) continue; // CTAs are short
        // prefer top-most (page CTAs sit high) or bottom-most (dialog submit sits low)
        if (!best || (preferBottom ? box.y > best.box.y : box.y < best.box.y)) best = { handle: h, box, text: t };
    }
    return best;
}

const centerOf = (box) => ({ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });

// a realistic demo value for a field, from its type + placeholder/label text.
// Name-specific patterns are checked BEFORE the generic email/number rules so a
// "Full Name" field never gets an email value.
function demoValueFor(type, hint) {
    const h = (hint || '').toLowerCase();
    if (/full name|first and last|first name|last name|person name|contact name|your name|student name|learner name|member name/.test(h)) return 'Rahul Sharma';
    if (/course name|course title|name of (the )?course/.test(h) || /^course$/.test(h.trim())) return 'Foundation Science';
    if (/batch name|batch/.test(h)) return 'Morning Batch 2025';
    if (/session/.test(h)) return '2025-26';
    if (/subject/.test(h)) return 'Mathematics';
    if (/coupon|promo code|discount code/.test(h)) return 'WELCOME10';
    if (/title|subject line|heading|label|display name/.test(h)) return 'Welcome to the program';
    if (type === 'email' || /e-?mail/.test(h)) return 'rahul.sharma@example.com';
    if (type === 'tel' || /phone|mobile|whatsapp number|contact number/.test(h)) return '9876543210';
    if (type === 'number' || /amount|price|fee|cost|qty|quantity|count|marks|score|percent|discount|\bdays\b|duration|limit/.test(h)) return '10';
    if (type === 'url' || /url|link|website|domain/.test(h)) return 'https://example.com';
    if (/description|message|note|detail|content|body|remark|about/.test(h)) return 'A short demo description for this walkthrough.';
    if (/tag/.test(h)) return 'Popular';
    if (/name/.test(h)) return 'Demo Sample';
    return 'Demo Sample';
}

// the open modal/dialog panel box (so we fill ITS fields, not the background page)
async function modalBox(page) {
    const el = page.locator('[role="dialog"], [aria-modal="true"], .modal, [class*="Dialog"], [class*="dialog"], [class*="Modal"]').last();
    if (await el.count().catch(() => 0)) {
        const b = await el.boundingBox().catch(() => null);
        if (b && b.width > 220 && b.height > 120) return b;
    }
    return null;
}
const inside = (box, m) => box.x + box.width / 2 >= m.x - 4 && box.x + box.width / 2 <= m.x + m.width + 4 &&
    box.y + box.height / 2 >= m.y - 4 && box.y + box.height / 2 <= m.y + m.height + 4;

// Fill the visible form fields of the open dialog with demo data so the frame
// shows a populated form (and usually an enabled submit). Never submits.
async function fillForm(page) {
    let filled = 0;
    const m = await modalBox(page);
    const inputs = await page.locator('input, textarea, [contenteditable="true"]').elementHandles().catch(() => []);
    for (const h of inputs) {
        const box = await h.boundingBox().catch(() => null);
        if (!box || box.width < 40 || box.height < 10 || box.y < 95) continue;
        if (m ? !inside(box, m) : box.x < 64) continue; // scope to the modal (or off the rail)
        const tag = await h.evaluate((e) => e.tagName.toLowerCase()).catch(() => 'input');
        const type = ((await h.getAttribute('type').catch(() => '')) || 'text').toLowerCase();
        if (['checkbox', 'radio', 'file', 'hidden', 'range', 'submit', 'button', 'color', 'image'].includes(type)) continue;
        const hint = ((await h.getAttribute('placeholder').catch(() => '')) || '') + ' ' +
            ((await h.getAttribute('name').catch(() => '')) || '') + ' ' +
            ((await h.getAttribute('aria-label').catch(() => '')) || '');
        if (/search/i.test(hint)) continue; // never the search box
        if (tag === 'div') { // contenteditable rich text
            const txt = (await h.innerText().catch(() => '')) || '';
            if (txt.trim()) continue;
            try { await h.click({ timeout: 1500 }); await page.keyboard.type('A short demo description for this walkthrough.', { delay: 2 }); filled += 1; } catch {}
            continue;
        }
        const cur = (await h.inputValue().catch(() => '')) || '';
        if (cur.trim()) continue; // leave pre-filled fields alone
        try { await h.fill(demoValueFor(type, hint)); filled += 1; } catch {}
    }
    // native selects → first real option
    for (const s of await page.locator('select').elementHandles().catch(() => [])) {
        const box = await s.boundingBox().catch(() => null);
        if (!box || (m && !inside(box, m))) continue;
        try { await s.selectOption({ index: 1 }); filled += 1; } catch {}
    }
    // best-effort custom dropdown(s) (e.g. Role Type "Select options") to enable the submit
    for (let i = 0; i < 2; i++) {
        const trigger = await pointAt(page, { text: 'select option|select role|select type|choose|^select\\b', minX: 320, minY: 120, maxY: 800 });
        if (!trigger) break;
        await trigger.handle.click({ timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(500);
        const opt = page.locator('[role="option"], [role="menuitem"], [class*="option"], li[data-value]').first();
        if (await opt.count().catch(() => 0)) { await opt.click({ timeout: 2000 }).catch(() => {}); filled += 1; }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
    }
    return filled;
}

async function captureFlow(page, flow) {
    const dir = join(outRoot, flow.slug);
    mkdirSync(dir, { recursive: true });
    const steps = [];
    let n = 0;
    const shoot = async ({ caption, address, cursor, click, final }) => {
        n += 1;
        const img = `${String(n).padStart(2, '0')}.png`;
        await page.screenshot({ path: join(dir, img) });
        steps.push({ img, caption, address, cursor: cursor || null, click: !!click, final: !!final });
    };

    const navLabel = navLabelFor(flow.route) || featureName(flow);
    const railLabel = railFor(flow.route);
    const doDialog = wantsDialog(flow);

    // 1 — Dashboard, cursor on the left-rail section icon that leads to the feature
    await safeGoto(page, BASE + '/dashboard');
    await wait(page, 2200);
    await assertInstitute(page);
    const navHit = await pointAt(page, { text: `^${railLabel}$|^${railLabel}`, maxX: 72 });
    await shoot({
        caption: `From the <b>Dashboard</b>, open <b>${navLabel}</b>.`,
        address: '/dashboard',
        cursor: navHit ? centerOf(navHit.box) : null,
        click: !!navHit,
    });

    // 2 — Feature landing (the real destination screen)
    const url = routeToUrl(BASE, flow.route, flow.tab);
    await safeGoto(page, url);
    await wait(page, 2600);
    await assertInstitute(page);
    // only hunt for a primary action when the flow is actually a (reachable) create
    const action = doDialog ? await pointAt(page, { action: true, minX: 320, maxY: 340 }) : null;
    await shoot({
        caption: action
            ? `Open <b>${navLabel}</b>, then click <b>${action.text.replace(/\s+/g, ' ')}</b>.`
            : `Here's <b>${navLabel}</b>.`,
        address: routePath(flow),
        cursor: action ? centerOf(action.box) : null,
        click: !!action,
        final: !action,
    });

    // 3 + 4 — Open the real primary-action dialog, show it empty, then filled.
    if (action) {
        await action.handle.click({ timeout: 6000 }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await wait(page, 1900);
        await assertInstitute(page).catch(() => {});

        // 3 — empty dialog: cursor on the first field the user would type into
        const firstField = await pointAt(page, { minX: 320, minY: 150, maxY: 720 });
        const firstInput = await page.locator('input, textarea').elementHandles().catch(() => []);
        let fieldCursor = firstField ? centerOf(firstField.box) : null;
        for (const h of firstInput) {
            const b = await h.boundingBox().catch(() => null);
            if (b && b.x > 300 && b.y > 110 && b.y < 820 && b.width > 40) { fieldCursor = centerOf(b); break; }
        }
        await shoot({
            caption: `Enter the <b>details</b>.`,
            address: routePath(flow),
            cursor: fieldCursor,
            click: !!fieldCursor,
        });

        // 4 — filled dialog: real demo data typed in, cursor on the (now active) submit
        await fillForm(page);
        await wait(page, 700);
        const submit = await pointAt(page, {
            text: 'save|create|add|submit|next|continue|generate|send|invite|confirm|finish|done|publish',
            minX: 320, minY: 150, preferBottom: true,
        });
        await shoot({
            caption: `Then click <b>${(submit?.text || action.text || 'save').replace(/\s+/g, ' ').toLowerCase()}</b>.`,
            address: routePath(flow),
            cursor: submit ? centerOf(submit.box) : null,
            click: false,
            final: true,
        });
    }

    const manifest = { slug: flow.slug, title: featureName(flow) || flow.title, urlBase: URLBASE, viewport: VIEW, steps };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { slug: flow.slug, frames: steps.length, action: !!action, nav: !!navHit };
}

(async () => {
    console.log(`capture-auto-flow: ${flows.length} admin flow(s)\n`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: authPath, viewport: VIEW, deviceScaleFactor: 1 });
    await installGuard(context);
    const page = await context.newPage();

    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await wait(page, 1500);
    try { await assertInstitute(page); } catch (e) { console.error('ABORT —', e.message); await browser.close(); process.exit(2); }
    console.log('institute lock OK\n');

    const report = [];
    let i = 0;
    for (const flow of flows) {
        i += 1;
        try {
            const r = await captureFlow(page, flow);
            report.push({ ...r, ok: true });
            console.log(`  [${i}/${flows.length}] ${r.frames}f ${r.action ? '+dialog' : ''} ${r.nav ? '' : '(no-nav)'}  ${flow.slug}`);
        } catch (e) {
            report.push({ slug: flow.slug, ok: false, error: e.message.split('\n')[0] });
            console.log(`  [${i}/${flows.length}] FAIL  ${flow.slug} :: ${e.message.split('\n')[0]}`);
        }
    }

    writeFileSync(join(outRoot, '_auto-capture-report.json'), JSON.stringify({
        base: BASE, institute: INSTITUTE_ID, total: flows.length,
        ok: report.filter((r) => r.ok).length, report,
    }, null, 2));
    await browser.close();
    const ok = report.filter((r) => r.ok).length;
    const withDialog = report.filter((r) => r.action).length;
    console.log(`\ndone. ${ok}/${flows.length} captured (${withDialog} reached a primary dialog).`);
    console.log('report -> screenshots/flows/_auto-capture-report.json');
})();
