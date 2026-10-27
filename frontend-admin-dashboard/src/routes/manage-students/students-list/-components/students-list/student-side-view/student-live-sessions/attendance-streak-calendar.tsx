import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    addMonths,
    endOfMonth,
    endOfWeek,
    format,
    isAfter,
    isBefore,
    startOfMonth,
    startOfWeek,
    subDays,
} from 'date-fns';
import { CalendarBlank, CaretLeft, CaretRight, Fire } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getLearnerLiveSessionsQuery } from '@/services/learner-live-sessions';
import { ProfileSectionCard } from '../profile-ui';
import {
    computeStreaks,
    eachYmd,
    fromYmd,
    summariseByDay,
    toYmd,
    type DayStatus,
    type DaySummary,
} from './live-session-helpers';

/**
 * How far back the streak looks. One request covers the 7-day strip, the streak numbers and the
 * last ~6 months of the calendar; only paging further back than this costs another request.
 */
const STREAK_WINDOW_DAYS = 180;
const COLLAPSED_DAYS = 7;
const WEEK_STARTS_ON = 1; // Monday

const STATUS_STYLE: Record<DayStatus, string> = {
    // Same status steps as the attendance donut, so a colour means one thing across the tab.
    attended: 'bg-success-700 text-white',
    partial: 'bg-warning-400 text-white',
    missed: 'bg-danger-700 text-white',
    unmarked: 'bg-neutral-400 text-white',
};

const STATUS_LABEL: Record<DayStatus, string> = {
    attended: 'Attended',
    partial: 'Attended some',
    missed: 'Missed',
    unmarked: 'Not marked yet',
};

const dayTitle = (date: string, summary?: DaySummary) => {
    const when = format(fromYmd(date), 'EEE, d MMM');
    if (!summary) return `${when} — no class`;
    const n = summary.classes.length;
    return `${when} — ${STATUS_LABEL[summary.status]} (${n} class${n === 1 ? '' : 'es'})`;
};

const DayCell = ({
    date,
    summary,
    muted,
    showWeekday,
    selected,
    onSelect,
}: {
    date: string;
    summary?: DaySummary;
    /** Outside the month being viewed, or in the future. */
    muted?: boolean;
    showWeekday?: boolean;
    selected?: boolean;
    /** Days with a class are clickable — they narrow the class list to that day. */
    onSelect?: (date: string) => void;
}) => {
    const d = fromYmd(date);
    const title = dayTitle(date, summary);
    const clickable = !!summary && !!onSelect;
    const square = cn(
        'flex size-8 items-center justify-center rounded-md text-2xs font-semibold transition-shadow',
        summary ? STATUS_STYLE[summary.status] : 'bg-neutral-50 text-neutral-400',
        muted && 'opacity-40',
        selected && 'ring-2 ring-primary-500 ring-offset-1'
    );
    return (
        <div className="flex flex-col items-center gap-1">
            {showWeekday && (
                <span className="text-2xs font-medium text-muted-foreground">{format(d, 'EEEEE')}</span>
            )}
            {clickable ? (
                <button
                    type="button"
                    onClick={() => onSelect(date)}
                    title={`${title} — click to see these classes`}
                    aria-label={title}
                    aria-pressed={selected}
                    className={cn(
                        square,
                        'hover:ring-2 hover:ring-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'
                    )}
                >
                    {format(d, 'd')}
                </button>
            ) : (
                <span className={square} title={title} aria-label={title}>
                    {format(d, 'd')}
                </span>
            )}
        </div>
    );
};

const Legend = () => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        {(Object.keys(STATUS_STYLE) as DayStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
                <span className={cn('size-2.5 rounded-sm', STATUS_STYLE[s])} />
                {STATUS_LABEL[s]}
            </span>
        ))}
        <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-neutral-50 ring-1 ring-neutral-200" />
            No class
        </span>
    </div>
);

export const AttendanceStreakCalendar = ({
    userId,
    batchId,
    selectedDate,
    onSelectDate,
}: {
    userId: string;
    batchId?: string;
    /** The day the class list is currently narrowed to, if any. */
    selectedDate?: string | null;
    onSelectDate?: (date: string) => void;
}) => {
    const [expanded, setExpanded] = useState(false);
    const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));

    const today = new Date();
    const todayYmd = toYmd(today);
    const windowStart = subDays(today, STREAK_WINDOW_DAYS - 1);

    const windowQuery = useQuery(
        getLearnerLiveSessionsQuery(userId, toYmd(windowStart), todayYmd, batchId)
    );

    // A month (partly) older than the streak window needs its own request.
    const monthStart = viewMonth;
    const monthEnd = endOfMonth(viewMonth);
    const needsMonthFetch = expanded && isBefore(monthStart, windowStart);
    const monthQuery = useQuery({
        ...getLearnerLiveSessionsQuery(userId, toYmd(monthStart), toYmd(monthEnd), batchId),
        enabled: needsMonthFetch && !!userId,
    });

    const windowDays = useMemo(
        () => summariseByDay(windowQuery.data?.classes ?? []),
        [windowQuery.data]
    );
    const monthDays = useMemo(
        () => (needsMonthFetch ? summariseByDay(monthQuery.data?.classes ?? []) : windowDays),
        [needsMonthFetch, monthQuery.data, windowDays]
    );
    const streaks = useMemo(() => computeStreaks(windowDays, todayYmd), [windowDays, todayYmd]);

    const lastWeek = eachYmd(subDays(today, COLLAPSED_DAYS - 1), today);
    const gridDays = eachYmd(
        startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON }),
        endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON })
    );
    const weekdayHeaders = gridDays.slice(0, 7).map((d) => format(fromYmd(d), 'EEEEE'));
    // No paging into future months — there's no attendance there to show.
    const canGoForward = isBefore(viewMonth, startOfMonth(today));
    const monthLoading = needsMonthFetch ? monthQuery.isLoading : windowQuery.isLoading;

    return (
        <ProfileSectionCard
            icon={CalendarBlank}
            heading="Attendance streak"
            action={
                <MyButton
                    buttonType="text"
                    scale="small"
                    onClick={() => {
                        setExpanded((v) => !v);
                        setViewMonth(startOfMonth(new Date()));
                    }}
                    aria-expanded={expanded}
                >
                    {expanded ? 'Less' : 'More'}
                </MyButton>
            }
        >
            {windowQuery.isLoading ? (
                <div className="flex flex-col gap-2 py-1">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-10 w-full" />
                </div>
            ) : windowQuery.isError ? (
                <p className="py-1 text-2xs text-danger-600">Couldn't load attendance.</p>
            ) : (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <span
                            className={cn(
                                'flex size-7 items-center justify-center rounded-md',
                                streaks.current > 0
                                    ? 'bg-warning-50 text-warning-600'
                                    : 'bg-neutral-100 text-neutral-400'
                            )}
                        >
                            <Fire className="size-4" weight="fill" />
                        </span>
                        <div className="min-w-0">
                            <p className="text-caption font-semibold text-card-foreground">
                                {streaks.current} class day{streaks.current === 1 ? '' : 's'} in a row
                            </p>
                            <p className="text-2xs text-muted-foreground">
                                Longest {streaks.longest} in the last {STREAK_WINDOW_DAYS} days
                            </p>
                        </div>
                    </div>

                    {!expanded ? (
                        <div className="grid grid-cols-7 gap-1">
                            {lastWeek.map((d) => (
                                <DayCell
                                    key={d}
                                    date={d}
                                    summary={windowDays.get(d)}
                                    showWeekday
                                    selected={selectedDate === d}
                                    onSelect={onSelectDate}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <button
                                    type="button"
                                    onClick={() => setViewMonth((m) => addMonths(m, -1))}
                                    aria-label="Previous month"
                                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                >
                                    <CaretLeft className="size-4" />
                                </button>
                                <span className="text-caption font-semibold text-card-foreground">
                                    {format(viewMonth, 'MMMM yyyy')}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setViewMonth((m) => addMonths(m, 1))}
                                    disabled={!canGoForward}
                                    aria-label="Next month"
                                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:pointer-events-none disabled:opacity-30"
                                >
                                    <CaretRight className="size-4" />
                                </button>
                            </div>
                            <div className="grid grid-cols-7 gap-1">
                                {weekdayHeaders.map((h, i) => (
                                    <span
                                        key={i}
                                        className="text-center text-2xs font-medium text-muted-foreground"
                                    >
                                        {h}
                                    </span>
                                ))}
                                {monthLoading
                                    ? gridDays.map((d) => (
                                          <Skeleton key={d} className="mx-auto size-8 rounded-md" />
                                      ))
                                    : gridDays.map((d) => {
                                          const date = fromYmd(d);
                                          return (
                                              <DayCell
                                                  key={d}
                                                  date={d}
                                                  summary={monthDays.get(d)}
                                                  muted={
                                                      isBefore(date, monthStart) ||
                                                      isAfter(date, monthEnd) ||
                                                      isAfter(date, today)
                                                  }
                                                  selected={selectedDate === d}
                                                  onSelect={onSelectDate}
                                              />
                                          );
                                      })}
                            </div>
                            {needsMonthFetch && monthQuery.isError && (
                                <p className="text-2xs text-danger-600">Couldn't load this month.</p>
                            )}
                            <Legend />
                        </div>
                    )}
                </div>
            )}
        </ProfileSectionCard>
    );
};
