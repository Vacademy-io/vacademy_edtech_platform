import { describe, expect, it, vi } from 'vitest';
import { buildEmbedSnippet, keyPlaceholder, snippetHasFullKey } from './embed-snippet';
import { createSseParser, toStreamEvent } from './sse';
import { normalizeCard, safeHref } from './cards';

describe('embed snippet', () => {
    it('is the loader on the learner portal with the key and the site tag', () => {
        expect(
            buildEmbedSnippet({
                portalOrigin: 'https://learning.brahmvarchas.org/',
                key: 'vak_pub_abcdef123456',
                siteTag: 'bv-main',
            })
        ).toBe(
            '<script src="https://learning.brahmvarchas.org/site-assistant.js" data-key="vak_pub_abcdef123456" data-site="bv-main" async></script>'
        );
    });

    it('never carries a saved key in full: only its prefix and a visible placeholder', () => {
        const key = keyPlaceholder('vak_pub_ab12');
        expect(key).toBe('vak_pub_ab12…PASTE_YOUR_FULL_KEY');
        expect(snippetHasFullKey(key)).toBe(false);
        expect(snippetHasFullKey('vak_pub_ab12cd34')).toBe(true);
        expect(keyPlaceholder(null)).toBe('vak_pub_…PASTE_YOUR_FULL_KEY');
    });

    it('escapes attribute values', () => {
        expect(
            buildEmbedSnippet({ portalOrigin: 'https://x.org', key: 'k', siteTag: 'a"><b' })
        ).toContain('data-site="a&quot;&gt;&lt;b"');
    });
});

describe('SSE parser', () => {
    it('joins frames split across chunks and ignores comments', () => {
        const onFrame = vi.fn();
        const p = createSseParser(onFrame);
        p.push('event: tok');
        p.push('en\r\ndata: {"text":"a"}\r\n\r\n: ping\n\n');
        p.push('data: {"x":1}\ndata: {"y":2}\n\n');
        p.push('event: done\ndata: {}');
        p.flush();
        expect(onFrame.mock.calls).toEqual([
            ['token', '{"text":"a"}'],
            ['message', '{"x":1}\n{"y":2}'],
            ['done', '{}'],
        ]);
    });

    it('maps error codes and drops malformed frames', () => {
        expect(toStreamEvent('error', '{"code":"daily_cap","message":"limit"}')).toEqual({
            type: 'error',
            code: 'daily_cap',
            message: 'limit',
        });
        expect(toStreamEvent('error', '{"code":"weird"}')).toMatchObject({ code: 'internal' });
        expect(toStreamEvent('token', 'not json')).toBeNull();
        expect(toStreamEvent('unknown', '{}')).toBeNull();
    });
});

describe('cards', () => {
    it('keeps https and site-relative links only', () => {
        expect(safeHref('https://a.org/x')).toBe('https://a.org/x');
        expect(safeHref('/courses/1')).toBe('/courses/1');
        expect(safeHref('//evil.org')).toBeNull();
        expect(safeHref('http://a.org')).toBeNull();
        expect(safeHref('javascript:alert(1)')).toBeNull();
    });

    it('refuses backslash and whitespace tricks that browsers read as another host', () => {
        expect(safeHref('/\\evil.org')).toBeNull();
        expect(safeHref('\\\\evil.org')).toBeNull();
        expect(safeHref('/\\/evil.org/x')).toBeNull();
        expect(safeHref('https://a.org\\@evil.org')).toBeNull();
        expect(safeHref('/a b')).toBeNull();
        expect(safeHref('/x\u0000y')).toBeNull();
        expect(safeHref('/courses/a-b')).toBe('/courses/a-b');
    });

    it('reads a course list, flat or wrapped in data', () => {
        const flat = normalizeCard({
            type: 'course_list',
            items: [{ id: 'c1', title: 'Vedic Parenting', price_label: '₹999', url: '/c/1' }],
        });
        const wrapped = normalizeCard({
            type: 'course_list',
            data: {
                items: [{ id: 'c1', title: 'Vedic Parenting', price_label: '₹999', url: '/c/1' }],
            },
        });
        expect(flat).toEqual(wrapped);
        expect(flat).toMatchObject({
            type: 'course_list',
            items: [{ id: 'c1', title: 'Vedic Parenting', priceLabel: '₹999', url: '/c/1' }],
        });
    });
});
