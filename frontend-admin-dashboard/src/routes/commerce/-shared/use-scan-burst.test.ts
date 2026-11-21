/** WP-44 W6: a label scanned into a length box is a scan, not a length. */
import { describe, expect, it } from 'vitest';
import { nextBurst, scanAtEnter, SCAN_KEY_GAP_MS } from './use-scan-burst';

const burstOf = (keys: string, before: string, start: number, gap: number) =>
    keys.split('').reduce<ReturnType<typeof nextBurst> | null>(
        (burst, key, i) => nextBurst(burst, key, before + keys.slice(0, i), start + i * gap),
        null
    );

describe('scanAtEnter', () => {
    it('keys under 30 ms apart ending in Enter are a scan; the box gets its old text back', () => {
        const burst = burstOf('V12', '1', 1000, 8);
        expect(scanAtEnter('1V12', burst, 1000 + 2 * 8 + 5)).toEqual({ code: 'V12', restore: '1' });
        // A numeric barcode too, which would otherwise read as a length.
        expect(scanAtEnter('8901234', burstOf('8901234', '', 0, 5), 35)).toEqual({ code: '8901234', restore: '' });
    });

    it('a person typing (slow keys, or only two keys) is a length', () => {
        const slow = burstOf('2.5', '', 0, 120);
        expect(slow?.keys).toBe('5');
        expect(scanAtEnter('2.5', slow, 400)).toBeNull();
        expect(scanAtEnter('12', burstOf('12', '', 0, 5), 10)).toBeNull();
        // Enter long after a fast burst is a person pressing Enter.
        expect(scanAtEnter('123', burstOf('123', '', 0, 5), 10 + SCAN_KEY_GAP_MS + 50)).toBeNull();
    });

    it('text with a letter at Enter is a slow scanner, whatever the timing', () => {
        expect(scanAtEnter('V-HOSE', null, 0)).toEqual({ code: 'V-HOSE', restore: '' });
        // Hindi digits are digits, not letters.
        expect(scanAtEnter('२.५', null, 0)).toBeNull();
    });
});
