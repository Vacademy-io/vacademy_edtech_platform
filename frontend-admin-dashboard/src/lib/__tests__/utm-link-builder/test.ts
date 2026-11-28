import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildUtmUrl,
    cleanUtmValues,
    getRecentUtmValues,
    normalizeUtmValue,
    normalizeUtmValueLive,
    readUtmFromUrl,
    rememberUtmValues,
    stripUtmFromUrl,
} from '@/lib/utm';

describe('building a campaign link', () => {
    // The reason this module exists: every share surface hands out a URL that
    // ALREADY carries a query string. String-concatenating "?utm_source=..."
    // onto one produces a URL with two '?', and everything after the second is
    // swallowed into the previous parameter's value — silently dropping the
    // institute id and 404-ing the link the admin just shared.
    it('appends to a link that already has query parameters', () => {
        const url = buildUtmUrl(
            'https://learn.example.com/audience-response?instituteId=inst-1&audienceId=aud-9',
            { utm_source: 'whatsapp', utm_medium: 'social' }
        );
        const parsed = new URL(url);
        expect(parsed.searchParams.get('instituteId')).toBe('inst-1');
        expect(parsed.searchParams.get('audienceId')).toBe('aud-9');
        expect(parsed.searchParams.get('utm_source')).toBe('whatsapp');
        expect(parsed.searchParams.get('utm_medium')).toBe('social');
        expect(url.match(/\?/g)).toHaveLength(1);
    });

    it('appends to a link with no query string', () => {
        const url = buildUtmUrl('https://learn.example.com/my-catalogue', {
            utm_source: 'instagram',
            utm_medium: 'social',
        });
        expect(url).toContain('/my-catalogue?');
        expect(new URL(url).searchParams.get('utm_source')).toBe('instagram');
    });

    it('omits parameters left blank rather than emitting empty ones', () => {
        const url = buildUtmUrl('https://learn.example.com/x', {
            utm_source: 'google',
            utm_medium: 'cpc',
            utm_campaign: '   ',
            utm_term: '',
        });
        expect(url).not.toContain('utm_campaign');
        expect(url).not.toContain('utm_term');
    });

    it('replaces rather than duplicates a parameter the link already carried', () => {
        const url = buildUtmUrl('https://learn.example.com/x?utm_source=old', {
            utm_source: 'new',
        });
        expect(url.match(/utm_source/g)).toHaveLength(1);
        expect(new URL(url).searchParams.get('utm_source')).toBe('new');
    });

    it('returns an empty string for a missing base, so callers can disable copy', () => {
        expect(buildUtmUrl('', { utm_source: 'x' })).toBe('');
        expect(buildUtmUrl('   ', { utm_source: 'x' })).toBe('');
    });

    it('still produces something usable for a non-absolute base', () => {
        // Not expected from any surface today, but a dropdown must not throw.
        const url = buildUtmUrl('/audience-response?instituteId=1', { utm_source: 'sms' });
        expect(url).toBe('/audience-response?instituteId=1&utm_source=sms');
    });
});

describe('normalising values', () => {
    // GA reports "Google Ads", "google ads" and "google+ads" as three separate
    // rows, which is how one campaign becomes four lines in a report.
    it('lowercases and hyphenates so one campaign stays one row', () => {
        expect(normalizeUtmValue('  Diwali Sale 2026 ')).toBe('diwali-sale-2026');
        expect(normalizeUtmValue('Google Ads')).toBe('google-ads');
    });

    it('drops characters that would be percent-encoded into unreadable rows', () => {
        expect(normalizeUtmValue('summer#$%sale')).toBe('summersale');
    });

    it('keeps the characters GA treats as safe', () => {
        expect(normalizeUtmValue('spring_2026.v2-a/b+c')).toBe('spring_2026.v2-a/b+c');
    });

    it('caps a pasted essay at a storable length', () => {
        expect(normalizeUtmValue('a'.repeat(500))).toHaveLength(120);
    });
});

describe('typing a two-word campaign, character by character', () => {
    // The bug this covers: the full normaliser trims, so the moment the space
    // in "Black Friday" is typed the value is "black " -> trimmed to "black",
    // and the next character lands flush against it. The admin silently gets
    // "blackfriday" and cannot type the hyphen themselves.
    const type = (text: string, normalise: (v: string) => string) => {
        let state = '';
        for (const ch of text) state = normalise(state + ch);
        return state;
    };

    it('keeps the space long enough for it to become a hyphen', () => {
        expect(type('Black Friday', normalizeUtmValueLive)).toBe('black-friday');
    });

    it('is what the OLD trimming normaliser got wrong', () => {
        // Regression guard: this is the behaviour we moved away from.
        expect(type('Black Friday', normalizeUtmValue)).toBe('blackfriday');
    });

    it('still trims once the value is finalised on blur', () => {
        expect(normalizeUtmValue(normalizeUtmValueLive('  Diwali Sale  '))).toBe('diwali-sale');
    });

    it('pasting the whole value at once gives the same answer as typing it', () => {
        expect(normalizeUtmValue('Black Friday')).toBe(type('Black Friday', normalizeUtmValueLive));
    });
});

describe('reading a link that is already tagged', () => {
    it('pre-fills the builder from the existing parameters', () => {
        const values = readUtmFromUrl(
            'https://learn.example.com/x?instituteId=1&utm_source=meta&utm_campaign=diwali'
        );
        expect(values).toEqual({ utm_source: 'meta', utm_campaign: 'diwali' });
    });

    it("strips the tags to recover the surface's own link", () => {
        const base = stripUtmFromUrl(
            'https://learn.example.com/x?instituteId=1&utm_source=meta&utm_term=neet'
        );
        expect(base).toBe('https://learn.example.com/x?instituteId=1');
    });

    it('returns nothing for an unparseable URL instead of throwing', () => {
        expect(readUtmFromUrl('not a url')).toEqual({});
    });
});

describe('cleanUtmValues', () => {
    it('keeps only non-blank entries, trimmed', () => {
        expect(cleanUtmValues({ utm_source: ' meta ', utm_medium: '', utm_term: '  ' })).toEqual({
            utm_source: 'meta',
        });
    });
});

describe('recently used values', () => {
    beforeEach(() => localStorage.clear());

    it('offers the most recent first, without duplicates', () => {
        rememberUtmValues({ utm_campaign: 'diwali' });
        rememberUtmValues({ utm_campaign: 'holi' });
        rememberUtmValues({ utm_campaign: 'diwali' });
        expect(getRecentUtmValues('utm_campaign')).toEqual(['diwali', 'holi']);
    });

    it('keeps the lists per field', () => {
        rememberUtmValues({ utm_source: 'meta', utm_medium: 'cpc' });
        expect(getRecentUtmValues('utm_source')).toEqual(['meta']);
        expect(getRecentUtmValues('utm_medium')).toEqual(['cpc']);
    });

    it('answers with an empty list when storage holds junk', () => {
        localStorage.setItem('vacademy_utm_recent', '{not json');
        expect(getRecentUtmValues('utm_source')).toEqual([]);
    });
});
