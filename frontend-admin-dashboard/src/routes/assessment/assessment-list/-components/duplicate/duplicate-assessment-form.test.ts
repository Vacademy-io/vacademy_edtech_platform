import { describe, expect, it } from 'vitest';
import {
    buildDuplicatePayload,
    defaultDuplicateValues,
    duplicateAssessmentSchema,
    isInPast,
    type DuplicateSource,
} from './duplicate-assessment-form';

const exam: DuplicateSource = {
    name: 'Physics Mock',
    play_mode: 'EXAM',
    assessment_visibility: 'PRIVATE',
    bound_start_time: '2026-11-20T04:30:00Z',
    bound_end_time: '2026-11-20T06:30:00Z',
    registration_open_date: null,
    registration_close_date: null,
    batch_ids: ['b-1', 'b-gone'],
};

const parse = (playMode: string, values: Partial<ReturnType<typeof defaultDuplicateValues>>) =>
    duplicateAssessmentSchema(playMode).safeParse({
        ...defaultDuplicateValues(exam, 'Copy', new Set()),
        ...values,
    });

describe('defaultDuplicateValues', () => {
    it('starts as a full copy with the original dates and batches', () => {
        const values = defaultDuplicateValues(
            exam,
            'Copy of Physics Mock',
            new Set(['b-1', 'b-2'])
        );
        expect(values.name).toBe('Copy of Physics Mock');
        expect(values.copyQuestions).toBe(true);
        expect(values.copyMarking).toBe(true);
        expect(values.copyIndividualParticipants).toBe(false);
        expect(values.startDate).not.toBe('');
        expect(values.endDate).not.toBe('');
        // Batches no longer in the institute are dropped once the institute's batches are known.
        expect(values.batchIds).toEqual(['b-1']);
    });

    it('keeps every original batch while the institute batches are not loaded', () => {
        expect(defaultDuplicateValues(exam, 'x', new Set()).batchIds).toEqual(['b-1', 'b-gone']);
    });

    it('has no dates for an always-open mock test and no registration window for a closed test', () => {
        const values = defaultDuplicateValues(
            { ...exam, play_mode: 'MOCK', bound_end_time: '9999-12-31T00:00:00Z' },
            'x',
            new Set()
        );
        expect(values.startDate).toBe('');
        expect(values.endDate).toBe('');
        expect(values.registrationOpenDate).toBe('');
    });

    it('fills the registration window of an open test', () => {
        const values = defaultDuplicateValues(
            {
                ...exam,
                assessment_visibility: 'PUBLIC',
                registration_open_date: '2026-11-10T04:30:00Z',
                registration_close_date: '2026-11-19T18:30:00Z',
            },
            'x',
            new Set()
        );
        expect(values.registrationOpenDate).not.toBe('');
        expect(values.registrationCloseDate).not.toBe('');
    });
});

describe('duplicateAssessmentSchema', () => {
    it('needs a name', () => {
        const result = parse('EXAM', { name: '   ' });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toBe('duplicate.errors.nameRequired');
    });

    it('needs both dates for an exam, not for a survey', () => {
        const exam = parse('EXAM', { startDate: '', endDate: '' });
        expect(exam.error?.issues.map((i) => i.path.join('.'))).toEqual(['startDate', 'endDate']);
        expect(parse('SURVEY', { startDate: '', endDate: '' }).success).toBe(true);
    });

    it('refuses an end before the start and a registration that closes before it opens', () => {
        const result = parse('EXAM', {
            startDate: '2026-12-01T10:00',
            endDate: '2026-12-01T09:00',
            registrationOpenDate: '2026-11-25T10:00',
            registrationCloseDate: '2026-11-20T10:00',
        });
        expect(result.error?.issues.map((i) => i.message)).toEqual([
            'duplicate.errors.endBeforeStart',
            'duplicate.errors.registrationCloseBeforeOpen',
        ]);
    });
});

describe('buildDuplicatePayload', () => {
    it('sends the options in snake_case with UTC dates', () => {
        const payload = buildDuplicatePayload(
            {
                ...defaultDuplicateValues(exam, ' New name ', new Set()),
                startDate: '2026-12-01T10:00',
                endDate: '2026-12-01T12:00',
                batchIds: ['b-9'],
                copyIndividualParticipants: true,
            },
            exam
        );
        expect(payload).toMatchObject({
            name: 'New name',
            copy_questions: true,
            copy_marking: true,
            batch_ids: ['b-9'],
            copy_individual_participants: true,
        });
        expect(payload.start_date).toBe(new Date('2026-12-01T10:00').toISOString());
        expect(payload.end_date).toBe(new Date('2026-12-01T12:00').toISOString());
        expect(payload.registration_open_date).toBeUndefined();
    });

    it('never keeps the marking scheme without the questions', () => {
        const payload = buildDuplicatePayload(
            {
                ...defaultDuplicateValues(exam, 'x', new Set()),
                copyQuestions: false,
                copyMarking: true,
            },
            exam
        );
        expect(payload.copy_questions).toBe(false);
        expect(payload.copy_marking).toBe(false);
    });

    it('leaves empty dates out so the copy keeps the original ones', () => {
        const survey = { ...exam, play_mode: 'SURVEY' };
        const payload = buildDuplicatePayload(
            { ...defaultDuplicateValues(survey, 'x', new Set()), startDate: '', endDate: '' },
            survey
        );
        expect(payload).not.toHaveProperty('start_date');
        expect(payload).not.toHaveProperty('end_date');
    });

    it('sends no dates for a mock test', () => {
        const mock = { ...exam, play_mode: 'MOCK' };
        const payload = buildDuplicatePayload(
            { ...defaultDuplicateValues(mock, 'x', new Set()), startDate: '2026-12-01T10:00' },
            mock
        );
        expect(payload).not.toHaveProperty('start_date');
    });
});

describe('isInPast', () => {
    it('flags only a date that is over', () => {
        const now = new Date('2026-11-25T12:00').getTime();
        expect(isInPast('2026-11-25T11:59', now)).toBe(true);
        expect(isInPast('2026-11-25T12:01', now)).toBe(false);
        expect(isInPast('', now)).toBe(false);
    });
});
