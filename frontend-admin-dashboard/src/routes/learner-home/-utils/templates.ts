/**
 * The starting templates (spec 8.4). Client-side constants: the server only
 * validates what POST /draft receives. Every template has a HERO and keeps the
 * built-ins that work for an empty institute. Placeholders (a banner slide with
 * no image, an event with no times, a tag shelf with no tag) are left for the
 * publish checks to flag until the admin fills them.
 *
 * Learner-facing sample text comes in through `copy`, so the page passes it in
 * the admin's language; the defaults are English.
 */
import type {
    FeatureKey,
    HomeBlock,
    LayoutSettings,
    LinkTarget,
    ShortcutTile,
    TemplateKey,
} from '../-types/learner-home-types';
import {
    createBuiltinBlock,
    createContentBlock,
    DEFAULT_SETTINGS,
    emptySlide,
} from './block-factory';
import type { ShortcutIconName } from './icons';
import { newKey } from './ids';
import { LIMITS } from './publish-checks';

export type StarterTemplateKey = Extract<TemplateKey, 'COURSES_ONLY' | 'CLASSROOM' | 'STOREFRONT'>;
export const STARTER_TEMPLATES: readonly StarterTemplateKey[] = [
    'COURSES_ONLY',
    'CLASSROOM',
    'STOREFRONT',
];

export interface TemplateCopy {
    tiles: {
        courses: string;
        liveClasses: string;
        assessments: string;
        doubts: string;
        homework: string;
        attendance: string;
        notebook: string;
        reports: string;
        freeCourses: string;
        memberships: string;
        referral: string;
    };
    shelves: { newest: string; free: string; tag: string };
    welcomeNotice: { title: string; body: string; ackLabel: string };
}

export const DEFAULT_TEMPLATE_COPY: TemplateCopy = {
    tiles: {
        courses: 'Courses',
        liveClasses: 'Live classes',
        assessments: 'Tests',
        doubts: 'Ask a doubt',
        homework: 'Homework',
        attendance: 'Attendance',
        notebook: 'Notebook',
        reports: 'Reports',
        freeCourses: 'Free courses',
        memberships: 'Memberships',
        referral: 'Refer & earn',
    },
    shelves: { newest: 'New courses', free: 'Free courses', tag: 'Recommended for you' },
    welcomeNotice: {
        title: 'Welcome to the new term',
        body: 'Please read the term plan and class rules before your first class.',
        ackLabel: 'I have read this',
    },
};

export interface TemplateOptions {
    copy?: TemplateCopy;
    settings?: LayoutSettings;
    /** The store tile needs a store site (decision Q15); without one it is left out. */
    hasStoreSite?: boolean;
}

export interface TemplateResult {
    template_key: TemplateKey;
    settings: LayoutSettings;
    blocks: HomeBlock[];
}

const clip = (text: string, max: number) =>
    text.length > max ? text.slice(0, max).trimEnd() : text;

/**
 * Sample text cut to the server's limits (contract section 2), so a long
 * translation can never make POST /draft fail.
 */
export function clipTemplateCopy(copy: TemplateCopy): TemplateCopy {
    const tiles = Object.fromEntries(
        Object.entries(copy.tiles).map(([k, v]) => [k, clip(v, LIMITS.shortcuts.label)])
    ) as TemplateCopy['tiles'];
    const shelves = Object.fromEntries(
        Object.entries(copy.shelves).map(([k, v]) => [k, clip(v, LIMITS.shelf.title)])
    ) as TemplateCopy['shelves'];
    return {
        tiles,
        shelves,
        welcomeNotice: {
            title: clip(copy.welcomeNotice.title, LIMITS.notice.title),
            body: clip(copy.welcomeNotice.body, LIMITS.notice.body),
            ackLabel: clip(copy.welcomeNotice.ackLabel, LIMITS.notice.ackLabel),
        },
    };
}

const feature = (f: FeatureKey): LinkTarget => ({ kind: 'FEATURE', feature: f });

function tile(label: string, icon: ShortcutIconName, link: LinkTarget | null): ShortcutTile {
    return { key: newKey(), label, icon: { kind: 'ICON', name: icon }, link };
}

function coursesOnly(copy: TemplateCopy, settings: LayoutSettings): HomeBlock[] {
    return [
        createBuiltinBlock('HERO', { desktop_placement: 'FULL' }),
        createContentBlock(
            'BANNER_CAROUSEL',
            { slides: [emptySlide()] },
            { desktop_placement: 'FULL' },
            settings
        ),
        createBuiltinBlock('CONTINUE_LEARNING', { desktop_placement: 'MAIN' }),
        createBuiltinBlock('ENROLLED_COURSES', { desktop_placement: 'MAIN' }),
        createContentBlock(
            'SHORTCUTS',
            {
                tiles: [
                    tile(copy.tiles.courses, 'Books', feature('COURSES')),
                    tile(copy.tiles.liveClasses, 'Broadcast', feature('LIVE_CLASSES')),
                    tile(copy.tiles.assessments, 'Exam', feature('ASSESSMENTS')),
                    tile(copy.tiles.doubts, 'Question', feature('DOUBTS')),
                ],
            },
            { desktop_placement: 'RAIL' }
        ),
        createBuiltinBlock('UPCOMING_LIVE_CLASSES', { desktop_placement: 'RAIL' }),
        createContentBlock(
            'COURSE_SHELF',
            { title: copy.shelves.newest, source: 'NEWEST', hide_owned: true },
            { desktop_placement: 'MAIN' }
        ),
        createBuiltinBlock('GAMIFICATION', { desktop_placement: 'FULL' }),
    ];
}

function classroom(copy: TemplateCopy): HomeBlock[] {
    return [
        createBuiltinBlock('HERO', { desktop_placement: 'FULL' }),
        createContentBlock(
            'NOTICE',
            {
                title: copy.welcomeNotice.title,
                body: copy.welcomeNotice.body,
                require_ack: true,
                ack_label: copy.welcomeNotice.ackLabel,
                tone: 'INFO',
                dismissible: true,
            },
            { desktop_placement: 'MAIN' }
        ),
        createBuiltinBlock('UPCOMING_LIVE_CLASSES', { desktop_placement: 'RAIL' }),
        createContentBlock('EVENT', {}, { desktop_placement: 'RAIL' }),
        createBuiltinBlock('TODAY_TASKS', { desktop_placement: 'MAIN' }),
        createBuiltinBlock('CONTINUE_LEARNING', { desktop_placement: 'MAIN' }),
        createContentBlock(
            'SHORTCUTS',
            {
                tiles: [
                    tile(copy.tiles.liveClasses, 'Broadcast', feature('LIVE_CLASSES')),
                    tile(copy.tiles.homework, 'ClipboardText', feature('HOMEWORK')),
                    tile(copy.tiles.attendance, 'CalendarCheck', feature('ATTENDANCE')),
                    tile(copy.tiles.notebook, 'Notebook', feature('NOTEBOOK')),
                    tile(copy.tiles.doubts, 'Question', feature('DOUBTS')),
                    tile(copy.tiles.reports, 'ChartBar', feature('REPORTS')),
                ],
            },
            { desktop_placement: 'MAIN' }
        ),
        createBuiltinBlock('ENROLLED_COURSES', { desktop_placement: 'MAIN' }),
        createBuiltinBlock('THIS_WEEK_ATTENDANCE', { desktop_placement: 'RAIL' }),
        createBuiltinBlock('STATS_ROW', { desktop_placement: 'MAIN' }),
        createBuiltinBlock('MY_MENTORS', { desktop_placement: 'RAIL' }),
        createBuiltinBlock('PINS', { desktop_placement: 'RAIL' }),
        createBuiltinBlock('RAISE_QUERY', { desktop_placement: 'FULL' }),
    ];
}

function storefront(
    copy: TemplateCopy,
    settings: LayoutSettings,
    hasStoreSite: boolean
): HomeBlock[] {
    const tiles = [
        tile(copy.tiles.courses, 'Books', feature('COURSES')),
        // "Free courses" needs a course tag to point at; it stays a placeholder
        // (no link) until the admin picks one, and the checks say so.
        tile(copy.tiles.freeCourses, 'Gift', null),
        ...(hasStoreSite
            ? [tile(copy.tiles.memberships, 'Storefront', feature('STORE_MEMBERSHIPS'))]
            : []),
        tile(copy.tiles.referral, 'Users', feature('REFERRAL')),
    ];
    return [
        createContentBlock(
            'BANNER_CAROUSEL',
            { slides: [emptySlide(), emptySlide(), emptySlide()] },
            { desktop_placement: 'FULL' },
            settings
        ),
        createBuiltinBlock('HERO', { desktop_placement: 'FULL' }),
        createContentBlock('SHORTCUTS', { tiles }, { desktop_placement: 'MAIN' }),
        createContentBlock(
            'COURSE_SHELF',
            { title: copy.shelves.free, source: 'FREE', hide_owned: true },
            { desktop_placement: 'MAIN' }
        ),
        createContentBlock(
            'COURSE_SHELF',
            { title: copy.shelves.tag, source: 'TAG', tags: [], hide_owned: true },
            { desktop_placement: 'MAIN' }
        ),
        createContentBlock(
            'COURSE_SHELF',
            { title: copy.shelves.newest, source: 'NEWEST', hide_owned: true },
            { desktop_placement: 'MAIN' }
        ),
        createBuiltinBlock('CONTINUE_LEARNING', { desktop_placement: 'MAIN' }),
        createBuiltinBlock('ENROLLED_COURSES', { desktop_placement: 'MAIN' }),
        createBuiltinBlock('MY_MEMBERSHIP', { desktop_placement: 'RAIL' }),
        createBuiltinBlock('MY_BOOKS', { desktop_placement: 'RAIL' }),
        createBuiltinBlock('UPCOMING_LIVE_CLASSES', { desktop_placement: 'RAIL' }),
        createBuiltinBlock('EXPLORE_BUTTONS', { desktop_placement: 'FULL' }),
    ];
}

export function buildTemplate(
    key: StarterTemplateKey,
    options: TemplateOptions = {}
): TemplateResult {
    const copy = clipTemplateCopy(options.copy ?? DEFAULT_TEMPLATE_COPY);
    const settings = options.settings ?? DEFAULT_SETTINGS;
    const blocks =
        key === 'COURSES_ONLY'
            ? coursesOnly(copy, settings)
            : key === 'CLASSROOM'
              ? classroom(copy)
              : storefront(copy, settings, options.hasStoreSite ?? false);
    return { template_key: key, settings: { ...settings }, blocks };
}
