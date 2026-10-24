import { describe, expect, it } from 'vitest';
import { isBasicInfoStepComplete } from './helper';

/**
 * Step 1's "Next" is gated by a hand-rolled predicate, not by the zod schema
 * (which treats the live-window dates as optional). It used to demand
 * liveDateRange for every new EXAM *and* SURVEY — but a survey declares both
 * boundation dates OPTIONAL, so its inputs render without an asterisk and may
 * be left blank. Result: "Next" was permanently disabled on a new survey.
 */

const base = {
    examType: 'SURVEY',
    isNewAssessment: true,
    requiresLiveDateRange: false,
    assessmentName: 'testing',
    liveDateRangeStartDate: undefined,
    liveDateRangeEndDate: undefined,
    reattemptCount: '1',
    errorCount: 0,
};

describe('isBasicInfoStepComplete', () => {
    it('enables Next for a new survey with just a name — the reported bug', () => {
        expect(isBasicInfoStepComplete(base)).toBe(true);
    });

    it('lets a survey supply its optional dates without being forced to', () => {
        // The inputs ARE rendered for a survey (declared OPTIONAL), so filling
        // them must work, and half-filling them must not block Next either.
        expect(
            isBasicInfoStepComplete({
                ...base,
                liveDateRangeStartDate: '2026-09-23T09:00',
                liveDateRangeEndDate: '2026-10-23T09:00',
            })
        ).toBe(true);
        expect(
            isBasicInfoStepComplete({
                ...base,
                liveDateRangeStartDate: '2026-09-23T09:00',
            })
        ).toBe(true);
    });

    it('still requires the dates for a new exam, which does render them', () => {
        const exam = { ...base, examType: 'EXAM', requiresLiveDateRange: true };
        expect(isBasicInfoStepComplete(exam)).toBe(false);
        expect(
            isBasicInfoStepComplete({
                ...exam,
                liveDateRangeStartDate: '2026-09-23T09:00',
                liveDateRangeEndDate: '2026-10-23T09:00',
            })
        ).toBe(true);
    });

    it('requires only the end date when only the start is present', () => {
        const exam = {
            ...base,
            examType: 'EXAM',
            requiresLiveDateRange: true,
            liveDateRangeStartDate: '2026-09-23T09:00',
        };
        expect(isBasicInfoStepComplete(exam)).toBe(false);
    });

    it('requires a name whatever the type', () => {
        expect(isBasicInfoStepComplete({ ...base, assessmentName: '' })).toBe(false);
        expect(
            isBasicInfoStepComplete({ ...base, assessmentName: undefined })
        ).toBe(false);
    });

    it('blocks while the form holds validation errors', () => {
        expect(isBasicInfoStepComplete({ ...base, errorCount: 1 })).toBe(false);
    });

    it('requires a non-zero reattempt count on a new exam or survey', () => {
        expect(isBasicInfoStepComplete({ ...base, reattemptCount: '0' })).toBe(false);
        expect(isBasicInfoStepComplete({ ...base, reattemptCount: '' })).toBe(false);
        expect(isBasicInfoStepComplete({ ...base, reattemptCount: '2' })).toBe(true);
    });

    it('only needs a name when editing an existing assessment', () => {
        const editing = {
            ...base,
            isNewAssessment: false,
            reattemptCount: '0',
            requiresLiveDateRange: true,
        };
        expect(isBasicInfoStepComplete(editing)).toBe(true);
    });

    it('matches the original rule exactly for a new EXAM', () => {
        // Equivalence check against the pre-change behaviour:
        //   name && startDate && endDate && Number(reattemptCount) && no errors
        // An exam declares its dates REQUIRED, so requiresLiveDateRange is true.
        const original = (
            name: string,
            start: string | undefined,
            end: string | undefined,
            reattempt: string,
            errors: number
        ) => !!name && !!start && !!end && !!Number(reattempt) && errors === 0;

        const names = ['', 'x'];
        const dates = [undefined, '2026-01-01T00:00'];
        const counts = ['0', '1'];
        const errorCounts = [0, 1];

        for (const name of names)
            for (const start of dates)
                for (const end of dates)
                    for (const reattempt of counts)
                        for (const errorCount of errorCounts) {
                            expect(
                                isBasicInfoStepComplete({
                                    ...base,
                                    examType: 'EXAM',
                                    requiresLiveDateRange: true,
                                    assessmentName: name,
                                    liveDateRangeStartDate: start,
                                    liveDateRangeEndDate: end,
                                    reattemptCount: reattempt,
                                    errorCount,
                                })
                            ).toBe(original(name, start, end, reattempt, errorCount));
                        }
    });

    it('only needs a name for types other than EXAM and SURVEY', () => {
        const mock = { ...base, examType: 'MOCK', reattemptCount: '0' };
        expect(isBasicInfoStepComplete(mock)).toBe(true);
    });
});
