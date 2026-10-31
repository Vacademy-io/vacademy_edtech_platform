import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, CalendarBlank } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';

export interface MonthValue {
    /** 1-12, calendar month (NOT zero-indexed — matches every HR/payroll API). */
    month: number;
    year: number;
}

interface MonthPickerProps {
    value: MonthValue;
    onChange: (value: MonthValue) => void;
    /** Earliest selectable year (default: current year - 5). */
    minYear?: number;
    /** Latest selectable year (default: current year + 1). */
    maxYear?: number;
    /** Block months after the current one — payroll can't run for the future. */
    disableFuture?: boolean;
    disabled?: boolean;
    className?: string;
    /** Rendered before the label, e.g. "Payroll month". */
    label?: string;
}

const MONTH_LABELS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];

const MONTH_FULL = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

/** "August 2026" for a 1-12 month. */
export function formatMonthValue({ month, year }: MonthValue): string {
    return `${MONTH_FULL[month - 1] ?? month} ${year}`;
}

/** The current calendar month as a MonthValue. */
export function currentMonthValue(): MonthValue {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
}

/** The month before the given one — payroll's usual default (you pay last month). */
export function previousMonthValue(from: MonthValue = currentMonthValue()): MonthValue {
    return from.month === 1
        ? { month: 12, year: from.year - 1 }
        : { month: from.month - 1, year: from.year };
}

/**
 * Month + year selector.
 *
 * Payroll, compliance filings and the finance journal are all month-grained, and
 * the app had no month control — a full day-level date picker forces the user to
 * pick a day that then gets thrown away, and makes "which month am I looking at"
 * ambiguous. This shows a year stepper over a 12-month grid: two clicks, no
 * meaningless precision.
 */
export const MonthPicker = ({
    value,
    onChange,
    minYear,
    maxYear,
    disableFuture = false,
    disabled = false,
    className,
    label,
}: MonthPickerProps) => {
    const [open, setOpen] = useState(false);
    const [viewYear, setViewYear] = useState(value.year);

    const now = useMemo(() => currentMonthValue(), []);
    const lowYear = minYear ?? now.year - 5;
    const highYear = maxYear ?? now.year + 1;

    const isMonthDisabled = (month: number) => {
        if (!disableFuture) return false;
        return viewYear > now.year || (viewYear === now.year && month > now.month);
    };

    const handleSelect = (month: number) => {
        if (isMonthDisabled(month)) return;
        onChange({ month, year: viewYear });
        setOpen(false);
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next) setViewYear(value.year);
                setOpen(next);
            }}
        >
            <PopoverTrigger asChild disabled={disabled}>
                <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                        'flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-600',
                        'hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200',
                        disabled && 'cursor-not-allowed opacity-60',
                        className
                    )}
                >
                    <CalendarBlank size={18} className="text-neutral-400" />
                    {label && <span className="text-neutral-500">{label}:</span>}
                    <span className="font-medium text-neutral-700">{formatMonthValue(value)}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
                <div className="mb-3 flex items-center justify-between">
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        disabled={viewYear <= lowYear}
                        onClick={() => setViewYear((y) => Math.max(lowYear, y - 1))}
                        aria-label="Previous year"
                    >
                        <CaretLeft size={16} />
                    </MyButton>
                    <span className="text-subtitle font-semibold text-neutral-700">{viewYear}</span>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        disabled={viewYear >= highYear}
                        onClick={() => setViewYear((y) => Math.min(highYear, y + 1))}
                        aria-label="Next year"
                    >
                        <CaretRight size={16} />
                    </MyButton>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {MONTH_LABELS.map((labelText, index) => {
                        const month = index + 1;
                        const isSelected = value.month === month && value.year === viewYear;
                        const isDisabled = isMonthDisabled(month);
                        return (
                            <button
                                key={labelText}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => handleSelect(month)}
                                className={cn(
                                    'rounded-md py-2 text-body transition-colors',
                                    isSelected
                                        ? 'bg-primary-500 font-medium text-white'
                                        : 'text-neutral-600 hover:bg-neutral-100',
                                    isDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent'
                                )}
                            >
                                {labelText}
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
};
