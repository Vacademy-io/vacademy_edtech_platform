/**
 * The picker every step of Create Batch uses.
 *
 * Three things the plain dropdown it replaces did not do:
 *
 *   - search. An institute with fifty courses made the course step a scroll.
 *   - say why it is empty. A disabled dropdown with no explanation is the whole
 *     reason "create a batch" felt broken: the session step's list is empty for
 *     a course that has no sessions yet, and nothing on screen said so.
 *   - stay inside the dialog. A portalled list cannot be scrolled inside a
 *     Dialog (react-remove-scroll blocks the wheel), so the list renders inline.
 *
 * Items may carry a thumbnail and a meta line — the course step shows both.
 */
import { useState } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export interface BatchItem {
    id: string;
    name: string;
}

interface BatchItemSelectProps<T extends BatchItem> {
    items: T[];
    value: BatchItem | null;
    onChange: (item: T | null) => void;
    placeholder: string;
    searchPlaceholder: string;
    /** Shown in place of the control when there is nothing to pick. */
    emptyMessage: string;
    /** Shown when the search matches nothing. */
    noMatchMessage?: string;
    disabled?: boolean;
    /** Leading visual for an item (e.g. a course thumbnail). */
    renderVisual?: (item: T) => ReactNode;
    /** Second line under the item name. */
    renderMeta?: (item: T) => ReactNode;
}

export function BatchItemSelect<T extends BatchItem>({
    items,
    value,
    onChange,
    placeholder,
    searchPlaceholder,
    emptyMessage,
    noMatchMessage = '—',
    disabled = false,
    renderVisual,
    renderMeta,
}: BatchItemSelectProps<T>) {
    const [open, setOpen] = useState(false);

    if (items.length === 0) {
        return (
            <p className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2.5 text-body text-neutral-500">
                {emptyMessage}
            </p>
        );
    }

    const selected = value ? items.find((item) => item.id === value.id) : undefined;

    return (
        <Popover open={open && !disabled} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn(
                        'flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-white px-4 text-start text-body transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        open ? 'border-primary-500' : 'border-neutral-300 hover:border-primary-200'
                    )}
                >
                    <span
                        className={cn(
                            'truncate',
                            selected ? 'text-neutral-800' : 'text-neutral-400'
                        )}
                    >
                        {selected?.name ?? value?.name ?? placeholder}
                    </span>
                    <CaretDown
                        size={16}
                        className={cn(
                            'shrink-0 text-neutral-500 transition-transform',
                            open && 'rotate-180'
                        )}
                    />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                portal={false}
                className="w-[--radix-popover-trigger-width] rounded-xl p-2" // design-lint-ignore: list must match the trigger's width
            >
                <Command className="gap-1">
                    <div className="rounded-lg border border-neutral-200">
                        <CommandInput placeholder={searchPlaceholder} className="h-10" />
                    </div>
                    <CommandList className="max-h-72">
                        <CommandEmpty className="py-6 text-center text-body text-neutral-500">
                            {noMatchMessage}
                        </CommandEmpty>
                        <CommandGroup className="p-0 pt-1">
                            {items.map((item) => {
                                const isSelected = item.id === value?.id;
                                return (
                                    <CommandItem
                                        key={item.id}
                                        value={item.name}
                                        onSelect={() => {
                                            onChange(item);
                                            setOpen(false);
                                        }}
                                        className={cn(
                                            'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2',
                                            isSelected && 'bg-primary-50'
                                        )}
                                    >
                                        {renderVisual?.(item)}
                                        <span className="flex min-w-0 grow flex-col">
                                            <span className="truncate text-body font-medium text-neutral-800">
                                                {item.name}
                                            </span>
                                            {renderMeta && (
                                                <span className="truncate text-caption text-neutral-500">
                                                    {renderMeta(item)}
                                                </span>
                                            )}
                                        </span>
                                        {isSelected && (
                                            <Check
                                                size={16}
                                                className="shrink-0 text-primary-500"
                                            />
                                        )}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
