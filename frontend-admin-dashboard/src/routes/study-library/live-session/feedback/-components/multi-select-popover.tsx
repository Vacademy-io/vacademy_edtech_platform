import { useMemo, useState } from 'react';
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
    value: string;
    label: string;
}

interface MultiSelectPopoverProps {
    label: string;
    options: MultiSelectOption[];
    /** Selected values; empty means "All". */
    selected: string[];
    onChange: (next: string[]) => void;
    searchable?: boolean;
    emptyText?: string;
    /** Trigger text when nothing is selected; defaults to "All {label}". */
    allText?: string;
    /**
     * How the trigger summarises a multi-selection: a count ("3 selected") or the
     * selected labels joined ("2, 3") — the latter suits short, fixed option
     * sets like rating thresholds.
     */
    summary?: 'count' | 'labels';
    /** Overrides the option list's max height (default `max-h-60`) — e.g. a
     *  short fixed list that should never need to scroll. */
    listClassName?: string;
    /** Adds "Select all", which ticks every option matching the current search. */
    selectAll?: boolean;
}

/**
 * Compact "All / multi-select" filter dropdown used by the feedback page for
 * batch and subject filters. An empty selection means "All".
 */
export function MultiSelectPopover({
    label,
    options,
    selected,
    onChange,
    searchable = true,
    emptyText,
    allText,
    summary = 'count',
    listClassName,
    selectAll = false,
}: MultiSelectPopoverProps) {
    const { t } = useTranslation('studyLibraryMultiSelectPopover');
    const resolvedEmptyText = emptyText ?? t('noOptions');
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    }, [options, search]);

    const toggle = (value: string) => {
        onChange(
            selected.includes(value)
                ? selected.filter((v) => v !== value)
                : [...selected, value]
        );
    };

    const labelFor = (value: string) => options.find((o) => o.value === value)?.label;
    const triggerText =
        selected.length === 0
            ? allText ?? t('allLabel', { label: label.toLowerCase() })
            : selected.length === 1
              ? labelFor(selected[0]!) || t('selectedCount', { count: 1 })
              : summary === 'labels'
                ? selected
                      .map(labelFor)
                      .filter(Boolean)
                      .join(', ')
                : t('selectedCount', { count: selected.length });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'flex h-9 min-w-48 items-center justify-between gap-2 rounded-md border px-3 text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-primary-500',
                        selected.length > 0
                            ? 'border-primary-500 bg-primary-50 text-primary-600'
                            : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                    )}
                >
                    <span className="truncate">
                        <span className="text-neutral-500">{label}:</span> {triggerText}
                    </span>
                    <CaretDown size={14} className="shrink-0 text-neutral-500" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
                {searchable && (
                    <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
                        <MagnifyingGlass size={14} className="text-neutral-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('searchPlaceholder', { label: label.toLowerCase() })}
                            className="h-6 w-full border-none bg-transparent text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-0"
                        />
                    </div>
                )}
                <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
                    <span className="text-xs font-medium text-neutral-500">
                        {selected.length === 0 ? t('allSelected') : t('selectedCount', { count: selected.length })}
                    </span>
                    <div className="flex items-center gap-3">
                        {selectAll && filtered.some((o) => !selected.includes(o.value)) && (
                            <button
                                type="button"
                                onClick={() =>
                                    onChange(
                                        Array.from(
                                            new Set([...selected, ...filtered.map((o) => o.value)])
                                        )
                                    )
                                }
                                className="text-xs font-medium text-primary-600 hover:underline"
                            >
                                {search.trim() ? t('selectAllMatching') : t('selectAll')}
                            </button>
                        )}
                        {selected.length > 0 && (
                            <button
                                type="button"
                                onClick={() => onChange([])}
                                className="text-xs font-medium text-primary-600 hover:underline"
                            >
                                {t('clear')}
                            </button>
                        )}
                    </div>
                </div>
                <div className={cn('max-h-60 overflow-y-auto py-1', listClassName)}>
                    {filtered.length === 0 ? (
                        <div className="px-3 py-6 text-center text-xs text-neutral-400">
                            {resolvedEmptyText}
                        </div>
                    ) : (
                        filtered.map((opt) => {
                            const checked = selected.includes(opt.value);
                            return (
                                <label
                                    key={opt.value}
                                    className="flex cursor-pointer items-start gap-2 px-3 py-1.5 hover:bg-neutral-50"
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggle(opt.value)}
                                        className="mt-0.5 size-3.5 shrink-0 rounded border-neutral-300 text-primary-500 accent-primary-500 focus:ring-primary-500"
                                    />
                                    <span
                                        className={cn(
                                            'text-xs leading-snug',
                                            checked
                                                ? 'font-medium text-primary-600'
                                                : 'text-neutral-700'
                                        )}
                                    >
                                        {opt.label}
                                    </span>
                                </label>
                            );
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
