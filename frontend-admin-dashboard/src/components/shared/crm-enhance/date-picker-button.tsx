import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarBlank } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DatePickerButtonProps {
    /** Shown before the date, e.g. "From" / "To". */
    label: string;
    /** yyyy-MM-dd, or '' for none. */
    value: string;
    onChange: (value: string) => void;
    /** Earliest / latest pickable day (yyyy-MM-dd). */
    min?: string;
    max?: string;
    /** Shown when no date is set. */
    placeholder?: string;
    disabled?: boolean;
    /** Controlled open state (optional), e.g. to open the start date first. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    className?: string;
}

/**
 * One date as a button that opens its own month calendar; picking a day sets it and
 * closes. Use two of these for a start / end range (pass min / max so the range
 * cannot be reversed). Values stay yyyy-MM-dd strings, like a native date input.
 */
export function DatePickerButton({
    label,
    value,
    onChange,
    min,
    max,
    placeholder,
    disabled,
    open: openProp,
    onOpenChange,
    className,
}: DatePickerButtonProps) {
    const [openState, setOpenState] = useState(false);
    const open = openProp ?? openState;
    const setOpen = (next: boolean) => {
        setOpenState(next);
        onOpenChange?.(next);
    };
    const selected = value ? parseISO(value) : undefined;
    const limits = [
        ...(min ? [{ before: parseISO(min) }] : []),
        ...(max ? [{ after: parseISO(max) }] : []),
    ];
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    className={cn('h-9 gap-1.5', className)}
                >
                    <CalendarBlank className="size-4 text-neutral-400" />
                    <span className="text-neutral-500">{label}</span>
                    <span className="font-medium text-neutral-800">
                        {selected ? format(selected, 'd MMM yyyy') : placeholder}
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-3">
                <Calendar
                    mode="single"
                    defaultMonth={selected ?? (max ? parseISO(max) : undefined)}
                    selected={selected}
                    onSelect={(day) => {
                        if (!day) return;
                        onChange(format(day, 'yyyy-MM-dd'));
                        setOpen(false);
                    }}
                    disabled={limits}
                />
            </PopoverContent>
        </Popover>
    );
}
