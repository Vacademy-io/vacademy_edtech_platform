import { describe, expect, it } from 'vitest';
import { instantToWall, isWindowInverted, wallToInstant, windowState } from './schedule';
import { FALLBACK_TIMEZONE } from '@/utils/timezone';

/** India Standard Time: the platform's fallback zone. */
const IST = FALLBACK_TIMEZONE;

describe('institute-zone schedule conversion', () => {
    it('IST wall clock → UTC instant and back', () => {
        expect(wallToInstant('2026-12-01T19:00', IST)).toBe('2026-12-01T13:30:00.000Z');
        expect(instantToWall('2026-12-01T13:30:00Z', IST)).toBe('2026-12-01T19:00');
    });

    it('UTC zone is identity', () => {
        expect(wallToInstant('2026-01-05T00:15', 'UTC')).toBe('2026-01-05T00:15:00.000Z');
        expect(instantToWall('2026-01-05T00:15:00.000Z', 'UTC')).toBe('2026-01-05T00:15');
    });

    it('crosses the date line correctly', () => {
        expect(wallToInstant('2026-12-01T02:00', IST)).toBe('2026-11-30T20:30:00.000Z');
    });

    it('handles daylight saving on both sides', () => {
        // New York: EST (UTC-5) in January, EDT (UTC-4) in July.
        expect(wallToInstant('2026-01-15T09:00', 'America/New_York')).toBe(
            '2026-01-15T14:00:00.000Z'
        );
        expect(wallToInstant('2026-07-15T09:00', 'America/New_York')).toBe(
            '2026-07-15T13:00:00.000Z'
        );
        expect(instantToWall('2026-07-15T13:00:00Z', 'America/New_York')).toBe('2026-07-15T09:00');
    });

    it('rejects empty or malformed values', () => {
        expect(wallToInstant('', IST)).toBeNull();
        expect(wallToInstant('2026-12-01', IST)).toBeNull();
        expect(instantToWall(null, IST)).toBe('');
        expect(instantToWall('nope', IST)).toBe('');
    });

    it('window state and inversion', () => {
        const now = Date.parse('2026-11-16T10:00:00Z');
        expect(windowState(null, null, now)).toBe('always');
        expect(windowState('2026-11-17T00:00:00Z', null, now)).toBe('scheduled');
        expect(windowState(null, '2026-11-16T09:00:00Z', now)).toBe('ended');
        expect(windowState('2026-11-15T00:00:00Z', '2026-11-30T00:00:00Z', now)).toBe('running');
        expect(isWindowInverted('2026-11-17T00:00:00Z', '2026-11-16T00:00:00Z')).toBe(true);
        expect(isWindowInverted('2026-11-16T00:00:00Z', '2026-11-16T00:00:00Z')).toBe(true);
        expect(isWindowInverted('2026-11-16T00:00:00Z', null)).toBe(false);
    });
});
