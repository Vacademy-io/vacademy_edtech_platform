#!/usr/bin/env node
/**
 * Classroom API scenarios. The same assertions run against the mock and against
 * a local auth_service, so the two cannot drift. IDs are the T numbers of the
 * Classroom test plan.
 *
 *   node scripts/classroom/scenarios/run.mjs                 # in-process mock
 *   node scripts/classroom/scenarios/run.mjs --only T3,T19
 *   node scripts/classroom/scenarios/run.mjs --list
 *   node scripts/classroom/scenarios/run.mjs --base http://127.0.0.1:8071 \
 *        --base2 http://127.0.0.1:8072 --config /path/to/local-users.json
 *
 * All traffic goes through local-gateway.mjs, which refuses anything that is not
 * http on a loopback address, so this cannot reach a shared environment. Against
 * a real service, scenarios that need the mock's clock or switches are skipped.
 *
 * --config (real service) is JSON in the shape of the mock's
 * GET /__mock/scenario-config:
 *   { "institutes": { "a": {"id","name"}, "b": {...}, "limited": {...} },
 *     "users": { "admin_a": {"id","name","token" | "username"+"password"}, ... } }
 * Users used: admin_a, admin_b, teacher_a, teacher_a2, invited_teacher,
 * custom_role, admin_student, counsellor_student, student_a, student_teacher,
 * root_no_role, rate_user; admin_limited and limited_teacher for T24. The
 * service needs panel.enabled=true, and for a full run in one go
 * panel.limits.session-starts-per-user-per-hour=500 (the suite signs teacher_a in
 * more than the default 20 times an hour). A scenario missing a user is skipped.
 */
import fs from 'node:fs';
import { createGateway, assertLocalUpstream } from '../local-gateway.mjs';
import { createMockBackend } from '../mock-backend.mjs';
import { extendHarness, phase2Scenarios } from './phase2.mjs';

const PUB = '/auth-service/public/v1/panel';
const BEARER = '/auth-service/v1/panel';
const MIN = 60 * 1000;
/** Per-minute windows are waited out; anything longer fails the scenario at once. */
const MAX_RATE_LIMIT_WAIT_MS = 65 * 1000;

function arg(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

class Failure extends Error {}
class Skip extends Error {}

function ok(condition, message) {
    if (!condition) throw new Failure(message);
}
function eq(actual, expected, message) {
    if (actual !== expected) {
        throw new Failure(
            `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
    }
}
function code(res, status, expectedCode, message = '') {
    const summary = `${res.status} ${JSON.stringify(res.body)?.slice(0, 200)}`;
    if (res.status !== status) throw new Failure(`${message} expected ${status}, got ${summary}`);
    if (expectedCode && res.body?.code !== expectedCode) {
        throw new Failure(`${message} expected code ${expectedCode}, got ${summary}`);
    }
    return res.body;
}
const good = (res, message = '') => code(res, 200, null, message);
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function harness() {
    const realBase = arg('--base');
    const realBase2 = arg('--base2');
    let mock = null;
    let upstream = realBase;
    if (realBase) {
        assertLocalUpstream(realBase);
    } else {
        mock = createMockBackend();
        upstream = `http://127.0.0.1:${await mock.listen()}`;
    }
    const gateway = createGateway({ defaultUpstream: upstream });
    const base = `http://127.0.0.1:${await gateway.listen()}`;
    let base2 = base;
    let gateway2 = null;
    if (realBase2) {
        gateway2 = createGateway({ defaultUpstream: realBase2 });
        base2 = `http://127.0.0.1:${await gateway2.listen()}`;
    }

    let cfg;
    if (mock) {
        cfg = await (await fetch(`${upstream}/__mock/scenario-config`)).json();
    } else {
        const file = arg('--config');
        if (!file) throw new Error('--config is required with --base');
        cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    }

    let ipCounter = 0;
    const runId = Date.now().toString(36);
    let roomCounter = 0;

    const h = {
        isMock: !!mock,
        cfg,
        runId,
        scenarioIp: '198.51.100.1',
        nextScenario() {
            ipCounter += 1;
            h.scenarioIp = `198.51.${100 + (ipCounter >> 8)}.${ipCounter & 255}`;
        },
        roomName: () => {
            roomCounter += 1;
            return `Room ${runId} ${roomCounter}`;
        },
        inst: (key) => {
            const row = cfg.institutes[key];
            if (!row) throw new Skip(`config has no institute ${key}`);
            return row;
        },
        user: (name) => {
            const row = cfg.users[name];
            if (!row) throw new Skip(`config has no user ${name}`);
            return row;
        },

        async call(method, path, { body, token, headers, via, noRetry, ip } = {}) {
            const url = `${via ?? base}${path}`;
            for (let attempt = 0; ; attempt += 1) {
                let response;
                try {
                    response = await fetch(url, {
                        method,
                        headers: {
                            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                            'CF-Connecting-IP': ip ?? h.scenarioIp,
                            ...(headers ?? {}),
                        },
                        body: body !== undefined ? JSON.stringify(body) : undefined,
                    });
                } catch {
                    return { status: 0, body: null, headers: new Headers() };
                }
                const text = await response.text();
                let parsed = null;
                try {
                    parsed = text ? JSON.parse(text) : null;
                } catch {
                    parsed = text;
                }
                // A real service keeps its per-minute windows across scenarios: wait them out.
                // A longer window (the hourly sign-in limit) is not waited out: it stops the
                // scenario with a message saying which setting to raise.
                if (
                    response.status === 429 &&
                    parsed?.code === 'RATE_LIMITED' &&
                    !mock &&
                    !noRetry &&
                    attempt < 2
                ) {
                    const waitMs = parsed.retry_after_ms ?? 60000;
                    if (waitMs > MAX_RATE_LIMIT_WAIT_MS) {
                        throw new Failure(
                            `${method} ${path} is rate limited for ${Math.ceil(waitMs / 60000)} min. ` +
                                'Start auth_service with panel.limits.session-starts-per-user-per-hour=500 ' +
                                'for a full run, or restart it and continue with --only.'
                        );
                    }
                    await sleep(waitMs + 200);
                    continue;
                }
                return { status: response.status, body: parsed, headers: response.headers };
            }
        },
        pub: (path, body, options) => h.call('POST', `${PUB}${path}`, { body, ...options }),
        async tokenOf(name) {
            const row = h.user(name);
            if (row.token) return row.token;
            const res = await h.call('POST', '/auth-service/v1/login-root', {
                body: {
                    user_name: row.username,
                    password: row.password,
                    client_name: 'ADMIN_PORTAL',
                },
            });
            good(res, `login for ${name}`);
            row.token = res.body.accessToken;
            return row.token;
        },
        async bearer(name, method, path, body, options) {
            return h.call(method, `${BEARER}${path}`, {
                body,
                token: await h.tokenOf(name),
                ...options,
            });
        },

        fault: async (fault) =>
            good(await h.call('POST', '/__gateway/faults', { body: fault }), 'add fault'),
        clearFaults: () => h.call('DELETE', '/__gateway/faults'),
        base2,

        mockOnly() {
            if (!mock) throw new Skip('needs the mock');
        },
        control: (path, body) =>
            fetch(`${upstream}/__mock/${path}`, {
                method: body === undefined ? 'GET' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            }).then((res) => res.json()),
        advance: (ms) => h.control('clock', { advance_ms: ms }),
        async resetMock() {
            if (!mock) return;
            await h.control('reset', {});
            cfg = await h.control('scenario-config');
            h.cfg = cfg;
        },
        /** Fresh sign-in tokens after a long clock jump (login tokens last 30 days). */
        async reloadMockConfig() {
            cfg = await h.control('scenario-config');
            h.cfg = cfg;
        },
        close: async () => {
            await gateway.close();
            if (gateway2) await gateway2.close();
            if (mock) await mock.close();
        },

        // ------------------------------------------------------------ flows ---

        async startPair(options) {
            return good(
                await h.pub(
                    '/pair/start',
                    {
                        install_id: `install-${runId}-${Math.random().toString(36).slice(2, 10)}`,
                        device: {
                            manufacturer: 'Lab',
                            model: 'Panel 65',
                            sdk_int: 28,
                            webview_major: 66,
                            app_version_code: 2,
                        },
                    },
                    options
                ),
                'pair/start'
            );
        },
        claim: (admin, pair, instituteKey, extra = {}) =>
            h.bearer(admin, 'POST', '/admin/devices/claim', {
                code: pair.code,
                match_code: pair.match_code,
                institute_id: h.inst(instituteKey).id,
                replace_existing: false,
                ...(extra.room_id ? {} : { new_room_name: h.roomName() }),
                ...extra,
            }),
        /** Start, claim, poll and confirm: a panel ready for sign-in. */
        async pairedDevice(admin = 'admin_a', instituteKey = 'a', extra = {}) {
            const pair = await h.startPair();
            const claimed = good(await h.claim(admin, pair, instituteKey, extra), 'claim');
            const polled = good(
                await h.pub('/pair/poll', { pair_secret: pair.pair_secret }),
                'poll'
            );
            eq(polled.state, 'CLAIMED', 'pair poll');
            const creds = { device_id: polled.device_id, device_secret: polled.device_secret };
            good(await h.pub('/pair/confirm', { ...creds, accept: true }), 'confirm');
            return { creds, room: claimed.room, pair, polled };
        },
        async newChallenge(device, purpose = 'SIGN_IN', extra = {}) {
            return good(
                await h.pub('/challenge', { ...device.creds, purpose, ...extra }),
                'challenge'
            );
        },
        tokenFromQr: (qrUrl) => qrUrl.split('#c=')[1],
        pollChallenge: (device, challengeId) =>
            h.pub('/challenge/poll', { ...device.creds, challenge_id: challengeId }),
        /** Full QR sign-in with the right number. */
        async signIn(device, teacher = 'teacher_a') {
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            good(await h.bearer(teacher, 'POST', '/challenge/describe', { t }), 'describe');
            const approved = good(
                await h.bearer(teacher, 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                }),
                'approve'
            );
            const redeemed = good(await h.pollChallenge(device, challenge.challenge_id), 'poll');
            eq(redeemed.state, 'REDEEMED', 'challenge poll');
            return { challenge, t, approved, redeemed };
        },
        sync: (device, session, extra = {}) =>
            h.pub('/sync', {
                ...device.creds,
                session_id: session?.session_id,
                session_token: session?.session_token,
                presenting: false,
                ...extra,
            }),
        refresh: (device, session) =>
            h.pub('/session/refresh', { ...device.creds, session_token: session.session_token }),
    };
    return extendHarness(h, { good, Skip });
}

// ---------------------------------------------------------------- scenarios ---

const SCENARIOS = [
    [
        'T1',
        'Pair with a number tap, confirm on the panel',
        async (h) => {
            const pair = await h.startPair();
            ok(pair.qr_url.endsWith(`/classroom#pair=${pair.code}`), 'QR is host, path, fragment');
            eq(pair.code.length, 8, 'code length');
            eq(pair.expires_in_s, 900, 'pair ttl');
            const preview = good(
                await h.bearer('admin_a', 'POST', '/pair/preview', { code: pair.code })
            );
            eq(preview.model, 'Panel 65', 'preview model');
            eq(preview.webview_major, 66, 'preview webview');
            eq(preview.match_options.length, 3, 'three numbers');
            ok(preview.match_options.includes(pair.match_code), 'options include the number');
            eq(
                (await h.pub('/pair/poll', { pair_secret: pair.pair_secret })).body.state,
                'PENDING',
                'poll before claim'
            );
            const room = h.roomName();
            const claimed = good(
                await h.claim('admin_a', pair, 'a', { new_room_name: room }),
                'claim'
            );
            eq(claimed.status, 'CLAIMED', 'claim status');
            eq(claimed.room.name, room, 'claim room');
            const polled = good(await h.pub('/pair/poll', { pair_secret: pair.pair_secret }));
            eq(polled.state, 'CLAIMED', 'poll after claim');
            eq(polled.institute_id, h.inst('a').id, 'poll institute');
            eq(polled.room.name, room, 'poll room');
            ok(polled.claimed_by_name, 'poll names who claimed');
            ok(polled.device_secret, 'poll has the secret');
            const creds = { device_id: polled.device_id, device_secret: polled.device_secret };
            eq(
                good(await h.pub('/pair/confirm', { ...creds, accept: true })).status,
                'ACTIVE',
                'confirm'
            );
            const synced = good(await h.pub('/sync', { ...creds, presenting: false }));
            eq(synced.device.status, 'ACTIVE', 'sync device');
            eq(synced.device.room_name, room, 'sync room');
            ok(/^https?:\/\/[^/]+$/.test(synced.device.approve_base_url), 'base url scheme+host');
        },
    ],
    [
        'T2',
        'Claim with a typed code: lower case and a separator are fine',
        async (h) => {
            const pair = await h.startPair();
            const typed = `${pair.code.slice(0, 4)}-${pair.code.slice(4)}`.toLowerCase();
            good(await h.bearer('admin_a', 'POST', '/pair/preview', { code: typed }), 'preview');
            good(await h.claim('admin_a', { ...pair, code: typed }, 'a'), 'claim');
        },
    ],
    [
        'T3',
        'Poll response dropped at CLAIMED: a retry re-mints',
        async (h) => {
            const pair = await h.startPair();
            good(await h.claim('admin_a', pair, 'a'));
            await h.fault({ path: `${PUB}/pair/poll`, type: 'drop_response', times: 1 });
            eq((await h.pub('/pair/poll', { pair_secret: pair.pair_secret })).status, 0, 'dropped');
            const polled = good(await h.pub('/pair/poll', { pair_secret: pair.pair_secret }));
            eq(polled.state, 'CLAIMED', 'retry');
            const stale = { device_id: polled.device_id, device_secret: polled.device_secret };
            const again = good(await h.pub('/pair/poll', { pair_secret: pair.pair_secret }));
            ok(again.device_secret !== stale.device_secret, 'each retry mints a new secret');
            code(await h.pub('/pair/confirm', { ...stale, accept: true }), 401, 'DEVICE_REVOKED');
            const creds = { device_id: again.device_id, device_secret: again.device_secret };
            good(await h.pub('/pair/confirm', { ...creds, accept: true }), 'confirm with re-mint');
            if (h.isMock) {
                await h.advance(61 * 1000);
                eq(
                    (await h.pub('/pair/poll', { pair_secret: pair.pair_secret })).body.state,
                    'EXPIRED',
                    'after the window'
                );
            }
        },
    ],
    [
        'T4',
        'Decline on the panel frees the room',
        async (h) => {
            const pair = await h.startPair();
            const claimed = good(await h.claim('admin_a', pair, 'a'));
            const polled = good(await h.pub('/pair/poll', { pair_secret: pair.pair_secret }));
            const creds = { device_id: polled.device_id, device_secret: polled.device_secret };
            eq(
                good(await h.pub('/pair/confirm', { ...creds, accept: false })).status,
                'CANCELLED',
                'decline'
            );
            code(await h.pub('/sync', { ...creds, presenting: false }), 401, 'DEVICE_REVOKED');
            const next = await h.startPair();
            good(
                await h.claim('admin_a', next, 'a', { room_id: claimed.room.id }),
                'room is free again'
            );
        },
    ],
    [
        'T5',
        'Occupied room: 409, replace revokes the old panel',
        async (h) => {
            const old = await h.pairedDevice();
            const signedIn = await h.signIn(old);
            const pair = await h.startPair();
            const occupied = code(
                await h.claim('admin_a', pair, 'a', { room_id: old.room.id }),
                409,
                'ROOM_OCCUPIED'
            );
            eq(occupied.current_device.id, old.creds.device_id, 'names the current device');
            good(
                await h.claim('admin_a', pair, 'a', {
                    room_id: old.room.id,
                    replace_existing: true,
                }),
                'replace'
            );
            code(await h.pub('/sync', { ...old.creds, presenting: false }), 401, 'DEVICE_REVOKED');
            code(await h.refresh(old, signedIn.redeemed), 401, 'DEVICE_REVOKED');
        },
    ],
    [
        'T6',
        'Admin of institute B cannot claim into A',
        async (h) => {
            const pair = await h.startPair();
            code(await h.claim('admin_b', pair, 'a'), 403);
        },
    ],
    [
        'T7',
        'Root flag without admin cannot claim',
        async (h) => {
            const pair = await h.startPair();
            code(await h.claim('root_no_role', pair, 'a'), 403);
        },
    ],
    [
        'T8',
        'Two concurrent claims with one code: one wins',
        async (h) => {
            const pair = await h.startPair();
            const [first, second] = await Promise.all([
                h.claim('admin_a', pair, 'a'),
                h.call('POST', `${BEARER}/admin/devices/claim`, {
                    via: h.base2,
                    token: await h.tokenOf('admin_a'),
                    body: {
                        code: pair.code,
                        match_code: pair.match_code,
                        institute_id: h.inst('a').id,
                        new_room_name: h.roomName(),
                        replace_existing: false,
                    },
                }),
            ]);
            eq([first.status, second.status].filter((s) => s === 200).length, 1, 'winners');
        },
    ],
    [
        'T9',
        'QR sign-in with a signed-in phone',
        async (h) => {
            const device = await h.pairedDevice();
            const { challenge, approved, redeemed } = await h.signIn(device);
            eq(challenge.expires_in_s, 300, 'challenge ttl');
            eq(h.tokenFromQr(challenge.qr_url).length, 22, 'QR token is 22 characters');
            ok(!JSON.stringify(challenge).includes('"t"'), 'no separate token field');
            ok(approved.remote_token, 'phone gets a remote token');
            ok(approved.session_id, 'approve has a session');
            eq(approved.room_name, device.room.name, 'approve names the room');
            eq(redeemed.session_id, approved.session_id, 'same session');
            eq(redeemed.user.id, h.user('teacher_a').id, 'user');
            eq(redeemed.institute_id, h.inst('a').id, 'institute');
            eq(redeemed.expires_in_s, 900, 'JWT ttl');
            ok(!redeemed.remote_token, 'panel never gets the remote token');
        },
    ],
    [
        'T10',
        'Panel JWT: 15 minutes, this institute only',
        async (h) => {
            const device = await h.pairedDevice();
            const { redeemed } = await h.signIn(device);
            const jwt = claims(redeemed.access_token);
            eq(jwt.exp - jwt.iat, 900, 'JWT life');
            eq(jwt.user, h.user('teacher_a').id, 'user claim');
            eq(Object.keys(jwt.authorities).join(), h.inst('a').id, 'authorities institute');
            eq(jwt.pnl, redeemed.session_id, 'pnl claim');
            const refreshed = good(await h.refresh(device, redeemed));
            eq(claims(refreshed.access_token).user, jwt.user, 'refresh keeps the user');
            eq(refreshed.expires_in_s, 900, 'refresh ttl');
            if (!h.isMock) return;
            const expired = await h.control('short-token', { user_id: 'teacher_a', ttl_s: 1 });
            await h.advance(2000);
            const res = await h.call('GET', `${BEARER}/my-session`, { token: expired.token });
            ok([401, 403, 510, 511].includes(res.status), `expired Bearer, got ${res.status}`);
        },
    ],
    [
        'T11',
        'Student opening a photographed QR learns only the institute name',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            const info = good(await h.pub('/challenge/info', { t }));
            eq(info.institute_name, h.inst('a').name, 'info name');
            eq(
                Object.keys(info).sort().join(),
                'expires_in_s,institute_id,institute_name,state,theme_code',
                'info fields'
            );
            const refused = code(
                await h.bearer('student_a', 'POST', '/challenge/describe', { t }),
                403,
                'NOT_STAFF'
            );
            eq(refused.institute_name, h.inst('a').name, 'names the institute');
            ok(!refused.match_options, 'no numbers');
            code(
                await h.bearer('student_a', 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                }),
                403,
                'NOT_STAFF'
            );
        },
    ],
    [
        'T12',
        'STUDENT plus TEACHER is refused',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            code(
                await h.bearer('student_teacher', 'POST', '/challenge/describe', {
                    t: h.tokenFromQr(challenge.qr_url),
                }),
                403,
                'NOT_STAFF'
            );
        },
    ],
    [
        'T13',
        'ADMIN+STUDENT, COUNSELLOR+STUDENT and a custom role are allowed',
        async (h) => {
            for (const name of ['admin_student', 'counsellor_student', 'custom_role']) {
                const device = await h.pairedDevice();
                await h.signIn(device, name);
            }
        },
    ],
    [
        'T14',
        'Root flag with no role at this institute is refused',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            code(
                await h.bearer('root_no_role', 'POST', '/challenge/describe', {
                    t: h.tokenFromQr(challenge.qr_url),
                }),
                403,
                'NOT_STAFF'
            );
        },
    ],
    [
        'T15',
        'Wrong number kills the challenge',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            const described = good(
                await h.bearer('teacher_a', 'POST', '/challenge/describe', { t })
            );
            const wrong = described.match_options.find((n) => n !== challenge.match_code);
            code(
                await h.bearer('teacher_a', 'POST', '/challenge/approve', { t, match_code: wrong }),
                409,
                'WRONG_NUMBER'
            );
            eq(
                (await h.pollChallenge(device, challenge.challenge_id)).body.state,
                'DEAD',
                'panel sees DEAD'
            );
            code(
                await h.bearer('teacher_a', 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                }),
                409,
                'EXPIRED'
            );
            const next = await h.newChallenge(device);
            ok(next.challenge_id !== challenge.challenge_id, 'a new challenge can start');
        },
    ],
    [
        'T15b',
        'Deny kills the challenge',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t }));
            eq(
                good(await h.bearer('teacher_a', 'POST', '/challenge/approve', { t, deny: true }))
                    .denied,
                true,
                'denied'
            );
            eq(
                (await h.pollChallenge(device, challenge.challenge_id)).body.state,
                'DEAD',
                'panel sees DEAD'
            );
        },
    ],
    [
        'T16',
        'Token replay after REDEEMED is refused',
        async (h) => {
            const device = await h.pairedDevice();
            const { t, challenge } = await h.signIn(device);
            code(
                await h.bearer('teacher_a2', 'POST', '/challenge/describe', { t }),
                404,
                'EXPIRED'
            );
            code(
                await h.bearer('teacher_a2', 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                }),
                409,
                'EXPIRED'
            );
        },
    ],
    [
        'T17',
        "Another device's credentials cannot redeem",
        async (h) => {
            const device = await h.pairedDevice();
            const other = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t }));
            good(
                await h.bearer('teacher_a', 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                })
            );
            code(await h.pollChallenge(other, challenge.challenge_id), 404, 'NOT_FOUND');
            eq(
                (await h.pollChallenge(device, challenge.challenge_id)).body.state,
                'REDEEMED',
                'the right panel still redeems'
            );
        },
    ],
    [
        'T18',
        'Two concurrent approvals of one token: one session',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t }));
            const [first, second] = await Promise.all([
                h.bearer('teacher_a', 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                }),
                h.call('POST', `${BEARER}/challenge/approve`, {
                    via: h.base2,
                    token: await h.tokenOf('teacher_a2'),
                    body: { t, match_code: challenge.match_code },
                }),
            ]);
            eq([first.status, second.status].filter((s) => s === 200).length, 1, 'winners');
            const winner = first.status === 200 ? 'teacher_a' : 'teacher_a2';
            const redeemed = good(await h.pollChallenge(device, challenge.challenge_id));
            eq(redeemed.user.id, h.user(winner).id, 'session belongs to the winner');
        },
    ],
    [
        'T19',
        'Poll response dropped at REDEEMED: re-mint within 60 s, then refused',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t }));
            good(
                await h.bearer('teacher_a', 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                })
            );
            await h.fault({ path: `${PUB}/challenge/poll`, type: 'drop_response', times: 1 });
            eq((await h.pollChallenge(device, challenge.challenge_id)).status, 0, 'dropped');
            const again = good(await h.pollChallenge(device, challenge.challenge_id));
            eq(again.state, 'REDEEMED', 'retry redeems');
            good(await h.refresh(device, again), 'the re-minted token works');
            if (h.isMock) {
                await h.advance(61 * 1000);
                eq(
                    (await h.pollChallenge(device, challenge.challenge_id)).body.state,
                    'EXPIRED',
                    'after the window'
                );
            }
        },
    ],
    [
        'T20',
        'Same teacher on a second panel: the first ends SUPERSEDED',
        async (h) => {
            const first = await h.pairedDevice();
            const firstSession = (await h.signIn(first)).redeemed;
            const second = await h.pairedDevice();
            await h.signIn(second);
            const synced = good(await h.sync(first, firstSession));
            eq(synced.session.status, 'ENDED', 'first session');
            eq(synced.session.end_reason, 'SUPERSEDED', 'reason');
            const refused = code(await h.refresh(first, firstSession), 401, 'SESSION_ENDED');
            eq(refused.reason, 'SUPERSEDED', 'refresh reason');
        },
    ],
    [
        'T21',
        'Switch teacher: the old session ends REPLACED',
        async (h) => {
            const device = await h.pairedDevice();
            const old = (await h.signIn(device, 'teacher_a')).redeemed;
            const next = (await h.signIn(device, 'teacher_a2')).redeemed;
            const synced = good(await h.sync(device, old));
            eq(synced.session.end_reason, 'REPLACED', 'old reason');
            eq(good(await h.sync(device, next)).session.status, 'ACTIVE', 'new session');
        },
    ],
    [
        'T22',
        '8-character code: works from a laptop, limit holds',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const typed =
                `${challenge.user_code.slice(0, 4)}-${challenge.user_code.slice(4)}`.toLowerCase();
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { user_code: typed }));
            good(
                await h.bearer('teacher_a', 'POST', '/challenge/approve', {
                    user_code: typed,
                    match_code: challenge.match_code,
                })
            );
            eq(
                (await h.pollChallenge(device, challenge.challenge_id)).body.state,
                'REDEEMED',
                'panel signs in'
            );
            let limited = null;
            for (let i = 0; i < 12 && !limited; i += 1) {
                const res = await h.bearer(
                    'rate_user',
                    'POST',
                    '/challenge/describe',
                    { user_code: `ZZZZZZZ${i % 10}` },
                    { noRetry: true }
                );
                if (res.status === 429) limited = i;
                else eq(res.status, 404, 'unknown code');
            }
            ok(limited !== null && limited >= 10, `limit at 10, tripped at ${limited}`);
        },
    ],
    [
        'T23',
        'Password on a panel: off, then on',
        async (h) => {
            const device = await h.pairedDevice();
            const teacher = h.user('teacher_a');
            if (!teacher.password) throw new Skip('config has no password for teacher_a');
            const login = (username, password) =>
                h.pub('/session/login-password', { ...device.creds, username, password });
            code(await login(teacher.username, teacher.password), 403, 'PASSWORD_DISABLED');
            const row = good(
                await h.bearer('admin_a', 'PATCH', `/admin/devices/${device.creds.device_id}`, {
                    password_login_allowed: true,
                })
            );
            eq(row.password_login_allowed, true, 'patched');
            code(await login(teacher.username, 'wrong'), 401, 'BAD_CREDENTIALS');
            const student = h.user('student_a');
            if (student.password) {
                code(await login(student.username, student.password), 403, 'NOT_STAFF');
            }
            const session = good(await login(teacher.username, teacher.password));
            eq(session.user.id, teacher.id, 'signed in');
            eq(
                claims(session.access_token).exp - claims(session.access_token).iat,
                900,
                'JWT life'
            );
            ok(!session.remote_token, 'no remote token');
            good(await h.refresh(device, session), 'refresh works');
        },
    ],
    [
        'T24',
        'Limited institute: a Bearer call with no clientId is not limited',
        async (h) => {
            const device = await h.pairedDevice('admin_limited', 'limited');
            await h.signIn(device, 'limited_teacher');
            if (h.isMock) {
                const res = await h.bearer('limited_teacher', 'GET', '/my-session', undefined, {
                    headers: { clientId: h.inst('limited').id },
                });
                eq(res.status, 460, 'with clientId');
            }
        },
    ],
    [
        'T25',
        'Revoke, admin end and phone end all reach the panel',
        async (h) => {
            const a = await h.pairedDevice();
            const aSession = (await h.signIn(a, 'teacher_a')).redeemed;
            good(
                await h.bearer('admin_a', 'POST', `/admin/sessions/${aSession.session_id}/end`, {})
            );
            eq(good(await h.sync(a, aSession)).session.end_reason, 'ADMIN', 'admin end');
            eq(code(await h.refresh(a, aSession), 401, 'SESSION_ENDED').reason, 'ADMIN', 'refresh');

            const bSignIn = await h.signIn(a, 'teacher_a');
            good(await h.pub('/remote/end', { remote_token: bSignIn.approved.remote_token }));
            eq(good(await h.sync(a, bSignIn.redeemed)).session.end_reason, 'PHONE', 'phone end');
            code(await h.refresh(a, bSignIn.redeemed), 401, 'SESSION_ENDED');

            const cSignIn = await h.signIn(a, 'teacher_a');
            eq(
                good(await h.bearer('teacher_a', 'GET', '/my-session')).session_id,
                cSignIn.redeemed.session_id,
                'my-session'
            );
            good(await h.bearer('teacher_a', 'POST', '/my-session/end', {}));
            eq((await h.bearer('teacher_a', 'GET', '/my-session')).status, 204, 'no session');

            const dSession = (await h.signIn(a, 'teacher_a')).redeemed;
            eq(
                good(
                    await h.bearer(
                        'admin_a',
                        'POST',
                        `/admin/devices/${a.creds.device_id}/revoke`,
                        {}
                    )
                ).status,
                'REVOKED',
                'revoke'
            );
            code(await h.sync(a, dSession), 401, 'DEVICE_REVOKED');
            code(await h.refresh(a, dSession), 401, 'DEVICE_REVOKED');
        },
    ],
    [
        'T26',
        'Removing the role ends the session at the next refresh',
        async (h) => {
            h.mockOnly();
            const device = await h.pairedDevice();
            const { redeemed } = await h.signIn(device);
            await h.control('roles', { user_id: 'teacher_a', institute_id: 'inst-a', roles: [] });
            eq(
                code(await h.refresh(device, redeemed), 401, 'SESSION_ENDED').reason,
                'ACCESS_REMOVED',
                'reason'
            );
            eq(good(await h.sync(device, redeemed)).session.end_reason, 'ACCESS_REMOVED', 'sync');
        },
    ],
    [
        'T31',
        '4 h cap: refused at the cap, refreshing cannot extend it',
        async (h) => {
            h.mockOnly();
            const device = await h.pairedDevice();
            const { redeemed } = await h.signIn(device);
            let left = redeemed.session_expires_in_s;
            ok(left <= 4 * 60 * 60 && left > 4 * 60 * 60 - 30, `starts at 4 h, got ${left}`);
            for (let i = 0; i < 4; i += 1) {
                await h.advance(55 * MIN);
                const refreshed = good(await h.refresh(device, redeemed));
                ok(refreshed.session_expires_in_s < left, 'refresh does not extend');
                left = refreshed.session_expires_in_s;
            }
            await h.advance(21 * MIN);
            eq(
                code(await h.refresh(device, redeemed), 401, 'SESSION_ENDED').reason,
                'EXPIRED',
                'cap'
            );
        },
    ],
    [
        'T31b',
        'Dead-man: no refresh for over 60 minutes ends the session',
        async (h) => {
            h.mockOnly();
            const device = await h.pairedDevice();
            const { redeemed } = await h.signIn(device);
            await h.advance(59 * MIN);
            good(await h.refresh(device, redeemed), 'inside the limit');
            await h.advance(61 * MIN);
            eq(
                code(await h.refresh(device, redeemed), 401, 'SESSION_ENDED').reason,
                'DEAD_MAN',
                'reason'
            );
        },
    ],
    [
        'T34',
        'Remote nav moves the counter; state reaches the phone',
        async (h) => {
            const device = await h.pairedDevice();
            const { approved, redeemed } = await h.signIn(device);
            const remote = approved.remote_token;
            let synced = good(
                await h.sync(device, redeemed, {
                    presenting: true,
                    state: { index: 3, total: 20, title: 'x'.repeat(250) },
                })
            );
            eq(synced.session.nav_counter, 0, 'counter starts at 0');
            eq(synced.session.nav_age_ms, null, 'no press yet');
            const state = good(await h.pub('/remote/state', { remote_token: remote }));
            eq(state.index, 3, 'phone index');
            eq(state.total, 20, 'phone total');
            eq(state.title.length, 200, 'title truncated');
            eq(state.room_name, device.room.name, 'phone room');
            eq(state.panel_online, true, 'panel online');
            ok(
                good(
                    await h.pub('/remote/nav', { remote_token: remote, delta: 1, client_seq: 1000 })
                ).accepted,
                'next'
            );
            ok(
                good(
                    await h.pub('/remote/nav', { remote_token: remote, delta: 1, client_seq: 1001 })
                ).accepted,
                'next'
            );
            ok(
                good(
                    await h.pub('/remote/nav', {
                        remote_token: remote,
                        delta: -1,
                        client_seq: 1002,
                    })
                ).accepted,
                'prev'
            );
            synced = good(
                await h.sync(device, redeemed, {
                    presenting: true,
                    state: { index: 3, total: 20, title: 'y' },
                })
            );
            eq(synced.session.nav_counter, 1, 'counter');
            ok(synced.session.nav_age_ms >= 0 && synced.session.nav_age_ms < 8000, 'fresh age');
            eq(synced.session.phone_connected, true, 'phone connected');
            good(await h.sync(device, redeemed, { presenting: false }));
            const cleared = good(await h.pub('/remote/state', { remote_token: remote }));
            eq(cleared.index, null, 'no target clears the phone');
            code(
                await h.pub('/remote/nav', { remote_token: remote, delta: 2, client_seq: 2000 }),
                400,
                'BAD_REQUEST'
            );
        },
    ],
    [
        'T36',
        'Phone nav after the session ended',
        async (h) => {
            const device = await h.pairedDevice();
            const { approved, redeemed } = await h.signIn(device);
            good(
                await h.pub('/session/end', {
                    ...device.creds,
                    session_token: redeemed.session_token,
                    reason: 'SIGN_OUT',
                })
            );
            good(
                await h.pub('/session/end', {
                    ...device.creds,
                    session_token: redeemed.session_token,
                    reason: 'SIGN_OUT',
                }),
                'idempotent'
            );
            const nav = good(
                await h.pub('/remote/nav', {
                    remote_token: approved.remote_token,
                    delta: 1,
                    client_seq: 5,
                })
            );
            eq(nav.accepted, false, 'not accepted');
            eq(nav.status, 'ENDED', 'status');
            eq(
                good(await h.pub('/remote/state', { remote_token: approved.remote_token })).status,
                'ENDED',
                'state'
            );
        },
    ],
    [
        'T37',
        'Today: mine, all, no-store, server labels',
        async (h) => {
            h.mockOnly();
            const token = await h.tokenOf('teacher_a');
            const get = (scope) =>
                h.call(
                    'GET',
                    `/admin-core-service/classroom/v1/today?instituteId=inst-a&scope=${scope}`,
                    {
                        token,
                        headers: { clientId: 'inst-a' },
                    }
                );
            const mine = await get('mine');
            eq(good(mine).truncated, false, 'truncated');
            eq(mine.headers.get('cache-control'), 'no-store', 'no-store');
            const all = good(await get('all'));
            ok(all.classes.length > mine.body.classes.length, 'all shows more');
            ok(
                mine.body.classes.every((c) => /^\d\d:\d\d$/.test(c.time_label)),
                'labels'
            );
            ok(
                all.classes.some((c) => c.ends_at_ms === null),
                'a class with no end'
            );
            ok(
                all.classes.filter((c) => c.external_link).every((c) => c.link_type === 'other'),
                'external only for other'
            );
        },
    ],
    [
        'T38',
        'Today refuses non-members and a mismatched clientId',
        async (h) => {
            h.mockOnly();
            const path = '/admin-core-service/classroom/v1/today?instituteId=inst-a&scope=mine';
            eq(
                (
                    await h.call('GET', path, {
                        token: await h.tokenOf('admin_b'),
                        headers: { clientId: 'inst-a' },
                    })
                ).status,
                403,
                'non-member'
            );
            eq(
                (
                    await h.call('GET', path, {
                        token: await h.tokenOf('teacher_a'),
                        headers: { clientId: 'inst-b' },
                    })
                ).status,
                403,
                'mismatch'
            );
        },
    ],
    [
        'T39',
        'Join APIs: BBB ended and blocked, Meet provisioning, Zoho, Zoom one-shot',
        async (h) => {
            h.mockOnly();
            const token = await h.tokenOf('teacher_a');
            const get = (path) =>
                h.call('GET', `/admin-core-service/live-sessions/provider/meeting/${path}`, {
                    token,
                    headers: { clientId: 'inst-a' },
                });
            eq(
                good(await get('join?scheduleId=sched-bbb-ended&role=MODERATOR&recreate=false'))
                    .status,
                'MEETING_ENDED',
                'ended'
            );
            ok(
                good(await get('join?scheduleId=sched-bbb-ended&role=MODERATOR&recreate=true'))
                    .joinUrl,
                'recreate'
            );
            eq(
                good(await get('join?scheduleId=sched-bbb-blocked&role=MODERATOR&recreate=true'))
                    .status,
                'RECREATE_BLOCKED',
                'blocked'
            );
            eq(
                (await get('google-meet-join?scheduleId=sched-meet-provisioning')).status,
                409,
                'provisioning'
            );
            eq(
                (await get('google-meet-join?scheduleId=sched-meet-provisioning')).status,
                409,
                'provisioning'
            );
            ok(
                good(await get('google-meet-join?scheduleId=sched-meet-provisioning')).joinUrl,
                'ready'
            );
            eq(
                good(await get('session-links?scheduleId=sched-zoho-nohost')).hostUrl,
                null,
                'no host link'
            );
            good(await get('zoom-sdk-signature?scheduleId=sched-zoom'));
            eq((await get('zoom-sdk-signature?scheduleId=sched-zoom')).status, 409, 'one-shot');
        },
    ],
    [
        'T45',
        'Volt: /create with no key behaves as today',
        async (h) => {
            h.mockOnly();
            const engage = '/community-service/engage/admin';
            const session = good(
                await h.call('POST', `${engage}/create`, { body: { source_id: 'deck-1' } })
            );
            good(
                await h.call('POST', `${engage}/start`, {
                    body: { session_id: session.session_id },
                })
            );
            good(
                await h.call('POST', `${engage}/move`, {
                    body: { session_id: session.session_id, move_to: 1 },
                })
            );
            good(
                await h.call('POST', `${engage}/finish`, {
                    body: { session_id: session.session_id },
                })
            );
        },
    ],
    [
        'T46',
        'Volt: /v2/create needs its key on control calls',
        async (h) => {
            h.mockOnly();
            const engage = '/community-service/engage/admin';
            const created = good(
                await h.call('POST', `${engage}/v2/create`, { body: { source_id: 'deck-1' } })
            );
            ok(created.presenter_key, 'has a key');
            ok(
                !JSON.stringify(created.session).includes(created.presenter_key),
                'key is not on the DTO'
            );
            const start = (headers) =>
                h.call('POST', `${engage}/start`, {
                    body: { session_id: created.session.session_id },
                    headers,
                });
            eq((await start()).status, 403, 'no key');
            eq((await start({ 'X-Presenter-Token': 'wrong' })).status, 403, 'wrong key');
            good(await start({ 'X-Presenter-Token': created.presenter_key }), 'right key');
        },
    ],
    [
        'T47',
        'Rate limit on pair/start, and 503 while disabled',
        async (h) => {
            const ip = `203.0.113.${(Date.now() % 200) + 1}`;
            let limited = null;
            for (let i = 0; i < 32 && limited === null; i += 1) {
                const res = await h.pub(
                    '/pair/start',
                    { install_id: `limit-${i}`, device: {} },
                    { ip, noRetry: true }
                );
                if (res.status === 429) limited = i;
                else eq(res.status, 200, 'under the limit');
            }
            eq(limited, 30, 'trips after 30');
            if (!h.isMock) return;
            const device = await h.pairedDevice();
            const session = (await h.signIn(device)).redeemed;
            await h.control('config', { panel_enabled: false, rate_limits: false });
            code(
                await h.pub('/pair/start', { install_id: 'x', device: {} }),
                503,
                'PANEL_DISABLED'
            );
            code(
                await h.pub('/challenge', { ...device.creds, purpose: 'SIGN_IN' }),
                503,
                'PANEL_DISABLED'
            );
            code(
                await h.pub('/session/login-password', {
                    ...device.creds,
                    username: 'a',
                    password: 'b',
                }),
                503,
                'PANEL_DISABLED'
            );
            eq(
                good(await h.sync(device, session)).session.status,
                'ACTIVE',
                'sessions keep syncing'
            );
        },
    ],
    [
        'T47b',
        'Oversized anonymous input is refused',
        async (h) => {
            code(await h.pub('/pair/start', { install_id: 'x'.repeat(65), device: {} }), 400);
            code(
                await h.pub('/pair/start', { install_id: 'x', device: { model: 'm'.repeat(121) } }),
                400
            );
            code(
                await h.pub('/pair/start', { install_id: 'x', device: { a: 'b'.repeat(700) } }),
                400
            );
        },
    ],
    [
        'T49',
        'Rooms and panels: create, bulk, rename, archive, move',
        async (h) => {
            const institute = h.inst('a').id;
            const name = h.roomName();
            const room = good(
                await h.bearer('admin_a', 'POST', '/admin/rooms', { institute_id: institute, name })
            );
            eq(room.status, 'ACTIVE', 'created');
            code(
                await h.bearer('admin_a', 'POST', '/admin/rooms', {
                    institute_id: institute,
                    name: name.toUpperCase(),
                }),
                409,
                'ROOM_NAME_TAKEN'
            );
            const extra = h.roomName();
            const bulk = good(
                await h.bearer('admin_a', 'POST', '/admin/rooms/bulk', {
                    institute_id: institute,
                    names: [extra, name],
                })
            );
            eq(bulk.created.length, 1, 'bulk created');
            eq(bulk.skipped_duplicates.join(), name, 'bulk skipped');
            code(
                await h.bearer('admin_a', 'POST', '/admin/rooms/bulk', {
                    institute_id: institute,
                    names: Array(201).fill('x'),
                }),
                400
            );
            const list = good(
                await h.bearer('admin_a', 'GET', `/admin/rooms?institute_id=${institute}`)
            );
            ok(
                list.rooms.some((r) => r.id === room.id),
                'listed'
            );
            ok(list.next_unpaired_room_id, 'next unpaired');

            const device = await h.pairedDevice('admin_a', 'a', { room_id: room.id });
            code(
                await h.bearer('admin_a', 'PATCH', `/admin/rooms/${room.id}`, {
                    status: 'ARCHIVED',
                }),
                409
            );
            const renamed = h.roomName();
            eq(
                good(
                    await h.bearer('admin_a', 'PATCH', `/admin/rooms/${room.id}`, { name: renamed })
                ).name,
                renamed,
                'rename'
            );
            const target = good(
                await h.bearer('admin_a', 'POST', '/admin/rooms', {
                    institute_id: institute,
                    name: h.roomName(),
                })
            );
            const moved = good(
                await h.bearer('admin_a', 'PATCH', `/admin/devices/${device.creds.device_id}`, {
                    room_id: target.id,
                })
            );
            eq(moved.room.id, target.id, 'moved');
            good(await h.pub('/sync', { ...device.creds, presenting: false }));
            const signed = await h.signIn(device);
            const rows = good(
                await h.bearer('admin_a', 'GET', `/admin/devices?institute_id=${institute}`)
            );
            const row = rows.find((d) => d.id === device.creds.device_id);
            ok(row, 'device listed');
            eq(row.online, true, 'online');
            eq(row.model, 'Panel 65', 'model');
            eq(row.current_session.id, signed.redeemed.session_id, 'current session');
            ok(row.current_session.user_name, 'teacher name');
            eq(
                good(
                    await h.bearer('admin_a', 'PATCH', `/admin/rooms/${room.id}`, {
                        status: 'ARCHIVED',
                    })
                ).status,
                'ARCHIVED',
                'empty room archives'
            );
            const institutes = good(await h.bearer('admin_a', 'GET', '/admin/institutes'));
            ok(
                institutes.some((i) => i.institute_id === institute),
                'admin institutes'
            );
            ok(
                !good(await h.bearer('teacher_a', 'GET', '/admin/institutes')).length,
                'teacher has none'
            );
            code(await h.bearer('teacher_a', 'GET', `/admin/rooms?institute_id=${institute}`), 403);
        },
    ],
    [
        'T51',
        'A room of another institute is refused, and its panel untouched',
        async (h) => {
            const victim = await h.pairedDevice('admin_a', 'a');
            const pair = await h.startPair();
            code(
                await h.claim('admin_b', pair, 'b', {
                    room_id: victim.room.id,
                    replace_existing: true,
                }),
                403,
                'ROOM_OTHER_INSTITUTE'
            );
            eq(
                good(await h.pub('/sync', { ...victim.creds, presenting: false })).device.status,
                'ACTIVE',
                'victim untouched'
            );
            const own = await h.pairedDevice('admin_b', 'b');
            code(
                await h.bearer('admin_b', 'PATCH', `/admin/devices/${own.creds.device_id}`, {
                    room_id: victim.room.id,
                }),
                403,
                'ROOM_OTHER_INSTITUTE'
            );
            code(
                await h.bearer('admin_b', 'PATCH', `/admin/devices/${victim.creds.device_id}`, {
                    password_login_allowed: true,
                }),
                403
            );
            code(
                await h.bearer(
                    'admin_b',
                    'POST',
                    `/admin/devices/${victim.creds.device_id}/revoke`,
                    {}
                ),
                403
            );
        },
    ],
    [
        'T52',
        'Wrong number at pairing cancels; a link alone cannot finish',
        async (h) => {
            const pair = await h.startPair();
            const preview = good(
                await h.bearer('admin_a', 'POST', '/pair/preview', { code: pair.code })
            );
            const wrong = preview.match_options.find((n) => n !== pair.match_code);
            code(
                await h.claim('admin_a', { ...pair, match_code: wrong }, 'a'),
                409,
                'WRONG_NUMBER'
            );
            eq(
                (await h.pub('/pair/poll', { pair_secret: pair.pair_secret })).body.state,
                'CANCELLED',
                'panel told'
            );
            code(
                await h.bearer('admin_a', 'POST', '/pair/preview', { code: pair.code }),
                404,
                'NOT_FOUND'
            );
            code(await h.claim('admin_a', pair, 'a'), 404, 'NOT_FOUND');
        },
    ],
    [
        'T53',
        'Approve at the moment the panel renews',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t }));
            good(
                await h.bearer('teacher_a', 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                })
            );
            const blocked = code(
                await h.pub('/challenge', { ...device.creds, purpose: 'SIGN_IN' }),
                409,
                'APPROVED_PENDING'
            );
            eq(blocked.challenge_id, challenge.challenge_id, 'names the challenge');
            eq(
                (await h.pollChallenge(device, blocked.challenge_id)).body.state,
                'REDEEMED',
                'redeems'
            );
        },
    ],
    [
        'T53b',
        'A new challenge kills an open one',
        async (h) => {
            const device = await h.pairedDevice();
            const first = await h.newChallenge(device);
            const second = await h.newChallenge(device);
            eq((await h.pollChallenge(device, first.challenge_id)).body.state, 'DEAD', 'first');
            eq(
                (await h.pollChallenge(device, second.challenge_id)).body.state,
                'PENDING',
                'second'
            );
        },
    ],
    [
        'T54',
        'Scan at 4:50, tap at 5:30; approve at 5:01, redeem at 5:30',
        async (h) => {
            h.mockOnly();
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            await h.advance(290 * 1000);
            const described = good(
                await h.bearer('teacher_a', 'POST', '/challenge/describe', { t })
            );
            ok(described.expires_in_s >= 119, 'scan raises the expiry');
            await h.advance(40 * 1000);
            eq(
                (await h.pollChallenge(device, challenge.challenge_id)).body.state,
                'SCANNED',
                'still scanned'
            );
            good(
                await h.bearer('teacher_a', 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                })
            );
            await h.advance(90 * 1000);
            eq(
                (await h.pollChallenge(device, challenge.challenge_id)).body.state,
                'REDEEMED',
                'redeems'
            );

            const late = await h.newChallenge(device);
            await h.advance(301 * 1000);
            eq(
                (await h.pollChallenge(device, late.challenge_id)).body.state,
                'EXPIRED',
                'unscanned expires'
            );
            const capped = await h.newChallenge(device);
            const cappedT = h.tokenFromQr(capped.qr_url);
            await h.advance(290 * 1000);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t: cappedT }));
            await h.advance(119 * 1000);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t: cappedT }));
            await h.advance(119 * 1000);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t: cappedT }));
            await h.advance(72 * 1000);
            code(
                await h.bearer('teacher_a', 'POST', '/challenge/describe', { t: cappedT }),
                404,
                'EXPIRED'
            );
        },
    ],
    [
        'T54b',
        'An approved challenge unredeemed for over 2 minutes dies, and its session with it',
        async (h) => {
            h.mockOnly();
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t }));
            const approved = good(
                await h.bearer('teacher_a', 'POST', '/challenge/approve', {
                    t,
                    match_code: challenge.match_code,
                })
            );
            await h.advance(121 * 1000);
            eq(
                (await h.pollChallenge(device, challenge.challenge_id)).body.state,
                'EXPIRED',
                'poll'
            );
            good(
                await h.pub('/challenge', { ...device.creds, purpose: 'SIGN_IN' }),
                'renewal allowed'
            );
            eq(
                good(await h.pub('/remote/state', { remote_token: approved.remote_token })).status,
                'ENDED',
                'session ended'
            );
        },
    ],
    [
        'T55',
        'Approve response dropped: the retry gets a new remote token, one session',
        async (h) => {
            const device = await h.pairedDevice();
            const challenge = await h.newChallenge(device);
            const t = h.tokenFromQr(challenge.qr_url);
            good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t }));
            const body = { t, match_code: challenge.match_code };
            const first = good(await h.bearer('teacher_a', 'POST', '/challenge/approve', body));
            await h.fault({ path: `${BEARER}/challenge/approve`, type: 'drop_response', times: 1 });
            eq(
                (await h.bearer('teacher_a', 'POST', '/challenge/approve', body)).status,
                0,
                'dropped'
            );
            const retry = good(await h.bearer('teacher_a', 'POST', '/challenge/approve', body));
            eq(retry.session_id, first.session_id, 'same session');
            ok(retry.remote_token !== first.remote_token, 'token rotated');
            eq(
                good(
                    await h.pub('/remote/nav', {
                        remote_token: first.remote_token,
                        delta: 1,
                        client_seq: 1,
                    })
                ).accepted,
                false,
                'old token dead'
            );
            eq(
                good(
                    await h.pub('/remote/nav', {
                        remote_token: retry.remote_token,
                        delta: 1,
                        client_seq: 1,
                    })
                ).accepted,
                true,
                'new token works'
            );
            const redeemed = good(await h.pollChallenge(device, challenge.challenge_id));
            eq(redeemed.session_id, first.session_id, 'panel signs in to the one session');
            code(await h.bearer('teacher_a2', 'POST', '/challenge/approve', body), 409, 'EXPIRED');
        },
    ],
    [
        'T56',
        'Nav response dropped: a retry does not double-move; a slow clock works after attach',
        async (h) => {
            const device = await h.pairedDevice();
            const { approved, redeemed } = await h.signIn(device);
            const remote = approved.remote_token;
            const counter = async () => good(await h.sync(device, redeemed)).session.nav_counter;
            const press = { remote_token: remote, delta: 1, client_seq: 5000000 };
            await h.fault({ path: `${PUB}/remote/nav`, type: 'drop_response', times: 1 });
            eq((await h.pub('/remote/nav', press)).status, 0, 'dropped');
            const retry = good(await h.pub('/remote/nav', press));
            eq(retry.accepted, true, 'retry accepted');
            eq(retry.duplicate, true, 'retry flagged');
            eq(await counter(), 1, 'moved once');
            good(
                await h.pub('/remote/nav', { remote_token: remote, delta: 1, client_seq: 5000001 })
            );
            good(
                await h.pub('/remote/nav', { remote_token: remote, delta: 1, client_seq: 5000002 })
            );
            eq(await counter(), 3, 'two quick taps both count');

            const attach = await h.newChallenge(device, 'ATTACH_REMOTE', {
                session_token: redeemed.session_token,
            });
            const t = h.tokenFromQr(attach.qr_url);
            eq(
                good(await h.bearer('teacher_a', 'POST', '/challenge/describe', { t })).purpose,
                'ATTACH_REMOTE',
                'purpose'
            );
            code(
                await h.bearer('teacher_a2', 'POST', '/challenge/describe', { t }),
                403,
                'OTHER_USER'
            );
            const attached = good(
                await h.bearer('teacher_a', 'POST', '/challenge/approve', {
                    t,
                    match_code: attach.match_code,
                })
            );
            eq(attached.session_id, redeemed.session_id, 'same session');
            eq(
                (await h.pollChallenge(device, attach.challenge_id)).body.state,
                'ATTACHED',
                'panel told'
            );
            eq(
                good(
                    await h.pub('/remote/nav', {
                        remote_token: attached.remote_token,
                        delta: 1,
                        client_seq: 7,
                    })
                ).accepted,
                true,
                'slow clock accepted'
            );
            eq(
                good(
                    await h.pub('/remote/nav', {
                        remote_token: remote,
                        delta: 1,
                        client_seq: 6000000,
                    })
                ).accepted,
                false,
                'old phone dead'
            );
            eq(await counter(), 4, 'counter keeps going');
        },
    ],
    [
        'T57',
        'Idle phone then one press; a static slide stays online',
        async (h) => {
            h.mockOnly();
            const device = await h.pairedDevice();
            const { approved, redeemed } = await h.signIn(device);
            const remote = approved.remote_token;
            const state = { index: 1, total: 5, title: 'Static' };
            good(await h.pub('/remote/state', { remote_token: remote }));
            for (let i = 0; i < 10; i += 1) {
                await h.advance(30 * 1000);
                good(await h.sync(device, redeemed, { presenting: true, state }));
                const read = good(await h.pub('/remote/state', { remote_token: remote }));
                eq(read.panel_online, true, `panel online after ${(i + 1) * 30} s`);
            }
            const idle = good(await h.sync(device, redeemed, { presenting: true, state }));
            eq(idle.next_poll_ms, 1000, 'phone seen: 1 s');
            await h.advance(40 * 1000);
            const away = good(await h.sync(device, redeemed, { presenting: true, state }));
            eq(away.session.phone_connected, false, 'phone gone quiet');
            eq(away.next_poll_ms, 5000, 'phone quiet: 5 s');
            good(await h.pub('/remote/nav', { remote_token: remote, delta: 1, client_seq: 9000 }));
            await h.advance(5000);
            const after = good(await h.sync(device, redeemed, { presenting: true, state }));
            ok(after.session.nav_age_ms <= 8000, 'press inside the freshness window');
            eq(after.session.nav_counter, 1, 'press counted');
            await h.advance(90 * 1000);
            eq(
                good(await h.pub('/remote/state', { remote_token: remote })).panel_online,
                false,
                'silent panel reads offline'
            );
            const signedOut = good(await h.pub('/sync', { ...device.creds, presenting: false }));
            eq(signedOut.next_poll_ms, 5 * MIN, 'signed out: 5 min');
            eq(good(await h.sync(device, redeemed)).next_poll_ms, MIN, 'signed in: 60 s');
        },
    ],
    [
        'T59',
        'Busy answers on panel paths while login stays up',
        async (h) => {
            h.mockOnly();
            const device = await h.pairedDevice();
            await h.control('config', { public_busy: true });
            const busy = code(
                await h.pub('/sync', { ...device.creds, presenting: false }),
                429,
                'BUSY'
            );
            ok(busy.retry_after_ms > 0, 'retry_after_ms');
            const user = h.user('teacher_a');
            good(
                await h.call('POST', '/auth-service/v1/login-root', {
                    body: { user_name: user.username, password: user.password },
                }),
                'login'
            );
        },
    ],
    [
        'T60',
        'The live-pairing cap counts unexpired rows only',
        async (h) => {
            h.mockOnly();
            await h.control('config', { pending_cap: 3, rate_limits: false });
            for (let i = 0; i < 3; i += 1) await h.startPair();
            code(await h.pub('/pair/start', { install_id: 'x', device: {} }), 503, 'BUSY');
            await h.advance(901 * 1000);
            await h.startPair();
        },
    ],
    [
        'T62',
        'DEVICE_REVOKED then OK: credentials still work',
        async (h) => {
            h.mockOnly();
            const device = await h.pairedDevice();
            await h.control('force-next', {
                path: `${PUB}/sync`,
                status: 401,
                body: { code: 'DEVICE_REVOKED' },
            });
            code(
                await h.pub('/sync', { ...device.creds, presenting: false }),
                401,
                'DEVICE_REVOKED'
            );
            eq(
                good(await h.pub('/sync', { ...device.creds, presenting: false })).device.status,
                'ACTIVE',
                'recovered'
            );
        },
    ],
    [
        'T63',
        'Claim gets TRY_AGAIN when the institute snapshot is unavailable',
        async (h) => {
            h.mockOnly();
            const pair = await h.startPair();
            await h.control('config', { directory_available: false });
            code(await h.claim('admin_a', pair, 'a'), 503, 'TRY_AGAIN');
            await h.control('config', { directory_available: true });
            good(await h.claim('admin_a', pair, 'a'), 'pairing still open');
        },
    ],
    [
        'S1',
        'Confirm is needed before sign-in; INVITED staff can sign in; approve base host rule',
        async (h) => {
            const pair = await h.startPair();
            good(await h.claim('admin_a', pair, 'a'));
            const polled = good(await h.pub('/pair/poll', { pair_secret: pair.pair_secret }));
            const creds = { device_id: polled.device_id, device_secret: polled.device_secret };
            code(
                await h.pub('/challenge', { ...creds, purpose: 'SIGN_IN' }),
                409,
                'DEVICE_NOT_ACTIVE'
            );
            good(await h.pub('/pair/confirm', { ...creds, accept: true }));
            good(await h.pub('/pair/confirm', { ...creds, accept: true }), 'confirm is idempotent');
            await h.signIn({ creds }, 'invited_teacher');
            if (h.isMock) {
                const beta = await h.pairedDevice('admin_b', 'b');
                const challenge = await h.newChallenge(beta);
                ok(
                    challenge.qr_url.startsWith('https://portal.beta-academy.example/classroom#c='),
                    'institute host'
                );
            }
        },
    ],
    [
        'S2',
        'Bad device credentials read DEVICE_REVOKED; a bad session reads ENDED',
        async (h) => {
            const device = await h.pairedDevice();
            const bad = { device_id: device.creds.device_id, device_secret: 'wrong' };
            code(await h.pub('/sync', { ...bad, presenting: false }), 401, 'DEVICE_REVOKED');
            code(await h.pub('/challenge', { ...bad, purpose: 'SIGN_IN' }), 401, 'DEVICE_REVOKED');
            code(
                await h.pub('/session/refresh', { ...bad, session_token: 'x' }),
                401,
                'DEVICE_REVOKED'
            );
            eq(
                good(await h.sync(device, { session_id: 'none', session_token: 'none' })).session
                    .status,
                'ENDED',
                'unknown session'
            );
            code(await h.refresh(device, { session_token: 'none' }), 401, 'SESSION_ENDED');
            code(
                await h.pub('/challenge', {
                    ...device.creds,
                    purpose: 'ATTACH_REMOTE',
                    session_token: 'none',
                }),
                401,
                'SESSION_ENDED'
            );
        },
    ],
    [
        'G1',
        'The gateway refuses anything that is not http on this machine',
        async () => {
            for (const bad of [
                'https://127.0.0.1:8071',
                'http://backend-stage.vacademy.io',
                'https://backend-stage.vacademy.io',
                'http://example.com',
                'http://10.0.0.5:8071',
                'not a url',
            ]) {
                let refused = false;
                try {
                    createGateway({ defaultUpstream: bad });
                } catch {
                    refused = true;
                }
                ok(refused, `default upstream ${bad}`);
            }
            let refused = false;
            try {
                createGateway({
                    defaultUpstream: 'http://127.0.0.1:1',
                    routes: [
                        { prefix: '/auth-service', upstream: 'https://backend-stage.vacademy.io' },
                    ],
                });
            } catch {
                refused = true;
            }
            ok(refused, 'route upstream');
        },
    ],
    [
        'G2',
        'Gateway faults: status, delay, offline, route check',
        async (h) => {
            await h.fault({ path: '/gateway-test', type: 'status', status: 500, times: 1 });
            eq((await h.call('GET', '/gateway-test/x')).status, 500, 'status fault');
            await h.fault({ path: '/gateway-test', type: 'offline', times: 1 });
            eq((await h.call('GET', '/gateway-test/x')).status, 0, 'offline fault');
            await h.fault({ path: '/gateway-test', type: 'delay', delay_ms: 250, times: 1 });
            const started = Date.now();
            await h.call('GET', '/gateway-test/x');
            ok(Date.now() - started >= 240, 'delay fault');
            eq(
                (
                    await h.call('POST', '/__gateway/routes', {
                        body: { prefix: '/x', upstream: 'https://example.com' },
                    })
                ).status,
                400,
                'route refused'
            );
        },
    ],
    ...phase2Scenarios({ ok, eq, code, good }),
];

// -------------------------------------------------------------------- runner ---

const only = arg('--only')?.split(',');
if (process.argv.includes('--list')) {
    SCENARIOS.forEach(([id, title]) => console.log(`${id}  ${title}`));
    process.exit(0);
}

const h = await harness();
let passed = 0;
let failed = 0;
let skipped = 0;
console.log(h.isMock ? 'Target: in-process mock' : `Target: ${arg('--base')}`);
for (const [id, title, run] of SCENARIOS) {
    if (only && !only.includes(id)) continue;
    await h.resetMock();
    await h.clearFaults();
    h.nextScenario();
    try {
        await run(h);
        passed += 1;
        console.log(`PASS ${id}  ${title}`);
    } catch (error) {
        if (error instanceof Skip) {
            skipped += 1;
            console.log(`SKIP ${id}  ${title} (${error.message})`);
        } else {
            failed += 1;
            console.log(`FAIL ${id}  ${title}\n     ${error.message}`);
            if (!(error instanceof Failure)) console.log(error.stack);
        }
    } finally {
        await h.runCleanups();
    }
}
await h.close();
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
