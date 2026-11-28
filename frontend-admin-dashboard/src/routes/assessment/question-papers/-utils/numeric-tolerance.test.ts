import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenDecodedData: () => null,
    getTokenFromCookie: () => null,
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import {
    normaliseNumericTolerance,
    readNumericTolerance,
    toleranceEntry,
} from './numeric-tolerance';
import {
    getEvaluationJSON,
    transformResponseDataToMyQuestionsSchemaSingleQuestion,
} from './helper';
import { transformFormQuestionsToBackend } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/quiz/utils/api-helpers';
import { transformQuestion } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/quiz/utils/question-transformer';
import type { MyQuestion } from '@/types/assessments/question-paper-form';

const blank = (n: number) => Array(n).fill({ id: '', name: '', isSelected: false });

const numeric = (overrides: Partial<MyQuestion>): MyQuestion => ({
    id: 'q-1',
    questionId: 'q-1',
    questionName: '<p>Net profit?</p>',
    explanation: '',
    questionType: 'NUMERIC',
    questionMark: '',
    questionPenalty: '',
    questionDuration: { hrs: '0', min: '0' },
    singleChoiceOptions: blank(4),
    multipleChoiceOptions: blank(4),
    csingleChoiceOptions: blank(4),
    cmultipleChoiceOptions: blank(4),
    trueFalseOptions: blank(2),
    validAnswers: [1250],
    tags: [],
    ...overrides,
});

describe('numeric tolerance values', () => {
    it('keeps only a finite tolerance above 0', () => {
        expect(normaliseNumericTolerance(1)).toBe(1);
        expect(normaliseNumericTolerance('0.5')).toBe(0.5);
        expect(normaliseNumericTolerance(0)).toBeUndefined();
        expect(normaliseNumericTolerance(-1)).toBeUndefined();
        expect(normaliseNumericTolerance('')).toBeUndefined();
        expect(normaliseNumericTolerance(null)).toBeUndefined();
        expect(normaliseNumericTolerance('abc')).toBeUndefined();
        expect(toleranceEntry(0)).toEqual({});
        expect(toleranceEntry(2)).toEqual({ tolerance: 2 });
    });

    it('reads both stored shapes', () => {
        expect(readNumericTolerance('{"correctAnswers":[5],"tolerance":1}')).toBe(1);
        expect(
            readNumericTolerance('{"type":"NUMERIC","data":{"validAnswers":[5],"tolerance":0.5}}')
        ).toBe(0.5);
        expect(
            readNumericTolerance('{"type":"NUMERIC","data":{"validAnswers":[5]}}')
        ).toBeUndefined();
        expect(readNumericTolerance('nope')).toBeUndefined();
        expect(readNumericTolerance(undefined)).toBeUndefined();
    });
});

describe('assessment / question / video slide answer key', () => {
    it('stores data.tolerance next to validAnswers', () => {
        expect(JSON.parse(getEvaluationJSON(numeric({ numericTolerance: 1 }), [], [1250]))).toEqual(
            {
                type: 'NUMERIC',
                data: { validAnswers: [1250], tolerance: 1 },
            }
        );
        expect(
            JSON.parse(
                getEvaluationJSON(
                    numeric({ questionType: 'CNUMERIC', numericTolerance: 0.5 }),
                    [],
                    [3]
                )
            )
        ).toEqual({ type: 'NUMERIC', data: { validAnswers: [3], tolerance: 0.5 } });
    });

    it('is byte-identical to before when there is no tolerance', () => {
        const before = '{"type":"NUMERIC","data":{"validAnswers":[1250]}}';
        expect(getEvaluationJSON(numeric({}), [], [1250])).toBe(before);
        expect(getEvaluationJSON(numeric({ numericTolerance: 0 }), [], [1250])).toBe(before);
        expect(getEvaluationJSON(numeric({ numericTolerance: null }), [], [1250])).toBe(before);
    });

    it('loads the tolerance back into the editor', () => {
        const loaded = transformResponseDataToMyQuestionsSchemaSingleQuestion({
            id: 'q-1',
            question_type: 'NUMERIC',
            text: { id: 't', type: 'HTML', content: 'Q' },
            options: [],
            auto_evaluation_json: '{"type":"NUMERIC","data":{"validAnswers":[1250],"tolerance":1}}',
            options_json: '{"decimals":0,"numericType":"INTEGER"}',
        } as never);
        expect(loaded.validAnswers).toEqual([1250]);
        expect(loaded.numericTolerance).toBe(1);
    });
});

describe('quiz slide answer key', () => {
    it('stores tolerance next to correctAnswers and leaves keys without one unchanged', () => {
        const [withTolerance, without, mcq] = transformFormQuestionsToBackend([
            { ...numeric({ numericTolerance: 1 }) },
            { ...numeric({}) },
            {
                ...numeric({ questionType: 'MCQS', numericTolerance: 1 }),
                singleChoiceOptions: [
                    { id: 'a', name: 'A', isSelected: true },
                    { id: 'b', name: 'B', isSelected: false },
                ],
            },
        ] as never);
        expect(JSON.parse(withTolerance!.auto_evaluation_json)).toEqual({
            correctAnswers: [1250],
            tolerance: 1,
        });
        expect(without!.auto_evaluation_json).toBe('{"correctAnswers":[1250]}');
        expect(JSON.parse(mcq!.auto_evaluation_json)).toEqual({ correctAnswers: ['a'] });
    });

    it('reads the tolerance back when a saved quiz opens', () => {
        const loaded = transformQuestion({
            id: 'q-1',
            question_type: 'NUMERIC',
            text: { content: 'Q' },
            options: [],
            auto_evaluation_json: '{"correctAnswers":[1250],"tolerance":2}',
        });
        expect(loaded.numericTolerance).toBe(2);
        expect(
            transformQuestion({ ...loaded, numericTolerance: null }).numericTolerance
        ).toBeNull();
    });
});
