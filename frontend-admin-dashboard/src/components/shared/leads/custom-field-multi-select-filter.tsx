import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CaretDown, Check, CircleNotch, PlusCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Separator } from '@/components/ui/separator';
import { ChipsWrapper } from '@/components/design-system/chips';
import { useCompactMode } from '@/hooks/use-compact-mode';
import { cn } from '@/lib/utils';
import { fetchLeadCustomFieldValues } from '@/routes/audience-manager/list/-services/get-lead-custom-field-values';
import { encodeContains, isSentinelValue, sentinelLabel } from './custom-field-filter-encoding';

const PAGE_SIZE = 20;

/** One page of distinct values for a custom field (Spring Page<String>). */
interface CustomFieldValuesPage {
    content: string[];
    number: number;
    last: boolean;
}

interface FetchCustomFieldValuesParams {
    instituteId: string;
    customFieldId: string;
    search?: string;
    pageNo: number;
    pageSize: number;
}

interface CustomFieldMultiSelectFilterProps {
    instituteId: string;
    /** custom_field_id (uuid) — matches how source rows key their values. */
    fieldId: string;
    /** Display label, e.g. "City". */
    fieldName: string;
    /** Currently selected values. */
    selected: string[];
    onChange: (values: string[]) => void;
    /** Distinct-values lookup. Defaults to the leads endpoint; pass a
     *  different fetcher (e.g. the Manage Students learner-scoped one) to
     *  reuse this same combobox for other USER-scoped custom fields. */
    fetchValues?: (params: FetchCustomFieldValuesParams) => Promise<CustomFieldValuesPage>;
    /** Trigger look. 'button' (default) matches the leads filter bar's other
     *  outline-button chips. 'pill' matches Manage Students' rounded
     *  FilterChips pill (see design-system/chips.tsx) so this combobox blends
     *  in next to that page's other filter chips. Styling only — no behavior
     *  differs between variants. */
    variant?: 'button' | 'pill';
    /** Cache namespace for the distinct-values query. Surfaces with different
     *  fetchers (leads vs students vs contacts) return DIFFERENT value lists
     *  for the same field — without this segment they'd share a React Query
     *  cache entry and show each other's values. Defaults to 'leads' (the
     *  default fetcher). */
    cacheScope?: string;
}

/**
 * Searchable, paginated multi-select for a single free-text custom field.
 * Originally built for the leads filter bar; `fetchValues` makes it reusable
 * wherever a filter needs distinct values for a custom field with no fixed
 * DROPDOWN option list (e.g. Manage Students' learner-scoped fields). Distinct
 * values are loaded lazily from the backend only once the dropdown is opened
 * (and re-fetched as the admin types), so a field the admin hasn't interacted
 * with never hits the API. Selecting values OR's them within this field; the
 * request AND's across fields.
 */
export function CustomFieldMultiSelectFilter({
    instituteId,
    fieldId,
    fieldName,
    selected,
    onChange,
    fetchValues = fetchLeadCustomFieldValues,
    variant = 'button',
    cacheScope = 'leads',
}: CustomFieldMultiSelectFilterProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Debounce the typed search so each keystroke doesn't fire a request.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);

    // Reset the search box whenever the dropdown closes so it reopens clean.
    useEffect(() => {
        if (!open) {
            setSearch('');
            setDebouncedSearch('');
        }
    }, [open]);

    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } =
        useInfiniteQuery({
            queryKey: ['customFieldValues', cacheScope, instituteId, fieldId, debouncedSearch],
            queryFn: ({ pageParam }) =>
                fetchValues({
                    instituteId,
                    customFieldId: fieldId,
                    search: debouncedSearch || undefined,
                    pageNo: pageParam,
                    pageSize: PAGE_SIZE,
                }),
            initialPageParam: 0,
            getNextPageParam: (lastPage) =>
                lastPage.last ? undefined : (lastPage.number ?? 0) + 1,
            // Lazy: only fetch once the dropdown is actually open.
            enabled: open && Boolean(instituteId) && Boolean(fieldId),
            staleTime: 60 * 1000,
        });

    const fetchedValues = useMemo(() => data?.pages.flatMap((p) => p.content ?? []) ?? [], [data]);

    // Surface already-selected values that aren't in the current (search-filtered)
    // page first, so they can always be unchecked. Sentinel selections (empty /
    // contains) are rendered separately with friendly labels, not as raw values.
    const orderedValues = useMemo(() => {
        const selectedNotShown = selected.filter(
            (v) => !fetchedValues.includes(v) && !isSentinelValue(v)
        );
        return [...selectedNotShown, ...fetchedValues];
    }, [selected, fetchedValues]);

    // Pinned typed-operator row: "contains <search>", offered only while the admin
    // is actually typing. Selecting it adds a sentinel-encoded value; the payload
    // builders decode sentinels into operator entries.
    //
    // Empty / Not-empty are deliberately NOT offered here. On a field with a
    // handful of real values (Branch has two) they read as two more values rather
    // than as operators, which is what admins kept taking them for. The sentinels
    // themselves still work — a selection restored from a URL renders through
    // selectedSentinels below and can be cleared — they are just not suggested.
    const containsSentinel = debouncedSearch ? encodeContains(debouncedSearch) : null;
    const pinnedOptions = useMemo(() => {
        const pinned: Array<{ value: string; label: string }> = [];
        if (containsSentinel && !selected.includes(containsSentinel)) {
            pinned.push({
                value: containsSentinel,
                label: `Contains "${debouncedSearch}"`,
            });
        }
        return pinned;
    }, [containsSentinel, debouncedSearch, selected]);

    const selectedSentinels = useMemo(() => selected.filter((v) => isSentinelValue(v)), [selected]);

    const toggle = (value: string) => {
        if (selected.includes(value)) {
            onChange(selected.filter((v) => v !== value));
        } else {
            onChange([...selected, value]);
        }
    };

    const count = selected.length;
    const triggerLabel = count > 0 ? `${fieldName} · ${count}` : fieldName;
    const { isCompact } = useCompactMode();

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {variant === 'pill' ? (
                    <button
                        type="button"
                        role="combobox"
                        aria-expanded={open}
                        aria-label={`Filter by ${fieldName}`}
                    >
                        <ChipsWrapper
                            className={cn(
                                count > 0
                                    ? 'border-primary-500 bg-primary-100'
                                    : 'hover:border-primary-500 hover:bg-primary-50'
                            )}
                        >
                            <div className="flex items-center gap-2">
                                <PlusCircle
                                    className={cn(
                                        isCompact ? 'size-3.5' : 'size-4',
                                        'text-neutral-600'
                                    )}
                                />
                                <div
                                    className={cn(
                                        'flex items-center',
                                        isCompact ? 'text-xs' : 'text-body',
                                        'text-neutral-600'
                                    )}
                                >
                                    {fieldName}
                                </div>
                                {count > 0 && (
                                    <div className="flex items-center gap-2">
                                        <Separator
                                            orientation="vertical"
                                            className="mx-2 h-4 bg-neutral-500"
                                        />
                                        <div className="inline-flex items-center rounded-md bg-primary-200 px-2.5 py-0.5 text-caption font-normal">
                                            {count} selected
                                        </div>
                                    </div>
                                )}
                            </div>
                        </ChipsWrapper>
                    </button>
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        role="combobox"
                        aria-expanded={open}
                        aria-label={`Filter by ${fieldName}`}
                        className={cn(
                            'h-10 max-w-56 justify-between',
                            count > 0 && 'border-primary-300 bg-primary-50'
                        )}
                    >
                        <span className="truncate text-sm font-normal">{triggerLabel}</span>
                        <CaretDown className="size-4 shrink-0 text-neutral-400" />
                    </Button>
                )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={`Search ${fieldName.toLowerCase()}…`}
                        className="h-9"
                        value={search}
                        onValueChange={setSearch}
                    />
                    <CommandList className="max-h-64 overflow-y-auto">
                        {isLoading ? (
                            <div className="flex items-center justify-center gap-2 py-6 text-sm text-neutral-500">
                                <CircleNotch className="size-4 animate-spin" />
                                Loading…
                            </div>
                        ) : isError ? (
                            <div className="py-6 text-center text-sm text-danger-600">
                                Couldn&apos;t load values.
                            </div>
                        ) : (
                            <>
                                <CommandEmpty>No values found.</CommandEmpty>
                                {count > 0 && (
                                    <CommandItem
                                        value="__clear__"
                                        onSelect={() => onChange([])}
                                        className="cursor-pointer text-neutral-500"
                                    >
                                        Clear selection
                                    </CommandItem>
                                )}
                                {(selectedSentinels.length > 0 || pinnedOptions.length > 0) && (
                                    <CommandGroup>
                                        {selectedSentinels.map((value) => (
                                            <CommandItem
                                                key={value}
                                                value={value}
                                                onSelect={() => toggle(value)}
                                                className="cursor-pointer"
                                            >
                                                <span className="mr-2 flex size-4 shrink-0 items-center justify-center rounded border border-primary-500 bg-primary-500 text-white">
                                                    <Check className="size-3" />
                                                </span>
                                                <span className="truncate italic text-neutral-600">
                                                    {sentinelLabel(value)}
                                                </span>
                                            </CommandItem>
                                        ))}
                                        {pinnedOptions
                                            .filter((opt) => !selected.includes(opt.value))
                                            .map((opt) => (
                                                <CommandItem
                                                    key={opt.value}
                                                    value={opt.value}
                                                    onSelect={() => toggle(opt.value)}
                                                    className="cursor-pointer"
                                                >
                                                    <span className="mr-2 size-4 shrink-0 rounded border border-neutral-300" />
                                                    <span className="truncate italic text-neutral-600">
                                                        {opt.label}
                                                    </span>
                                                </CommandItem>
                                            ))}
                                    </CommandGroup>
                                )}
                                <CommandGroup>
                                    {orderedValues.map((value) => (
                                        <CommandItem
                                            key={value}
                                            value={value}
                                            onSelect={() => toggle(value)}
                                            className="cursor-pointer"
                                        >
                                            <Check
                                                className={cn(
                                                    'mr-2 size-4',
                                                    selected.includes(value)
                                                        ? 'opacity-100'
                                                        : 'opacity-0'
                                                )}
                                            />
                                            <span className="truncate">{value}</span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                                {hasNextPage && (
                                    <button
                                        type="button"
                                        onClick={() => fetchNextPage()}
                                        disabled={isFetchingNextPage}
                                        className="flex w-full items-center justify-center gap-2 py-2 text-xs font-medium text-primary-500 hover:text-primary-600 disabled:opacity-60"
                                    >
                                        {isFetchingNextPage ? (
                                            <CircleNotch className="size-3 animate-spin" />
                                        ) : null}
                                        Load more
                                    </button>
                                )}
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
