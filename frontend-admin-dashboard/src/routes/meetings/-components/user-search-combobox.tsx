import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CaretUpDown, Check, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { MyButton } from '@/components/design-system/button';
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { autoSuggestUsers } from '@/routes/manage-bookings/-services/booking-service';

export interface PickedUser {
    id: string;
    fullName: string;
    email: string;
}

function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

interface UserSearchComboboxProps {
    instituteId: string | undefined;
    /** Selected users. In single mode at most one entry. */
    value: PickedUser[];
    onChange: (users: PickedUser[]) => void;
    mode?: 'single' | 'multi';
    placeholder?: string;
    disabled?: boolean;
}

/**
 * Autosuggest user picker (auth-service autosuggest-users) — same interaction
 * pattern as the manage-bookings add-event dialog's participant search.
 */
export const UserSearchCombobox = ({
    instituteId,
    value,
    onChange,
    mode = 'multi',
    placeholder,
    disabled = false,
}: UserSearchComboboxProps) => {
    const { t } = useTranslation('meetingsUserSearchCombobox');
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedQuery = useDebounce(searchQuery, 300);
    const resolvedPlaceholder = placeholder ?? t('searchPlaceholder');

    const { data: suggestions } = useQuery({
        queryKey: ['meetings-user-autosuggest', instituteId, debouncedQuery],
        queryFn: () => autoSuggestUsers({ instituteId: instituteId ?? '', query: debouncedQuery }),
        enabled: !!instituteId && debouncedQuery.length >= 3,
    });

    const handleSelect = (user: PickedUser) => {
        if (mode === 'single') {
            onChange([user]);
        } else if (!value.some((u) => u.id === user.id)) {
            onChange([...value, user]);
        }
        setOpen(false);
        setSearchQuery('');
    };

    const triggerLabel =
        mode === 'single' && value.length > 0
            ? value[0]!.fullName
            : mode === 'single'
              ? t('selectUser')
              : t('addParticipants');

    return (
        <div className="flex w-full flex-col gap-2">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disable={disabled}
                        className="w-full justify-between sm:min-w-0"
                    >
                        <span className="truncate">{triggerLabel}</span>
                        <CaretUpDown className="ml-2 size-4 shrink-0 text-neutral-400" />
                    </MyButton>
                </PopoverTrigger>
                <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] p-0" align="start">{/* design-lint-ignore: clamp popover to viewport on mobile */}
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder={resolvedPlaceholder}
                            value={searchQuery}
                            onValueChange={setSearchQuery}
                        />
                        <CommandList>
                            {debouncedQuery.length < 3 && (
                                <div className="py-6 text-center text-body text-neutral-500">
                                    {t('typeToSearch')}
                                </div>
                            )}
                            {debouncedQuery.length >= 3 && suggestions?.length === 0 && (
                                <CommandEmpty>{t('noUsersFound')}</CommandEmpty>
                            )}
                            {debouncedQuery.length >= 3 &&
                                suggestions?.map((user) => (
                                    <CommandItem
                                        key={user.id}
                                        value={user.id}
                                        onSelect={() =>
                                            handleSelect({
                                                id: user.id,
                                                fullName: user.fullName,
                                                email: user.email,
                                            })
                                        }
                                    >
                                        <Check
                                            className={cn(
                                                'mr-2 size-4',
                                                value.some((u) => u.id === user.id)
                                                    ? 'opacity-100'
                                                    : 'opacity-0'
                                            )}
                                        />
                                        <div className="flex flex-col">
                                            <span>{user.fullName}</span>
                                            <span className="text-caption text-neutral-500">
                                                {user.email}
                                            </span>
                                        </div>
                                    </CommandItem>
                                ))}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>

            {value.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {value.map((user) => (
                        <Badge key={user.id} variant="secondary" className="flex items-center gap-1">
                            {user.fullName}
                            <button
                                type="button"
                                aria-label={t('removeUser', { name: user.fullName })}
                                onClick={() => onChange(value.filter((u) => u.id !== user.id))}
                                className="rounded-full p-0.5 hover:bg-neutral-200"
                            >
                                <X className="size-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    );
};
