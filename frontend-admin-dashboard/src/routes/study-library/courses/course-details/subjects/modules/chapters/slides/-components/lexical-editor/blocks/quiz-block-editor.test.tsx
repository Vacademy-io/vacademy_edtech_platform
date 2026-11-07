import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuizBlockEditor } from './payload-block-editors';
import type { QuizPayload } from '../nodes/payload-nodes';

// The rich-text sub-fields drag in S3 upload + auth token plumbing that has no
// business in a radio-group test; the quiz's correctness state lives entirely
// in the native radios.
vi.mock('../../yoopta-editor-customizations/RichTextField', () => ({
    RichTextField: ({ value, placeholder }: { value: string; placeholder?: string }) => (
        <div data-testid="rich-text">{value || placeholder}</div>
    ),
    RichTextHtml: ({ html }: { html: string }) => <div>{html}</div>,
}));

const blankQuiz = (prefix: string): QuizPayload => ({
    question: `${prefix} question`,
    type: 'mcq',
    options: [
        { text: `${prefix}A`, isCorrect: false },
        { text: `${prefix}B`, isCorrect: false },
    ],
    explanation: '',
});

const correctIndex = (p: QuizPayload) => p.options.findIndex((o) => o.isCorrect);

/** Two independent quiz blocks on one slide, each owning its own payload — the
 *  shape the Lexical decorator renders. */
function TwoQuizzes({ onState }: { onState: (payloads: QuizPayload[]) => void }) {
    const [first, setFirst] = useState(blankQuiz('1'));
    const [second, setSecond] = useState(blankQuiz('2'));
    onState([first, second]);
    return (
        <>
            <QuizBlockEditor payload={first} setPayload={setFirst} readOnly={false} />
            <QuizBlockEditor payload={second} setPayload={setSecond} readOnly={false} />
        </>
    );
}

describe('QuizBlockEditor correct-answer radios', () => {
    it('gives each quiz block its own radio group', () => {
        render(<TwoQuizzes onState={() => {}} />);
        const names = new Set(
            screen.getAllByRole('radio').map((el) => (el as HTMLInputElement).name)
        );
        expect(names.size).toBe(2);
    });

    it('keeps both answers when two quizzes on one slide are answered in turn', () => {
        // Regression: a single shared `name` made every quiz on the slide one
        // document-wide radio group, so answering the second silently unchecked
        // the first and its answer looked lost.
        let payloads: QuizPayload[] = [];
        render(<TwoQuizzes onState={(p) => (payloads = p)} />);
        const radios = screen.getAllByRole('radio') as HTMLInputElement[];

        fireEvent.click(radios[0]!); // quiz 1 → option A
        fireEvent.click(radios[3]!); // quiz 2 → option B

        // What gets serialized into data-quiz.
        expect(correctIndex(payloads[0]!)).toBe(0);
        expect(correctIndex(payloads[1]!)).toBe(1);
        // What the author sees.
        expect(radios.map((r) => r.checked)).toEqual([true, false, false, true]);
    });

    it('still allows only one correct answer within a single quiz', () => {
        let payloads: QuizPayload[] = [];
        render(<TwoQuizzes onState={(p) => (payloads = p)} />);
        const radios = screen.getAllByRole('radio') as HTMLInputElement[];

        fireEvent.click(radios[0]!);
        fireEvent.click(radios[1]!); // same quiz, switch A → B

        expect(payloads[0]!.options.filter((o) => o.isCorrect)).toHaveLength(1);
        expect(correctIndex(payloads[0]!)).toBe(1);
        expect(radios[0]!.checked).toBe(false);
    });
});
