'use client';

import * as React from 'react';
import { X, Check, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type OptionType = {
    label: string;
    value: string;
};

interface MultiSelectProps {
    options: OptionType[];
    selected: string[];
    onChange: (selected: string[]) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    /**
     * Render the list in a body portal (default). Pass false inside a Dialog or
     * Sheet — react-remove-scroll blocks wheel/touch on portalled nodes, so a
     * portalled list can't be scrolled from within a modal.
     */
    portal?: boolean;
    /**
     * Show a checkbox in front of every option instead of the bare tick, so it reads as
     * "pick several" at a glance. Opt-in to keep existing screens unchanged.
     */
    checkboxes?: boolean;
}

// Letters (incl. Devanagari vowel signs, \p{M}) and digits; everything else separates words.
const toWords = (text: string) =>
    text
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter(Boolean);

/**
 * Search-box match: every typed word must start a word of the label.
 * Replaces cmdk's fuzzy scoring, which kept any label holding the letters in
 * order — "class 6" listed "Class 7 · 2026-27" through the year's 6. Prefix
 * (not substring) so "6" finds "6th" / "6A" but not "2026".
 */
export const matchesSearch = (label: string, search: string): boolean => {
    const labelWords = toWords(label);
    return toWords(search).every((word) => labelWords.some((w) => w.startsWith(word)));
};

const filterOptions = (_value: string, search: string, keywords?: string[]) =>
    matchesSearch((keywords ?? []).join(' '), search) ? 1 : 0;

export function MultiSelect({
    options,
    selected,
    onChange,
    placeholder = 'Select options',
    className,
    disabled = false,
    portal = true,
    checkboxes = false,
}: MultiSelectProps) {
    const [open, setOpen] = React.useState(false);

    const handleUnselect = (item: string) => {
        onChange(selected.filter((i) => i !== item));
    };

    const handleSelect = (value: string) => {
        if (selected.includes(value)) {
            onChange(selected.filter((item) => item !== value));
        } else {
            onChange([...selected, value]);
        }
    };

    // Get labels for selected values
    const selectedLabels = selected.map(
        (value) => options.find((option) => option.value === value)?.label || value
    );

    return (
        <Popover open={open && !disabled} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn('w-full justify-between', className)}
                    onClick={() => setOpen(!open)}
                    disabled={disabled}
                >
                    <div className="flex max-w-[90%] flex-wrap gap-1">
                        {selected.length === 0 ? (
                            <span className="text-muted-foreground">{placeholder}</span>
                        ) : selected.length > 2 ? (
                            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                                {selected.length} selected
                            </Badge>
                        ) : (
                            selectedLabels.map((label) => (
                                <Badge
                                    variant="secondary"
                                    key={label}
                                    className="rounded-sm px-1 font-normal"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const value = options.find(
                                            (option) => option.label === label
                                        )?.value;
                                        if (value) handleUnselect(value);
                                    }}
                                >
                                    {label}
                                    <X className="ml-1 size-3" />
                                </Badge>
                            ))
                        )}
                    </div>
                    <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" portal={portal}>
                <Command filter={filterOptions}>
                    <CommandInput placeholder="Search options..." />
                    <CommandList>
                        <CommandEmpty>No options found.</CommandEmpty>
                        <CommandGroup className="max-h-64 overflow-auto">
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    // The id keeps same-named options distinct; search
                                    // only looks at the label (keywords), never the id.
                                    value={option.value}
                                    keywords={[option.label]}
                                    onSelect={() => handleSelect(option.value)}
                                    aria-checked={selected.includes(option.value)}
                                >
                                    {checkboxes ? (
                                        // Passive indicator: the row itself toggles the value.
                                        <Checkbox
                                            checked={selected.includes(option.value)}
                                            className="me-2 shrink-0"
                                            tabIndex={-1}
                                            aria-hidden
                                        />
                                    ) : (
                                        <Check
                                            className={cn(
                                                'me-2 h-4 w-4',
                                                selected.includes(option.value)
                                                    ? 'opacity-100'
                                                    : 'opacity-0'
                                            )}
                                        />
                                    )}
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
