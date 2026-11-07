import { useEffect, useMemo, useState } from 'react';
import { MeetingsWeekCounts } from '../-components/MeetingsWeekCounts';
import { createLazyFileRoute } from '@tanstack/react-router';
import { addWeeks } from 'date-fns';
import { useTranslation } from 'react-i18next';
import {
    CalendarCheck,
    CaretUpDown,
    Check,
    CheckCircle,
    Clock,
    FunnelSimple,
    Hourglass,
    UserCircle,
    UsersThree,
    WarningCircle,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { StatStrip, type StatItem } from '@/components/shared/crm-enhance';
import { Meter } from '@/routes/dashboard/-components/crm/crm-cards';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { useMeetingsScope, useTeamCalendar } from '../-hooks/use-meetings';
import { toIsoWithOffset } from '../-utils/meetings-utils';
import { MeetingsList } from '../-components/meetings-list';
import { WeekNavigator, weekBoundsFor } from '../-components/week-navigator';
import {
    ActiveFilterChip,
    MEETING_STATUS_KEY,
    MeetingsPageHeader,
    SideCard,
    bookedMinutes,
    splitMinutes,
} from '../-components/meetings-page-parts';

export const Route = createLazyFileRoute('/meetings/team/')({
    component: TeamMeetingsRoute,
});

const ALL_HOSTS_VALUE = '__ALL_HOSTS__';
const MAX_HOST_BARS = 8;

function TeamMeetingsRoute() {
    return (
        <LayoutContainer>
            <TeamMeetingsPage />
        </LayoutContainer>
    );
}

function TeamMeetingsPage() {
    const { t } = useTranslation('meetingsTeamIndexLazy');
    const { t: tStatus } = useTranslation('meetingsMeetingsList');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);

    const instituteId = getInstituteId();
    const [weekAnchor, setWeekAnchor] = useState(() => new Date());
    const [hostFilter, setHostFilter] = useState(ALL_HOSTS_VALUE);
    // Status quick-view filter — client-side on the week already loaded.
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const { start } = weekBoundsFor(weekAnchor);

    // Host options derive from the visible week's bookings — a filter carried
    // across navigation could point at a host with no rows and strand the page.
    const handleWeekChange = (anchor: Date) => {
        setWeekAnchor(anchor);
        setHostFilter(ALL_HOSTS_VALUE);
    };

    const { data: scope, isLoading: scopeLoading, error: scopeError } = useMeetingsScope(instituteId);
    const canViewTeam = !!scope && (scope.is_admin || scope.is_team_manager);

    // Exact local week window as ISO offset datetimes: start = local week
    // start 00:00, end = exclusive next week start 00:00.
    const {
        data: bookings,
        isLoading,
        error,
    } = useTeamCalendar(
        instituteId,
        toIsoWithOffset(start),
        toIsoWithOffset(addWeeks(start, 1)),
        canViewTeam
    );

    // Host filter options built from the distinct hosts in the current result.
    const hostOptions = useMemo(() => {
        const byId = new Map<string, string>();
        for (const booking of bookings ?? []) {
            if (booking.host_user_id) {
                byId.set(booking.host_user_id, booking.host_name || t('unknownHost'));
            }
        }
        return [...byId.entries()].map(([id, name]) => ({ id, name }));
    }, [bookings, t]);

    const filteredBookings = useMemo(() => {
        const all = bookings ?? [];
        if (hostFilter === ALL_HOSTS_VALUE) return all;
        return all.filter((booking) => booking.host_user_id === hostFilter);
    }, [bookings, hostFilter]);

    // Status filter applies on top of the host filter, to the list only.
    const listBookings = useMemo(
        () =>
            statusFilter
                ? filteredBookings.filter((booking) => booking.status === statusFilter)
                : filteredBookings,
        [filteredBookings, statusFilter]
    );

    // Meetings per host this week (all hosts — the breakdown ignores the host filter).
    const hostCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const booking of bookings ?? []) {
            if (booking.host_user_id) {
                counts.set(booking.host_user_id, (counts.get(booking.host_user_id) ?? 0) + 1);
            }
        }
        return counts;
    }, [bookings]);

    if (scopeLoading) {
        return (
            <div className="flex min-h-60 items-center justify-center">
                <DashboardLoader />
            </div>
        );
    }

    if (!scopeError && !canViewTeam) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white py-16 text-center">
                <UsersThree className="size-10 text-neutral-300" />
                <p className="text-body font-semibold text-neutral-700">{t('noTeamTitle')}</p>
                <p className="max-w-md text-caption text-neutral-500">{t('noTeamDescription')}</p>
            </div>
        );
    }

    const failed = !!(scopeError ?? error);
    const loaded = !!bookings && !failed;
    const pendingCount = filteredBookings.filter((b) => b.status === 'PENDING').length;
    const noShowCount = filteredBookings.filter((b) => b.status === 'NO_SHOW').length;
    const { hours, minutes } = splitMinutes(bookedMinutes(filteredBookings));
    const onCallsLabel =
        hours === 0
            ? t('durationMinutes', { minutes })
            : minutes === 0
              ? t('durationHours', { hours })
              : t('durationHoursMinutes', { hours, minutes });

    const kpis: StatItem[] = [
        {
            key: 'week',
            label: t('kpi.thisWeek'),
            value: loaded ? filteredBookings.length : undefined,
            detail: loaded ? t('kpi.hosts', { count: hostOptions.length }) : undefined,
            icon: CalendarCheck,
            tint: 'primary',
            loading: isLoading,
        },
        {
            key: 'hours',
            label: t('kpi.onCalls'),
            value: loaded ? onCallsLabel : undefined,
            detail: t('kpi.onCallsDetail'),
            icon: Clock,
            tint: 'info',
            loading: isLoading,
        },
        {
            key: 'pending',
            label: t('kpi.pending'),
            value: loaded ? pendingCount : undefined,
            detail: t('kpi.pendingDetail'),
            icon: Hourglass,
            tint: 'warning',
            loading: isLoading,
        },
    ];

    const hostRows = hostOptions
        .map((host) => ({ ...host, count: hostCounts.get(host.id) ?? 0 }))
        .sort((a, b) => b.count - a.count);
    const maxHostCount = Math.max(1, ...hostRows.map((row) => row.count));

    const statusFilterLabel = statusFilter
        ? tStatus(MEETING_STATUS_KEY[statusFilter] ?? statusFilter, statusFilter)
        : '';
    // The week has meetings, just none with the chosen status.
    const filteredOut = !!statusFilter && filteredBookings.length > 0 && listBookings.length === 0;

    const attention: Array<{
        key: string;
        tone: 'warning' | 'danger';
        title: string;
        text: string;
        status: string;
    }> = [];
    if (pendingCount > 0) {
        attention.push({
            key: 'pending',
            tone: 'warning',
            title: t('attention.pendingTitle', { count: pendingCount }),
            text: t('attention.pendingText'),
            status: 'PENDING',
        });
    }
    if (noShowCount > 0) {
        attention.push({
            key: 'noShow',
            tone: 'danger',
            title: t('attention.noShowTitle', { count: noShowCount }),
            text: t('attention.noShowText'),
            status: 'NO_SHOW',
        });
    }

    const teamSize = scope && !scope.is_admin ? scope.team_user_ids.length : 0;

    return (
        <div className="flex w-full flex-col gap-4">
            <MeetingsPageHeader
                icon={UsersThree}
                title={t('heading')}
                subtitle={t('subtitle')}
                badge={
                    teamSize > 0 ? (
                        <span className="rounded-full bg-info-50 px-2.5 py-0.5 text-caption font-medium text-info-600">
                            {t('teamBadge', { count: teamSize })}
                        </span>
                    ) : undefined
                }
                actions={
                    hostOptions.length > 0 ? (
                        <HostFilter
                            options={hostOptions}
                            value={hostFilter}
                            onChange={setHostFilter}
                        />
                    ) : undefined
                }
            />

            {!failed && <StatStrip items={kpis} />}

            <MeetingsWeekCounts
                bookings={canViewTeam ? filteredBookings : undefined}
                active={statusFilter}
                onSelect={(next) => setStatusFilter((prev) => (prev === next ? null : next))}
            />

            <div className="flex flex-wrap items-center gap-2">
                <WeekNavigator weekStart={start} onChange={handleWeekChange} />
                {statusFilter && (
                    <ActiveFilterChip
                        label={t('showingStatus', { status: statusFilterLabel })}
                        clearLabel={t('clearFilter')}
                        onClear={() => setStatusFilter(null)}
                    />
                )}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                    <MeetingsList
                        bookings={listBookings}
                        isLoading={isLoading}
                        error={scopeError ?? error}
                        showHost
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
                            ) : undefined
                        }
                    />
                </div>

                {!failed && (
                    <div className="flex min-w-0 flex-col gap-4">
                        <SideCard
                            icon={UserCircle}
                            title={t('byHost.title')}
                            subtitle={t('byHost.subtitle')}
                            footer={t('byHost.footer')}
                        >
                            {isLoading ? (
                                <div className="flex flex-col gap-2">
                                    <Skeleton className="h-6 w-full" />
                                    <Skeleton className="h-6 w-full" />
                                    <Skeleton className="h-6 w-full" />
                                </div>
                            ) : hostRows.length === 0 ? (
                                <p className="text-caption text-neutral-500">{t('byHost.empty')}</p>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    {hostRows.slice(0, MAX_HOST_BARS).map((row) => {
                                        const selected = hostFilter === row.id;
                                        return (
                                            <button
                                                key={row.id}
                                                type="button"
                                                onClick={() =>
                                                    setHostFilter(
                                                        selected ? ALL_HOSTS_VALUE : row.id
                                                    )
                                                }
                                                title={t('byHost.rowTitle', { name: row.name })}
                                                className={cn(
                                                    'flex flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors',
                                                    selected
                                                        ? 'bg-primary-50'
                                                        : 'hover:bg-neutral-50'
                                                )}
                                            >
                                                <span className="flex items-center justify-between gap-2 text-caption">
                                                    <span
                                                        className={cn(
                                                            'truncate font-medium',
                                                            selected
                                                                ? 'text-primary-600'
                                                                : 'text-neutral-700'
                                                        )}
                                                    >
                                                        {row.name}
                                                    </span>
                                                    <span className="shrink-0 font-semibold tabular-nums text-neutral-800">
                                                        {row.count}
                                                    </span>
                                                </span>
                                                <Meter
                                                    value={row.count}
                                                    max={maxHostCount}
                                                    tone="primary"
                                                />
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </SideCard>

                        <SideCard icon={WarningCircle} title={t('attention.title')}>
                            {isLoading ? (
                                <Skeleton className="h-12 w-full" />
                            ) : attention.length === 0 ? (
                                <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                                    <CheckCircle size={14} className="shrink-0 text-success-600" />
                                    {t('attention.allClear')}
                                </p>
                            ) : (
                                <div className="flex flex-col divide-y divide-neutral-100">
                                    {attention.map((item) => (
                                        <div
                                            key={item.key}
                                            className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                                        >
                                            <span
                                                className={cn(
                                                    'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                                    item.tone === 'danger'
                                                        ? 'bg-danger-50 text-danger-600'
                                                        : 'bg-warning-50 text-warning-600'
                                                )}
                                            >
                                                <WarningCircle size={16} weight="duotone" />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-caption font-semibold text-neutral-900">
                                                    {item.title}
                                                </span>
                                                <span className="block truncate text-caption text-neutral-500">
                                                    {item.text}
                                                </span>
                                            </span>
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="small"
                                                className="shrink-0 sm:min-w-0"
                                                onClick={() => setStatusFilter(item.status)}
                                            >
                                                {t('attention.show')}
                                            </MyButton>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </SideCard>
                    </div>
                )}
            </div>
        </div>
    );
}

/** Searchable host filter — type to find a host instead of scrolling a long dropdown. */
function HostFilter({
    options,
    value,
    onChange,
}: {
    options: { id: string; name: string }[];
    value: string;
    onChange: (next: string) => void;
}) {
    const { t } = useTranslation('meetingsTeamIndexLazy');
    const [open, setOpen] = useState(false);
    const allHostsLabel = t('allHosts', { count: options.length });
    const selectedLabel =
        value === ALL_HOSTS_VALUE
            ? allHostsLabel
            : (options.find((o) => o.id === value)?.name ?? t('filterByHost'));

    const select = (next: string) => {
        onChange(next);
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="w-full justify-between font-normal sm:w-56 sm:min-w-0"
                    aria-label={t('hostFilterAriaLabel')}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <FunnelSimple size={16} className="shrink-0 text-neutral-400" />
                        <span className="truncate">{selectedLabel}</span>
                    </span>
                    <CaretUpDown size={14} className="shrink-0 text-neutral-400" />
                </MyButton>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="end">
                <Command>
                    <CommandInput placeholder={t('searchHostPlaceholder')} />
                    <CommandList>
                        <CommandEmpty>{t('noHostFound')}</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value={allHostsLabel}
                                onSelect={() => select(ALL_HOSTS_VALUE)}
                                className="gap-2"
                            >
                                <Check
                                    size={14}
                                    className={cn(
                                        value === ALL_HOSTS_VALUE ? 'opacity-100' : 'opacity-0'
                                    )}
                                />
                                {allHostsLabel}
                            </CommandItem>
                            {options.map((host) => (
                                <CommandItem
                                    key={host.id}
                                    value={host.name}
                                    onSelect={() => select(host.id)}
                                    className="gap-2"
                                >
                                    <Check
                                        size={14}
                                        className={cn(
                                            value === host.id ? 'opacity-100' : 'opacity-0'
                                        )}
                                    />
                                    <span className="truncate">{host.name}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
