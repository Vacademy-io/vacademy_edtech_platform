import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertDateFormat, flattenFormErrors } from './helper';

/**
 * Why Update on a mock/practice test was a dead click in India: their window
 * closes 9999-12-31 UTC, which east of Greenwich is the year 10000 - a value
 * no datetime-local input can hold, so the hidden end-date rule failed with
 * nothing highlighted.
 */
describe('convertDateFormat', () => {
    const realTZ = process.env.TZ;
    beforeEach(() => {
        process.env.TZ = 'Asia/Kolkata';
    });
    afterEach(() => {
        process.env.TZ = realTZ;
        vi.useRealTimers();
    });

    it('treats the "never closes" sentinel as no date', () => {
        expect(convertDateFormat('9999-12-31T23:59:59.999Z')).toBe('');
        expect(convertDateFormat('9999-12-31 23:59:59.999')).toBe('');
    });

    it('renders a real instant as local wall-clock for the input', () => {
        const out = convertDateFormat('2026-09-15T04:30:00Z');
        expect(out).toMatch(/^2026-09-15T\d{2}:\d{2}$/);
        // Whatever the zone, the value must parse back to a valid date.
        expect(Number.isNaN(new Date(out).getTime())).toBe(false);
    });

    it('returns empty for empty or unparseable input', () => {
        expect(convertDateFormat('')).toBe('');
        expect(convertDateFormat('not a date')).toBe('');
    });
});

describe('flattenFormErrors', () => {
    it('lists every leaf message with its dotted path', () => {
        const errors = {
            testCreation: {
                liveDateRange: {
                    endDate: {
                        type: 'custom',
                        message: 'End date must be greater than start date',
                    },
                },
            },
            resultType: { type: 'too_small', message: 'Choose how results are evaluated', ref: {} },
        };
        expect(flattenFormErrors(errors)).toEqual([
            {
                path: 'testCreation.liveDateRange.endDate',
                message: 'End date must be greater than start date',
            },
            { path: 'resultType', message: 'Choose how results are evaluated' },
        ]);
    });

    it('survives empty and odd input', () => {
        expect(flattenFormErrors(undefined)).toEqual([]);
        expect(flattenFormErrors({})).toEqual([]);
        expect(flattenFormErrors({ x: { ref: {} } })).toEqual([]);
    });
});
