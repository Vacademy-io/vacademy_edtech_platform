import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

export interface CheckOption {
    value: string;
    label: string;
    /** A second, quieter line (e.g. level and session of a batch). */
    sub?: string;
}

/**
 * A visible pick-several list: every row has a checkbox, picks show as removable chips above it,
 * with search and "select all / clear". Used where a closed dropdown hid that several can be
 * picked. Search is local unless `search` / `onSearchChange` are passed (server-side search).
 */
export function CheckList({
    options,
    selected,
    onChange,
    searchPlaceholder,
    emptyText,
    loading = false,
    search,
    onSearchChange,
    note,
    labelFor,
    single = false,
}: {
    options: CheckOption[];
    selected: string[];
    onChange: (next: string[]) => void;
    searchPlaceholder: string;
    emptyText: string;
    loading?: boolean;
    search?: string;
    onSearchChange?: (v: string) => void;
    note?: string;
    /** Label of a picked value that is not in `options` (filtered out by a server search). */
    labelFor?: (value: string) => string | undefined;
    /** Pick exactly one: choosing a row replaces the current pick, and there is no select-all. */
    single?: boolean;
}) {
    const { t } = useTranslation('engagementEnginesCreateIndex');
    const listId = useId();
    const [localSearch, setLocalSearch] = useState('');
    const serverSearch = onSearchChange !== undefined;
    const query = serverSearch ? search ?? '' : localSearch;
    const q = query.trim().toLowerCase();
    const shown =
        serverSearch || !q
            ? options
            : options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(q));
    const selectedSet = new Set(selected);
    const allShownPicked = shown.length > 0 && shown.every((o) => selectedSet.has(o.value));

    const toggle = (value: string) =>
        onChange(
            single
                ? selectedSet.has(value)
                    ? []
                    : [value]
                : selectedSet.has(value)
                  ? selected.filter((v) => v !== value)
                  : [...selected, value]
        );
    const toggleAllShown = () =>
        allShownPicked
            ? onChange(selected.filter((v) => !shown.some((o) => o.value === v)))
            : onChange([
                  ...selected,
                  ...shown.map((o) => o.value).filter((v) => !selectedSet.has(v)),
              ]);
    const labelOf = (value: string) => {
        const o = options.find((x) => x.value === value);
        if (o) return o.sub ? `${o.label} · ${o.sub}` : o.label;
        return labelFor?.(value) ?? t('audience.picker.unknown');
    };

    return (
        <div className="flex flex-col gap-2">
            {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {selected.map((v) => (
                        <span
                            key={v}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary-200 bg-primary-50 py-0.5 pe-1 ps-2.5 text-primary-700"
                        >
                            <span className="truncate text-caption font-medium">{labelOf(v)}</span>
                            <button
                                type="button"
                                onClick={() => toggle(v)}
                                aria-label={t('audience.picker.remove', { name: labelOf(v) })}
                                className="rounded-full p-0.5 text-primary-500 hover:bg-primary-100"
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                    <button
                        type="button"
                        onClick={() => onChange([])}
                        className="text-caption text-neutral-500 underline-offset-2 hover:text-danger-600 hover:underline"
                    >
                        {t('audience.picker.clear')}
                    </button>
                </div>
            )}
            <div className="overflow-hidden rounded-lg border border-neutral-200">
                <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2">
                    <div className="relative min-w-0 flex-1">
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
                        />
                        <Input
                            value={query}
                            onChange={(e) =>
                                serverSearch
                                    ? onSearchChange?.(e.target.value)
                                    : setLocalSearch(e.target.value)
                            }
                            placeholder={searchPlaceholder}
                            aria-label={searchPlaceholder}
                            aria-controls={listId}
                            className="h-8 bg-white ps-8"
                        />
                    </div>
                    {!single && shown.length > 0 && (
                        <button
                            type="button"
                            onClick={toggleAllShown}
                            className="shrink-0 text-caption font-medium text-primary-600 hover:text-primary-700"
                        >
                            {allShownPicked
                                ? t('audience.picker.unselectShown')
                                : q
                                  ? t('audience.picker.selectShown', { count: shown.length })
                                  : t('audience.picker.selectAll', { count: shown.length })}
                        </button>
                    )}
                </div>
                <ListWrap single={single} selected={selected} onChange={onChange}>
                <ul id={listId} className="max-h-64 overflow-y-auto">
                    {loading && shown.length === 0 && (
                        <li className="p-4 text-center text-caption text-neutral-500">
                            {t('audience.picker.loading')}
                        </li>
                    )}
                    {!loading && shown.length === 0 && (
                        <li className="p-4 text-center text-caption text-neutral-500">
                            {q ? t('audience.picker.noMatch', { query: query.trim() }) : emptyText}
                        </li>
                    )}
                    {shown.map((o) => {
                        const checked = selectedSet.has(o.value);
                        return (
                            <li key={o.value}>
                                <label
                                    className={cn(
                                        'flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors hover:bg-neutral-50',
                                        checked && 'bg-primary-50 hover:bg-primary-50'
                                    )}
                                >
                                    {single ? (
                                        <RadioGroupItem value={o.value} className="mt-0.5 size-4" />
                                    ) : (
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => toggle(o.value)}
                                            className="mt-0.5"
                                        />
                                    )}
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-body text-neutral-800">
                                            {o.label}
                                        </span>
                                        {o.sub && (
                                            <span className="truncate text-caption text-neutral-500">
                                                {o.sub}
                                            </span>
                                        )}
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
                </ListWrap>
            </div>
            {note && <p className="text-caption text-neutral-500">{note}</p>}
        </div>
    );
}

/** Single-pick lists sit in a radio group so rows show radios; multi-pick lists render as-is. */
function ListWrap({
    single,
    selected,
    onChange,
    children,
}: {
    single: boolean;
    selected: string[];
    onChange: (next: string[]) => void;
    children: React.ReactNode;
}) {
    if (!single) return <>{children}</>;
    return (
        <RadioGroup
            value={selected[0] ?? ''}
            onValueChange={(v) => onChange([v])}
            className="gap-0"
        >
            {children}
        </RadioGroup>
    );
}
