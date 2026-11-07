#!/usr/bin/env node
/**
 * In-memory stand-in for the Vacademy Classroom backend, for local panel, phone
 * page and console work. node:http only, no dependencies, nothing on disk.
 *
 *   node scripts/classroom/mock-backend.mjs [--port 8761] [--host 0.0.0.0]
 *        [--approve-base http://localhost:5199]
 *
 * Implements the auth_service panel API and its state machines, the admin_core
 * today endpoint and join APIs, the community presenter-key API, and just enough
 * of login, lessons and Volt for a panel to run with no real service behind it.
 * scripts/classroom/scenarios/run.mjs runs the same assertions against this and
 * against a local auth_service, so the two cannot drift.
 *
 * Test controls live under /__mock (see the end of the routes table):
 *   POST /__mock/reset                 fresh state
 *   POST /__mock/clock {advance_ms}    move the mock's clock forward
 *   POST /__mock/config {...}          flags, limits, kill switches
 *   POST /__mock/force-next {...}      answer the next matching call with a fixed reply
 *   POST /__mock/roles {...}           change a user's roles
 *   POST /__mock/today {classes}       replace the today list (null restores it)
 *   GET  /__mock/state                 internal rows, secrets excluded
 *   GET  /__mock/scenario-config       institutes and users with tokens
 *
 * Seeded accounts all use the password `mock-password`, and OTP `123456`.
 * Every value here is fake and only valid against this process.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MIN = 60 * 1000;
const PAIR_TTL_S = 900;
const CHALLENGE_TTL_S = 300;
const ACCESS_TTL_S = 900;
const SCANNED_MIN_MS = 2 * MIN;
const SCANNED_MAX_MS = 10 * MIN;
const REDEEM_WINDOW_MS = 2 * MIN;
const REPEAT_WINDOW_MS = 60 * 1000;
const DEAD_MAN_MS = 60 * MIN;
const PANEL_ONLINE_MS = 90 * 1000;
const PHONE_CONNECTED_MS = 30 * 1000;
const DEVICE_ONLINE_MS = 7 * MIN;
const LAST_SEEN_WRITE_MS = 5 * MIN;
const PANEL_SEEN_WRITE_MS = 30 * 1000;
const REMOTE_SEEN_WRITE_MS = 10 * 1000;
const BULK_ROOM_CAP = 200;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LOGIN_TTL_S = 30 * 24 * 60 * 60;
const MOCK_PASSWORD = 'mock-password';
const MOCK_OTP = '123456';
const SESSION_ZONE = 'Asia/Kolkata';

const DEFAULT_CONFIG = {
    panel_enabled: true,
    remote_enabled: true,
    poll_multiplier: 1,
    public_busy: false,
    volt_live: false,
    bbb_in_app_min_webview: 9999,
    idle_minutes: 30,
    session_hours: 4,
    min_app_version_code: 1,
    pending_cap: 10000,
    rate_limits: true,
    directory_available: true,
};

const RATE_LIMITS = {
    pair_start: 30,
    challenge_info: 60,
    pair_preview: 10,
    claim: 10,
    describe: 10,
    approve_code: 10,
    login_password: 5,
};

/**
 * What the shared security chain answers when a Bearer does not get through: JSON with
 * `error` and no `code`, from JsonAuthEntryPoint. An expired JWT throws inside the filter,
 * so its refusal comes from the error dispatch and names /error instead of the real path.
 */
class SecurityRefusal extends Error {
    constructor(error, message, path) {
        super(message);
        this.body = { error, message, path };
    }
}

class ApiError extends Error {
    constructor(status, code, message, extra) {
        super(message || code);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

const token = (bytes) => crypto.randomBytes(bytes).toString('base64url');
const uuid = () => crypto.randomUUID();
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function randomCode() {
    let code = '';
    for (const byte of crypto.randomBytes(8)) code += CROCKFORD[byte % 32];
    return code;
}

/** Accepts K7QF-2M9X, lower case, and the usual Crockford look-alikes. */
function normaliseCode(value) {
    return String(value ?? '')
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '')
        .replace(/O/g, '0')
        .replace(/[IL]/g, '1');
}

function matchNumbers() {
    const set = new Set();
    while (set.size < 3) set.add(10 + crypto.randomInt(90));
    const options = [...set];
    return {
        match_code: options[0],
        match_options: options.slice().sort(() => Math.random() - 0.5),
    };
}

/** Approve host rule: public hosts of the institute only, otherwise the default. */
function normaliseApproveBase(raw, fallback) {
    let value = (raw ?? '').trim();
    if (!value) return fallback;
    if (!/^[a-z]+:\/\//i.test(value)) value = `https://${value}`;
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return fallback;
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:') return fallback;
    if (host === 'localhost' || /^[0-9.]+$/.test(host) || host.includes(':')) return fallback;
    if (host === 'vacademy.io' || host.endsWith('.vacademy.io')) return fallback;
    return `${parsed.protocol}//${parsed.host}`;
}

function buildPdf(pageCount, title, paddingBytes = 0) {
    const objects = [];
    const pageRefs = [];
    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    for (let i = 0; i < pageCount; i += 1) {
        const pageId = 4 + i * 2;
        const text = `${title.replace(/[()\\]/g, '')} - page ${i + 1} of ${pageCount}`;
        const stream = `BT /F1 36 Tf 60 460 Td (${text}) Tj ET`;
        pageRefs.push(`${pageId} 0 R`);
        objects[pageId - 1] =
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Contents ${pageId + 1} 0 R ` +
            '/Resources << /Font << /F1 3 0 R >> >> >>';
        objects[pageId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageCount} >>`;
    let out = '%PDF-1.4\n';
    // Comment lines: lets a test ask for a file of a given size.
    if (paddingBytes > 0) {
        out += `%${'x'.repeat(1022)}\n`.repeat(Math.ceil(paddingBytes / 1024));
    }
    const offsets = [];
    objects.forEach((body, index) => {
        offsets[index] = out.length;
        out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((offset) => {
        out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

function buildScene(label) {
    const base = {
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
    };
    return {
        type: 'excalidraw',
        version: 2,
        elements: [
            { ...base, id: 'frame', type: 'rectangle', x: 0, y: 0, width: 960, height: 540 },
            {
                ...base,
                id: 'label',
                type: 'text',
                x: 80,
                y: 220,
                width: 800,
                height: 60,
                text: label,
                originalText: label,
                fontSize: 48,
                fontFamily: 2,
                textAlign: 'left',
                verticalAlign: 'top',
                containerId: null,
                lineHeight: 1.25,
                baseline: 48,
            },
        ],
        appState: { viewBackgroundColor: '#ffffff' },
        files: {},
    };
}

function seedUsers() {
    const row = (id, name, institutes, extra = {}) => ({
        id,
        username: id,
        name,
        email: `${id}@mock.test`,
        is_root_user: false,
        roles: institutes,
        ...extra,
    });
    const a = 'inst-a';
    const b = 'inst-b';
    const limited = 'inst-limited';
    return [
        row('admin_a', 'Asha Admin', { [a]: [['ADMIN', 'ACTIVE']] }),
        row('admin_b', 'Bela Admin', { [b]: [['ADMIN', 'ACTIVE']] }),
        row('teacher_a', 'Tara Teacher', { [a]: [['TEACHER', 'ACTIVE']] }),
        row('teacher_a2', 'Tej Teacher', { [a]: [['TEACHER', 'ACTIVE']] }),
        row('invited_teacher', 'Ira Invited', { [a]: [['TEACHER', 'INVITED']] }),
        row('custom_role', 'Faiz Faculty', { [a]: [['Faculty', 'ACTIVE']] }),
        row('admin_student', 'Anu Both', {
            [a]: [
                ['ADMIN', 'ACTIVE'],
                ['STUDENT', 'ACTIVE'],
            ],
        }),
        row('counsellor_student', 'Chetan Both', {
            [a]: [
                ['COUNSELLOR', 'ACTIVE'],
                ['STUDENT', 'ACTIVE'],
            ],
        }),
        row('student_a', 'Sam Student', { [a]: [['STUDENT', 'ACTIVE']] }),
        row('student_teacher', 'Sid Signup', {
            [a]: [
                ['STUDENT', 'ACTIVE'],
                ['TEACHER', 'ACTIVE'],
            ],
        }),
        row('removed_teacher', 'Rina Removed', { [a]: [['TEACHER', 'DISABLED']] }),
        row('root_no_role', 'Ravi Root', { [b]: [['STUDENT', 'ACTIVE']] }, { is_root_user: true }),
        row('rate_user', 'Rate Limited', { [a]: [['TEACHER', 'ACTIVE']] }),
        row('limited_teacher', 'Lata Limited', { [limited]: [['TEACHER', 'ACTIVE']] }),
        row('admin_limited', 'Lal Limited', { [limited]: [['ADMIN', 'ACTIVE']] }),
        row(
            'limit_login',
            'Limit Login',
            { [a]: [['TEACHER', 'ACTIVE']] },
            { session_limited: true }
        ),
    ];
}

function seedInstitutes() {
    return [
        { id: 'inst-a', name: 'Alpha School', theme_code: '#4f46e5', admin_portal_url: null },
        {
            id: 'inst-b',
            name: 'Beta Academy',
            theme_code: 'blue',
            admin_portal_url: 'portal.beta-academy.example',
        },
        {
            id: 'inst-limited',
            name: 'Limited Institute',
            theme_code: 'blue',
            admin_portal_url: null,
            max_active_sessions: 1,
        },
    ];
}

function lessonFixtures() {
    const doc = (id, type, data, title) => ({
        id,
        title,
        status: 'PUBLISHED',
        source_type: 'DOCUMENT',
        slide_order: 0,
        document_slide: { type, data, published_data: data },
    });
    const video = (id, sourceType, url, title) => ({
        id,
        title,
        status: 'PUBLISHED',
        source_type: 'VIDEO',
        slide_order: 0,
        video_slide: { source_type: sourceType, url, published_url: url },
    });
    const slides = [
        doc('slide-scene-1', 'PRESENTATION', 'file-scene-1', 'Scene one'),
        doc('slide-pdf', 'PDF', 'file-pdf-12', 'PDF lesson'),
        doc('slide-scene-2', 'PRESENTATION', 'file-scene-2', 'Scene two'),
        doc('slide-deck', 'PPT_ANIM', 'mock-deck-base', 'Animated deck'),
        video('slide-youtube', 'YOUTUBE', 'https://youtu.be/dQw4w9WgXcQ', 'YouTube video'),
        doc('slide-doc', 'DOC', '<p>Open on a computer</p>', 'Document'),
    ].map((slide, index) => ({ ...slide, slide_order: index }));
    return {
        library: [
            {
                course: {
                    id: 'course-1',
                    package_name: 'Mock Science',
                    status: 'ACTIVE',
                    course_depth: 5,
                },
                sessions: [
                    {
                        session_dto: { id: 'session-1', session_name: '2026-27', status: 'ACTIVE' },
                        level_with_details: [
                            {
                                id: 'level-1',
                                name: 'Class 8',
                                subjects: [
                                    {
                                        id: 'subject-1',
                                        subject_name: 'Physics',
                                        subject_order: 1,
                                    },
                                ],
                            },
                        ],
                    },
                ],
                package_sessions: [
                    {
                        id: 'ps-1',
                        status: 'ACTIVE',
                        name: 'Class 8 2026-27',
                        level: { id: 'level-1', level_name: 'Class 8' },
                        session: { id: 'session-1', session_name: '2026-27' },
                    },
                ],
            },
        ],
        modules: [
            {
                module: { id: 'module-1', module_name: 'Forces', status: 'ACTIVE' },
                chapters: [
                    {
                        chapter: {
                            id: 'chapter-1',
                            chapter_name: 'Motion',
                            status: 'ACTIVE',
                            chapter_order: 1,
                        },
                    },
                ],
            },
        ],
        slides,
        decks: [
            {
                id: 'deck-1',
                title: 'Mock deck',
                status: 'PUBLISHED',
                added_slides_count: 4,
                updated_at: '2026-11-01T10:00:00Z',
                added_slides: [1, 2, 3, 4].map((n) => ({
                    id: `deck-slide-${n}`,
                    slide_order: n - 1,
                    title: `Deck slide ${n}`,
                    source: 'excalidraw',
                    content: `file-scene-deck-${n}`,
                })),
            },
        ],
    };
}

export function createMockBackend(options = {}) {
    const defaultBaseUrl = (options.approveBase ?? 'http://localhost:5199').replace(/\/+$/, '');
    const signingKey = crypto.randomBytes(32);
    const fixtures = lessonFixtures();

    let db;
    let config;
    let clockOffset = 0;
    const now = () => Date.now() + clockOffset;
    const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

    function reset() {
        clockOffset = 0;
        config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
        db = {
            institutes: new Map(seedInstitutes().map((row) => [row.id, row])),
            users: new Map(seedUsers().map((row) => [row.id, row])),
            rooms: new Map(),
            pairings: new Map(),
            devices: new Map(),
            sessions: new Map(),
            challenges: new Map(),
            rate: new Map(),
            forced: [],
            todayOverride: null,
            meetAttempts: new Map(),
            zoomSignatures: new Set(),
            voltSessions: new Map(),
            refreshTokens: new Map(),
        };
    }
    reset();

    // ------------------------------------------------------------ tokens ---

    function signJwt(claims, ttlSeconds) {
        const iat = Math.floor(now() / 1000);
        const body = b64url({ ...claims, iat, exp: iat + ttlSeconds });
        const head = b64url({ alg: 'HS256' });
        const sig = crypto
            .createHmac('sha256', signingKey)
            .update(`${head}.${body}`)
            .digest('base64url');
        return `${head}.${body}.${sig}`;
    }

    function verifyJwt(jwt) {
        const parts = String(jwt).split('.');
        if (parts.length !== 3) return null;
        const expected = crypto
            .createHmac('sha256', signingKey)
            .update(`${parts[0]}.${parts[1]}`)
            .digest();
        const actual = Buffer.from(parts[2], 'base64url');
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
            return null;
        }
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    }

    function authoritiesFor(user, instituteId) {
        const map = {};
        for (const [institute, roles] of Object.entries(user.roles)) {
            if (instituteId && institute !== instituteId) continue;
            const names = roles.filter(([, status]) => status === 'ACTIVE' || status === 'INVITED');
            map[institute] = { roles: names.map(([name]) => name), permissions: [] };
        }
        return map;
    }

    function userClaims(user, instituteId) {
        return {
            sub: user.username,
            user: user.id,
            fullname: user.name,
            username: user.username,
            email: user.email,
            is_root_user: user.is_root_user,
            authorities: authoritiesFor(user, instituteId),
            permissions: [],
        };
    }

    const mintPanelJwt = (user, session) =>
        signJwt({ ...userClaims(user, session.institute_id), pnl: session.id }, ACCESS_TTL_S);

    const mintLoginJwt = (user) => signJwt(userClaims(user, null), LOGIN_TTL_S);

    // ------------------------------------------------------------ guards ---

    function rateLimit(kind, key) {
        if (!config.rate_limits) return;
        const limit = RATE_LIMITS[kind];
        const id = `${kind}:${key}`;
        const t = now();
        let window = db.rate.get(id);
        if (!window || window.reset_at <= t) {
            window = { count: 0, reset_at: t + MIN };
            db.rate.set(id, window);
        }
        window.count += 1;
        if (window.count > limit) {
            throw new ApiError(429, 'RATE_LIMITED', 'Too many requests', {
                retry_after_ms: window.reset_at - t,
            });
        }
    }

    function requireUser(ctx) {
        const header = ctx.headers.authorization ?? '';
        const jwt = header.startsWith('Bearer ') ? header.slice(7) : null;
        const claims = jwt ? verifyJwt(jwt) : null;
        const path = ctx.path;
        if (!jwt) {
            throw new SecurityRefusal(
                'UNAUTHENTICATED',
                'No credentials were presented for a protected endpoint.',
                path
            );
        }
        const denied = 'The presented token does not grant access to this endpoint.';
        if (!claims) throw new SecurityRefusal('ACCESS_DENIED', denied, path);
        if (claims.exp * 1000 <= now())
            throw new SecurityRefusal('ACCESS_DENIED', denied, '/error');
        const user = db.users.get(claims.user);
        if (!user) {
            throw new SecurityRefusal(
                'USER_NOT_RESOLVED',
                'Token subject could not be matched to a user in this institute. Please log in again.',
                path
            );
        }
        const clientId = ctx.headers.clientid;
        if (clientId && db.institutes.get(clientId)?.max_active_sessions) {
            throw new ApiError(460, 'ERROR', 'Session limit reached');
        }
        return user;
    }

    function rolesAt(user, instituteId) {
        return (user.roles[instituteId] ?? [])
            .filter(([, status]) => status === 'ACTIVE' || status === 'INVITED')
            .map(([name]) => String(name).toUpperCase());
    }

    function isActiveAdmin(user, instituteId) {
        return (user.roles[instituteId] ?? []).some(
            ([name, status]) => String(name).toUpperCase() === 'ADMIN' && status === 'ACTIVE'
        );
    }

    function requireInstituteAdmin(user, instituteId) {
        if (!instituteId || !isActiveAdmin(user, instituteId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Institute admin required');
        }
    }

    /** Staff rule: learner roles without ADMIN or COUNSELLOR are refused. Root flag never counts. */
    function policyAllows(user, instituteId) {
        const names = rolesAt(user, instituteId);
        const learner = names.some((n) => n === 'STUDENT' || n === 'PARENT' || n === 'GUARDIAN');
        const elevated = names.includes('ADMIN') || names.includes('COUNSELLOR');
        if (learner && !elevated) return false;
        return names.length > 0;
    }

    function activateInvitedRoles(user, instituteId) {
        for (const role of user.roles[instituteId] ?? []) {
            if (role[1] === 'INVITED') role[1] = 'ACTIVE';
        }
    }

    function requireDevice(body) {
        const device = db.devices.get(body.device_id);
        if (!device || device.secret !== body.device_secret || device.status === 'REVOKED') {
            throw new ApiError(401, 'DEVICE_REVOKED', 'This panel is not registered');
        }
        return device;
    }

    function requireActiveDevice(body) {
        const device = requireDevice(body);
        if (device.status !== 'ACTIVE') {
            throw new ApiError(409, 'DEVICE_NOT_ACTIVE', 'Confirm pairing on the panel first');
        }
        return device;
    }

    function requirePanelEnabled() {
        if (!config.panel_enabled) {
            throw new ApiError(503, 'PANEL_DISABLED', 'Classroom panels are not available');
        }
    }

    // ---------------------------------------------------------- sessions ---

    function endSession(session, reason, endedBy) {
        if (session.status !== 'ACTIVE') return;
        session.status = 'ENDED';
        session.end_reason = reason;
        session.ended_at = now();
        session.ended_by = endedBy ?? null;
    }

    /** ACTIVE only if still inside the cap; a session past the cap reads as ended. */
    function isLive(session) {
        if (session.status !== 'ACTIVE') return false;
        if (session.expires_at <= now()) {
            endSession(session, 'EXPIRED');
            return false;
        }
        return true;
    }

    function sessionByRemoteToken(remoteToken) {
        if (!remoteToken) return null;
        for (const session of db.sessions.values()) {
            if (session.remote_token === remoteToken) return session;
        }
        return null;
    }

    function sessionBySessionToken(device, sessionToken) {
        if (!sessionToken) return null;
        for (const session of db.sessions.values()) {
            if (session.device_id === device.id && session.session_token === sessionToken) {
                return session;
            }
        }
        return null;
    }

    const activeSessionForDevice = (deviceId) =>
        [...db.sessions.values()].find((s) => s.device_id === deviceId && s.status === 'ACTIVE');
    const activeSessionForUser = (userId) =>
        [...db.sessions.values()].find((s) => s.user_id === userId && s.status === 'ACTIVE');

    const secondsLeft = (session) => Math.max(0, Math.floor((session.expires_at - now()) / 1000));

    function startSession(device, user, via) {
        const onDevice = activeSessionForDevice(device.id);
        if (onDevice) endSession(onDevice, 'REPLACED');
        const elsewhere = activeSessionForUser(user.id);
        if (elsewhere) endSession(elsewhere, 'SUPERSEDED');
        const t = now();
        const session = {
            id: uuid(),
            device_id: device.id,
            institute_id: device.institute_id,
            room_id: device.room_id,
            user_id: user.id,
            started_via: via,
            session_token: null,
            status: 'ACTIVE',
            expires_at: t + config.session_hours * 60 * MIN,
            created_at: t,
            last_refreshed_at: t,
            ended_at: null,
            end_reason: null,
            ended_by: null,
            remote_token: null,
            remote_nav_counter: 0,
            remote_client_seq: 0,
            remote_nav_at: null,
            remote_seen_at: null,
            panel_seen_at: null,
            state_index: null,
            state_total: null,
            state_title: null,
            state_updated_at: null,
            approved_ip: null,
        };
        db.sessions.set(session.id, session);
        return session;
    }

    function redeemedBody(session, user) {
        return {
            access_token: mintPanelJwt(user, session),
            session_token: session.session_token,
            session_id: session.id,
            expires_in_s: ACCESS_TTL_S,
            session_expires_in_s: secondsLeft(session),
            user: { id: user.id, name: user.name },
            institute_id: session.institute_id,
            server_time_ms: now(),
        };
    }

    // -------------------------------------------------------- challenges ---

    const roomName = (device) => db.rooms.get(device.room_id)?.name ?? null;
    const poll = (ms) => Math.round(ms * config.poll_multiplier);

    /** What a challenge reads as now. Expiry is computed, and written only when touched. */
    function challengeState(challenge) {
        const t = now();
        if (challenge.state === 'PENDING' || challenge.state === 'SCANNED') {
            return challenge.expires_at <= t ? 'EXPIRED' : challenge.state;
        }
        if (challenge.state === 'APPROVED') {
            return t - challenge.approved_at > REDEEM_WINDOW_MS ? 'EXPIRED' : 'APPROVED';
        }
        return challenge.state;
    }

    function findChallenge(body) {
        if (typeof body.t === 'string' && body.t) {
            for (const c of db.challenges.values()) if (c.token === body.t) return c;
            return null;
        }
        const code = normaliseCode(body.user_code);
        if (!code) return null;
        for (const c of db.challenges.values()) if (c.user_code === code) return c;
        return null;
    }

    function killOpenChallenges(deviceId) {
        for (const c of db.challenges.values()) {
            if (c.device_id !== deviceId) continue;
            if (c.state === 'PENDING' || c.state === 'SCANNED' || c.state === 'APPROVED') {
                c.state = 'DEAD';
            }
        }
    }

    function revokeDevice(device, by) {
        device.status = 'REVOKED';
        device.revoked_at = now();
        device.revoked_by = by ?? null;
        const session = activeSessionForDevice(device.id);
        if (session) endSession(session, 'UNBOUND', by);
        killOpenChallenges(device.id);
    }

    function approvedBody(challenge, session, remoteToken) {
        const device = db.devices.get(challenge.device_id);
        return {
            session_id: session.id,
            remote_token: remoteToken,
            room_name: roomName(device),
            session_expires_in_s: secondsLeft(session),
        };
    }

    // ------------------------------------------------------------- rooms ---

    const liveDeviceInRoom = (roomId) =>
        [...db.devices.values()].find(
            (d) => d.room_id === roomId && (d.status === 'CLAIMED' || d.status === 'ACTIVE')
        );

    function roomRow(room) {
        const device = liveDeviceInRoom(room.id);
        return { id: room.id, name: room.name, status: room.status, device_id: device?.id ?? null };
    }

    const activeRooms = (instituteId) =>
        [...db.rooms.values()].filter(
            (r) => r.institute_id === instituteId && r.status === 'ACTIVE'
        );

    function createRoom(instituteId, name, createdBy) {
        const clean = String(name ?? '').trim();
        if (!clean || clean.length > 120) {
            throw new ApiError(400, 'BAD_REQUEST', 'Room name must be 1 to 120 characters');
        }
        const lower = clean.toLowerCase();
        if (activeRooms(instituteId).some((r) => r.name.toLowerCase() === lower)) {
            throw new ApiError(409, 'ROOM_NAME_TAKEN', 'A room with this name exists');
        }
        const room = {
            id: uuid(),
            institute_id: instituteId,
            name: clean,
            status: 'ACTIVE',
            created_by: createdBy,
        };
        db.rooms.set(room.id, room);
        return room;
    }

    function roomIn(instituteId, roomId) {
        const room = db.rooms.get(roomId);
        if (!room || room.institute_id !== instituteId) {
            throw new ApiError(403, 'ROOM_OTHER_INSTITUTE', 'This room is not in this institute');
        }
        return room;
    }

    function deviceRow(device) {
        const session = activeSessionForDevice(device.id);
        const live = session && isLive(session) ? session : null;
        const user = live ? db.users.get(live.user_id) : null;
        const room = db.rooms.get(device.room_id);
        return {
            id: device.id,
            room: { id: room.id, name: room.name },
            status: device.status,
            online: device.last_seen_at !== null && now() - device.last_seen_at < DEVICE_ONLINE_MS,
            last_seen_at: iso(device.last_seen_at),
            last_ip: device.last_ip,
            model: device.model,
            manufacturer: device.manufacturer,
            sdk_int: device.sdk_int,
            webview_major: device.webview_major,
            app_version_code: device.app_version_code,
            password_login_allowed: device.password_login_allowed,
            claimed_by_name: device.claimed_by_name,
            claimed_at: iso(device.claimed_at),
            current_session: live
                ? {
                      id: live.id,
                      user_id: live.user_id,
                      user_name: user?.name ?? null,
                      started_via: live.started_via,
                      created_at: iso(live.created_at),
                      expires_in_s: secondsLeft(live),
                      approved_ip: live.approved_ip,
                  }
                : null,
        };
    }

    // ------------------------------------------------------ route handlers ---

    function pairStart(ctx) {
        rateLimit('pair_start', ctx.ip);
        const body = ctx.body;
        const device = body.device && typeof body.device === 'object' ? body.device : {};
        const installId = typeof body.install_id === 'string' ? body.install_id : '';
        if (
            !installId ||
            installId.length > 64 ||
            String(device.manufacturer ?? '').length > 120 ||
            String(device.model ?? '').length > 120 ||
            JSON.stringify(device).length > 600
        ) {
            throw new ApiError(400, 'BAD_REQUEST', 'Invalid device details');
        }
        requirePanelEnabled();
        const t = now();
        let live = 0;
        for (const p of db.pairings.values()) {
            if (p.state === 'PENDING' && p.expires_at > t) live += 1;
            else if (p.expires_at + 60 * MIN < t) db.pairings.delete(p.id);
        }
        if (live >= config.pending_cap) {
            throw new ApiError(503, 'BUSY', 'Try again shortly', { retry_after_ms: 2000 });
        }
        const pairing = {
            id: uuid(),
            code: randomCode(),
            pair_secret: token(32),
            ...matchNumbers(),
            install_id: installId,
            device,
            state: 'PENDING',
            device_id: null,
            picked_up_at: null,
            created_ip: ctx.ip,
            expires_at: t + PAIR_TTL_S * 1000,
            created_at: t,
        };
        db.pairings.set(pairing.id, pairing);
        return {
            pair_secret: pairing.pair_secret,
            code: pairing.code,
            match_code: pairing.match_code,
            qr_url: `${defaultBaseUrl}/classroom#pair=${pairing.code}`,
            expires_in_s: PAIR_TTL_S,
            poll_after_ms: poll(3000),
        };
    }

    function pairPoll(ctx) {
        const pollAfter = poll(3000);
        const pairing = [...db.pairings.values()].find(
            (p) => p.pair_secret === ctx.body.pair_secret
        );
        if (!pairing) return { state: 'EXPIRED', poll_after_ms: pollAfter };
        const t = now();
        if (pairing.state === 'CANCELLED') return { state: 'CANCELLED', poll_after_ms: pollAfter };
        if (pairing.state === 'PENDING') {
            const state = pairing.expires_at <= t ? 'EXPIRED' : 'PENDING';
            return { state, poll_after_ms: pollAfter };
        }
        if (pairing.state !== 'CLAIMED') return { state: 'EXPIRED', poll_after_ms: pollAfter };
        if (pairing.picked_up_at !== null && t - pairing.picked_up_at > REPEAT_WINDOW_MS) {
            return { state: 'EXPIRED', poll_after_ms: pollAfter };
        }
        const device = db.devices.get(pairing.device_id);
        // Same as the service: a late poll cannot replace a confirmed panel's secret.
        if (!device || device.status !== 'CLAIMED') {
            return { state: 'EXPIRED', poll_after_ms: pollAfter };
        }
        if (pairing.picked_up_at === null) pairing.picked_up_at = t;
        device.secret = token(32); // A retry overwrites it: only the newest response works.
        const institute = db.institutes.get(device.institute_id);
        const room = db.rooms.get(device.room_id);
        return {
            state: 'CLAIMED',
            device_id: device.id,
            device_secret: device.secret,
            institute_id: device.institute_id,
            institute_name: institute?.name ?? null,
            theme_code: institute?.theme_code ?? null,
            room: { id: room.id, name: room.name },
            claimed_by_name: device.claimed_by_name,
            poll_after_ms: pollAfter,
        };
    }

    function pairConfirm(ctx) {
        const device = requireDevice(ctx.body);
        if (device.status === 'ACTIVE') {
            if (ctx.body.accept === true) return { status: 'ACTIVE' };
            throw new ApiError(409, 'DEVICE_NOT_ACTIVE', 'This panel is already confirmed');
        }
        if (ctx.body.accept === true) {
            device.status = 'ACTIVE';
            device.confirmed_at = now();
            return { status: 'ACTIVE' };
        }
        revokeDevice(device, null);
        for (const p of db.pairings.values()) {
            if (p.device_id === device.id) p.state = 'CANCELLED';
        }
        return { status: 'CANCELLED' };
    }

    function panelSync(ctx) {
        const body = ctx.body;
        const device = requireDevice(body);
        const t = now();
        device.last_ip = ctx.ip;
        if (device.last_seen_at === null || t - device.last_seen_at >= LAST_SEEN_WRITE_MS) {
            device.last_seen_at = t;
        }
        if (typeof body.app_version_code === 'number') {
            device.app_version_code = body.app_version_code;
        }
        if (typeof body.webview_major === 'number') device.webview_major = body.webview_major;

        let sessionBody;
        let phoneSeen = false;
        if (body.session_id || body.session_token) {
            const session = sessionBySessionToken(device, body.session_token);
            const matches = session && session.id === body.session_id;
            if (!matches) {
                sessionBody = {
                    status: 'ENDED',
                    end_reason: null,
                    expires_in_s: 0,
                    nav_counter: 0,
                    nav_age_ms: null,
                    phone_connected: false,
                };
            } else if (!isLive(session)) {
                sessionBody = {
                    status: 'ENDED',
                    end_reason: session.end_reason,
                    expires_in_s: 0,
                    nav_counter: session.remote_nav_counter,
                    nav_age_ms: null,
                    phone_connected: false,
                };
            } else {
                if (
                    session.panel_seen_at === null ||
                    t - session.panel_seen_at >= PANEL_SEEN_WRITE_MS
                ) {
                    session.panel_seen_at = t;
                }
                if (body.presenting === true && body.state) {
                    const title = String(body.state.title ?? '').slice(0, 200);
                    if (
                        session.state_index !== body.state.index ||
                        session.state_total !== body.state.total ||
                        session.state_title !== title
                    ) {
                        session.state_index = body.state.index;
                        session.state_total = body.state.total;
                        session.state_title = title;
                        session.state_updated_at = t;
                    }
                } else if (body.presenting === false && session.state_index !== null) {
                    session.state_index = null;
                    session.state_total = null;
                    session.state_title = null;
                    session.state_updated_at = t;
                }
                phoneSeen =
                    session.remote_seen_at !== null &&
                    t - session.remote_seen_at < PHONE_CONNECTED_MS;
                sessionBody = {
                    status: 'ACTIVE',
                    end_reason: null,
                    expires_in_s: secondsLeft(session),
                    nav_counter: session.remote_nav_counter,
                    nav_age_ms: session.remote_nav_at === null ? null : t - session.remote_nav_at,
                    phone_connected: phoneSeen,
                };
            }
        }

        let nextPoll = 5 * MIN;
        if (sessionBody && sessionBody.status === 'ACTIVE') {
            if (body.presenting === true) nextPoll = phoneSeen ? 1000 : 5000;
            else nextPoll = MIN;
        }
        if (!config.remote_enabled) nextPoll = Math.max(nextPoll, MIN);
        if (sessionBody && sessionBody.status === 'ACTIVE' && body.in_meeting === true) {
            nextPoll = Math.min(nextPoll, 10 * 1000);
        }

        const institute = db.institutes.get(device.institute_id);
        return {
            server_time_ms: t,
            device: {
                status: device.status,
                room_name: roomName(device),
                institute_id: device.institute_id,
                institute_name: institute?.name ?? null,
                theme_code: institute?.theme_code ?? null,
                approve_base_url: device.approve_base_url,
                password_login_allowed: device.password_login_allowed,
            },
            ...(sessionBody ? { session: sessionBody } : {}),
            flags: {
                volt_live_enabled: config.volt_live,
                bbb_in_app_min_webview: config.bbb_in_app_min_webview,
            },
            policy: { idle_minutes: config.idle_minutes, session_hours: config.session_hours },
            next_poll_ms: poll(nextPoll),
            min_app_version_code: config.min_app_version_code,
        };
    }

    function createChallenge(ctx) {
        const body = ctx.body;
        requirePanelEnabled();
        const device = requireActiveDevice(body);
        const purpose = body.purpose === 'ATTACH_REMOTE' ? 'ATTACH_REMOTE' : 'SIGN_IN';
        if (body.purpose !== 'ATTACH_REMOTE' && body.purpose !== 'SIGN_IN') {
            throw new ApiError(400, 'BAD_REQUEST', 'Unknown purpose');
        }
        let attachSession = null;
        if (purpose === 'ATTACH_REMOTE') {
            attachSession = sessionBySessionToken(device, body.session_token);
            if (!attachSession || !isLive(attachSession)) {
                throw new ApiError(401, 'SESSION_ENDED', 'Session has ended', {
                    reason: attachSession?.end_reason ?? null,
                });
            }
        }
        for (const c of db.challenges.values()) {
            if (c.device_id !== device.id) continue;
            if (c.state === 'APPROVED') {
                if (now() - c.approved_at <= REDEEM_WINDOW_MS) {
                    throw new ApiError(409, 'APPROVED_PENDING', 'Waiting to redeem', {
                        challenge_id: c.id,
                    });
                }
                c.state = 'EXPIRED';
                const orphan = db.sessions.get(c.session_id);
                if (orphan && orphan.session_token === null) endSession(orphan, 'EXPIRED');
            } else if (c.state === 'PENDING' || c.state === 'SCANNED') {
                c.state = 'DEAD';
            }
        }
        const t = now();
        const challenge = {
            id: uuid(),
            device_id: device.id,
            institute_id: device.institute_id,
            purpose,
            session_id: attachSession?.id ?? null,
            token: token(16),
            user_code: randomCode(),
            ...matchNumbers(),
            state: 'PENDING',
            scanned_by_name: null,
            approved_user_id: null,
            approved_ip: null,
            approved_at: null,
            redeemed_at: null,
            expires_at: t + CHALLENGE_TTL_S * 1000,
            created_at: t,
        };
        db.challenges.set(challenge.id, challenge);
        return {
            challenge_id: challenge.id,
            qr_url: `${device.approve_base_url}/classroom#c=${challenge.token}`,
            user_code: challenge.user_code,
            match_code: challenge.match_code,
            expires_in_s: CHALLENGE_TTL_S,
            poll_after_ms: poll(2500),
        };
    }

    function challengePoll(ctx) {
        const device = requireDevice(ctx.body);
        const challenge = db.challenges.get(ctx.body.challenge_id);
        if (!challenge || challenge.device_id !== device.id) {
            throw new ApiError(404, 'NOT_FOUND', 'No such challenge');
        }
        const pollAfter = poll(2500);
        const state = challengeState(challenge);
        const t = now();
        if (state === 'EXPIRED') return { state: 'EXPIRED', poll_after_ms: pollAfter };
        if (state === 'DEAD') return { state: 'DEAD', poll_after_ms: pollAfter };
        if (state === 'PENDING') return { state: 'PENDING', poll_after_ms: pollAfter };
        if (state === 'SCANNED') {
            return {
                state: 'SCANNED',
                scanned_by_name: challenge.scanned_by_name,
                poll_after_ms: pollAfter,
            };
        }
        if (challenge.purpose === 'ATTACH_REMOTE') return { state: 'ATTACHED' };

        const session = db.sessions.get(challenge.session_id);
        const user = session ? db.users.get(session.user_id) : null;
        if (!session || !user || !isLive(session)) {
            return { state: 'DEAD', poll_after_ms: pollAfter };
        }
        if (state === 'APPROVED') {
            challenge.state = 'REDEEMED';
            challenge.redeemed_at = t;
        } else if (t - challenge.redeemed_at > REPEAT_WINDOW_MS) {
            return { state: 'EXPIRED', poll_after_ms: pollAfter };
        }
        // First redeem, or a retry inside the window: only the newest token works.
        session.session_token = token(32);
        session.last_refreshed_at = t;
        return { state: 'REDEEMED', ...redeemedBody(session, user) };
    }

    function challengeInfo(ctx) {
        rateLimit('challenge_info', ctx.ip);
        const challenge = typeof ctx.body.t === 'string' ? findChallenge({ t: ctx.body.t }) : null;
        if (!challenge) throw new ApiError(404, 'EXPIRED', 'This code has expired');
        const institute = db.institutes.get(challenge.institute_id);
        const state = challengeState(challenge);
        return {
            state,
            institute_id: challenge.institute_id,
            institute_name: institute?.name ?? null,
            theme_code: institute?.theme_code ?? null,
            expires_in_s: Math.max(0, Math.floor((challenge.expires_at - now()) / 1000)),
        };
    }

    function sessionRefresh(ctx) {
        const device = requireDevice(ctx.body);
        const session = sessionBySessionToken(device, ctx.body.session_token);
        const ended = (reason) =>
            new ApiError(401, 'SESSION_ENDED', 'This session has ended', { reason });
        if (!session) throw ended(null);
        if (!isLive(session)) throw ended(session.end_reason);
        const t = now();
        if (t - session.last_refreshed_at > DEAD_MAN_MS) {
            endSession(session, 'DEAD_MAN');
            throw ended('DEAD_MAN');
        }
        if (device.status !== 'ACTIVE') {
            endSession(session, 'UNBOUND');
            throw ended('UNBOUND');
        }
        const user = db.users.get(session.user_id);
        if (!user || !policyAllows(user, session.institute_id)) {
            endSession(session, 'ACCESS_REMOVED');
            throw ended('ACCESS_REMOVED');
        }
        session.last_refreshed_at = t;
        return {
            access_token: mintPanelJwt(user, session),
            expires_in_s: ACCESS_TTL_S,
            session_expires_in_s: secondsLeft(session),
            server_time_ms: t,
        };
    }

    function sessionEnd(ctx) {
        const device = requireDevice(ctx.body);
        const reason = ctx.body.reason;
        if (reason !== 'SIGN_OUT' && reason !== 'IDLE' && reason !== 'CLASS_END') {
            throw new ApiError(400, 'BAD_REQUEST', 'Unknown reason');
        }
        const session = ctx.body.session_token
            ? sessionBySessionToken(device, ctx.body.session_token)
            : activeSessionForDevice(device.id);
        if (session) endSession(session, reason);
        return { ended: true };
    }

    function loginPassword(ctx) {
        const body = ctx.body;
        requirePanelEnabled();
        const device = requireActiveDevice(body);
        rateLimit('login_password', `${device.id}:${body.username}`);
        if (!device.password_login_allowed) {
            throw new ApiError(403, 'PASSWORD_DISABLED', 'Password sign-in is off for this panel');
        }
        const user = [...db.users.values()].find((u) => u.username === body.username);
        if (!user || body.password !== MOCK_PASSWORD) {
            throw new ApiError(401, 'BAD_CREDENTIALS', 'Wrong username or password');
        }
        if (!policyAllows(user, device.institute_id)) {
            const institute = db.institutes.get(device.institute_id);
            throw new ApiError(403, 'NOT_STAFF', 'Not staff at this institute', {
                institute_name: institute?.name ?? null,
            });
        }
        const session = startSession(device, user, 'PASSWORD');
        session.session_token = token(32);
        return redeemedBody(session, user);
    }

    function remoteNav(ctx) {
        const { remote_token: remoteToken, delta, client_seq: seq } = ctx.body;
        if ((delta !== 1 && delta !== -1) || typeof seq !== 'number') {
            throw new ApiError(400, 'BAD_REQUEST', 'delta must be 1 or -1, with a client_seq');
        }
        const session = sessionByRemoteToken(remoteToken);
        if (!session || !isLive(session)) return { accepted: false, status: 'ENDED' };
        if (!config.remote_enabled) return { accepted: false, status: 'ACTIVE' };
        if (session.remote_client_seq < seq) {
            session.remote_nav_counter += delta;
            session.remote_client_seq = seq;
            session.remote_nav_at = now();
            return { accepted: true, status: 'ACTIVE' };
        }
        return { accepted: true, duplicate: true, status: 'ACTIVE' };
    }

    function remoteState(ctx) {
        const session = sessionByRemoteToken(ctx.body.remote_token);
        if (!session || !isLive(session)) {
            return {
                status: 'ENDED',
                institute_id: session?.institute_id ?? null,
                room_name: null,
                index: null,
                total: null,
                title: null,
                panel_online: false,
                session_expires_in_s: 0,
            };
        }
        const t = now();
        if (session.remote_seen_at === null || t - session.remote_seen_at >= REMOTE_SEEN_WRITE_MS) {
            session.remote_seen_at = t;
        }
        const device = db.devices.get(session.device_id);
        return {
            status: 'ACTIVE',
            institute_id: session.institute_id,
            room_name: roomName(device),
            index: session.state_index,
            total: session.state_total,
            title: session.state_title,
            panel_online:
                session.panel_seen_at !== null && t - session.panel_seen_at < PANEL_ONLINE_MS,
            session_expires_in_s: secondsLeft(session),
        };
    }

    function remoteEnd(ctx) {
        const session = sessionByRemoteToken(ctx.body.remote_token);
        if (session) endSession(session, 'PHONE');
        return { ended: true };
    }

    function pairPreview(ctx) {
        const user = requireUser(ctx);
        rateLimit('pair_preview', user.id);
        const code = normaliseCode(ctx.body.code);
        const t = now();
        const pairing = [...db.pairings.values()].find(
            (p) => p.code === code && p.state === 'PENDING' && p.expires_at > t
        );
        if (!pairing) throw new ApiError(404, 'NOT_FOUND', 'No panel is showing this code');
        return {
            model: pairing.device.model ?? null,
            manufacturer: pairing.device.manufacturer ?? null,
            webview_major: pairing.device.webview_major ?? null,
            match_options: pairing.match_options,
            expires_in_s: Math.floor((pairing.expires_at - t) / 1000),
        };
    }

    function adminInstitutes(ctx) {
        const user = requireUser(ctx);
        return Object.keys(user.roles)
            .filter((id) => isActiveAdmin(user, id))
            .map((id) => ({ institute_id: id }));
    }

    function deviceClaim(ctx) {
        const user = requireUser(ctx);
        rateLimit('claim', user.id);
        const body = ctx.body;
        // The snapshot is read before anything else, as the real service does.
        if (!config.directory_available) {
            throw new ApiError(503, 'TRY_AGAIN', 'Please try again in a moment');
        }
        requireInstituteAdmin(user, body.institute_id);
        const existingRoom = body.room_id ? roomIn(body.institute_id, body.room_id) : null;
        if (!existingRoom && !String(body.new_room_name ?? '').trim()) {
            throw new ApiError(400, 'BAD_REQUEST', 'Pick a room or name a new one');
        }
        const code = normaliseCode(body.code);
        const t = now();
        const pairing = [...db.pairings.values()].find(
            (p) => p.code === code && p.state === 'PENDING' && p.expires_at > t
        );
        if (!pairing) throw new ApiError(404, 'NOT_FOUND', 'No panel is showing this code');
        if (body.match_code !== pairing.match_code) {
            pairing.state = 'CANCELLED';
            throw new ApiError(409, 'WRONG_NUMBER', 'That number did not match');
        }
        if (existingRoom) {
            const occupant = liveDeviceInRoom(existingRoom.id);
            if (occupant && body.replace_existing !== true) {
                throw new ApiError(409, 'ROOM_OCCUPIED', 'This room already has a panel', {
                    current_device: {
                        id: occupant.id,
                        model: occupant.model,
                        last_seen_at: iso(occupant.last_seen_at),
                    },
                });
            }
            if (occupant) revokeDevice(occupant, user.id);
        }
        const room = existingRoom ?? createRoom(body.institute_id, body.new_room_name, user.id);
        const institute = db.institutes.get(body.institute_id);
        const device = {
            id: uuid(),
            institute_id: body.institute_id,
            room_id: room.id,
            secret: token(32),
            status: 'CLAIMED',
            install_id: pairing.install_id,
            approve_base_url: normaliseApproveBase(institute?.admin_portal_url, defaultBaseUrl),
            password_login_allowed: false,
            manufacturer: pairing.device.manufacturer ?? null,
            model: pairing.device.model ?? null,
            sdk_int: pairing.device.sdk_int ?? null,
            webview_major: pairing.device.webview_major ?? null,
            app_version_code: pairing.device.app_version_code ?? null,
            last_seen_at: null,
            last_ip: null,
            claimed_by: user.id,
            claimed_by_name: user.name,
            claimed_at: t,
            confirmed_at: null,
            revoked_by: null,
            revoked_at: null,
        };
        db.devices.set(device.id, device);
        pairing.state = 'CLAIMED';
        pairing.device_id = device.id;
        return {
            device_id: device.id,
            status: 'CLAIMED',
            room: { id: room.id, name: room.name },
        };
    }

    function roomsList(ctx) {
        const user = requireUser(ctx);
        const instituteId = ctx.query.get('institute_id');
        requireInstituteAdmin(user, instituteId);
        const rooms = [...db.rooms.values()].filter((r) => r.institute_id === instituteId);
        const next = rooms.find((r) => r.status === 'ACTIVE' && !liveDeviceInRoom(r.id));
        return { rooms: rooms.map(roomRow), next_unpaired_room_id: next?.id ?? null };
    }

    function roomsCreate(ctx) {
        const user = requireUser(ctx);
        requireInstituteAdmin(user, ctx.body.institute_id);
        return roomRow(createRoom(ctx.body.institute_id, ctx.body.name, user.id));
    }

    function roomsBulk(ctx) {
        const user = requireUser(ctx);
        requireInstituteAdmin(user, ctx.body.institute_id);
        const names = Array.isArray(ctx.body.names) ? ctx.body.names : [];
        if (names.length > BULK_ROOM_CAP) {
            throw new ApiError(400, 'BAD_REQUEST', `At most ${BULK_ROOM_CAP} rooms at a time`);
        }
        const created = [];
        const skipped = [];
        for (const name of names) {
            try {
                created.push(roomRow(createRoom(ctx.body.institute_id, name, user.id)));
            } catch (error) {
                if (error.code !== 'ROOM_NAME_TAKEN') throw error;
                skipped.push(name);
            }
        }
        return { created, skipped_duplicates: skipped };
    }

    function roomsPatch(ctx) {
        const user = requireUser(ctx);
        const room = db.rooms.get(ctx.params.id);
        if (!room) throw new ApiError(404, 'NOT_FOUND', 'No such room');
        requireInstituteAdmin(user, room.institute_id);
        if (ctx.body.status === 'ARCHIVED' && liveDeviceInRoom(room.id)) {
            throw new ApiError(409, 'ROOM_HAS_DEVICE', 'Remove the panel from this room first');
        }
        if (typeof ctx.body.name === 'string') {
            const clean = ctx.body.name.trim();
            const lower = clean.toLowerCase();
            const taken = activeRooms(room.institute_id).some(
                (r) => r.id !== room.id && r.name.toLowerCase() === lower
            );
            if (!clean || clean.length > 120) {
                throw new ApiError(400, 'BAD_REQUEST', 'Room name must be 1 to 120 characters');
            }
            if (taken) throw new ApiError(409, 'ROOM_NAME_TAKEN', 'A room with this name exists');
            room.name = clean;
        }
        if (ctx.body.status === 'ACTIVE' || ctx.body.status === 'ARCHIVED') {
            room.status = ctx.body.status;
        }
        return roomRow(room);
    }

    function devicesList(ctx) {
        const user = requireUser(ctx);
        const instituteId = ctx.query.get('institute_id');
        requireInstituteAdmin(user, instituteId);
        return [...db.devices.values()]
            .filter((d) => d.institute_id === instituteId)
            .map(deviceRow);
    }

    function devicesPatch(ctx) {
        const user = requireUser(ctx);
        const device = db.devices.get(ctx.params.id);
        if (!device) throw new ApiError(404, 'NOT_FOUND', 'No such panel');
        requireInstituteAdmin(user, device.institute_id);
        if (ctx.body.room_id !== undefined) {
            const room = roomIn(device.institute_id, ctx.body.room_id);
            const occupant = liveDeviceInRoom(room.id);
            if (occupant && occupant.id !== device.id) {
                throw new ApiError(409, 'ROOM_OCCUPIED', 'This room already has a panel', {
                    current_device: {
                        id: occupant.id,
                        model: occupant.model,
                        last_seen_at: iso(occupant.last_seen_at),
                    },
                });
            }
            device.room_id = room.id;
        }
        if (typeof ctx.body.password_login_allowed === 'boolean') {
            device.password_login_allowed = ctx.body.password_login_allowed;
        }
        return deviceRow(device);
    }

    function devicesRevoke(ctx) {
        const user = requireUser(ctx);
        const device = db.devices.get(ctx.params.id);
        if (!device) throw new ApiError(404, 'NOT_FOUND', 'No such panel');
        requireInstituteAdmin(user, device.institute_id);
        revokeDevice(device, user.id);
        return { status: 'REVOKED' };
    }

    function sessionsAdminEnd(ctx) {
        const user = requireUser(ctx);
        const session = db.sessions.get(ctx.params.id);
        if (!session) throw new ApiError(404, 'NOT_FOUND', 'No such session');
        requireInstituteAdmin(user, session.institute_id);
        endSession(session, 'ADMIN', user.id);
        return { ended: true };
    }

    function challengeDescribe(ctx) {
        const user = requireUser(ctx);
        rateLimit('describe', user.id);
        const challenge = findChallenge(ctx.body);
        const state = challenge ? challengeState(challenge) : null;
        if (!challenge || (state !== 'PENDING' && state !== 'SCANNED')) {
            throw new ApiError(404, 'EXPIRED', 'This code has expired');
        }
        const institute = db.institutes.get(challenge.institute_id);
        if (!policyAllows(user, challenge.institute_id)) {
            throw new ApiError(403, 'NOT_STAFF', 'Not staff at this institute', {
                institute_name: institute?.name ?? null,
            });
        }
        if (challenge.purpose === 'ATTACH_REMOTE') {
            const session = db.sessions.get(challenge.session_id);
            if (!session || session.user_id !== user.id) {
                throw new ApiError(403, 'OTHER_USER', 'Another teacher is signed in on this panel');
            }
        }
        const t = now();
        challenge.state = 'SCANNED';
        challenge.scanned_by_name = user.name.split(' ')[0];
        const floor = Math.min(t + SCANNED_MIN_MS, challenge.created_at + SCANNED_MAX_MS);
        if (challenge.expires_at < floor) challenge.expires_at = floor;
        return {
            purpose: challenge.purpose,
            institute_id: challenge.institute_id,
            institute_name: institute?.name ?? null,
            room_name: roomName(db.devices.get(challenge.device_id)),
            match_options: challenge.match_options,
            expires_in_s: Math.floor((challenge.expires_at - t) / 1000),
        };
    }

    function challengeApprove(ctx) {
        const user = requireUser(ctx);
        const body = ctx.body;
        if (body.user_code && !body.t) rateLimit('approve_code', user.id);
        const challenge = findChallenge(body);
        const expired = () => new ApiError(409, 'EXPIRED', 'This code has expired');
        if (!challenge) throw expired();
        const t = now();

        const isRepeat =
            (challenge.state === 'APPROVED' || challenge.state === 'REDEEMED') &&
            challenge.approved_user_id === user.id &&
            t - challenge.approved_at <= REPEAT_WINDOW_MS;
        if (isRepeat) {
            // Same as the service: too late to deny what this person already approved.
            if (body.deny === true) throw expired();
            const session = db.sessions.get(challenge.session_id);
            if (!session || !isLive(session)) throw expired();
            session.remote_token = token(32);
            session.remote_client_seq = 0;
            return approvedBody(challenge, session, session.remote_token);
        }

        const device = db.devices.get(challenge.device_id);
        const state = challengeState(challenge);
        if (!device || device.status !== 'ACTIVE' || (state !== 'PENDING' && state !== 'SCANNED')) {
            throw expired();
        }
        const institute = db.institutes.get(challenge.institute_id);
        if (!policyAllows(user, challenge.institute_id)) {
            throw new ApiError(403, 'NOT_STAFF', 'Not staff at this institute', {
                institute_name: institute?.name ?? null,
            });
        }
        if (body.deny === true) {
            challenge.state = 'DEAD';
            return { denied: true };
        }
        if (body.match_code !== challenge.match_code) {
            challenge.state = 'DEAD';
            throw new ApiError(409, 'WRONG_NUMBER', 'That number did not match');
        }

        let session;
        if (challenge.purpose === 'ATTACH_REMOTE') {
            session = db.sessions.get(challenge.session_id);
            if (!session || !isLive(session)) throw expired();
            if (session.user_id !== user.id) {
                throw new ApiError(403, 'OTHER_USER', 'Another teacher is signed in on this panel');
            }
            challenge.state = 'REDEEMED';
            challenge.redeemed_at = t;
        } else {
            session = startSession(device, user, 'QR');
            challenge.session_id = session.id;
            challenge.state = 'APPROVED';
        }
        activateInvitedRoles(user, challenge.institute_id);
        session.remote_token = token(32);
        session.remote_client_seq = 0;
        session.approved_ip = ctx.ip;
        challenge.approved_user_id = user.id;
        challenge.approved_ip = ctx.ip;
        challenge.approved_at = t;
        return approvedBody(challenge, session, session.remote_token);
    }

    function mySession(ctx) {
        const user = requireUser(ctx);
        const session = activeSessionForUser(user.id);
        if (!session || !isLive(session)) return { status: 204 };
        return {
            session_id: session.id,
            institute_id: session.institute_id,
            room_name: roomName(db.devices.get(session.device_id)),
            session_expires_in_s: secondsLeft(session),
        };
    }

    function mySessionEnd(ctx) {
        const user = requireUser(ctx);
        const session = activeSessionForUser(user.id);
        if (session) endSession(session, 'PHONE', user.id);
        return { ended: true };
    }

    // ------------------------------------------------------ admin_core mock ---

    function requireStaff(ctx, instituteId) {
        const user = requireUser(ctx);
        if (!instituteId || ctx.headers.clientid !== instituteId) {
            throw new ApiError(403, 'FORBIDDEN', 'clientId must match the institute');
        }
        if (rolesAt(user, instituteId).length === 0 || !policyAllows(user, instituteId)) {
            throw new ApiError(403, 'FORBIDDEN', 'Staff of this institute only');
        }
        return user;
    }

    function zonedDate(ms, zone) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date(ms));
        return parts;
    }

    function zonedLabel(ms, zone) {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: zone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(new Date(ms));
    }

    function buildToday(ctx) {
        const t = now();
        const row = (scheduleId, title, linkType, offsetMin, lengthMin, extra = {}) => {
            const startsAt = t + offsetMin * MIN;
            const endsAt = lengthMin === null ? null : startsAt + lengthMin * MIN;
            return {
                schedule_id: scheduleId,
                session_id: `session-of-${scheduleId}`,
                title,
                subject: 'Physics',
                batches: ['Class 8 2026-27'],
                meeting_date: zonedDate(startsAt, SESSION_ZONE),
                starts_at_ms: startsAt,
                ends_at_ms: endsAt,
                time_label: zonedLabel(startsAt, SESSION_ZONE),
                timezone: SESSION_ZONE,
                link_type: linkType,
                streaming_type: linkType,
                live_now: startsAt <= t && (endsAt === null || endsAt > t),
                instructors: [{ user_id: 'teacher_a', name: 'Tara Teacher' }],
                external_link: null,
                ...extra,
            };
        };
        return [
            row('sched-bbb-live', 'Forces, live now', 'bbb', -5, 45),
            row('sched-bbb-ended', 'Motion, ended room', 'bbb', 10, 45),
            row('sched-bbb-blocked', 'Motion, room in use', 'bbb', 20, 45),
            row('sched-zoom', 'Waves on Zoom', 'zoom', 30, 45),
            row('sched-meet', 'Sound on Meet', 'google meet', 60, 45),
            row(
                'sched-meet-provisioning',
                'Light on Meet, still provisioning',
                'google meet',
                75,
                45
            ),
            row('sched-zoho', 'Heat on Zoho', 'zoho', 90, null),
            row('sched-zoho-nohost', 'Energy on Zoho, no host link', 'zoho', 100, 30),
            row('sched-external', 'Guest talk, external', 'other', 120, 30, {
                external_link: meetingUrl(ctx, 'external'),
            }),
            row('sched-other-teacher', 'Another teacher', 'bbb', 150, 45, {
                instructors: [{ user_id: 'teacher_a2', name: 'Tej Teacher' }],
            }),
        ];
    }

    function today(ctx) {
        const instituteId = ctx.query.get('instituteId');
        const user = requireStaff(ctx, instituteId);
        const scope = ctx.query.get('scope') === 'all' ? 'all' : 'mine';
        const classes = db.todayOverride ?? (instituteId === 'inst-a' ? buildToday(ctx) : []);
        const visible =
            scope === 'all'
                ? classes
                : classes.filter((c) => c.instructors.some((i) => i.user_id === user.id));
        return {
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
            body: {
                server_time_ms: now(),
                classes: visible.slice(0, 50),
                truncated: visible.length > 50,
            },
        };
    }

    /** The address the client used, which through the gateway is not this process's own. */
    const selfBase = (ctx) =>
        `http://${ctx.headers['x-forwarded-host'] ?? ctx.headers.host ?? 'localhost'}`;

    const meetingUrl = (ctx, id) => `${selfBase(ctx)}/__mock/meeting/${encodeURIComponent(id)}`;

    function bbbJoin(ctx) {
        requireUser(ctx);
        const scheduleId = ctx.query.get('scheduleId');
        const recreate = ctx.query.get('recreate') === 'true';
        if (!recreate && (scheduleId === 'sched-bbb-ended' || scheduleId === 'sched-bbb-blocked')) {
            return { status: 'MEETING_ENDED', message: 'This meeting has ended' };
        }
        if (recreate && scheduleId === 'sched-bbb-blocked') {
            return { status: 'RECREATE_BLOCKED', message: 'This class is still in use.' };
        }
        return { joinUrl: meetingUrl(ctx, scheduleId) };
    }

    function meetJoin(ctx) {
        requireUser(ctx);
        const scheduleId = ctx.query.get('scheduleId');
        const attempts = (db.meetAttempts.get(scheduleId) ?? 0) + 1;
        db.meetAttempts.set(scheduleId, attempts);
        if (scheduleId === 'sched-meet-provisioning' && attempts <= 2) {
            throw new ApiError(409, 'ERROR', 'This Google Meet is still being set up.');
        }
        return {
            joinUrl: meetingUrl(ctx, scheduleId),
            organizerEmail: 'organizer@mock.test',
            cohostEmail: 'teacher_a@mock.test',
            cohostJustAdded: attempts === 1,
        };
    }

    function sessionLinks(ctx) {
        requireUser(ctx);
        const scheduleId = ctx.query.get('scheduleId');
        const joinUrl = meetingUrl(ctx, scheduleId);
        return {
            hostUrl: scheduleId === 'sched-zoho-nohost' ? null : `${joinUrl}?role=host`,
            joinUrl,
        };
    }

    function zoomSignature(ctx) {
        requireUser(ctx);
        const scheduleId = ctx.query.get('scheduleId');
        if (db.zoomSignatures.has(scheduleId)) {
            throw new ApiError(409, 'ERROR', 'Signature already issued');
        }
        db.zoomSignatures.add(scheduleId);
        return { signature: token(24), meetingNumber: '1234567890', sdkKey: 'mock', role: 1 };
    }

    function zoomPayload(ctx) {
        requireUser(ctx);
        return { meetingNumber: '1234567890', password: 'mock', userName: 'Mock Host' };
    }

    function resolveByInstitute(ctx) {
        const institute = db.institutes.get(ctx.query.get('instituteId'));
        if (!institute) return { status: 404, body: {} };
        return {
            instituteId: institute.id,
            instituteName: institute.name,
            instituteThemeCode: institute.theme_code,
            instituteLogoFileId: null,
            fontFamily: null,
        };
    }

    function instituteSetup(ctx) {
        requireUser(ctx);
        const institute = db.institutes.get(ctx.params.id);
        if (!institute) throw new ApiError(404, 'NOT_FOUND', 'No such institute');
        return {
            institute_info_dto: {
                institute_name: institute.name,
                institute_logo_file_id: null,
                institute_theme_code: institute.theme_code,
                setting: '{}',
            },
        };
    }

    // ------------------------------------------------------------- logins ---

    function issueLogin(user) {
        if (user.session_limited) {
            return {
                accessToken: null,
                refreshToken: null,
                session_limit_exceeded: true,
                active_sessions: [],
            };
        }
        const refreshToken = token(32);
        db.refreshTokens.set(refreshToken, user.id);
        return {
            accessToken: mintLoginJwt(user),
            refreshToken,
            session_limit_exceeded: false,
            active_sessions: null,
        };
    }

    function loginRoot(ctx) {
        const user = db.users.get(ctx.body.user_name);
        if (!user || ctx.body.password !== MOCK_PASSWORD) {
            return { status: 401, body: { ex: 'Bad credentials' } };
        }
        return issueLogin(user);
    }

    function refreshToken(ctx) {
        const user = db.users.get(db.refreshTokens.get(ctx.body.token));
        if (!user) return { status: 401, body: { ex: 'Invalid refresh token' } };
        return { accessToken: mintLoginJwt(user) };
    }

    function requestOtp() {
        return { message: 'OTP sent (mock)' };
    }

    function loginOtp(ctx) {
        const email = String(ctx.body.email ?? ctx.body.user_name ?? '');
        const user = [...db.users.values()].find((u) => u.email === email);
        if (!user || String(ctx.body.otp) !== MOCK_OTP) {
            return { status: 401, body: { ex: 'Invalid OTP' } };
        }
        return issueLogin(user);
    }

    // ----------------------------------------------------- content fixtures ---

    function publicUrl(ctx) {
        requireUser(ctx);
        const fileId = ctx.query.get('fileId');
        const url = `${selfBase(ctx)}/__mock/files/${encodeURIComponent(fileId)}`;
        return { status: 200, text: url };
    }

    function file(ctx) {
        const id = ctx.params.id;
        if (id.startsWith('file-pdfbig-')) {
            const megabytes = parseInt(id.split('-')[2], 10) || 1;
            return {
                status: 200,
                headers: { 'Content-Type': 'application/pdf' },
                raw: buildPdf(3, 'Big mock lesson', megabytes * 1024 * 1024),
            };
        }
        if (id.startsWith('file-pdf')) {
            const pages = parseInt(id.split('-').pop(), 10) || 3;
            return {
                status: 200,
                headers: { 'Content-Type': 'application/pdf' },
                raw: buildPdf(pages, 'Mock lesson'),
            };
        }
        if (id.startsWith('file-scene')) return buildScene(`Mock slide ${id}`);
        return { status: 404, body: {} };
    }

    function meetingPage(ctx) {
        return {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            raw: Buffer.from(
                `<!doctype html><title>Mock meeting</title><h1>Mock meeting ${ctx.params.id}</h1>`
            ),
        };
    }

    function studyLibrary(ctx) {
        requireUser(ctx);
        return fixtures.library;
    }

    function modulesWithChapters(ctx) {
        requireUser(ctx);
        return fixtures.modules;
    }

    function slidesList(ctx) {
        requireUser(ctx);
        return fixtures.slides;
    }

    function presentationList() {
        return fixtures.decks;
    }

    function presentationDetail(ctx) {
        const deck = fixtures.decks.find((d) => d.id === ctx.query.get('presentationId'));
        if (!deck) return { status: 404, body: {} };
        return deck;
    }

    // ---------------------------------------------------- community presenter ---

    function voltSessionDto(session) {
        return {
            session_id: session.id,
            invite_code: session.invite_code,
            session_status: session.status,
            current_slide_index: session.index,
            slide_start_timestamp: session.slide_start_timestamp,
            default_seconds_for_question: 60,
            slides: { added_slides: session.slides },
        };
    }

    function voltCreate(ctx, withKey) {
        const deck = fixtures.decks.find((d) => d.id === ctx.body.source_id) ?? fixtures.decks[0];
        const session = {
            id: uuid(),
            invite_code: randomCode().slice(0, 6),
            status: 'CREATED',
            index: 0,
            slide_start_timestamp: null,
            slides: deck.added_slides,
            key: withKey ? token(32) : null,
        };
        db.voltSessions.set(session.id, session);
        return session;
    }

    function requireVoltKey(ctx, session) {
        if (!session.key) return;
        const given = ctx.headers['x-presenter-token'] ?? ctx.query.get('presenter_token');
        if (given !== session.key) throw new ApiError(403, 'FORBIDDEN', 'Presenter key required');
    }

    function voltControl(ctx, apply) {
        const session = db.voltSessions.get(ctx.body.session_id);
        // community_service answers an unknown session through VacademyException: 510.
        if (!session) throw new ApiError(510, 'ERROR', 'Session not found');
        requireVoltKey(ctx, session);
        apply(session);
        return voltSessionDto(session);
    }

    function voltRead(ctx) {
        const session = db.voltSessions.get(ctx.params.id);
        if (!session) throw new ApiError(404, 'NOT_FOUND', 'No such session');
        requireVoltKey(ctx, session);
        if ((ctx.headers.accept ?? '').includes('text/event-stream')) {
            return {
                sse: `event: session_state_presenter\ndata: ${JSON.stringify({
                    sessionStatus: session.status,
                    currentSlideIndex: session.index,
                    totalSlides: session.slides.length,
                })}\n\n`,
            };
        }
        return voltSessionDto(session);
    }

    // ----------------------------------------------------------- test controls ---

    function controlState() {
        const strip = (row, ...fields) => {
            const copy = { ...row };
            fields.forEach((field) => delete copy[field]);
            return copy;
        };
        return {
            now: now(),
            config,
            rooms: [...db.rooms.values()],
            pairings: [...db.pairings.values()].map((p) => strip(p, 'pair_secret')),
            devices: [...db.devices.values()].map((d) => strip(d, 'secret')),
            sessions: [...db.sessions.values()].map((s) =>
                strip(s, 'session_token', 'remote_token')
            ),
            challenges: [...db.challenges.values()].map((c) => strip(c, 'token')),
        };
    }

    function scenarioConfig() {
        const users = {};
        for (const user of db.users.values()) {
            users[user.id] = {
                id: user.id,
                name: user.name,
                username: user.username,
                password: MOCK_PASSWORD,
                token: user.session_limited ? null : mintLoginJwt(user),
            };
        }
        return {
            mode: 'mock',
            institutes: {
                a: { id: 'inst-a', name: 'Alpha School' },
                b: { id: 'inst-b', name: 'Beta Academy' },
                limited: { id: 'inst-limited', name: 'Limited Institute' },
            },
            users,
        };
    }

    function shortLivedToken(ctx) {
        const user = db.users.get(ctx.body.user_id);
        if (!user) throw new ApiError(404, 'NOT_FOUND', 'No such user');
        return { token: signJwt(userClaims(user, null), ctx.body.ttl_s ?? 60) };
    }

    function setRoles(ctx) {
        const user = db.users.get(ctx.body.user_id);
        if (!user) throw new ApiError(404, 'NOT_FOUND', 'No such user');
        user.roles[ctx.body.institute_id] = (ctx.body.roles ?? []).map((role) =>
            Array.isArray(role) ? role : [role, 'ACTIVE']
        );
        return { ok: true };
    }

    // ------------------------------------------------------------ routes table ---

    const PUB = '/auth-service/public/v1/panel';
    const BEARER = '/auth-service/v1/panel';
    const MEETING = '/admin-core-service/live-sessions/provider/meeting';
    const ENGAGE = '/community-service/engage/admin';

    const routes = [
        ['POST', `${PUB}/pair/start`, pairStart],
        ['POST', `${PUB}/pair/poll`, pairPoll],
        ['POST', `${PUB}/pair/confirm`, pairConfirm],
        ['POST', `${PUB}/sync`, panelSync],
        ['POST', `${PUB}/challenge`, createChallenge],
        ['POST', `${PUB}/challenge/poll`, challengePoll],
        ['POST', `${PUB}/challenge/info`, challengeInfo],
        ['POST', `${PUB}/session/refresh`, sessionRefresh],
        ['POST', `${PUB}/session/end`, sessionEnd],
        ['POST', `${PUB}/session/login-password`, loginPassword],
        ['POST', `${PUB}/remote/nav`, remoteNav],
        ['POST', `${PUB}/remote/state`, remoteState],
        ['POST', `${PUB}/remote/end`, remoteEnd],

        ['POST', `${BEARER}/pair/preview`, pairPreview],
        ['GET', `${BEARER}/admin/institutes`, adminInstitutes],
        ['POST', `${BEARER}/admin/devices/claim`, deviceClaim],
        ['GET', `${BEARER}/admin/rooms`, roomsList],
        ['POST', `${BEARER}/admin/rooms`, roomsCreate],
        ['POST', `${BEARER}/admin/rooms/bulk`, roomsBulk],
        ['PATCH', `${BEARER}/admin/rooms/:id`, roomsPatch],
        ['GET', `${BEARER}/admin/devices`, devicesList],
        ['PATCH', `${BEARER}/admin/devices/:id`, devicesPatch],
        ['POST', `${BEARER}/admin/devices/:id/revoke`, devicesRevoke],
        ['POST', `${BEARER}/admin/sessions/:id/end`, sessionsAdminEnd],
        ['POST', `${BEARER}/challenge/describe`, challengeDescribe],
        ['POST', `${BEARER}/challenge/approve`, challengeApprove],
        ['GET', `${BEARER}/my-session`, mySession],
        ['POST', `${BEARER}/my-session/end`, mySessionEnd],

        ['GET', '/admin-core-service/classroom/v1/today', today],
        ['GET', `${MEETING}/join`, bbbJoin],
        ['GET', `${MEETING}/google-meet-join`, meetJoin],
        ['GET', `${MEETING}/session-links`, sessionLinks],
        ['GET', `${MEETING}/zoom-sdk-signature`, zoomSignature],
        ['GET', `${MEETING}/zoom-join-payload`, zoomPayload],
        [
            'GET',
            '/admin-core-service/public/domain-routing/v1/resolve-by-institute',
            resolveByInstitute,
        ],
        ['GET', '/admin-core-service/institute/v1/setup-without-batches/:id', instituteSetup],
        ['GET', '/admin-core-service/v1/study-library/init', studyLibrary],
        ['GET', '/admin-core-service/v1/study-library/modules-with-chapters', modulesWithChapters],
        ['GET', '/admin-core-service/slide/v1/slides', slidesList],
        ['GET', '/media-service/get-public-url', publicUrl],

        ['POST', '/auth-service/v1/login-root', loginRoot],
        ['POST', '/auth-service/v1/refresh-token', refreshToken],
        ['POST', '/auth-service/v1/request-otp', requestOtp],
        ['POST', '/auth-service/v1/login-otp', loginOtp],

        ['GET', '/community-service/presentation/get-all-presentation', presentationList],
        ['GET', '/community-service/presentation/get-presentation', presentationDetail],
        ['POST', `${ENGAGE}/create`, (ctx) => voltSessionDto(voltCreate(ctx, false))],
        [
            'POST',
            `${ENGAGE}/v2/create`,
            (ctx) => {
                const session = voltCreate(ctx, true);
                return { session: voltSessionDto(session), presenter_key: session.key };
            },
        ],
        [
            'POST',
            `${ENGAGE}/start`,
            (ctx) =>
                voltControl(ctx, (s) => {
                    s.status = 'LIVE';
                    s.slide_start_timestamp = now();
                }),
        ],
        [
            'POST',
            `${ENGAGE}/move`,
            (ctx) =>
                voltControl(ctx, (s) => {
                    s.index = ctx.body.move_to ?? s.index;
                    s.slide_start_timestamp = now();
                }),
        ],
        [
            'POST',
            `${ENGAGE}/finish`,
            (ctx) => voltControl(ctx, (s) => void (s.status = 'FINISHED')),
        ],
        [
            'POST',
            `${ENGAGE}/finish-send-notifications`,
            (ctx) => voltControl(ctx, (s) => void (s.status = 'FINISHED')),
        ],
        ['POST', `${ENGAGE}/add-slide-in-session`, (ctx) => voltControl(ctx, () => undefined)],
        ['GET', `${ENGAGE}/:id`, voltRead],
        [
            'GET',
            `${ENGAGE}/:id/leaderboard`,
            (ctx) => {
                voltRead({ ...ctx, headers: { ...ctx.headers, accept: '' } });
                return [];
            },
        ],
        [
            'GET',
            `${ENGAGE}/:id/leaderboard/csv`,
            (ctx) => {
                voltRead({ ...ctx, headers: { ...ctx.headers, accept: '' } });
                return {
                    status: 200,
                    headers: { 'Content-Type': 'text/csv' },
                    raw: Buffer.from('rank,name,score\n'),
                };
            },
        ],
        [
            'GET',
            `${ENGAGE}/:id/slide/:slideId/responses`,
            (ctx) => {
                voltRead({ ...ctx, headers: { ...ctx.headers, accept: '' } });
                return [];
            },
        ],

        ['GET', '/__mock/files/:id', file],
        ['GET', '/__mock/meeting/:id', meetingPage],
        ['GET', '/__mock/state', controlState],
        ['GET', '/__mock/scenario-config', scenarioConfig],
        ['POST', '/__mock/short-token', shortLivedToken],
        ['POST', '/__mock/roles', setRoles],
        [
            'POST',
            '/__mock/reset',
            () => {
                reset();
                return { ok: true };
            },
        ],
        [
            'POST',
            '/__mock/clock',
            (ctx) => {
                clockOffset += Number(ctx.body.advance_ms) || 0;
                return { now: now() };
            },
        ],
        [
            'POST',
            '/__mock/config',
            (ctx) => {
                config = { ...config, ...ctx.body };
                return config;
            },
        ],
        [
            'POST',
            '/__mock/force-next',
            (ctx) => {
                db.forced.push({
                    path: ctx.body.path,
                    status: ctx.body.status ?? 200,
                    body: ctx.body.body ?? {},
                    times: ctx.body.times ?? 1,
                });
                return { ok: true };
            },
        ],
        [
            'POST',
            '/__mock/today',
            (ctx) => {
                db.todayOverride = ctx.body.classes ?? null;
                return { ok: true };
            },
        ],
    ].map(([method, pattern, handler]) => {
        const keys = [];
        const source = pattern.replace(/:([a-z]+)/g, (_, key) => {
            keys.push(key);
            return '([^/]+)';
        });
        return { method, regex: new RegExp(`^${source}$`), keys, handler };
    });

    // --------------------------------------------------------------- server ---

    function corsHeaders(req) {
        return {
            'Access-Control-Allow-Origin': req.headers.origin ?? '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
            'Access-Control-Max-Age': '600',
            Vary: 'Origin',
        };
    }

    function readBody(req) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                if (!raw) return resolve({});
                try {
                    const parsed = JSON.parse(raw);
                    resolve(parsed && typeof parsed === 'object' ? parsed : {});
                } catch {
                    reject(new ApiError(400, 'BAD_REQUEST', 'Body is not JSON'));
                }
                return undefined;
            });
            req.on('error', reject);
        });
    }

    function clientIp(req) {
        const forwarded = req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? '';
        const first = String(forwarded).split(',')[0].trim();
        return first || req.socket.remoteAddress || 'unknown';
    }

    function send(res, cors, status, headers, payload) {
        res.writeHead(status, { ...cors, ...headers });
        res.end(payload);
    }

    function sendJson(res, cors, status, body, headers = {}) {
        send(
            res,
            cors,
            status,
            { 'Content-Type': 'application/json', ...headers },
            JSON.stringify(body)
        );
    }

    async function handle(req, res) {
        const cors = corsHeaders(req);
        if (req.method === 'OPTIONS') return send(res, cors, 204, {}, undefined);
        const url = new URL(req.url, 'http://mock');
        const path = url.pathname.replace(/\/+$/, '') || '/';
        try {
            const isPublicPanel = path.startsWith(`${PUB}/`);
            if (isPublicPanel && config.public_busy) {
                throw new ApiError(429, 'BUSY', 'Try again shortly', { retry_after_ms: 2000 });
            }
            const forcedAt = db.forced.findIndex((f) => f.path === path);
            if (forcedAt >= 0) {
                const forced = db.forced[forcedAt];
                forced.times -= 1;
                if (forced.times <= 0) db.forced.splice(forcedAt, 1);
                return sendJson(res, cors, forced.status, forced.body);
            }
            for (const route of routes) {
                if (route.method !== req.method) continue;
                const match = route.regex.exec(path);
                if (!match) continue;
                const params = {};
                route.keys.forEach((key, index) => {
                    params[key] = decodeURIComponent(match[index + 1]);
                });
                const body =
                    req.method === 'GET' || req.method === 'HEAD' ? {} : await readBody(req);
                const ctx = {
                    path,
                    req,
                    headers: req.headers,
                    query: url.searchParams,
                    params,
                    body,
                    ip: clientIp(req),
                };
                const out = await route.handler(ctx);
                if (out && out.sse !== undefined) {
                    res.writeHead(200, {
                        ...cors,
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                    });
                    res.write(out.sse);
                    return undefined; // Held open until the client leaves.
                }
                if (out && out.raw !== undefined) {
                    return send(res, cors, out.status ?? 200, out.headers ?? {}, out.raw);
                }
                if (out && out.text !== undefined) {
                    return send(
                        res,
                        cors,
                        out.status ?? 200,
                        { 'Content-Type': 'text/plain' },
                        out.text
                    );
                }
                if (out && typeof out.status === 'number' && out.body === undefined) {
                    return send(res, cors, out.status, {}, undefined);
                }
                if (out && typeof out.status === 'number' && 'body' in out) {
                    return sendJson(res, cors, out.status, out.body, out.headers);
                }
                return sendJson(res, cors, 200, out ?? {});
            }
            return sendJson(res, cors, 404, {
                code: 'NOT_FOUND',
                message: `Not implemented in the mock: ${req.method} ${path}`,
            });
        } catch (error) {
            if (error instanceof SecurityRefusal) return sendJson(res, cors, 403, error.body);
            if (error instanceof ApiError) {
                return sendJson(res, cors, error.status, {
                    code: error.code,
                    message: error.message,
                    ...(error.extra ?? {}),
                });
            }
            console.error('[mock-backend]', error);
            return sendJson(res, cors, 500, { code: 'ERROR', message: String(error.message) });
        }
    }

    const server = http.createServer((req, res) => {
        void handle(req, res);
    });

    return {
        server,
        listen: (port = 0, host = '127.0.0.1') =>
            new Promise((resolve) => {
                server.listen(port, host, () => resolve(server.address().port));
            }),
        close: () =>
            new Promise((resolve) => {
                server.closeAllConnections?.();
                server.close(() => resolve());
            }),
        reset,
    };
}

function argValue(flag, fallback) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const port = Number(argValue('--port', process.env.MOCK_PORT ?? 8761));
    const host = argValue('--host', '127.0.0.1');
    const approveBase = argValue('--approve-base', process.env.MOCK_APPROVE_BASE_URL);
    const mock = createMockBackend({ approveBase });
    const bound = await mock.listen(port, host);
    console.log(`[mock-backend] listening on http://${host}:${bound}`);
}
