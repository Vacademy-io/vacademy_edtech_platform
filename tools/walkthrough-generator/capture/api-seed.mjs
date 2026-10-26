/**
 * api-seed — seeds the demo institute FAST by calling the same admin APIs the
 * dashboard uses (learned from backend source). Creates a batch (package_session)
 * for the existing course+session, then enrolls demo learners with notify=false
 * (NO emails). Guarded: demo-institute-locked; only admin-core-service calls.
 *
 * It sniffs the backend base URL + Authorization header from a real request the
 * app makes on load, then replays REST calls via the authenticated context.
 */
import { chromium } from 'playwright';
import { join } from 'node:path';
import { loadEnv, requireEnv, TOOL_ROOT } from './env.mjs';

const env = loadEnv();
requireEnv(env, ['VACADEMY_BASE_URL', 'VACADEMY_INSTITUTE_ID']);
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/, '');
const INSTITUTE_ID = env.VACADEMY_INSTITUTE_ID;
const COURSE_NAME = 'Foundation Mathematics';
const SESSION_NAME = '2025-26';

const LEARNERS = [
    { full_name: 'Aarav Sharma', email: 'demo.aarav@example.com', gender: 'MALE' },
    { full_name: 'Diya Patel', email: 'demo.diya@example.com', gender: 'FEMALE' },
    { full_name: 'Vivaan Reddy', email: 'demo.vivaan@example.com', gender: 'MALE' },
    { full_name: 'Ananya Iyer', email: 'demo.ananya@example.com', gender: 'FEMALE' },
    { full_name: 'Kabir Singh', email: 'demo.kabir@example.com', gender: 'MALE' },
    { full_name: 'Meera Nair', email: 'demo.meera@example.com', gender: 'FEMALE' },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: join(TOOL_ROOT, 'auth-state.json'), viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let backend = null;
let authHeader = null;
let clientId = null;
page.on('request', (req) => {
    const u = req.url();
    if (/\/(admin-core-service|auth-service)\//.test(u)) {
        try { if (!backend) backend = new URL(u).origin; } catch {}
        const h = req.headers();
        authHeader = h['authorization'] || authHeader;
        clientId = h['clientid'] || h['client-id'] || clientId;
    }
});

await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(3000);

const active = await page.evaluate(() => localStorage.getItem('selectedInstituteId'));
if (active !== INSTITUTE_ID) { console.error('ABORT institute', active); await browser.close(); process.exit(2); }
if (!backend) backend = BASE;
if (!authHeader) {
    const c = (await context.cookies()).find((x) => x.name === 'accessToken');
    if (c) authHeader = 'Bearer ' + c.value;
}
console.log('backend:', backend, '| auth:', authHeader ? 'yes' : 'NO', '| clientId:', clientId || '(none)');

const headers = { 'Content-Type': 'application/json' };
if (authHeader) headers['Authorization'] = authHeader;
if (clientId) headers['clientId'] = clientId;
const api = context.request;

const jget = async (path) => {
    const r = await api.get(backend + path, { headers });
    const t = await r.text();
    try { return { status: r.status(), json: JSON.parse(t) }; } catch { return { status: r.status(), text: t.slice(0, 200) }; }
};
const jpost = async (path, body) => {
    const r = await api.post(backend + path, { headers, data: body });
    const t = await r.text();
    try { return { status: r.status(), json: JSON.parse(t) }; } catch { return { status: r.status(), text: t.slice(0, 200) }; }
};

// 1) discover course + session + level ids
const summary = await jget(`/admin-core-service/institute/v1/batches-summary/${INSTITUTE_ID}`);
console.log('batches-summary status', summary.status);
const pick = (arr, name) => (arr || []).find((x) => (x.name || x.package_name || x.session_name || x.level_name || '').toLowerCase().includes(name.toLowerCase()));
let courseId, sessionId, levelId;
if (summary.json) {
    courseId = pick(summary.json.packages, COURSE_NAME)?.id;
    sessionId = pick(summary.json.sessions, SESSION_NAME)?.id;
    levelId = (summary.json.levels || [])[0]?.id;
}
console.log('from summary -> course:', courseId, '| session:', sessionId, '| level:', levelId);

// fallback for course id via study-library init
if (!courseId) {
    const sl = await jget(`/admin-core-service/v1/study-library/init?instituteId=${INSTITUTE_ID}`);
    if (Array.isArray(sl.json)) {
        const c = sl.json.find((x) => (x.course?.package_name || '').toLowerCase().includes(COURSE_NAME.toLowerCase()));
        courseId = c?.course?.id;
    }
    console.log('from study-library/init -> course:', courseId);
}

// 2) does a package_session already exist for this course+session?
const details = await jget(`/admin-core-service/institute/v1/details/${INSTITUTE_ID}`);
const findPS = (d) => (d?.batches_for_sessions || []).find((b) => b.package_dto?.id === courseId && b.session?.id === sessionId);
let ps = details.json ? findPS(details.json) : null;
if (!sessionId && details.json) sessionId = (details.json.sessions || []).find((s) => (s.session_name || '').includes(SESSION_NAME))?.id;
if (!levelId && details.json) levelId = (details.json.levels || [])[0]?.id;
console.log('existing package_session:', ps?.id || '(none)');

// 3) create batch if needed
if (!ps && courseId && sessionId) {
    const r = await jpost(
        `/admin-core-service/level/v1/add-level?packageId=${courseId}&sessionId=${sessionId}&instituteId=${INSTITUTE_ID}`,
        { new_level: true, level_name: 'DEFAULT', duration_in_days: 365, thumbnail_file_id: null }
    );
    console.log('create-batch (add-level) status', r.status, r.text || JSON.stringify(r.json).slice(0, 120));
    await page.waitForTimeout(2000);
    const d2 = await jget(`/admin-core-service/institute/v1/details/${INSTITUTE_ID}`);
    ps = d2.json ? findPS(d2.json) : null;
    console.log('package_session after create:', ps?.id || '(still none)');
}

const packageSessionId = ps?.id;
if (!packageSessionId) {
    console.error('No package_session_id resolved — cannot enroll. course:', courseId, 'session:', sessionId);
    await browser.close();
    process.exit(3);
}

// 4) enroll learners (notify=false -> no emails)
let ok = 0;
for (const l of LEARNERS) {
    const body = {
        user_details: { full_name: l.full_name, email: l.email, gender: l.gender },
        student_extra_details: {},
        institute_student_details: {
            institute_id: INSTITUTE_ID,
            package_session_id: packageSessionId,
            enrollment_status: 'ACTIVE',
            access_days: '365',
        },
    };
    const r = await jpost('/admin-core-service/institute/institute_learner/v1/add-institute_learner?notify=false', body);
    const okThis = r.status >= 200 && r.status < 300;
    if (okThis) ok++;
    console.log(`  enroll ${l.full_name}: ${r.status} ${okThis ? 'OK' : (r.text || JSON.stringify(r.json)).slice(0, 120)}`);
    await page.waitForTimeout(400);
}
console.log(`enrolled ${ok}/${LEARNERS.length} learners into package_session ${packageSessionId}`);

await browser.close();
console.log('api-seed done');
