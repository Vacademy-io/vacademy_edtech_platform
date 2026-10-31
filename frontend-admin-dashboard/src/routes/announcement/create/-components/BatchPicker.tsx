import { useMemo, useState } from 'react';
import { CaretUpDown, Check, GraduationCap, MagnifyingGlass, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Command, CommandInput, CommandList } from '@/components/ui/command';
import type { BatchOption } from '../-types';

// Radix exposes the trigger width only as a CSS variable, so there is no token form for it.
const POPOVER_WIDTH = 'w-[--radix-popover-trigger-width]'; // design-lint-ignore

interface BatchPickerProps {
    batches: BatchOption[];
    loading?: boolean;
    selected: string[];
    onChange: (ids: string[]) => void;
    invalid?: boolean;
    /** Label used in the trigger and empty copy, e.g. "batch" / "class". */
    noun: string;
    nounPlural: string;
}

/**
 * Multi-select over package sessions, grouped by course.
 *
 * The previous form allowed exactly one batch per audience row, so targeting a six-batch course
 * meant adding six rows and repeating every filter and exclusion on each. Selecting many at once
 * — with per-course "select all" — is the single biggest time saver on this screen.
 */
export function BatchPicker({
    batches,
    loading,
    selected,
    onChange,
    invalid,
    noun,
    nounPlural,
}: BatchPickerProps) {
    const { t } = useTranslation('announcementCreateBatchPicker');
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');

    const selectedSet = useMemo(() => new Set(selected), [selected]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return batches;
        return batches.filter((b) =>
            [b.packageName, b.levelName, b.sessionName].some((part) =>
                part.toLowerCase().includes(q)
            )
        );
    }, [batches, query]);

    const groups = useMemo(() => {
        const map = new Map<string, BatchOption[]>();
        filtered.forEach((batch) => {
            const list = map.get(batch.packageName) ?? [];
            list.push(batch);
            map.set(batch.packageName, list);
        });
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [filtered]);

    const toggle = (id: string) => {
        onChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    };

    const toggleGroup = (rows: BatchOption[]) => {
        const ids = rows.map((r) => r.id);
        const allSelected = ids.every((id) => selectedSet.has(id));
        onChange(
            allSelected
                ? selected.filter((id) => !ids.includes(id))
                : [...new Set([...selected, ...ids])]
        );
    };

    const selectedBatches = useMemo(
        () => batches.filter((b) => selectedSet.has(b.id)),
        [batches, selectedSet]
    );

    if (loading) {
        return <Skeleton className="h-9 w-full rounded-md" />;
    }

    if (batches.length === 0) {
        return (
            <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-4 text-caption text-muted-foreground">
                {t('emptyState', { nounPlural })}
            </p>
        );
    }

    const triggerLabel =
        selected.length === 0
            ? t('selectNoun', { noun: nounPlural })
            : selected.length === 1
              ? (selectedBatches[0]?.label ?? t('countSelected', { count: 1, noun }))
              : t('countSelected', { count: selected.length, noun: nounPlural });

    return (
        <div className="space-y-2">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className={cn(
                            'w-full justify-between font-normal',
                            invalid && 'border-danger-400',
                            selected.length === 0 && 'text-muted-foreground'
                        )}
                    >
                        <span className="truncate">{triggerLabel}</span>
                        <CaretUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className={cn(POPOVER_WIDTH, 'p-0')} align="start">
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder={t('searchPlaceholder', { nounPlural })}
                            value={query}
                            onValueChange={setQuery}
                        />
                        <CommandList className="max-h-80">
                            {groups.length === 0 ? (
                                <div className="flex items-center justify-center gap-2 px-3 py-6 text-caption text-muted-foreground">
                                    <MagnifyingGlass className="size-4 shrink-0" />
                                    {t('noMatch', { nounPlural, query: query.trim() })}
                                </div>
                            ) : (
                                <div className="py-1">
                                    {groups.map(([course, rows]) => {
                                        const allSelected = rows.every((r) =>
                                            selectedSet.has(r.id)
                                        );
                                        return (
                                            <div key={course} className="px-1 pb-1">
                                                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                                                    <span className="flex min-w-0 items-center gap-1.5 text-caption font-semibold text-muted-foreground">
                                                        <GraduationCap className="size-3.5 shrink-0" />
                                                        <span className="truncate">{course}</span>
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleGroup(rows)}
                                                        className="shrink-0 rounded-sm px-1 text-caption font-semibold text-primary-500 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                    >
                                                        {allSelected
                                                        ? t('clearGroup')
                                                        : t('selectAll')}
                                                    </button>
                                                </div>
                                                {rows.map((batch) => {
                                                    const isSelected = selectedSet.has(batch.id);
                                                    return (
                                                        <button
                                                            key={batch.id}
                                                            type="button"
                                                            onClick={() => toggle(batch.id)}
                                                            aria-pressed={isSelected}
                                                            className={cn(
                                                                'flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left transition-colors',
                                                                'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                                                isSelected && 'bg-primary-50'
                                                            )}
                                                        >
                                                            <Checkbox
                                                                checked={isSelected}
                                                                className="mt-0.5 shrink-0"
                                                                tabIndex={-1}
                                                                aria-hidden
                                                            />
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate text-body">
                                                                    {batch.levelName}
                                                                </span>
                                                                <span className="block truncate text-caption text-muted-foreground">
                                                                    {batch.sessionName}
                                                                    {batch.isOrgAssociated &&
                                                                        t('orgSuffix')}
                                                                </span>
                                                            </span>
                                                            {isSelected && (
                                                                <Check
                                                                    weight="bold"
                                                                    className="mt-0.5 size-4 shrink-0 text-primary-500"
                                                                />
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </CommandList>
                    </Command>
                    <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                        <span className="text-caption text-muted-foreground">
                            {t('footerSelectedCount', { count: selected.length })}
                        </span>
                        <div className="flex items-center gap-2">
                            {selected.length > 0 && (
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    onClick={() => onChange([])}
                                >
                                    {t('clearAll')}
                                </MyButton>
                            )}
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setOpen(false)}
                            >
                                {t('done')}
                            </MyButton>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            {selectedBatches.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                    {selectedBatches.map((batch) => (
                        <li key={batch.id}>
                            <span className="flex max-w-full items-center gap-1 rounded-full border border-primary-200 bg-primary-50 py-0.5 pl-2 pr-1 text-caption text-primary-600">
                                <span className="truncate">
                                    {batch.levelName} · {batch.sessionName}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => toggle(batch.id)}
                                    aria-label={t('removeAria', { label: batch.label })}
                                    className="rounded-full p-0.5 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <X className="size-3" weight="bold" />
                                </button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
