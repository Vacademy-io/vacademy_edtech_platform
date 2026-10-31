import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check, CaretUpDown, PlusCircle } from '@phosphor-icons/react';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from '../ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { ChipsWrapper } from './chips';

// Define Option type
export interface SelectOption {
    label: string;
    value: string;
}

// Define Props type
export interface SelectChipsProps {
    options: SelectOption[];
    selected: SelectOption[];
    onChange: (selected: SelectOption[]) => void;
    placeholder?: string;
    multiSelect?: boolean;
    className?: string;
    disabled?: boolean;
    clearable?: boolean; // New prop to allow clearing selections for multi-select
    hasClearFilter?: boolean; // New prop to control if filter can be cleared
    fullWidth?: boolean; // Stretch the trigger to fill its container (for grid/form layouts)
    /** Render the list in a body portal (default). Pass false inside a Sheet/Dialog, whose scroll lock otherwise swallows the list's wheel scroll. */
    portal?: boolean;
}

const SelectChips = ({
    options,
    selected,
    onChange,
    placeholder = 'Select...',
    multiSelect = false,
    className,
    disabled = false,
    clearable = true,
    hasClearFilter = true, // Default to true, existing behavior
    fullWidth = false,
    portal = true,
}: SelectChipsProps) => {
    const [open, setOpen] = useState(false);

    const handleSelect = (option: SelectOption) => {
        if (multiSelect) {
            let newSelected = selected.some((s) => s.value === option.value)
                ? selected.filter((s) => s.value !== option.value)
                : [...selected, option];

            // If hasClearFilter is false and the new selection would be empty, prevent clearing
            if (!hasClearFilter && newSelected.length === 0) {
                newSelected = [option]; // Keep the last selected item or the current one if it was the only one
            }
            onChange(newSelected);
        } else {
            if (hasClearFilter && selected.some((s) => s.value === option.value)) {
                onChange([]);
            } else {
                onChange([option]);
            }
            setOpen(false); // Close popover on single select
        }
    };

    const handleClear = () => {
        if (hasClearFilter) {
            // Only allow clear if hasClearFilter is true
            onChange([]);
        }
    };

    const getTriggerLabel = () => {
        if (selected.length === 0) {
            return placeholder;
        }
        if (multiSelect) {
            if (selected.length === 1) {
                return selected[0]?.label;
            }
            return `${selected.length} selected`;
        }
        return selected[0]?.label || placeholder;
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild disabled={disabled}>
                <button
                    role="combobox"
                    aria-expanded={open}
                    className={cn(fullWidth ? 'w-full' : 'w-auto')}
                    disabled={disabled}
                >
                    <ChipsWrapper
                        className={cn(
                            'justify-between',
                            fullWidth ? 'w-full' : 'w-auto',
                            disabled && 'border-neutral-100 text-neutral-300',
                            className
                        )}
                    >
                        <div className="flex items-center gap-2">
                            {!multiSelect &&
                                selected.length === 0 &&
                                React.createElement(PlusCircle, {
                                    // Icon for single select placeholder
                                    className: cn(
                                        'size-[18px]',
                                        disabled ? 'text-neutral-300' : 'text-neutral-600'
                                    ),
                                })}
                            <span
                                className={cn(
                                    'whitespace-nowrap',
                                    selected.length === 0 && !multiSelect ? 'text-neutral-600' : '',
                                    disabled ? 'text-neutral-300' : 'text-neutral-600'
                                )}
                            >
                                {getTriggerLabel()}
                            </span>
                        </div>
                        <CaretUpDown
                            className={cn(
                                'ml-2 size-4 shrink-0 opacity-50',
                                disabled ? 'text-neutral-300' : 'text-neutral-600'
                            )}
                        />
                    </ChipsWrapper>
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[--radix-popover-trigger-width] p-0"
                align="start"
                portal={portal}
            >
                <Command>
                    <CommandInput placeholder="Search..." />
                    <CommandList>
                        <CommandEmpty>No results found.</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    value={option.label} // value is used for search by CommandInput
                                    onSelect={() => handleSelect(option)}
                                    className="cursor-pointer"
                                >
                                    {multiSelect && (
                                        <div
                                            className={cn(
                                                'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-gray-300',
                                                selected.some((s) => s.value === option.value)
                                                    ? 'text-base-white border-none bg-primary-500'
                                                    : 'opacity-70 [&_svg]:invisible'
                                            )}
                                        >
                                            <Check className={cn('h-4 w-4')} />
                                        </div>
                                    )}
                                    <span>{option.label}</span>
                                    {!multiSelect &&
                                        selected.some((s) => s.value === option.value) && (
                                            <Check className="ml-auto size-4 text-primary-500" />
                                        )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                        {(multiSelect || clearable) && selected.length > 0 && hasClearFilter && (
                            <>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={handleClear}
                                        className="cursor-pointer justify-center text-sm text-red-500 hover:text-red-600"
                                    >
                                        Clear selections
                                    </CommandItem>
                                </CommandGroup>
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

export default SelectChips;
