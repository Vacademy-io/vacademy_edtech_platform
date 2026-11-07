import { describe, expect, it } from 'vitest';
import testAccessSchema from './add-participants-schema';

/**
 * Regression cover for the "PUBLIC assessment nobody can register for" bug.
 *
 * Saving Step 3 with "Open Test" selected but blank registration dates used to
 * validate cleanly: `new Date('')` is an Invalid Date, and `Invalid <= Invalid`
 * is false, so the only check in this schema (end > start) never fired. The
 * backend's matching guard only rejects `null` — the admin sends `''` — so the
 * assessment flipped to PUBLIC with a NULL registration window, which the
 * learner /register page reports as "Assessment is Private" and redirects to
 * /login.
 */

const notify = {
    when_assessment_created: false,
    before_assessment_goes_live: { checked: false, value: '' },
    when_assessment_live: false,
    when_assessment_report_generated: false,
};

const baseForm = {
    status: 'INCOMPLETE',
    closed_test: false,
    open_test: {
        checked: true,
        start_date: '2026-09-22T09:00',
        end_date: '2026-10-21T23:59',
        instructions: '',
        custom_fields: [],
    },
    select_batch: { checked: false, batch_details: {} },
    select_individually: { checked: false, student_details: [] },
    join_link: '',
    show_leaderboard: false,
    notify_student: notify,
    notify_parent: {
        ...notify,
        when_student_appears: false,
        when_student_finishes_test: false,
    },
};

const parseOpenTest = (openTest: Partial<typeof baseForm.open_test>) =>
    testAccessSchema.safeParse({
        ...baseForm,
        open_test: { ...baseForm.open_test, ...openTest },
    });

/** Paths are reported relative to the form root, e.g. ['open_test', 'start_date']. */
const issuePaths = (result: ReturnType<typeof parseOpenTest>) =>
    result.success ? [] : result.error.issues.map((i) => i.path.join('.'));

describe('testAccessSchema — open test registration window', () => {
    it('accepts an open test with both dates set', () => {
        expect(parseOpenTest({}).success).toBe(true);
    });

    it('accepts an open test with no window at all — blank means "no limit"', () => {
        // The backend reads a missing bound as no limit on that side, so this must
        // stay saveable. It is also the only state PRACTICE/SURVEY can reach: their
        // step_keys omit registration_open_date, so the inputs never render and an
        // error here would point at a field the admin cannot see.
        expect(parseOpenTest({ start_date: '', end_date: '' }).success).toBe(true);
    });

    it('accepts a blank end date — the 9999-12-31 "no expiry" case', () => {
        // convertDateFormat returns '' for that sentinel, which mock and practice
        // tests are stored with; 12 prod assessments sit in exactly that state.
        // Requiring an end date here reintroduces the bug that helper was written
        // to fix: "silently blocked every Update of a mock or practice test".
        expect(parseOpenTest({ end_date: '' }).success).toBe(true);
    });

    it('accepts a blank start date with a real end date', () => {
        expect(parseOpenTest({ start_date: '' }).success).toBe(true);
    });

    it('does not fire the ordering rule on an unparseable date', () => {
        // NaN comparisons are all false, so an unparseable bound must be treated
        // as absent rather than producing a bogus ordering error.
        expect(parseOpenTest({ start_date: 'not-a-date' }).success).toBe(true);
    });

    it('still rejects an end date at or before the start date', () => {
        const result = parseOpenTest({
            start_date: '2026-10-21T23:59',
            end_date: '2026-09-22T09:00',
        });
        expect(issuePaths(result)).toEqual(['open_test.end_date']);
        expect(result.success).toBe(false);
    });

    it('does not apply the ordering rule when the end date is blank', () => {
        // An open test that started last year with no closing date is valid.
        expect(
            parseOpenTest({ start_date: '2025-01-01T00:00', end_date: '' }).success
        ).toBe(true);
    });

    it('does not report an ordering error when a date is blank', () => {
        // Guards against the old NaN comparison resurfacing as a confusing
        // "End date must be greater than start date" on an empty field.
        const result = parseOpenTest({ start_date: '', end_date: '' });
        const messages = result.success ? [] : result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes('greater than'))).toBe(false);
    });

    it('leaves a closed test alone — no registration window needed', () => {
        const result = testAccessSchema.safeParse({
            ...baseForm,
            closed_test: true,
            open_test: {
                ...baseForm.open_test,
                checked: false,
                start_date: '',
                end_date: '',
            },
            select_batch: { checked: true, batch_details: { session: ['batch-1'] } },
        });
        expect(result.success).toBe(true);
    });
});
