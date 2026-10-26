/**
 * inspect-learner — load the demo Learners list, open the first learner's
 * slide-over, and dump enough of the live DOM to author an exact deep-capture
 * (selectors for the open icon, the expand control, and the real tab/section
 * labels). Read-only; institute-locked; guarded.
 */
import { chromium } from 'playwright';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: join(TOOL_ROOT, 'auth-state.json'), viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(BASE + '/manage-students/students-list', { waitUntil: 'domcontentloaded', timeout: 35000 });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(3000);

const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
if (active !== INSTITUTE_ID) { console.error('ABORT institute', active); await browser.close(); process.exit(2); }
console.log('institute lock OK', active);

// Dump the first data row's clickable controls in the Details column.
const rowInfo = await page.evaluate(() => {
    const out = {};
    // find the header cell "Details" and the table-ish container
    const all = [...document.querySelectorAll('*')];
    // candidate open buttons: small buttons/anchors containing an svg, inside the list area
    const btns = [...document.querySelectorAll('button, a, [role="button"]')]
        .filter((b) => b.querySelector('svg') && b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().width < 60)
        .slice(0, 12)
        .map((b) => ({
            tag: b.tagName.toLowerCase(),
            cls: (b.className || '').toString().slice(0, 80),
            aria: b.getAttribute('aria-label') || '',
            rectTop: Math.round(b.getBoundingClientRect().top),
            rectLeft: Math.round(b.getBoundingClientRect().left),
        }));
    out.smallIconButtons = btns;
    // text of likely tab labels currently in DOM
    out.hasOverview = !!document.querySelector('*:not(script)') && document.body.innerText.includes('Overview');
    return out;
});
console.log('small icon buttons (candidates for the Details open icon):');
console.log(JSON.stringify(rowInfo.smallIconButtons, null, 2));

// Try to open the slide-over: click the first small icon button that sits in the
// left part of the row (the Details column is near the left).
const candidate = page.locator('button:has(svg), a:has(svg), [role="button"]:has(svg)');
const count = await candidate.count();
console.log('total svg-bearing clickables:', count);

// Click the icon in the Details column of the first row: it's the small one whose
// left position is well inside the table (after the checkbox). Heuristic: pick the
// small icon button with the smallest rectTop among those left<700.
await page.waitForTimeout(500);
let opened = false;
const handles = await candidate.elementHandles();
for (const h of handles) {
    const box = await h.boundingBox().catch(() => null);
    if (!box) continue;
    if (box.width > 0 && box.width < 50 && box.x > 380 && box.x < 760 && box.y > 380 && box.y < 900) {
        await h.click().catch(() => {});
        await page.waitForTimeout(2200);
        const txt = await page.evaluate(() => document.body.innerText);
        if (/Courses[\s\S]{0,40}Progress|Progress[\s\S]{0,40}Tests|Overview[\s\S]{0,40}Courses/.test(txt)) { opened = true; break; }
    }
}
console.log('slide-over opened:', opened);

if (opened) {
    await page.screenshot({ path: join(TOOL_ROOT, 'screenshots', '_inspect-learner-slideover.png') });
    const tabs = await page.evaluate(() => {
        // collect short text nodes that look like tab/section labels
        const labels = ['Overview', 'Courses', 'Progress', 'Tests', 'Notifications', 'Membership', 'Payment History', 'Enrol / Deroll', 'Enrol/Deroll', 'Lead Profile', 'Enquiry', 'Edit Details'];
        const present = labels.filter((l) => document.body.innerText.includes(l));
        return present;
    });
    console.log('labels present in slide-over:', JSON.stringify(tabs));
} else {
    await page.screenshot({ path: join(TOOL_ROOT, 'screenshots', '_inspect-learner-failopen.png') });
}

await browser.close();
console.log('inspect done');
