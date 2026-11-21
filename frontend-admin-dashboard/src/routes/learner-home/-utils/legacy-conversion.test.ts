import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from '@/constants/display-settings/student-defaults';
import type { StudentDashboardWidgetConfig } from '@/types/student-display-settings';
import type { HomeBlock } from '../-types/learner-home-types';
import { convertLegacyHome, parseLegacyLink } from './legacy-conversion';
import { errorsOf, runPublishChecks } from './publish-checks';

const widgetsWith = (
    patch: Record<string, Partial<StudentDashboardWidgetConfig>>,
    extra: StudentDashboardWidgetConfig[] = []
) => ({
    dashboard: {
        widgets: [
            ...DEFAULT_STUDENT_DISPLAY_SETTINGS.dashboard.widgets.map((w) => ({
                ...w,
                ...(patch[w.id] ?? {}),
            })),
            ...extra,
        ],
    },
});

const label = (b: HomeBlock) =>
    b.type === 'BUILTIN'
        ? b.builtin_widget
        : `${b.type}:${b.type === 'NOTICE' ? b.config.title : ''}`;

describe('convertLegacyHome', () => {
    it('converts the default settings into today’s order', () => {
        const { blocks, droppedCards, clippedCards } = convertLegacyHome(
            DEFAULT_STUDENT_DISPLAY_SETTINGS
        );
        expect([droppedCards, clippedCards]).toEqual([0, 0]);
        const order = blocks.map(label);
        expect(order[0]).toBe('HERO');
        expect(order[1]).toBe('NOTEBOOK_REVIEW');
        expect(order[2]).toBe('COMPANIONS');
        // Main column before the rail, rail starts with PINS, bottom row last.
        const pins = order.indexOf('PINS');
        expect(order.indexOf('CONTINUE_LEARNING')).toBeLessThan(pins);
        expect(order.indexOf('MY_MEMBERSHIP')).toBeLessThan(pins);
        expect(order.slice(pins)).toEqual([
            'PINS',
            ...order.slice(pins + 1, -3),
            'GAMIFICATION',
            'RAISE_QUERY',
            'EXPLORE_BUTTONS',
        ]);
        // todayTasks leads the rail (its fractional default order), then the saved order.
        expect(order.slice(pins + 1, -3)).toEqual([
            'TODAY_TASKS',
            'UPCOMING_LIVE_CLASSES',
            'MY_MENTORS',
            'THIS_WEEK_ATTENDANCE',
            'GET_APP',
        ]);
        for (const b of blocks.slice(pins, -3)) expect(b.desktop_placement).toBe('RAIL');
        expect(blocks[0]!.desktop_placement).toBe('FULL');
        // Every built-in once.
        const builtins = blocks.filter((b) => b.type === 'BUILTIN').map(label);
        expect(new Set(builtins).size).toBe(builtins.length);
        // My Orders ships off, so it is left out: 18 of the 19 built-ins.
        expect(builtins).toHaveLength(18);
        expect(order).not.toContain('MY_ORDERS');
        expect(blocks.every((b) => b.enabled)).toBe(true);
        // A converted default home publishes with no errors.
        expect(errorsOf(runPublishChecks(blocks))).toEqual([]);
    });

    it('collapses the three stat cards into one STATS_ROW with only the visible ones', () => {
        const { blocks } = convertLegacyHome(widgetsWith({ liveClasses: { visible: false } }));
        const stats = blocks.filter(
            (b) => b.type === 'BUILTIN' && b.builtin_widget === 'STATS_ROW'
        );
        expect(stats).toHaveLength(1);
        expect(stats[0]!.enabled).toBe(true);
        expect(stats[0]!.config).toEqual({ options: { cards: ['COURSES', 'EVALUATIONS'] } });

        const none = convertLegacyHome(
            widgetsWith({
                liveClasses: { visible: false },
                coursesStat: { visible: false },
                evaluationStat: { visible: false },
            })
        ).blocks.find((b) => b.type === 'BUILTIN' && b.builtin_widget === 'STATS_ROW');
        // Every stat card is off today: the row is left out.
        expect(none).toBeUndefined();
    });

    it('turns custom cards (legacy "custom" and "custom:<id>") into imported notices in their place', () => {
        const { blocks } = convertLegacyHome(
            widgetsWith({}, [
                {
                    id: 'custom',
                    order: 1.5,
                    visible: true,
                    isCustom: true,
                    title: 'Fees due',
                    subTitle: 'Pay by Friday',
                    link: '/product-pages/FEES',
                },
                {
                    id: 'custom:ab12cd34',
                    order: 99,
                    visible: true,
                    isCustom: true,
                    title: '',
                    link: '/',
                },
            ])
        );
        const notices = blocks.filter(
            (b): b is Extract<HomeBlock, { type: 'NOTICE' }> => b.type === 'NOTICE'
        );
        expect(notices).toHaveLength(2);
        expect(notices[0]!.config).toMatchObject({
            title: 'Fees due',
            body: 'Pay by Friday',
            button: { label: 'Open', link: { kind: 'PRODUCT_PAGE', code: 'FEES' } },
            tone: 'NEUTRAL',
            dismissible: false,
            require_ack: false,
        });
        expect(notices[0]!.admin_label).toBe('Imported card');
        // "/" bounced to the landing page: the dead button is dropped.
        expect(notices[1]!.config.title).toBe('Untitled');
        expect(notices[1]!.config.button).toBeNull();
        // Order 1.5 sits between continueLearning (order 2) and the hero.
        const order = blocks.map(label);
        expect(order.indexOf('NOTICE:Fees due')).toBeLessThan(order.indexOf('CONTINUE_LEARNING'));
    });

    it('with no rail widget visible, PINS leads the main column and Today goes to MAIN', () => {
        const { blocks } = convertLegacyHome(
            widgetsWith({
                upcomingLiveClasses: { visible: false },
                thisWeekAttendance: { visible: false },
                myMentors: { visible: false },
                getApp: { visible: false },
            })
        );
        const order = blocks.map(label);
        expect(order.slice(0, 4)).toEqual(['HERO', 'NOTEBOOK_REVIEW', 'PINS', 'COMPANIONS']);
        // The hidden rail widgets are left out.
        expect(order).not.toContain('MY_MENTORS');
        const pins = blocks.find((b) => label(b) === 'PINS')!;
        expect(pins.desktop_placement).toBe('MAIN');
        const today = blocks.find((b) => label(b) === 'TODAY_TASKS')!;
        expect(today.desktop_placement).toBe('MAIN');
        expect(order.indexOf('TODAY_TASKS')).toBeLessThan(order.indexOf('CONTINUE_LEARNING'));
    });

    it('carries the hero checklist and the explore buttons', () => {
        const { blocks } = convertLegacyHome(
            widgetsWith({ gettingStarted: { visible: false }, exploreBooks: { visible: false } })
        );
        const hero = blocks.find((b) => label(b) === 'HERO')!;
        expect(hero.config).toEqual({ options: { getting_started: false } });
        const explore = blocks.find((b) => label(b) === 'EXPLORE_BUTTONS')!;
        expect(explore.enabled).toBe(true);
        expect(explore.config).toEqual({ options: { memberships: true, books: false } });
    });

    const card = (n: number, patch: Partial<StudentDashboardWidgetConfig> = {}) =>
        ({
            id: n === 0 ? 'custom' : `custom:c${n}`,
            order: 20 + n,
            visible: true,
            isCustom: true,
            title: `Card ${n}`,
            subTitle: '',
            link: '/notebook',
            ...patch,
        }) as StudentDashboardWidgetConfig;

    it('keeps only the custom cards that fit the block limits and says how many were left out', () => {
        const cards = Array.from({ length: 15 }, (_, i) => card(i));
        const res = convertLegacyHome(widgetsWith({}, cards));
        // 18 built-ins are on by default, so 12 cards fit in 30 blocks.
        const notices = res.blocks.filter((b) => b.type === 'NOTICE');
        expect(notices).toHaveLength(12);
        expect(res.droppedCards).toBe(3);
        expect(res.blocks).toHaveLength(30);
        // The earliest cards are the ones kept.
        expect(notices.map((b) => b.type === 'NOTICE' && b.config.title)).toEqual(
            cards.slice(0, 12).map((c) => c.title)
        );
        // What is left passes every layout limit the server checks at save.
        const codes = errorsOf(runPublishChecks(res.blocks)).map((i) => i.code);
        expect(codes).not.toContain('LIMIT_BLOCKS');
        expect(codes).not.toContain('LIMIT_CONTENT_BLOCKS');
    });

    it('never keeps more than 20 custom cards, even when built-ins are off', () => {
        const allOff = Object.fromEntries(
            DEFAULT_STUDENT_DISPLAY_SETTINGS.dashboard.widgets.map((w) => [
                w.id,
                { visible: false },
            ])
        );
        const res = convertLegacyHome(
            widgetsWith(
                allOff,
                Array.from({ length: 25 }, (_, i) => card(i))
            )
        );
        expect(res.blocks.filter((b) => b.type === 'NOTICE')).toHaveLength(20);
        expect(res.droppedCards).toBe(5);
    });

    it('leaves hidden cards out and clips long headings and texts to the notice limits', () => {
        const res = convertLegacyHome(
            widgetsWith({}, [
                card(1, { title: 'T'.repeat(100), subTitle: 'B'.repeat(700) }),
                card(2, { visible: false }),
            ])
        );
        const notices = res.blocks.filter(
            (b): b is Extract<HomeBlock, { type: 'NOTICE' }> => b.type === 'NOTICE'
        );
        expect(notices).toHaveLength(1);
        expect(notices[0]!.config.title).toHaveLength(80);
        expect(notices[0]!.config.body).toHaveLength(600);
        expect(res.clippedCards).toBe(1);
        expect(res.droppedCards).toBe(0);
        expect(errorsOf(runPublishChecks(res.blocks))).toEqual([]);
    });
});

describe('parseLegacyLink', () => {
    it.each([
        [
            'https://example.com/x',
            { kind: 'URL', url: 'https://example.com/x', sells_something: false },
        ],
        ['http://example.com', { kind: 'URL', url: 'http://example.com', sells_something: false }],
        [
            '//cdn.example.com/a',
            { kind: 'URL', url: 'https://cdn.example.com/a', sells_something: false },
        ],
        [
            'mailto:help@example.com',
            { kind: 'URL', url: 'mailto:help@example.com', sells_something: false },
        ],
        ['tel:+911234567890', { kind: 'URL', url: 'tel:+911234567890', sells_something: false }],
        [
            '/study-library/courses/course-details?courseId=C1&x=2',
            { kind: 'COURSE', package_id: 'C1' },
        ],
        ['/courses/course-details?courseId=C2', { kind: 'COURSE', package_id: 'C2' }],
        ['/product-pages/SUMMER', { kind: 'PRODUCT_PAGE', code: 'SUMMER' }],
        ['/assessment/examination/A9', { kind: 'ASSESSMENT', assessment_id: 'A9' }],
        ['/register/live-class?sessionId=S1', { kind: 'LIVE_CLASS', session_id: 'S1' }],
        ['/notebook', { kind: 'FEATURE', feature: 'NOTEBOOK' }],
        ['/study-library/courses', { kind: 'FEATURE', feature: 'COURSES' }],
        ['/study-library/courses/', { kind: 'FEATURE', feature: 'COURSES' }],
        ['/dashboard/notifications', { kind: 'FEATURE', feature: 'NOTIFICATIONS' }],
        ['/', null],
        ['', null],
        ['/some/other/page?x=1', { kind: 'APP_PATH', path: '/some/other/page?x=1' }],
        ['javascript:alert(1)', null],
        ['example.com', { kind: 'URL', url: 'https://example.com', sells_something: false }],
        // Longer than the server takes: no button.
        [`https://a.com/${'x'.repeat(2000)}`, null],
        [`/${'x'.repeat(600)}`, null],
    ])('%s', (input, expected) => {
        expect(parseLegacyLink(input)).toEqual(expected);
    });
});
