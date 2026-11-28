/**
 * Classroom phase 2 scenarios (T70 to T84 of the phase 2 test plan), run by run.mjs
 * after the phase 1 ones. Against the mock, each scenario switches on the features it
 * needs through /__mock/config. Against a real service the features are boot
 * properties, so --config lists the ones it was started with, and a scenario that
 * needs another is skipped:
 *
 *   "features": { "usage": true, "usage_recording": true, "licence": true,
 *                 "partners": true, "releases": true, "fleet": true },
 *   "internal": { "client_name": "...", "signature": "..." }
 *
 * Users used: installer_p (an installer at institute `partner`), installer_q (an
 * installer at `partner2`) and super_admin (listed in SUPER_ADMIN_USER_IDS), plus the
 * phase 1 users. On a real service, scenario rows that outlive the run (enforcement,
 * grants, links, releases) are undone after each scenario.
 */

const SUPER = '/auth-service/super-admin/v1/panel';
const INTERNAL = '/auth-service/internal/panel/v1';
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const ZONE = 'Asia/Kolkata';

/** Feature names in --config, and the mock switch each one flips. */
const FEATURE_FLAGS = {
    usage: 'usage_enabled',
    usage_recording: 'usage_recording',
    licence: 'licence_enabled',
    partners: 'partners_enabled',
    releases: 'releases_enabled',
    fleet: 'fleet_enabled',
};

const localDate = (ms) =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(ms));

/** Adds the phase 2 helpers to the run.mjs harness. */
export function extendHarness(h, { good, Skip }) {
    Object.assign(h, {
        cleanups: [],
        /** Undo after the scenario, on a real service only (the mock is reset anyway). */
        afterwards(fn) {
            if (!h.isMock) h.cleanups.push(fn);
        },
        async runCleanups() {
            for (const fn of h.cleanups.splice(0).reverse()) {
                try {
                    await fn();
                } catch {
                    // best effort
                }
            }
        },
        has: (name) => h.isMock || h.cfg.features?.[name] === true,
        async feature(...names) {
            if (h.isMock) {
                const flags = {};
                names.forEach((name) => {
                    flags[FEATURE_FLAGS[name]] = true;
                });
                await h.control('config', flags);
                return;
            }
            const missing = names.filter((name) => h.cfg.features?.[name] !== true);
            if (missing.length) throw new Skip(`service config lists no ${missing.join(', ')}`);
        },
        async serverNow() {
            return h.isMock ? (await h.control('now')).now : Date.now();
        },
        async superAdmin(method, path, body, options) {
            return h.call(method, `${SUPER}${path}`, {
                body,
                token: await h.tokenOf('super_admin'),
                ...options,
            });
        },
        internal: (path, headers) => h.call('GET', `${INTERNAL}${path}`, { headers }),
        internalHeaders() {
            const client = h.cfg.internal;
            if (!client?.client_name || !client?.signature) return null;
            return { clientName: client.client_name, Signature: client.signature };
        },
        /** A signed-out sync that reports this app build. */
        async setApp(device, versionCode, channel = 'DIRECT') {
            return good(
                await h.pub('/sync', {
                    ...device.creds,
                    presenting: false,
                    app_version_code: versionCode,
                    app_channel: channel,
                }),
                'sync with app version'
            );
        },
        async usageWindow() {
            const t = await h.serverNow();
            return { from: localDate(t - DAY), to: localDate(t + DAY), tz: ZONE };
        },
        usageQuery: (instituteKey, window, extra = {}) =>
            new URLSearchParams({
                institute_id: h.inst(instituteKey).id,
                ...window,
                ...extra,
            }).toString(),
        async enforce(instituteKey, enforcement) {
            const id = h.inst(instituteKey).id;
            good(
                await h.superAdmin('PUT', `/institutes/${id}/licence/enforcement`, { enforcement }),
                `enforcement ${enforcement}`
            );
            h.afterwards(() =>
                h.superAdmin('PUT', `/institutes/${id}/licence/enforcement`, {
                    enforcement: 'OFF',
                })
            );
        },
        async grant(
            instituteKey,
            { kind = 'PAID', seats = 1, endsInMs = 30 * DAY, graceDays = 0 } = {}
        ) {
            const t = await h.serverNow();
            const grant = good(
                await h.superAdmin(
                    'POST',
                    `/institutes/${h.inst(instituteKey).id}/licence/grants`,
                    {
                        kind,
                        seats,
                        starts_at: new Date(t - MIN).toISOString(),
                        ends_at: new Date(t + endsInMs).toISOString(),
                        grace_days: graceDays,
                        external_ref: `scenario ${h.runId}`,
                    }
                ),
                'grant'
            );
            h.afterwards(() =>
                h.superAdmin('POST', `/licence/grants/${grant.id}/cancel`, { note: 'scenario end' })
            );
            return grant;
        },
        async licence(instituteKey, admin = 'admin_a') {
            return good(
                await h.bearer(
                    admin,
                    'GET',
                    `/admin/licence?institute_id=${h.inst(instituteKey).id}`
                ),
                'licence view'
            );
        },
        roomLicence: (view, roomId) => view.rooms.find((r) => r.room.id === roomId),
        /** The installer's organisation, or a skip when the service does not know the account. */
        async installer(name) {
            const res = await h.bearer(name, 'GET', '/partner/me');
            if (!h.isMock && res.status === 403) throw new Skip(`${name} is not an installer here`);
            return good(res, `${name} /partner/me`).partner;
        },
        /** School invite, installer redeem. Revoked afterwards on a real service. */
        async linkInstaller(installer, instituteKey, admin = 'admin_a') {
            const invite = good(
                await h.bearer(admin, 'POST', '/admin/partner-invites', {
                    institute_id: h.inst(instituteKey).id,
                    install_days: 30,
                }),
                'invite'
            );
            const link = good(
                await h.bearer(installer, 'POST', '/partner/links/redeem', { code: invite.code }),
                'redeem'
            );
            h.afterwards(() =>
                h.bearer(admin, 'POST', `/admin/partners/${link.link_id}/revoke`, {})
            );
            return { invite, link };
        },
        /** An installer's set-up: claim, poll, confirm. The panel is left PENDING. */
        async partnerPanel(installer, instituteKey, extra = {}) {
            const pair = await h.startPair();
            const claimed = good(
                await h.bearer(installer, 'POST', '/partner/devices/claim', {
                    code: pair.code,
                    match_code: pair.match_code,
                    institute_id: h.inst(instituteKey).id,
                    ...(extra.room_id ? {} : { new_room_name: h.roomName() }),
                    ...extra,
                }),
                'installer claim'
            );
            const polled = good(
                await h.pub('/pair/poll', { pair_secret: pair.pair_secret }),
                'poll'
            );
            const creds = { device_id: polled.device_id, device_secret: polled.device_secret };
            good(await h.pub('/pair/confirm', { ...creds, accept: true }), 'confirm');
            return { creds, room: claimed.room, pair, polled };
        },
        /** A release registered by platform staff and made LIVE. Pulled afterwards. */
        async release({ versionCode, rollout = 100, required = false, channel = 'DIRECT' }) {
            const created = good(
                await h.superAdmin('POST', '/releases', {
                    channel,
                    version_code: versionCode,
                    version_name: `0.${versionCode}.0`,
                    apk_url: `https://${h.cfg.release?.host ?? 'downloads.example.test'}/classroom-${versionCode}.apk`,
                    sha256: 'a'.repeat(64),
                    size_bytes: 1000,
                    min_sdk: 24,
                    rollout_percent: rollout,
                    required,
                    // The pinned direct build identity (real mode: config "release").
                    package_name: h.cfg.release?.package_name ?? 'io.vacademy.classroom.direct',
                    signing_cert_sha256: h.cfg.release?.signing_cert_sha256 ?? 'b'.repeat(64),
                }),
                'release'
            );
            h.afterwards(() =>
                h.superAdmin('PATCH', `/releases/${created.id}`, { status: 'PULLED' })
            );
            const live = await h.superAdmin('PATCH', `/releases/${created.id}`, {
                status: 'LIVE',
            });
            if (
                !required ||
                live.status !== 409 ||
                live.body?.code !== 'FLOOR_WITHOUT_UPDATE' ||
                !(live.body.panels > 0)
            ) {
                return good(live, 'release live');
            }
            // A required build that panels below it cannot be offered: staff confirm with force_floor.
            return {
                ...good(
                    await h.superAdmin('PATCH', `/releases/${created.id}`, {
                        status: 'LIVE',
                        force_floor: true,
                    }),
                    'release live (force_floor)'
                ),
                floor_refused_panels: live.body.panels,
            };
        },
        async fleetOf(instituteKey = 'a') {
            return good(
                await h.bearer(
                    'admin_a',
                    'GET',
                    `/admin/fleet?institute_id=${h.inst(instituteKey).id}`
                ),
                'fleet'
            );
        },
    });
    return h;
}

const kindsFor = (fleet, deviceId) =>
    fleet.alerts.filter((a) => a.device_id === deviceId).map((a) => a.kind);
const alertFor = (fleet, deviceId, kind) =>
    fleet.alerts.find((a) => a.device_id === deviceId && a.kind === kind);

/** Every new Bearer route, as [method, path, body]. */
function bearerRoutes(instituteId) {
    const q = `institute_id=${instituteId}&from=2026-11-01&to=2026-11-07&tz=${ZONE}`;
    return [
        ['GET', `/admin/usage?${q}`],
        ['GET', `/admin/usage/sessions?${q}`],
        ['GET', `/admin/usage/multi?institute_ids=${instituteId}&from=2026-11-01&to=2026-11-07`],
        ['GET', `/admin/fleet?institute_id=${instituteId}`],
        ['GET', `/admin/licence?institute_id=${instituteId}`],
        ['POST', '/admin/licence/rooms/r/assign', {}],
        ['POST', '/admin/licence/rooms/r/release', {}],
        ['GET', `/admin/partners?institute_id=${instituteId}`],
        ['POST', '/admin/partner-invites', { institute_id: instituteId, install_days: 30 }],
        ['POST', '/admin/partner-invites/i/cancel', {}],
        ['POST', '/admin/partners/l/revoke', {}],
        ['GET', '/partner/me'],
        ['POST', '/partner/links/redeem', { code: 'ABCD2345' }],
        ['GET', '/partner/customers'],
        ['GET', `/partner/rooms?institute_id=${instituteId}`],
        ['POST', '/partner/devices/claim', { code: 'x', match_code: 1, institute_id: instituteId }],
        ['GET', `/partner/installs?institute_id=${instituteId}`],
    ];
}

/** Every platform-staff route, as [method, path, body]. */
function superRoutes(instituteId) {
    return [
        ['GET', `/institutes/${instituteId}/licence/enforcement`],
        ['PUT', `/institutes/${instituteId}/licence/enforcement`, { enforcement: 'LIVE' }],
        ['GET', `/institutes/${instituteId}/licence`],
        [
            'POST',
            `/institutes/${instituteId}/licence/grants`,
            {
                kind: 'PAID',
                seats: 1,
                starts_at: '2026-11-01T00:00:00Z',
                ends_at: '2027-11-01T00:00:00Z',
                grace_days: 0,
            },
        ],
        ['POST', '/licence/grants/g/cancel', { note: 'x' }],
        ['GET', '/licence/templates/auto_trial'],
        [
            'PUT',
            '/licence/templates/auto_trial',
            { kind: 'TRIAL', seats: 1, days: 7, grace_days: 0 },
        ],
        ['GET', '/licence/usage?month=2026-11&zone=Asia/Kolkata'],
        ['GET', '/partners'],
        ['POST', '/partners', { name: 'x', partner_institute_id: instituteId }],
        ['PATCH', '/partners/p', { status: 'SUSPENDED' }],
        ['POST', '/partners/p/links', { institute_id: instituteId }],
        ['POST', '/partner-links/l/revoke', {}],
        ['PATCH', '/rooms/r/partner', { partner_id: null }],
        ['GET', '/releases'],
        ['POST', '/releases', { channel: 'DIRECT', version_code: 9, version_name: '0.9.0' }],
        ['PATCH', '/releases/r', { status: 'PULLED' }],
    ];
}

export function phase2Scenarios({ ok, eq, code, good }) {
    const challenge = (h, device) => h.pub('/challenge', { ...device.creds, purpose: 'SIGN_IN' });

    return [
        [
            'P2',
            'Phase 2 off: new routes answer FEATURE_OFF, sync carries nothing new',
            async (h) => {
                h.mockOnly();
                const institute = h.inst('a').id;
                const device = await h.pairedDevice();
                await h.setApp(device, 3);
                const out = good(await h.pub('/sync', { ...device.creds, presenting: false }));
                eq(out.device.approval_state, 'APPROVED', 'approval state');
                ok(out.licence === undefined && out.update === undefined, 'no licence or update');
                eq(out.min_app_version_code, 1, 'floor is the property');
                const session = (await h.signIn(device)).redeemed;
                const signedIn = good(
                    await h.sync(device, session, {
                        activity: [{ seq: 1, kind: 'HOME', at_ms: Date.now() }],
                    })
                );
                ok(signedIn.activity_acked_seq === undefined, 'activity not acked while off');
                for (const [method, path, body] of bearerRoutes(institute)) {
                    code(
                        await h.bearer('admin_a', method, path, body),
                        404,
                        'FEATURE_OFF',
                        `${method} ${path}`
                    );
                    eq(
                        (await h.call(method, `/auth-service/v1/panel${path}`, { body })).status,
                        403,
                        `${method} ${path} without a token`
                    );
                }
                // Approve and reject have no switch, so waiting panels can still be settled.
                for (const action of ['approve', 'reject']) {
                    const path = `/admin/devices/d/${action}`;
                    code(await h.bearer('admin_a', 'POST', path, {}), 404, 'NOT_FOUND', path);
                    eq(
                        (await h.call('POST', `/auth-service/v1/panel${path}`, { body: {} }))
                            .status,
                        403,
                        `${path} without a token`
                    );
                }
                for (const [method, path, body] of superRoutes(institute)) {
                    code(
                        await h.superAdmin(method, path, body),
                        404,
                        'FEATURE_OFF',
                        `staff ${method} ${path}`
                    );
                }
                for (const path of ['/institutes', `/has-panels?institute_id=${institute}`]) {
                    code(await h.internal(path, h.internalHeaders()), 404, 'FEATURE_OFF', path);
                }
                const row = good(
                    await h.bearer('admin_a', 'GET', `/admin/devices?institute_id=${institute}`)
                ).find((d) => d.id === device.creds.device_id);
                eq(row.approval_state, 'APPROVED', 'row approval');
                eq(row.installed_by, null, 'row installer');
                eq(row.licence_state, null, 'row licence');
                eq(row.app_channel, 'DIRECT', 'row channel');
            },
        ],
        [
            'T70',
            'Activity in /sync is acked; replay is idempotent; >20 a request and >100 a session ignored',
            async (h) => {
                await h.feature('usage', 'usage_recording');
                const device = await h.pairedDevice();
                await h.setApp(device, 3);
                const session = (await h.signIn(device)).redeemed;
                const t = await h.serverNow();
                const ev = (seq, extra = {}) => ({
                    seq,
                    kind: 'LESSON',
                    ref_id: `slide-${seq}`,
                    parent_id: 'chapter-1',
                    title: `Slide ${seq}`,
                    at_ms: t + seq,
                    ...extra,
                });
                const send = async (events, label) =>
                    good(await h.sync(device, session, { activity: events }), label)
                        .activity_acked_seq;
                eq(await send([ev(1), ev(2), ev(3)], 'first'), 3, 'ack is the largest seq');
                eq(await send([ev(1), ev(2), ev(3)], 'replay'), 3, 'replay acked again');
                ok(
                    good(await h.sync(device, session)).activity_acked_seq === undefined,
                    'no ack without activity'
                );
                eq(
                    await send(
                        [
                            ev(4, { kind: 'NOT_A_KIND' }),
                            ev(5, { title: 'T'.repeat(250) }),
                            ev(6, { at_ms: t - 10 * DAY }),
                        ],
                        'odd entries'
                    ),
                    6,
                    'odd entries are acked so the panel lets them go'
                );
                const many = [];
                for (let seq = 7; seq <= 31; seq += 1) many.push(ev(seq));
                eq(await send(many, '25 at once'), 31, 'ack covers the ignored tail');
                // Fill well past the per-session cap, 20 a request.
                let seq = 31;
                for (let batch = 0; batch < 5; batch += 1) {
                    const events = [];
                    for (let i = 0; i < 20; i += 1) {
                        seq += 1;
                        events.push(ev(seq));
                    }
                    eq(await send(events, `batch ${batch}`), seq, `batch ${batch} acked`);
                }
                const window = await h.usageWindow();
                const drill = good(
                    await h.bearer(
                        'admin_a',
                        'GET',
                        `/admin/usage/sessions?${h.usageQuery('a', window, { room_id: device.room.id })}`
                    ),
                    'drill-down'
                );
                const row = drill.sessions.find((s) => s.id === session.session_id);
                ok(row, 'session listed');
                eq(row.events.length, 100, 'stored up to the per-session cap');
                const titles = new Set(row.events.map((e) => e.title));
                ok(!titles.has('Slide 27') && !titles.has('Slide 31'), 'past 20 a request ignored');
                ok(titles.has('Slide 26'), 'first 20 of the big request stored');
                const long = row.events.find((e) => e.title?.startsWith('TTT'));
                eq(long?.title.length, 200, 'title cut to 200');
                const early = row.events.find((e) => e.title === 'Slide 6');
                ok(
                    Date.parse(early.started_at) >= Date.parse(row.started_at),
                    'start clamped to the session'
                );
                if (h.isMock) {
                    await h.control('config', { usage_recording: false });
                    ok(
                        good(await h.sync(device, session, { activity: [ev(500)] }))
                            .activity_acked_seq === undefined,
                        'recording off: no ack'
                    );
                }
            },
        ],
        [
            'T71',
            '/usage totals for a seeded day; an abandoned session counts to 90 s past last seen',
            async (h) => {
                h.mockOnly();
                await h.feature('usage');
                const one = await h.pairedDevice();
                const two = await h.pairedDevice();
                const idle = await h.pairedDevice();
                const s1 = (await h.signIn(one, 'teacher_a')).redeemed;
                await h.advance(10 * MIN);
                good(await h.sync(one, s1), 'last sign of life');
                const s2 = (await h.signIn(two, 'teacher_a2')).redeemed;
                await h.advance(30 * MIN);
                good(await h.sync(two, s2));
                good(
                    await h.pub('/session/end', {
                        ...two.creds,
                        session_token: s2.session_token,
                        reason: 'SIGN_OUT',
                    })
                );
                await h.advance(2 * 60 * MIN); // one is abandoned, still ACTIVE in the table
                const window = await h.usageWindow();
                const report = good(
                    await h.bearer('admin_a', 'GET', `/admin/usage?${h.usageQuery('a', window)}`),
                    'usage'
                );
                eq(report.totals.sessions, 2, 'sessions');
                eq(report.totals.teachers, 2, 'teachers');
                eq(report.totals.rooms_used, 2, 'rooms used');
                eq(report.totals.rooms_with_panel, 3, 'rooms with a panel');
                eq(report.totals.idle_rooms, 1, 'idle rooms');
                eq(report.totals.coverage_pct, 0, 'nothing recorded');
                ok(
                    Math.abs(report.totals.panel_hours - 41.5 / 60) <= 0.06,
                    `hours ${report.totals.panel_hours}, want about 0.69`
                );
                eq(report.idle_rooms[0].room.id, idle.room.id, 'the idle room');
                eq(
                    report.by_day.reduce((n, day) => n + day.sessions, 0),
                    2,
                    'by_day adds up'
                );
                eq(report.by_room.length, 2, 'by_room');
                eq(report.by_teacher.length, 2, 'by_teacher');
                eq(report.notes.content_recorded_from, null, 'no content yet');
                const drill = good(
                    await h.bearer(
                        'admin_a',
                        'GET',
                        `/admin/usage/sessions?${h.usageQuery('a', window)}`
                    )
                );
                eq(drill.total, 2, 'drill total');
                const abandoned = drill.sessions.find((s) => s.id === s1.session_id);
                eq(abandoned.end_reason, null, 'still open in the table');
                ok(
                    abandoned.minutes >= 11 && abandoned.minutes <= 12,
                    `abandoned minutes ${abandoned.minutes}`
                );
                const bound = Date.parse(abandoned.started_at) + 10 * MIN + 90 * 1000;
                ok(
                    Math.abs(Date.parse(abandoned.end_at) - bound) <= 1000,
                    'ends 90 s after the last sync'
                );
                const ended = drill.sessions.find((s) => s.id === s2.session_id);
                eq(ended.minutes, 30, 'signed-out session');
                eq(ended.end_reason, 'SIGN_OUT', 'end reason');
                code(
                    await h.bearer('admin_b', 'GET', `/admin/usage?${h.usageQuery('a', window)}`),
                    403
                );
                code(
                    await h.bearer('teacher_a', 'GET', `/admin/usage?${h.usageQuery('a', window)}`),
                    403
                );
                code(
                    await h.bearer(
                        'admin_a',
                        'GET',
                        `/admin/usage?${h.usageQuery('a', { from: '2026-01-01', to: '2026-06-01', tz: 'Asia/Kolkata' })}`
                    ),
                    400,
                    null,
                    'over 92 days'
                );
            },
        ],
        [
            'T72',
            'IDLE end trims idle_minutes + 60 s; other reasons and recording off do not',
            async (h) => {
                h.mockOnly();
                await h.feature('usage', 'usage_recording');
                const teach = async (device, teacher, minutes, reason) => {
                    const session = (await h.signIn(device, teacher)).redeemed;
                    for (let i = 0; i < minutes; i += 1) {
                        await h.advance(MIN);
                        good(await h.sync(device, session));
                    }
                    good(
                        await h.pub('/session/end', {
                            ...device.creds,
                            session_token: session.session_token,
                            reason,
                        })
                    );
                    return session;
                };
                const long = await teach(await h.pairedDevice(), 'teacher_a', 45, 'IDLE');
                const short = await teach(await h.pairedDevice(), 'teacher_a2', 5, 'IDLE');
                const signOut = await teach(await h.pairedDevice(), 'teacher_a', 20, 'SIGN_OUT');
                await h.control('config', { usage_recording: false });
                const untrimmed = await teach(await h.pairedDevice(), 'teacher_a2', 10, 'IDLE');
                const window = await h.usageWindow();
                const drill = good(
                    await h.bearer(
                        'admin_a',
                        'GET',
                        `/admin/usage/sessions?${h.usageQuery('a', window)}`
                    )
                );
                const minutes = (s) => drill.sessions.find((r) => r.id === s.session_id).minutes;
                eq(minutes(long), 14, '45 min less 30 idle and the 60 s countdown');
                eq(minutes(short), 0, 'never before the start');
                eq(minutes(signOut), 20, 'sign-out untouched');
                eq(minutes(untrimmed), 10, 'recording off: no trim');
                const state = await h.control('state');
                const row = state.sessions.find((s) => s.id === long.session_id);
                eq(row.active_until, row.ended_at - 31 * MIN, 'active_until written');
            },
        ],
        [
            'T73',
            '/usage/multi answers only when the caller is ADMIN of every id',
            async (h) => {
                await h.feature('usage');
                const window = await h.usageWindow();
                const a = h.inst('a').id;
                const b = h.inst('b').id;
                const range = new URLSearchParams(window).toString();
                const multi = (user, ids) =>
                    h.bearer(user, 'GET', `/admin/usage/multi?institute_ids=${ids}&${range}`);
                const own = good(await multi('admin_a', a), 'own institute');
                ok(Array.isArray(own) && own.length === 1, 'one row');
                eq(own[0].institute_id, a, 'row institute');
                ok(typeof own[0].totals.sessions === 'number', 'totals');
                ok(own[0].by_room === undefined, 'totals only');
                code(await multi('admin_a', `${a},${b}`), 403, null, 'one foreign id refuses all');
                code(await multi('teacher_a', a), 403, null, 'teacher');
                const tooMany = Array.from({ length: 51 }, (_, i) => `x${i}`).join(',');
                const refused = await multi('admin_a', tooMany);
                ok(refused.status === 400 || refused.status === 403, `51 ids: ${refused.status}`);
            },
        ],
        [
            'T74',
            'LIVE enforcement: unlicensed room refused, LICENCE_REQUIRED for v3 and PANEL_DISABLED for v2',
            async (h) => {
                await h.feature('licence');
                const panel = await h.pairedDevice();
                await h.setApp(panel, 3);
                const old = await h.pairedDevice();
                await h.setApp(old, 2);
                await h.enforce('a', 'LIVE');
                code(await challenge(h, panel), 403, 'LICENCE_REQUIRED', 'v3 panel');
                code(await challenge(h, old), 403, 'PANEL_DISABLED', 'v2 panel');
                good(
                    await h.bearer('admin_a', 'PATCH', `/admin/devices/${old.creds.device_id}`, {
                        password_login_allowed: true,
                    })
                );
                code(
                    await h.pub('/session/login-password', {
                        ...old.creds,
                        username: h.user('teacher_a').username ?? 'teacher_a',
                        password: 'not-checked',
                    }),
                    403,
                    'PANEL_DISABLED',
                    'password sign-in, before any credential check'
                );
                const out = good(await h.pub('/sync', { ...panel.creds, presenting: false }));
                eq(out.licence?.enforced, true, 'enforced');
                ok(['EXPIRED', 'UNLICENSED'].includes(out.licence.state), out.licence.state);
                const view = await h.licence('a');
                await h.grant('a', { seats: view.seats_used + 1 });
                code(await challenge(h, panel), 403, 'LICENCE_REQUIRED', 'a grant assigns no seat');
                eq(
                    good(
                        await h.bearer(
                            'admin_a',
                            'POST',
                            `/admin/licence/rooms/${panel.room.id}/assign`,
                            {}
                        ),
                        'assign'
                    ).licence_state,
                    'LICENSED',
                    'assigned'
                );
                const session = (await h.signIn(panel)).redeemed;
                // Mid-class the seat goes: nothing running is cut.
                good(
                    await h.bearer(
                        'admin_a',
                        'POST',
                        `/admin/licence/rooms/${panel.room.id}/release`,
                        {}
                    ),
                    'release'
                );
                good(await h.refresh(panel, session), 'refresh not checked');
                const during = good(await h.sync(panel, session), 'sync not checked');
                eq(during.session.status, 'ACTIVE', 'still teaching');
                ok(during.licence === undefined, 'no licence block while signed in');
                good(
                    await h.pub('/challenge', {
                        ...panel.creds,
                        purpose: 'ATTACH_REMOTE',
                        session_token: session.session_token,
                    }),
                    'ATTACH_REMOTE not checked'
                );
                code(await challenge(h, panel), 403, 'LICENCE_REQUIRED', 'next sign-in');
            },
        ],
        [
            'T75',
            'Grant ends mid-session: refresh and sync run to session_hours; the next sign-in is refused',
            async (h) => {
                h.mockOnly();
                await h.feature('licence');
                await h.enforce('a', 'LIVE');
                await h.grant('a', { seats: 1, endsInMs: 30 * MIN });
                const panel = await h.pairedDevice();
                await h.setApp(panel, 3);
                const before = good(await h.pub('/sync', { ...panel.creds, presenting: false }));
                eq(before.licence.state, 'LICENSED', 'seat taken at confirm');
                const session = (await h.signIn(panel)).redeemed;
                await h.advance(40 * MIN);
                for (let i = 0; i < 4; i += 1) {
                    good(await h.refresh(panel, session), `refresh ${i}`);
                    eq(good(await h.sync(panel, session)).session.status, 'ACTIVE', `sync ${i}`);
                    await h.advance(50 * MIN);
                }
                // 240 minutes in: the session cap ends it, not the licence.
                code(await h.refresh(panel, session), 401, 'SESSION_ENDED');
                code(await challenge(h, panel), 403, 'LICENCE_REQUIRED', 'next sign-in');
                const after = good(await h.pub('/sync', { ...panel.creds, presenting: false }));
                eq(after.licence.state, 'EXPIRED', 'expired');
            },
        ],
        [
            'T76',
            'SHADOW never refuses; never-block turns LIVE into SHADOW',
            async (h) => {
                await h.feature('licence');
                const panel = await h.pairedDevice();
                await h.setApp(panel, 3);
                await h.enforce('a', 'SHADOW');
                const out = good(await h.pub('/sync', { ...panel.creds, presenting: false }));
                eq(out.licence.enforced, false, 'not enforced');
                ok(['EXPIRED', 'UNLICENSED'].includes(out.licence.state), out.licence.state);
                await h.signIn(panel);
                const view = await h.licence('a');
                eq(view.enforcement, 'SHADOW', 'admin sees SHADOW');
                ok(['NONE', 'EXPIRED'].includes(view.state), view.state);
                if (!h.isMock) return;
                await h.control('config', { licence_never_block: true });
                await h.enforce('a', 'LIVE');
                eq(
                    good(await h.pub('/sync', { ...panel.creds, presenting: false })).licence
                        .enforced,
                    false,
                    'never-block'
                );
                await h.signIn(panel);
            },
        ],
        [
            'T77',
            'Seats: auto-assign on confirm, NO_SEAT when full, release frees, archive releases',
            async (h) => {
                await h.feature('licence');
                await h.enforce('a', 'SHADOW');
                const used = (await h.licence('a')).seats_used;
                await h.grant('a', { seats: used + 1 });
                const one = await h.pairedDevice();
                const two = await h.pairedDevice();
                let view = await h.licence('a');
                eq(h.roomLicence(view, one.room.id).licence_state, 'LICENSED', 'first room');
                eq(h.roomLicence(view, two.room.id).licence_state, 'UNLICENSED', 'no seat left');
                eq(view.seats_used, used + 1, 'seats used');
                const assign = (room) =>
                    h.bearer('admin_a', 'POST', `/admin/licence/rooms/${room.id}/assign`, {});
                const release = (room) =>
                    h.bearer('admin_a', 'POST', `/admin/licence/rooms/${room.id}/release`, {});
                code(await assign(two.room), 409, 'NO_SEAT');
                code(
                    await h.bearer(
                        'admin_b',
                        'POST',
                        `/admin/licence/rooms/${one.room.id}/release`,
                        {}
                    ),
                    403
                );
                const row = good(
                    await h.bearer(
                        'admin_a',
                        'GET',
                        `/admin/devices?institute_id=${h.inst('a').id}`
                    )
                ).find((d) => d.id === one.creds.device_id);
                eq(row.licence_state, 'LICENSED', 'device row');
                eq(good(await release(one.room)).licence_state, 'UNLICENSED', 'released');
                eq(good(await assign(two.room)).licence_state, 'LICENSED', 'seat moved');
                good(
                    await h.bearer(
                        'admin_a',
                        'POST',
                        `/admin/devices/${two.creds.device_id}/revoke`,
                        {}
                    )
                );
                view = await h.licence('a');
                ok(h.roomLicence(view, two.room.id)?.licensed_at, 'revoking keeps the seat');
                good(
                    await h.bearer('admin_a', 'PATCH', `/admin/rooms/${two.room.id}`, {
                        status: 'ARCHIVED',
                    }),
                    'archive'
                );
                eq(good(await assign(one.room)).licence_state, 'LICENSED', 'archive freed it');
                if (!h.isMock) return;
                // Automatic trial from the template, once, for an institute with no grant.
                good(
                    await h.superAdmin('PUT', '/licence/templates/auto_trial', {
                        kind: 'TRIAL',
                        seats: 2,
                        days: 14,
                        grace_days: 0,
                    })
                );
                await h.enforce('b', 'SHADOW');
                const beta = await h.pairedDevice('admin_b', 'b');
                const trial = await h.licence('b', 'admin_b');
                eq(trial.state, 'TRIAL', 'trial started');
                eq(trial.seats_granted, 2, 'trial seats');
                eq(h.roomLicence(trial, beta.room.id).licence_state, 'LICENSED', 'trial seat');
            },
        ],
        [
            'T78',
            'Invite, redeem, installer claim lands PENDING; AWAITING_APPROVAL; approve gives a seat; sign-in works',
            async (h) => {
                await h.feature('partners');
                const partner = await h.installer('installer_p');
                code(await h.bearer('admin_a', 'GET', '/partner/me'), 403, 'NOT_INSTALLER');
                const institute = h.inst('a').id;
                for (const days of [0, 91]) {
                    code(
                        await h.bearer('admin_a', 'POST', '/admin/partner-invites', {
                            institute_id: institute,
                            install_days: days,
                        }),
                        400,
                        null,
                        `install_days ${days}`
                    );
                }
                const { invite, link } = await h.linkInstaller('installer_p', 'a');
                eq(link.institute_id, institute, 'linked institute');
                ok(link.install_until, 'install window');
                code(
                    await h.bearer('installer_p', 'POST', '/partner/links/redeem', {
                        code: invite.code,
                    }),
                    404,
                    'INVITE_INVALID',
                    'single use'
                );
                const spare = good(
                    await h.bearer('admin_a', 'POST', '/admin/partner-invites', {
                        institute_id: institute,
                        install_days: 30,
                    })
                );
                code(
                    await h.bearer('admin_a', 'POST', '/partner/links/redeem', {
                        code: spare.code,
                    }),
                    403,
                    'NOT_INSTALLER'
                );
                eq(
                    good(
                        await h.bearer(
                            'admin_a',
                            'POST',
                            `/admin/partner-invites/${spare.id}/cancel`,
                            {}
                        )
                    ).status,
                    'CANCELLED',
                    'cancel'
                );
                code(
                    await h.bearer('installer_p', 'POST', '/partner/links/redeem', {
                        code: spare.code,
                    }),
                    404,
                    'INVITE_INVALID',
                    'cancelled code'
                );
                const customers = good(await h.bearer('installer_p', 'GET', '/partner/customers'));
                ok(
                    customers.some((c) => c.institute_id === institute),
                    'school listed'
                );
                const linked = good(
                    await h.bearer('admin_a', 'GET', `/admin/partners?institute_id=${institute}`)
                ).find((l) => l.link_id === link.link_id);
                eq(linked.partner_name, partner.name, 'school sees the installer');
                eq(linked.linked_via, 'SCHOOL_CODE', 'linked via');

                const seats = h.has('licence');
                if (seats) {
                    await h.feature('licence');
                    await h.enforce('a', 'LIVE');
                    await h.grant('a', { seats: (await h.licence('a')).seats_used + 1 });
                }
                const panel = await h.partnerPanel('installer_p', 'a');
                eq(panel.polled.installed_by, partner.name, 'panel names the installer');
                await h.setApp(panel, 3);
                const synced = good(await h.pub('/sync', { ...panel.creds, presenting: false }));
                eq(synced.device.approval_state, 'PENDING', 'pending');
                code(await challenge(h, panel), 403, 'AWAITING_APPROVAL', 'v3');
                await h.setApp(panel, 2);
                code(await challenge(h, panel), 403, 'PANEL_DISABLED', 'v2');
                await h.setApp(panel, 3);
                const listed = good(
                    await h.bearer('admin_a', 'GET', `/admin/devices?institute_id=${institute}`)
                ).find((d) => d.id === panel.creds.device_id);
                eq(listed.approval_state, 'PENDING', 'row pending');
                eq(listed.installed_by, partner.name, 'row installer');
                code(
                    await h.bearer(
                        'admin_b',
                        'POST',
                        `/admin/devices/${panel.creds.device_id}/approve`,
                        {}
                    ),
                    403
                );
                code(
                    await h.bearer(
                        'installer_p',
                        'POST',
                        `/admin/devices/${panel.creds.device_id}/approve`,
                        {}
                    ),
                    403
                );
                const approved = good(
                    await h.bearer(
                        'admin_a',
                        'POST',
                        `/admin/devices/${panel.creds.device_id}/approve`,
                        {}
                    ),
                    'approve'
                );
                eq(approved.approval_state, 'APPROVED', 'approved');
                if (seats) eq(approved.licence_state, 'LICENSED', 'approval gives a seat');
                await h.signIn(panel);
                if (!h.isMock) return;
                // Three redeems so far; the hourly limit is 10 per user.
                let limitedAt = null;
                for (let i = 0; i < 10 && limitedAt === null; i += 1) {
                    const res = await h.bearer('installer_p', 'POST', '/partner/links/redeem', {
                        code: `ZZZZ${i}XYZ`,
                    });
                    if (res.status === 429) limitedAt = i;
                    else code(res, 404, 'INVITE_INVALID', `guess ${i}`);
                }
                eq(limitedAt, 7, 'redeem limited at the 11th try');
            },
        ],
        [
            'T79',
            'Installer claim into an occupied room: ROOM_OCCUPIED, never replaces',
            async (h) => {
                await h.feature('partners');
                await h.installer('installer_p');
                await h.linkInstaller('installer_p', 'a');
                const existing = await h.pairedDevice();
                const pair = await h.startPair();
                const body = {
                    code: pair.code,
                    match_code: pair.match_code,
                    institute_id: h.inst('a').id,
                };
                code(
                    await h.bearer('installer_p', 'POST', '/partner/devices/claim', {
                        ...body,
                        room_id: existing.room.id,
                        replace_existing: true,
                    }),
                    409,
                    'ROOM_OCCUPIED'
                );
                eq(
                    good(await h.pub('/sync', { ...existing.creds, presenting: false })).device
                        .status,
                    'ACTIVE',
                    'the old panel is untouched'
                );
                code(
                    await h.bearer('installer_p', 'POST', '/partner/devices/claim', {
                        ...body,
                        institute_id: h.inst('b').id,
                        new_room_name: h.roomName(),
                    }),
                    403,
                    'NOT_INSTALLER',
                    'unlinked school'
                );
                good(
                    await h.bearer('installer_p', 'POST', '/partner/devices/claim', {
                        ...body,
                        new_room_name: h.roomName(),
                    }),
                    'a free room still works'
                );
                if (!h.isMock) return;
                await h.advance(31 * DAY);
                await h.reloadMockConfig();
                const late = await h.startPair();
                code(
                    await h.bearer('installer_p', 'POST', '/partner/devices/claim', {
                        code: late.code,
                        match_code: late.match_code,
                        institute_id: h.inst('a').id,
                        new_room_name: h.roomName(),
                    }),
                    403,
                    'NOT_INSTALLER',
                    'install window over'
                );
                ok(
                    good(await h.bearer('installer_p', 'GET', '/partner/customers')).some(
                        (c) => c.institute_id === h.inst('a').id
                    ),
                    'health view stays'
                );
            },
        ],
        [
            'T80',
            "Installer cannot read /usage, /fleet, or another installer's panels",
            async (h) => {
                await h.feature('partners', 'usage', 'fleet');
                await h.installer('installer_p');
                await h.installer('installer_q');
                await h.linkInstaller('installer_p', 'a');
                await h.linkInstaller('installer_q', 'a');
                const panel = await h.partnerPanel('installer_p', 'a');
                const institute = h.inst('a').id;
                const window = await h.usageWindow();
                code(
                    await h.bearer(
                        'installer_p',
                        'GET',
                        `/admin/usage?${h.usageQuery('a', window)}`
                    ),
                    403,
                    null,
                    'usage'
                );
                code(
                    await h.bearer('installer_p', 'GET', `/admin/fleet?institute_id=${institute}`),
                    403,
                    null,
                    'fleet'
                );
                code(
                    await h.bearer(
                        'installer_p',
                        'GET',
                        `/admin/devices?institute_id=${institute}`
                    ),
                    403,
                    null,
                    'device list'
                );
                const mine = good(
                    await h.bearer(
                        'installer_p',
                        'GET',
                        `/partner/installs?institute_id=${institute}`
                    )
                );
                const row = mine.find((r) => r.device_id === panel.creds.device_id);
                ok(row, 'own install listed');
                eq(row.approval_state, 'PENDING', 'health row');
                for (const key of ['user', 'claimed_by_name', 'current_session', 'sessions']) {
                    ok(!(key in row), `no ${key} in a health row`);
                }
                const theirs = good(
                    await h.bearer(
                        'installer_q',
                        'GET',
                        `/partner/installs?institute_id=${institute}`
                    )
                );
                ok(
                    !theirs.some((r) => r.device_id === panel.creds.device_id),
                    "another installer's panel is not listed"
                );
                code(
                    await h.bearer(
                        'installer_p',
                        'GET',
                        `/partner/installs?institute_id=${h.inst('b').id}`
                    ),
                    403,
                    null,
                    'unlinked school installs'
                );
                code(
                    await h.bearer(
                        'installer_p',
                        'GET',
                        `/partner/rooms?institute_id=${h.inst('b').id}`
                    ),
                    403,
                    null,
                    'unlinked school rooms'
                );
            },
        ],
        [
            'T81',
            'Release rollout: 0% offers none, 100% offers; required gates sign-in below it',
            async (h) => {
                await h.feature('releases');
                const base = h.isMock ? 4 : 100000 + Math.floor(Math.random() * 800000);
                const direct = await h.pairedDevice();
                await h.setApp(direct, 3, 'DIRECT');
                const play = await h.pairedDevice();
                await h.setApp(play, 3, 'PLAY');
                const old = await h.pairedDevice();
                await h.setApp(old, 2, 'DIRECT');
                const signedOut = async (device) =>
                    good(await h.pub('/sync', { ...device.creds, presenting: false }));
                const first = await h.release({ versionCode: base, rollout: 0 });
                ok((await signedOut(direct)).update === undefined, '0%: no offer');
                good(
                    await h.superAdmin('PATCH', `/releases/${first.id}`, { rollout_percent: 100 })
                );
                const offered = (await signedOut(direct)).update;
                eq(offered?.version_code, base, '100%: offered');
                eq(offered.required, false, 'not required');
                ok(offered.apk_url && offered.sha256, 'download details');
                ok((await signedOut(play)).update === undefined, 'never on the store channel');
                const session = (await h.signIn(direct)).redeemed;
                ok(good(await h.sync(direct, session)).update === undefined, 'never signed in');
                const required = await h.release({ versionCode: base + 1, required: true });
                // The v2 panel predates the updater, so going live needed force_floor.
                ok(required.floor_refused_panels >= 1, 'floor refused until confirmed');
                code(await challenge(h, direct), 403, 'UPDATE_REQUIRED', 'below the floor');
                code(await challenge(h, old), 403, 'PANEL_DISABLED', 'v2 below the floor');
                const floor = await signedOut(direct);
                eq(floor.min_app_version_code, base + 1, 'floor on sync');
                eq(floor.update?.version_code, base + 1, 'required build offered');
                eq(floor.update.required, true, 'offer is required');
                good(await challenge(h, play), 'the floor is per channel');
                good(await h.superAdmin('PATCH', `/releases/${required.id}`, { status: 'PULLED' }));
                good(await challenge(h, direct), 'pulled: sign-in again');
            },
        ],
        [
            'T82',
            'Fleet: OFFLINE after 48 h, UNUSED after 7 school days, UPDATE_REQUIRED, NOT_CONFIRMED',
            async (h) => {
                h.mockOnly();
                // The version floor is a fleet alert only while releases are on.
                await h.feature('fleet', 'releases');
                const silent = await h.pairedDevice();
                await h.setApp(silent, 3);
                const unused = await h.pairedDevice();
                const pair = await h.startPair();
                const claimed = good(await h.claim('admin_a', pair, 'a'), 'claim only');
                let fleet = await h.fleetOf();
                eq(fleet.alerts.length, 0, 'quiet at first');
                eq(alertFor(fleet, claimed.device_id, 'NOT_CONFIRMED'), undefined, 'just claimed');
                await h.control('config', { min_app_version_code: 3 });
                fleet = await h.fleetOf();
                eq(
                    alertFor(fleet, unused.creds.device_id, 'UPDATE_REQUIRED')?.severity,
                    'bad',
                    'below the property floor'
                );
                for (let day = 1; day <= 10; day += 1) {
                    await h.advance(DAY);
                    good(await h.pub('/sync', { ...unused.creds, presenting: false }));
                    if (day === 1) {
                        fleet = await h.fleetOf();
                        ok(!kindsFor(fleet, silent.creds.device_id).includes('OFFLINE'), 'day 1');
                    }
                    if (day === 3) {
                        fleet = await h.fleetOf();
                        eq(
                            alertFor(fleet, silent.creds.device_id, 'OFFLINE')?.severity,
                            'warn',
                            'offline past 48 h'
                        );
                    }
                }
                fleet = await h.fleetOf();
                eq(alertFor(fleet, silent.creds.device_id, 'OFFLINE')?.severity, 'bad', '7 d+');
                eq(alertFor(fleet, unused.creds.device_id, 'UNUSED')?.severity, 'warn', 'unused');
                eq(alertFor(fleet, unused.creds.device_id, 'UNUSED').incident_key, 'none', 'key');
                ok(
                    !kindsFor(fleet, unused.creds.device_id).includes('OFFLINE'),
                    'the syncing panel is online'
                );
                eq(
                    alertFor(fleet, claimed.device_id, 'NOT_CONFIRMED')?.severity,
                    'warn',
                    'never confirmed'
                );
                const counted = fleet.alerts.reduce((map, a) => {
                    map[a.kind] = (map[a.kind] ?? 0) + 1;
                    return map;
                }, {});
                eq(JSON.stringify(fleet.counts), JSON.stringify(counted), 'counts match');
                eq(fleet.alerts[0].severity, 'bad', 'worst first');
                code(
                    await h.bearer('admin_b', 'GET', `/admin/fleet?institute_id=${h.inst('a').id}`),
                    403
                );
            },
        ],
        [
            'T83',
            'Platform-staff endpoints refuse anyone not on the staff list',
            async (h) => {
                const institute = h.inst('a').id;
                const check = async (label) => {
                    for (const [method, path, body] of superRoutes(institute)) {
                        code(
                            await h.call(method, `${SUPER}${path}`, {
                                body,
                                token: await h.tokenOf('admin_a'),
                            }),
                            403,
                            null,
                            `${label} ${method} ${path}`
                        );
                        eq(
                            (await h.call(method, `${SUPER}${path}`, { body })).status,
                            403,
                            `${method} ${path} without a token`
                        );
                    }
                };
                await check('switches as started');
                if (h.isMock) {
                    await h.feature('licence', 'partners', 'releases');
                    await check('switches on');
                }
                if (h.has('licence')) {
                    const usage = await h.superAdmin(
                        'GET',
                        '/licence/usage?month=2026-11&zone=Asia/Kolkata'
                    );
                    ok(Array.isArray(good(usage, 'staff usage').rows), 'usage rows');
                }
                if (h.has('partners')) {
                    ok(Array.isArray(good(await h.superAdmin('GET', '/partners'))), 'partners');
                }
                if (h.has('releases')) {
                    ok(Array.isArray(good(await h.superAdmin('GET', '/releases'))), 'releases');
                }
                if (!h.isMock) return;
                await h.control('config', { super_admin_user_ids: [] });
                code(await h.superAdmin('GET', '/partners'), 403, null, 'empty list: nobody');
            },
        ],
        [
            'T84',
            'Internal endpoints refuse without the client signature',
            async (h) => {
                const institute = h.inst('a').id;
                const window = await h.usageWindow();
                const paths = [
                    '/institutes',
                    `/has-panels?institute_id=${institute}`,
                    `/usage-summary?${h.usageQuery('a', window)}`,
                    `/fleet?institute_id=${institute}`,
                ];
                const token = await h.tokenOf('admin_a');
                for (const path of paths) {
                    eq((await h.internal(path)).status, 401, `${path} bare`);
                    eq(
                        (
                            await h.internal(path, {
                                clientName: 'admin_core_service',
                                Signature: 'wrong',
                            })
                        ).status,
                        401,
                        `${path} wrong signature`
                    );
                    eq(
                        (await h.call('GET', `${INTERNAL}${path}`, { token })).status,
                        401,
                        `${path} with a user token`
                    );
                }
                const headers = h.internalHeaders();
                if (!headers) return;
                if (h.isMock) {
                    await h.pairedDevice();
                    await h.feature('usage', 'fleet');
                }
                if (h.has('usage') || h.has('fleet')) {
                    const list = good(await h.internal('/institutes', headers), 'institutes');
                    ok(Array.isArray(list.institutes) && 'has_more' in list, 'paged list');
                    ok(
                        typeof good(await h.internal(paths[1], headers)).has_panels === 'boolean',
                        'has-panels'
                    );
                }
                if (h.has('usage')) {
                    const summary = good(await h.internal(paths[2], headers), 'summary');
                    ok(summary.totals && summary.by_room.length <= 15, 'summary capped');
                }
                if (h.has('fleet')) {
                    const fleet = good(await h.internal(paths[3], headers), 'fleet');
                    ok(fleet.counts && Array.isArray(fleet.alerts), 'fleet body');
                }
            },
        ],
    ];
}
