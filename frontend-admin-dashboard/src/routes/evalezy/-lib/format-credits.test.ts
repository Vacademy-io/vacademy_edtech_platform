import { describe, expect, it } from 'vitest';
import { formatCredits, formatCreditsShort } from './format-credits';

describe('formatCredits', () => {
    it('reads the API decimal string to one place', () => {
        expect(formatCredits('996.8700')).toBe('996.9');
    });
    it('groups thousands the Indian way and drops a trailing zero', () => {
        expect(formatCredits('125000.00')).toBe('1,25,000');
    });
    it('shows 0 for a missing or broken value', () => {
        expect(formatCredits(null)).toBe('0');
        expect(formatCredits('n/a')).toBe('0');
    });
});

describe('formatCreditsShort', () => {
    it('shows whole credits below a thousand, rounded down', () => {
        expect(formatCreditsShort('88.9')).toBe('88');
        expect(formatCreditsShort('999.99')).toBe('999');
    });
    it('shortens thousands, lakhs and crores without rounding up', () => {
        expect(formatCreditsShort('1000')).toBe('1K');
        expect(formatCreditsShort('99999.9')).toBe('99.9K');
        expect(formatCreditsShort('1250000')).toBe('12.5L');
        expect(formatCreditsShort('30000000')).toBe('3Cr');
    });
    it('shows 0 for nothing left or a broken value', () => {
        expect(formatCreditsShort('0.00')).toBe('0');
        expect(formatCreditsShort('-2')).toBe('0');
        expect(formatCreditsShort('n/a')).toBe('0');
    });
});
