import { useMemo, useState } from 'react';
import { Plus, Tag, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface SubjectTagInputProps {
    value: string[];
    onChange: (tags: string[]) => void;
    suggestions?: string[];
    placeholder?: string;
    className?: string;
}

/**
 * Creatable, autocompleting subject/topic tag input.
 * - Type to filter existing institute tags, or create a brand-new tag.
 * - Enter adds the typed value; selected suggestions are added on click.
 * Tags are compared case-insensitively to avoid duplicates.
 */
export function SubjectTagInput({
    value,
    onChange,
    suggestions = [],
    placeholder,
    className,
}: SubjectTagInputProps) {
    const { t } = useTranslation('assessmentSubjectTagInput');
    const [inputValue, setInputValue] = useState('');
    const [open, setOpen] = useState(false);

    const selectedLower = useMemo(() => new Set(value.map((tg) => tg.toLowerCase())), [value]);

    const filteredSuggestions = useMemo(() => {
        const query = inputValue.trim().toLowerCase();
        return suggestions
            .filter((s) => !selectedLower.has(s.toLowerCase()))
            .filter((s) => (query ? s.toLowerCase().includes(query) : true))
            .slice(0, 50);
    }, [suggestions, selectedLower, inputValue]);

    const trimmed = inputValue.trim();
    const canCreate = trimmed.length > 0 && !selectedLower.has(trimmed.toLowerCase());
    const resolvedPlaceholder = placeholder ?? t('placeholder');

    const addTag = (tag: string) => {
        const clean = tag.trim();
        if (!clean || selectedLower.has(clean.toLowerCase())) return;
        onChange([...value, clean]);
        setInputValue('');
    };

    const removeTag = (index: number) => {
        onChange(value.filter((_, i) => i !== index));
    };

    return (
        <div className={cn('flex flex-col gap-2', className)}>
            {value.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {value.map((tag, index) => (
                        <span
                            key={`${tag}-${index}`}
                            className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-3 py-1 text-caption text-primary-600"
                        >
                            <Tag className="size-3" />
                            {tag}
                            <button
                                type="button"
                                onClick={() => removeTag(index)}
                                className="ml-1 rounded-full p-0.5 text-primary-500 hover:bg-primary-200"
                                aria-label={t('removeTag', { tag })}
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Input
                        type="text"
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            if (!open) setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && canCreate) {
                                e.preventDefault();
                                addTag(trimmed);
                            }
                        }}
                        placeholder={resolvedPlaceholder}
                    />
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    className="w-80 p-0"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                >
                    <Command shouldFilter={false}>
                        <CommandList>
                            {filteredSuggestions.length === 0 && !canCreate && (
                                <CommandEmpty>{t('noTagsFound')}</CommandEmpty>
                            )}
                            {canCreate && (
                                <CommandGroup>
                                    <CommandItem
                                        value={`__create__${trimmed}`}
                                        onSelect={() => addTag(trimmed)}
                                    >
                                        <Plus className="mr-2 size-4 text-primary-500" />
                                        {t('createTag', { value: trimmed })}
                                    </CommandItem>
                                </CommandGroup>
                            )}
                            {filteredSuggestions.length > 0 && (
                                <CommandGroup heading={t('existingTags')}>
                                    {filteredSuggestions.map((suggestion) => (
                                        <CommandItem
                                            key={suggestion}
                                            value={suggestion}
                                            onSelect={() => addTag(suggestion)}
                                        >
                                            <Tag className="mr-2 size-4 text-neutral-400" />
                                            {suggestion}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}
