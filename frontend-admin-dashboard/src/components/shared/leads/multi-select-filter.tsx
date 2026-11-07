import { useState } from 'react';
import { CaretDown, Check, Lock, PlusCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChipsWrapper } from '@/components/design-system/chips';
import { useCompactMode } from '@/hooks/use-compact-mode';
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

export interface MultiSelectOption {
    value: string;
    label: string;
    /**
     * Secondary line under the label — an email, a role. Also folded into the
     * text the search box matches, so two people with the same name stay
     * tellable apart.
     */
    sublabel?: string;
    /** When true, selecting this clears all other selections (acts like "All"). */
    clearAll?: boolean;
}

interface MultiSelectFilterProps {
    /** Display label shown on the trigger when nothing is selected. */
    label: string;
    /** Optional icon rendered before the label on the trigger button. */
    icon?: React.ReactNode;
    options: MultiSelectOption[];
    /** Currently selected values. An empty array means "all" (no filter). */
    selected: string[];
    onChange: (values: string[]) => void;
    placeholder?: string;
    /** Width class for the trigger button (default: w-44). */
    widthClass?: string;
    /**
     * Summarize the selection ON the trigger instead of appending "· <count>" to
     * {@link label}: the chosen option's own label when exactly one is picked,
     * "<n> selected" beyond that.
     *
     * Opt-in, for filter bars that already caption the control with a field
     * `<Label>` above it (e.g. the Call Log's). There "All · 1" reads as noise where
     * "Callback" reads as the value; the default "<label> · <count>" stays right for
     * the self-captioning toolbar pill Recent Leads uses.
     */
    showSelectedLabel?: boolean;
    /**
     * Trigger look. 'button' (default) matches the leads filter bars' outline
     * chips. 'pill' matches Manage Students' rounded FilterChips pill (see
     * design-system/chips.tsx) so this combobox blends in next to that page's
     * other filter chips — the same split CustomFieldMultiSelectFilter makes.
     * Styling only; behaviour is identical.
     */
    variant?: 'button' | 'pill';
    /**
     * Turns the selection inside out: "show only these" becomes "show everything except
     * these". Omit to leave the control exactly as it was. Saves a view from having to
     * list nine statuses to mean "not New" — and from breaking when a tenth is added.
     */
    exclude?: { value: boolean; onChange: (next: boolean) => void; label: string };
    /** Pinned by the route (see pinned-filters.ts): show the value, refuse to change it.
     *  Without this the lock only survived "Clear all" — the dropdown stayed open for
     *  business, so a sub-tab called "Untouched Leads" could be turned into all leads. */
    locked?: boolean;
    /** Shown inside a locked popover so the dead controls explain themselves. */
    lockedHint?: string;
}

/**
 * Generic multi-select combobox for static option lists (tier, SLA, etc.).
 * Stays open while the user checks items, shows a count badge on the trigger.
 * Selecting a clearAll option resets all others.
 */
export function MultiSelectFilter({
    label,
    icon,
    options,
    selected,
    onChange,
    placeholder = 'Search…',
    widthClass = 'w-44',
    showSelectedLabel = false,
    variant = 'button',
    exclude,
    locked = false,
    lockedHint = 'Fixed by this tab',
}: MultiSelectFilterProps) {
    const [open, setOpen] = useState(false);
    const { isCompact } = useCompactMode();

    const toggle = (value: string, clearAll: boolean | undefined) => {
        // The route owns this filter; the popover is a read-only view of it.
        if (locked) return;
        if (clearAll) {
            // "All" option — clear every selection
            onChange([]);
            return;
        }
        if (selected.includes(value)) {
            onChange(selected.filter((v) => v !== value));
        } else {
            onChange([...selected, value]);
        }
    };

    const count = selected.length;
    const soleSelectedLabel =
        count === 1 ? options.find((o) => o.value === selected[0])?.label : undefined;
    const triggerLabel = showSelectedLabel
        ? count === 0
            ? label
            : soleSelectedLabel ?? `${count} selected`
        : count > 0
          ? `${label} · ${count}`
          : label;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {variant === 'pill' ? (
                    <button
                        type="button"
                        role="combobox"
                        aria-expanded={open}
                        aria-label={`Filter by ${label.toLowerCase()}`}
                    >
                        <ChipsWrapper
                            className={cn(
                                count > 0
                                    ? 'border-primary-500 bg-primary-100'
                                    : 'hover:border-primary-500 hover:bg-primary-50'
                            )}
                        >
                            <div className="flex items-center gap-2">
                                {icon ?? (
                                    <PlusCircle
                                        className={cn(
                                            isCompact ? 'size-3.5' : 'size-4',
                                            'text-neutral-600'
                                        )}
                                    />
                                )}
                                <div
                                    className={cn(
                                        'flex items-center',
                                        isCompact ? 'text-xs' : 'text-body',
                                        'text-neutral-600'
                                    )}
                                >
                                    {label}
                                </div>
                                {count > 0 && (
                                    <div className="flex items-center gap-2">
                                        <Separator
                                            orientation="vertical"
                                            className="mx-2 h-4 bg-neutral-500"
                                        />
                                        <div className="inline-flex items-center rounded-md bg-primary-200 px-2.5 py-0.5 text-caption font-normal">
                                            {count} selected
                                        </div>
                                    </div>
                                )}
                            </div>
                        </ChipsWrapper>
                    </button>
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        role="combobox"
                        aria-expanded={open}
                        aria-label={`Filter by ${label.toLowerCase()}`}
                        className={cn(
                            'h-10 justify-between',
                            widthClass,
                            count > 0 && 'border-primary-300 bg-primary-50',
                            locked && 'cursor-default bg-neutral-50 text-neutral-500'
                        )}
                    >
                        <span className="flex min-w-0 items-center gap-1.5">
                            {icon}
                            <span className="truncate text-sm font-normal">{triggerLabel}</span>
                        </span>
                        {locked ? (
                            <Lock className="size-4 shrink-0 text-neutral-400" weight="fill" />
                        ) : (
                            <CaretDown className="size-4 shrink-0 text-neutral-400" />
                        )}
                    </Button>
                )}
            </PopoverTrigger>
            {/* Only the two-line (sublabel) variant needs the extra width; every
                existing call site keeps the width it had. */}
            <PopoverContent
                align="start"
                className={cn('p-0', options.some((opt) => opt.sublabel) ? 'w-64' : 'w-56')}
            >
                <Command>
                    {locked ? (
                        <p className="flex items-center gap-1.5 border-b border-neutral-100 px-3 py-2 text-caption text-neutral-500">
                            <Lock className="size-3.5 shrink-0" weight="fill" />
                            {lockedHint}
                        </p>
                    ) : (
                        <CommandInput placeholder={placeholder} className="h-9" />
                    )}
                    <CommandList className="max-h-64 overflow-y-auto">
                        <CommandEmpty>No options found.</CommandEmpty>
                        {exclude && (
                            <CommandItem
                                value="__exclude__"
                                onSelect={() => !locked && exclude.onChange(!exclude.value)}
                                className={cn(
                                    'gap-2 text-neutral-600',
                                    locked ? 'cursor-default opacity-60' : 'cursor-pointer'
                                )}
                            >
                                <span
                                    className={cn(
                                        'flex size-4 shrink-0 items-center justify-center rounded border',
                                        exclude.value
                                            ? 'border-primary-500 bg-primary-500 text-white'
                                            : 'border-neutral-300'
                                    )}
                                >
                                    {exclude.value && <Check className="size-3" />}
                                </span>
                                {exclude.label}
                            </CommandItem>
                        )}
                        {count > 0 && !locked && (
                            <CommandItem
                                value="__clear__"
                                onSelect={() => onChange([])}
                                className="cursor-pointer text-neutral-500"
                            >
                                Clear selection
                            </CommandItem>
                        )}
                        <CommandGroup>
                            {options.map((opt) => (
                                <CommandItem
                                    key={opt.value}
                                    value={
                                        opt.sublabel ? `${opt.label} ${opt.sublabel}` : opt.label
                                    }
                                    onSelect={() => toggle(opt.value, opt.clearAll)}
                                    className={cn(
                                        locked ? 'cursor-default opacity-60' : 'cursor-pointer'
                                    )}
                                >
                                    {/* A real box, not a tick that fades to nothing: with only
                                        the tick, an unticked row showed blank space and the whole
                                        control read as single-select. */}
                                    <span
                                        className={cn(
                                            'mr-2 flex size-4 shrink-0 items-center justify-center rounded border',
                                            (
                                                opt.clearAll
                                                    ? count === 0
                                                    : selected.includes(opt.value)
                                            )
                                                ? 'border-primary-500 bg-primary-500 text-white'
                                                : 'border-neutral-300'
                                        )}
                                    >
                                        {(opt.clearAll
                                            ? count === 0
                                            : selected.includes(opt.value)) && (
                                            <Check className="size-3" />
                                        )}
                                    </span>
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate">{opt.label}</span>
                                        {opt.sublabel && (
                                            <span className="truncate text-xs text-neutral-500">
                                                {opt.sublabel}
                                            </span>
                                        )}
                                    </span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
