import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NumericAnswerInput, answerSlots, toAnswerNumber } from './NumericAnswerInput';

// Holds the answer the way the form does, so every keystroke round-trips through it.
const Harness = ({ initial, seen }: { initial: unknown; seen: unknown[] }) => {
    const [value, setValue] = useState<unknown>(initial);
    return (
        <NumericAnswerInput
            value={value}
            onChange={(next) => {
                seen.push(next);
                setValue(next);
            }}
        />
    );
};

// One change event per keystroke, as the browser sends them.
const typeInto = (input: HTMLElement, text: string, from = '') => {
    let current = from;
    for (const ch of text) {
        current += ch;
        fireEvent.change(input, { target: { value: current } });
    }
};

describe('NumericAnswerInput', () => {
    it.each([
        ['2.05', 2.05],
        ['0.05', 0.05],
        ['1.205', 1.205],
        ['-5', -5],
        ['-0.5', -0.5],
        ['274.99', 274.99],
    ])('keeps "%s" as typed and saves %s', (text, saved) => {
        const seen: unknown[] = [];
        render(<Harness initial={null} seen={seen} />);
        const input = screen.getByRole('textbox');
        typeInto(input, text);
        expect((input as HTMLInputElement).value).toBe(text);
        expect(seen.at(-1)).toBe(saved);
    });

    it('can be emptied, and then means no answer (not 0)', () => {
        const seen: unknown[] = [];
        render(<Harness initial={275} seen={seen} />);
        const input = screen.getByRole('textbox') as HTMLInputElement;
        expect(input.value).toBe('275');
        fireEvent.change(input, { target: { value: '' } });
        expect(input.value).toBe('');
        expect(seen.at(-1)).toBeNull();
    });

    it('ignores letters', () => {
        const seen: unknown[] = [];
        render(<Harness initial={1} seen={seen} />);
        const input = screen.getByRole('textbox') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '1a' } });
        expect(input.value).toBe('1');
        expect(seen).toEqual([]);
    });

    it('shows a stored string answer from an upload', () => {
        render(<Harness initial="275" seen={[]} />);
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('275');
    });

    it('follows the form when the question changes underneath it', () => {
        const { rerender } = render(<NumericAnswerInput value={275} onChange={() => {}} />);
        rerender(<NumericAnswerInput value={0.287} onChange={() => {}} />);
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('0.287');
    });
});

describe('answer helpers', () => {
    it('toAnswerNumber treats partial and empty drafts as no answer', () => {
        expect(['', '-', '.', '-.', null, undefined].map(toAnswerNumber)).toEqual([
            null,
            null,
            null,
            null,
            null,
            null,
        ]);
        expect(toAnswerNumber('2.')).toBe(2);
        expect(toAnswerNumber(0)).toBe(0);
    });

    it('answerSlots shows one empty box when there is no answer', () => {
        expect(answerSlots(undefined)).toEqual([null]);
        expect(answerSlots([])).toEqual([null]);
        expect(answerSlots([275, 274.99])).toEqual([275, 274.99]);
    });
});
