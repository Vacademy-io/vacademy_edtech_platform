import { describe, expect, it } from 'vitest';
import { EMPTY_DARK_SHARE, looksLikeWrongSide } from './blank-sides';

describe('a one-sided pile put in the wrong way up', () => {
    it('is most pages empty', () => {
        expect(looksLikeWrongSide([0, 0.0005, 0.001, 0.02])).toBe(true);
        expect(looksLikeWrongSide([0, 0.0005])).toBe(true);
    });

    it('is not a pile with a few empty pages', () => {
        expect(looksLikeWrongSide([0, 0.02, 0.03])).toBe(false);
        expect(looksLikeWrongSide([0.01, 0.02, 0.03, 0])).toBe(false);
    });

    it('never decides on pages it could not measure', () => {
        expect(looksLikeWrongSide([])).toBe(false);
        expect(looksLikeWrongSide([null, null])).toBe(false);
        expect(looksLikeWrongSide([null, 0, 0])).toBe(true);
        expect(looksLikeWrongSide([EMPTY_DARK_SHARE])).toBe(false);
    });
});
