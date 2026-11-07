import { describe, expect, it } from 'vitest';
import { getTestBoundation } from './assessment-services';

/**
 * What Step 1 actually stores as an assessment's live window.
 *
 * This is the integration point the survey work turns on. The learner
 * assessment list (AssessmentRepository) selects LIVE with
 * `CURRENT_TIMESTAMP BETWEEN bound_start_time AND bound_end_time`, upcoming with
 * `< bound_start_time` and past with `> bound_end_time`. A NULL bound makes all
 * three NULL rather than true — verified directly against Postgres — so a survey
 * saved with blank dates would appear in no tab at all. Blank must therefore
 * resolve to "open now, never ends", exactly as MOCK and PRACTICE already do.
 */
const NEVER_ENDS = new Date('9999-12-31T23:59:59.999Z').toISOString();

describe('getTestBoundation', () => {
    it('gives a survey with blank dates an open-ended window, never blank', () => {
        const b = getTestBoundation('SURVEY', {});
        expect(b.start_date).not.toBe('');
        expect(b.end_date).toBe(NEVER_ENDS);
        expect(Number.isNaN(Date.parse(b.start_date))).toBe(false);
        // Open now, not in the future — otherwise it would sit in "upcoming".
        expect(Date.parse(b.start_date)).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('fills only the missing side when a survey supplies one date', () => {
        const start = '2026-09-23T09:00';
        const withStart = getTestBoundation('SURVEY', { startDate: start });
        expect(Date.parse(withStart.start_date)).toBe(Date.parse(start));
        expect(withStart.end_date).toBe(NEVER_ENDS);

        const end = '2026-10-23T09:00';
        const withEnd = getTestBoundation('SURVEY', { endDate: end });
        expect(Date.parse(withEnd.end_date)).toBe(Date.parse(end));
        expect(Number.isNaN(Date.parse(withEnd.start_date))).toBe(false);
    });

    it('honours both dates a survey does supply', () => {
        const b = getTestBoundation('SURVEY', {
            startDate: '2026-09-23T09:00',
            endDate: '2026-10-23T09:00',
        });
        expect(Date.parse(b.start_date)).toBe(Date.parse('2026-09-23T09:00'));
        expect(Date.parse(b.end_date)).toBe(Date.parse('2026-10-23T09:00'));
    });

    it('leaves every other type exactly as it was', () => {
        // LIVE/default still pass blanks straight through — their dates are
        // required in the form, and changing this would alter the exam path.
        expect(getTestBoundation('LIVE', {})).toEqual({ start_date: '', end_date: '' });
        expect(getTestBoundation(undefined, {})).toEqual({ start_date: '', end_date: '' });

        for (const type of ['MOCK', 'PRACTICE']) {
            const b = getTestBoundation(type, {});
            expect(b.end_date).toBe(NEVER_ENDS);
        }

        const live = getTestBoundation('LIVE', {
            startDate: '2026-09-23T09:00',
            endDate: '2026-10-23T09:00',
        });
        expect(Date.parse(live.start_date)).toBe(Date.parse('2026-09-23T09:00'));
        expect(Date.parse(live.end_date)).toBe(Date.parse('2026-10-23T09:00'));
    });
});
