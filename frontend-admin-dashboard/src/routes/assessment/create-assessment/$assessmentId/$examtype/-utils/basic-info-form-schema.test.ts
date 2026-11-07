import { describe, expect, it } from 'vitest';
import { BasicInfoFormSchema } from './basic-info-form-schema';

/**
 * Survey Step 1 showed "End date must be greater than start date" under
 * 14/10 12:30 PM → 28/10 01:43 AM and kept Next disabled. The rule failed
 * whenever one side was blank (NaN comparison), and the stale error on End
 * survived once Start was filled in.
 */
const liveDateRange = BasicInfoFormSchema.shape.testCreation.shape.liveDateRange;

const endDateError = (startDate?: string, endDate?: string) => {
    const result = liveDateRange.safeParse({ startDate, endDate });
    return result.success
        ? undefined
        : result.error.issues.find((i) => i.path.join('.') === 'endDate')?.message;
};

describe('BasicInfoFormSchema liveDateRange', () => {
    it('accepts an end date after the start date — the reported range', () => {
        expect(endDateError('2026-10-14T12:30', '2026-10-28T01:43')).toBeUndefined();
    });

    it('rejects an end date on or before the start date', () => {
        expect(endDateError('2026-10-28T01:43', '2026-10-14T12:30')).toMatch(/greater than/);
        expect(endDateError('2026-10-14T12:30', '2026-10-14T12:30')).toMatch(/greater than/);
    });

    it('does not report an ordering error while one side is blank', () => {
        expect(endDateError('', '2026-10-28T01:43')).toBeUndefined();
        expect(endDateError('2026-10-14T12:30', '')).toBeUndefined();
        expect(endDateError(undefined, '2026-10-28T01:43')).toBeUndefined();
        expect(endDateError('', '')).toBeUndefined();
    });
});
