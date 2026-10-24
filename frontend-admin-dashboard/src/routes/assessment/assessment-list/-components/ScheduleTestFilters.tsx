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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { MyFilterOption, MyFilterProps } from '@/types/assessments/my-filter';
import { Check, CaretDown, FunnelSimple, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

// Show the actual choices rather than a bare count — "Biology, Physics" tells an admin
// what the list is showing, "2 selected" makes them open the menu to find out. Past two
// the chip would outgrow its row, so the rest collapse into a +N.
const MAX_VISIBLE_SELECTIONS = 2;

export const ScheduleTestFilters = ({
    label,
    data,
    selectedItems,
    onSelectionChange,
}: MyFilterProps) => {
    const { t } = useTranslation('assessmentScheduleTestFilters');

    const toggleSelection = (option: MyFilterOption) => {
        const updatedItems = selectedItems.some((item) => item.id === option.id)
            ? selectedItems.filter((item) => item.id !== option.id)
            : [...selectedItems, option];
        onSelectionChange(updatedItems);
    };

    const hasSelection = selectedItems.length > 0;
    const visible = selectedItems.slice(0, MAX_VISIBLE_SELECTIONS);
    const overflow = selectedItems.length - visible.length;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    // The old trigger used a 32px plus-circle, which read as "add something"
                    // rather than "narrow this list" and dwarfed its own label. A small
                    // filter glyph plus a caret says menu, and the caret is what tells a
                    // keyboard user something opens here.
                    aria-label={
                        hasSelection
                            ? t('trigger.ariaLabelSelected', {
                                  label,
                                  selection: selectedItems.map((item) => item.name).join(', '),
                              })
                            : t('trigger.ariaLabelEmpty', { label })
                    }
                    className={cn(
                        'h-9 shrink-0 cursor-pointer gap-1.5 rounded-lg border-neutral-300 px-2.5 text-sm font-normal text-neutral-600',
                        'transition-colors duration-200 hover:border-neutral-400 hover:bg-neutral-50',
                        'focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1',
                        hasSelection &&
                            'border-primary-500 bg-primary-50 text-primary-600 hover:border-primary-500 hover:bg-primary-100'
                    )}
                >
                    <FunnelSimple className="size-4 shrink-0" aria-hidden="true" />
                    <span className="whitespace-nowrap">{label}</span>

                    {hasSelection && (
                        <>
                            <Separator
                                orientation="vertical"
                                className="mx-0.5 h-4 bg-primary-200"
                            />
                            <span className="flex items-center gap-1">
                                {visible.map((item) => (
                                    <span
                                        key={item.id}
                                        className="max-w-28 truncate rounded bg-primary-100 px-1.5 py-0.5 text-xs text-primary-600"
                                    >
                                        {item.name}
                                    </span>
                                ))}
                                {overflow > 0 && (
                                    <span className="rounded bg-primary-100 px-1.5 py-0.5 text-xs text-primary-600">
                                        +{overflow}
                                    </span>
                                )}
                            </span>
                            {/* Clearing one filter should not cost a trip into the menu.
                                Nested inside the trigger, so it stops the click from also
                                opening the popover. */}
                            <span
                                role="button"
                                tabIndex={0}
                                aria-label={t('trigger.clearAriaLabel', { label })}
                                className="ml-0.5 rounded p-0.5 text-primary-500 hover:bg-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onSelectionChange([]);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onSelectionChange([]);
                                }}
                            >
                                <X className="size-3.5" aria-hidden="true" />
                            </span>
                        </>
                    )}

                    {!hasSelection && (
                        <CaretDown
                            className="size-4 shrink-0 text-neutral-400"
                            aria-hidden="true"
                        />
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0" align="start">
                <Command>
                    <CommandInput
                        placeholder={t('search.placeholder', { label: label.toLowerCase() })}
                    />
                    <CommandList>
                        <CommandEmpty>{t('search.noResults')}</CommandEmpty>
                        <CommandGroup heading={label}>
                            {data?.map((option, idx) => {
                                const isSelected = selectedItems.some(
                                    (item) => item.id === option.id
                                );
                                return (
                                    <CommandItem
                                        key={idx}
                                        onSelect={() => toggleSelection(option)}
                                        className="cursor-pointer gap-2"
                                    >
                                        <div
                                            className={cn(
                                                'flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                                                isSelected
                                                    ? 'border-primary-500 bg-primary-500 text-white'
                                                    : 'border-neutral-300 [&_svg]:invisible'
                                            )}
                                        >
                                            <Check className="size-3" strokeWidth={3} />
                                        </div>
                                        <span className="truncate">{option.name}</span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};
