import { describe, expect, it } from 'vitest';
import type { FolderNode } from '../../-services/folder-library-service';
import {
    buildAdvancedPatch,
    draftFromNode,
    effectiveFolderSlug,
    hasAdvancedValues,
    isSafeFolderLink,
    isValidAccentColor,
    sanitizeSlugInput,
    slugFromText,
    suggestFolderSlug,
    takenFolderSlugs,
    validateAdvancedDraft,
} from './folder-node-advanced';

// Colour values under test — data, not styles.
const SHORT_HEX = '#abc'; // design-lint-ignore: test data
const LONG_HEX = '#A1B2C3'; // design-lint-ignore: test data
const RED = '#ff0000'; // design-lint-ignore: test data
const ANY_HEX = '#123456'; // design-lint-ignore: test data

const folder = (over: Partial<FolderNode> = {}): FolderNode => ({
    id: 'f-1',
    node_type: 'FOLDER',
    title: 'शिक्षा',
    display_order: 0,
    status: 'ACTIVE',
    children: [],
    ...over,
});

describe('link keys', () => {
    it('derives a key the way the learner folderSlug() does', () => {
        expect(slugFromText('Education & Ethics')).toBe('education-ethics');
        expect(slugFromText('  Café Crème ')).toBe('cafe-creme');
        expect(slugFromText('शिक्षा')).toBe('');
    });

    it('resolves the live key: explicit slug, else subtitle, else title, else id', () => {
        expect(effectiveFolderSlug(folder({ slug: 'shiksha', subtitle: 'EDUCATION' }))).toBe('shiksha');
        expect(effectiveFolderSlug(folder({ subtitle: 'EDUCATION' }))).toBe('education');
        expect(effectiveFolderSlug(folder({ title: 'Dharma' }))).toBe('dharma');
        // A Hindi-only title has no latin key: the id stands in, as on the site.
        expect(effectiveFolderSlug(folder())).toBe('f-1');
        // Learner rule: a subtitle that yields nothing does NOT fall back to the title.
        expect(effectiveFolderSlug(folder({ title: 'Dharma', subtitle: 'धर्म' }))).toBe('f-1');
    });

    it('suggests from the subtitle, else the title, capped at 120 without a trailing dash', () => {
        expect(suggestFolderSlug('EDUCATION', 'शिक्षा')).toBe('education');
        expect(suggestFolderSlug('धर्म', 'Dharma')).toBe('dharma');
        expect(suggestFolderSlug('', 'शिक्षा')).toBe('');
        const long = suggestFolderSlug(`${'a'.repeat(119)} b`, '');
        expect(long.length).toBeLessThanOrEqual(120);
        expect(long.endsWith('-')).toBe(false);
    });

    it('keeps typed keys inside the allowed alphabet', () => {
        expect(sanitizeSlugInput('Shiksha Stream!')).toBe('shiksha-stream');
        expect(sanitizeSlugInput('x'.repeat(200))).toHaveLength(120);
    });

    it('lists the keys other folders answer to, skipping the one being edited and product pages', () => {
        const roots = [
            folder({ id: 'a', title: 'Shiksha', slug: 'shiksha', children: [folder({ id: 'a1', title: 'Vedas' })] }),
            folder({ id: 'b', title: 'Dharma' }),
            { ...folder({ id: 'p', title: 'Store' }), node_type: 'PRODUCT_PAGE' as const },
        ];
        const taken = takenFolderSlugs(roots, 'b', (n) => n.title || '');
        expect([...taken.keys()]).toEqual(['shiksha', 'vedas']);
        expect(taken.get('vedas')).toBe('Vedas');
    });
});

describe('link and colour checks', () => {
    it('accepts site routes and http(s) links only', () => {
        expect(isSafeFolderLink('')).toBe(true);
        expect(isSafeFolderLink('/courses?stream=shiksha')).toBe(true);
        expect(isSafeFolderLink('https://example.org/x')).toBe(true);
        expect(isSafeFolderLink('http://example.org')).toBe(true);
        expect(isSafeFolderLink('javascript:alert(1)')).toBe(false);
        expect(isSafeFolderLink('data:text/html,hi')).toBe(false);
        expect(isSafeFolderLink('//evil.example')).toBe(false);
        expect(isSafeFolderLink('/\\evil.example')).toBe(false);
        expect(isSafeFolderLink('courses')).toBe(false);
        expect(isSafeFolderLink('https://')).toBe(false);
    });

    it('follows the server’s link rule exactly (CatalogueFolderService.linkUrlOrNull)', () => {
        // Accepted there, so accepted here: spaces inside a site route or after the host.
        expect(isSafeFolderLink('/courses?q=yoga basics')).toBe(true);
        expect(isSafeFolderLink('https://example.org/a b')).toBe(true);
        expect(isSafeFolderLink('HTTPS://Example.org?x=1')).toBe(true);
        expect(isSafeFolderLink('https://example.org#top')).toBe(true);
        // Refused there, so refused here.
        expect(isSafeFolderLink('/\tevil.example')).toBe(false);
        expect(isSafeFolderLink('/courses\n')).toBe(true); // trimmed first, as the server does
        expect(isSafeFolderLink('/cour\nses')).toBe(false);
        expect(isSafeFolderLink(`/a${String.fromCharCode(0x7f)}`)).toBe(false);
        expect(isSafeFolderLink('https:///path')).toBe(false);
        expect(isSafeFolderLink('https://exa mple.org')).toBe(false);
        expect(isSafeFolderLink('https://evil\\example.org')).toBe(false);
        expect(isSafeFolderLink('https://?q=1')).toBe(false);
        expect(isSafeFolderLink('ftp://example.org')).toBe(false);
        // Java's idea of whitespace in the host: an ideographic space counts, a no-break space does not.
        expect(isSafeFolderLink(`https://exa${String.fromCharCode(0x3000)}mple.org`)).toBe(false);
        expect(isSafeFolderLink(`https://exa${String.fromCharCode(0xa0)}mple.org`)).toBe(true);
    });

    it('accepts #rgb, #rrggbb and #rrggbbaa', () => {
        expect(isValidAccentColor(SHORT_HEX)).toBe(true);
        expect(isValidAccentColor(LONG_HEX)).toBe(true);
        expect(isValidAccentColor('#a1b2c3d4')).toBe(true);
        expect(isValidAccentColor('red')).toBe(false);
        expect(isValidAccentColor('#abcd')).toBe(false);
        expect(isValidAccentColor(null)).toBe(false);
    });

    it('reports the first problem that the server would refuse', () => {
        const ok = draftFromNode(folder());
        expect(validateAdvancedDraft(ok, 'FOLDER')).toBeNull();
        expect(validateAdvancedDraft({ ...ok, slug: 'Bad Key' }, 'FOLDER')).toMatch(/link key/i);
        expect(validateAdvancedDraft({ ...ok, linkUrl: 'javascript:x' }, 'FOLDER')).toMatch(/link must/i);
        expect(validateAdvancedDraft({ ...ok, accentColor: 'orange' }, 'FOLDER')).toMatch(/accent/i);
        expect(validateAdvancedDraft({ ...ok, courseTag: 'x'.repeat(192) }, 'FOLDER')).toMatch(/course tag/i);
        // Folder-only fields are not offered on product-page items, so they cannot block them.
        expect(validateAdvancedDraft({ ...ok, linkUrl: 'javascript:x', slug: 'Bad' }, 'PRODUCT_PAGE')).toBeNull();
    });

    it('refuses a course tag with a comma and a link over 2048 characters, as the server does', () => {
        const ok = draftFromNode(folder());
        expect(validateAdvancedDraft({ ...ok, courseTag: 'yoga,ayurveda' }, 'FOLDER')).toMatch(/cannot contain commas/);
        expect(validateAdvancedDraft({ ...ok, courseTag: 'yoga-ayurveda' }, 'FOLDER')).toBeNull();
        expect(validateAdvancedDraft({ ...ok, linkUrl: `/${'a'.repeat(2048)}` }, 'FOLDER')).toMatch(/too long/);
        expect(validateAdvancedDraft({ ...ok, linkUrl: `/${'a'.repeat(2047)}` }, 'FOLDER')).toBeNull();
        expect(validateAdvancedDraft({ ...ok, linkUrl: '/courses\t/x' }, 'FOLDER')).toMatch(/line break or tab/);
    });

    it('checks only what the save sends: a stored value it would not accept never blocks a rename', () => {
        // Written by another client or under an older rule: untouched, it is not this save's business.
        const stored = folder({ link_url: '/courses?q=yoga\tbasics', course_tag: 'a,b', accent_color: 'orange' });
        expect(validateAdvancedDraft(draftFromNode(stored), 'FOLDER', stored)).toBeNull();
        // Changing one of them checks that one.
        expect(
            validateAdvancedDraft({ ...draftFromNode(stored), linkUrl: 'javascript:x' }, 'FOLDER', stored)
        ).toMatch(/link must/i);
        // Clearing a field sends '' — nothing to check.
        expect(validateAdvancedDraft({ ...draftFromNode(stored), courseTag: '' }, 'FOLDER', stored)).toBeNull();
    });
});

describe('buildAdvancedPatch', () => {
    it('sends nothing for an untouched item, so the request is exactly the old one', () => {
        const node = folder({ slug: 'shiksha', subtitle: 'EDUCATION', coming_soon: true, audience_id: 'aud-1' });
        expect(buildAdvancedPatch(node, draftFromNode(node), 'FOLDER')).toEqual({});
        expect(buildAdvancedPatch(null, draftFromNode(null), 'FOLDER')).toEqual({});
    });

    it('sends only changed fields on update, with "" to clear', () => {
        const node = folder({ slug: 'shiksha', subtitle: 'EDUCATION', accent_color: RED });
        const draft = { ...draftFromNode(node), subtitle: '', tagline: ' Learn ', accentColor: RED };
        expect(buildAdvancedPatch(node, draft, 'FOLDER')).toEqual({ subtitle: '', tagline: 'Learn' });
    });

    it('sends only set fields on create, and coming_soon only when on', () => {
        const draft = { ...draftFromNode(null), slug: 'shiksha', comingSoon: true, audienceId: 'aud-1' };
        expect(buildAdvancedPatch(null, draft, 'FOLDER')).toEqual({
            slug: 'shiksha',
            coming_soon: true,
            audience_id: 'aud-1',
        });
    });

    it('turns coming soon off explicitly', () => {
        const node = folder({ coming_soon: true });
        expect(buildAdvancedPatch(node, { ...draftFromNode(node), comingSoon: false }, 'FOLDER')).toEqual({
            coming_soon: false,
        });
    });

    it('never sends folder-only fields for a product-page item', () => {
        const draft = {
            ...draftFromNode(null),
            slug: 'x',
            courseTag: 'y',
            linkUrl: '/z',
            comingSoon: true,
            audienceId: 'a',
            subtitle: 'Path',
            accentColor: ANY_HEX,
        };
        expect(buildAdvancedPatch(null, draft, 'PRODUCT_PAGE')).toEqual({ subtitle: 'Path', accent_color: ANY_HEX });
    });

    it('knows when an item already uses the section', () => {
        expect(hasAdvancedValues(folder())).toBe(false);
        expect(hasAdvancedValues(folder({ coming_soon: true }))).toBe(true);
        expect(hasAdvancedValues(folder({ tagline: 'x' }))).toBe(true);
        expect(hasAdvancedValues(null)).toBe(false);
    });
});
