import { describe, expect, it } from 'vitest';
import { qrow, release } from '@/services/submission-review/test-fixtures';
import { buildEditRequest, editErrorView, partSum, validateEditForm, type EditForm } from './edit-marks';

const form = (over: Partial<EditForm> = {}): EditForm => ({
    marks: '7',
    feedback: '',
    reason: '',
    notify: true,
    useParts: false,
    parts: [],
    ...over,
});
const row = qrow({ key: 's1:q1', max_marks: 10, revision: 3 });

describe('validateEditForm', () => {
    it('acceptance 4: 11 on a 10-mark question is out of range', () => {
        expect(validateEditForm(form({ marks: '11' }), row, false)).toEqual([
            { field: 'marks', key: 'edit.errors.outOfRange', params: { min: '0', max: '10' } },
        ]);
    });
    it('acceptance 4: a released result needs a reason', () => {
        expect(validateEditForm(form(), row, true).map((e) => e.key)).toEqual(['edit.errors.reasonRequired']);
        expect(validateEditForm(form({ reason: 'Re-checked' }), row, true)).toEqual([]);
    });
    it('checks that scheme points add up to the mark', () => {
        const parts = [
            { criterion: 'Defines', value: '2', max: 2 },
            { criterion: 'Example', value: '1', max: 3 },
        ];
        expect(partSum(parts)).toBe(3);
        expect(validateEditForm(form({ marks: '4', useParts: true, parts }), row, false)[0]?.key).toBe(
            'edit.errors.partSumMismatch'
        );
        expect(validateEditForm(form({ marks: '3', useParts: true, parts }), row, false)).toEqual([]);
        expect(
            validateEditForm(form({ marks: '3', useParts: true, parts: [{ criterion: 'X', value: '4', max: 3 }] }), row, false)[0]
                ?.key
        ).toBe('edit.errors.partOutOfRange');
    });
});

describe('buildEditRequest', () => {
    it('echoes the row revision and release token, keeps feedback when unchanged', () => {
        expect(buildEditRequest(form(), row, release({ token: 'PENDING|0' }), '')).toEqual({
            marks: 7,
            feedback: null,
            reason: null,
            notify_learner: false,
            expected_revision: 3,
            expected_release: 'PENDING|0',
            preview: false,
        });
    });
    it('after release sends the reason and the notify choice', () => {
        const body = buildEditRequest(
            form({ reason: ' Re-checked ', feedback: 'Better', notify: true }),
            row,
            release({ status: 'RELEASED', token: 'RELEASED|1' }),
            'Old',
            { preview: true }
        );
        expect(body).toMatchObject({ reason: 'Re-checked', feedback: 'Better', notify_learner: true, preview: true });
    });
    it('marks as not answered without marks', () => {
        expect(buildEditRequest(form(), row, release(), null, { notAnswered: true })).toMatchObject({ not_answered: true });
        expect(buildEditRequest(form(), row, release(), null, { notAnswered: true }).marks).toBeUndefined();
    });
});

describe('editErrorView (revision conflicts)', () => {
    it('maps a stale revision to the reload message with the current row', () => {
        const current = qrow({ key: 's1:q1', marks: 5, revision: 4 });
        expect(editErrorView({ code: 'STALE_REVISION', message: '', details: { current } }, 409)).toEqual({
            kind: 'stale',
            current,
        });
    });
    it('maps a release that happened mid-edit', () => {
        const r = release({ status: 'RELEASED', token: 'RELEASED|9' });
        expect(editErrorView({ code: 'RELEASE_CHANGED', message: '', details: { release: r } }, 409)).toEqual({
            kind: 'releaseChanged',
            release: r,
        });
    });
    it('maps 422s to the field they belong to and a bare 403 to forbidden', () => {
        expect(editErrorView({ code: 'OUT_OF_RANGE', message: '', details: { min: 0, max: 10 } }, 422)).toMatchObject({
            kind: 'field',
            field: 'marks',
        });
        expect(editErrorView({ code: 'REASON_REQUIRED', message: '' }, 422)).toMatchObject({ field: 'reason' });
        expect(editErrorView(null, 403)).toEqual({ kind: 'forbidden' });
    });
});

describe('editErrorView (imported total)', () => {
    it('422 TOTAL_ONLY says the total would be replaced', () => {
        expect(editErrorView({ code: 'TOTAL_ONLY', message: 'x', details: { stored_total: 78 } }, 422)).toEqual({
            kind: 'totalOnly',
        });
    });
});
