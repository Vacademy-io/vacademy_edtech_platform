import { useEffect, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarBlank, CaretDown, CaretRight, Check } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';
import {
    PRESET_OPTIONS,
    customRange,
    formatRangeLabel,
    fromDateInputValue,
    isRangeActive,
    rangeDates,
    recentYears,
    resolvePreset,
    toDateInputValue,
    yearRange,
    type DateRangeValue,
} from '../-utils/dateRange';

interface DateRangeDropdownProps {
    value: DateRangeValue;
    onChange: (value: DateRangeValue) => void;
    /** Popover alignment against the trigger. */
    align?: 'start' | 'center' | 'end';
    className?: string;
}

const sameDay = (a: Date | undefined, b: Date | undefined) =>
    !!a && !!b && a.toDateString() === b.toDateString();

/**
 * One-click date window: the current range is printed on the trigger, and the whole preset list
 * (plus a custom range) is one click away. This sits in the page toolbar precisely so changing the
 * period never means opening the filters panel first.
 *
 * The custom range used to be a one-month calendar only: reaching a year back meant a dozen arrow
 * clicks, and "2019" ended up picked as 1 Jan 2019 – 1 Jan 2020, a day too many. Now a past year is
 * one chip, the dates can be typed, and the calendar follows whatever was typed.
 */
export function DateRangeDropdown({
    value,
    onChange,
    align = 'start',
    className,
}: DateRangeDropdownProps) {
    const [open, setOpen] = useState(false);
    const [showCustom, setShowCustom] = useState(value.preset === 'custom');
    const [draft, setDraft] = useState<DateRange | undefined>(() => rangeDates(value));
    const [month, setMonth] = useState<Date>(() => rangeDates(value).from ?? new Date());
    // Typed text is kept apart from the draft, so a half-typed date doesn't wipe the range.
    const [fromText, setFromText] = useState('');
    const [toText, setToText] = useState('');

    // Re-seed the panel whenever the popover reopens, so it always reflects what's applied.
    useEffect(() => {
        if (!open) return;
        const dates = value.preset === 'custom' ? rangeDates(value) : undefined;
        setShowCustom(value.preset === 'custom');
        setDraft(dates);
        setFromText(toDateInputValue(dates?.from));
        setToText(toDateInputValue(dates?.to));
        setMonth(dates?.from ?? new Date());
    }, [open, value]);

    const active = isRangeActive(value);

    const apply = (next: DateRangeValue) => {
        onChange(next);
        setOpen(false);
    };

    const setDraftRange = (next: DateRange | undefined) => {
        setDraft(next);
        setFromText(toDateInputValue(next?.from));
        setToText(toDateInputValue(next?.to));
    };

    // A click after a finished range starts a new one; the stock behaviour stretched the old
    // range towards the click, which read as the calendar ignoring the admin.
    const onCalendarSelect = (next: DateRange | undefined, clicked: Date) => {
        if (draft?.from && draft?.to) {
            setDraftRange({ from: clicked, to: undefined });
            return;
        }
        setDraftRange(next);
    };

    const onTypedFrom = (text: string) => {
        setFromText(text);
        const from = fromDateInputValue(text);
        if (!from) return;
        setDraft((prev) => ({ from, to: prev?.to }));
        setMonth(from);
    };

    const onTypedTo = (text: string) => {
        setToText(text);
        const to = fromDateInputValue(text);
        if (!to) return;
        setDraft((prev) => ({ from: prev?.from, to }));
        if (!draft?.from) setMonth(to);
    };

    const draftFrom = draft?.from ?? draft?.to;
    const draftTo = draft?.to ?? draft?.from;
    const draftValue = draftFrom && draftTo ? customRange(draftFrom, draftTo) : null;
    const draftDays = draftValue
        ? Math.round(
              (new Date(draftValue.end).getTime() - new Date(draftValue.start).getTime()) /
                  86_400_000
          )
        : 0;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                        'h-9 gap-2 font-medium',
                        active && 'border-primary-500 bg-primary-50 text-primary-600',
                        className
                    )}
                >
                    <CalendarBlank size={16} weight={active ? 'fill' : 'regular'} />
                    {formatRangeLabel(value)}
                    <CaretDown size={12} weight="bold" className="opacity-60" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align={align}
                className={cn('w-56 p-0', showCustom && 'w-auto')}
            >
                <div className={cn('flex flex-col', showCustom && 'sm:flex-row')}>
                    <div
                        className={cn(
                            'flex flex-col p-1.5',
                            showCustom &&
                                'border-b border-neutral-200 sm:w-44 sm:shrink-0 sm:border-b-0 sm:border-r'
                        )}
                    >
                        {PRESET_OPTIONS.map((option) => {
                            const isActive = value.preset === option.key;
                            return (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => apply(resolvePreset(option.key))}
                                    className={cn(
                                        'flex items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-body transition-colors',
                                        isActive
                                            ? 'bg-primary-50 font-medium text-primary-600'
                                            : 'text-neutral-700 hover:bg-neutral-50'
                                    )}
                                >
                                    {option.label}
                                    {isActive && <Check size={14} weight="bold" />}
                                </button>
                            );
                        })}

                        <div className="my-1 h-px bg-neutral-200" />

                        <button
                            type="button"
                            onClick={() => setShowCustom((prev) => !prev)}
                            className={cn(
                                'flex items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-body transition-colors',
                                value.preset === 'custom' || showCustom
                                    ? 'bg-primary-50 font-medium text-primary-600'
                                    : 'text-neutral-700 hover:bg-neutral-50'
                            )}
                            aria-expanded={showCustom}
                        >
                            Custom range
                            {value.preset === 'custom' ? (
                                <Check size={14} weight="bold" />
                            ) : (
                                <CaretRight
                                    size={12}
                                    weight="bold"
                                    className={cn(
                                        'opacity-60 transition-transform',
                                        showCustom && 'rotate-90 sm:rotate-0'
                                    )}
                                />
                            )}
                        </button>
                    </div>

                    {showCustom && (
                        <div className="flex flex-col gap-3 p-3">
                            <div className="flex flex-col gap-1.5">
                                <span className="text-caption font-medium text-neutral-600">
                                    Whole year
                                </span>
                                <div className="grid grid-cols-5 gap-1.5">
                                    {recentYears().map((year) => {
                                        const isYear =
                                            value.preset === 'custom' &&
                                            formatRangeLabel(value) === String(year);
                                        return (
                                            <button
                                                key={year}
                                                type="button"
                                                onClick={() => apply(yearRange(year))}
                                                className={cn(
                                                    'rounded-md border px-2.5 py-1 text-caption font-medium transition-colors',
                                                    isYear
                                                        ? 'border-primary-500 bg-primary-50 text-primary-600'
                                                        : 'border-neutral-200 text-neutral-700 hover:border-primary-200 hover:bg-neutral-50'
                                                )}
                                            >
                                                {year}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <label className="flex flex-col gap-1">
                                    <span className="text-caption font-medium text-neutral-600">
                                        From
                                    </span>
                                    <MyInput
                                        inputType="date"
                                        input={fromText}
                                        onChangeFunction={(e) => onTypedFrom(e.target.value)}
                                        className="w-full text-body text-neutral-800 sm:w-full"
                                    />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-caption font-medium text-neutral-600">
                                        To
                                    </span>
                                    <MyInput
                                        inputType="date"
                                        input={toText}
                                        min={fromText || undefined}
                                        onChangeFunction={(e) => onTypedTo(e.target.value)}
                                        className="w-full text-body text-neutral-800 sm:w-full"
                                    />
                                </label>
                            </div>

                            <Calendar
                                mode="range"
                                selected={draft}
                                onSelect={onCalendarSelect}
                                month={month}
                                onMonthChange={setMonth}
                                numberOfMonths={2}
                                className="p-0"
                            />

                            <div className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-3">
                                <span className="text-caption text-neutral-500">
                                    {draftValue ? (
                                        <>
                                            <span className="font-medium text-neutral-800">
                                                {formatRangeLabel(draftValue)}
                                            </span>
                                            {sameDay(draftFrom, draftTo)
                                                ? ' · 1 day'
                                                : ` · ${draftDays.toLocaleString()} days, both dates included`}
                                        </>
                                    ) : (
                                        'Pick a year, type the dates, or click a start and end day'
                                    )}
                                </span>
                                <div className="flex shrink-0 items-center gap-2">
                                    {draft?.from && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7"
                                            onClick={() => setDraftRange(undefined)}
                                        >
                                            Clear
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        className="h-7"
                                        disabled={!draftValue}
                                        onClick={() => draftValue && apply(draftValue)}
                                    >
                                        Apply
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
