import { describe, expect, it } from 'vitest';
import { deinterleaveDuplex, splitOneFolder } from './split-passes';

const T0 = 1_731_900_000_000;

/** n files 1.5 s apart, with an extra pause after file `pauseAfter`. */
const pile = (n: number, pauseAfter?: number, pauseMs = 40_000) => {
    let t = T0;
    return Array.from({ length: n }, (_, i) => {
        const file = { name: i === 0 ? 'Scan.jpeg' : `Scan ${i}.jpeg`, lastModified: t };
        t += 1500 + (i === pauseAfter ? pauseMs : 0);
        return file;
    });
};

describe('splitOneFolder', () => {
    it('splits 24 files at the 40 s pause after the 12th', () => {
        const r = splitOneFolder(pile(24, 11));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.first).toHaveLength(12);
        expect(r.second).toHaveLength(12);
        expect(r.splitAfterName).toBe('Scan 11.jpeg');
        expect(r.second[0]!.name).toBe('Scan 12.jpeg');
    });

    it('refuses when there is no clear pause', () => {
        expect(splitOneFolder(pile(24))).toEqual({ ok: false, reason: 'NO_CLEAR_GAP' });
    });

    it('refuses when the biggest pause is not in the middle', () => {
        expect(splitOneFolder(pile(24, 9))).toEqual({ ok: false, reason: 'NO_CLEAR_GAP' });
    });

    it('refuses a pause too short to be a turned-over pile', () => {
        expect(splitOneFolder(pile(24, 11, 300))).toEqual({ ok: false, reason: 'NO_CLEAR_GAP' });
    });

    it('refuses an odd count', () => {
        expect(splitOneFolder(pile(23, 11))).toEqual({ ok: false, reason: 'ODD_COUNT' });
    });
});

describe('deinterleaveDuplex', () => {
    it('puts the 1st, 3rd, 5th… pages in the first pass and the rest in the second', () => {
        expect(deinterleaveDuplex(['f0', 'b0', 'f1', 'b1', 'f2', 'b2'])).toEqual({
            first: ['f0', 'f1', 'f2'],
            second: ['b0', 'b1', 'b2'],
        });
    });
});
