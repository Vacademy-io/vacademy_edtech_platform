import { describe, expect, it } from 'vitest';
import { createBuiltinBlock, createContentBlock, emptySlide } from './block-factory';
import { normalizeBlock, normalizeLayout } from './normalize';
import { blockPayload, buildSavePayload, payloadBytes } from './payload';

describe('payload building', () => {
    it('sends the ordered list with no position field and trims text', () => {
        const notice = createContentBlock(
            'NOTICE',
            { title: '  Hello  ', body: 'Line 1\nLine 2\n\n' },
            { admin_label: '   ' }
        );
        const body = buildSavePayload(
            4,
            { phone_spacing: 'COMFORTABLE', show_header: false, carousel_autoplay_default: true },
            [createBuiltinBlock('HERO'), notice]
        );
        expect(body.revision).toBe(4);
        expect(body.blocks.map((b) => b.type)).toEqual(['BUILTIN', 'NOTICE']);
        expect(body.blocks[1]).not.toHaveProperty('position');
        const n = body.blocks[1]!;
        expect(n.type === 'NOTICE' && n.config.title).toBe('Hello');
        expect(n.type === 'NOTICE' && n.config.body).toBe('Line 1\nLine 2');
        expect(n.admin_label).toBeNull();
        expect(body.settings).toEqual({
            phone_spacing: 'COMFORTABLE',
            show_header: false,
            carousel_autoplay_default: true,
        });
    });

    it('keeps only the list the shelf source uses', () => {
        const shelf = createContentBlock('COURSE_SHELF', {
            title: 'x',
            source: 'TAG',
            tags: ['a'],
            package_ids: ['p1'],
        });
        const out = blockPayload(shelf);
        expect(out.type === 'COURSE_SHELF' && out.config.package_ids).toEqual([]);
        expect(out.type === 'COURSE_SHELF' && out.config.tags).toEqual(['a']);
    });

    it('drops event times for a live-session event and alt for a decorative image', () => {
        const ev = createContentBlock('EVENT', {
            title: 'x',
            source: 'LIVE_SESSION',
            live_session_id: 's1',
            starts_at: '2026-12-01T13:30:00Z',
            image: { file_id: 'f', alt: 'old alt', decorative: true, url: 'https://a/b.png' },
        });
        const out = blockPayload(ev);
        expect(out.type === 'EVENT' && out.config.starts_at).toBeNull();
        expect(out.type === 'EVENT' && out.config.image?.alt).toBe('');
    });

    it('strips options a built-in does not take and de-duplicates audience ids', () => {
        const stats = createBuiltinBlock('STATS_ROW', {
            options: { cards: ['EVALUATIONS', 'COURSES'], show_all: true },
        });
        expect(blockPayload(stats).config).toEqual({
            options: { cards: ['COURSES', 'EVALUATIONS'] },
        });
        const b = {
            ...createBuiltinBlock('PINS'),
            audience: {
                mode: 'RULES' as const,
                all_of: [{ kind: 'USER_TAG' as const, tag_ids: ['t', 't'] }],
            },
        };
        expect(blockPayload(b).audience).toEqual({
            mode: 'RULES',
            all_of: [{ kind: 'USER_TAG', tag_ids: ['t'] }],
        });
    });

    it('a saved payload reads back identically', () => {
        const blocks = [
            createBuiltinBlock('HERO'),
            createContentBlock('BANNER_CAROUSEL', {
                slides: [
                    emptySlide(),
                    {
                        ...emptySlide(),
                        image: {
                            file_id: 'f',
                            alt: 'A',
                            decorative: false,
                            url: 'https://a/b.png',
                            width: 1600,
                            height: 800,
                        },
                        link: { kind: 'COURSE', package_id: 'p' },
                    },
                ],
            }),
            createContentBlock('SHORTCUTS', {
                tiles: [
                    {
                        key: 'k',
                        label: 'L',
                        icon: { kind: 'ICON', name: 'Star' },
                        link: { kind: 'FEATURE', feature: 'PROFILE' },
                    },
                ],
            }),
            createContentBlock('EVENT', {
                title: 'E',
                starts_at: '2026-12-01T13:30:00.000Z',
                ends_at: '2026-12-01T15:00:00.000Z',
                register_cta: {
                    label: 'Join',
                    link: { kind: 'URL', url: 'https://a.com', sells_something: false },
                },
            }),
        ];
        const body = buildSavePayload(
            1,
            { phone_spacing: 'COMPACT', show_header: true, carousel_autoplay_default: true },
            blocks
        );
        const back = normalizeLayout({
            blocks: JSON.parse(JSON.stringify(body.blocks)),
            settings: body.settings,
        });
        expect(back.blocks).toEqual(body.blocks);
        expect(payloadBytes(body)).toBeGreaterThan(100);
    });

    it('normalizeBlock drops unknown types and unknown keys', () => {
        expect(normalizeBlock({ type: 'MYSTERY' })).toBeNull();
        expect(normalizeBlock({ type: 'BUILTIN', builtin_widget: 'NOPE' })).toBeNull();
        const b = normalizeBlock({
            type: 'NOTICE',
            block_key: 'k1',
            config: { title: 'T', surprise: 1 },
            extra: true,
        });
        expect(b).not.toHaveProperty('extra');
        expect(b?.config).not.toHaveProperty('surprise');
        expect(b?.block_key).toBe('k1');
    });
});
