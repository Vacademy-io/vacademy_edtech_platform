/**
 * engine — runs an AUTHORED flow spec against the live demo institute and records
 * a real screenshot per step, plus the cursor target + caption + address-bar path.
 * The video is 100% real UI (build-video animates a ghost cursor over these frames).
 *
 * Unlike the generic auto-driver, each flow here is hand-authored, so it performs
 * the COMPLETE end-to-end task: navigate the real path, click the right control,
 * fill the form with demo data, advance through every step, submit, show the result.
 *
 * Shared-screen cache: a step tagged `screen:'<id>'` is captured ONCE; later flows
 * reuse the cached image (same real screenshot) instead of re-shooting it — fast,
 * lossless. The live browser is still positioned so the flow can continue.
 *
 * Safety: institute-locked to the demo; allows in-demo clicks/fills/submits per
 * owner direction, but HARD-blocks 3rd-party / cross-institute calls (payment,
 * domain-DNS, real comms send) and never DELETEs.
 *
 * Step DSL (every field optional unless noted):
 *   goto:'/path'          navigate first (full navigation)
 *   navRail:'CRM'         click a left-rail section to advance (CRM|LMS|AI|Settings)
 *   navClick:{text,region}click something to advance to this frame's screen
 *   path:'/x'             address-bar path to show on this frame
 *   screen:'id'           shared-screen cache id (reuse/store the image)
 *   caption:'...'         one short line (<b>bold</b> key nouns)
 *   point:{...}           what the cursor points at on THIS frame:
 *                           {text,region} | {coords:[x,y]} | {firstField:true} | {submit:true}
 *                           {field:'regex'} a specific control by placeholder/aria/label/id
 *                           {sel:'css'} a specific element by CSS selector (e.g. '#sessions-no')
 *                           any point may add scroll:true to reveal an off-screen target first
 *   then:{...}            advance AFTER the shot:
 *                           {clickPoint:true} click the pointed element
 *                           {click:{text,region}} click something else
 *                           {clickSel:'css'} click an element by CSS selector
 *                           {fill:true} fill the open form (typed as progressive snapshots)
 *                           {type:{field:'regex',value,clear?}} type into ONE matched field (clear:true replaces its value)
 *                           {set:{field?|sel?,value}} fill a field directly (dates / native inputs)
 *                           {select:{trigger,option,caption,commit?}} open a dropdown, show it, pick option (commit:false = show only, don't change)
 *                           {submit:{text?}} click the submit/primary button
 *                           wait:ms extra settle after the action
 *   settle:ms             extra settle after goto/navRail
 *   final:true            last frame (no advance)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
export const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
export const URLBASE = BASE.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const authPath = join(TOOL_ROOT, 'auth-state.json');
const VIEW = { width: 1440, height: 900 };
const cacheDir = join(TOOL_ROOT, 'screens', '_cache');

const REGIONS = { rail: [0, 74], sidebar: [0, 300], content: [300, 1440], any: [0, 1440] };
const SUBMIT_RE = 'invite user|create|save|submit|^next|continue|finish|done|publish|^add|generate|send|confirm|apply';

const wait = (page, ms) => page.waitForTimeout(ms);
const pad = (n) => String(n).padStart(2, '0');
const centerOf = (b) => ({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });

const BLOCK = [
    /razorpay|stripe|cashfree|phonepe|payment-?gateway|\/charge\b|\/capture\b|checkout/i,
    /\bdns\b|custom-?domain|\/domain\/(add|update|verify)/i,
    /\/whatsapp\/send|\/sms\/send|\/email\/send|notification-service\/.*(send|dispatch)/i,
];
function installGuard(context) {
    return context.route('**', (route) => {
        const req = route.request(); const type = req.resourceType(); const m = req.method(); const url = req.url();
        if (['document', 'stylesheet', 'script', 'image', 'font', 'media', 'manifest'].includes(type)) return route.continue();
        if (BLOCK.some((re) => re.test(url))) return route.abort();
        if (m === 'DELETE') return route.abort();
        return route.continue();
    });
}

async function safeGoto(page, url) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 }); }
    catch (e) { if (!/interrupted by another navigation/i.test(e.message)) await page.goto(url, { waitUntil: 'commit', timeout: 35000 }).catch(() => {}); }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
}
const assertInstitute = async (page) => {
    const cur = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
    if (cur !== INSTITUTE_ID) throw new Error(`institute drifted to ${cur}`);
};

// find a visible clickable matching `text` (string regex) within a region
async function findByText(page, text, region = 'any', preferBottom = false) {
    const [minX, maxX] = REGIONS[region] || REGIONS.any;
    const re = text ? new RegExp(text, 'i') : null;
    const handles = await page.locator('button, a, [role="button"], [role="tab"], [role="option"], li, .cursor-pointer').elementHandles().catch(() => []);
    let best = null;
    for (const h of handles) {
        const box = await h.boundingBox().catch(() => null);
        if (!box || box.width < 6 || box.height < 6 || box.width > 560) continue;
        const cx = box.x + box.width / 2;
        if (cx < minX || cx > maxX) continue;
        if (box.y < 40) continue;
        const t = ((await h.innerText().catch(() => '')) || '').trim();
        const head = (t.split('\n')[0] || '').trim(); // first line = the title/label (cards carry a description below it)
        if (re && !re.test(t)) continue;
        if (re && head.length > 40) continue; // judge length by the first line, so a titled card with a description still matches
        if (!best || (preferBottom ? box.y > best.box.y : box.y < best.box.y)) best = { handle: h, box, text: head };
    }
    return best;
}

// Cursor target for the "name your X" frame: the FIRST field the form-fill will
// actually type into — so the ghost cursor lands on that field, not empty space.
// Mirrors fillForm's selection (modal-scoped, skips search/hidden/non-text), and
// crucially does NOT assume fields start past x=300 — modal fields commonly begin
// near x≈128, which the old `b.x > 300` filter skipped (cursor floated off-target).
async function firstFieldCursor(page) {
    const m = await modalBox(page);
    for (const h of await page.locator('input, textarea, [contenteditable="true"]').elementHandles().catch(() => [])) {
        const b = await h.boundingBox().catch(() => null);
        if (!b || b.width < 60 || b.height < 10 || b.y < 110 || b.y > 820) continue;
        if (m ? !inside(b, m) : b.x < 64) continue;
        const type = ((await h.getAttribute('type').catch(() => '')) || 'text').toLowerCase();
        if (['checkbox', 'radio', 'file', 'hidden', 'range', 'submit', 'button', 'color', 'image'].includes(type)) continue;
        const hint = ((await h.getAttribute('placeholder').catch(() => '')) || '') + ' ' +
            ((await h.getAttribute('name').catch(() => '')) || '') + ' ' +
            ((await h.getAttribute('aria-label').catch(() => '')) || '');
        if (/search/i.test(hint)) continue;
        return centerOf(b);
    }
    return null;
}

// Locate a SPECIFIC control by its placeholder / aria-label / name / id / associated
// <label> text (regex). Lets a flow point precisely at e.g. the "Theme / Color",
// "Domain", or "Currency" control (incl. Radix Select triggers) without fragile
// coordinates. Returns {handle, box} for both the cursor and optional typing.
async function findField(page, labelRe) {
    const re = new RegExp(labelRe, 'i');
    const m = await modalBox(page);
    for (const h of await page.locator('input, textarea, select, [role="combobox"], [role="spinbutton"]').elementHandles().catch(() => [])) {
        const b = await h.boundingBox().catch(() => null);
        if (!b || b.width < 40 || b.height < 10 || b.y < 95 || b.y > 3000) continue; // allow below-the-fold fields (scroll brings them in)
        if (m && !inside(b, m)) continue;
        const at = async (a) => ((await h.getAttribute(a).catch(() => '')) || '');
        const id = await at('id');
        let lbl = '';
        if (id) lbl = (await page.locator(`label[for="${id}"]`).first().innerText().catch(() => '')) || '';
        if ([await at('placeholder'), await at('aria-label'), await at('name'), id, lbl].some((s) => re.test(s))) return { handle: h, box: b };
    }
    return null;
}
const fieldCursor = async (page, re) => { const f = await findField(page, re); return f ? centerOf(f.box) : null; };

// ---- demo-data form fill (scoped to the open modal) -------------------------
function demoValueFor(type, hint) {
    const h = (hint || '').toLowerCase();
    if (/full name|first and last|first name|last name|person name|contact name|your name|student name|learner name|member name/.test(h)) return 'Rahul Sharma';
    if (/course name|course title|name of (the )?course/.test(h) || /^course$/.test(h.trim())) return 'Foundation Science';
    if (/level/.test(h)) return 'Beginner';
    if (/batch/.test(h)) return 'Morning Batch 2025';
    if (/session/.test(h)) return '2025-26';
    if (/subject/.test(h)) return 'Mathematics';
    if (/module/.test(h)) return 'Algebra Basics';
    if (/chapter/.test(h)) return 'Introduction';
    if (/coupon|promo code|discount code/.test(h)) return 'WELCOME10';
    if (/workflow|automation/.test(h)) return 'Welcome Nurture';
    if (/pool/.test(h)) return 'North Zone Pool';
    if (/role/.test(h)) return 'Admin';
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
async function modalBox(page) {
    const el = page.locator('[role="dialog"], [aria-modal="true"], .modal, [class*="Dialog"], [class*="dialog"], [class*="Modal"]').last();
    if (await el.count().catch(() => 0)) { const b = await el.boundingBox().catch(() => null); if (b && b.width > 220 && b.height > 120) return b; }
    return null;
}
const inside = (box, m) => box.x + box.width / 2 >= m.x - 4 && box.x + box.width / 2 <= m.x + m.width + 4 &&
    box.y + box.height / 2 >= m.y - 4 && box.y + box.height / 2 <= m.y + m.height + 4;
// chunk a value into a few incremental pieces, so typing can be captured as a
// handful of progressive snapshots (reads as "someone writing").
function chunkValue(v) {
    const n = Math.max(2, Math.min(4, Math.round(v.length / 7)));
    const size = Math.ceil(v.length / n);
    const out = [];
    for (let i = 0; i < v.length; i += size) out.push(v.slice(i, i + size));
    return out;
}
// type a value into a field, emitting a snapshot after each chunk so the player
// shows the text being written rather than appearing all at once.
async function typeAnimated(page, h, value, shoot, ctx, clear = false) {
    await h.scrollIntoViewIfNeeded().catch(() => {}); // bring below-fold fields into view first
    await page.waitForTimeout(150);
    const box = await h.boundingBox().catch(() => null); // read box AFTER scroll so the cursor is on-screen
    const cur = box ? centerOf(box) : null;
    await h.click({ timeout: 1500 }).catch(() => {});
    // clear an existing value first (e.g. a rename: replace "Course" with "Programme")
    if (clear) { await page.keyboard.press('Control+a').catch(() => {}); await page.keyboard.press('Delete').catch(() => {}); await page.waitForTimeout(60); }
    for (const piece of chunkValue(value)) {
        await page.keyboard.type(piece, { delay: 12 });
        await page.waitForTimeout(70);
        await shoot({ caption: ctx.caption, address: ctx.address, cursor: cur, click: false, dur: 540 });
    }
}
async function fillForm(page, shoot, ctx) {
    let filled = 0;
    const m = await modalBox(page);
    for (const h of await page.locator('input, textarea, [contenteditable="true"]').elementHandles().catch(() => [])) {
        const box = await h.boundingBox().catch(() => null);
        if (!box || box.width < 40 || box.height < 10 || box.y < 95) continue;
        if (m ? !inside(box, m) : box.x < 64) continue;
        const tag = await h.evaluate((e) => e.tagName.toLowerCase()).catch(() => 'input');
        const type = ((await h.getAttribute('type').catch(() => '')) || 'text').toLowerCase();
        if (['checkbox', 'radio', 'file', 'hidden', 'range', 'submit', 'button', 'color', 'image'].includes(type)) continue;
        const hint = ((await h.getAttribute('placeholder').catch(() => '')) || '') + ' ' +
            ((await h.getAttribute('name').catch(() => '')) || '') + ' ' +
            ((await h.getAttribute('aria-label').catch(() => '')) || '');
        if (/search/i.test(hint)) continue;
        if (tag === 'div') {
            if (((await h.innerText().catch(() => '')) || '').trim()) continue;
            try { await typeAnimated(page, h, 'A short demo description for this walkthrough.', shoot, ctx); filled++; } catch {}
            continue;
        }
        if (((await h.inputValue().catch(() => '')) || '').trim()) continue;
        try { await typeAnimated(page, h, demoValueFor(type, hint), shoot, ctx); filled++; } catch {}
    }
    for (const s of await page.locator('select').elementHandles().catch(() => [])) {
        const box = await s.boundingBox().catch(() => null);
        if (!box || (m && !inside(box, m))) continue;
        try { await s.selectOption({ index: 1 }); filled++; } catch {}
    }
    return filled;
}
// open a custom dropdown and pick an option. `sel` is {trigger, option?} (option
// is the visible option text to click; if omitted, the first option is chosen).
// The option is matched ONLY in the popup that opens BELOW the trigger, so we never
// click a same-named element in the background page (e.g. a role chip in the table).
async function selectDropdown(page, sel, shoot, ctx) {
    const spec = typeof sel === 'string' ? { trigger: sel } : sel;
    const trigger = await findByText(page, spec.trigger, 'content');
    if (!trigger) return false;
    const ty = trigger.box.y + trigger.box.height;
    await trigger.handle.click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(750);
    // The option popup is its own layer; options render as <label>/<div>/[role=option]
    // BELOW the trigger. Find by exact text (the robust method) in the popup region.
    const findOption = async (loc) => {
        for (const o of await loc.all().catch(() => [])) {
            const b = await o.boundingBox().catch(() => null);
            if (!b || b.y <= ty - 2 || b.width <= 8) continue;
            const t = ((await o.innerText().catch(() => '')) || '').trim();
            if (/clear all|clear fields|^reset$|^select\b/i.test(t)) continue; // skip "Clear All Fields"/reset utility items
            return { o, b };
        }
        return null;
    };
    let opt = spec.option ? await findOption(page.getByText(new RegExp(`^\\s*${spec.option}\\s*$`, 'i'))) : null;
    if (!opt) opt = await findOption(page.locator('[role="option"], [role="menuitem"], label'));
    // capture the OPEN dropdown — cursor moving onto the option, with a tap — so the
    // viewer sees the list and the choice instead of the option appearing instantly.
    if (opt && shoot) await shoot({ caption: spec.caption || ctx.caption, address: ctx.address, cursor: centerOf(opt.b), click: true, dur: 1700 });
    if (opt && spec.commit !== false) { await opt.o.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(400); }
    // Only Escape for commit:false (show-only, no option clicked) to close the open list.
    // After clicking an option the dropdown closes itself — pressing Escape here would also
    // close a parent Radix Dialog (which silently killed in-dialog dropdown flows).
    else if (spec.commit === false) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); }
    return !!opt;
}

// ---- run one authored flow ---------------------------------------------------
export async function runFlow(page, flow) {
    const dir = join(TOOL_ROOT, 'screenshots', 'flows', flow.slug);
    mkdirSync(dir, { recursive: true });
    const steps = [];
    let n = 0;
    let curPath = '/dashboard';

    // capture a frame: write the PNG (reusing a cached shared screen if asked) and
    // push its meta. fill/select call this to emit their own progressive sub-frames.
    const shoot = async (meta) => {
        n += 1;
        const img = `${pad(n)}.png`;
        const cachePath = meta.screen ? join(cacheDir, `${meta.screen}.png`) : null;
        if (cachePath && existsSync(cachePath)) copyFileSync(cachePath, join(dir, img));
        else { await page.screenshot({ path: join(dir, img) }); if (cachePath) { mkdirSync(cacheDir, { recursive: true }); copyFileSync(join(dir, img), cachePath); } }
        steps.push({ img, caption: meta.caption || '', address: meta.address || curPath, cursor: meta.cursor || null, click: !!meta.click, final: !!meta.final, ...(meta.dur ? { dur: meta.dur } : {}) });
    };

    for (const st of flow.steps) {
        if (st.goto) { await safeGoto(page, BASE + st.goto); await wait(page, st.settle || 2200); curPath = st.goto; }
        if (st.navRail) { const r = await findByText(page, `^${st.navRail}$|^${st.navRail}`, 'rail'); if (r) { await r.handle.click().catch(() => {}); await wait(page, st.settle || 1600); } }
        if (st.navClick) { const c = await findByText(page, st.navClick.text, st.navClick.region || 'sidebar'); if (c) { await c.handle.click().catch(() => {}); await wait(page, st.settle || 1800); } }
        if (st.path) curPath = st.path;
        await assertInstitute(page).catch(() => {});

        // resolve cursor target
        let cursor = null, pointEl = null;
        if (st.point) {
            // point:{...,scroll:true} brings a below-the-fold target (e.g. a Settings
            // grid card) into view before the shot, then re-reads its box so the cursor
            // sits on it in the captured frame. Opt-in, so existing flows are unchanged.
            const reveal = async (h, fallbackBox) => {
                if (st.point.scroll && h) { await h.scrollIntoViewIfNeeded().catch(() => {}); await wait(page, 380); }
                const nb = h ? await h.boundingBox().catch(() => null) : null;
                return nb || fallbackBox;
            };
            if (st.point.coords) cursor = { x: st.point.coords[0], y: st.point.coords[1] };
            else if (st.point.sel) { const h = await page.locator(st.point.sel).nth(st.point.nth || 0).elementHandle().catch(() => null); if (h) cursor = centerOf(await reveal(h, await h.boundingBox().catch(() => null))); }
            else if (st.point.firstField) cursor = await firstFieldCursor(page);
            else if (st.point.field) { const f = await findField(page, st.point.field); if (f) cursor = centerOf(await reveal(f.handle, f.box)); }
            else if (st.point.submit) { pointEl = await findByText(page, st.point.submitText || SUBMIT_RE, 'content', true); if (pointEl) { pointEl.box = await reveal(pointEl.handle, pointEl.box); cursor = centerOf(pointEl.box); } }
            else if (st.point.text) { pointEl = await findByText(page, st.point.text, st.point.region || 'any', st.point.bottom); if (pointEl) { pointEl.box = await reveal(pointEl.handle, pointEl.box); cursor = centerOf(pointEl.box); } }
        }

        // shot (reuse cached shared screen if present)
        const advancing = !!(st.then && (st.then.clickPoint || st.then.click || st.then.clickSel || st.then.submit || st.then.fill || st.then.select || st.then.type || st.then.set));
        await shoot({ caption: st.caption, address: curPath, cursor, click: advancing, final: !!st.final, screen: st.screen });

        // advance — fill/select/type emit their own progressive sub-frames via shoot
        if (st.then) {
            const ctx = { caption: st.caption || '', address: curPath };
            if (st.then.fill) { await fillForm(page, shoot, ctx); await wait(page, st.then.wait || 600); }
            // type into ONE specific field (matched like point.field) — writes it out
            // progressively. Use for the realism touch on a targeted input (domain, color…).
            if (st.then.type) { const f = await findField(page, st.then.type.field); if (f) await typeAnimated(page, f.handle, st.then.type.value, shoot, ctx, st.then.type.clear); await wait(page, st.then.wait || 400); }
            // set a value directly via Playwright fill (handles date / native inputs that
            // char-by-char typing can't). No progressive frames — the value just appears.
            if (st.then.set) { let h = null; if (st.then.set.sel) h = await page.locator(st.then.set.sel).nth(st.then.set.nth || 0).elementHandle().catch(() => null); else if (st.then.set.field) { const f = await findField(page, st.then.set.field); h = f && f.handle; } if (h) { await h.scrollIntoViewIfNeeded().catch(() => {}); await h.fill(String(st.then.set.value)).catch(() => {}); } await wait(page, st.then.wait || 300); }
            if (st.then.select) await selectDropdown(page, st.then.select, shoot, ctx);
            if (st.then.clickSel) { const el = page.locator(st.then.clickSel).first(); await el.scrollIntoViewIfNeeded().catch(() => {}); await el.click({ timeout: 6000 }).catch(() => {}); await page.waitForLoadState('networkidle').catch(() => {}); await wait(page, st.then.wait || 1000); }
            else if (st.then.clickPoint && pointEl) { await pointEl.handle.click({ timeout: 6000 }).catch(() => {}); await page.waitForLoadState('networkidle').catch(() => {}); await wait(page, st.then.wait || 1700); }
            else if (st.then.click) { const e = await findByText(page, st.then.click.text, st.then.click.region || 'content'); if (e) await e.handle.click({ timeout: 6000 }).catch(() => {}); await page.waitForLoadState('networkidle').catch(() => {}); await wait(page, st.then.wait || 1700); }
            else if (st.then.submit) { const e = await findByText(page, st.then.submit.text || SUBMIT_RE, 'content', true); if (e) await e.handle.click({ timeout: 6000 }).catch(() => {}); await page.waitForLoadState('networkidle').catch(() => {}); await wait(page, st.then.wait || 2200); }
        }
    }

    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ slug: flow.slug, title: flow.title, urlBase: URLBASE, viewport: VIEW, steps }, null, 2));
    return { frames: steps.length, withCursor: steps.filter((s) => s.cursor).length };
}

// Launch a FRESH browser, wait until the app is actually healthy (rail renders),
// assert the demo institute, and return {browser, page}. Returns null if the app
// stays down past maxWaitMin. Used by grind.mjs to isolate each flow in its own
// session so a mid-run app hang only costs one flow, not the whole queue.
export async function launchHealthyPage({ maxWaitMin = 4 } = {}) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: authPath, viewport: VIEW, deviceScaleFactor: 1 });
    await installGuard(context);
    const page = await context.newPage();
    const probes = Math.max(2, Math.round((maxWaitMin * 60) / 15));
    let healthy = false;
    for (let i = 0; i < probes && !healthy; i++) {
        await safeGoto(page, BASE + '/dashboard').catch(() => {});
        await wait(page, 3000);
        healthy = (await page.getByText(/^Settings$/).first().count().catch(() => 0)) > 0;
        if (!healthy) await wait(page, 12000);
    }
    if (!healthy) { await browser.close().catch(() => {}); return null; }
    await wait(page, 2500);
    try { await assertInstitute(page); } catch { await browser.close().catch(() => {}); return null; }
    return { browser, page };
}

// ---- runner ------------------------------------------------------------------
export async function runFlows(flows, { onlySlugs } = {}) {
    const pick = onlySlugs ? flows.filter((f) => onlySlugs.includes(f.slug)) : flows;
    console.log(`engine: ${pick.length} authored flow(s)\n`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: authPath, viewport: VIEW, deviceScaleFactor: 1 });
    await installGuard(context);
    const page = await context.newPage();
    // health-gate: the demo app intermittently hangs on load (blank/spinner, screenshot
    // timeouts). Probe /dashboard until the SPA actually renders (the rail's "Settings"
    // shows) before starting any flow — so a queued run self-starts once the app recovers.
    let healthy = false;
    const PROBES = 480; // ~2 hours of patience — keep waiting for the app to recover
    for (let probe = 0; probe < PROBES && !healthy; probe++) {
        await safeGoto(page, BASE + '/dashboard').catch(() => {});
        await wait(page, 3000);
        healthy = (await page.getByText(/^Settings$/).first().count().catch(() => 0)) > 0;
        if (!healthy) { if (probe % 4 === 0) console.log(`  app still down (probe ${probe + 1}/${PROBES}, ~${Math.round(probe * 15 / 60)} min) — waiting…`); await wait(page, 12000); }
    }
    if (!healthy) { console.error('ABORT — app never became responsive (waited ~2 h)'); await browser.close(); process.exit(3); }
    await wait(page, 2500); // settle once healthy
    try { await assertInstitute(page); } catch (e) { console.error('ABORT —', e.message); await browser.close(); process.exit(2); }
    console.log('institute lock OK (app healthy)\n');
    const report = [];
    let i = 0;
    for (const flow of pick) {
        i += 1;
        // The demo app intermittently hangs on load (a flow then resolves almost no
        // cursors). Detect that and RETRY the whole flow after re-warming — capture is
        // self-healing against transient hangs. A genuinely cursor-light flow (<=2 frames)
        // is accepted as-is.
        // self-verifying retry: a flow is "ok" only if cursors resolved AND (when the flow
        // declares flow.expect, a regex) a matching success toast/text is on the page right
        // after the final submit. Retry up to MAX, re-warming /dashboard between tries.
        const MAX = flow.expect ? 5 : 3;
        let res = { frames: 0, withCursor: 0 }, attempt = 0, ok = false, why = '';
        while (attempt < MAX && !ok) {
            attempt += 1;
            try {
                res = await runFlow(page, flow);
                const cursorsOk = res.frames <= 2 || res.withCursor >= 2;
                let expectOk = true;
                if (cursorsOk && flow.expect) {
                    const n = await page.getByText(new RegExp(flow.expect, 'i')).count().catch(() => 0);
                    expectOk = n > 0; if (!expectOk) why = `no success match /${flow.expect}/`;
                }
                if (!cursorsOk) why = `page hung (${res.withCursor}/${res.frames} cursors)`;
                ok = cursorsOk && expectOk;
            } catch (e) { why = e.message.split('\n')[0]; ok = false; }
            if (!ok && attempt < MAX) {
                console.log(`  [${i}/${pick.length}] retry ${attempt}/${MAX - 1} (${why}) ${flow.slug}`);
                await safeGoto(page, BASE + '/dashboard').catch(() => {}); await wait(page, 3500);
            }
        }
        report.push({ slug: flow.slug, frames: res.frames, ok, ...(ok ? {} : { error: why }) });
        console.log(`  [${i}/${pick.length}] ${ok ? res.frames + 'f ✓' : 'FAIL: ' + why}  ${flow.slug}`);
        await wait(page, 800); // small breather between flows to ease load on the demo
    }
    await browser.close();
    console.log(`\ndone. ${report.filter((r) => r.ok).length}/${pick.length} captured.`);
    return report;
}
