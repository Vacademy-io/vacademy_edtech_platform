/**
 * The option picker: chips and swatches as radio groups, with
 * sold-out and missing combinations announced. Used by the product page and by the quick-add
 * sheet of a card.
 */
import React, { useId, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { ProductOption, Variant } from '../api/types';
import { optionAvailability, type Selection, type ValueAvailability } from '../logic/options';
import { useCommerceSite } from './site';

export const OptionPicker: React.FC<{
    options: readonly ProductOption[];
    variants: readonly Variant[];
    selection: Selection;
    onSelect(optionCode: string, valueCode: string): void;
}> = ({ options, variants, selection, onSelect }) => {
    const { t } = useCommerceSite();
    const availability = useMemo(() => optionAvailability(options, variants, selection), [options, variants, selection]);
    const groupId = useId();
    // Arrow keys move through a group like radio buttons, skipping values that do not exist.
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        if (!forward && !back) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (at < 0 || buttons.length < 2) return;
        event.preventDefault();
        const next = buttons[(at + (forward ? 1 : -1) + buttons.length) % buttons.length];
        next?.focus();
        next?.click();
    };
    return (
        <div className="cmx-options">
            {options.map((option) => {
                const picked = option.values.find((v) => v.code === selection[option.code]);
                const swatches = (option.kind || '').toUpperCase() === 'SWATCH';
                const labelId = `${groupId}-${option.code}`;
                return (
                    <div key={option.code}>
                        <span className="cmx-option__label" id={labelId}>
                            {option.name || option.code}
                            {picked && (
                                <>
                                    : <strong>{picked.label || picked.code}</strong>
                                </>
                            )}
                        </span>
                        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2" onKeyDown={onKeyDown}>
                            {[...option.values]
                                .sort((a, b) => a.position - b.position)
                                .map((value) => {
                                    const state: ValueAvailability = availability[option.code]?.[value.code] ?? 'missing';
                                    const label = value.label || value.code;
                                    const checked = selection[option.code] === value.code;
                                    const spoken =
                                        state === 'sold_out'
                                            ? t('product.option.soldOut', { label })
                                            : state === 'missing'
                                              ? t('product.option.unavailable', { label })
                                              : label;
                                    const common = {
                                        type: 'button' as const,
                                        role: 'radio',
                                        'aria-checked': checked,
                                        'aria-label': spoken,
                                        // A combination with no variant cannot be picked; a sold-out one can, to read "sold out".
                                        disabled: state === 'missing',
                                        tabIndex: checked || (!picked && value === option.values[0]) ? 0 : -1,
                                        onClick: () => onSelect(option.code, value.code),
                                    };
                                    return swatches && value.swatch_hex ? (
                                        <button
                                            key={value.code}
                                            {...common}
                                            title={label}
                                            className={cn('cmx-swatch-btn', state === 'sold_out' && 'cmx-swatch-btn--soldout')}
                                        >
                                            {/* The seller's colour value, not a theme colour. */}
                                            <span style={{ ['--cmx-swatch' as string]: value.swatch_hex }} />
                                        </button>
                                    ) : (
                                        <button key={value.code} {...common} className={cn('cmx-chip', state === 'sold_out' && 'cmx-chip--soldout')}>
                                            {label}
                                        </button>
                                    );
                                })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
