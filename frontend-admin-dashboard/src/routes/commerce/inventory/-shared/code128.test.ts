/** Code 128 set B: reference patterns, checksums and widths (owner decision 2026-11-18, labels printed in the browser). */
import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, code128Bars, encodeCode128B, isCode128B, QUIET_ZONE_MODULES } from './code128';

describe('Code 128 B', () => {
    it('the table has 107 symbols of 11 modules (the stop 13), 3 bars and 3 spaces each', () => {
        expect(CODE128_PATTERNS).toHaveLength(107);
        CODE128_PATTERNS.forEach((pattern, value) => {
            const sum = Array.from(pattern, Number).reduce((a, b) => a + b, 0);
            expect(sum, `symbol ${value}`).toBe(value === 106 ? 13 : 11);
        });
    });

    it('"A" is start B, A, check 34, stop', () => {
        const { values, checksum, widths } = encodeCode128B('A');
        expect(values).toEqual([104, 33, 34, 106]);
        expect(checksum).toBe(34);
        expect(widths.join('')).toBe('211214' + '111323' + '131123' + '2331112');
    });

    it('the check symbol of the reference "PJJ123C" is 55', () => {
        expect(encodeCode128B('PJJ123C').checksum).toBe(55);
    });

    it('a 10-character label code is 11 × (n + 3) + 2 modules, plus the quiet zones', () => {
        const code = 'PABCDEFGH2';
        const encoded = encodeCode128B(code);
        expect(encoded.modules).toBe(11 * (code.length + 3) + 2);
        const { bars, totalModules } = code128Bars(code);
        expect(totalModules).toBe(encoded.modules + 2 * QUIET_ZONE_MODULES);
        expect(bars[0]?.x).toBe(QUIET_ZONE_MODULES);
        const last = bars[bars.length - 1];
        expect((last?.x ?? 0) + (last?.width ?? 0)).toBe(totalModules - QUIET_ZONE_MODULES);
        // Bars and spaces alternate: 3 bars per symbol, 4 in the stop.
        expect(bars).toHaveLength(3 * (code.length + 2) + 4);
    });

    it('takes printable ASCII only', () => {
        expect(isCode128B('VABCDEFGH2')).toBe(true);
        expect(isCode128B('')).toBe(false);
        expect(isCode128B('कपड़ा')).toBe(false);
        expect(() => encodeCode128B('a\tb')).toThrow();
    });
});
