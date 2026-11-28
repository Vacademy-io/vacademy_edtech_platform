import { describe, expect, it } from 'vitest';
import {
    durationParts,
    parseCorrectAnswer,
    parseServerDate,
    parseStudentAnswer,
    reviewStatusOf,
} from './report-answer';

describe('parseStudentAnswer', () => {
    it('reads the chosen options of an MCQ response', () => {
        const raw =
            '{"questionId":"q1","questionDurationLeftInSeconds":0,"timeTakenInSeconds":2,"isMarkedForReview":false,"isVisited":true,"responseData":{"type":"MCQS","optionIds":["opt-b"]}}';
        expect(parseStudentAnswer(raw)).toEqual({ kind: 'OPTIONS', optionIds: ['opt-b'] });
    });

    it('reads a numeric answer and treats a null one as no answer', () => {
        expect(
            parseStudentAnswer('{"responseData":{"type":"NUMERIC","validAnswer":12.5}}')
        ).toEqual({ kind: 'VALUES', values: ['12.5'] });
        expect(
            parseStudentAnswer('{"responseData":{"type":"NUMERIC","validAnswer":null}}')
        ).toEqual({ kind: 'NONE' });
    });

    it('reads a written answer and ignores empty HTML', () => {
        expect(
            parseStudentAnswer('{"responseData":{"type":"LONG_ANSWER","answer":"<p>Force</p>"}}')
        ).toEqual({ kind: 'TEXT', text: '<p>Force</p>' });
        expect(
            parseStudentAnswer('{"responseData":{"type":"ONE_WORD","answer":"<p></p>"}}')
        ).toEqual({ kind: 'NONE' });
    });

    it('treats an empty option list, null and junk as no answer', () => {
        expect(parseStudentAnswer('{"responseData":{"type":"MCQM","optionIds":[]}}')).toEqual({
            kind: 'NONE',
        });
        expect(parseStudentAnswer(null)).toEqual({ kind: 'NONE' });
        expect(parseStudentAnswer('{not json')).toEqual({ kind: 'NONE' });
    });

    it('still reads the older Option[] payload', () => {
        expect(parseStudentAnswer([{ option_id: 'a', option_name: '<p>m/s²</p>' }])).toEqual({
            kind: 'OPTION_TEXTS',
            texts: ['<p>m/s²</p>'],
        });
    });
});

describe('parseCorrectAnswer', () => {
    it('reads the correct option ids', () => {
        expect(parseCorrectAnswer('{"type":"MCQM","data":{"correctOptionIds":["a","b"]}}')).toEqual(
            { kind: 'OPTIONS', optionIds: ['a', 'b'] }
        );
    });

    it('reads numeric answers, dropping the trailing .0', () => {
        expect(parseCorrectAnswer('{"type":"NUMERIC","data":{"validAnswers":[12.0]}}')).toEqual({
            kind: 'VALUES',
            values: ['12'],
        });
    });

    it('reads a model answer stored as text or as {content}', () => {
        expect(parseCorrectAnswer('{"type":"ONE_WORD","data":{"answer":"Newton"}}')).toEqual({
            kind: 'TEXT',
            text: 'Newton',
        });
        expect(
            parseCorrectAnswer(
                '{"type":"LONG_ANSWER","data":{"answer":{"content":"<p>F = ma</p>"}}}'
            )
        ).toEqual({ kind: 'TEXT', text: '<p>F = ma</p>' });
    });

    it('returns no answer when the key is missing', () => {
        expect(parseCorrectAnswer(null)).toEqual({ kind: 'NONE' });
        expect(parseCorrectAnswer('{"type":"LONG_ANSWER","data":{}}')).toEqual({ kind: 'NONE' });
    });
});

describe('reviewStatusOf', () => {
    it('maps the server statuses', () => {
        expect(reviewStatusOf('CORRECT', true)).toBe('CORRECT');
        expect(reviewStatusOf('PARTIAL_CORRECT', true)).toBe('PARTIAL');
        expect(reviewStatusOf('INCORRECT', true)).toBe('WRONG');
    });

    it('splits PENDING into not-marked-yet and skipped by whether there is an answer', () => {
        expect(reviewStatusOf('PENDING', true)).toBe('PENDING');
        expect(reviewStatusOf('PENDING', false)).toBe('SKIPPED');
        expect(reviewStatusOf(null, false)).toBe('SKIPPED');
    });
});

describe('durationParts', () => {
    it('splits seconds into h / m / s', () => {
        expect(durationParts(23.4)).toEqual({ hours: 0, minutes: 0, seconds: 23 });
        expect(durationParts(72)).toEqual({ hours: 0, minutes: 1, seconds: 12 });
        expect(durationParts(3900)).toEqual({ hours: 1, minutes: 5, seconds: 0 });
        expect(durationParts(null)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    });
});

describe('parseServerDate', () => {
    it('reads a zone-less timestamp as UTC', () => {
        expect(parseServerDate('2026-11-21 10:32:11')?.toISOString()).toBe(
            '2026-11-21T10:32:11.000Z'
        );
        expect(parseServerDate('2026-11-21T10:32:11Z')?.toISOString()).toBe(
            '2026-11-21T10:32:11.000Z'
        );
        expect(parseServerDate('')).toBeNull();
        expect(parseServerDate('nope')).toBeNull();
    });
});
