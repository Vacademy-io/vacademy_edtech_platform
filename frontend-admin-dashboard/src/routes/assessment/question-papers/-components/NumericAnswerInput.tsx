import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Every prefix of a number a teacher types on the way: '', '-', '2.', '2.0', '-0.05'.
const NUMBER_DRAFT = /^-?\d*\.?\d*$/;

/** The number a draft or stored answer means, or null while it is empty or partial. */
export const toAnswerNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (text === '' || text === '-' || text === '.' || text === '-.') return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
};

const toDraft = (value: unknown) => {
    const parsed = toAnswerNumber(value);
    return parsed === null ? '' : String(parsed);
};

interface NumericAnswerInputProps {
    value: unknown;
    onChange: (value: number | null) => void;
    className?: string;
}

/**
 * One accepted answer of a numeric question.
 *
 * The text is kept as typed and only its meaning goes to the form. Writing the parsed
 * number straight back into the box (the old way) turned "2.05" into 25, "-5" into 5 and
 * an emptied box back into 0, because "2.0" and "-" parse to 2 and nothing.
 */
export const NumericAnswerInput = ({ value, onChange, className }: NumericAnswerInputProps) => {
    const [draft, setDraft] = useState(() => toDraft(value));

    // Follow the form when it changes underneath (another question, a reset), but not
    // while the draft already means that number, or "2.0" would snap back to "2".
    useEffect(() => {
        if (toAnswerNumber(draft) !== toAnswerNumber(value)) setDraft(toDraft(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <Input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => {
                const next = e.target.value.trim();
                if (!NUMBER_DRAFT.test(next)) return;
                setDraft(next);
                onChange(toAnswerNumber(next));
            }}
            className={cn('w-24', className)}
        />
    );
};

/** The answer boxes to show: the stored answers, or one empty box when there are none. */
export const answerSlots = (value: unknown): unknown[] =>
    Array.isArray(value) && value.length > 0 ? value : [null];
