import { useMemo, useRef } from 'react';
import {
    addMonths,
    eachDayOfInterval,
    endOfMonth,
    endOfWeek,
    format,
    isSameDay,
    isSameMonth,
    isToday,
    parse,
    startOfMonth,
    startOfWeek,
    subMonths,
} from 'date-fns';
import { CaretLeft, CaretRight, CalendarBlank } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import type { LeadProfileSummary } from '@/hooks/use-lead-profiles';
import type { LeadStatus as LeadStatusCatalogItem } from '@/hooks/use-lead-statuses';
import {
    LeadEmptyState,
    LeadTable,
    type LeadActionHandlers,
    type LeadCardVM,
    type LeadTableExtraColumn,
} from '@/components/shared/leads';
import type { LeadNotesSummary } from '@/components/shared/leads/lead-table';
import { classify } from './follow-up-buckets';
import {
    bucketPillClasses,
    dayBucketCounts,
    dominantBucket,
    groupByDay,
} from './follow-up-calendar-helpers';

/**
 * FollowUpsCalendarView — month-grid view of pending follow-ups.
 *
 * Pure presentational: it receives the same `LeadCardVM[]` the list view uses
 * and renders them as event pills on a 6×7 day grid. Clicking a date filters
 * the panel below (which re-uses the canonical `LeadTable`). Mobile falls back
 * to an agenda list of days-with-events.
 *
 * Design-system: tokens only — semantic surfaces (`bg-card`, `bg-muted`,
 * `border-border`), typography tokens (`text-h3`, `text-subtitle`,
 * `text-caption`), semantic colour palettes (`primary/danger/warning/info`).
 */

const MAX_PILLS_PER_DAY = 3;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function buildDayLabels(t: TFunction): Record<(typeof DAY_KEYS)[number], string> {
    return {
        sun: t('dayLabels.sun'),
        mon: t('dayLabels.mon'),
        tue: t('dayLabels.tue'),
        wed: t('dayLabels.wed'),
        thu: t('dayLabels.thu'),
        fri: t('dayLabels.fri'),
        sat: t('dayLabels.sat'),
    };
}

interface FollowUpsCalendarViewProps {
    vms: LeadCardVM[];
    monthStr: string; // yyyy-MM (local)
    onMonthChange: (m: string) => void;
    selectedDateStr: string; // yyyy-MM-dd (local)
    onSelectDate: (d: string) => void;
    isLoading: boolean;
    error: unknown;
    // LeadTable passthrough for the selected-day panel.
    profiles: Record<string, LeadProfileSummary>;
    notes?: Record<string, LeadNotesSummary>;
    statuses?: LeadStatusCatalogItem[];
    showOps: boolean;
    showScore?: boolean;
    actions: LeadActionHandlers;
    onStatusUpdated?: () => void;
    hiddenColumns?: Set<string>;
    extraColumns?: LeadTableExtraColumn[];
}

export function FollowUpsCalendarView({
    vms,
    monthStr,
    onMonthChange,
    selectedDateStr,
    onSelectDate,
    isLoading,
    error,
    profiles,
    notes,
    statuses,
    showOps,
    showScore,
    actions,
    onStatusUpdated,
    hiddenColumns,
    extraColumns,
}: FollowUpsCalendarViewProps) {
    const { t } = useTranslation('audienceManagerFollowUpsCalendarView');
    const dayLabels = useMemo(() => buildDayLabels(t), [t]);
    const month = useMemo(() => safeParseMonth(monthStr), [monthStr]);
    const selectedDate = useMemo(() => safeParseDate(selectedDateStr), [selectedDateStr]);

    // 6-week grid: start at the Sunday of the week containing the 1st.
    const days = useMemo(() => {
        const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
        const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
        return eachDayOfInterval({ start, end });
    }, [month]);

    const byDay = useMemo(() => groupByDay(vms), [vms]);
    const selectedKey = format(selectedDate, 'yyyy-MM-dd');
    // Stabilise the reference so the useMemo below doesn't re-run every render
    // when the key is missing (default `[]` would be a new array each time).
    const dayVms = useMemo(() => byDay.get(selectedKey) ?? [], [byDay, selectedKey]);
    const dayCounts = useMemo(() => dayBucketCounts(dayVms), [dayVms]);

    // Agenda fallback only needs days IN this month that have events.
    const visibleDaysWithEvents = useMemo(
        () =>
            days.filter(
                (d) =>
                    isSameMonth(d, month) && (byDay.get(format(d, 'yyyy-MM-dd'))?.length ?? 0) > 0
            ),
        [days, byDay, month]
    );

    const goPrev = () => onMonthChange(format(subMonths(month, 1), 'yyyy-MM'));
    const goNext = () => onMonthChange(format(addMonths(month, 1), 'yyyy-MM'));
    const goToday = () => {
        const today = new Date();
        onMonthChange(format(today, 'yyyy-MM'));
        onSelectDate(format(today, 'yyyy-MM-dd'));
    };
    const onDayClick = (d: Date) => onSelectDate(format(d, 'yyyy-MM-dd'));

    // "+N more" has to take you somewhere. The grid is six rows tall, so the
    // panel that actually lists the day sits below the fold — selecting the day
    // without scrolling looked like the click did nothing.
    const dayPanelRef = useRef<HTMLDivElement>(null);
    const showWholeDay = (d: Date) => {
        onDayClick(d);
        requestAnimationFrame(() =>
            dayPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        );
    };

    return (
        <div className="flex w-full flex-col gap-4">
            {/* Header: month nav + Today */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <MyButton
                        buttonType="text"
                        scale="medium"
                        layoutVariant="icon"
                        onClick={goPrev}
                        aria-label={t('nav.previousMonth')}
                    >
                        <CaretLeft className="size-4" />
                    </MyButton>
                    <h2 className="text-h3 text-card-foreground">{format(month, 'MMMM yyyy')}</h2>
                    <MyButton
                        buttonType="text"
                        scale="medium"
                        layoutVariant="icon"
                        onClick={goNext}
                        aria-label={t('nav.nextMonth')}
                    >
                        <CaretRight className="size-4" />
                    </MyButton>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <CalendarLegend />
                    <MyButton buttonType="secondary" scale="small" onClick={goToday}>
                        <CalendarBlank className="size-4" />
                        {t('nav.today')}
                    </MyButton>
                </div>
            </div>

            {error ? (
                <LeadEmptyState
                    title={t('error.title')}
                    description={t('error.description')}
                />
            ) : (
                <>
                    {/* Grid view (md+) */}
                    <div className="hidden md:block">
                        <div className="grid grid-cols-7 overflow-hidden rounded-t-lg border border-b-0 border-border">
                            {DAY_KEYS.map((d) => (
                                <div
                                    key={d}
                                    className="bg-muted p-2 text-caption text-muted-foreground"
                                >
                                    {dayLabels[d]}
                                </div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 overflow-hidden rounded-b-lg border-x border-b border-border">
                            {days.map((day) => {
                                const key = format(day, 'yyyy-MM-dd');
                                const cellVms = byDay.get(key) ?? [];
                                const inMonth = isSameMonth(day, month);
                                const isSelected = isSameDay(day, selectedDate);
                                const todayCell = isToday(day);
                                const overflow = Math.max(0, cellVms.length - MAX_PILLS_PER_DAY);
                                return (
                                    <div
                                        key={day.toISOString()}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={format(day, 'EEEE, MMM d')}
                                        onClick={() => onDayClick(day)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                onDayClick(day);
                                            }
                                        }}
                                        className={cn(
                                            'flex min-h-28 cursor-pointer flex-col gap-1 border-b border-r border-border bg-card p-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            !inMonth && 'bg-muted/40',
                                            isSelected && 'ring-2 ring-inset ring-primary-500'
                                        )}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span
                                                className={cn(
                                                    'text-caption',
                                                    inMonth
                                                        ? 'text-card-foreground'
                                                        : 'text-muted-foreground',
                                                    todayCell &&
                                                        'inline-flex size-5 items-center justify-center rounded-full bg-primary-500 text-neutral-50'
                                                )}
                                            >
                                                {format(day, 'd')}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            {cellVms.slice(0, MAX_PILLS_PER_DAY).map((vm) => {
                                                const bucket = classify(vm);
                                                return (
                                                    <button
                                                        key={vm.key}
                                                        type="button"
                                                        title={t('pill.openTooltip', {
                                                            name: vm.name,
                                                        })}
                                                        onClick={(e) => {
                                                            // Don't let the cell swallow it — the
                                                            // pill means "this lead", the cell
                                                            // means "this day".
                                                            e.stopPropagation();
                                                            onDayClick(day);
                                                            actions.onOpenDetails(vm);
                                                        }}
                                                        className={cn(
                                                            'truncate rounded-md border px-2 py-0.5 text-left text-caption transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                                            bucketPillClasses(bucket)
                                                        )}
                                                    >
                                                        {vm.name}
                                                    </button>
                                                );
                                            })}
                                            {overflow > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        showWholeDay(day);
                                                    }}
                                                    className="rounded-md px-2 text-left text-caption text-muted-foreground underline-offset-2 hover:text-card-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                >
                                                    {t('overflowMore', { count: overflow })}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Agenda fallback (below md) */}
                    <div className="md:hidden">
                        {visibleDaysWithEvents.length === 0 ? (
                            <LeadEmptyState
                                title={t('agenda.emptyTitle')}
                                description={t('agenda.emptyDescription')}
                            />
                        ) : (
                            <div className="flex flex-col gap-2">
                                {visibleDaysWithEvents.map((day) => {
                                    const key = format(day, 'yyyy-MM-dd');
                                    const dayList = byDay.get(key) ?? [];
                                    const dom = dominantBucket(dayList);
                                    const isSelected = isSameDay(day, selectedDate);
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => onDayClick(day)}
                                            className={cn(
                                                'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-left hover:bg-muted',
                                                isSelected && 'ring-2 ring-primary-500'
                                            )}
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-caption text-muted-foreground">
                                                    {format(day, 'EEE')}
                                                </span>
                                                <span className="text-subtitle text-card-foreground">
                                                    {format(day, 'd MMM')}
                                                </span>
                                            </div>
                                            <span
                                                className={cn(
                                                    'rounded-md border px-2 py-0.5 text-caption',
                                                    bucketPillClasses(dom)
                                                )}
                                            >
                                                {t('agenda.tasks', { count: dayList.length })}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Selected day panel */}
                    <div ref={dayPanelRef} className="mt-2 flex scroll-mt-4 flex-col gap-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="text-subtitle font-semibold text-card-foreground">
                                {format(selectedDate, 'EEEE, MMM d')}
                            </h3>
                            <div className="flex items-center gap-2 text-caption">
                                {dayCounts.overdue > 0 && (
                                    <span className="rounded-md border border-danger-200 bg-danger-100 px-2 py-0.5 text-danger-600">
                                        {t('dayCounts.overdue', { count: dayCounts.overdue })}
                                    </span>
                                )}
                                {dayCounts.today > 0 && (
                                    <span className="rounded-md border border-warning-200 bg-warning-100 px-2 py-0.5 text-warning-600">
                                        {t('dayCounts.today', { count: dayCounts.today })}
                                    </span>
                                )}
                                {dayCounts.upcoming > 0 && (
                                    <span className="rounded-md border border-info-200 bg-info-100 px-2 py-0.5 text-info-600">
                                        {t('dayCounts.upcoming', { count: dayCounts.upcoming })}
                                    </span>
                                )}
                                {dayCounts.all === 0 && (
                                    <span className="text-muted-foreground">
                                        {t('dayCounts.none')}
                                    </span>
                                )}
                            </div>
                        </div>
                        <LeadTable
                            vms={dayVms}
                            profiles={profiles}
                            notes={notes}
                            statuses={statuses}
                            showOps={showOps}
                            showScore={showScore}
                            isLoading={isLoading}
                            actions={actions}
                            onStatusUpdated={onStatusUpdated}
                            hiddenColumns={hiddenColumns}
                            extraColumns={extraColumns}
                            emptyState={
                                <LeadEmptyState
                                    title={t('dayPanel.emptyTitle')}
                                    description={t('dayPanel.emptyDescription')}
                                />
                            }
                        />
                    </div>
                </>
            )}
        </div>
    );
}

// Safe parsers — fall back to today / current month on invalid input.
function safeParseMonth(monthStr: string | undefined): Date {
    if (!monthStr) return startOfMonth(new Date());
    const d = parse(monthStr, 'yyyy-MM', new Date());
    return Number.isNaN(d.getTime()) ? startOfMonth(new Date()) : startOfMonth(d);
}
function safeParseDate(dateStr: string | undefined): Date {
    if (!dateStr) return new Date();
    const d = parse(dateStr, 'yyyy-MM-dd', new Date());
    return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Bucket colour key for the grid pills. */
function CalendarLegend() {
    const { t } = useTranslation('crmPages');
    const items: Array<[string, string]> = [
        ['bg-danger-500', t('followUps.agenda.overdue')],
        ['bg-warning-500', t('followUps.agenda.today')],
        ['bg-info-500', t('followUps.legend.upcoming')],
    ];
    return (
        <div className="hidden items-center gap-3 text-caption text-neutral-500 md:flex">
            {items.map(([dot, label]) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                    <span className={cn('size-2 rounded-full', dot)} aria-hidden="true" />
                    {label}
                </span>
            ))}
        </div>
    );
}
