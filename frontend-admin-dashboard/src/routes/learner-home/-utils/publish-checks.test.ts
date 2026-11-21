import { describe, expect, it } from 'vitest';
import type { HomeBlock, HomeBlockOf, ImageRef } from '../-types/learner-home-types';
import { createBuiltinBlock, createContentBlock, emptySlide } from './block-factory';
import {
    errorsOf,
    issuesAt,
    LIMITS,
    mergeIssues,
    runPublishChecks,
    warningsOf,
} from './publish-checks';

const NOW = Date.parse('2026-11-16T10:00:00Z');
const img = (patch: Partial<ImageRef> = {}): ImageRef => ({
    file_id: 'f1',
    alt: 'Banner',
    decorative: false,
    url: 'https://cdn.example.com/a.png',
    width: 1600,
    height: 800,
    ...patch,
});
const hero = () => createBuiltinBlock('HERO');
const codes = (blocks: HomeBlock[], ctx = {}) =>
    errorsOf(runPublishChecks(blocks, { now: NOW, ...ctx })).map((i) => i.code);
const warnCodes = (blocks: HomeBlock[], ctx = {}) =>
    warningsOf(runPublishChecks(blocks, { now: NOW, ...ctx })).map((i) => i.code);

function banner(slides: HomeBlockOf<'BANNER_CAROUSEL'>['config']['slides']) {
    return createContentBlock('BANNER_CAROUSEL', { slides });
}

describe('layout rules', () => {
    it('requires HERO and allows each built-in once', () => {
        expect(codes([])).toContain('HERO_REQUIRED');
        expect(codes([hero()])).toEqual([]);
        expect(codes([hero(), hero()])).toEqual(['DUPLICATE_BUILTIN']);
    });

    it('enforces block counts (spec 3.4)', () => {
        const many = Array.from({ length: 21 }, () =>
            createContentBlock('NOTICE', { title: 'Hi' })
        );
        expect(codes([hero(), ...many])).toContain('LIMIT_CONTENT_BLOCKS');
        const banners = Array.from({ length: 4 }, () =>
            banner([{ ...emptySlide(), image: img() }])
        );
        expect(codes([hero(), ...banners])).toContain('LIMIT_TYPE');
        const shelves = Array.from({ length: 7 }, () =>
            createContentBlock('COURSE_SHELF', { title: 'x' })
        );
        expect(codes([hero(), ...shelves])).toEqual(['LIMIT_TYPE']);
        const thirtyOne = [
            hero(),
            ...Array.from({ length: 18 }, () => createContentBlock('NOTICE', { title: 'n' })),
            ...(
                [
                    'PINS',
                    'TODAY_TASKS',
                    'CONTINUE_LEARNING',
                    'ENROLLED_COURSES',
                    'STATS_ROW',
                    'MY_BOOKS',
                    'MY_ORDERS',
                    'GET_APP',
                    'MY_MENTORS',
                    'GAMIFICATION',
                    'RAISE_QUERY',
                    'EXPLORE_BUTTONS',
                ] as const
            ).map((w) => createBuiltinBlock(w)),
        ];
        expect(thirtyOne).toHaveLength(31);
        expect(codes(thirtyOne)).toEqual(['LIMIT_BLOCKS']);
    });

    it('rejects an inverted window and warns about an ended block', () => {
        const b = createContentBlock('NOTICE', { title: 'x' });
        expect(
            codes([
                hero(),
                { ...b, starts_at: '2026-12-02T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' },
            ])
        ).toEqual(['WINDOW_INVERTED']);
        expect(warnCodes([hero(), { ...b, ends_at: '2026-11-01T00:00:00Z' }])).toContain('ENDED');
    });

    it('flags an oversized payload', () => {
        const huge = createContentBlock('NOTICE', { title: 'x', body: 'y'.repeat(600) });
        const blocks = [
            hero(),
            ...Array.from({ length: 20 }, () => ({ ...huge, admin_label: 'z'.repeat(120) })),
        ];
        // 20 × ~1 KB stays under 256 KB; a long slide list in many banners is what grows it.
        expect(codes(blocks)).not.toContain('PAYLOAD_TOO_LARGE');
        const bigUrl = `https://cdn.example.com/${'a'.repeat(60_000)}`;
        const fat = [
            hero(),
            ...Array.from({ length: 3 }, () =>
                banner(
                    Array.from({ length: 2 }, () => ({
                        ...emptySlide(),
                        image: img({ url: bigUrl }),
                    }))
                )
            ),
        ];
        expect(codes(fat)).toContain('PAYLOAD_TOO_LARGE');
    });
});

describe('audience', () => {
    const notice = createContentBlock('NOTICE', { title: 'x' });
    it('needs 1..5 non-empty conditions with at most 200 ids', () => {
        expect(codes([hero(), { ...notice, audience: { mode: 'RULES', all_of: [] } }])).toEqual([
            'AUDIENCE_EMPTY',
        ]);
        expect(
            codes([
                hero(),
                {
                    ...notice,
                    audience: { mode: 'RULES', all_of: [{ kind: 'USER_TAG', tag_ids: [] }] },
                },
            ])
        ).toEqual(['AUDIENCE_CONDITION_EMPTY']);
        const six = Array.from({ length: 6 }, () => ({
            kind: 'USER_TAG' as const,
            tag_ids: ['t'],
        }));
        expect(codes([hero(), { ...notice, audience: { mode: 'RULES', all_of: six } }])).toEqual([
            'AUDIENCE_TOO_MANY',
        ]);
        const ids = Array.from({ length: 201 }, (_, i) => `p${i}`);
        expect(
            codes([
                hero(),
                {
                    ...notice,
                    audience: {
                        mode: 'RULES',
                        all_of: [{ kind: 'ENROLLED_IN_COURSE', package_ids: ids }],
                    },
                },
            ])
        ).toEqual(['AUDIENCE_TOO_MANY_IDS']);
    });
    it('warns about ids the institute no longer has', () => {
        const b = {
            ...notice,
            audience: {
                mode: 'RULES' as const,
                all_of: [{ kind: 'PACKAGE_SESSION' as const, ids: ['b1', 'gone'] }],
            },
        };
        expect(warnCodes([hero(), b], { batchIds: new Set(['b1']) })).toEqual([
            'AUDIENCE_ID_MISSING',
        ]);
    });
});

describe('per-type checks', () => {
    it('banner: image required, alt unless decorative, 1..5 slides, warn over 3', () => {
        expect(codes([hero(), banner([emptySlide()])])).toEqual(['IMAGE_REQUIRED']);
        expect(codes([hero(), banner([{ ...emptySlide(), image: img({ alt: '' }) }])])).toEqual([
            'ALT_REQUIRED',
        ]);
        expect(
            codes([
                hero(),
                banner([{ ...emptySlide(), image: img({ alt: '', decorative: true }) }]),
            ])
        ).toEqual([]);
        expect(codes([hero(), banner([])])).toEqual(['TOO_FEW']);
        const six = Array.from({ length: 6 }, () => ({ ...emptySlide(), image: img() }));
        expect(codes([hero(), banner(six)])).toEqual(['TOO_MANY']);
        expect(warnCodes([hero(), banner(six.slice(0, 4))])).toContain('MANY_SLIDES');
        expect(
            warnCodes([hero(), banner([{ ...emptySlide(), image: img({ width: 400 }) }])])
        ).toContain('IMAGE_LOW_RES');
    });

    it('banner: every slide ended is an error', () => {
        const ended = { ...emptySlide(), image: img(), ends_at: '2026-11-01T00:00:00Z' };
        expect(codes([hero(), banner([ended, ended])])).toEqual(['ALL_SLIDES_ENDED']);
        expect(codes([hero(), banner([ended, { ...emptySlide(), image: img() }])])).toEqual([]);
    });

    it('shortcuts: label and link required, known icon, 1..16 tiles', () => {
        const tile = {
            key: 'k',
            label: 'Notes',
            icon: { kind: 'ICON' as const, name: 'Notebook' },
            link: { kind: 'FEATURE' as const, feature: 'NOTEBOOK' as const },
        };
        const s = (tiles: (typeof tile)[]) => createContentBlock('SHORTCUTS', { tiles });
        expect(codes([hero(), s([tile])])).toEqual([]);
        expect(warnCodes([hero(), s([tile])])).toEqual(['FEATURE_CONDITIONAL']);
        expect(codes([hero(), s([{ ...tile, label: '' }])])).toEqual(['REQUIRED']);
        expect(
            codes([hero(), s([{ ...tile, label: 'x'.repeat(LIMITS.shortcuts.label + 1) }])])
        ).toEqual(['TOO_LONG']);
        expect(codes([hero(), s([{ ...tile, link: null as never }])])).toEqual(['LINK_REQUIRED']);
        expect(codes([hero(), s([{ ...tile, icon: { kind: 'ICON', name: 'Skull' } }])])).toEqual([
            'ICON_UNKNOWN',
        ]);
        expect(codes([hero(), s(Array.from({ length: 17 }, () => tile))])).toEqual(['TOO_MANY']);
    });

    it('shelf: title, tag and hand-picked counts, limit 4..20, missing courses', () => {
        const shelf = (patch: object) =>
            createContentBlock('COURSE_SHELF', { title: 'New', ...patch });
        expect(codes([hero(), shelf({ title: '' })])).toEqual(['REQUIRED']);
        expect(codes([hero(), shelf({ source: 'TAG', tags: [] })])).toEqual(['TOO_FEW']);
        expect(
            codes([hero(), shelf({ source: 'TAG', tags: ['a', 'b', 'c', 'd', 'e', 'f'] })])
        ).toEqual(['TOO_MANY']);
        expect(codes([hero(), shelf({ source: 'HAND_PICKED', package_ids: [] })])).toEqual([
            'TOO_FEW',
        ]);
        expect(codes([hero(), shelf({ limit: 3 })])).toEqual(['OUT_OF_RANGE']);
        expect(codes([hero(), shelf({ limit: 21 })])).toEqual(['OUT_OF_RANGE']);
        expect(
            codes([hero(), shelf({ source: 'HAND_PICKED', package_ids: ['p1', 'gone'] })], {
                courseIds: new Set(['p1']),
            })
        ).toEqual(['LINK_TARGET_MISSING']);
    });

    it('notice: title, body length, button label and link', () => {
        const n = (patch: object) => createContentBlock('NOTICE', { title: 'Hello', ...patch });
        expect(codes([hero(), n({ title: '' })])).toEqual(['REQUIRED']);
        expect(codes([hero(), n({ body: 'x'.repeat(601) })])).toEqual(['TOO_LONG']);
        expect(
            codes([hero(), n({ button: { label: '', link: { kind: 'COURSE_LIST' } } })])
        ).toEqual(['REQUIRED']);
        expect(
            codes([
                hero(),
                n({
                    button: {
                        label: 'Go',
                        link: { kind: 'URL', url: 'javascript:x', sells_something: false },
                    },
                }),
            ])
        ).toEqual(['URL_INVALID']);
        expect(codes([hero(), n({ require_ack: true, ack_label: '' })])).toEqual(['REQUIRED']);
        expect(
            warnCodes([
                hero(),
                n({ button: { label: 'Go', link: { kind: 'APP_PATH', path: '/old' } } }),
            ])
        ).toEqual(['IMPORTED_LINK']);
    });

    it('event: custom needs both times in order; live session needs a session', () => {
        const e = (patch: object) => createContentBlock('EVENT', { title: 'Open house', ...patch });
        expect(codes([hero(), e({})])).toEqual(['EVENT_TIMES_REQUIRED']);
        expect(
            codes([
                hero(),
                e({ starts_at: '2026-12-01T13:30:00Z', ends_at: '2026-12-01T15:00:00Z' }),
            ])
        ).toEqual([]);
        expect(
            codes([
                hero(),
                e({ starts_at: '2026-12-01T15:00:00Z', ends_at: '2026-12-01T13:30:00Z' }),
            ])
        ).toEqual(['WINDOW_INVERTED']);
        expect(
            warnCodes([
                hero(),
                e({ starts_at: '2026-11-01T13:30:00Z', ends_at: '2026-11-01T15:00:00Z' }),
            ])
        ).toContain('ENDED');
        expect(codes([hero(), e({ source: 'LIVE_SESSION' })])).toEqual(['REQUIRED']);
        expect(
            codes([
                hero(),
                e({ source: 'LIVE_SESSION', live_session_id: 's1', join_opens_minutes: 121 }),
            ])
        ).toEqual(['OUT_OF_RANGE']);
    });

    it('built-ins: Fun warning only for a Fun institute', () => {
        const blocks = [hero(), createBuiltinBlock('MY_MENTORS')];
        expect(warnCodes(blocks)).toEqual([]);
        expect(warnCodes(blocks, { funSkin: true })).toEqual(['FUN_HIDDEN']);
    });
});

describe('issuesAt', () => {
    it('matches a field and everything under it', () => {
        const b = banner([{ ...emptySlide(), image: img({ alt: '' }) }]);
        const issues = runPublishChecks([hero(), b], { now: NOW });
        expect(issuesAt(issues, b.block_key, 'config.slides[0]').map((i) => i.path)).toEqual([
            'config.slides[0].image.alt',
        ]);
        expect(issuesAt(issues, b.block_key, 'config.slides[1]')).toEqual([]);
    });
});

describe('contract rules', () => {
    it('a live-session event may leave its title empty; a URL is at most 2000 characters', () => {
        const live = createContentBlock('EVENT', { source: 'LIVE_SESSION', live_session_id: 's1' });
        expect(codes([hero(), live])).toEqual([]);
        const long = createContentBlock('NOTICE', {
            title: 'x',
            button: {
                label: 'Go',
                link: {
                    kind: 'URL',
                    url: `https://a.com/${'p'.repeat(2000)}`,
                    sells_something: false,
                },
            },
        });
        expect(codes([hero(), long])).toEqual(['TOO_LONG']);
    });

    it('mergeIssues keeps the editor sentence when the server flags the same field', () => {
        const client = [
            {
                block_key: 'b',
                path: 'config.slides[0].image',
                code: 'IMAGE_REQUIRED',
                severity: 'error' as const,
            },
        ];
        const server = [
            {
                block_key: 'b',
                path: 'config.slides[0].image',
                code: 'REQUIRED',
                severity: 'error' as const,
            },
            {
                block_key: 'b',
                path: 'config.see_all',
                code: 'LINK_TARGET_INACTIVE',
                severity: 'error' as const,
            },
            { block_key: 'c', path: null, code: 'NOT_IN_FUN_SKIN', severity: 'warning' as const },
        ];
        expect(mergeIssues(client, server).map((i) => i.code)).toEqual([
            'IMAGE_REQUIRED',
            'LINK_TARGET_INACTIVE',
            'NOT_IN_FUN_SKIN',
        ]);
    });
});
