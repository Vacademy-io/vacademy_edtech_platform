import { describe, expect, it } from 'vitest';
import {
    anchorId,
    cta,
    groupBy,
    leadFields,
    linkKind,
    mapsHref,
    normalizeMobile,
    records,
    siteRoute,
    str,
    strings,
    telHref,
    validateLead,
} from './content';

describe('content block props', () => {
    it('reads text, lists and records tolerantly', () => {
        expect(str('  Hello ')).toBe('Hello');
        expect(str(42)).toBe('42');
        expect(str({})).toBe('');
        expect(str('abcdef', 3)).toBe('abc');
        expect(strings(['a', '', 3, null, ' b '])).toEqual(['a', '3', 'b']);
        expect(strings('not a list')).toEqual([]);
        expect(records([{ a: 1 }, 'x', null, [1], { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
        expect(records(Array.from({ length: 30 }, () => ({})), 5)).toHaveLength(5);
    });

    it('takes a call to action only with both a label and a route', () => {
        expect(cta({ label: 'Shop now', route: 'shop' })).toEqual({ label: 'Shop now', route: 'shop' });
        expect(cta({ label: 'Shop now' })).toBeNull();
        expect(cta({ route: 'shop' })).toBeNull();
        expect(cta('shop')).toBeNull();
    });

    it('tells site pages, anchors and outside links apart, and refuses script links', () => {
        expect(linkKind('our-story')).toBe('site');
        expect(linkKind('c/sarees?sort=newest')).toBe('site');
        expect(linkKind('#apply')).toBe('anchor');
        expect(linkKind('https://wa.me/919876543210')).toBe('external');
        expect(linkKind('tel:+919876543210')).toBe('external');
        expect(linkKind('mailto:care@example.org')).toBe('external');
        expect(linkKind('javascript:alert(1)')).toBe('invalid');
        expect(linkKind('data:text/html,hi')).toBe('invalid');
        expect(linkKind('//evil.example')).toBe('invalid');
        expect(linkKind('#two words')).toBe('invalid');
        expect(linkKind('')).toBe('invalid');
        expect(siteRoute('/our-story')).toBe('our-story');
    });

    it('builds phone and map links only from usable data', () => {
        expect(telHref('+91 98765 43210')).toBe('tel:+919876543210');
        expect(telHref('call us')).toBe('');
        expect(mapsHref('https://maps.app.goo.gl/abc', 'Varanasi')).toBe('https://maps.app.goo.gl/abc');
        expect(mapsHref('http://insecure.example', 'Workshop 1, Varanasi')).toBe(
            'https://www.google.com/maps/search/?api=1&query=Workshop%201%2C%20Varanasi'
        );
        expect(mapsHref('', '')).toBe('');
    });

    it('makes safe anchor ids', () => {
        expect(anchorId('Reseller form')).toBe('reseller-form');
        expect(anchorId('  CSR / Loom ')).toBe('csr-loom');
        expect(anchorId('2024')).toBe('a-2024');
        expect(anchorId('<script>')).toBe('script');
        expect(anchorId(null)).toBe('');
    });

    it('groups items by region in first-seen order', () => {
        const groups = groupBy(
            [
                { name: 'Workshop 1', region: 'Uttar Pradesh' },
                { name: 'Workshop 2', region: 'Bihar' },
                { name: 'Workshop 3', region: 'Uttar Pradesh' },
                { name: 'Workshop 4' },
            ],
            'region'
        );
        expect(groups.map((g) => [g.name, g.items.length])).toEqual([
            ['Uttar Pradesh', 2],
            ['Bihar', 1],
            ['', 1],
        ]);
    });
});

describe('lead form', () => {
    it('always asks for name and phone, then the chosen fields in a fixed order', () => {
        expect(leadFields(undefined)).toEqual(['name', 'phone']);
        expect(leadFields(['message', 'city', 'aadhaar', 'EMAIL'])).toEqual(['name', 'phone', 'email', 'city', 'message']);
    });

    it('reads Indian mobile numbers in the usual ways', () => {
        expect(normalizeMobile('98765 43210')).toBe('9876543210');
        expect(normalizeMobile('+91-98765-43210')).toBe('9876543210');
        expect(normalizeMobile('098765 43210')).toBe('9876543210');
        expect(normalizeMobile('12345 67890')).toBeNull();
        expect(normalizeMobile('98765')).toBeNull();
    });

    it('reports what is missing or malformed, and nothing for a good form', () => {
        const fields = leadFields(['email', 'message']);
        expect(validateLead({}, fields)).toEqual({ name: 'required', phone: 'required' });
        expect(validateLead({ name: 'Asha', phone: '12345', email: 'nope' }, fields)).toEqual({ phone: 'phoneInvalid', email: 'emailInvalid' });
        expect(validateLead({ name: 'Asha', phone: '9876543210', email: '' }, fields)).toEqual({});
        expect(validateLead({ phone: '9876543210' }, ['phone'])).toEqual({});
    });
});
