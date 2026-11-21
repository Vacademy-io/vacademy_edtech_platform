/**
 * "Start from my current home" (spec 11): today's STUDENT_DISPLAY_SETTINGS
 * dashboard widgets → a block list that renders the same home.
 *
 * Pure and client-side. The input is the settings merged the way
 * fetchStudentDisplaySettingsForEdit merges them; they are only read, never
 * changed, so unpublishing returns the institute to exactly its old home.
 *
 * Phone order of the result equals today's: hero, main column, rail, bottom.
 */
import type {
    StudentDashboardWidgetConfig,
    StudentDisplaySettingsData,
} from '@/types/student-display-settings';
import type {
    FeatureKey,
    HomeBlock,
    LayoutSettings,
    LinkTarget,
    StatsCard,
} from '../-types/learner-home-types';
import { createBuiltinBlock, createContentBlock, DEFAULT_SETTINGS } from './block-factory';
import { normalizeUrl } from './link-target';
import { LIMITS } from './publish-checks';

/** Exact learner routes that map to an in-app feature (spec 6.3). */
export const FEATURE_ROUTES: Partial<Record<string, FeatureKey>> = {
    '/study-library/courses': 'COURSES',
    '/study-library/live-class': 'LIVE_CLASSES',
    '/assessment/examination': 'ASSESSMENTS',
    '/assessment/reports': 'REPORTS',
    '/homework/list': 'HOMEWORK',
    '/learning-centre/attendance': 'ATTENDANCE',
    '/notebook': 'NOTEBOOK',
    '/referral': 'REFERRAL',
    '/my-mentors': 'MENTORS',
    '/engagement': 'DAILY_TASKS',
    '/chat': 'AI_CHAT',
    '/downloads': 'DOWNLOADS',
    '/my-files': 'MY_FILES',
    '/user-profile': 'PROFILE',
    '/dashboard/notifications': 'NOTIFICATIONS',
};

/** A custom card's free-text link → a LinkTarget (spec 11 table). Null = no button. */
export function parseLegacyLink(link: string | null | undefined): LinkTarget | null {
    const raw = (link ?? '').trim();
    if (!raw) return null;
    if (/^(https?:)?\/\//i.test(raw) || /^(mailto|tel):/i.test(raw)) {
        const res = normalizeUrl(raw);
        return 'url' in res && res.url.length <= LIMITS.url
            ? { kind: 'URL', url: res.url, sells_something: false }
            : null;
    }
    if (!raw.startsWith('/')) {
        // A bare domain someone typed without https://.
        const res = normalizeUrl(raw);
        return 'url' in res && res.url.length <= LIMITS.url
            ? { kind: 'URL', url: res.url, sells_something: false }
            : null;
    }
    // "//x" is a URL (handled above); a path longer than the server takes has no button.
    if (raw.length > LIMITS.appPath) return null;
    const hashless = raw.split('#')[0] ?? '';
    const queryAt = hashless.indexOf('?');
    const pathPart = queryAt >= 0 ? hashless.slice(0, queryAt) : hashless;
    const query = queryAt >= 0 ? hashless.slice(queryAt + 1) : '';
    const path = pathPart.length > 1 ? pathPart.replace(/\/+$/, '') : pathPart;
    const search = new URLSearchParams(query);

    if (path === '/' || path === '') return null;
    if (path === '/study-library/courses/course-details' || path === '/courses/course-details') {
        const courseId = search.get('courseId');
        if (courseId) return { kind: 'COURSE', package_id: courseId };
    }
    const productPage = /^\/product-pages\/([^/]+)$/.exec(path);
    if (productPage?.[1]) return { kind: 'PRODUCT_PAGE', code: decodeURIComponent(productPage[1]) };
    const assessment = /^\/assessment\/examination\/([^/]+)$/.exec(path);
    if (assessment?.[1])
        return { kind: 'ASSESSMENT', assessment_id: decodeURIComponent(assessment[1]) };
    if (path === '/register/live-class') {
        const sessionId = search.get('sessionId');
        if (sessionId) return { kind: 'LIVE_CLASS', session_id: sessionId };
    }
    const feature = FEATURE_ROUTES[path];
    if (feature && !query) return { kind: 'FEATURE', feature };
    return { kind: 'APP_PATH', path: raw };
}

export interface ConversionCopy {
    untitled: string;
    open: string;
    importedLabel: string;
}

export const DEFAULT_CONVERSION_COPY: ConversionCopy = {
    untitled: 'Untitled',
    open: 'Open',
    importedLabel: 'Imported card',
};

const isCustom = (w: StudentDashboardWidgetConfig) =>
    w.isCustom === true || (typeof w.id === 'string' && w.id.startsWith('custom'));

/** Learner's OPT_IN_WIDGETS: a missing config means hidden for these. */
const OPT_IN_IDS = new Set<string>(['myOrders']);

type Sorted = { order: number; seq: number; block: HomeBlock };

export interface LegacyConversion {
    blocks: HomeBlock[];
    /** Visible custom cards left out because the page would pass the block limits. */
    droppedCards: number;
    /** Custom cards whose heading, text or button were shortened to the server limits. */
    clippedCards: number;
}

const clip = (text: string, max: number) =>
    text.length > max ? text.slice(0, max).trimEnd() : text;

/**
 * Today's home as blocks that the server accepts (contract section 2):
 *  - widgets that are switched off today are left out (they showed nothing);
 *  - custom cards are clipped to the notice limits;
 *  - when the page would pass 30 blocks or 20 non-built-in blocks, the custom
 *    cards that come last are left out, and the count is returned so the admin is told.
 */
export function convertLegacyHome(
    settings: Pick<StudentDisplaySettingsData, 'dashboard'>,
    copy: ConversionCopy = DEFAULT_CONVERSION_COPY,
    layoutSettings: LayoutSettings = DEFAULT_SETTINGS
): LegacyConversion {
    let clippedCards = 0;
    const kept = buildLegacyBlocks(settings, copy, layoutSettings)
        .filter((b) => b.enabled)
        .map((b) => {
            if (b.type !== 'NOTICE') return b;
            const c = b.config;
            const next = {
                ...c,
                title: clip(c.title, LIMITS.notice.title),
                body: clip(c.body, LIMITS.notice.body),
                button: c.button
                    ? { ...c.button, label: clip(c.button.label, LIMITS.ctaLabel) }
                    : null,
            };
            if (
                next.title !== c.title ||
                next.body !== c.body ||
                next.button?.label !== c.button?.label
            ) {
                clippedCards += 1;
            }
            return {
                ...b,
                admin_label: b.admin_label ? clip(b.admin_label, LIMITS.adminLabel) : null,
                config: next,
            };
        });
    const builtins = kept.filter((b) => b.type === 'BUILTIN').length;
    const room = Math.max(0, Math.min(LIMITS.contentBlocks, LIMITS.blocks - builtins));
    let cards = 0;
    let droppedCards = 0;
    const blocks = kept.filter((b) => {
        if (b.type !== 'NOTICE') return true;
        cards += 1;
        if (cards <= room) return true;
        droppedCards += 1;
        return false;
    });
    return { blocks, droppedCards, clippedCards };
}

function buildLegacyBlocks(
    settings: Pick<StudentDisplaySettingsData, 'dashboard'>,
    copy: ConversionCopy,
    layoutSettings: LayoutSettings
): HomeBlock[] {
    const widgets = settings.dashboard?.widgets ?? [];
    const byId = new Map<string, StudentDashboardWidgetConfig>();
    widgets.filter((w) => !isCustom(w)).forEach((w) => byId.set(w.id, w));
    const visible = (id: string) => {
        const cfg = byId.get(id);
        return cfg ? cfg.visible !== false : !OPT_IN_IDS.has(id);
    };
    const order = (id: string) => byId.get(id)?.order ?? Number.MAX_SAFE_INTEGER;

    let seq = 0;
    const sortByOrder = (rows: Sorted[]) =>
        rows.sort((a, b) => a.order - b.order || a.seq - b.seq).map((r) => r.block);
    const row = (o: number, block: HomeBlock): Sorted => ({ order: o, seq: seq++, block });

    const railIds = ['upcomingLiveClasses', 'thisWeekAttendance', 'myMentors', 'getApp'] as const;
    const hasRail = railIds.some(visible);

    // ── Main column, in today's order ──────────────────────────────────────
    const main: Sorted[] = [];
    if (!hasRail) {
        main.push(
            row(
                order('todayTasks'),
                createBuiltinBlock('TODAY_TASKS', {
                    desktop_placement: 'MAIN',
                    enabled: visible('todayTasks'),
                })
            )
        );
    }
    main.push(
        row(
            order('continueLearning'),
            createBuiltinBlock('CONTINUE_LEARNING', {
                desktop_placement: 'MAIN',
                enabled: visible('continueLearning'),
            })
        )
    );
    main.push(
        row(
            order('enrolledCourses'),
            createBuiltinBlock('ENROLLED_COURSES', {
                desktop_placement: 'MAIN',
                enabled: visible('enrolledCourses'),
            })
        )
    );

    const statIds: Array<[string, StatsCard]> = [
        ['coursesStat', 'COURSES'],
        ['liveClasses', 'LIVE_CLASSES'],
        ['evaluationStat', 'EVALUATIONS'],
    ];
    const statsOn = statIds.filter(([id]) => visible(id));
    const statsOrderFrom = statsOn.length > 0 ? statsOn : statIds;
    main.push(
        row(
            Math.min(...statsOrderFrom.map(([id]) => order(id))),
            createBuiltinBlock('STATS_ROW', {
                desktop_placement: 'MAIN',
                enabled: statsOn.length > 0,
                options: {
                    cards:
                        statsOn.length > 0 ? statsOn.map(([, c]) => c) : statIds.map(([, c]) => c),
                },
            })
        )
    );
    main.push(
        row(
            order('learningAnalytics'),
            createBuiltinBlock('LEARNING_ANALYTICS', {
                desktop_placement: 'MAIN',
                enabled: visible('learningAnalytics'),
            })
        )
    );

    for (const w of widgets.filter(isCustom)) {
        const link = parseLegacyLink(w.link);
        main.push(
            row(
                w.order ?? 0,
                createContentBlock(
                    'NOTICE',
                    {
                        title: w.title?.trim() || copy.untitled,
                        body: w.subTitle ?? '',
                        button: link ? { label: copy.open, link } : null,
                        tone: 'NEUTRAL',
                        dismissible: false,
                        require_ack: false,
                    },
                    // Today every custom card is shown; a hidden one stays off.
                    {
                        desktop_placement: 'MAIN',
                        admin_label: copy.importedLabel,
                        enabled: w.visible !== false,
                    },
                    layoutSettings
                )
            )
        );
    }
    main.push(
        row(
            order('myMembership'),
            createBuiltinBlock('MY_MEMBERSHIP', {
                desktop_placement: 'MAIN',
                enabled: visible('myMembership'),
            })
        )
    );
    main.push(
        row(
            order('myBooks'),
            createBuiltinBlock('MY_BOOKS', {
                desktop_placement: 'MAIN',
                enabled: visible('myBooks'),
            })
        )
    );
    main.push(
        row(
            order('myOrders'),
            createBuiltinBlock('MY_ORDERS', {
                desktop_placement: 'MAIN',
                enabled: visible('myOrders'),
            })
        )
    );

    // ── Rail ───────────────────────────────────────────────────────────────
    const rail: Sorted[] = [];
    if (hasRail) {
        rail.push(
            row(
                order('todayTasks'),
                createBuiltinBlock('TODAY_TASKS', {
                    desktop_placement: 'RAIL',
                    enabled: visible('todayTasks'),
                })
            )
        );
    }
    rail.push(
        row(
            order('upcomingLiveClasses'),
            createBuiltinBlock('UPCOMING_LIVE_CLASSES', {
                desktop_placement: 'RAIL',
                enabled: visible('upcomingLiveClasses'),
            })
        )
    );
    rail.push(
        row(
            order('thisWeekAttendance'),
            createBuiltinBlock('THIS_WEEK_ATTENDANCE', {
                desktop_placement: 'RAIL',
                enabled: visible('thisWeekAttendance'),
            })
        )
    );
    rail.push(
        row(
            order('myMentors'),
            createBuiltinBlock('MY_MENTORS', {
                desktop_placement: 'RAIL',
                enabled: visible('myMentors'),
            })
        )
    );
    rail.push(
        row(
            order('getApp'),
            createBuiltinBlock('GET_APP', { desktop_placement: 'RAIL', enabled: visible('getApp') })
        )
    );

    const pins = createBuiltinBlock('PINS', { desktop_placement: hasRail ? 'RAIL' : 'MAIN' });

    return [
        createBuiltinBlock('HERO', {
            desktop_placement: 'FULL',
            options: { getting_started: visible('gettingStarted') },
        }),
        createBuiltinBlock('NOTEBOOK_REVIEW', { desktop_placement: 'MAIN' }),
        // No rail: announcements lead the main column (index.tsx "!hasRail" branch).
        ...(hasRail ? [] : [pins]),
        createBuiltinBlock('COMPANIONS', { desktop_placement: 'MAIN' }),
        ...sortByOrder(main),
        ...(hasRail ? [pins] : []),
        ...sortByOrder(rail),
        createBuiltinBlock('GAMIFICATION', {
            desktop_placement: 'FULL',
            enabled: visible('gamification'),
        }),
        createBuiltinBlock('RAISE_QUERY', { desktop_placement: 'FULL' }),
        createBuiltinBlock('EXPLORE_BUTTONS', {
            desktop_placement: 'FULL',
            enabled: visible('exploreMemberships') || visible('exploreBooks'),
            options: { memberships: visible('exploreMemberships'), books: visible('exploreBooks') },
        }),
    ];
}
