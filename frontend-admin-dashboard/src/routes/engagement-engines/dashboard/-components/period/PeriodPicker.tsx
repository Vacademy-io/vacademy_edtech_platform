import { useState } from 'react';
import { format, isSameMonth, parseISO, subMonths } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { CalendarBlank, CaretDown, CaretLeft, CaretRight, Check } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import {
    PERIOD_PRESETS,
    canShift,
    clampPeriod,
    formatPeriodDates,
    isSingleDay,
    periodDays,
    periodLabel,
    presetOf,
    presetPeriod,
    shiftPeriod,
    PRESET_DAYS,
    type PeriodPreset,
    type ReportPeriod,
} from '../../-utils/report-period';

type Mode = 'day' | 'range';

const isoOf = (day: Date): string => format(day, 'yyyy-MM-dd');

/** The days picked so far, earliest first; a first click with no second is that one day. */
const periodOfDraft = (draft: DateRange | undefined): ReportPeriod | null => {
    if (!draft?.from) return null;
    const a = isoOf(draft.from);
    const b = draft.to ? isoOf(draft.to) : a;
    return a <= b ? { from: a, to: b } : { from: b, to: a };
};

interface PeriodPickerProps {
    /** The period shown: a day (`from === to`) or a range. */
    value: ReportPeriod;
    onChange: (period: ReportPeriod) => void;
    /** Earliest and latest pickable day, yyyy-MM-dd; `max` is the institute's today. */
    min: string;
    max: string;
    className?: string;
}

/**
 * Picks the day or the range of days a report covers: arrows that move the period by its own
 * length, and a button that opens the quick picks (Today, Yesterday, Last 7 / 30 / 90 days) and
 * a calendar for one day or a custom range. Days are the institute's, so `min` and `max` come
 * from its time zone; anything picked is kept inside them.
 *
 * Used by the daily report and by the Leads & outcomes page.
 */
export function PeriodPicker({ value, onChange, min, max, className }: PeriodPickerProps) {
    const { t } = useTranslation('engagementDailyReport');
    const isMobile = useIsMobile();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<Mode>('day');
    const [draft, setDraft] = useState<DateRange | undefined>();
    const [month, setMonth] = useState<Date>(() => parseISO(value.to));

    const days = periodDays(value);
    const activePreset = presetOf(value, max);

    // Every time it opens, the panel shows what is applied: its calendar page and its mode.
    const handleOpenChange = (next: boolean) => {
        if (next) {
            const single = isSingleDay(value);
            setMode(single ? 'day' : 'range');
            setDraft(single ? undefined : { from: parseISO(value.from), to: parseISO(value.to) });
            setMonth(parseISO(single ? value.to : value.from));
        }
        setOpen(next);
    };

    const commit = (period: ReportPeriod) => {
        onChange(clampPeriod(period, min, max));
        setOpen(false);
    };

    const pickPreset = (preset: PeriodPreset) => commit(presetPeriod(preset, max));

    // A click after a finished range starts a new one, instead of stretching the old one.
    const onRangeSelect = (next: DateRange | undefined, clicked: Date) => {
        setDraft(draft?.from && draft.to ? { from: clicked, to: undefined } : next);
    };

    const draftPeriod = periodOfDraft(draft);
    const applyRange = () => {
        if (draftPeriod) commit(draftPeriod);
    };

    const limits = [{ before: parseISO(min) }, { after: parseISO(max) }];
    // "Today" on the calendar is the institute's, which is `max`, not the browser's.
    const calendarProps = {
        month,
        onMonthChange: setMonth,
        disabled: limits,
        fromMonth: parseISO(min),
        toMonth: parseISO(max),
        today: parseISO(max),
        className: 'p-0',
    };

    const label = periodLabel(value, max, t);
    // Two months side by side: when the first would be the last allowed one, show the month
    // before it instead of an empty month after it.
    const rangeMonth = !isMobile && isSameMonth(month, parseISO(max)) ? subMonths(month, 1) : month;

    return (
        <div className={cn('flex items-center gap-1', className)}>
            <MyButton
                buttonType="secondary"
                layoutVariant="icon"
                scale="medium"
                aria-label={t('period.previous', { count: days })}
                title={t('period.previous', { count: days })}
                disable={!canShift(value, -1, min, max)}
                onClick={() => onChange(shiftPeriod(value, -1, min, max))}
            >
                <CaretLeft size={16} />
            </MyButton>

            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        className="gap-2"
                        aria-label={t('period.change', { label })}
                    >
                        <CalendarBlank size={16} className="text-neutral-400" />
                        <span className="font-medium">{label}</span>
                        <CaretDown size={12} weight="bold" className="opacity-60" />
                    </MyButton>
                </PopoverTrigger>
                <PopoverContent align="start" className="max-h-screen w-auto overflow-y-auto p-0">
                    <div className="flex flex-col sm:flex-row">
                        <div
                            role="group"
                            aria-label={t('period.presetsLabel')}
                            className="flex flex-col gap-0.5 border-b border-neutral-200 p-2 sm:w-44 sm:shrink-0 sm:border-b-0 sm:border-e"
                        >
                            {PERIOD_PRESETS.map((preset) => {
                                const active = activePreset === preset;
                                const count = PRESET_DAYS[preset];
                                return (
                                    <button
                                        key={preset}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => pickPreset(preset)}
                                        className={cn(
                                            'flex items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-start text-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            active
                                                ? 'bg-primary-50 font-medium text-primary-600'
                                                : 'text-neutral-700 hover:bg-neutral-50'
                                        )}
                                    >
                                        {count
                                            ? t('period.preset.last', { count })
                                            : t(`period.preset.${preset}`)}
                                        {active && <Check size={14} weight="bold" />}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex flex-col gap-3 p-3">
                            <Tabs value={mode} onValueChange={(next) => setMode(next as Mode)}>
                                <TabsList aria-label={t('period.modeLabel')} className="w-full">
                                    <TabsTrigger value="day" className="flex-1">
                                        {t('period.mode.day')}
                                    </TabsTrigger>
                                    <TabsTrigger value="range" className="flex-1">
                                        {t('period.mode.range')}
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>

                            {mode === 'day' ? (
                                <Calendar
                                    {...calendarProps}
                                    mode="single"
                                    selected={isSingleDay(value) ? parseISO(value.from) : undefined}
                                    onSelect={(day) => {
                                        if (day) commit({ from: isoOf(day), to: isoOf(day) });
                                    }}
                                />
                            ) : (
                                <>
                                    <Calendar
                                        {...calendarProps}
                                        month={rangeMonth}
                                        mode="range"
                                        numberOfMonths={isMobile ? 1 : 2}
                                        selected={draft}
                                        onSelect={onRangeSelect}
                                    />
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-3">
                                        <p
                                            role="status"
                                            aria-live="polite"
                                            className="text-neutral-500"
                                        >
                                            <span className="text-caption">
                                                {!draftPeriod ? (
                                                    t('period.pickStart')
                                                ) : !draft?.to ? (
                                                    t('period.pickEnd')
                                                ) : (
                                                    <>
                                                        <span className="font-medium text-neutral-800">
                                                            {formatPeriodDates(draftPeriod)}
                                                        </span>
                                                        {' · '}
                                                        {t('period.days', {
                                                            count: periodDays(draftPeriod),
                                                        })}
                                                    </>
                                                )}
                                            </span>
                                        </p>
                                        <MyButton
                                            buttonType="primary"
                                            scale="small"
                                            disable={!draftPeriod}
                                            onClick={applyRange}
                                        >
                                            {t('period.apply')}
                                        </MyButton>
                                    </div>
                                </>
                            )}
                            <p className="text-neutral-500">
                                <span className="text-caption">
                                    {t('period.limit', {
                                        count: periodDays({ from: min, to: max }),
                                    })}
                                </span>
                            </p>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            <MyButton
                buttonType="secondary"
                layoutVariant="icon"
                scale="medium"
                aria-label={t('period.next', { count: days })}
                title={t('period.next', { count: days })}
                disable={!canShift(value, 1, min, max)}
                onClick={() => onChange(shiftPeriod(value, 1, min, max))}
            >
                <CaretRight size={16} />
            </MyButton>
        </div>
    );
}
