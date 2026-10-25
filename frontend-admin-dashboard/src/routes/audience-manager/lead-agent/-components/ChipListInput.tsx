import { useState, type KeyboardEvent } from 'react';
import { Plus, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';

interface ChipListInputProps {
    value: string[];
    onChange: (next: string[]) => void;
    placeholder?: string;
    /** Quick-add options shown under the input when not already chosen. */
    presets?: string[];
    max?: number;
    disabled?: boolean;
    ariaLabel: string;
    error?: string;
}

/**
 * An editable list of short phrases: type and press Enter (or Add), remove with ×.
 * Duplicates (case-insensitive) are ignored.
 */
export function ChipListInput({
    value,
    onChange,
    placeholder,
    presets,
    max = 30,
    disabled,
    ariaLabel,
    error,
}: ChipListInputProps) {
    const [draft, setDraft] = useState('');
    const has = (s: string) => value.some((v) => v.toLowerCase() === s.trim().toLowerCase());
    const full = value.length >= max;

    const add = (raw: string) => {
        // A pasted comma- or line-separated list becomes several chips.
        const parts = raw
            .split(/[\n,]/)
            .map((p) => p.trim())
            .filter(Boolean);
        const next = [...value];
        for (const p of parts) {
            if (next.length >= max) break;
            if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
        }
        if (next.length !== value.length) onChange(next);
        setDraft('');
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (draft.trim()) add(draft);
        } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
        }
    };

    const openPresets = (presets ?? []).filter((p) => !has(p));

    return (
        <div className="flex flex-col gap-2">
            {value.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label={ariaLabel}>
                    {value.map((item) => (
                        <li
                            key={item}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary-200 bg-primary-50 py-1 pe-1 ps-3 text-caption text-neutral-700"
                        >
                            <span className="truncate">{item}</span>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onChange(value.filter((v) => v !== item))}
                                className="flex size-5 items-center justify-center rounded-full text-neutral-500 hover:bg-primary-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                aria-label={`Remove ${item}`}
                            >
                                <X className="size-3" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <MyInput
                        input={draft}
                        onChangeFunction={(e) => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        inputPlaceholder={full ? `Up to ${max}` : placeholder}
                        disabled={disabled || full}
                        aria-label={ariaLabel}
                        className="sm:w-full"
                        error={error}
                    />
                </div>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable={disabled || full || !draft.trim()}
                    onClick={() => add(draft)}
                    aria-label={`Add to ${ariaLabel}`}
                >
                    <Plus className="size-4" />
                    Add
                </MyButton>
            </div>
            {openPresets.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption text-neutral-500">Quick add:</span>
                    {openPresets.map((p) => (
                        <MyButton
                            key={p}
                            type="button"
                            buttonType="text"
                            scale="small"
                            disable={disabled || full}
                            onClick={() => add(p)}
                            className={cn('h-auto px-0')}
                        >
                            + {p}
                        </MyButton>
                    ))}
                </div>
            )}
        </div>
    );
}
