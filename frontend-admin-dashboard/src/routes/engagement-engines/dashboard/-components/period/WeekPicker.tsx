import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarBlank, CaretDown, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatPeriodDates } from '../../-utils/report-period';
import {
    canShiftWeek,
    clampWeekEnd,
    earliestWeekEnd,
    shiftWeek,
    weekEndingOn,
} from '../../-utils/report-week';

interface WeekPickerProps {
    /** The last day of the week shown, yyyy-MM-dd. */
    end: string;
    onChange: (end: string) => void;
    /** Earliest day the report reaches back to, and the institute's today, yyyy-MM-dd. */
    minDate: string;
    today: string;
    className?: string;
}

/**
 * Picks the week the weekly view covers: the 7 days ending on a chosen day, with arrows for the
 * week before and after (never into the future) and a calendar to name the last day. Days are
 * the institute's, so `today` and `minDate` come from its time zone; anything picked is kept
 * inside them. The week is shown as its dates, and "Last 7 days" when it ends today.
 */
export function WeekPicker({ end, onChange, minDate, today, className }: WeekPickerProps) {
    const { t } = useTranslation('engagementDailyReport');
    const [open, setOpen] = useState(false);
    const [month, setMonth] = useState<Date>(() => parseISO(end));

    const dates = formatPeriodDates(weekEndingOn(end));
    const label = end === today ? `${t('diagnosis.week.last7')} · ${dates}` : dates;

    const handleOpenChange = (next: boolean) => {
        if (next) setMonth(parseISO(end));
        setOpen(next);
    };

    return (
        <div className={cn('flex items-center gap-1', className)}>
            <MyButton
                buttonType="secondary"
                layoutVariant="icon"
                scale="medium"
                aria-label={t('diagnosis.week.previous')}
                title={t('diagnosis.week.previous')}
                disable={!canShiftWeek(end, -1, minDate, today)}
                onClick={() => onChange(shiftWeek(end, -1, minDate, today))}
            >
                <CaretLeft size={16} />
            </MyButton>

            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        className="gap-2"
                        aria-label={t('diagnosis.week.change', { label })}
                    >
                        <CalendarBlank size={16} className="text-neutral-400" />
                        <span className="font-medium">{label}</span>
                        <CaretDown size={12} weight="bold" className="opacity-60" />
                    </MyButton>
                </PopoverTrigger>
                <PopoverContent align="start" className="max-h-screen w-auto overflow-y-auto p-3">
                    <div className="flex flex-col gap-3">
                        <p className="text-neutral-700">
                            <span className="text-body font-medium">
                                {t('diagnosis.week.pick')}
                            </span>
                        </p>
                        <Calendar
                            mode="single"
                            month={month}
                            onMonthChange={setMonth}
                            selected={parseISO(end)}
                            onSelect={(day) => {
                                if (!day) return;
                                onChange(clampWeekEnd(format(day, 'yyyy-MM-dd'), minDate, today));
                                setOpen(false);
                            }}
                            disabled={[
                                { before: parseISO(earliestWeekEnd(minDate)) },
                                { after: parseISO(today) },
                            ]}
                            fromMonth={parseISO(minDate)}
                            toMonth={parseISO(today)}
                            today={parseISO(today)}
                            className="p-0"
                        />
                        <p className="text-neutral-500">
                            <span className="text-caption">{t('diagnosis.week.hint')}</span>
                        </p>
                    </div>
                </PopoverContent>
            </Popover>

            <MyButton
                buttonType="secondary"
                layoutVariant="icon"
                scale="medium"
                aria-label={t('diagnosis.week.next')}
                title={t('diagnosis.week.next')}
                disable={!canShiftWeek(end, 1, minDate, today)}
                onClick={() => onChange(shiftWeek(end, 1, minDate, today))}
            >
                <CaretRight size={16} />
            </MyButton>
        </div>
    );
}
