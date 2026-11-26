import { z } from 'zod';
import {
    convertDateFormat,
    convertToUTC,
    isOpenEndedExamType,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/helper';
import type { TestContent } from '@/types/assessments/schedule-test-list';

/** The fields of a list row the Duplicate dialog reads. */
export type DuplicateSource = Pick<
    TestContent,
    | 'name'
    | 'play_mode'
    | 'assessment_visibility'
    | 'bound_start_time'
    | 'bound_end_time'
    | 'registration_open_date'
    | 'registration_close_date'
    | 'batch_ids'
>;

/** Mock and practice tests are always open, so they have no dates to change. */
export const showsSchedule = (playMode: string | undefined) => !isOpenEndedExamType(playMode);

/** Step 1 of the wizard requires both dates for an exam only (a survey's are optional). */
export const requiresSchedule = (playMode: string | undefined) => playMode === 'EXAM';

/** Only an open (public) test has a registration window. */
export const showsRegistrationWindow = (source: Pick<DuplicateSource, 'assessment_visibility'>) =>
    source.assessment_visibility === 'PUBLIC';

/**
 * Error messages are i18n keys of the assessmentScheduleTestDetailsDropdownMenu
 * namespace, translated where they are shown.
 */
export const duplicateAssessmentSchema = (playMode: string | undefined) =>
    z
        .object({
            name: z.string().trim().min(1, 'duplicate.errors.nameRequired'),
            copyQuestions: z.boolean(),
            copyMarking: z.boolean(),
            startDate: z.string(),
            endDate: z.string(),
            registrationOpenDate: z.string(),
            registrationCloseDate: z.string(),
            batchIds: z.array(z.string()),
            copyIndividualParticipants: z.boolean(),
        })
        .superRefine((values, ctx) => {
            if (requiresSchedule(playMode)) {
                if (!values.startDate) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['startDate'],
                        message: 'duplicate.errors.startRequired',
                    });
                }
                if (!values.endDate) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['endDate'],
                        message: 'duplicate.errors.endRequired',
                    });
                }
            }
            if (isBefore(values.endDate, values.startDate)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['endDate'],
                    message: 'duplicate.errors.endBeforeStart',
                });
            }
            if (isBefore(values.registrationCloseDate, values.registrationOpenDate)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['registrationCloseDate'],
                    message: 'duplicate.errors.registrationCloseBeforeOpen',
                });
            }
        });

export type DuplicateAssessmentValues = z.infer<ReturnType<typeof duplicateAssessmentSchema>>;

/** True when both datetime-local values are set and `later` is not after `earlier`. */
const isBefore = (later: string, earlier: string) => {
    if (!later || !earlier) return false;
    const end = new Date(later).getTime();
    const start = new Date(earlier).getTime();
    return !Number.isNaN(end) && !Number.isNaN(start) && end <= start;
};

/** A stored UTC date as a datetime-local value; '' when there is none. */
const toInputValue = (value: string | null | undefined) => (value ? convertDateFormat(value) : '');

/**
 * The dialog starts as a full copy: questions, marks, the original's dates and batches.
 * Batches that no longer exist in the institute are dropped, but only once the institute's
 * batches are known, so a slow load never silently empties the list.
 */
export const defaultDuplicateValues = (
    source: DuplicateSource,
    copyName: string,
    knownBatchIds: ReadonlySet<string>
): DuplicateAssessmentValues => {
    const schedule = showsSchedule(source.play_mode);
    const registration = showsRegistrationWindow(source);
    const originalBatches = source.batch_ids ?? [];
    return {
        name: copyName,
        copyQuestions: true,
        copyMarking: true,
        startDate: schedule ? toInputValue(source.bound_start_time) : '',
        endDate: schedule ? toInputValue(source.bound_end_time) : '',
        registrationOpenDate: registration ? toInputValue(source.registration_open_date) : '',
        registrationCloseDate: registration ? toInputValue(source.registration_close_date) : '',
        batchIds:
            knownBatchIds.size > 0
                ? originalBatches.filter((id) => knownBatchIds.has(id))
                : [...originalBatches],
        copyIndividualParticipants: false,
    };
};

export interface DuplicateAssessmentPayload {
    name: string;
    copy_questions: boolean;
    copy_marking: boolean;
    start_date?: string;
    end_date?: string;
    registration_open_date?: string;
    registration_close_date?: string;
    batch_ids: string[];
    copy_individual_participants: boolean;
}

/** Dates left empty are not sent, so the copy keeps the original's. */
export const buildDuplicatePayload = (
    values: DuplicateAssessmentValues,
    source: DuplicateSource
): DuplicateAssessmentPayload => {
    const payload: DuplicateAssessmentPayload = {
        name: values.name.trim(),
        copy_questions: values.copyQuestions,
        copy_marking: values.copyQuestions && values.copyMarking,
        batch_ids: values.batchIds,
        copy_individual_participants: values.copyIndividualParticipants,
    };
    const utc = (value: string) => (value ? convertToUTC(value) : '');
    if (showsSchedule(source.play_mode)) {
        if (utc(values.startDate)) payload.start_date = utc(values.startDate);
        if (utc(values.endDate)) payload.end_date = utc(values.endDate);
    }
    if (showsRegistrationWindow(source)) {
        if (utc(values.registrationOpenDate))
            payload.registration_open_date = utc(values.registrationOpenDate);
        if (utc(values.registrationCloseDate))
            payload.registration_close_date = utc(values.registrationCloseDate);
    }
    return payload;
};

/** A datetime-local value that is already over (shown as a warning, never blocked). */
export const isInPast = (value: string, now: number = Date.now()) => {
    if (!value) return false;
    const time = new Date(value).getTime();
    return !Number.isNaN(time) && time < now;
};
