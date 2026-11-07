import { describe, expect, it } from 'vitest';
import { sectionsEditQuestionFormSchema } from './sections-edit-question-form-schema';

const parse = (validAnswers: unknown) =>
    sectionsEditQuestionFormSchema.safeParse({
        sections: [
            {
                questions: [
                    {
                        id: 'q-1',
                        questionName: '<p>Find R</p>',
                        questionType: 'NUMERIC',
                        questionPenalty: '0',
                        questionMark: '1',
                        questionDuration: { hrs: '0', min: '0' },
                        validAnswers,
                    },
                ],
            },
        ],
    });

const validAnswersIssues = (validAnswers: unknown) => {
    const result = parse(validAnswers);
    return result.success
        ? []
        : result.error.issues.filter((issue) => issue.path.includes('validAnswers'));
};

describe('numeric answers in the assessment preview form', () => {
    it('accepts an answer next to a box left empty', () => {
        expect(validAnswersIssues([275, null])).toEqual([]);
    });

    it('accepts a question with no answer, as before', () => {
        expect(validAnswersIssues(undefined)).toEqual([]);
    });
});
