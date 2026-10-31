import { describe, expect, it } from 'vitest';
import {
    criteriaStatus,
    criteriaToCopyCheckRubric,
    toEditableCriteria,
    toRubric,
    type CopyCheckCriteriaQuestion,
} from '@/services/copy-check-criteria';

const RUBRIC = {
    max_marks: 3,
    partial_marking_enabled: true,
    evaluation_instructions: 'CBSE scheme: content and expression.',
    rubric: [
        {
            criteria_name: 'Content',
            max_marks: 2,
            keywords: ['bol', 'pader'],
            evaluation_guidelines: 'Points',
        },
        {
            criteria_name: 'Expression and accuracy',
            max_marks: 1,
            keywords: [],
            evaluation_guidelines: 'Language',
        },
    ],
};

const question = (over: Partial<CopyCheckCriteriaQuestion>): CopyCheckCriteriaQuestion => ({
    question_id: 'q1',
    number: 1,
    text: 'How was bread important?',
    question_type: 'LONG_ANSWER',
    max_marks: 3,
    rubric: null,
    question_criteria: null,
    ...over,
});

describe('copy-check criteria', () => {
    it('reads either stored shape for the editor', () => {
        expect(toEditableCriteria(RUBRIC, 3)).toEqual({
            max_marks: 3,
            criteria: [
                { name: 'Content', description: 'Points', max_marks: 2 },
                { name: 'Expression and accuracy', description: 'Language', max_marks: 1 },
            ],
        });
        const editor = {
            max_marks: 2,
            criteria: [{ name: 'Point', description: 'x', max_marks: 2 }],
        };
        expect(toEditableCriteria(editor, 3)?.max_marks).toBe(3);
        expect(toEditableCriteria(null, 3)).toBeUndefined();
        expect(toEditableCriteria('garbage', 3)).toBeUndefined();
    });

    it('keeps keywords and marking instructions of the rubric it replaces', () => {
        const edited = {
            max_marks: 3,
            criteria: [
                { name: 'content ', description: 'New points', max_marks: 2.5 },
                { name: 'Accuracy', description: 'Grammar', max_marks: 0.5 },
                { name: '  ', description: 'dropped', max_marks: 0 },
            ],
        };
        expect(criteriaToCopyCheckRubric(edited, 3, RUBRIC)).toEqual({
            max_marks: 3,
            partial_marking_enabled: true,
            evaluation_instructions: 'CBSE scheme: content and expression.',
            rubric: [
                {
                    criteria_name: 'content',
                    max_marks: 2.5,
                    keywords: ['bol', 'pader'],
                    evaluation_guidelines: 'New points',
                },
                {
                    criteria_name: 'Accuracy',
                    max_marks: 0.5,
                    keywords: [],
                    evaluation_guidelines: 'Grammar',
                },
            ],
        });
        expect(criteriaToCopyCheckRubric(edited, 3).evaluation_instructions).toBe('');
    });

    it('turns either shape into a rubric at the question maximum', () => {
        expect(toRubric({ ...RUBRIC, max_marks: 5 }, 3)?.max_marks).toBe(3);
        expect(
            toRubric(
                { max_marks: 1, criteria: [{ name: 'Correct', description: 'key', max_marks: 1 }] },
                1
            )?.rubric[0]
        ).toEqual({
            criteria_name: 'Correct',
            max_marks: 1,
            keywords: [],
            evaluation_guidelines: 'key',
        });
        expect(toRubric(null, 3)).toBeNull();
    });

    it('says what the AI will mark a question by', () => {
        expect(criteriaStatus(question({ rubric: RUBRIC }))).toBe('SET');
        expect(criteriaStatus(question({ question_criteria: RUBRIC }))).toBe('FROM_QUESTION');
        expect(criteriaStatus(question({ rubric: { ...RUBRIC, rubric: [] } }))).toBe('AI');
        expect(criteriaStatus(question({}))).toBe('AI');
    });
});
