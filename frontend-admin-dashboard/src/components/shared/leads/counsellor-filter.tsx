import { useState } from 'react';
import { UserPlus, CaretDown, Check } from '@phosphor-icons/react';
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
import { cn } from '@/lib/utils';

interface CounsellorOption {
    id: string;
    full_name: string;
}

interface CounsellorFilterProps {
    /** Currently selected counsellor userIds. Empty array = all counsellors (no filter). */
    values: string[];
    onChange: (values: string[]) => void;
    /** Counsellor list — usually from `fetchCounselors`. */
    options: CounsellorOption[];
    isLoading?: boolean;
    /** When provided, renders an "Unassigned" entry that can be toggled alongside
     *  specific counsellors. */
    unassignedValue?: string;
}

/** Searchable + scrollable multi-select counsellor combobox used in the leads
 *  filter bar. Stays open while the user checks items; shows a count badge on
 *  the trigger. Selecting "Unassigned" can be combined with other selections. */
export function CounsellorFilter({
    values,
    onChange,
    options,
    isLoading,
    unassignedValue,
}: CounsellorFilterProps) {
    const [open, setOpen] = useState(false);

    const toggle = (id: string) => {
        if (values.includes(id)) {
            onChange(values.filter((v) => v !== id));
        } else {
            onChange([...values, id]);
        }
    };

    const count = values.length;
    const triggerLabel = count > 0 ? `Counsellors · ${count}` : 'All counsellors';

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    role="combobox"
                    aria-expanded={open}
                    aria-label="Filter by counsellor"
                    className={cn(
                        'h-10 w-48 justify-between',
                        count > 0 && 'border-primary-300 bg-primary-50'
                    )}
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        <UserPlus className="size-4 shrink-0 text-neutral-400" />
                        <span className="truncate text-sm font-normal">{triggerLabel}</span>
                    </span>
                    <CaretDown className="size-4 shrink-0 text-neutral-400" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
                <Command>
                    <CommandInput placeholder="Search counsellor…" className="h-9" />
                    <CommandList className="max-h-64 overflow-y-auto">
                        <CommandEmpty>
                            {isLoading ? 'Loading counsellors…' : 'No counsellor found.'}
                        </CommandEmpty>
                        {count > 0 && (
                            <CommandItem
                                value="__clear__"
                                onSelect={() => onChange([])}
                                className="cursor-pointer text-neutral-500"
                            >
                                Clear selection
                            </CommandItem>
                        )}
                        <CommandGroup>
                            {unassignedValue && (
                                <CommandItem
                                    value="Unassigned"
                                    onSelect={() => toggle(unassignedValue)}
                                    className="cursor-pointer"
                                >
                                    <span
                                        className={cn(
                                            'mr-2 flex size-4 shrink-0 items-center justify-center rounded border',
                                            values.includes(unassignedValue)
                                                ? 'border-primary-500 bg-primary-500 text-white'
                                                : 'border-neutral-300'
                                        )}
                                    >
                                        {values.includes(unassignedValue) && (
                                            <Check className="size-3" />
                                        )}
                                    </span>
                                    Unassigned
                                </CommandItem>
                            )}
                            {options.map((c) => (
                                <CommandItem
                                    key={c.id}
                                    value={c.full_name}
                                    onSelect={() => toggle(c.id)}
                                    className="cursor-pointer"
                                >
                                    <span
                                        className={cn(
                                            'mr-2 flex size-4 shrink-0 items-center justify-center rounded border',
                                            values.includes(c.id)
                                                ? 'border-primary-500 bg-primary-500 text-white'
                                                : 'border-neutral-300'
                                        )}
                                    >
                                        {values.includes(c.id) && <Check className="size-3" />}
                                    </span>
                                    {c.full_name}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
