import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, CalendarBlank } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getBrowserTimezoneOrUndefined, normalizeTimezone } from '@/utils/timezone';
import type { EngagementItemDTO, EngagementPlanDTO, EngagementSlotDTO } from '../../-types/types';
import { typeMeta } from '../../-utils/type-meta';
import { relativeDayOf } from '../forms/composer-schema';
import {
    formatDay,
    formatDayRange,
    formatFraction,
    formatPercent,
    formatTime,
    formatTimeRange,
    formatWeekdays,
    instituteTimeZone,
    slotLastDate,
    slotPhase,
    todayInZone,
} from '../../-utils/format';

/** Upcoming days shown before "Show N more days". */
const UPCOMING_VISIBLE = 2;
/** Below this completion rate a closed task's bar turns amber. */
const LOW_RATE = 0.5;

export type DayPhase = 'PAST' | 'TODAY' | 'UPCOMING';

export interface PhasedSlots {
    past: EngagementSlotDTO[];
    today: EngagementSlotDTO[];
    upcoming: EngagementSlotDTO[];
}

function bySchedule(a: EngagementSlotDTO, b: EngagementSlotDTO): number {
    return (
        a.startDate.localeCompare(b.startDate) ||
        a.startTime.localeCompare(b.startTime) ||
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    );
}

/**
 * Splits a plan's days into Past / Today / Upcoming around `today` (the plan's own
 * calendar day). A repeating day that runs today counts as Today; one that still has
 * dates ahead counts as Upcoming. Each group is in schedule order.
 */
export function groupSlotsByPhase(slots: EngagementSlotDTO[], today: string): PhasedSlots {
    const out: PhasedSlots = { past: [], today: [], upcoming: [] };
    for (const slot of [...slots].sort(bySchedule)) {
        const phase = slotPhase(slot, today);
        if (phase === 'PAST') out.past.push(slot);
        else if (phase === 'TODAY') out.today.push(slot);
        else out.upcoming.push(slot);
    }
    return out;
}

/** The "of N" for a task: the item's own count, else the day's, else the plan's. */
export function learnersFor(
    item: Pick<EngagementItemDTO, 'learnerCount'>,
    slot: Pick<EngagementSlotDTO, 'learnerCount'>,
    plan: Pick<EngagementPlanDTO, 'learnerCount'>
): number | null {
    const n = item.learnerCount ?? slot.learnerCount ?? plan.learnerCount;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Completions over enrolled learners, 0–1, capped at 1; null when nobody is enrolled. */
export function completionRate(done: number, learners: number | null): number | null {
    if (!learners || learners <= 0) return null;
    return Math.min(1, Math.max(0, done / learners));
}

/**
 * Average completion across days: every task's completions over every task's learners.
 * Null when no task has a known denominator.
 */
export function averageRate(
    slots: EngagementSlotDTO[],
    plan: Pick<EngagementPlanDTO, 'learnerCount'>
): number | null {
    let done = 0;
    let possible = 0;
    for (const slot of slots) {
        for (const item of slot.items) {
            const learners = learnersFor(item, slot, plan);
            if (!learners) continue;
            done += Math.min(learners, item.completedCount ?? 0);
            possible += learners;
        }
    }
    return possible > 0 ? done / possible : null;
}

/** "HH:mm" right now on the wall clock of `timeZone`. */
export function wallClockInZone(timeZone: string, now: Date = new Date()): string {
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: normalizeTimezone(timeZone),
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(now);
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
        return `${get('hour')}:${get('minute')}`;
    } catch {
        return '00:00';
    }
}

/** True once a day's window is over: every past day, and today's after its close time. */
export function isWindowClosed(
    slot: Pick<EngagementSlotDTO, 'endTime'>,
    phase: DayPhase,
    wallNow: string
): boolean {
    if (phase === 'PAST') return true;
    if (phase === 'UPCOMING') return false;
    return wallNow.slice(0, 5) > (slot.endTime ?? '').slice(0, 5);
}

/**
 * The expanded plan: its days grouped into Past (collapsed), Today (highlighted) and
 * Upcoming (the next two open, the rest behind "Show more"). Each task row reads
 * "1 / 2 learners" with a bar, and opens that task's tracking.
 */
export function PlanDaySchedule({
    plan,
    onOpenItem,
    now,
}: {
    /** The plan with its slots (GET /plan/{id}). */
    plan: EngagementPlanDTO;
    onOpenItem: (item: EngagementItemDTO) => void;
    /** Test seam for "now". */
    now?: Date;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const uid = useId();
    const timeZone = plan.timezone || instituteTimeZone();
    const today = plan.today || todayInZone(timeZone, now);
    const wallNow = wallClockInZone(timeZone, now);
    const slots = plan.slots;
    // A join-based plan has no shared "today": every learner is on their own day.
    const relative = plan.scheduleMode === 'RELATIVE';
    const groups = useMemo(() => groupSlotsByPhase(slots ?? [], today), [slots, today]);
    const [pastOpen, setPastOpen] = useState(false);
    const [showAllUpcoming, setShowAllUpcoming] = useState(false);

    if (!slots || slots.length === 0) {
        return <p className="text-body text-neutral-600">{t('card.noSlots')}</p>;
    }

    const pastAvg = averageRate(groups.past, plan);
    const visibleUpcoming = showAllUpcoming
        ? groups.upcoming
        : groups.upcoming.slice(0, UPCOMING_VISIBLE);
    const hiddenUpcoming = groups.upcoming.length - visibleUpcoming.length;
    const zone = normalizeTimezone(timeZone);
    const showZone = zone !== getBrowserTimezoneOrUndefined();
    const pastId = `${uid}-past`;

    const renderDay = (slot: EngagementSlotDTO, phase: DayPhase) => (
        <DayBlock
            key={slot.id}
            slot={slot}
            phase={phase}
            plan={plan}
            closed={!relative && isWindowClosed(slot, phase, wallNow)}
            onOpenItem={onOpenItem}
        />
    );

    if (relative) {
        return (
            <div className="space-y-4">
                <p className="text-caption text-neutral-600">{t('composer.relative.cardHint')}</p>
                {[...slots].sort(bySchedule).map((slot) => renderDay(slot, 'UPCOMING'))}
                {showZone && (
                    <p className="text-caption text-neutral-600">
                        {t('composer.schedule.timezone', { zone })}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {groups.past.length > 0 && (
                <section className="rounded-md border border-neutral-200">
                    <button
                        type="button"
                        onClick={() => setPastOpen((v) => !v)}
                        aria-expanded={pastOpen}
                        aria-controls={pastId}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-body text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                    >
                        <CaretDown
                            size={16}
                            aria-hidden
                            className={cn(
                                'shrink-0 text-neutral-600 transition-transform',
                                !pastOpen && '-rotate-90 rtl:rotate-90'
                            )}
                        />
                        <span className="font-semibold">
                            {t('daySchedule.past', { count: groups.past.length })}
                        </span>
                        {pastAvg !== null && (
                            <span className="text-neutral-600">
                                ·{' '}
                                {t('daySchedule.average', {
                                    percent: formatPercent(pastAvg, lang),
                                })}
                            </span>
                        )}
                    </button>
                    {pastOpen && (
                        <div id={pastId} className="space-y-4 border-t border-neutral-100 p-3">
                            {groups.past.map((slot) => renderDay(slot, 'PAST'))}
                        </div>
                    )}
                </section>
            )}

            {groups.today.map((slot) => renderDay(slot, 'TODAY'))}

            {groups.upcoming.length > 0 && (
                <section className="space-y-3">
                    <h4 className="text-caption font-semibold text-neutral-600">
                        {t('daySchedule.upcoming')}
                    </h4>
                    {visibleUpcoming.map((slot) => renderDay(slot, 'UPCOMING'))}
                    {groups.upcoming.length > UPCOMING_VISIBLE && (
                        <button
                            type="button"
                            onClick={() => setShowAllUpcoming((v) => !v)}
                            className="rounded-md text-body font-semibold text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                        >
                            {hiddenUpcoming > 0
                                ? t('daySchedule.showMore', { count: hiddenUpcoming })
                                : t('daySchedule.showLess')}
                        </button>
                    )}
                </section>
            )}

            {showZone && (
                <p className="text-caption text-neutral-600">
                    {t('composer.schedule.timezone', { zone })}
                </p>
            )}
        </div>
    );
}

function DayBlock({
    slot,
    phase,
    plan,
    closed,
    onOpenItem,
}: {
    slot: EngagementSlotDTO;
    phase: DayPhase;
    plan: EngagementPlanDTO;
    closed: boolean;
    onOpenItem: (item: EngagementItemDTO) => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const isToday = phase === 'TODAY';
    const last = slotLastDate(slot);
    const repeats = last !== slot.startDate;
    const firstDay = plan.scheduleMode === 'RELATIVE' ? relativeDayOf(slot.startDate) : null;
    const lastDay = firstDay != null ? relativeDayOf(last) ?? firstDay : null;
    const dates =
        firstDay != null && lastDay != null
            ? lastDay > firstDay
                ? t('composer.relative.dayRange', { from: firstDay, to: lastDay })
                : t('composer.relative.day', { n: firstDay })
            : repeats
              ? [formatDayRange(slot.startDate, last, lang), formatWeekdays(slot.dowMask, lang)]
                    .filter(Boolean)
                    .join(' · ')
              : formatDay(slot.startDate, lang);
    const theme = slot.title?.trim();
    const headerParts = [
        theme,
        t('daySchedule.open', { window: formatTimeRange(slot.startTime, slot.endTime, lang) }),
        slot.revealTime
            ? t('daySchedule.answers', { time: formatTime(slot.revealTime, lang) })
            : null,
    ].filter(Boolean);
    const items = [...slot.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    return (
        <section
            className={cn(
                'space-y-2 rounded-md',
                isToday && 'border border-primary-200 bg-primary-50 p-3'
            )}
        >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {isToday && (
                    <span className="rounded-md bg-primary-500 px-2 py-0.5 text-caption font-semibold text-neutral-50">
                        {t('daySchedule.today')}
                    </span>
                )}
                <h4 className="flex items-center gap-1.5 text-body font-semibold text-neutral-900">
                    {!isToday && (
                        <CalendarBlank size={14} aria-hidden className="text-neutral-600" />
                    )}
                    {dates}
                </h4>
                <p className="min-w-0 text-caption text-neutral-600">{headerParts.join(' · ')}</p>
            </div>
            {items.length === 0 ? (
                <p className="text-body text-neutral-600">{t('card.noTasks')}</p>
            ) : (
                <ul className="space-y-2">
                    {items.map((item) => (
                        <li key={item.id}>
                            <TaskRow
                                item={item}
                                learners={learnersFor(item, slot, plan)}
                                phase={phase}
                                closed={closed}
                                onOpen={() => onOpenItem(item)}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function TaskRow({
    item,
    learners,
    phase,
    closed,
    onOpen,
}: {
    item: EngagementItemDTO;
    learners: number | null;
    phase: DayPhase;
    closed: boolean;
    onOpen: () => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const meta = typeMeta(item.itemType);
    const Icon = meta.icon;
    const done = item.completedCount ?? 0;
    const rate = completionRate(done, learners);
    const low = closed && rate !== null && rate < LOW_RATE;
    const title = item.title?.trim() || t('preview.untitled');
    const typeLine = [
        t(meta.labelKey),
        item.itemType === 'FLASHCARDS' && item.maxScore
            ? t('daySchedule.cards', { count: item.maxScore })
            : null,
        item.isRequired ? t('daySchedule.required') : null,
    ]
        .filter(Boolean)
        .join(' · ');
    // Nobody can have done a day that hasn't opened, so it shows no bar.
    const showProgress = phase !== 'UPCOMING' || done > 0;

    return (
        <button
            type="button"
            onClick={onOpen}
            className="flex w-full flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 text-start transition-colors hover:border-neutral-300 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:flex-row sm:items-center sm:gap-4"
        >
            <span className="flex min-w-0 flex-1 items-center gap-3">
                <span
                    className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-md',
                        meta.accent.soft
                    )}
                    aria-hidden
                >
                    <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-neutral-900">
                        {title}
                    </span>
                    <span className="block truncate text-caption text-neutral-600">{typeLine}</span>
                </span>
            </span>
            {showProgress ? (
                learners !== null ? (
                    <span className="flex w-full shrink-0 items-center gap-3 sm:w-56">
                        <span
                            aria-hidden
                            className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100"
                        >
                            <span
                                className={cn(
                                    'block h-full rounded-full',
                                    low ? 'bg-warning-500' : 'bg-success-500'
                                )}
                                style={{ width: `${Math.round((rate ?? 0) * 100)}%` }} // design-lint-ignore: dynamic completion width
                            />
                        </span>
                        <span
                            className={cn(
                                'shrink-0 whitespace-nowrap text-caption tabular-nums',
                                low ? 'font-semibold text-warning-700' : 'text-neutral-600'
                            )}
                        >
                            {t('daySchedule.learners', {
                                count: learners,
                                done: formatFraction(Math.min(done, learners), learners, lang),
                            })}
                        </span>
                    </span>
                ) : (
                    <span className="shrink-0 text-caption text-neutral-600">
                        {t('card.completed', { count: done })}
                    </span>
                )
            ) : (
                <span className="shrink-0 text-caption text-neutral-600">
                    {t('daySchedule.notOpen')}
                </span>
            )}
        </button>
    );
}
