import { describe, expect, it } from 'vitest';
import { uploadQuestionPaperFormSchema } from './upload-question-paper-form-schema';

const questionSchema = uploadQuestionPaperFormSchema('EXAM').shape.questions.element;

const numericQuestion = (validAnswers: unknown) => ({
    questionName: '<p>Find R</p>',
    questionType: 'NUMERIC',
    questionPenalty: '0',
    questionMark: '1',
    questionDuration: { hrs: '0', min: '0' },
    validAnswers,
});

const messages = (validAnswers: unknown) => {
    const result = questionSchema.safeParse(numericQuestion(validAnswers));
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('numeric answers in the paper form schema', () => {
    it('accepts an answer next to a box left empty', () => {
        expect(messages([275, null])).toEqual([]);
    });

    it('rejects a question whose only box is empty', () => {
        expect(messages([null])).toEqual(['NUMERIC questions must have at least one valid answer']);
    });

    it('still accepts answers stored as strings by an upload', () => {
        expect(messages(['275'])).toEqual([]);
    });
});
