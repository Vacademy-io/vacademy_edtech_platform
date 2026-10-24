import { useEffect, useMemo } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
    ArrowsClockwise,
    CalendarCheck,
    CalendarDots,
    CalendarX,
    Link as LinkIcon,
    UsersThree,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { InsightStrip, StatStrip, type Insight } from '@/components/shared/crm-enhance';
import { Meter } from '@/routes/dashboard/-components/crm/crm-cards';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { formatNumber, isoDay } from '@/routes/dashboard/-utils/crm-dashboard';
import { useTeamCalendar } from '../-hooks/use-meetings';
import type { BookingInstanceDTO } from '../-types/meetings-types';

export const Route = createLazyFileRoute('/meetings/dashboard/')({
    component: MeetingsDashboardPage,
});

const shift = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
};

function countBy(
    rows: BookingInstanceDTO[],
    key: (b: BookingInstanceDTO) => string | null | undefined
) {
    const m = new Map<string, number>();
    rows.forEach((b) => {
        const k = key(b);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
    });
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
}

/**
 * Meetings Dashboard: booked, upcoming, cancelled and rescheduled meetings, by host
 * and by booking page. One Team Meetings request (last 30 days + next 14), so it is
 * scoped exactly like Team Meetings: admins see the institute, others their team.
 */
function MeetingsDashboardPage() {
    const { t, i18n } = useTranslation('crmPages');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="font-medium">{t('meetings.title')}</h1>);
    }, [setNavHeading, t]);

    const instituteId = getCurrentInstituteId();
    const { start, end, now, weekAhead, monthAgo } = useMemo(() => {
        const today = new Date();
        return {
            start: isoDay(shift(today, -29)),
            end: isoDay(shift(today, 14)),
            now: today.getTime(),
            weekAhead: shift(today, 7).getTime(),
            monthAgo: shift(today, -29).setHours(0, 0, 0, 0),
        };
    }, []);
    const { data, isLoading } = useTeamCalendar(instituteId, start, end);
    const all = data ?? [];
    const ts = (b: BookingInstanceDTO) => Date.parse(b.scheduled_start_utc);
    const past = all.filter((b) => ts(b) >= monthAgo && ts(b) <= now);
    const booked = past.filter((b) => b.status !== 'CANCELLED');
    const cancelled = past.filter((b) => b.status === 'CANCELLED');
    const rescheduled = past.filter((b) => b.status === 'RESCHEDULED');
    const upcoming = all
        .filter(
            (b) =>
                ts(b) > now &&
                ts(b) <= weekAhead &&
                b.status !== 'CANCELLED' &&
                b.status !== 'RESCHEDULED'
        )
        .sort((a, b) => ts(a) - ts(b));
    const byHost = countBy(booked, (b) => b.host_name);
    const byPage = countBy(booked, (b) => b.booking_page_title);
    const maxHost = Math.max(1, ...byHost.map((x) => x.n));
    const maxPage = Math.max(1, ...byPage.map((x) => x.n));
    const fmtWhen = (iso: string) =>
        new Intl.DateTimeFormat(i18n.language || 'en', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
        }).format(new Date(iso));

    const insights: Insight[] = [];
    if (upcoming[0]) {
        insights.push({
            key: 'next',
            tone: 'info',
            title: t('meetings.insights.next.title', {
                when: fmtWhen(upcoming[0].scheduled_start_utc),
            }),
            text: t('meetings.insights.next.text', {
                name: upcoming[0].invitee_name || '—',
                host: upcoming[0].host_name || '—',
            }),
        });
    }
    if (byHost[0]) {
        insights.push({
            key: 'host',
            tone: 'success',
            title: t('meetings.insights.host.title', { name: byHost[0].label }),
            text: t('meetings.insights.host.text', { total: byHost[0].n }),
        });
    }
    if (byPage[0]) {
        insights.push({
            key: 'page',
            tone: 'success',
            title: t('meetings.insights.page.title', { name: byPage[0].label }),
            text: t('meetings.insights.page.text', { total: byPage[0].n }),
        });
    }
    if (past.length > 0 && cancelled.length / past.length >= 0.2) {
        insights.push({
            key: 'cancel',
            tone: 'warning',
            title: t('meetings.insights.cancel.title', {
                share: `${Math.round((cancelled.length / past.length) * 100)}%`,
            }),
            text: t('meetings.insights.cancel.text'),
        });
    }

    const bars = (rows: Array<{ label: string; n: number }>, max: number) => (
        <div className="space-y-2">
            {rows.slice(0, 8).map((r) => (
                <div key={r.label} className="grid grid-cols-12 items-center gap-3">
                    <span className="col-span-5 truncate text-neutral-700">
                        <span className="text-caption">{r.label}</span>
                    </span>
                    <span className="col-span-6">
                        <Meter value={r.n} max={max} tone="primary" />
                    </span>
                    <span className="col-span-1 text-right font-semibold tabular-nums text-neutral-900">
                        <span className="text-caption">{r.n}</span>
                    </span>
                </div>
            ))}
        </div>
    );

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-5">
                <div>
                    <h1 className="font-semibold text-neutral-900">
                        <span className="text-h2">{t('meetings.title')}</span>
                    </h1>
                    <p className="text-neutral-500">
                        <span className="text-body">{t('meetings.subtitle')}</span>
                    </p>
                </div>
                <StatStrip
                    items={[
                        {
                            key: 'booked',
                            icon: CalendarCheck,
                            label: t('meetings.stats.booked'),
                            value: booked.length,
                            detail: t('meetings.stats.bookedDetail'),
                            href: '/meetings/team',
                            loading: isLoading,
                        },
                        {
                            key: 'upcoming',
                            icon: CalendarDots,
                            tint: 'info',
                            label: t('meetings.stats.upcoming'),
                            value: upcoming.length,
                            detail: t('meetings.stats.upcomingDetail'),
                            href: '/meetings/team',
                            loading: isLoading,
                        },
                        {
                            key: 'cancelled',
                            icon: CalendarX,
                            tint: 'danger',
                            label: t('meetings.stats.cancelled'),
                            value: cancelled.length,
                            detail: t('meetings.stats.bookedDetail'),
                            loading: isLoading,
                        },
                        {
                            key: 'rescheduled',
                            icon: ArrowsClockwise,
                            tint: 'warning',
                            label: t('meetings.stats.rescheduled'),
                            value: rescheduled.length,
                            detail: t('meetings.stats.bookedDetail'),
                            loading: isLoading,
                        },
                    ]}
                />
                <InsightStrip insights={insights} />
                <div className="grid gap-4 xl:grid-cols-2">
                    <SectionCard
                        icon={UsersThree}
                        title={t('meetings.byHost')}
                        subtitle={t('meetings.stats.bookedDetail')}
                    >
                        {byHost.length === 0 ? (
                            <EmptyChart text={t('meetings.empty')} />
                        ) : (
                            bars(byHost, maxHost)
                        )}
                    </SectionCard>
                    <SectionCard
                        icon={LinkIcon}
                        title={t('meetings.byPage')}
                        subtitle={t('meetings.stats.bookedDetail')}
                    >
                        {byPage.length === 0 ? (
                            <EmptyChart text={t('meetings.empty')} />
                        ) : (
                            bars(byPage, maxPage)
                        )}
                    </SectionCard>
                </div>
                <SectionCard
                    icon={CalendarDots}
                    title={t('meetings.next7')}
                    subtitle={t('meetings.next7Subtitle', { total: formatNumber(upcoming.length) })}
                >
                    {upcoming.length === 0 ? (
                        <EmptyChart text={t('meetings.noneUpcoming')} className="h-32" />
                    ) : (
                        <div className="divide-y divide-neutral-100">
                            {upcoming.slice(0, 10).map((b) => (
                                <div key={b.id} className="flex items-center gap-3 py-2.5">
                                    <span className="w-36 shrink-0 font-semibold text-neutral-700">
                                        <span className="text-caption">
                                            {fmtWhen(b.scheduled_start_utc)}
                                        </span>
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium text-neutral-900">
                                            <span className="text-caption">
                                                {b.invitee_name || b.invitee_email || '—'}
                                            </span>
                                        </span>
                                        <span className="block truncate text-neutral-500">
                                            <span className="text-caption">
                                                {b.booking_page_title || '—'}
                                            </span>
                                        </span>
                                    </span>
                                    <span className="shrink-0 text-neutral-600">
                                        <span className="text-caption">{b.host_name || '—'}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </SectionCard>
            </div>
        </LayoutContainer>
    );
}
