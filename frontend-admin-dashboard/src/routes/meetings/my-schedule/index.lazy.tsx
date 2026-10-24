import { useEffect, useMemo, useState } from 'react';
import { MeetingsWeekCounts } from '../-components/MeetingsWeekCounts';
import { createLazyFileRoute } from '@tanstack/react-router';
import {
    addDays,
    addWeeks,
    endOfMonth,
    endOfWeek,
    format,
    isSameMonth,
    startOfMonth,
    startOfWeek,
    type Locale,
} from 'date-fns';
import { ar, enUS, fr, hi } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import {
    ArrowRight,
    Browsers,
    CalendarBlank,
    ChartBar,
    ListBullets,
    Plus,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { useMyCalendar } from '../-hooks/use-meetings';
import { parseUtc, toIsoWithOffset } from '../-utils/meetings-utils';
import { MeetingsList } from '../-components/meetings-list';
import { MeetingsCalendar } from '../-components/meetings-calendar';
import { WeekNavigator, weekBoundsFor } from '../-components/week-navigator';
import { CreateBookingDialog } from '../-components/create-booking-dialog';
import { BookingPagesManagerDialog } from '../-components/booking-pages-manager-dialog';
import { MyBookingLinksCard } from '../-components/my-booking-links-card';
import {
    ActiveFilterChip,
    MEETING_STATUS_KEY,
    MeetingsPageHeader,
    SideCard,
    StatTile,
    bookedMinutes,
    isActiveBooking,
    splitMinutes,
} from '../-components/meetings-page-parts';

const DATE_FNS_LOCALES: Record<string, Locale> = { en: enUS, ar, fr, hi };

export const Route = createLazyFileRoute('/meetings/my-schedule/')({
    component: MyScheduleRoute,
});

function MyScheduleRoute() {
    return (
        <LayoutContainer>
            <MySchedulePage />
        </LayoutContainer>
    );
}

type ScheduleView = 'list' | 'calendar';

function MySchedulePage() {
    const { t, i18n } = useTranslation('meetingsMyScheduleIndexLazy');
    const { t: tStatus } = useTranslation('meetingsMeetingsList');
    const dateFnsLocale = DATE_FNS_LOCALES[i18n.language] ?? enUS;
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);

    const instituteId = getInstituteId();
    const [view, setView] = useState<ScheduleView>('list');
    const [weekAnchor, setWeekAnchor] = useState(() => new Date());
    const [monthAnchor, setMonthAnchor] = useState(() => new Date());
    // Status quick-view filter — client-side on the week already loaded (list view only).
    const [statusFilter, setStatusFilter] = useState<string | null>(null);

    const { start: weekStart } = weekBoundsFor(weekAnchor);
    // Month grid window (week-aligned) so the calendar's leading/trailing days have data.
    const gridStart = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 });

    // One fetch, windowed by the active view (both as ISO offset datetimes so
    // boundary meetings land in the right day/week for non-UTC users).
    const windowStart = view === 'calendar' ? gridStart : weekStart;
    const windowEnd = view === 'calendar' ? addDays(gridEnd, 1) : addWeeks(weekStart, 1);
    const {
        data: bookings,
        isLoading,
        error,
    } = useMyCalendar(instituteId, toIsoWithOffset(windowStart), toIsoWithOffset(windowEnd));

    // 60-day lookahead so an empty week can still point at the next meeting
    // instead of dead-ending. Window is frozen on mount to keep the query key stable.
    const [lookaheadWindow] = useState(() => ({
        start: toIsoWithOffset(new Date()),
        end: toIsoWithOffset(addDays(new Date(), 60)),
    }));
    const lookahead = useMyCalendar(instituteId, lookaheadWindow.start, lookaheadWindow.end);
    const nextUpcoming = useMemo(() => {
        const now = Date.now();
        return (lookahead.data ?? [])
            .filter(
                (b) =>
                    b.status !== 'CANCELLED' &&
                    b.status !== 'RESCHEDULED' &&
                    parseUtc(b.scheduled_start_utc).getTime() >= now
            )
            .sort(
                (a, b) =>
                    parseUtc(a.scheduled_start_utc).getTime() -
                    parseUtc(b.scheduled_start_utc).getTime()
            )[0];
    }, [lookahead.data]);

    const listBookings = useMemo(() => {
        const all = bookings ?? [];
        return statusFilter ? all.filter((b) => b.status === statusFilter) : all;
    }, [bookings, statusFilter]);

    // "This week" / "This month" tiles: the calendar window also carries the
    // grid's leading/trailing days, so keep only the month being shown.
    const summaryBookings = useMemo(() => {
        const all = bookings ?? [];
        return view === 'calendar'
            ? all.filter((b) => isSameMonth(parseUtc(b.scheduled_start_utc), monthAnchor))
            : all;
    }, [bookings, view, monthAnchor]);
    const activeCount = summaryBookings.filter(isActiveBooking).length;
    const pendingCount = summaryBookings.filter((b) => b.status === 'PENDING').length;
    const { hours, minutes } = splitMinutes(bookedMinutes(summaryBookings));
    const onCallsLabel =
        hours === 0
            ? t('durationMinutes', { minutes })
            : minutes === 0
              ? t('durationHours', { hours })
              : t('durationHoursMinutes', { hours, minutes });

    const [createOpen, setCreateOpen] = useState(false);
    const [managerOpen, setManagerOpen] = useState(false);

    const filterActive = view === 'list' && !!statusFilter;
    const statusFilterLabel = statusFilter
        ? tStatus(MEETING_STATUS_KEY[statusFilter] ?? statusFilter, statusFilter)
        : '';
    // The week has meetings, just none with the chosen status.
    const filteredOut = filterActive && (bookings?.length ?? 0) > 0 && listBookings.length === 0;

    const viewToggle = (
        <div className="flex items-center gap-0.5 rounded-md border border-neutral-200 bg-white p-0.5">
            <button
                type="button"
                onClick={() => setView('list')}
                className={cn(
                    'flex items-center gap-1 rounded px-2.5 py-1 text-caption font-medium',
                    view === 'list'
                        ? 'bg-primary-50 text-primary-600'
                        : 'text-neutral-500 hover:text-neutral-700'
                )}
            >
                <ListBullets size={14} /> {t('viewList')}
            </button>
            <button
                type="button"
                onClick={() => setView('calendar')}
                className={cn(
                    'flex items-center gap-1 rounded px-2.5 py-1 text-caption font-medium',
                    view === 'calendar'
                        ? 'bg-primary-50 text-primary-600'
                        : 'text-neutral-500 hover:text-neutral-700'
                )}
            >
                <CalendarBlank size={14} /> {t('viewCalendar')}
            </button>
        </div>
    );

    return (
        <div className="flex w-full flex-col gap-4">
            <MeetingsPageHeader
                icon={CalendarBlank}
                title={t('heading')}
                subtitle={t('subtitle')}
                actions={
                    <>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="sm:min-w-0"
                            title={t('bookingPagesTitle')}
                            onClick={() => setManagerOpen(true)}
                        >
                            <Browsers className="mr-1.5 size-4" />
                            {t('bookingPages')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            className="sm:min-w-0"
                            onClick={() => setCreateOpen(true)}
                        >
                            <Plus className="mr-1.5 size-4" />
                            {t('newMeeting')}
                        </MyButton>
                    </>
                }
            />

            {view === 'list' ? (
                <MeetingsWeekCounts
                    bookings={bookings}
                    active={statusFilter}
                    onSelect={(next) => setStatusFilter((prev) => (prev === next ? null : next))}
                />
            ) : (
                <MeetingsWeekCounts bookings={bookings} />
            )}

            {/* Toolbar: week navigator (list) + active filter on the left, view toggle on the right. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    {view === 'list' && (
                        <WeekNavigator weekStart={weekStart} onChange={setWeekAnchor} />
                    )}
                    {filterActive && (
                        <ActiveFilterChip
                            label={t('showingStatus', { status: statusFilterLabel })}
                            clearLabel={t('clearFilter')}
                            onClear={() => setStatusFilter(null)}
                        />
                    )}
                </div>
                {viewToggle}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                    {view === 'list' ? (
                        <MeetingsList
                            bookings={listBookings}
                            isLoading={isLoading}
                            error={error}
                            emptyTitle={
                                filteredOut
                                    ? t('filteredEmptyTitle', { status: statusFilterLabel })
                                    : t('emptyTitle')
                            }
                            emptyDescription={
                                filteredOut ? t('filteredEmptyDescription') : t('emptyDescription')
                            }
                            emptyExtra={
                                filteredOut ? (
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        className="mt-2 sm:min-w-0"
                                        onClick={() => setStatusFilter(null)}
                                    >
                                        {t('showAllMeetings')}
                                    </MyButton>
                                ) : nextUpcoming ? (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setWeekAnchor(
                                                parseUtc(nextUpcoming.scheduled_start_utc)
                                            )
                                        }
                                        className="mt-2 flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-caption text-primary-700 transition-colors hover:bg-primary-100"
                                    >
                                        <span>
                                            {t('nextMeetingLabel')}{' '}
                                            <span className="font-semibold">
                                                {format(
                                                    parseUtc(nextUpcoming.scheduled_start_utc),
                                                    'EEE, d MMM · h:mm a',
                                                    { locale: dateFnsLocale }
                                                )}
                                            </span>
                                            {nextUpcoming.invitee_name
                                                ? ` — ${nextUpcoming.invitee_name}`
                                                : ''}
                                        </span>
                                        <span className="flex items-center gap-1 font-medium">
                                            {t('goToThatWeek')} <ArrowRight size={14} />
                                        </span>
                                    </button>
                                ) : undefined
                            }
                        />
                    ) : (
                        <MeetingsCalendar
                            bookings={bookings ?? []}
                            month={monthAnchor}
                            onMonthChange={setMonthAnchor}
                            isLoading={isLoading}
                        />
                    )}
                </div>

                <div className="flex min-w-0 flex-col gap-4">
                    <MyBookingLinksCard onManage={() => setManagerOpen(true)} />
                    {!error && (
                        <SideCard
                            icon={ChartBar}
                            title={
                                view === 'calendar' ? t('summary.thisMonth') : t('summary.thisWeek')
                            }
                            footer={t('summary.footer')}
                        >
                            {isLoading ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <Skeleton className="h-16 w-full" />
                                    <Skeleton className="h-16 w-full" />
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    <StatTile value={activeCount} label={t('summary.meetings')} />
                                    <StatTile value={onCallsLabel} label={t('summary.onCalls')} />
                                    <StatTile
                                        value={pendingCount}
                                        label={t('summary.toApprove')}
                                        tone={pendingCount > 0 ? 'warning' : 'neutral'}
                                    />
                                </div>
                            )}
                        </SideCard>
                    )}
                </div>
            </div>

            <CreateBookingDialog open={createOpen} onOpenChange={setCreateOpen} />
            <BookingPagesManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
        </div>
    );
}
