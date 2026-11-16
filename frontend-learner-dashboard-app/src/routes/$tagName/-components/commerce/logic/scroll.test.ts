import { describe, expect, it } from 'vitest';
import { SCROLL_STORE_KEY, readScrollPositions, rememberScroll, scrollKey, scrollTarget, writeScrollPositions } from './scroll';

describe('scroll positions of shop pages', () => {
    it('keys a position by the address without language and campaign parameters', () => {
        expect(scrollKey('/c/sarees/', '?lang=en&utm_source=wa')).toBe('/c/sarees');
        expect(scrollKey('/c/sarees', '?sort=newest&f.colour=red')).toBe('/c/sarees?f.colour=red&sort=newest');
        expect(scrollKey('/c/sarees', '?f.colour=red&sort=newest')).toBe(scrollKey('/c/sarees', '?sort=newest&f.colour=red'));
        expect(scrollKey('/', '')).toBe('/');
    });

    it('remembers the newest positions and forgets the oldest', () => {
        let positions = {};
        for (let i = 0; i < 45; i += 1) positions = rememberScroll(positions, `/p/${i}`, i * 10.4);
        expect(Object.keys(positions)).toHaveLength(40);
        expect(positions).not.toHaveProperty('/p/0');
        expect(positions).toHaveProperty('/p/44', 458);
        // Touching an old key makes it the newest.
        positions = rememberScroll(positions, '/p/5', 7);
        expect(Object.keys(positions).pop()).toBe('/p/5');
    });

    it('survives a broken or missing store', () => {
        expect(readScrollPositions(null)).toEqual({});
        expect(readScrollPositions({ getItem: () => 'not json' })).toEqual({});
        expect(readScrollPositions({ getItem: () => '{"/c/a":120,"/c/b":"x","/c/c":-4}' })).toEqual({ '/c/a': 120 });
        const written: Record<string, string> = {};
        writeScrollPositions({ setItem: (k, v) => void (written[k] = v) }, { '/c/a': 120 });
        expect(JSON.parse(written[SCROLL_STORE_KEY] as string)).toEqual({ '/c/a': 120 });
        expect(() =>
            writeScrollPositions({ setItem: () => { throw new Error('full'); } }, {})
        ).not.toThrow();
    });

    it('opens a tapped page at the top', () => {
        expect(scrollTarget({ kind: 'push', samePage: false, remembered: 900 })).toBe(0);
    });

    it('returns to the remembered offset on Back, or the top when none is known', () => {
        expect(scrollTarget({ kind: 'pop', samePage: false, remembered: 900 })).toBe(900);
        expect(scrollTarget({ kind: 'pop', samePage: false, remembered: undefined })).toBe(0);
    });

    it('stays put when only filters, the variant or the language change', () => {
        expect(scrollTarget({ kind: 'replace', samePage: true, remembered: 300 })).toBeNull();
        expect(scrollTarget({ kind: 'push', samePage: true, remembered: undefined })).toBeNull();
    });

    it('restores after a reload and otherwise leaves the first page alone', () => {
        expect(scrollTarget({ kind: 'load', samePage: false, remembered: 640 })).toBe(640);
        expect(scrollTarget({ kind: 'load', samePage: false, remembered: undefined })).toBeNull();
    });
});
