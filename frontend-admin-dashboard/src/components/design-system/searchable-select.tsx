'use client';

import * as React from 'react';
import { CaretUpDown, Check } from '@phosphor-icons/react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type SearchableSelectOption = {
    label: string;
    value: string;
    /** Extra words the search should match, e.g. a code like "US" or "UAE". */
    keywords?: string[];
};

interface SearchableSelectProps {
    options: SearchableSelectOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    className?: string;
    disabled?: boolean;
    triggerClassName?: string;
    /**
     * Render the list in a body portal (default). Pass false inside a Dialog or
     * Sheet — react-remove-scroll blocks wheel/touch on portalled nodes, so a
     * portalled list can't be scrolled from within a modal.
     */
    portal?: boolean;
    /**
     * Optional ranking for the search box, called with an option label, the typed text and
     * the option's keywords (0 hides the option, higher ranks first). Defaults to cmdk's
     * fuzzy match.
     */
    filter?: (label: string, search: string, keywords?: string[]) => number;
}

const fold = (s: string) =>
    s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();

/**
 * Plain-text ranking for long name lists (countries, currencies): a match at the start of
 * the label first, then an exact keyword ("us" → United States), then the start of a word,
 * then anywhere. Accents and case are ignored, so "cote" finds "Côte d’Ivoire". Unlike the
 * fuzzy default, "ind" does not match "Thailand".
 */
export const prefixFirstFilter = (label: string, search: string, keywords?: string[]): number => {
    const q = fold(search);
    if (!q) return 1;
    const text = fold(label);
    if (text.startsWith(q)) return 1;
    if (keywords?.some((k) => fold(k) === q)) return 0.9;
    if (text.split(/[\s(),.\-’']+/).some((word) => word.startsWith(q))) return 0.75;
    return text.includes(q) ? 0.5 : 0;
};

export function SearchableSelect({
    options,
    value,
    onChange,
    placeholder = 'Select option',
    searchPlaceholder = 'Search...',
    emptyText = 'No options found.',
    className,
    disabled = false,
    triggerClassName,
    portal = true,
    filter,
}: SearchableSelectProps) {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    // Inline (portal={false}) content is clipped by the dialog's overflow, so
    // measure collisions against the dialog box instead of the viewport.
    const [boundary, setBoundary] = React.useState<Element | null>(null);

    React.useEffect(() => {
        if (open && !portal) {
            setBoundary(triggerRef.current?.closest('[role="dialog"]') ?? null);
        }
    }, [open, portal]);

    // Get the label for the selected value
    const selectedLabel = React.useMemo(() => {
        return options.find((option) => option.value === value)?.label || '';
    }, [options, value]);

    const handleSelect = (selectedValue: string) => {
        onChange(selectedValue);
        setOpen(false);
    };

    return (
        <Popover open={open && !disabled} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    ref={triggerRef}
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn(
                        'w-full justify-between font-normal',
                        triggerClassName,
                        className
                    )}
                    onClick={() => setOpen(!open)}
                    disabled={disabled}
                >
                    <span className={cn('truncate', !value && 'text-muted-foreground')}>
                        {value ? selectedLabel : placeholder}
                    </span>
                    <CaretUpDown className="ms-2 size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="flex max-h-[--radix-popover-content-available-height] w-[--radix-popover-trigger-width] flex-col p-0" // design-lint-ignore: Radix runtime CSS vars
                align="start"
                portal={portal}
                collisionBoundary={boundary ?? undefined}
                collisionPadding={8}
            >
                <Command className="min-h-0" filter={filter}>
                    <CommandInput placeholder={searchPlaceholder} />
                    <CommandList className="min-h-0">
                        <CommandEmpty>{emptyText}</CommandEmpty>
                        <CommandGroup className="max-h-64 overflow-auto">
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    value={option.label}
                                    keywords={option.keywords}
                                    onSelect={() => handleSelect(option.value)}
                                >
                                    <Check
                                        className={cn(
                                            'mr-2 h-4 w-4',
                                            value === option.value ? 'opacity-100' : 'opacity-0'
                                        )}
                                    />
                                    {option.label}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
