/**
 * W4 Edit marks: local checks before Save and what each server error means on screen
 * (contract §5.0, §9.9). Pure, tested.
 */
import type { ApiErrorBody, EditMarksRequest, QuestionRow, ReleaseInfo } from '@/services/submission-review/types';
import { formatMark, roundMark } from '@/services/submission-review/marks';

export interface PartInput {
    criterion: string;
    /** Text in the box ('' = not filled). */
    value: string;
    max: number | null;
}

export interface EditForm {
    marks: string;
    feedback: string;
    reason: string;
    notify: boolean;
    useParts: boolean;
    parts: PartInput[];
}

export interface FieldError {
    field: 'marks' | 'reason' | 'parts';
    key: string;
    params?: Record<string, string | number>;
}

const toNumber = (v: string): number | null => {
    const s = v.trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};

export const partSum = (parts: PartInput[]): number =>
    roundMark(parts.reduce((sum, p) => sum + (toNumber(p.value) ?? 0), 0));

/** Errors that stop Save; empty when the form can be sent. */
export const validateEditForm = (
    form: EditForm,
    row: Pick<QuestionRow, 'min_marks' | 'max_marks'>,
    released: boolean
): FieldError[] => {
    const errors: FieldError[] = [];
    const marks = toNumber(form.marks);
    if (marks == null) {
        errors.push({ field: 'marks', key: 'edit.errors.marksRequired' });
    } else if (marks < row.min_marks || (row.max_marks != null && marks > row.max_marks)) {
        errors.push({
            field: 'marks',
            key: 'edit.errors.outOfRange',
            params: { min: formatMark(row.min_marks), max: formatMark(row.max_marks) },
        });
    }
    if (form.useParts && form.parts.length > 0) {
        const bad = form.parts.find((p) => {
            const v = toNumber(p.value);
            return v == null || v < 0 || (p.max != null && v > p.max);
        });
        if (bad) {
            errors.push({ field: 'parts', key: 'edit.errors.partOutOfRange', params: { criterion: bad.criterion } });
        } else if (marks != null && Math.abs(partSum(form.parts) - marks) > 0.01) {
            errors.push({
                field: 'parts',
                key: 'edit.errors.partSumMismatch',
                params: { sum: formatMark(partSum(form.parts)), marks: formatMark(marks) },
            });
        }
    }
    if (released && !form.reason.trim()) {
        errors.push({ field: 'reason', key: 'edit.errors.reasonRequired' });
    }
    return errors;
};

/** The A3 body for the form (the caller adds annotation edits). */
export const buildEditRequest = (
    form: EditForm,
    row: Pick<QuestionRow, 'revision'>,
    release: Pick<ReleaseInfo, 'token' | 'status'>,
    initialFeedback: string | null,
    opts: { preview?: boolean; notAnswered?: boolean } = {}
): EditMarksRequest => {
    const released = release.status === 'RELEASED';
    const marks = toNumber(form.marks);
    const feedbackChanged = (initialFeedback ?? '') !== form.feedback;
    return {
        ...(opts.notAnswered ? { not_answered: true } : { marks: marks ?? 0 }),
        ...(form.useParts && form.parts.length > 0 && !opts.notAnswered
            ? {
                  part_marks: form.parts.map((p) => ({
                      criterion: p.criterion,
                      marks: toNumber(p.value) ?? 0,
                      max: p.max,
                  })),
              }
            : {}),
        // null keeps the saved feedback; '' clears it.
        feedback: feedbackChanged ? form.feedback : null,
        reason: form.reason.trim() ? form.reason.trim() : null,
        notify_learner: released ? form.notify : false,
        expected_revision: row.revision,
        expected_release: release.token,
        preview: !!opts.preview,
    };
};

export type EditErrorView =
    | { kind: 'stale'; current: QuestionRow | null }
    | { kind: 'releaseChanged'; release: ReleaseInfo | null }
    | { kind: 'field'; field: FieldError['field']; key: string; params?: Record<string, string | number> }
    | { kind: 'locked' }
    | { kind: 'totalOnly' }
    | { kind: 'forbidden' }
    | { kind: 'other'; message: string };

/** What a failed A3 means for the dialog. */
export const editErrorView = (err: ApiErrorBody | null, httpStatus: number | null): EditErrorView => {
    if (!err) {
        return httpStatus === 403 ? { kind: 'forbidden' } : { kind: 'other', message: '' };
    }
    const d = err.details ?? {};
    switch (err.code) {
        case 'STALE_REVISION':
            return { kind: 'stale', current: (d.current as QuestionRow | undefined) ?? null };
        case 'RELEASE_CHANGED':
            return { kind: 'releaseChanged', release: (d.release as ReleaseInfo | undefined) ?? null };
        case 'OUT_OF_RANGE':
            return {
                kind: 'field',
                field: 'marks',
                key: 'edit.errors.outOfRange',
                params: { min: formatMark(d.min as number), max: formatMark(d.max as number | null) },
            };
        case 'REASON_REQUIRED':
            return { kind: 'field', field: 'reason', key: 'edit.errors.reasonRequired' };
        case 'PART_MARKS_SUM_MISMATCH':
            return {
                kind: 'field',
                field: 'parts',
                key: 'edit.errors.partSumMismatch',
                params: { sum: formatMark(d.sum as number), marks: formatMark(d.marks as number) },
            };
        case 'RESULT_LOCKED':
            return { kind: 'locked' };
        case 'TOTAL_ONLY':
            return { kind: 'totalOnly' };
        case 'EDIT_AFTER_RELEASE_NOT_ALLOWED':
            return { kind: 'forbidden' };
        default:
            return { kind: 'other', message: err.message };
    }
};
