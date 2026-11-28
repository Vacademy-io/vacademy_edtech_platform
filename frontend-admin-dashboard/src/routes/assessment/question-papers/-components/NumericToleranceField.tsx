import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Control, FieldValues, Path } from 'react-hook-form';
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { normaliseNumericTolerance } from '../-utils/numeric-tolerance';

// Every prefix of a non-negative number a teacher types on the way: '', '1', '0.', '0.5'.
const TOLERANCE_DRAFT = /^\d*\.?\d*$/;

const toDraft = (value: unknown) => {
    const tolerance = normaliseNumericTolerance(value);
    return tolerance === undefined ? '' : String(tolerance);
};

interface NumericToleranceFieldProps<T extends FieldValues> {
    control: Control<T>;
    name: Path<T>;
}

/**
 * "Accept answers within ± [X]" for a numeric question. Empty or 0 keeps the exact
 * match every numeric question has always had.
 */
export const NumericToleranceField = <T extends FieldValues>({
    control,
    name,
}: NumericToleranceFieldProps<T>) => {
    const { t } = useTranslation('assessmentNumericTemplateQP');
    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem className="w-full">
                    <ToleranceInput
                        value={field.value}
                        onChange={field.onChange}
                        label={t('tolerance.label')}
                        hint={t('tolerance.hint')}
                    />
                    <FormMessage />
                </FormItem>
            )}
        />
    );
};

interface ToleranceInputProps {
    value: unknown;
    onChange: (value: number | null) => void;
    label: string;
    hint: string;
}

const ToleranceInput = ({ value, onChange, label, hint }: ToleranceInputProps) => {
    const [draft, setDraft] = useState(() => toDraft(value));

    // Follow the form when it changes underneath (another question, a reset), but not
    // while the draft already means that value, or "0.50" would snap back to "0.5".
    useEffect(() => {
        if (normaliseNumericTolerance(draft) !== normaliseNumericTolerance(value)) {
            setDraft(toDraft(value));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <div className="flex flex-col gap-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-sm text-neutral-600">{label}</span>
                <FormControl>
                    <Input
                        type="text"
                        inputMode="decimal"
                        value={draft}
                        placeholder="0"
                        aria-label={label}
                        onChange={(e) => {
                            const next = e.target.value.trim();
                            if (!TOLERANCE_DRAFT.test(next)) return;
                            setDraft(next);
                            onChange(normaliseNumericTolerance(next) ?? null);
                        }}
                        className="w-24"
                    />
                </FormControl>
            </div>
            <span className="text-xs text-neutral-500">{hint}</span>
        </div>
    );
};
