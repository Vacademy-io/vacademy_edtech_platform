import { describe, expect, it } from 'vitest';
import { acksCsv, dayInZone, formatCtr, resultsRange } from './results';
import { FALLBACK_TIMEZONE } from '@/utils/timezone';

/** India Standard Time: the platform's fallback zone. */
const IST = FALLBACK_TIMEZONE;

describe('results helpers', () => {
    it('counts days in the institute zone', () => {
        // 20:00 UTC on 16 Nov is already 17 Nov in India.
        const now = new Date('2026-11-16T20:00:00Z');
        expect(dayInZone(now, IST)).toBe('2026-11-17');
        expect(dayInZone(now, 'UTC')).toBe('2026-11-16');
        expect(resultsRange(7, IST, now)).toEqual({
            from: '2026-11-11',
            to: '2026-11-17',
        });
        expect(resultsRange(30, 'UTC', new Date('2026-03-01T10:00:00Z'))).toEqual({
            from: '2026-01-31',
            to: '2026-03-01',
        });
    });

    it('formats click rates', () => {
        expect(formatCtr(0, 0)).toBe('–');
        expect(formatCtr(5, 100)).toBe('5.0%');
        expect(formatCtr(30, 100)).toBe('30%');
        expect(formatCtr(1, 2, 0.25)).toBe('25%');
    });

    it('escapes CSV cells', () => {
        const csv = acksCsv(
            [
                {
                    user_id: 'u',
                    full_name: 'Shah, "Asha"',
                    email: 'a@x.com',
                    acknowledged_at: '2026-11-16T09:00:00Z',
                },
            ],
            ['Name', 'Email', 'Read on']
        );
        expect(csv).toBe('Name,Email,Read on\r\n"Shah, ""Asha""",a@x.com,2026-11-16T09:00:00Z\r\n');
    });
});
