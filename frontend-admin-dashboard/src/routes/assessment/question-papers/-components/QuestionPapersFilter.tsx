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
import { FilterOption, FilterProps } from '@/types/assessments/question-paper-filter';
import { Check, PlusCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export const QuestionPapersFilter = ({
    label,
    data,
    selectedItems,
    onSelectionChange,
}: FilterProps) => {
    const { t } = useTranslation('assessmentQuestionPapersFilter');
    const toggleSelection = (option: FilterOption) => {
        const updatedItems = selectedItems.some((item) => item.id === option.id)
            ? selectedItems.filter((item) => item.id !== option.id)
            : [...selectedItems, option];
        onSelectionChange(updatedItems);
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant={'outline'}
                    className={`text-neutral-600 ${selectedItems.length > 0
                            ? 'border-primary-500 bg-primary-100 hover:bg-primary-100'
                            : ''
                        }`}
                >
                    <PlusCircle size={32} />
                    {label}
                    {selectedItems.length > 0 && (
                        <>
                            <Separator orientation="vertical" className="mx-2 bg-black" />
                            <span className="rounded-md bg-primary-200 px-3 py-1 text-xs">
                                {t('selectedCount', { count: selectedItems.length })}
                            </span>
                        </>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0" align="start">
                <Command>
                    <CommandInput placeholder={t('searchPlaceholder', { label })} />
                    <CommandList>
                        <CommandEmpty>{t('noResults')}</CommandEmpty>
                        <CommandGroup heading={label}>
                            {data?.map((option, index) => {
                                const isSelected = selectedItems.some(
                                    (item) => item.id === option.id
                                );
                                return (
                                    <CommandItem
                                        key={index}
                                        onSelect={() => toggleSelection(option)}
                                    >
                                        <div
                                            className={cn(
                                                'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-gray-300',
                                                isSelected
                                                    ? 'border-none bg-primary-300 text-white'
                                                    : 'opacity-70 [&_svg]:invisible'
                                            )}
                                        >
                                            <Check
                                                className={cn('h-4 w-4 rounded-sm bg-primary-500')}
                                            />
                                        </div>
                                        {option.name}
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
