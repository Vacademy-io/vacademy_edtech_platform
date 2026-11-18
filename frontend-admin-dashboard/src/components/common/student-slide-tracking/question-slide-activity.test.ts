import { describe, expect, it } from 'vitest';
import {
    questionSlideCorrectAnswer,
    questionSlideQuestionName,
    questionSlideResponseText,
} from './question-slide-activity';

describe('questionSlideCorrectAnswer', () => {
    it('reads the ticked option of the slide editor form', () => {
        expect(
            questionSlideCorrectAnswer({
                questionType: 'MCQS',
                singleChoiceOptions: [
                    { id: 'a', name: '<p>6 J</p>', isSelected: false },
                    { id: 'b', name: '<p>9 J</p>', isSelected: true },
                ],
            })
        ).toBe('9 J');
    });

    it('joins every ticked option of a multiple-correct question', () => {
        expect(
            questionSlideCorrectAnswer({
                questionType: 'MCQM',
                multipleChoiceOptions: [
                    { name: '<p>A</p>', isSelected: true },
                    { name: '<p>B</p>', isSelected: false },
                    { name: '<p>C</p>', isSelected: true },
                ],
            })
        ).toBe('A, C');
    });

    it('labels true / false options', () => {
        expect(
            questionSlideCorrectAnswer({
                questionType: 'TRUE_FALSE',
                trueFalseOptions: [
                    { name: '', isSelected: false },
                    { name: '', isSelected: true },
                ],
            })
        ).toBe('False');
    });

    it('reads numeric and text answers of the form', () => {
        expect(questionSlideCorrectAnswer({ questionType: 'NUMERIC', validAnswers: [2.5, 3] })).toBe(
            '2.5, 3'
        );
        expect(
            questionSlideCorrectAnswer({ questionType: 'ONE_WORD', subjectiveAnswerText: 'accrual' })
        ).toBe('accrual');
    });

    it('reads the raw backend shape (key of option ids)', () => {
        expect(
            questionSlideCorrectAnswer({
                question_type: 'MCQS',
                auto_evaluation_json: '{"type":"MCQS","data":{"correctOptionIds":["o2"]}}',
                options: [
                    { id: 'o1', text: { content: '<p>Red</p>' } },
                    { id: 'o2', text: { content: '<p>Blue</p>' } },
                ],
            })
        ).toBe('Blue');
    });

    it('returns empty for an unreadable or missing key', () => {
        expect(questionSlideCorrectAnswer(null)).toBe('');
        expect(
            questionSlideCorrectAnswer({ question_type: 'MCQS', auto_evaluation_json: 'not json' })
        ).toBe('');
        expect(
            questionSlideCorrectAnswer({
                questionType: 'MCQS',
                singleChoiceOptions: [{ name: 'a', isSelected: false }],
            })
        ).toBe('');
    });
});

describe('questionSlideResponseText', () => {
    it('strips the editor HTML from the picked option names', () => {
        expect(
            questionSlideResponseText(
                '{"questionName":"<p>Q</p>","selectedOptions":[{"id":"x","name":"<p>9&nbsp;J</p>"}]}'
            )
        ).toBe('9 J');
    });

    it('is empty for nothing or bad JSON, and reads the question name', () => {
        expect(questionSlideResponseText(undefined)).toBe('');
        expect(questionSlideResponseText('{')).toBe('');
        expect(questionSlideQuestionName('{"questionName":"<p>Q</p>"}')).toBe('<p>Q</p>');
    });
});
