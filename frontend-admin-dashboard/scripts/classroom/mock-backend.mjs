#!/usr/bin/env node
/**
 * In-memory stand-in for the Vacademy Classroom backend, for local panel, phone
 * page and console work. node:http only, no dependencies, nothing on disk.
 *
 *   node scripts/classroom/mock-backend.mjs [--port 8761] [--host 0.0.0.0]
 *        [--approve-base http://localhost:5199] [--phase2]
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
 *   GET  /__mock/now                   the mock's clock
 *   POST /__mock/licence {...}         seats: enforcement, grants, auto-trial template
 *   POST /__mock/release {...}         put an app release straight in
 *
 * Phase 2 (usage, seats, installer set-up, releases, fleet alerts) follows the same
 * contract as auth_service. Every feature has a switch in /__mock/config that starts
 * off, like the service's properties, so with nothing set the mock behaves as phase 1
 * and the new routes answer 404 FEATURE_OFF:
 *   usage_enabled, usage_recording, licence_enabled, licence_default_enforcement,
 *   licence_never_block, partners_enabled, releases_enabled, fleet_enabled
 * --phase2 starts the mock with every feature on. Platform-staff routes accept the
 * users in super_admin_user_ids (seeded: super_admin); /internal/ routes need the
 * clientName and Signature headers listed in internal_clients.
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
const DAY = 24 * 60 * MIN;
const HOUR = 60 * MIN;

// Phase 2. Same numbers as auth_service (PanelCompat, PanelActivityIngest, the usage rules).
const FIRST_PHASE2_VERSION_CODE = 3;
const ACTIVITY_KINDS = new Set(['LESSON', 'DECK', 'DECK_LIVE', 'CLASS', 'WHITEBOARD', 'HOME']);
const ACTIVITY_PER_REQUEST = 20;
const ACTIVITY_PER_SESSION = 100;
const ACTIVITY_REF_MAX = 64;
const ACTIVITY_TITLE_MAX = 200;
const ACTIVITY_AFTER_END_MS = 10 * MIN;
const IDLE_COUNTDOWN_S = 60;
const CONTENT_CAP_MS = 4 * HOUR;
const USAGE_ZONE = 'Asia/Kolkata';
const USAGE_MULTI_MAX = 50;
const USAGE_SESSIONS_MAX_SIZE = 200;
const INVITE_TTL_MS = 7 * DAY;
const INVITE_INSTALL_DAYS_MAX = 90;
const INTERNAL_PAGE = 500;
const OFFLINE_BAD_MS = 7 * DAY;
const NOT_CONFIRMED_MS = DAY;
const LICENCE_ENDING_MS = 14 * DAY;
const REFUSAL_MESSAGES = {
    LICENCE_REQUIRED: 'This classroom needs a licence',
    AWAITING_APPROVAL: "This panel is waiting for the school's approval",
    UPDATE_REQUIRED: 'This panel needs an app update',
};

/**
 * Phase 2 switches mirror PanelPhase2Properties and all default to off, so with nothing set
 * the mock answers exactly like phase 1 plus 404 FEATURE_OFF on the new routes.
 */
const PHASE2_DEFAULTS = {
    usage_enabled: false,
    usage_recording: false,
    usage_max_days: 92,
    licence_enabled: false,
    licence_default_enforcement: 'OFF',
    licence_never_block: false,
    partners_enabled: false,
    installer_roles: ['ADMIN'],
    releases_enabled: false,
    fleet_enabled: false,
    alerts_offline_hours: 48,
    alerts_outdated_days: 14,
    alerts_webview_warn_major: 0,
    alerts_unused_days: 7,
    /** panel.partners.default-install-days: a staff link without install_until gets this window. */
    partners_default_install_days: 30,
    /** panel.releases.direct-package-name and .signing-cert-sha256: the pinned direct build identity. */
    release_package_name: 'io.vacademy.classroom.direct',
    release_signing_cert_sha256: 'b'.repeat(64),
    /** SUPER_ADMIN_USER_IDS. Empty refuses everyone, as the real check fails closed. */
    super_admin_user_ids: ['super_admin'],
    /** clientName -> Signature accepted on /internal/ paths. */
    internal_clients: { admin_core_service: 'mock-internal-signature' },
};

/** --phase2 on the command line: every phase 2 feature on, for console and panel work. */
const PHASE2_ALL_ON = {
    usage_enabled: true,
    usage_recording: true,
    licence_enabled: true,
    partners_enabled: true,
    releases_enabled: true,
    fleet_enabled: true,
};

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
    ...PHASE2_DEFAULTS,
};

const RATE_LIMITS = {
    pair_start: 30,
    challenge_info: 60,
    pair_preview: 10,
    claim: 10,
    describe: 10,
    approve_code: 10,
    login_password: 5,
    link_redeem: 10,
};

/** Windows longer than the default minute. */
const RATE_WINDOWS = {
    link_redeem: HOUR,
};

// ------------------------------------------------------------- zone helpers ---

/** An IANA zone the runtime knows, else the default (ZoneId.of with a fallback). */
function validZone(zone) {
    if (typeof zone !== 'string' || !zone) return USAGE_ZONE;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return zone;
    } catch {
        return USAGE_ZONE;
    }
}

function zoneParts(ms, zone) {
    const parts = {};
    const format = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    for (const { type, value } of format.formatToParts(new Date(ms))) parts[type] = value;
    return parts;
}

function zoneOffsetMs(ms, zone) {
    const p = zoneParts(ms, zone);
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return wall - Math.floor(ms / 1000) * 1000;
}

/** yyyy-MM-dd of an instant in a zone. */
function localDate(ms, zone) {
    const p = zoneParts(ms, zone);
    return `${p.year}-${p.month}-${p.day}`;
}

function isLocalDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const back = new Date(Date.UTC(y, m - 1, d));
    return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

const dayNumber = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY;
};

const addDays = (date, n) => new Date((dayNumber(date) + n) * DAY).toISOString().slice(0, 10);

/** 0 is Sunday. */
const weekdayOf = (date) => new Date(dayNumber(date) * DAY).getUTCDay();

/** The instant a local date starts in a zone. */
function localMidnight(date, zone) {
    const guess = dayNumber(date) * DAY;
    let t = guess - zoneOffsetMs(guess, zone);
    t = guess - zoneOffsetMs(t, zone);
    return t;
}

const hours1 = (ms) => Math.round((ms / HOUR) * 10) / 10;
const minutesOf = (ms) => Math.round(ms / MIN);

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
        // Phase 2: installer staff hold an installer role at their own organisation's institute.
        row('installer_p', 'Ishan Installer', { partner_org: [['ADMIN', 'ACTIVE']] }),
        row('installer_q', 'Qasim Installer', { partner_org_2: [['ADMIN', 'ACTIVE']] }),
        // Platform staff: no institute roles, listed in super_admin_user_ids.
        row('super_admin', 'Suri Staff', {}),
    ];
}

/** Installer organisations. Names are data, as in panel_partner. */
function seedPartners() {
    return [
        {
            id: 'partner-1',
            name: 'Installer One',
            partner_institute_id: 'partner_org',
            status: 'ACTIVE',
            created_by: 'seed',
            created_at: 0,
        },
        {
            id: 'partner-2',
            name: 'Installer Two',
            partner_institute_id: 'partner_org_2',
            status: 'ACTIVE',
            created_by: 'seed',
            created_at: 0,
        },
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
        {
            id: 'partner_org',
            name: 'Installer Org One',
            theme_code: 'blue',
            admin_portal_url: null,
        },
        {
            id: 'partner_org_2',
            name: 'Installer Org Two',
            theme_code: 'blue',
            admin_portal_url: null,
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
            // phase 2
            activity: [],
            activityId: 0,
            licenceSettings: new Map(),
            grants: new Map(),
            templates: new Map(),
            licenceEvents: [],
            licenceEventId: 0,
            seatSeq: 0,
            partners: new Map(seedPartners().map((row) => [row.id, row])),
            links: new Map(),
            invites: new Map(),
            releases: new Map(),
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
            window = { count: 0, reset_at: t + (RATE_WINDOWS[kind] ?? MIN) };
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
            active_until: null,
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
            approval_state: device.approval_state ?? 'APPROVED',
            app_channel: device.app_channel ?? null,
            installed_by: partnerNameOf(device),
            licence_state: deviceLicenceState(device),
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
            // Phase 2: omitted unless an installer set the panel up (NON_NULL on the server).
            ...(partnerNameOf(device) ? { installed_by: partnerNameOf(device) } : {}),
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
            // Only the call that moved CLAIMED to ACTIVE reaches the seat logic.
            onActivated(device);
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
        if (
            body.app_channel === 'PLAY' ||
            body.app_channel === 'DIRECT' ||
            body.app_channel === 'DEV'
        ) {
            device.app_channel = body.app_channel;
        }

        let sessionBody;
        let phoneSeen = false;
        let activityAck = null;
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
                activityAck = config.usage_recording
                    ? ingestActivity(device, session, body.activity)
                    : null;
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

        // Licence and update offers are for the signed-out screens only: never during a class.
        const signedIn = sessionBody !== undefined && sessionBody.status === 'ACTIVE';
        const licenceBlock = signedIn ? null : syncLicenceBlock(device);
        const updateBlock = signedIn ? null : updateOffer(device);
        const required = requiredVersionCode(device);

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
                approval_state: device.approval_state ?? 'APPROVED',
            },
            ...(sessionBody ? { session: sessionBody } : {}),
            flags: {
                volt_live_enabled: config.volt_live,
                bbb_in_app_min_webview: config.bbb_in_app_min_webview,
            },
            policy: { idle_minutes: config.idle_minutes, session_hours: config.session_hours },
            next_poll_ms: poll(nextPoll),
            min_app_version_code: required ?? config.min_app_version_code,
            ...(licenceBlock ? { licence: licenceBlock } : {}),
            ...(updateBlock ? { update: updateBlock } : {}),
            ...(activityAck !== null ? { activity_acked_seq: activityAck } : {}),
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
        // Phase 2 approval, seat and version checks, for sign-in only, so the panel shows why
        // instead of a QR that can only fail at approve. ATTACH_REMOTE is never checked.
        if (purpose === 'SIGN_IN') requireCanStart(device);
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
        // First redeem, or a retry inside the window: only the newest token works. The panel
        // is polling now, so it is also marked seen (setSessionToken does the same).
        session.session_token = token(32);
        session.last_refreshed_at = t;
        session.panel_seen_at = t;
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
        if (ctx.body.session_token) {
            const session = sessionBySessionToken(device, ctx.body.session_token);
            if (session) endFromPanel(device, session, ctx.body);
        } else {
            // Without the session token no activity is stored (the owner cannot be proven).
            const session = activeSessionForDevice(device.id);
            if (session) endSession(session, reason);
        }
        return { ended: true };
    }

    /**
     * Activity first, so the last minutes' events land before the session closes. With recording
     * on, an IDLE end also records active_until: idle_minutes plus the countdown back from now.
     */
    function endFromPanel(device, session, body) {
        if (config.usage_recording && Array.isArray(body.activity) && body.activity.length > 0) {
            const live = isLive(session);
            const recent =
                !live &&
                session.ended_at !== null &&
                now() - session.ended_at < ACTIVITY_AFTER_END_MS;
            if (live || recent) ingestActivity(device, session, body.activity);
        }
        if (session.status !== 'ACTIVE') return;
        endSession(session, body.reason);
        if (config.usage_recording && body.reason === 'IDLE') {
            const back = (config.idle_minutes * 60 + IDLE_COUNTDOWN_S) * 1000;
            session.active_until = Math.max(session.created_at, session.ended_at - back);
        }
    }

    function loginPassword(ctx) {
        const body = ctx.body;
        requirePanelEnabled();
        const device = requireActiveDevice(body);
        rateLimit('login_password', `${device.id}:${body.username}`);
        if (!device.password_login_allowed) {
            throw new ApiError(403, 'PASSWORD_DISABLED', 'Password sign-in is off for this panel');
        }
        requireCanStart(device); // before any credential check, as the service does
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
            // Admin claims stay approved, as in phase 1.
            approval_state: 'APPROVED',
            installed_by_partner_id: null,
            approved_by: null,
            approved_at: null,
            app_channel: null,
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
            const archiving = room.status === 'ACTIVE' && ctx.body.status === 'ARCHIVED';
            room.status = ctx.body.status;
            if (archiving) onRoomArchived(room, user.id);
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
            // Checked again at approve: the seat or approval can change while the QR is up.
            requireCanStart(device);
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
            activity: db.activity,
            licence_settings: Object.fromEntries(db.licenceSettings),
            grants: [...db.grants.values()],
            templates: Object.fromEntries(db.templates),
            licence_events: db.licenceEvents,
            partners: [...db.partners.values()],
            links: [...db.links.values()],
            invites: [...db.invites.values()].map((i) => strip(i, 'code_hash')),
            releases: [...db.releases.values()],
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
                partner: { id: 'partner_org', name: 'Installer Org One' },
                partner2: { id: 'partner_org_2', name: 'Installer Org Two' },
            },
            users,
            // Phase 2: the mock switches features itself through /__mock/config, so every one
            // is available. A real service lists the ones it was started with.
            features: {
                usage: true,
                usage_recording: true,
                licence: true,
                partners: true,
                releases: true,
                fleet: true,
            },
            internal: {
                client_name: 'admin_core_service',
                signature: config.internal_clients?.admin_core_service ?? null,
            },
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

    // ================================================================ phase 2 ===
    // Each feature answers 404 FEATURE_OFF while its switch in config is off, after the
    // usual sign-in check, as auth_service does. Platform-staff routes check the staff list
    // first. Internal routes are checked for the client signature in handle().

    function requireFeature(name) {
        if (config[name] !== true) {
            throw new ApiError(404, 'FEATURE_OFF', 'This feature is not available');
        }
    }

    /** PanelCompat.refusal: panels older than phase 2 (or of unknown version) get PANEL_DISABLED. */
    function refusal(device, refusalCode) {
        const version = device.app_version_code;
        if (typeof version !== 'number' || version < FIRST_PHASE2_VERSION_CODE) {
            return new ApiError(
                403,
                'PANEL_DISABLED',
                'Classroom panels are not available for this institute'
            );
        }
        return new ApiError(403, refusalCode, REFUSAL_MESSAGES[refusalCode]);
    }

    /** Session starts only (challenge, approve, password): approval, then seat, then version. */
    function requireCanStart(device) {
        if ((device.approval_state ?? 'APPROVED') !== 'APPROVED') {
            throw refusal(device, 'AWAITING_APPROVAL');
        }
        if (config.licence_enabled) {
            const view = licenceView(device.institute_id);
            const state = view.roomState(device.room_id);
            if (view.enforced && state !== 'LICENSED' && state !== 'GRACE') {
                throw refusal(device, 'LICENCE_REQUIRED');
            }
        }
        if (belowFloor(device)) throw refusal(device, 'UPDATE_REQUIRED');
    }

    const roomRef = (roomId) => {
        const room = db.rooms.get(roomId);
        return { id: roomId, name: room?.name ?? null };
    };
    const userRef = (userId) => ({ id: userId, name: db.users.get(userId)?.name ?? null });
    const partnerNameOf = (device) =>
        device.installed_by_partner_id
            ? db.partners.get(device.installed_by_partner_id)?.name ?? null
            : null;
    const isLiveDevice = (d) => d.status === 'CLAIMED' || d.status === 'ACTIVE';
    const isApproved = (d) => (d.approval_state ?? 'APPROVED') === 'APPROVED';

    // ------------------------------------------------------------ licence ---

    const grantsOf = (instituteId) =>
        [...db.grants.values()].filter((g) => g.institute_id === instituteId);

    /**
     * The institute's seat picture, computed on read as PanelLicenceService does. Rooms are
     * ranked by licensed_at (ties by assignment order); a rank past the seats is OVER_LIMIT.
     */
    function licenceView(instituteId) {
        const t = now();
        const enforcement =
            db.licenceSettings.get(instituteId)?.enforcement ?? config.licence_default_enforcement;
        const all = grantsOf(instituteId);
        const active = all.filter((g) => g.status === 'ACTIVE');
        const covering = active.filter((g) => g.starts_at <= t && t < g.ends_at);
        const grace = active.filter((g) => g.ends_at <= t && t < g.ends_at + g.grace_days * DAY);
        let state;
        if (covering.some((g) => g.kind !== 'TRIAL')) state = 'ACTIVE';
        else if (covering.length > 0) state = 'TRIAL';
        else if (grace.length > 0) state = 'GRACE';
        else if (all.length > 0) state = 'EXPIRED';
        else state = 'NONE';
        const sum = (rows) => rows.reduce((total, g) => total + g.seats, 0);
        const seats = sum(covering) + (state === 'GRACE' ? sum(grace) : 0);
        const basis = covering.length > 0 ? covering : grace;
        const ending = basis.reduce(
            (best, g) => (!best || g.ends_at > best.ends_at ? g : best),
            null
        );
        const graceEndsAt =
            state === 'GRACE'
                ? Math.max(...grace.map((g) => g.ends_at + g.grace_days * DAY))
                : null;
        const licensed = [...db.rooms.values()]
            .filter(
                (r) =>
                    r.institute_id === instituteId && r.status === 'ACTIVE' && r.licensed_at != null
            )
            .sort((x, y) => x.licensed_at - y.licensed_at || x.licensed_seq - y.licensed_seq);
        const rank = new Map(licensed.map((r, index) => [r.id, index + 1]));
        const instituteState = enforcement === 'OFF' ? 'UNMANAGED' : state;
        const roomState = (roomId) => {
            if (instituteState === 'UNMANAGED') return 'UNMANAGED';
            if (state === 'EXPIRED' || state === 'NONE') return 'EXPIRED';
            const position = rank.get(roomId);
            if (!position) return 'UNLICENSED';
            if (position > seats) return 'OVER_LIMIT';
            return state === 'GRACE' ? 'GRACE' : 'LICENSED';
        };
        return {
            enforcement,
            enforced: enforcement === 'LIVE' && !config.licence_never_block,
            state: instituteState,
            grantState: state,
            seats,
            seatsUsed: licensed.length,
            endsAt: ending ? ending.ends_at : null,
            graceEndsAt,
            endingGrantId: ending ? ending.id : null,
            roomState,
        };
    }

    function deviceLicenceState(device) {
        if (!config.licence_enabled) return null;
        const state = licenceView(device.institute_id).roomState(device.room_id);
        return state === 'UNMANAGED' ? null : state;
    }

    function syncLicenceBlock(device) {
        if (!config.licence_enabled) return null;
        const view = licenceView(device.institute_id);
        const state = view.roomState(device.room_id);
        const managed = state !== 'UNMANAGED';
        return {
            state,
            enforced: view.enforced,
            ends_at: managed ? iso(view.endsAt) : null,
            grace_ends_at: managed ? iso(view.graceEndsAt) : null,
        };
    }

    function seatEvent(room, action, reason, actor) {
        db.licenceEventId += 1;
        db.licenceEvents.push({
            id: db.licenceEventId,
            institute_id: room.institute_id,
            room_id: room.id,
            action,
            reason,
            partner_id: room.partner_id ?? null,
            actor: actor ?? null,
            at: now(),
        });
    }

    function assignSeat(room, reason, actor) {
        db.seatSeq += 1;
        room.licensed_at = now();
        room.licensed_seq = db.seatSeq;
        room.licensed_by = actor ?? null;
        seatEvent(room, 'ASSIGNED', reason, actor);
    }

    function releaseSeat(room, reason, actor) {
        if (room.licensed_at == null) return;
        room.licensed_at = null;
        room.licensed_seq = null;
        room.licensed_by = null;
        seatEvent(room, 'RELEASED', reason, actor);
    }

    /** Creates the automatic trial from the template, once, for an institute that never had a grant. */
    function maybeAutoTrial(instituteId) {
        const template = db.templates.get('auto_trial');
        const view = licenceView(instituteId);
        if (!template || !template.active || view.enforcement === 'OFF') return;
        if (grantsOf(instituteId).length > 0) return;
        const t = now();
        const grant = newGrant(instituteId, {
            kind: template.kind,
            seats: template.seats,
            starts_at: t,
            ends_at: t + template.days * DAY,
            grace_days: template.grace_days,
            created_by: 'SYSTEM',
        });
        db.grants.set(grant.id, grant);
    }

    /** A free seat goes to the room when an approved panel becomes active there. Never throws. */
    function trySeat(device, reason) {
        if (!config.licence_enabled || !isApproved(device) || device.status !== 'ACTIVE') return;
        const room = db.rooms.get(device.room_id);
        if (!room || room.status !== 'ACTIVE' || room.licensed_at != null) return;
        maybeAutoTrial(device.institute_id);
        const view = licenceView(device.institute_id);
        if (view.seats - view.seatsUsed > 0) assignSeat(room, reason, null);
    }

    const onActivated = (device) => trySeat(device, 'AUTO_ACTIVATE');

    function onRoomArchived(room, actor) {
        if (config.licence_enabled) releaseSeat(room, 'ROOM_ARCHIVED', actor);
    }

    function newGrant(instituteId, fields) {
        return {
            id: uuid(),
            institute_id: instituteId,
            kind: fields.kind,
            seats: fields.seats,
            starts_at: fields.starts_at,
            ends_at: fields.ends_at,
            grace_days: fields.grace_days ?? 0,
            status: 'ACTIVE',
            partner_id: fields.partner_id ?? null,
            external_ref: fields.external_ref ?? null,
            note: fields.note ?? null,
            created_by: fields.created_by,
            created_at: now(),
            cancelled_by: null,
            cancelled_at: null,
        };
    }

    const grantView = (g) => ({
        kind: g.kind,
        seats: g.seats,
        starts_at: iso(g.starts_at),
        ends_at: iso(g.ends_at),
        grace_days: g.grace_days,
    });

    const grantDetail = (g) => ({
        id: g.id,
        institute_id: g.institute_id,
        ...grantView(g),
        status: g.status,
        partner_id: g.partner_id,
        external_ref: g.external_ref,
        note: g.note,
        created_by: g.created_by,
        created_at: iso(g.created_at),
        cancelled_by: g.cancelled_by,
        cancelled_at: iso(g.cancelled_at),
    });

    /** Rooms that matter for seats: active rooms with a live panel, or holding a seat. */
    function licenceRooms(instituteId, view) {
        return activeRooms(instituteId)
            .map((room) => ({ room, device: liveDeviceInRoom(room.id) }))
            .filter(({ room, device }) => device || room.licensed_at != null)
            .sort((x, y) => x.room.name.localeCompare(y.room.name))
            .map(({ room, device }) => ({
                room: { id: room.id, name: room.name },
                licence_state: view.roomState(room.id),
                licensed_at: iso(room.licensed_at ?? null),
                device_id: device?.id ?? null,
            }));
    }

    function adminLicence(ctx) {
        const user = requireUser(ctx);
        requireFeature('licence_enabled');
        const instituteId = ctx.query.get('institute_id');
        requireInstituteAdmin(user, instituteId);
        const view = licenceView(instituteId);
        return {
            state: view.state,
            enforcement: view.enforcement,
            seats_granted: view.seats,
            seats_used: view.seatsUsed,
            ends_at: iso(view.endsAt),
            grace_ends_at: iso(view.graceEndsAt),
            grants: grantsOf(instituteId)
                .filter((g) => g.status === 'ACTIVE')
                .sort((x, y) => x.starts_at - y.starts_at)
                .map(grantView),
            rooms: licenceRooms(instituteId, view),
        };
    }

    function adminRoomForSeat(ctx) {
        const user = requireUser(ctx);
        requireFeature('licence_enabled');
        const room = db.rooms.get(ctx.params.id);
        if (!room) throw new ApiError(404, 'NOT_FOUND', 'No such room');
        requireInstituteAdmin(user, room.institute_id);
        return { user, room };
    }

    function adminSeatAssign(ctx) {
        const { user, room } = adminRoomForSeat(ctx);
        if (room.status !== 'ACTIVE') {
            throw new ApiError(400, 'BAD_REQUEST', 'This room is archived');
        }
        if (room.licensed_at == null) {
            const view = licenceView(room.institute_id);
            if (view.seats - view.seatsUsed <= 0) {
                throw new ApiError(409, 'NO_SEAT', 'No free seat is left');
            }
            assignSeat(room, 'ADMIN', user.id);
        }
        return {
            room_id: room.id,
            licence_state: licenceView(room.institute_id).roomState(room.id),
        };
    }

    function adminSeatRelease(ctx) {
        const { user, room } = adminRoomForSeat(ctx);
        releaseSeat(room, 'ADMIN', user.id);
        return { room_id: room.id, licence_state: 'UNLICENSED' };
    }

    // ----------------------------------------------------------- approvals ---

    function adminDeviceForApproval(ctx) {
        const user = requireUser(ctx);
        // As the service: no feature switch, so panels already waiting can still be settled
        // after installers are switched off.
        const device = db.devices.get(ctx.params.id);
        if (!device) throw new ApiError(404, 'NOT_FOUND', 'No such panel');
        requireInstituteAdmin(user, device.institute_id);
        return { user, device };
    }

    function adminDeviceApprove(ctx) {
        const { user, device } = adminDeviceForApproval(ctx);
        if (!isLiveDevice(device)) {
            throw new ApiError(409, 'DEVICE_NOT_ACTIVE', 'This panel was removed');
        }
        if (device.approval_state === 'PENDING') {
            device.approval_state = 'APPROVED';
            device.approved_by = user.id;
            device.approved_at = now();
            trySeat(device, 'AUTO_APPROVE');
        }
        return deviceRow(device);
    }

    function adminDeviceReject(ctx) {
        const { user, device } = adminDeviceForApproval(ctx);
        if (device.approval_state === 'REJECTED') return { status: 'REVOKED' };
        if (device.approval_state !== 'PENDING' || !isLiveDevice(device)) {
            throw new ApiError(
                400,
                'BAD_REQUEST',
                'Only a panel waiting for approval can be rejected'
            );
        }
        revokeDevice(device, user.id);
        device.approval_state = 'REJECTED';
        return { status: 'REVOKED' };
    }

    // ------------------------------------------------------------ activity ---

    const hasControlChars = (value) =>
        [...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

    /** As PanelActivityRecorder: an id that is too long or carries control characters becomes null. */
    function cleanRef(value) {
        if (typeof value !== 'string') return null;
        if (value.length > ACTIVITY_REF_MAX || hasControlChars(value)) return null;
        return value;
    }

    /**
     * PanelActivityIngest: at most 20 events a request and 100 a session, unknown kinds dropped,
     * bad ids cleared to null, replays ignored (session_id, client_seq). The ack is the largest seq the
     * request carried, so the panel drops what was ignored too. Null when no event had a seq.
     */
    function ingestActivity(device, session, events) {
        if (!Array.isArray(events) || events.length === 0) return null;
        let ack = null;
        for (const event of events) {
            const seq = event && typeof event === 'object' ? event.seq : undefined;
            if (Number.isInteger(seq) && seq >= 0 && seq <= 2147483647) {
                ack = ack === null ? seq : Math.max(ack, seq);
            }
        }
        const t = now();
        const stored = db.activity.filter((row) => row.session_id === session.id);
        const seen = new Set(stored.map((row) => row.client_seq));
        let count = stored.length;
        for (const event of events.slice(0, ACTIVITY_PER_REQUEST)) {
            if (count >= ACTIVITY_PER_SESSION) break;
            if (!event || typeof event !== 'object') continue;
            const seq = event.seq;
            if (!Number.isInteger(seq) || seq < 0 || seq > 2147483647 || seen.has(seq)) continue;
            if (!ACTIVITY_KINDS.has(event.kind)) continue;
            const at = Number.isFinite(event.at_ms) ? event.at_ms : t;
            db.activityId += 1;
            db.activity.push({
                id: db.activityId,
                session_id: session.id,
                device_id: device.id,
                institute_id: session.institute_id,
                room_id: session.room_id,
                user_id: session.user_id,
                client_seq: seq,
                kind: event.kind,
                ref_id: cleanRef(event.ref_id),
                parent_id: cleanRef(event.parent_id),
                title:
                    typeof event.title === 'string'
                        ? event.title.slice(0, ACTIVITY_TITLE_MAX)
                        : null,
                started_at: Math.min(Math.max(at, session.created_at), t),
                created_at: t,
            });
            seen.add(seq);
            count += 1;
        }
        return ack;
    }

    // --------------------------------------------------------------- usage ---

    /**
     * Effective end: LEAST(ended_at or now, panel_seen_at + 90 s, active_until). An abandoned
     * session is ended only when something next looks at it, so ended_at alone over-counts.
     */
    function effectiveEnd(session) {
        let end = session.ended_at ?? now();
        if (session.panel_seen_at !== null)
            end = Math.min(end, session.panel_seen_at + PANEL_ONLINE_MS);
        if (session.active_until != null) end = Math.min(end, session.active_until);
        // As PanelUsageMath: never later than the session cap either.
        if (typeof session.expires_at === 'number') end = Math.min(end, session.expires_at);
        return Math.max(end, session.created_at);
    }

    /** Listed events with durations: each lasts until the next one, or the session's end, at most 4 h. */
    function sessionEvents(session, endAt) {
        const rows = db.activity
            .filter((row) => row.session_id === session.id)
            .sort((x, y) => x.started_at - y.started_at || x.client_seq - y.client_seq);
        const out = [];
        rows.forEach((row, index) => {
            const next = rows[index + 1];
            const until = next ? next.started_at : Math.max(endAt, row.started_at);
            if (row.kind === 'HOME') return;
            out.push({ row, ms: Math.min(Math.max(0, until - row.started_at), CONTENT_CAP_MS) });
        });
        return { all: rows, listed: out };
    }

    function usageWindow(query) {
        const from = query.get('from');
        const to = query.get('to');
        if (!isLocalDate(from) || !isLocalDate(to)) {
            throw new ApiError(400, 'BAD_REQUEST', 'from and to must be yyyy-MM-dd dates');
        }
        const span = dayNumber(to) - dayNumber(from) + 1;
        if (span < 1 || span > config.usage_max_days) {
            throw new ApiError(
                400,
                'BAD_REQUEST',
                `The range must be 1 to ${config.usage_max_days} days`
            );
        }
        const tz = validZone(query.get('tz'));
        return {
            from,
            to,
            tz,
            start: localMidnight(from, tz),
            end: localMidnight(addDays(to, 1), tz),
        };
    }

    /** Counted sessions: seen by the panel at least once (redeem marks it seen). */
    const countedSessions = (filter) =>
        [...db.sessions.values()].filter((s) => s.panel_seen_at !== null && filter(s));

    function usageRows(instituteId, window) {
        return countedSessions(
            (s) =>
                s.institute_id === instituteId &&
                s.created_at >= window.start &&
                s.created_at < window.end
        ).map((session) => {
            const endAt = effectiveEnd(session);
            return {
                session,
                endAt,
                ms: Math.max(0, Math.min(endAt, window.end) - session.created_at),
                date: localDate(session.created_at, window.tz),
                events: sessionEvents(session, endAt),
            };
        });
    }

    function contentGroups(rows, cap, full) {
        const groups = new Map();
        for (const row of rows) {
            for (const { row: event, ms } of row.events.listed) {
                const key = `${event.kind}|${event.ref_id ?? `title:${event.title ?? ''}`}`;
                let group = groups.get(key);
                if (!group) {
                    group = {
                        kind: event.kind,
                        ref_id: event.ref_id,
                        title: null,
                        titleAt: -1,
                        ms: 0,
                        sessions: new Set(),
                        teachers: new Set(),
                    };
                    groups.set(key, group);
                }
                group.ms += ms;
                if (event.started_at >= group.titleAt) {
                    group.title = event.title;
                    group.titleAt = event.started_at;
                }
                group.sessions.add(row.session.id);
                group.teachers.add(row.session.user_id);
            }
        }
        return [...groups.values()]
            .sort((x, y) => y.ms - x.ms)
            .slice(0, cap)
            .map((g) =>
                full
                    ? {
                          kind: g.kind,
                          ref_id: g.ref_id,
                          title: g.title,
                          minutes: minutesOf(g.ms),
                          sessions: g.sessions.size,
                          teachers: g.teachers.size,
                      }
                    : { kind: g.kind, title: g.title, minutes: minutesOf(g.ms) }
            );
    }

    function computeUsage(instituteId, window) {
        const t = now();
        const rows = usageRows(instituteId, window);
        const sumMs = (list) => list.reduce((total, row) => total + row.ms, 0);
        const distinct = (list, pick) => new Set(list.map(pick)).size;

        const panelRooms = activeRooms(instituteId)
            .map((room) => ({ room, device: liveDeviceInRoom(room.id) }))
            .filter(({ device }) => device && isApproved(device));
        const usedRooms = new Set(rows.map((row) => row.session.room_id));
        const idle = panelRooms
            .filter(({ room }) => !usedRooms.has(room.id))
            .map(({ room, device }) => {
                // As the real report: the start of the panel's last counted session.
                const before = countedSessions((s) => s.device_id === device.id).map(
                    (s) => s.created_at
                );
                return {
                    room: { id: room.id, name: room.name },
                    device_id: device.id,
                    last_used_at: before.length ? iso(Math.max(...before)) : null,
                    online:
                        device.last_seen_at !== null && t - device.last_seen_at < DEVICE_ONLINE_MS,
                };
            });

        const withEvents = rows.filter((row) => row.events.all.length > 0).length;
        const classes = rows.reduce(
            (total, row) => total + row.events.all.filter((e) => e.kind === 'CLASS').length,
            0
        );
        const totals = {
            panel_hours: hours1(sumMs(rows)),
            sessions: rows.length,
            teachers: distinct(rows, (row) => row.session.user_id),
            rooms_used: usedRooms.size,
            rooms_with_panel: panelRooms.length,
            idle_rooms: idle.length,
            classes_started: classes,
            coverage_pct: rows.length ? Math.round((100 * withEvents) / rows.length) : null,
        };

        const byDay = [];
        for (
            let date = window.from;
            dayNumber(date) <= dayNumber(window.to);
            date = addDays(date, 1)
        ) {
            const day = rows.filter((row) => row.date === date);
            byDay.push({
                date,
                panel_hours: hours1(sumMs(day)),
                sessions: day.length,
                rooms_used: distinct(day, (row) => row.session.room_id),
            });
        }

        const groupBy = (pick) => {
            const map = new Map();
            for (const row of rows) {
                const key = pick(row);
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(row);
            }
            return [...map.entries()];
        };
        const withoutSortKey = (row) => {
            const copy = { ...row };
            delete copy.ms;
            return copy;
        };
        const byRoom = groupBy((row) => row.session.room_id)
            .map(([roomId, list]) => ({
                room: roomRef(roomId),
                panel_hours: hours1(sumMs(list)),
                sessions: list.length,
                teachers: distinct(list, (row) => row.session.user_id),
                last_used_at: iso(Math.max(...list.map((row) => row.session.created_at))),
                days_used: distinct(list, (row) => row.date),
                ms: sumMs(list),
            }))
            .sort((x, y) => y.ms - x.ms)
            .map(withoutSortKey);
        const byTeacher = groupBy((row) => row.session.user_id)
            .map(([userId, list]) => ({
                user: userRef(userId),
                panel_hours: hours1(sumMs(list)),
                sessions: list.length,
                rooms: distinct(list, (row) => row.session.room_id),
                days_active: distinct(list, (row) => row.date),
                top_content: contentGroups(list, 3, false),
                ms: sumMs(list),
            }))
            .sort((x, y) => y.ms - x.ms)
            .map(withoutSortKey);

        const recorded = db.activity.filter((row) => row.institute_id === instituteId);
        const firstRecorded = recorded.length
            ? Math.min(...recorded.map((row) => row.started_at))
            : null;
        return {
            institute_id: instituteId,
            from: window.from,
            to: window.to,
            tz: window.tz,
            generated_at: iso(t),
            totals,
            by_day: byDay,
            by_room: byRoom,
            by_teacher: byTeacher,
            idle_rooms: idle,
            content: contentGroups(rows, 20, true),
            notes: {
                content_recorded_from:
                    firstRecorded === null ? null : localDate(firstRecorded, window.tz),
            },
        };
    }

    function usage(ctx) {
        const user = requireUser(ctx);
        requireFeature('usage_enabled');
        const instituteId = ctx.query.get('institute_id');
        requireInstituteAdmin(user, instituteId);
        return computeUsage(instituteId, usageWindow(ctx.query));
    }

    function usageSessions(ctx) {
        const user = requireUser(ctx);
        requireFeature('usage_enabled');
        const instituteId = ctx.query.get('institute_id');
        requireInstituteAdmin(user, instituteId);
        const window = usageWindow(ctx.query);
        const roomId = ctx.query.get('room_id');
        const userId = ctx.query.get('user_id');
        const page = Math.max(0, parseInt(ctx.query.get('page') ?? '0', 10) || 0);
        const size = Math.min(
            USAGE_SESSIONS_MAX_SIZE,
            Math.max(1, parseInt(ctx.query.get('size') ?? '50', 10) || 50)
        );
        const rows = usageRows(instituteId, window)
            .filter((row) => !roomId || row.session.room_id === roomId)
            .filter((row) => !userId || row.session.user_id === userId)
            .sort((x, y) => y.session.created_at - x.session.created_at);
        return {
            sessions: rows.slice(page * size, page * size + size).map((row) => ({
                id: row.session.id,
                room: roomRef(row.session.room_id),
                user: userRef(row.session.user_id),
                started_at: iso(row.session.created_at),
                end_at: iso(row.endAt),
                minutes: minutesOf(row.endAt - row.session.created_at),
                end_reason: row.session.end_reason,
                started_via: row.session.started_via,
                events: row.events.listed.map(({ row: event, ms }) => ({
                    kind: event.kind,
                    title: event.title,
                    started_at: iso(event.started_at),
                    minutes: minutesOf(ms),
                })),
            })),
            page,
            size,
            total: rows.length,
        };
    }

    function usageMulti(ctx) {
        const user = requireUser(ctx);
        requireFeature('usage_enabled');
        const ids = [
            ...new Set(
                String(ctx.query.get('institute_ids') ?? '')
                    .split(',')
                    .map((id) => id.trim())
                    .filter(Boolean)
            ),
        ];
        if (ids.length === 0 || ids.length > USAGE_MULTI_MAX) {
            throw new ApiError(400, 'BAD_REQUEST', `Give 1 to ${USAGE_MULTI_MAX} institute ids`);
        }
        // ADMIN in every listed institute, or nothing.
        ids.forEach((id) => requireInstituteAdmin(user, id));
        const window = usageWindow(ctx.query);
        return ids.map((id) => ({ institute_id: id, totals: computeUsage(id, window).totals }));
    }

    /** Internal summary for the weekly report: lists capped, rooms worst first. */
    function usageSummary(ctx) {
        requireFeature('usage_enabled');
        const instituteId = ctx.query.get('institute_id');
        if (!instituteId) throw new ApiError(400, 'BAD_REQUEST', 'institute_id is required');
        const full = computeUsage(instituteId, usageWindow(ctx.query));
        const roomsAscending = [...full.by_room].sort((x, y) => x.panel_hours - y.panel_hours);
        return {
            ...full,
            by_room: roomsAscending.slice(0, 15),
            idle_rooms: full.idle_rooms.slice(0, 10),
            by_teacher: full.by_teacher.slice(0, 10),
            content: full.content.slice(0, 5),
        };
    }

    // ------------------------------------------------------------ releases ---

    const deviceChannel = (device) => device.app_channel ?? 'DIRECT';
    const liveReleases = (channel) =>
        [...db.releases.values()].filter((r) => r.channel === channel && r.status === 'LIVE');

    /** Null while releases are off: the floor is then panel.min-app-version-code and not enforced. */
    function requiredVersionCode(device) {
        if (!config.releases_enabled) return null;
        let floor = config.min_app_version_code;
        for (const release of liveReleases(deviceChannel(device))) {
            if (release.required) floor = Math.max(floor, release.version_code);
        }
        return floor;
    }

    /** An unknown version is never refused by the floor: it cannot be shown to be below it. */
    function belowFloor(device) {
        const floor = requiredVersionCode(device);
        return (
            floor !== null &&
            typeof device.app_version_code === 'number' &&
            device.app_version_code < floor
        );
    }

    /** floorMod(first 4 bytes of sha256(device_id) as a signed int, 100). */
    function rolloutBucket(deviceId) {
        const digest = crypto.createHash('sha256').update(String(deviceId), 'utf8').digest();
        return ((digest.readInt32BE(0) % 100) + 100) % 100;
    }

    /**
     * Signed-out offer for a direct-channel panel, as PanelReleaseService.syncBlock: the highest
     * offerable build in this panel's rollout (a required build ignores rollout). A panel below the
     * floor with nothing in rollout that lifts it gets the smallest build that does. An unknown
     * version or SDK gets nothing.
     */
    function updateOffer(device) {
        if (!config.releases_enabled || deviceChannel(device) !== 'DIRECT') return null;
        if (typeof device.sdk_int !== 'number' || typeof device.app_version_code !== 'number') {
            return null;
        }
        const current = device.app_version_code;
        const floor = requiredVersionCode(device);
        const below = current < floor;
        const bucket = rolloutBucket(device.id);
        const offerable = liveReleases('DIRECT').filter(
            (r) =>
                r.version_code > current &&
                r.min_sdk <= device.sdk_int &&
                r.sha256 !== null &&
                Number.isInteger(r.size_bytes) &&
                r.size_bytes > 0 &&
                typeof r.apk_url === 'string' &&
                r.apk_url.startsWith('https://')
        );
        let best = offerable
            .filter((r) => r.required || bucket < r.rollout_percent)
            .reduce((top, r) => (!top || r.version_code > top.version_code ? r : top), null);
        if (below && (!best || best.version_code < floor)) {
            const lift = offerable
                .filter((r) => r.version_code >= floor)
                .reduce((low, r) => (!low || r.version_code < low.version_code ? r : low), null);
            if (lift) best = lift;
        }
        if (!best) return null;
        return {
            version_code: best.version_code,
            version_name: best.version_name,
            apk_url: best.apk_url,
            sha256: best.sha256,
            size_bytes: best.size_bytes,
            required: below,
        };
    }

    const releaseRow = (r) => ({
        id: r.id,
        channel: r.channel,
        version_code: r.version_code,
        version_name: r.version_name,
        apk_url: r.apk_url,
        sha256: r.sha256,
        size_bytes: r.size_bytes,
        min_sdk: r.min_sdk,
        rollout_percent: r.rollout_percent,
        required: r.required,
        status: r.status,
        notes: r.notes,
        created_by: r.created_by,
        created_at: iso(r.created_at),
        published_at: iso(r.published_at),
        package_name: r.channel === 'DIRECT' ? config.release_package_name : null,
        signing_cert_sha256: r.channel === 'DIRECT' ? config.release_signing_cert_sha256 : null,
    });

    const normaliseDigest = (value) => {
        const hex = String(value ?? '')
            .trim()
            .toLowerCase()
            .replace(/:/g, '');
        return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
    };

    function releaseFromBody(body, createdBy) {
        const bad = (message) => new ApiError(400, 'BAD_REQUEST', message);
        if (body.channel !== 'PLAY' && body.channel !== 'DIRECT')
            throw bad('channel is PLAY or DIRECT');
        if (!Number.isInteger(body.version_code) || body.version_code < 1) {
            throw bad('version_code must be a positive whole number');
        }
        const name = String(body.version_name ?? '').trim();
        if (!name || name.length > 32) throw bad('version_name must be 1 to 32 characters');
        if (
            body.apk_url != null &&
            (typeof body.apk_url !== 'string' ||
                body.apk_url.length > 500 ||
                !body.apk_url.startsWith('https://'))
        ) {
            throw bad('apk_url must be an https URL');
        }
        if (body.sha256 != null && !/^[0-9a-f]{64}$/.test(String(body.sha256))) {
            throw bad('sha256 must be 64 lower-case hex characters');
        }
        if (body.channel === 'DIRECT') {
            // As the real registry: a direct build needs its link, digest, size and the pinned identity.
            if (body.apk_url == null) throw bad('apk_url must be an https link on an allowed host');
            if (body.sha256 == null) throw bad("sha256 must be the file's SHA-256 in hex");
            if (!Number.isInteger(body.size_bytes) || body.size_bytes < 1) {
                throw bad('size_bytes is out of range');
            }
            if (String(body.package_name ?? '').trim() !== config.release_package_name) {
                throw bad('package_name does not match the direct build');
            }
            if (normaliseDigest(body.signing_cert_sha256) !== config.release_signing_cert_sha256) {
                throw bad('signing_cert_sha256 does not match the direct signing certificate');
            }
        } else if (body.apk_url != null) {
            throw bad('PLAY releases carry no apk_url');
        }
        const rollout = body.rollout_percent ?? 0;
        if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100)
            throw bad('rollout_percent is 0 to 100');
        const minSdk = body.min_sdk ?? 24;
        if (!Number.isInteger(minSdk) || minSdk < 1)
            throw bad('min_sdk must be a positive whole number');
        if (
            [...db.releases.values()].some(
                (r) => r.channel === body.channel && r.version_code === body.version_code
            )
        ) {
            throw new ApiError(
                409,
                'RELEASE_EXISTS',
                'This channel already has a release with that version code'
            );
        }
        return {
            id: uuid(),
            channel: body.channel,
            version_code: body.version_code,
            version_name: name,
            apk_url: body.apk_url ?? null,
            sha256: body.sha256 ?? null,
            size_bytes: Number.isInteger(body.size_bytes) ? body.size_bytes : null,
            min_sdk: minSdk,
            rollout_percent: rollout,
            required: body.required === true,
            status: 'DRAFT',
            notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : null,
            created_by: createdBy,
            created_at: now(),
            published_at: null,
        };
    }

    function patchRelease(release, body) {
        const bad = (message) => new ApiError(400, 'BAD_REQUEST', message);
        if (body.status !== undefined && !['DRAFT', 'LIVE', 'PULLED'].includes(body.status)) {
            throw bad('status is DRAFT, LIVE or PULLED');
        }
        if (
            body.rollout_percent !== undefined &&
            (!Number.isInteger(body.rollout_percent) ||
                body.rollout_percent < 0 ||
                body.rollout_percent > 100)
        ) {
            throw bad('rollout_percent is 0 to 100');
        }
        if (body.required !== undefined && typeof body.required !== 'boolean')
            throw bad('required is true or false');
        const status = body.status ?? release.status;
        const required = body.required ?? release.required;
        const raisesFloor =
            status === 'LIVE' &&
            required &&
            release.channel === 'DIRECT' &&
            !(release.status === 'LIVE' && release.required);
        if (raisesFloor && body.force_floor !== true) {
            // As the service: panels this build cannot reach would be held below the floor.
            const stranded = [...db.devices.values()].filter(
                (d) =>
                    d.status === 'ACTIVE' &&
                    isApproved(d) &&
                    (d.app_channel || 'DIRECT') === 'DIRECT' &&
                    typeof d.app_version_code === 'number' &&
                    d.app_version_code < release.version_code &&
                    (typeof d.sdk_int !== 'number' ||
                        d.sdk_int < release.min_sdk ||
                        d.app_version_code < FIRST_PHASE2_VERSION_CODE)
            ).length;
            if (stranded > 0) {
                throw new ApiError(
                    409,
                    'FLOOR_WITHOUT_UPDATE',
                    `${stranded} panels below this build cannot be offered it; send force_floor to go ahead`,
                    { panels: stranded }
                );
            }
        }
        if (body.status !== undefined) {
            release.status = body.status;
            if (body.status === 'LIVE' && release.published_at === null)
                release.published_at = now();
        }
        if (body.rollout_percent !== undefined) release.rollout_percent = body.rollout_percent;
        if (body.required !== undefined) release.required = body.required;
        return release;
    }

    // --------------------------------------------------------------- fleet ---

    /** Start of the oldest of the last N school days (Mon to Sat, today included), in the zone. */
    function schoolDaysStart(t, days, zone) {
        let date = localDate(t, zone);
        let counted = 0;
        for (let i = 0; i < 400; i += 1) {
            if (weekdayOf(date) !== 0) {
                counted += 1;
                if (counted >= days) break;
            }
            date = addDays(date, -1);
        }
        return localMidnight(date, zone);
    }

    const SEVERITY_RANK = { bad: 0, warn: 1, info: 2 };

    function fleet(instituteId) {
        const t = now();
        const alerts = [];
        const view = config.licence_enabled ? licenceView(instituteId) : null;
        const managed = view !== null && view.enforcement !== 'OFF';
        const offlineMs = config.alerts_offline_hours * HOUR;
        const unusedStart = schoolDaysStart(t, config.alerts_unused_days, USAGE_ZONE);
        const devices = [...db.devices.values()].filter(
            (d) => d.institute_id === instituteId && isLiveDevice(d)
        );
        for (const d of devices) {
            const room = roomRef(d.room_id);
            const push = (kind, severity, since, key, detail) =>
                alerts.push({
                    kind,
                    severity,
                    device_id: d.id,
                    room,
                    since: iso(since),
                    incident_key: String(key),
                    detail,
                });
            const approved = isApproved(d);
            if (d.status === 'ACTIVE' && approved) {
                const seen = d.last_seen_at ?? d.confirmed_at;
                if (seen !== null && seen < t - offlineMs) {
                    push(
                        'OFFLINE',
                        t - seen > OFFLINE_BAD_MS ? 'bad' : 'warn',
                        seen,
                        Math.floor(seen / 1000),
                        {
                            last_seen_at: iso(d.last_seen_at),
                            app_version_code: d.app_version_code,
                        }
                    );
                }
            }
            if (d.status === 'CLAIMED' && d.claimed_at < t - NOT_CONFIRMED_MS) {
                push('NOT_CONFIRMED', 'warn', d.claimed_at, Math.floor(d.claimed_at / 1000), {
                    claimed_at: iso(d.claimed_at),
                });
            }
            if (d.approval_state === 'PENDING') {
                push('AWAITING_APPROVAL', 'warn', d.claimed_at, d.id, {
                    installed_by: partnerNameOf(d),
                });
            }
            // As PanelFleetService: the floor only exists while releases are on.
            const floor = requiredVersionCode(d);
            if (
                floor !== null &&
                typeof d.app_version_code === 'number' &&
                d.app_version_code < floor
            ) {
                push('UPDATE_REQUIRED', 'bad', null, floor, {
                    app_version_code: d.app_version_code,
                    required_version_code: floor,
                });
            }
            if (config.releases_enabled && typeof d.app_version_code === 'number') {
                const outdatedBy = t - config.alerts_outdated_days * DAY;
                const newer = liveReleases(deviceChannel(d))
                    .filter(
                        (r) =>
                            r.version_code > d.app_version_code &&
                            r.published_at !== null &&
                            r.published_at <= outdatedBy
                    )
                    .reduce(
                        (top, r) => (!top || r.version_code > top.version_code ? r : top),
                        null
                    );
                if (newer) {
                    push('APP_OUTDATED', 'info', newer.published_at, newer.version_code, {
                        app_version_code: d.app_version_code,
                        latest_version_code: newer.version_code,
                    });
                }
            }
            const warnMajor = config.alerts_webview_warn_major;
            if (
                warnMajor > 0 &&
                typeof d.webview_major === 'number' &&
                d.webview_major < warnMajor
            ) {
                push(
                    'WEBVIEW_OLD',
                    d.app_channel === 'PLAY' ? 'warn' : 'info',
                    null,
                    d.webview_major,
                    {
                        webview_major: d.webview_major,
                    }
                );
            }
            const settledBefore = (d.confirmed_at ?? d.claimed_at) < unusedStart;
            if (
                d.status === 'ACTIVE' &&
                approved &&
                settledBefore &&
                d.last_seen_at !== null &&
                d.last_seen_at >= unusedStart
            ) {
                const counted = countedSessions((s) => s.device_id === d.id);
                if (!counted.some((s) => s.created_at >= unusedStart)) {
                    const last = counted.reduce(
                        (top, s) => (!top || s.created_at > top.created_at ? s : top),
                        null
                    );
                    push(
                        'UNUSED',
                        'warn',
                        last ? effectiveEnd(last) : d.confirmed_at,
                        last ? last.id : 'none',
                        {
                            last_used_at: last ? iso(effectiveEnd(last)) : null,
                        }
                    );
                }
            }
            if (managed && approved) {
                const state = view.roomState(d.room_id);
                if (state === 'OVER_LIMIT' || state === 'UNLICENSED') {
                    const licensedAt = db.rooms.get(d.room_id)?.licensed_at ?? null;
                    push(
                        'LICENCE_ROOM',
                        'warn',
                        null,
                        `${state}:${licensedAt === null ? '' : Math.floor(licensedAt / 1000)}`,
                        {
                            licence_state: state,
                        }
                    );
                }
            }
        }
        if (managed) {
            const ending =
                ((view.state === 'ACTIVE' || view.state === 'TRIAL') &&
                    view.endsAt !== null &&
                    view.endsAt - t <= LICENCE_ENDING_MS) ||
                view.state === 'GRACE';
            if (ending) {
                const grace = view.state === 'GRACE';
                const grantKey = view.endingGrantId == null ? 'none' : String(view.endingGrantId);
                alerts.push({
                    kind: 'LICENCE_ENDING',
                    severity: 'warn',
                    device_id: null,
                    room: null,
                    // In grace the key changes, so a digest notices the move into grace.
                    since: grace ? iso(view.endsAt) : null,
                    incident_key: grace ? `GRACE:${grantKey}` : grantKey,
                    detail: {
                        state: view.state,
                        ends_at: iso(view.endsAt),
                        grace_ends_at: iso(view.graceEndsAt),
                    },
                });
            }
        }
        alerts.sort(
            (x, y) =>
                SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
                x.kind.localeCompare(y.kind)
        );
        const counts = {};
        for (const alert of alerts) counts[alert.kind] = (counts[alert.kind] ?? 0) + 1;
        return { generated_at: iso(t), counts, alerts };
    }

    function adminFleet(ctx) {
        const user = requireUser(ctx);
        requireFeature('fleet_enabled');
        const instituteId = ctx.query.get('institute_id');
        requireInstituteAdmin(user, instituteId);
        return fleet(instituteId);
    }

    // ----------------------------------------------------------- installers ---

    /** An ACTIVE installer role at an ACTIVE partner's own institute. JWT authorities are not read. */
    function installerPartner(user) {
        const roles = new Set(config.installer_roles.map((role) => String(role).toUpperCase()));
        for (const partner of db.partners.values()) {
            if (partner.status !== 'ACTIVE') continue;
            const held = (user.roles[partner.partner_institute_id] ?? []).some(
                ([name, status]) => status === 'ACTIVE' && roles.has(String(name).toUpperCase())
            );
            if (held) return partner;
        }
        return null;
    }

    function requireInstaller(user) {
        const partner = installerPartner(user);
        if (!partner) throw new ApiError(403, 'NOT_INSTALLER', 'This account is not an installer');
        return partner;
    }

    const activeLink = (partnerId, instituteId) =>
        [...db.links.values()].find(
            (l) =>
                l.partner_id === partnerId &&
                l.institute_id === instituteId &&
                l.status === 'ACTIVE'
        );

    function requireLinked(partner, instituteId) {
        const link = instituteId ? activeLink(partner.id, instituteId) : null;
        if (!link)
            throw new ApiError(
                403,
                'NOT_INSTALLER',
                'This school has not linked your organisation'
            );
        return link;
    }

    /** The school name is filled in the background, as directory.refreshLinkAsync does. */
    function fillLinkNameLater(link) {
        setImmediate(() => {
            link.institute_name = db.institutes.get(link.institute_id)?.name ?? null;
        });
    }

    function linkOrExtend(partnerId, instituteId, via, installUntil, createdBy) {
        const existing = activeLink(partnerId, instituteId);
        if (existing) {
            if (existing.install_until !== null) {
                existing.install_until =
                    installUntil === null ? null : Math.max(existing.install_until, installUntil);
            }
            return existing;
        }
        const link = {
            id: uuid(),
            partner_id: partnerId,
            institute_id: instituteId,
            institute_name: null,
            status: 'ACTIVE',
            linked_via: via,
            install_until: installUntil,
            created_by: createdBy,
            created_at: now(),
            revoked_by: null,
            revoked_at: null,
        };
        db.links.set(link.id, link);
        fillLinkNameLater(link);
        return link;
    }

    function partnerMe(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        const partner = requireInstaller(user);
        return { partner: { id: partner.id, name: partner.name } };
    }

    function partnerRedeem(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        rateLimit('link_redeem', user.id);
        const partner = requireInstaller(user);
        const hash = crypto.createHash('sha256').update(normaliseCode(ctx.body.code)).digest('hex');
        const t = now();
        const invite = [...db.invites.values()].find((i) => i.code_hash === hash);
        if (!invite || invite.state !== 'PENDING' || invite.expires_at <= t) {
            throw new ApiError(404, 'INVITE_INVALID', 'This code is not valid');
        }
        invite.state = 'USED';
        invite.used_by_partner_id = partner.id;
        invite.used_at = t;
        const link = linkOrExtend(
            partner.id,
            invite.institute_id,
            'SCHOOL_CODE',
            t + invite.install_days * DAY,
            user.id
        );
        return {
            link_id: link.id,
            institute_id: link.institute_id,
            institute_name: link.institute_name,
            install_until: iso(link.install_until),
        };
    }

    function partnerCustomers(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        const partner = requireInstaller(user);
        return [...db.links.values()]
            .filter((l) => l.partner_id === partner.id && l.status === 'ACTIVE')
            .map((l) => ({
                institute_id: l.institute_id,
                institute_name: l.institute_name,
                install_until: iso(l.install_until),
            }));
    }

    function partnerRooms(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        const partner = requireInstaller(user);
        const instituteId = ctx.query.get('institute_id');
        requireLinked(partner, instituteId);
        return activeRooms(instituteId)
            .sort((x, y) => x.name.localeCompare(y.name))
            .map((room) => ({
                id: room.id,
                name: room.name,
                has_panel: !!liveDeviceInRoom(room.id),
            }));
    }

    /** The admin claim for installers: never replaces, lands PENDING, attributes the room. */
    function partnerClaim(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        rateLimit('claim', user.id);
        const body = ctx.body;
        if (!config.directory_available) {
            throw new ApiError(503, 'TRY_AGAIN', 'Please try again in a moment');
        }
        const partner = requireInstaller(user);
        const link = requireLinked(partner, body.institute_id);
        if (link.install_until !== null && link.install_until <= now()) {
            throw new ApiError(
                403,
                'NOT_INSTALLER',
                'This school has not linked your organisation'
            );
        }
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
        if (existingRoom && liveDeviceInRoom(existingRoom.id)) {
            throw new ApiError(
                409,
                'ROOM_OCCUPIED',
                'Ask the school to remove the old panel first'
            );
        }
        const room = existingRoom ?? createRoom(body.institute_id, body.new_room_name, user.id);
        if (!room.partner_id) room.partner_id = partner.id; // sticky attribution
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
            approval_state: 'PENDING',
            installed_by_partner_id: partner.id,
            approved_by: null,
            approved_at: null,
            app_channel: null,
        };
        db.devices.set(device.id, device);
        pairing.state = 'CLAIMED';
        pairing.device_id = device.id;
        return { device_id: device.id, status: 'CLAIMED', room: { id: room.id, name: room.name } };
    }

    /** Health only, for panels this installer set up: no teachers, no usage, no sessions. */
    function partnerInstalls(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        const partner = requireInstaller(user);
        const instituteId = ctx.query.get('institute_id');
        requireLinked(partner, instituteId);
        const t = now();
        return [...db.devices.values()]
            .filter(
                (d) => d.institute_id === instituteId && d.installed_by_partner_id === partner.id
            )
            .map((d) => ({
                device_id: d.id,
                room: roomRef(d.room_id),
                status: d.status,
                approval_state: d.approval_state ?? 'APPROVED',
                online: d.last_seen_at !== null && t - d.last_seen_at < DEVICE_ONLINE_MS,
                last_seen_at: iso(d.last_seen_at),
                app_version_code: d.app_version_code,
                webview_major: d.webview_major,
            }));
    }

    function adminPartners(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        const instituteId = ctx.query.get('institute_id');
        requireInstituteAdmin(user, instituteId);
        return [...db.links.values()]
            .filter((l) => l.institute_id === instituteId && l.status === 'ACTIVE')
            .map((l) => ({
                link_id: l.id,
                partner_name: db.partners.get(l.partner_id)?.name ?? null,
                linked_via: l.linked_via,
                install_until: iso(l.install_until),
                created_at: iso(l.created_at),
                installs: [...db.devices.values()].filter(
                    (d) =>
                        d.institute_id === instituteId &&
                        d.installed_by_partner_id === l.partner_id &&
                        isLiveDevice(d)
                ).length,
            }));
    }

    function adminInviteCreate(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        const { institute_id: instituteId, install_days: days } = ctx.body;
        requireInstituteAdmin(user, instituteId);
        if (!Number.isInteger(days) || days < 1 || days > INVITE_INSTALL_DAYS_MAX) {
            throw new ApiError(
                400,
                'BAD_REQUEST',
                `install_days is 1 to ${INVITE_INSTALL_DAYS_MAX}`
            );
        }
        const code = randomCode();
        const t = now();
        const invite = {
            id: uuid(),
            institute_id: instituteId,
            code_hash: crypto.createHash('sha256').update(code).digest('hex'),
            state: 'PENDING',
            install_days: days,
            expires_at: t + INVITE_TTL_MS,
            created_by: user.id,
            created_at: t,
            used_by_partner_id: null,
            used_at: null,
        };
        db.invites.set(invite.id, invite);
        return { id: invite.id, code, expires_at: iso(invite.expires_at) };
    }

    function adminInviteCancel(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        const invite = db.invites.get(ctx.params.id);
        if (!invite) throw new ApiError(404, 'INVITE_INVALID', 'This code is not valid');
        requireInstituteAdmin(user, invite.institute_id);
        if (invite.state === 'PENDING') invite.state = 'CANCELLED';
        if (invite.state !== 'CANCELLED') {
            throw new ApiError(404, 'INVITE_INVALID', 'This code is not valid');
        }
        return { status: 'CANCELLED' };
    }

    function revokeLink(link, by) {
        if (link.status === 'ACTIVE') {
            link.status = 'REVOKED';
            link.revoked_by = by;
            link.revoked_at = now();
        }
        return { status: 'REVOKED' };
    }

    function adminPartnerRevoke(ctx) {
        const user = requireUser(ctx);
        requireFeature('partners_enabled');
        const link = db.links.get(ctx.params.id);
        if (!link) throw new ApiError(404, 'NOT_FOUND', 'No such link');
        requireInstituteAdmin(user, link.institute_id);
        // Pending installs stay pending for the school to decide.
        return revokeLink(link, user.id);
    }

    // ------------------------------------------------------ platform staff ---

    function requireSuperAdmin(ctx, feature) {
        const user = requireUser(ctx);
        if (!(config.super_admin_user_ids ?? []).includes(user.id)) {
            throw new ApiError(403, 'FORBIDDEN', 'Super admin access required');
        }
        requireFeature(feature);
        return user;
    }

    function superEnforcement(ctx) {
        const user = requireSuperAdmin(ctx, 'licence_enabled');
        const instituteId = ctx.params.id;
        if (ctx.req.method === 'PUT') {
            const value = String(ctx.body.enforcement ?? '').toUpperCase();
            if (!['OFF', 'SHADOW', 'LIVE'].includes(value)) {
                throw new ApiError(400, 'BAD_REQUEST', 'enforcement is OFF, SHADOW or LIVE');
            }
            db.licenceSettings.set(instituteId, {
                enforcement: value,
                updated_by: user.id,
                updated_at: now(),
            });
        }
        return { institute_id: instituteId, enforcement: licenceView(instituteId).enforcement };
    }

    function superLicence(ctx) {
        requireSuperAdmin(ctx, 'licence_enabled');
        const instituteId = ctx.params.id;
        const view = licenceView(instituteId);
        return {
            institute_id: instituteId,
            state: view.state,
            enforcement: view.enforcement,
            seats_granted: view.seats,
            seats_used: view.seatsUsed,
            ends_at: iso(view.endsAt),
            grace_ends_at: iso(view.graceEndsAt),
            grants: grantsOf(instituteId)
                .sort((x, y) => x.created_at - y.created_at)
                .map(grantDetail),
            rooms: licenceRooms(instituteId, view),
        };
    }

    function superGrantCreate(ctx) {
        const user = requireSuperAdmin(ctx, 'licence_enabled');
        const body = ctx.body;
        const bad = (message) => new ApiError(400, 'BAD_REQUEST', message);
        if (!['TRIAL', 'PAID', 'COMPLIMENTARY'].includes(body.kind)) {
            throw bad('kind is TRIAL, PAID or COMPLIMENTARY');
        }
        if (!Number.isInteger(body.seats) || body.seats < 1) throw bad('seats must be at least 1');
        const startsAt = Date.parse(body.starts_at);
        const endsAt = Date.parse(body.ends_at);
        if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
            throw bad('ends_at must be after starts_at');
        }
        const graceDays = body.grace_days ?? 0;
        if (!Number.isInteger(graceDays) || graceDays < 0)
            throw bad('grace_days must be 0 or more');
        if (body.partner_id != null && !db.partners.has(body.partner_id))
            throw bad('Unknown partner_id');
        if (body.external_ref != null && String(body.external_ref).length > 120) {
            throw bad('external_ref is at most 120 characters');
        }
        if (body.note != null && String(body.note).length > 500)
            throw bad('note is at most 500 characters');
        const grant = newGrant(ctx.params.id, {
            kind: body.kind,
            seats: body.seats,
            starts_at: startsAt,
            ends_at: endsAt,
            grace_days: graceDays,
            partner_id: body.partner_id ?? null,
            external_ref: body.external_ref ?? null,
            note: body.note ?? null,
            created_by: user.id,
        });
        db.grants.set(grant.id, grant);
        return grantDetail(grant);
    }

    function superGrantCancel(ctx) {
        const user = requireSuperAdmin(ctx, 'licence_enabled');
        const grant = db.grants.get(ctx.params.id);
        if (!grant) throw new ApiError(404, 'NOT_FOUND', 'No such grant');
        if (grant.status === 'ACTIVE') {
            grant.status = 'CANCELLED';
            grant.cancelled_by = user.id;
            grant.cancelled_at = now();
            if (typeof ctx.body.note === 'string') grant.note = ctx.body.note.slice(0, 500);
        }
        return grantDetail(grant);
    }

    const templateRow = (key, row) => ({
        key,
        kind: row.kind,
        seats: row.seats,
        days: row.days,
        grace_days: row.grace_days,
        active: row.active,
        updated_by: row.updated_by,
        updated_at: iso(row.updated_at),
    });

    function superTemplate(ctx) {
        const user = requireSuperAdmin(ctx, 'licence_enabled');
        const key = ctx.params.id;
        if (!/^[a-z_]{1,32}$/.test(key))
            throw new ApiError(400, 'BAD_REQUEST', 'Unknown template key');
        if (ctx.req.method === 'PUT') {
            const body = ctx.body;
            const bad = (message) => new ApiError(400, 'BAD_REQUEST', message);
            if (!['TRIAL', 'PAID', 'COMPLIMENTARY'].includes(body.kind)) throw bad('Unknown kind');
            if (!Number.isInteger(body.seats) || body.seats < 1)
                throw bad('seats must be at least 1');
            if (!Number.isInteger(body.days) || body.days < 1) throw bad('days must be at least 1');
            const graceDays = body.grace_days ?? 0;
            if (!Number.isInteger(graceDays) || graceDays < 0)
                throw bad('grace_days must be 0 or more');
            db.templates.set(key, {
                kind: body.kind,
                seats: body.seats,
                days: body.days,
                grace_days: graceDays,
                active: body.active !== false,
                updated_by: user.id,
                updated_at: now(),
            });
        }
        const row = db.templates.get(key);
        if (!row) throw new ApiError(404, 'NOT_FOUND', 'No such template');
        return templateRow(key, row);
    }

    /** Monthly counts from the seat history. Counts only: the system computes no money. */
    function superLicenceUsage(ctx) {
        requireSuperAdmin(ctx, 'licence_enabled');
        const month = ctx.query.get('month') ?? '';
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            throw new ApiError(400, 'BAD_REQUEST', 'month is yyyy-MM');
        }
        const zone = validZone(ctx.query.get('zone'));
        const first = `${month}-01`;
        const [y, m] = month.split('-').map(Number);
        const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const edges = Array.from({ length: days + 1 }, (_, i) =>
            localMidnight(addDays(first, i), zone)
        );
        const institutes = new Set([
            ...[...db.grants.values()].map((g) => g.institute_id),
            ...db.licenceEvents.map((e) => e.institute_id),
            ...db.licenceSettings.keys(),
        ]);
        const rows = [];
        for (const instituteId of [...institutes].sort()) {
            // Seat intervals per room, replayed from the history.
            const intervals = new Map();
            const open = new Map();
            for (const event of db.licenceEvents.filter((e) => e.institute_id === instituteId)) {
                if (event.action === 'ASSIGNED') {
                    open.set(event.room_id, event);
                } else if (open.has(event.room_id)) {
                    const started = open.get(event.room_id);
                    open.delete(event.room_id);
                    if (!intervals.has(event.room_id)) intervals.set(event.room_id, []);
                    intervals
                        .get(event.room_id)
                        .push({ from: started.at, to: event.at, partner: started.partner_id });
                }
            }
            for (const [roomId, started] of open) {
                if (!intervals.has(roomId)) intervals.set(roomId, []);
                intervals
                    .get(roomId)
                    .push({ from: started.at, to: Infinity, partner: started.partner_id });
            }
            // As PanelLicenceUsageService: a cancelled grant counts until it was cancelled.
            const grants = grantsOf(instituteId).map((g) => ({
                ...g,
                ends_at:
                    g.status === 'CANCELLED' && g.cancelled_at !== null
                        ? Math.min(g.ends_at, g.cancelled_at)
                        : g.ends_at,
            }));
            const t = now();
            let seatsPeak = 0;
            let roomsPeak = 0;
            let roomDays = 0;
            const licensedRooms = new Map();
            for (let i = 0; i < days; i += 1) {
                const [from, to] = [edges[i], edges[i + 1]];
                if (from > t) break; // only days that have started
                const seats = grants
                    .filter((g) => g.starts_at < to && g.ends_at > from)
                    .reduce((total, g) => total + g.seats, 0);
                seatsPeak = Math.max(seatsPeak, seats);
                let count = 0;
                for (const [roomId, list] of intervals) {
                    const hit = list.find((iv) => iv.from < to && iv.to > from);
                    if (hit) {
                        count += 1;
                        licensedRooms.set(roomId, hit.partner);
                    }
                }
                roomsPeak = Math.max(roomsPeak, count);
                roomDays += count;
            }
            const used = new Set(
                countedSessions(
                    (s) =>
                        s.institute_id === instituteId &&
                        s.created_at >= edges[0] &&
                        s.created_at < edges[days]
                ).map((s) => s.room_id)
            );
            const active = [...licensedRooms.entries()].filter(([roomId]) => used.has(roomId));
            const byPartner = new Map();
            for (const [, partnerId] of active) {
                if (partnerId) byPartner.set(partnerId, (byPartner.get(partnerId) ?? 0) + 1);
            }
            const view = licenceView(instituteId);
            const lastWithPartner = grants
                .filter((g) => g.partner_id && g.starts_at < edges[days] && g.ends_at > edges[0])
                .sort((x, yy) => yy.starts_at - x.starts_at)[0];
            rows.push({
                institute_id: instituteId,
                partner_id: lastWithPartner?.partner_id ?? null,
                enforcement: view.enforcement,
                state: view.state,
                seats_granted_peak: seatsPeak,
                licensed_rooms_peak: roomsPeak,
                licensed_room_days: roomDays,
                active_licensed_rooms: active.length,
                rooms_by_partner: [...byPartner.entries()].map(([partnerId, count]) => ({
                    partner_id: partnerId,
                    active_licensed_rooms: count,
                })),
            });
        }
        return { month, rows };
    }

    const partnerRow = (p) => ({
        id: p.id,
        name: p.name,
        partner_institute_id: p.partner_institute_id,
        status: p.status,
        created_at: iso(p.created_at),
    });

    const linkRow = (l) => ({
        id: l.id,
        partner_id: l.partner_id,
        institute_id: l.institute_id,
        institute_name: l.institute_name,
        status: l.status,
        linked_via: l.linked_via,
        install_until: iso(l.install_until),
        created_at: iso(l.created_at),
    });

    function superPartners(ctx) {
        const user = requireSuperAdmin(ctx, 'partners_enabled');
        if (ctx.req.method === 'POST') {
            const name = String(ctx.body.name ?? '').trim();
            const instituteId = String(ctx.body.partner_institute_id ?? '').trim();
            if (!name || name.length > 120 || !instituteId) {
                throw new ApiError(
                    400,
                    'BAD_REQUEST',
                    'name (1 to 120) and partner_institute_id are required'
                );
            }
            if ([...db.partners.values()].some((p) => p.partner_institute_id === instituteId)) {
                throw new ApiError(
                    409,
                    'ALREADY_EXISTS',
                    'This institute is already an installer organisation'
                );
            }
            const partner = {
                id: uuid(),
                name,
                partner_institute_id: instituteId,
                status: 'ACTIVE',
                created_by: user.id,
                created_at: now(),
            };
            db.partners.set(partner.id, partner);
            return partnerRow(partner);
        }
        return [...db.partners.values()].map(partnerRow);
    }

    function superPartnerPatch(ctx) {
        requireSuperAdmin(ctx, 'partners_enabled');
        const partner = db.partners.get(ctx.params.id);
        if (!partner) throw new ApiError(404, 'NOT_FOUND', 'No such partner');
        if (ctx.body.status !== 'ACTIVE' && ctx.body.status !== 'SUSPENDED') {
            throw new ApiError(400, 'BAD_REQUEST', 'status is ACTIVE or SUSPENDED');
        }
        partner.status = ctx.body.status;
        return partnerRow(partner);
    }

    function superPartnerLink(ctx) {
        const user = requireSuperAdmin(ctx, 'partners_enabled');
        const partner = db.partners.get(ctx.params.id);
        if (!partner) throw new ApiError(404, 'NOT_FOUND', 'No such partner');
        const instituteId = String(ctx.body.institute_id ?? '').trim();
        if (!instituteId) throw new ApiError(400, 'BAD_REQUEST', 'institute_id is required');
        let installUntil = null;
        if (ctx.body.install_until != null && ctx.body.install_until !== '') {
            installUntil = Date.parse(ctx.body.install_until);
            if (!Number.isFinite(installUntil)) {
                throw new ApiError(400, 'BAD_REQUEST', 'install_until must be an instant');
            }
        }
        // As the real service: a given install_until is set exactly; otherwise a new link gets the
        // default window and an existing one is extended by it (a null window could never install).
        const existing = activeLink(partner.id, instituteId);
        const windowMs = config.partners_default_install_days * DAY;
        if (existing) {
            existing.install_until =
                installUntil !== null
                    ? installUntil
                    : Math.max(existing.install_until ?? now(), now() + windowMs);
            return linkRow(existing);
        }
        return linkRow(
            linkOrExtend(
                partner.id,
                instituteId,
                'SUPER_ADMIN',
                installUntil ?? now() + windowMs,
                user.id
            )
        );
    }

    function superLinkRevoke(ctx) {
        const user = requireSuperAdmin(ctx, 'partners_enabled');
        const link = db.links.get(ctx.params.id);
        if (!link) throw new ApiError(404, 'NOT_FOUND', 'No such link');
        return revokeLink(link, user.id);
    }

    function superRoomPartner(ctx) {
        requireSuperAdmin(ctx, 'partners_enabled');
        const room = db.rooms.get(ctx.params.id);
        if (!room) throw new ApiError(404, 'NOT_FOUND', 'No such room');
        const partnerId = ctx.body.partner_id ?? null;
        if (partnerId !== null && !db.partners.has(partnerId)) {
            throw new ApiError(404, 'NOT_FOUND', 'No such partner');
        }
        room.partner_id = partnerId;
        return { status: 'UPDATED' };
    }

    function superReleases(ctx) {
        const user = requireSuperAdmin(ctx, 'releases_enabled');
        if (ctx.req.method === 'POST') {
            const release = releaseFromBody(ctx.body, user.id);
            db.releases.set(release.id, release);
            return releaseRow(release);
        }
        return [...db.releases.values()]
            .sort((x, y) => x.channel.localeCompare(y.channel) || y.version_code - x.version_code)
            .map(releaseRow);
    }

    function superReleasePatch(ctx) {
        requireSuperAdmin(ctx, 'releases_enabled');
        const release = db.releases.get(ctx.params.id);
        if (!release) throw new ApiError(404, 'NOT_FOUND', 'No such release');
        return releaseRow(patchRelease(release, ctx.body));
    }

    // ------------------------------------------------------------ internal ---
    // Reached only with a valid client signature (handle() checks it first).

    function internalFeature(...names) {
        if (!names.some((name) => config[name] === true)) {
            throw new ApiError(404, 'FEATURE_OFF', 'This feature is not available');
        }
    }

    function internalInstitutes(ctx) {
        internalFeature('usage_enabled', 'fleet_enabled');
        const page = Math.max(0, parseInt(ctx.query.get('page') ?? '0', 10) || 0);
        const byInstitute = new Map();
        for (const device of db.devices.values()) {
            const row = byInstitute.get(device.institute_id) ?? { devices: [], first: Infinity };
            row.first = Math.min(row.first, device.claimed_at);
            if (isLiveDevice(device)) row.devices.push(device);
            byInstitute.set(device.institute_id, row);
        }
        const all = [...byInstitute.entries()]
            .filter(([, row]) => row.devices.length > 0)
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([instituteId, row]) => ({
                institute_id: instituteId,
                rooms_with_panel: new Set(row.devices.map((d) => d.room_id)).size,
                devices: row.devices.length,
                first_paired_at: iso(row.first),
            }));
        return {
            institutes: all.slice(page * INTERNAL_PAGE, (page + 1) * INTERNAL_PAGE),
            page,
            has_more: all.length > (page + 1) * INTERNAL_PAGE,
        };
    }

    function internalHasPanels(ctx) {
        internalFeature('usage_enabled', 'fleet_enabled');
        const instituteId = ctx.query.get('institute_id');
        return {
            has_panels: [...db.devices.values()].some(
                (d) => d.institute_id === instituteId && isLiveDevice(d)
            ),
        };
    }

    function internalFleet(ctx) {
        requireFeature('fleet_enabled');
        const instituteId = ctx.query.get('institute_id');
        if (!instituteId) throw new ApiError(400, 'BAD_REQUEST', 'institute_id is required');
        return fleet(instituteId);
    }

    /** True when the request carries a client name and its signature (InternalAuthFilter). */
    function internalClientValid(headers) {
        const name = headers.clientname;
        const expected = typeof name === 'string' ? config.internal_clients?.[name] : undefined;
        return typeof expected === 'string' && headers.signature === expected;
    }

    // ------------------------------------------------------- phase 2 controls ---

    /**
     * POST /__mock/licence: seat set-up without platform-staff calls.
     * {institute_id, enforcement?, clear_grants?, grants?: [{kind, seats, starts_in_ms?,
     * ends_in_ms, grace_days?}], template?: {kind, seats, days, grace_days?, active?} | null}
     * Times are relative to the mock clock.
     */
    function controlLicence(ctx) {
        const body = ctx.body;
        const instituteId = body.institute_id;
        if (!instituteId) throw new ApiError(400, 'BAD_REQUEST', 'institute_id is required');
        if (body.enforcement) {
            db.licenceSettings.set(instituteId, {
                enforcement: body.enforcement,
                updated_by: 'mock',
                updated_at: now(),
            });
        }
        if (body.clear_grants) {
            for (const grant of grantsOf(instituteId)) db.grants.delete(grant.id);
        }
        for (const spec of body.grants ?? []) {
            const t = now();
            const grant = newGrant(instituteId, {
                kind: spec.kind ?? 'PAID',
                seats: spec.seats ?? 1,
                starts_at: t + (spec.starts_in_ms ?? 0),
                ends_at: t + (spec.ends_in_ms ?? 30 * DAY),
                grace_days: spec.grace_days ?? 0,
                created_by: 'mock',
            });
            db.grants.set(grant.id, grant);
        }
        if (body.template === null) db.templates.delete('auto_trial');
        else if (body.template) {
            db.templates.set('auto_trial', {
                kind: body.template.kind ?? 'TRIAL',
                seats: body.template.seats ?? 1,
                days: body.template.days ?? 30,
                grace_days: body.template.grace_days ?? 0,
                active: body.template.active !== false,
                updated_by: 'mock',
                updated_at: now(),
            });
        }
        const view = licenceView(instituteId);
        return {
            state: view.state,
            enforcement: view.enforcement,
            seats: view.seats,
            seats_used: view.seatsUsed,
            grants: grantsOf(instituteId).map(grantDetail),
        };
    }

    /**
     * POST /__mock/release: a release row straight in, LIVE and at 100% unless said otherwise.
     * published_ago_ms backdates published_at, for the outdated alert.
     */
    function controlRelease(ctx) {
        const body = ctx.body;
        const release = releaseFromBody(
            {
                channel: 'DIRECT',
                version_name: `0.${body.version_code}.0`,
                rollout_percent: 100,
                ...body,
            },
            'mock'
        );
        release.status = body.status ?? 'LIVE';
        if (release.status === 'LIVE') release.published_at = now() - (body.published_ago_ms ?? 0);
        db.releases.set(release.id, release);
        return releaseRow(release);
    }

    // ------------------------------------------------------------ routes table ---

    const PUB = '/auth-service/public/v1/panel';
    const BEARER = '/auth-service/v1/panel';
    const MEETING = '/admin-core-service/live-sessions/provider/meeting';
    const ENGAGE = '/community-service/engage/admin';
    const SUPER = '/auth-service/super-admin/v1/panel';

    const INTERNAL = '/auth-service/internal/panel/v1';

    /** Phase 2 routes. Each answers 404 FEATURE_OFF while its switch is off. */
    const PHASE2_ROUTES = [
        // usage
        ['GET', `${BEARER}/admin/usage`, usage],
        ['GET', `${BEARER}/admin/usage/sessions`, usageSessions],
        ['GET', `${BEARER}/admin/usage/multi`, usageMulti],
        // fleet
        ['GET', `${BEARER}/admin/fleet`, adminFleet],
        // seats
        ['GET', `${BEARER}/admin/licence`, adminLicence],
        ['POST', `${BEARER}/admin/licence/rooms/:id/assign`, adminSeatAssign],
        ['POST', `${BEARER}/admin/licence/rooms/:id/release`, adminSeatRelease],
        // approvals and installers, admin side
        ['POST', `${BEARER}/admin/devices/:id/approve`, adminDeviceApprove],
        ['POST', `${BEARER}/admin/devices/:id/reject`, adminDeviceReject],
        ['GET', `${BEARER}/admin/partners`, adminPartners],
        ['POST', `${BEARER}/admin/partner-invites`, adminInviteCreate],
        ['POST', `${BEARER}/admin/partner-invites/:id/cancel`, adminInviteCancel],
        ['POST', `${BEARER}/admin/partners/:id/revoke`, adminPartnerRevoke],
        // installer side
        ['GET', `${BEARER}/partner/me`, partnerMe],
        ['POST', `${BEARER}/partner/links/redeem`, partnerRedeem],
        ['GET', `${BEARER}/partner/customers`, partnerCustomers],
        ['GET', `${BEARER}/partner/rooms`, partnerRooms],
        ['POST', `${BEARER}/partner/devices/claim`, partnerClaim],
        ['GET', `${BEARER}/partner/installs`, partnerInstalls],
        // platform staff
        ['GET', `${SUPER}/institutes/:id/licence/enforcement`, superEnforcement],
        ['PUT', `${SUPER}/institutes/:id/licence/enforcement`, superEnforcement],
        ['GET', `${SUPER}/institutes/:id/licence`, superLicence],
        ['POST', `${SUPER}/institutes/:id/licence/grants`, superGrantCreate],
        ['POST', `${SUPER}/licence/grants/:id/cancel`, superGrantCancel],
        ['GET', `${SUPER}/licence/templates/:id`, superTemplate],
        ['PUT', `${SUPER}/licence/templates/:id`, superTemplate],
        ['GET', `${SUPER}/licence/usage`, superLicenceUsage],
        ['GET', `${SUPER}/partners`, superPartners],
        ['POST', `${SUPER}/partners`, superPartners],
        ['PATCH', `${SUPER}/partners/:id`, superPartnerPatch],
        ['POST', `${SUPER}/partners/:id/links`, superPartnerLink],
        ['POST', `${SUPER}/partner-links/:id/revoke`, superLinkRevoke],
        ['PATCH', `${SUPER}/rooms/:id/partner`, superRoomPartner],
        ['GET', `${SUPER}/releases`, superReleases],
        ['POST', `${SUPER}/releases`, superReleases],
        ['PATCH', `${SUPER}/releases/:id`, superReleasePatch],
        // internal, behind the client signature
        ['GET', `${INTERNAL}/institutes`, internalInstitutes],
        ['GET', `${INTERNAL}/has-panels`, internalHasPanels],
        ['GET', `${INTERNAL}/usage-summary`, usageSummary],
        ['GET', `${INTERNAL}/fleet`, internalFleet],
    ];

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
        ...PHASE2_ROUTES,

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
        ['GET', '/__mock/now', () => ({ now: now() })],
        ['POST', '/__mock/licence', controlLicence],
        ['POST', '/__mock/release', controlRelease],
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
            // InternalAuthFilter: any "internal" path segment needs a known client and signature.
            if (path.split('/').includes('internal') && !internalClientValid(req.headers)) {
                return send(
                    res,
                    cors,
                    401,
                    { 'Content-Type': 'text/plain' },
                    'Invalid client authentication'
                );
            }
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
    const phase2 = process.argv.includes('--phase2') ? PHASE2_ALL_ON : {};
    const mock = createMockBackend({ approveBase, config: phase2 });
    const bound = await mock.listen(port, host);
    console.log(`[mock-backend] listening on http://${host}:${bound}`);
}
