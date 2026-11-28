import { describe, expect, it } from 'vitest';
import type { HomeBlock } from '../-types/learner-home-types';
import { normalizeLayout } from './normalize';
import { buildCreatePayload } from './payload';
import { errorsOf, runPublishChecks } from './publish-checks';
import { buildTemplate, STARTER_TEMPLATES } from './templates';

const kinds = (blocks: HomeBlock[]) =>
    blocks.map((b) => (b.type === 'BUILTIN' ? b.builtin_widget : b.type));

describe('starter templates', () => {
    it('Courses only has the spec order and placements', () => {
        const { blocks } = buildTemplate('COURSES_ONLY');
        expect(kinds(blocks)).toEqual([
            'HERO',
            'BANNER_CAROUSEL',
            'CONTINUE_LEARNING',
            'ENROLLED_COURSES',
            'SHORTCUTS',
            'UPCOMING_LIVE_CLASSES',
            'COURSE_SHELF',
            'GAMIFICATION',
        ]);
        expect(blocks.map((b) => b.desktop_placement)).toEqual([
            'FULL',
            'FULL',
            'MAIN',
            'MAIN',
            'RAIL',
            'RAIL',
            'MAIN',
            'FULL',
        ]);
    });

    it('Classroom puts the notice and live classes near the top', () => {
        const { blocks } = buildTemplate('CLASSROOM');
        expect(kinds(blocks)).toEqual([
            'HERO',
            'NOTICE',
            'UPCOMING_LIVE_CLASSES',
            'EVENT',
            'TODAY_TASKS',
            'CONTINUE_LEARNING',
            'SHORTCUTS',
            'ENROLLED_COURSES',
            'THIS_WEEK_ATTENDANCE',
            'STATS_ROW',
            'MY_MENTORS',
            'PINS',
            'RAISE_QUERY',
        ]);
        const notice = blocks[1]!;
        expect(notice.type === 'NOTICE' && notice.config.require_ack).toBe(true);
    });

    it('Storefront leads with the banner and keeps the store tile only with a store site', () => {
        const withStore = buildTemplate('STOREFRONT', { hasStoreSite: true }).blocks;
        expect(kinds(withStore)[0]).toBe('BANNER_CAROUSEL');
        expect(kinds(withStore)[1]).toBe('HERO');
        const tiles = (b: HomeBlock[]) => {
            const s = b.find((x) => x.type === 'SHORTCUTS');
            return s && s.type === 'SHORTCUTS'
                ? s.config.tiles.map((t) => (t.link?.kind === 'FEATURE' ? t.link.feature : null))
                : [];
        };
        expect(tiles(withStore)).toContain('STORE_MEMBERSHIPS');
        expect(tiles(buildTemplate('STOREFRONT').blocks)).not.toContain('STORE_MEMBERSHIPS');
        const shelves = withStore.filter((b) => b.type === 'COURSE_SHELF');
        expect(shelves.map((s) => s.type === 'COURSE_SHELF' && s.config.source)).toEqual([
            'FREE',
            'TAG',
            'NEWEST',
        ]);
        expect(shelves.every((s) => s.type === 'COURSE_SHELF' && s.config.hide_owned)).toBe(true);
    });

    it.each(STARTER_TEMPLATES)(
        '%s: unique keys, one of each built-in, HERO present, survives a save round trip',
        (key) => {
            const { blocks, settings } = buildTemplate(key, { hasStoreSite: true });
            const keys = blocks.map((b) => b.block_key);
            expect(new Set(keys).size).toBe(keys.length);
            const builtins = blocks
                .filter((b) => b.type === 'BUILTIN')
                .map((b) => b.builtin_widget);
            expect(new Set(builtins).size).toBe(builtins.length);
            expect(builtins).toContain('HERO');
            const body = buildCreatePayload(key, settings, blocks);
            expect(
                normalizeLayout({ blocks: body.blocks, settings: body.settings }).blocks
            ).toEqual(body.blocks);
        }
    );

    it.each([
        // Placeholders only: the empty banner slides, the empty event and the tag shelf / free tile.
        ['COURSES_ONLY', ['IMAGE_REQUIRED']],
        ['CLASSROOM', ['REQUIRED', 'EVENT_TIMES_REQUIRED']],
        [
            'STOREFRONT',
            ['IMAGE_REQUIRED', 'IMAGE_REQUIRED', 'IMAGE_REQUIRED', 'LINK_REQUIRED', 'TOO_FEW'],
        ],
    ] as const)('%s: the checks flag only the intended placeholders', (key, codes) => {
        const { blocks } = buildTemplate(key, { hasStoreSite: true });
        expect(errorsOf(runPublishChecks(blocks)).map((i) => i.code)).toEqual(codes);
    });

    it('two builds never share keys', () => {
        const a = buildTemplate('CLASSROOM').blocks.map((b) => b.block_key);
        const b = new Set(buildTemplate('CLASSROOM').blocks.map((x) => x.block_key));
        expect(a.some((k) => b.has(k))).toBe(false);
    });
});
