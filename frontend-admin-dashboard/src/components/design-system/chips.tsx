import React, { ReactNode, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useCompactMode } from '@/hooks/use-compact-mode';
import {
    InputChipsProps,
    FilterChipsProps,
    ChipsProps,
    ChipsWrapperProps,
} from './utils/types/chips-types';
import { PlusCircle, Check } from '@phosphor-icons/react';
import { ActivityStatusData } from './utils/constants/chips-data';
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
import { Separator } from '../ui/separator';
import { ActivityStatus } from './utils/types/chips-types';

export const ChipsWrapper = ({ children, className }: ChipsWrapperProps) => {
    const { isCompact } = useCompactMode();
    return (
        <div
            className={cn(
                'inline-flex flex-shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-300 font-regular text-neutral-600',
                isCompact ? 'h-6 px-1.5 py-0.5 text-xs' : 'h-8 px-3 py-1.5 text-body',
                className
            )}
        >
            {children}
        </div>
    );
};

const Chips = ({
    label,
    trailingIcon,
    leadingIcon,
    avatarAddress,
    selected,
    disabled,
    className,
}: ChipsProps) => {
    return (
        <ChipsWrapper
            className={cn(
                avatarAddress ? 'rounded-full' : 'rounded-lg',
                'active:bg-primary-100',
                disabled
                    ? 'border-neutral-100'
                    : selected
                        ? 'border-primary-500 bg-primary-100'
                        : 'hover:border-primary-500 hover:bg-primary-50',
                className
            )}
        >
            {leadingIcon &&
                React.createElement(leadingIcon, {
                    className: cn(
                        'size-4',
                        disabled ? 'text-neutral-300' : 'text-neutral-600'
                    ),
                })}

            {avatarAddress && (
                <div className="size-5 overflow-hidden rounded-full">
                    <img src={avatarAddress} className="size-5 object-cover" alt="avatar" />
                </div>
            )}

            {label && (
                <div
                    className={cn(
                        'flex items-center text-body',
                        disabled ? 'text-neutral-300' : 'text-neutral-600'
                    )}
                >
                    {label}
                </div>
            )}
            {trailingIcon &&
                React.createElement(trailingIcon, {
                    className: cn('size-4', disabled ? 'text-neutral-300' : 'text-neutral-600'),
                })}
        </ChipsWrapper>
    );
};

export const InputChips = (props: InputChipsProps) => {
    return <Chips {...props} />;
};

export const FilterChips = ({
    label,
    filterList,
    selectedFilters,
    disabled,
    clearFilters,
    handleSelect,
    handleClearFilters,
    onSearchChange,
    shouldFilter = true,
    onOpenChange,
    closeOnSelect = false,
}: FilterChipsProps & {
    onSearchChange?: (value: string) => void;
    shouldFilter?: boolean;
    onOpenChange?: (open: boolean) => void;
    // When true, the popover closes after each item selection. Opt-in so existing
    // multi-select call sites that rely on the popover staying open are unaffected.
    closeOnSelect?: boolean;
}) => {
    const { isCompact } = useCompactMode();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (clearFilters) handleClearFilters && handleClearFilters();
    }, [clearFilters]);

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        onOpenChange && onOpenChange(next);
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger className="flex items-center">
                <button>
                    <ChipsWrapper
                        className={cn(
                            disabled
                                ? 'border-neutral-100'
                                : selectedFilters.length > 0
                                    ? 'border-primary-500 bg-primary-100'
                                    : 'hover:border-primary-500 hover:bg-primary-50'
                        )}
                    >
                        <div className="flex items-center gap-2">
                            {React.createElement(PlusCircle, {
                                className: cn(
                                    isCompact ? 'size-3.5' : 'size-4',
                                    disabled ? 'text-neutral-300' : 'text-neutral-600'
                                ),
                            })}
                            <div
                                className={cn(
                                    'flex items-center',
                                    isCompact ? 'text-xs' : 'text-body',
                                    disabled ? 'text-neutral-300' : 'text-neutral-600'
                                )}
                            >
                                {label}{' '}
                            </div>

                            <div
                                className={`${selectedFilters.length > 0 ? 'visible' : 'hidden'
                                    } flex items-center gap-2`}
                            >
                                <Separator
                                    orientation="vertical"
                                    className="mx-2 h-4 bg-neutral-500"
                                />
                                <div
                                    className={`inline-flex items-center rounded-md bg-primary-200 px-2.5 py-0.5 text-caption font-normal ${selectedFilters.length > 0 ? 'visible' : 'hidden'
                                        }`}
                                >
                                    {selectedFilters.length} selected
                                </div>
                            </div>
                        </div>
                    </ChipsWrapper>
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-0" align="start">
                <Command shouldFilter={shouldFilter}>
                    <CommandInput
                        placeholder="Search"
                        onValueChange={onSearchChange}
                    />
                    <CommandList>
                        <CommandEmpty>No results found</CommandEmpty>
                        <CommandGroup>
                            {filterList?.map((option) => (
                                <CommandItem
                                    key={option.id}
                                    onSelect={() => {
                                        handleSelect && handleSelect(option);
                                        if (closeOnSelect) setOpen(false);
                                    }}
                                >
                                    <div
                                        className={cn(
                                            'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-gray-300',
                                            selectedFilters.some((filter) => filter.id == option.id)
                                                ? 'text-base-white border-none bg-primary-300'
                                                : 'opacity-70 [&_svg]:invisible'
                                        )}
                                    >
                                        <Check className={cn('h-4 w-4')} />
                                    </div>
                                    <span>{option.label}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                        {selectedFilters.length > 0 && (
                            <>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem onSelect={handleClearFilters}>
                                        Clear Filters
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

export const StatusChips = ({
    status,
    children,
    className,
    showIcon = true,
}: {
    status:
    | ActivityStatus
    | 'ACTIVE'
    | 'TERMINATED'
    | 'INACTIVE'
    | 'EVALUATED'
    | 'PAYMENT_PENDING'
    | 'PAID';
    children?: ReactNode;
    className?: string;
    showIcon?: boolean;
}) => {
    const normalizedStatus =
        status === 'ACTIVE'
            ? 'active'
            : status === 'INACTIVE'
                ? 'inactive'
                : (status as ActivityStatus);

    const statusData = ActivityStatusData[normalizedStatus];
    const { isCompact } = useCompactMode();

    if (!statusData) {
        return null;
    }

    const StatusIcon = statusData.icon;

    return (
        <ChipsWrapper className={cn(statusData.color.bg, '')}>
            <div className="flex items-center gap-1">
                {showIcon && (
                    <StatusIcon
                        className={cn(statusData.color.icon, isCompact ? 'size-3.5' : 'size-4')}
                        weight="fill"
                    />
                )}
                <div className={cn('capitalize text-neutral-600', isCompact ? 'text-xs' : 'text-body', className)}>
                    {children ? children : status}
                </div>
            </div>
        </ChipsWrapper>
    );
};

/**
 * ChipToggleGroup — single-select row of toggle chips.
 *
 * Use for inline "All / Pending / Completed / Live"-style filters where exactly
 * one option is active at a time. Replaces the hand-rolled patterns previously
 * inlined in Tests, Courses (level filter), and Full History. Different from
 * `FilterChips` above, which is a popover-based multi-select.
 *
 * @example
 *   <ChipToggleGroup
 *     value={activeFilter}
 *     onChange={setActiveFilter}
 *     options={[
 *       { value: 'ALL', label: 'All' },
 *       { value: 'PENDING', label: 'Pending', icon: Clock },
 *       { value: 'LIVE', label: 'Live', icon: Radio },
 *     ]}
 *   />
 */
export interface ChipToggleOption<V extends string = string> {
    value: V;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
}

export interface ChipToggleGroupProps<V extends string = string> {
    value: V;
    onChange: (value: V) => void;
    options: ChipToggleOption<V>[];
    disabled?: boolean;
    className?: string;
    ariaLabel?: string;
    /** `sm` (default) is the compact status pill; `md` is a 36px filter chip. */
    size?: 'sm' | 'md';
    /** `filled` (default) paints the active chip primary; `outline` tints it. */
    variant?: 'filled' | 'outline';
}

export function ChipToggleGroup<V extends string = string>({
    value,
    onChange,
    options,
    disabled,
    className,
    ariaLabel,
    size = 'sm',
    variant = 'filled',
}: ChipToggleGroupProps<V>) {
    const activeClass =
        variant === 'outline'
            ? 'border-primary-500 bg-primary-50 text-primary-600'
            : 'border-primary-500 bg-primary-500 text-neutral-50';
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className={cn('flex flex-wrap items-center gap-1.5', className)}
        >
            {options.map((opt) => {
                const active = opt.value === value;
                const Icon = opt.icon;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => !disabled && onChange(opt.value)}
                        disabled={disabled}
                        aria-pressed={active}
                        className={cn(
                            'inline-flex items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                            size === 'md'
                                ? 'h-9 gap-1.5 px-3.5 text-body font-medium'
                                : 'gap-1 px-2.5 py-0.5 text-2xs font-semibold',
                            active
                                ? cn(activeClass, size === 'md' && 'font-semibold')
                                : 'border-border bg-card text-muted-foreground hover:border-primary-300 hover:text-primary-600',
                            disabled && 'cursor-not-allowed opacity-50'
                        )}
                    >
                        {Icon && <Icon className={size === 'md' ? 'size-4' : 'size-2.5'} />}
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

export const PaymentStatusChips = ({ status }: { status: string }) => {
    const statusData = ActivityStatusData[status as ActivityStatus];
    console.log('statusData', statusData);
    const { isCompact } = useCompactMode();

    if (!statusData) {
        return null;
    }

    const StatusIcon = statusData.icon;

    return (
        <ChipsWrapper className={cn(statusData.color.bg, '')}>
            <div className="flex items-center gap-1">
                <StatusIcon className={cn(statusData.color.icon, isCompact ? 'size-3.5' : 'size-4')} weight="fill" />
                <div className={cn('capitalize text-neutral-600', isCompact ? 'text-xs' : 'text-body')}>{status}</div>
            </div>
        </ChipsWrapper>
    );
};
