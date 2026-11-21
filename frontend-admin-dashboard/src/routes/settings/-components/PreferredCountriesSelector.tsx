import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CaretUpDown, X, ArrowUp, ArrowDown, Star } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
    COUNTRIES,
    countryCodeToFlag,
    findCountry,
} from '../-utils/countries';

interface PreferredCountriesSelectorProps {
    /** Currently selected country codes (lowercase ISO alpha-2), in display order. */
    value: string[];
    /** Called with the new ordered list whenever the selection changes. */
    onChange: (codes: string[]) => void;
}

/**
 * Multi-select country picker for the white-label "preferred countries" setting.
 *
 * Order matters: the FIRST selected country becomes the default for phone inputs,
 * and the full list determines the order shown in the country picker dropdown.
 *
 * - Click an item in the popover to add it (added to the END of the list).
 * - Click a selected chip's × to remove it.
 * - Use the ↑ / ↓ arrows on each chip to reorder, e.g. to set the default.
 */
export default function PreferredCountriesSelector({
    value,
    onChange,
}: PreferredCountriesSelectorProps) {
    const { t } = useTranslation('settingsPreferredCountriesSelector');
    const [open, setOpen] = useState(false);

    const selectedSet = useMemo(() => new Set(value), [value]);

    const toggle = (code: string) => {
        if (selectedSet.has(code)) {
            onChange(value.filter((c) => c !== code));
        } else {
            onChange([...value, code]);
        }
    };

    const remove = (code: string) => {
        onChange(value.filter((c) => c !== code));
    };

    const move = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= value.length) return;
        const next = value.slice();
        [next[index], next[target]] = [next[target] as string, next[index] as string];
        onChange(next);
    };

    return (
        <div className="space-y-2">
            {/* Selected chips */}
            {value.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 rounded-md border border-slate-200 bg-white p-2">
                    {value.map((code, idx) => {
                        const country = findCountry(code);
                        const isDefault = idx === 0;
                        return (
                            <div
                                key={code}
                                className={cn(
                                    'group flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
                                    isDefault
                                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                                        : 'border-slate-200 bg-slate-50 text-slate-700'
                                )}
                                title={
                                    isDefault
                                        ? t('chips.defaultTooltip')
                                        : country?.name
                                }
                            >
                                {isDefault && (
                                    <Star className="size-3 fill-amber-500 text-amber-500" />
                                )}
                                <span className="text-sm leading-none">
                                    {countryCodeToFlag(code)}
                                </span>
                                <span className="font-medium uppercase">{code}</span>
                                <span className="hidden text-slate-500 sm:inline">
                                    {country?.name}
                                </span>
                                <span className="text-slate-400">{country?.dialCode}</span>

                                {/* Reorder controls */}
                                <button
                                    type="button"
                                    onClick={() => move(idx, -1)}
                                    disabled={idx === 0}
                                    className="ml-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                                    title={t('chips.moveUp')}
                                >
                                    <ArrowUp className="size-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => move(idx, 1)}
                                    disabled={idx === value.length - 1}
                                    className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                                    title={t('chips.moveDown')}
                                >
                                    <ArrowDown className="size-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => remove(code)}
                                    className="rounded p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                                    title={t('chips.remove')}
                                >
                                    <X className="size-3" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2 text-xs italic text-slate-400">
                    {t('emptyState')}
                </p>
            )}

            {/* Popover trigger + searchable list */}
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="flex h-9 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 text-left text-sm text-slate-600 hover:bg-slate-50"
                    >
                        <span className="text-slate-500">
                            {value.length === 0
                                ? t('trigger.selectPlaceholder')
                                : t('trigger.addOrRemove', { count: value.length })}
                        </span>
                        <CaretUpDown className="size-4 text-slate-400" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                    <Command>
                        <CommandInput placeholder={t('search.placeholder')} className="h-9" />
                        <CommandList className="max-h-64">
                            <CommandEmpty>{t('search.empty')}</CommandEmpty>
                            <CommandGroup>
                                {COUNTRIES.map((country) => {
                                    const checked = selectedSet.has(country.code);
                                    return (
                                        <CommandItem
                                            key={country.code}
                                            // Include code + native-script name so search
                                            // matches "in" → India, "افغانستان" → Afghanistan, etc.
                                            value={`${country.name} ${country.nameFull} ${country.code} ${country.dialCode}`}
                                            onSelect={() => toggle(country.code)}
                                            className="flex items-center gap-2"
                                        >
                                            <span
                                                className={cn(
                                                    'flex size-4 items-center justify-center rounded border',
                                                    checked
                                                        ? 'border-blue-500 bg-blue-500 text-white'
                                                        : 'border-slate-300'
                                                )}
                                            >
                                                {checked && <Check className="size-3" />}
                                            </span>
                                            <span className="text-base leading-none">
                                                {countryCodeToFlag(country.code)}
                                            </span>
                                            <span className="flex-1 truncate text-sm">
                                                {country.name}
                                            </span>
                                            <span className="text-xs uppercase text-slate-400">
                                                {country.code}
                                            </span>
                                            <span className="text-xs text-slate-500">
                                                {country.dialCode}
                                            </span>
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}
