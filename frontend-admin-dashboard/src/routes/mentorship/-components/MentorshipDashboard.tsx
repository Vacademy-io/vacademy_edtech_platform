import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ArrowRight,
    CalendarBlank,
    CalendarCheck,
    ChartBar,
    CheckCircle,
    Clock,
    Gauge,
    GraduationCap,
    Handshake,
    LinkSimple,
    Star,
    Trophy,
    UserMinus,
    TrayArrowDown,
    WarningCircle,
    XCircle,
    type Icon,
} from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { InsightStrip, StatStrip, type Insight } from '@/components/shared/crm-enhance';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { cn } from '@/lib/utils';
import { useMentorDashboard, useMentorSessions } from '../-hooks/use-mentorship';
import { dayOfMonth, relativeDay, shortMonth, timeOfDay } from '../-utils/format-session-time';
import type { MentorDTO, MentorSessionDTO } from '../-types/mentorship-types';
import { MentorAvatar } from './MentorAvatar';

const isActive = (m: MentorDTO) => (m.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
/** The server's flag wins; without it, a capped mentor at or over the cap is full. */
const isFull = (m: MentorDTO) =>
    m.at_capacity ??
    (m.max_mentees != null &&
        m.max_mentees > 0 &&
        (m.assigned_student_count ?? 0) >= m.max_mentees);
const mentorName = (m: MentorDTO, fallback: string) => m.display_name || m.name || fallback;

/**
 * Admin overview of mentorship: the numbers, what needs attention, how the load is
 * spread, and what's coming up.
 *
 * Deliberately reads from what already exists — the mentorship dashboard endpoint
 * and the sessions list — so it adds a view, not a data path. Every figure on this
 * screen is computed from one of those two; nothing here is decorative filler.
 */
export function MentorshipDashboard({ instituteId }: { instituteId: string | undefined }) {
    const { t } = useTranslation('mentorshipDashboard');
    const { data, isLoading, isError, refetch } = useMentorDashboard(instituteId);
    const upcoming = useMentorSessions(instituteId, { lifecycle: 'UPCOMING' });

    if (isError) {
        return (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-danger-100 bg-danger-50 p-4">
                <div className="flex items-center gap-2">
                    <WarningCircle size={18} weight="fill" className="text-danger-600" />
                    <p className="text-body text-danger-600">{t('loadError')}</p>
                </div>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() => refetch()}
                >
                    {t('retry')}
                </MyButton>
            </div>
        );
    }

    const terms = instituteTerms();
    const mentors = data?.mentors ?? [];
    const rated = mentors.filter((m) => (m.rating_count ?? 0) > 0);
    // Weighted by number of ratings, so one 5-star mentor doesn't outweigh a busy one.
    const ratingCount = rated.reduce((sum, m) => sum + (m.rating_count ?? 0), 0);
    const avgRating =
        rated.length > 0
            ? rated.reduce((sum, m) => sum + (m.average_rating ?? 0) * (m.rating_count ?? 0), 0) /
              ratingCount
            : null;

    const completed = data?.completed_sessions ?? 0;
    const noShows = data?.no_show_sessions ?? 0;
    // Attendance only over sessions whose outcome is known — cancelled and unrecorded
    // sessions say nothing about whether the learner turned up.
    const reviewed = completed + noShows;
    const attendance = reviewed > 0 ? Math.round((completed / reviewed) * 100) : null;
    const fullMentors = mentors.filter(isFull);
    const noBooking = mentors.filter((m) => isActive(m) && !m.booking_page_slug);
    const topRated = [...rated].sort(
        (a, b) =>
            (b.average_rating ?? 0) - (a.average_rating ?? 0) ||
            (b.rating_count ?? 0) - (a.rating_count ?? 0)
    )[0];

    const insights: Insight[] = [];
    if (topRated) {
        insights.push({
            key: 'top',
            tone: 'success',
            title: t('insights.top.title', { name: mentorName(topRated, t('mentorFallback')) }),
            text: t('insights.top.text', {
                rating: (topRated.average_rating ?? 0).toFixed(1),
                count: topRated.rating_count ?? 0,
            }),
            href: `/mentorship/mentors/${topRated.id}`,
        });
    }
    if (noShows > 0 && reviewed > 0) {
        insights.push({
            key: 'noShow',
            tone: 'danger',
            title: t('insights.noShow.title', {
                rate: Math.round((noShows / reviewed) * 100),
            }),
            text: t('insights.noShow.text', {
                count: noShows,
                learners: terms.learners.toLowerCase(),
            }),
            href: '/mentorship/sessions',
        });
    }
    if (fullMentors.length > 0) {
        insights.push({
            key: 'full',
            tone: 'warning',
            title: t('insights.full.title', { count: fullMentors.length }),
            text: t('insights.full.text'),
            href: '/mentorship/mentors',
        });
    }
    if (noBooking.length > 0) {
        insights.push({
            key: 'noBooking',
            tone: 'info',
            title: t('insights.noBooking.title', { count: noBooking.length }),
            text: t('insights.noBooking.text', { learners: terms.learners.toLowerCase() }),
            href: '/mentorship/mentors',
        });
    }

    return (
        <div className="flex flex-col gap-5">
            <MentorshipHero
                loading={isLoading}
                completed={completed}
                upcoming={data?.upcoming_sessions ?? 0}
                awaiting={data?.sessions_awaiting_review ?? 0}
                today={data?.today_sessions ?? null}
                attendance={attendance}
                listed={data?.discoverable_mentors ?? null}
                totalMentors={data?.total_mentors ?? 0}
            />

            <StatStrip
                items={[
                    {
                        key: 'mentees',
                        icon: GraduationCap,
                        label: t('kpi.studentsMentored.label'),
                        value: data?.distinct_mentees,
                        detail: t('kpi.studentsMentored.detail', {
                            count: data?.total_active_assignments ?? 0,
                            mentors: data?.total_mentors ?? 0,
                        }),
                        href: '/mentorship/mentors',
                        loading: isLoading,
                    },
                    {
                        key: 'ahead',
                        icon: CalendarBlank,
                        tint: 'info',
                        label: t('kpi.sessionsAhead.label'),
                        value: data?.upcoming_sessions,
                        detail: t('kpi.sessionsAhead.hint'),
                        href: '/mentorship/sessions',
                        loading: isLoading,
                    },
                    {
                        key: 'rating',
                        icon: Star,
                        tint: 'warning',
                        label: t('kpi.averageRating.label'),
                        value: avgRating == null ? '—' : avgRating.toFixed(1),
                        detail:
                            rated.length > 0
                                ? t('kpi.averageRating.detailRated', {
                                      count: rated.length,
                                      ratings: ratingCount,
                                  })
                                : t('kpi.averageRating.hintNone'),
                        loading: isLoading,
                    },
                    {
                        key: 'requests',
                        icon: TrayArrowDown,
                        tint: (data?.pending_requests ?? 0) > 0 ? 'danger' : 'success',
                        label: t('kpi.requests.label'),
                        value: data?.pending_requests ?? 0,
                        detail: t('kpi.requests.detail'),
                        href: '/mentorship/requests',
                        loading: isLoading,
                    },
                ]}
            />

            {!isLoading && <InsightStrip insights={insights} />}

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
                <OutcomesCard data={data} loading={isLoading} className="lg:col-span-3" />
                <WorkloadCard
                    mentors={mentors}
                    sessions={upcoming.data ?? []}
                    loading={isLoading}
                    className="lg:col-span-2"
                />
            </div>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <UpcomingCard sessions={upcoming.data ?? []} loading={upcoming.isLoading} />
                <AttentionCard
                    pendingRequests={data?.pending_requests ?? 0}
                    awaitingReview={data?.sessions_awaiting_review ?? 0}
                    fullMentors={fullMentors.length}
                    noBooking={noBooking.length}
                    loading={isLoading}
                />
                <TopMentorsCard mentors={rated} loading={isLoading} />
            </div>
        </div>
    );
}

/**
 * The headline: sessions delivered, with the few numbers that explain it. All-time,
 * because that is what the dashboard endpoint reports — no invented trend line.
 */
function MentorshipHero({
    loading,
    completed,
    upcoming,
    awaiting,
    today,
    attendance,
    listed,
    totalMentors,
}: {
    loading: boolean;
    completed: number;
    upcoming: number;
    awaiting: number;
    today: number | null;
    attendance: number | null;
    listed: number | null;
    totalMentors: number;
}) {
    const { t } = useTranslation('mentorshipDashboard');
    const tiles: Array<{ key: string; icon: Icon; label: string; value: string }> = [
        {
            key: 'today',
            icon: CalendarCheck,
            label: t('hero.today'),
            value: today == null ? '—' : String(today),
        },
        {
            key: 'attendance',
            icon: CheckCircle,
            label: t('hero.attendance'),
            value: attendance == null ? '—' : `${attendance}%`,
        },
        {
            key: 'listed',
            icon: Handshake,
            label: t('hero.listed'),
            value: listed == null ? '—' : `${listed} / ${totalMentors}`,
        },
    ];
    return (
        <Card className="overflow-hidden rounded-xl border-primary-100 bg-gradient-to-br from-primary-50 via-white to-white p-5 shadow-sm">
            <div className="grid gap-5 lg:grid-cols-12 lg:items-center">
                <div className="min-w-0 lg:col-span-6">
                    <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-primary-600">
                        <Handshake size={14} weight="fill" />
                        <span className="text-caption">{t('hero.eyebrow')}</span>
                    </div>
                    {loading ? (
                        <Skeleton className="mt-2 h-10 w-40" />
                    ) : (
                        <div className="mt-2 flex flex-wrap items-baseline gap-2">
                            <span className="text-h1 font-bold tabular-nums text-neutral-900">
                                {completed.toLocaleString('en-IN')}
                            </span>
                            <span className="text-body text-neutral-500">{t('hero.unit')}</span>
                        </div>
                    )}
                    <p className="mt-2 text-body text-neutral-600">
                        {t('hero.sub', { upcoming, awaiting })}
                    </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:col-span-6">
                    {tiles.map((x) => (
                        <div
                            key={x.key}
                            className="flex min-w-0 flex-col gap-1 rounded-lg border border-neutral-200 bg-white px-4 py-3"
                        >
                            <span className="flex items-center gap-1.5 text-caption text-neutral-500">
                                <x.icon size={14} weight="duotone" className="text-primary-500" />
                                <span className="truncate">{x.label}</span>
                            </span>
                            {loading ? (
                                <Skeleton className="h-7 w-12" />
                            ) : (
                                <span className="text-h3 font-semibold tabular-nums text-neutral-900">
                                    {x.value}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}

/** Status slices. Colour is never the only cue — every slice is labelled and counted. */
const buildOutcomes = (t: TFunction) =>
    [
        {
            key: 'completed',
            label: t('outcomes.completed'),
            icon: CheckCircle,
            bar: 'bg-success-500',
            dot: 'text-success-500',
        },
        {
            key: 'noShow',
            label: t('outcomes.noShows'),
            icon: UserMinus,
            bar: 'bg-danger-500',
            dot: 'text-danger-500',
        },
        {
            key: 'cancelled',
            label: t('outcomes.cancelled'),
            icon: XCircle,
            bar: 'bg-neutral-400',
            dot: 'text-neutral-400',
        },
        {
            key: 'awaiting',
            label: t('outcomes.awaitingReview'),
            icon: Clock,
            bar: 'bg-warning-500',
            dot: 'text-warning-500',
        },
    ] as const;

function OutcomesCard({
    data,
    loading,
    className,
}: {
    data?: {
        completed_sessions?: number;
        no_show_sessions?: number;
        cancelled_sessions?: number;
        sessions_awaiting_review?: number;
    } | null;
    loading: boolean;
    className?: string;
}) {
    const { t } = useTranslation('mentorshipDashboard');
    const OUTCOMES = buildOutcomes(t);
    const counts: Record<string, number> = {
        completed: data?.completed_sessions ?? 0,
        noShow: data?.no_show_sessions ?? 0,
        cancelled: data?.cancelled_sessions ?? 0,
        awaiting: data?.sessions_awaiting_review ?? 0,
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    return (
        <SectionCard
            icon={ChartBar}
            title={t('outcomes.cardTitle')}
            subtitle={t('outcomes.cardSubtitle')}
            to="/mentorship/sessions"
            linkLabel={t('viewAllSessions')}
            className={className}
        >
            {loading ? (
                <Skeleton className="h-24 w-full" />
            ) : total === 0 ? (
                <p className="py-4 text-caption text-neutral-400">{t('outcomes.empty')}</p>
            ) : (
                <>
                    <div className="flex items-baseline gap-2">
                        <span className="text-h2 font-semibold tabular-nums text-neutral-900">
                            {total.toLocaleString('en-IN')}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {t('outcomes.totalLabel')}
                        </span>
                    </div>
                    {/* One stacked bar, 2px gaps so segments stay separable without borders. */}
                    <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-neutral-100">
                        {OUTCOMES.filter((o) => counts[o.key]! > 0).map((o) => (
                            <div
                                key={o.key}
                                className={cn('h-full', o.bar)}
                                // Width is a data proportion — the one thing Tailwind
                                // cannot express as a token.
                                style={{ width: `${(counts[o.key]! / total) * 100}%` }}
                            />
                        ))}
                    </div>
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {OUTCOMES.map((o) => {
                            const OutcomeIcon = o.icon;
                            const count = counts[o.key] ?? 0;
                            return (
                                <li
                                    key={o.key}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2"
                                >
                                    <span className="flex items-center gap-1.5 text-caption text-neutral-600">
                                        <OutcomeIcon size={13} weight="fill" className={o.dot} />
                                        {o.label}
                                    </span>
                                    <span className="text-caption tabular-nums text-neutral-500">
                                        <b className="font-medium text-neutral-700">{count}</b>{' '}
                                        <span className="text-neutral-400">
                                            ({Math.round((count / total) * 100)}%)
                                        </span>
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </SectionCard>
    );
}

/**
 * Who is carrying the load. A meter per mentor rather than a separate chart — with
 * a handful of mentors an inline bar reads faster and costs no chrome.
 */
function WorkloadCard({
    mentors,
    sessions,
    loading,
    className,
}: {
    mentors: MentorDTO[];
    sessions: MentorSessionDTO[];
    loading: boolean;
    className?: string;
}) {
    const { t } = useTranslation('mentorshipDashboard');
    // Upcoming load per mentor, straight off the sessions already fetched for
    // "Coming up" — no extra request, and it's what "busy" actually means.
    const upcomingByMentor = sessions.reduce<Record<string, number>>((acc, s) => {
        if (s.mentor_id) acc[s.mentor_id] = (acc[s.mentor_id] ?? 0) + 1;
        return acc;
    }, {});

    const busiest = [...mentors]
        .sort((a, b) => (b.assigned_student_count ?? 0) - (a.assigned_student_count ?? 0))
        .slice(0, 5);
    const peak = Math.max(1, ...busiest.map((m) => m.assigned_student_count ?? 0));

    return (
        <SectionCard
            icon={Gauge}
            title={t('workload.cardTitle')}
            subtitle={t('workload.cardSubtitle')}
            to="/mentorship/mentors"
            linkLabel={t('viewAllMentors')}
            className={className}
        >
            {loading ? (
                <Skeleton className="h-24 w-full" />
            ) : busiest.length === 0 ? (
                <p className="py-4 text-caption text-neutral-400">{t('workload.empty')}</p>
            ) : (
                <ul className="flex flex-col gap-3">
                    {busiest.map((m) => {
                        const count = m.assigned_student_count ?? 0;
                        const cap = m.max_mentees ?? null;
                        const full = cap != null && count >= cap;
                        const near = !full && cap != null && cap > 0 && count / cap >= 0.8;
                        const ahead = upcomingByMentor[m.id] ?? 0;
                        return (
                            <li key={m.id} className="flex items-center gap-3">
                                <MentorAvatar
                                    fileId={m.profile_image_file_id}
                                    name={m.display_name || m.name}
                                    className="size-8 shrink-0 text-caption"
                                />
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-caption font-medium text-neutral-700">
                                            {m.display_name || m.name || t('mentorFallback')}
                                        </span>
                                        <span
                                            className={cn(
                                                'shrink-0 text-caption tabular-nums',
                                                full ? 'text-danger-600' : 'text-neutral-500'
                                            )}
                                        >
                                            {t('workload.countOfCap', {
                                                count,
                                                cap: cap ?? '∞',
                                            })}
                                            {full ? t('workload.fullSuffix') : ''}
                                        </span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                                        <div
                                            className={cn(
                                                'h-full rounded-full',
                                                full
                                                    ? 'bg-danger-500'
                                                    : near
                                                      ? 'bg-warning-500'
                                                      : cap
                                                        ? 'bg-success-500'
                                                        : 'bg-primary-300'
                                            )}
                                            // Data-driven width. With a cap this is a true
                                            // fill; without one it is only relative to the
                                            // busiest mentor, so it tops out at 80% — a full
                                            // bar would imply a limit that doesn't exist.
                                            style={{
                                                width: cap
                                                    ? `${Math.max(2, Math.min(100, (count / cap) * 100))}%`
                                                    : `${Math.max(2, (count / peak) * 80)}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="text-caption text-neutral-400">
                                        {m.title || t('mentorFallback')} ·{' '}
                                        {ahead === 0
                                            ? t('workload.noUpcoming')
                                            : t('workload.upcomingCount', { count: ahead })}
                                    </span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </SectionCard>
    );
}

/**
 * The only card that asks the admin to do something. It stays on screen when there
 * is nothing to do — an empty slot in a fixed grid reads as broken, and "all clear"
 * is itself worth knowing.
 */
function AttentionCard({
    pendingRequests,
    awaitingReview,
    fullMentors,
    noBooking,
    loading,
}: {
    pendingRequests: number;
    awaitingReview: number;
    fullMentors: number;
    noBooking: number;
    loading: boolean;
}) {
    const { t } = useTranslation('mentorshipDashboard');
    const terms = instituteTerms();
    const items = [
        {
            key: 'requests',
            icon: TrayArrowDown,
            tone: 'danger' as const,
            count: pendingRequests,
            title: t('attention.requestsTitle'),
            detail: t('attention.requestsDetail', { count: pendingRequests }),
            to: '/mentorship/requests',
            cta: t('attention.reviewRequests'),
        },
        {
            key: 'awaiting',
            icon: Clock,
            tone: 'danger' as const,
            count: awaitingReview,
            title: t('attention.awaitingTitle'),
            detail: t('attention.awaitingDetail', { count: awaitingReview }),
            to: '/mentorship/sessions',
            cta: t('attention.reviewSessions'),
        },
        {
            key: 'full',
            icon: Gauge,
            tone: 'warning' as const,
            count: fullMentors,
            title: t('attention.fullTitle'),
            detail: t('attention.fullDetail', {
                count: fullMentors,
                learners: terms.learners.toLowerCase(),
            }),
            to: '/mentorship/mentors',
            cta: t('attention.openMentors'),
        },
        {
            key: 'noBooking',
            icon: LinkSimple,
            tone: 'warning' as const,
            count: noBooking,
            title: t('attention.noBookingTitle'),
            detail: t('attention.noBookingDetail', {
                count: noBooking,
                learners: terms.learners.toLowerCase(),
            }),
            to: '/mentorship/mentors',
            cta: t('attention.openMentors'),
        },
    ].filter((a) => a.count > 0);

    return (
        <SectionCard
            icon={WarningCircle}
            title={t('attention.cardTitle')}
            subtitle={t('attention.cardSubtitle')}
            to="/mentorship/sessions"
            linkLabel={t('viewAllSessions')}
        >
            {loading ? (
                <Skeleton className="h-24 w-full" />
            ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                    <CheckCircle size={28} weight="duotone" className="text-success-500" />
                    <p className="text-caption font-medium text-neutral-700">
                        {t('attention.allCaughtUp')}
                    </p>
                    <p className="text-caption text-neutral-400">
                        {t('attention.allCaughtUpDescription')}
                    </p>
                </div>
            ) : (
                <ul className="flex flex-col divide-y divide-neutral-100">
                    {items.map((a) => {
                        const AttentionIcon = a.icon;
                        return (
                            <li key={a.key} className="flex items-center gap-3 py-2.5">
                                <span
                                    className={cn(
                                        'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                        a.tone === 'danger'
                                            ? 'bg-danger-50 text-danger-600'
                                            : 'bg-warning-50 text-warning-600'
                                    )}
                                >
                                    <AttentionIcon size={16} weight="duotone" />
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="text-caption font-medium text-neutral-700">
                                        {a.title}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {a.detail}
                                    </span>
                                </div>
                                <Link to={a.to} className="shrink-0">
                                    <MyButton type="button" buttonType="secondary" scale="small">
                                        {a.cta}
                                    </MyButton>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </SectionCard>
    );
}

function UpcomingCard({ sessions, loading }: { sessions: MentorSessionDTO[]; loading: boolean }) {
    const { t: tFormat, i18n } = useTranslation('mentorshipFormatSessionTimeUtils');
    const { t } = useTranslation('mentorshipDashboard');
    return (
        <SectionCard
            icon={CalendarBlank}
            title={t('upcoming.cardTitle')}
            subtitle={t('upcoming.cardSubtitle')}
            to="/mentorship/sessions"
            linkLabel={t('viewAllSessions')}
        >
            {loading ? (
                <div className="flex flex-col gap-2">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                    ))}
                </div>
            ) : sessions.length === 0 ? (
                <p className="flex items-center gap-1.5 py-6 text-caption text-neutral-400">
                    <CalendarBlank size={14} /> {t('upcoming.empty')}
                </p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {sessions.slice(0, 5).map((s) => {
                        const isToday =
                            !!s.scheduled_start_utc &&
                            new Date(s.scheduled_start_utc).toDateString() ===
                                new Date().toDateString();
                        return (
                            <li
                                key={s.booking_instance_id}
                                className="flex items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-2.5"
                            >
                                <span
                                    className={cn(
                                        'flex size-10 shrink-0 flex-col items-center justify-center rounded-md border leading-none',
                                        isToday
                                            ? 'border-primary-200 bg-primary-50 text-primary-600'
                                            : 'border-neutral-200 bg-white text-neutral-600'
                                    )}
                                >
                                    <span className="text-body font-semibold tabular-nums">
                                        {dayOfMonth(s.scheduled_start_utc)}
                                    </span>
                                    <span className="text-caption font-medium leading-none tracking-wide text-neutral-400">
                                        {shortMonth(s.scheduled_start_utc, i18n.language)}
                                    </span>
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-body text-neutral-700">
                                        {s.mentor_name || t('mentorFallback')} &rarr;{' '}
                                        {s.student_name || t('learnerFallback')}
                                    </span>
                                    <span className="text-caption text-neutral-400">
                                        {relativeDay(s.scheduled_start_utc, tFormat, i18n.language)}{' '}
                                        · {timeOfDay(s.scheduled_start_utc, i18n.language)}
                                        {s.duration_minutes
                                            ? ` · ${t('upcoming.durationMinutes', { count: s.duration_minutes })}`
                                            : ''}
                                    </span>
                                </span>
                                <span
                                    className={cn(
                                        'shrink-0 rounded-full px-2 py-0.5 text-caption font-medium',
                                        s.meet_link
                                            ? 'bg-success-50 text-success-700'
                                            : 'bg-warning-50 text-warning-700'
                                    )}
                                >
                                    {s.meet_link
                                        ? t('upcoming.linkReady')
                                        : t('upcoming.linkPending')}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </SectionCard>
    );
}

/** Best-rated mentors, from the ratings the dashboard already returns. */
function TopMentorsCard({ mentors, loading }: { mentors: MentorDTO[]; loading: boolean }) {
    const { t } = useTranslation('mentorshipDashboard');
    const terms = instituteTerms();
    const top = [...mentors]
        .sort(
            (a, b) =>
                (b.average_rating ?? 0) * (b.rating_count ?? 0) -
                (a.average_rating ?? 0) * (a.rating_count ?? 0)
        )
        .slice(0, 5);
    const max = Math.max(1, ...top.map((m) => m.rating_count ?? 0));
    return (
        <SectionCard
            icon={Trophy}
            title={t('top.cardTitle')}
            subtitle={t('top.cardSubtitle')}
            to="/mentorship/mentors"
            linkLabel={t('viewAllMentors')}
        >
            {loading ? (
                <Skeleton className="h-24 w-full" />
            ) : top.length === 0 ? (
                <p className="py-4 text-caption text-neutral-400">{t('top.empty')}</p>
            ) : (
                <ul className="flex flex-col gap-3">
                    {top.map((m, i) => (
                        <li key={m.id} className="flex items-center gap-3">
                            <span
                                className={cn(
                                    'flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                                    i === 0
                                        ? 'bg-warning-100 text-warning-700'
                                        : 'bg-neutral-100 text-neutral-600'
                                )}
                            >
                                {i + 1}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <div className="flex items-center justify-between gap-2">
                                    <Link
                                        to="/mentorship/mentors/$mentorId"
                                        params={{ mentorId: m.id }}
                                        className="truncate text-caption font-medium text-neutral-700 hover:text-primary-600"
                                    >
                                        {mentorName(m, t('mentorFallback'))}
                                    </Link>
                                    <span className="shrink-0 text-caption font-semibold tabular-nums text-warning-700">
                                        {t('top.rating', {
                                            rating: (m.average_rating ?? 0).toFixed(1),
                                        })}
                                    </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                                    <div
                                        className={cn(
                                            'h-full rounded-full',
                                            i === 0 ? 'bg-success-500' : 'bg-primary-400'
                                        )}
                                        // Data-driven width: ratings relative to the most-rated mentor.
                                        style={{
                                            width: `${Math.max(4, ((m.rating_count ?? 0) / max) * 100)}%`,
                                        }}
                                    />
                                </div>
                                <span className="text-caption text-neutral-400">
                                    {t('top.detail', {
                                        count: m.rating_count ?? 0,
                                        students: m.assigned_student_count ?? 0,
                                        learners: terms.learners.toLowerCase(),
                                    })}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </SectionCard>
    );
}

/** Card shell: icon, title, subtitle, body, and one drill-through link pinned to the foot. */
function SectionCard({
    icon: IconCmp,
    title,
    subtitle,
    to,
    linkLabel,
    className,
    children,
}: {
    icon: Icon;
    title: string;
    subtitle: string;
    to: string;
    linkLabel: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <Card
            className={cn(
                'flex h-full min-w-0 flex-col gap-3 rounded-xl border-neutral-200 bg-white p-4 shadow-sm sm:p-5',
                className
            )}
        >
            <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                    <IconCmp size={18} weight="duotone" />
                </span>
                <div className="flex min-w-0 flex-col">
                    <span className="text-subtitle font-semibold text-neutral-900">{title}</span>
                    <span className="text-caption text-neutral-500">{subtitle}</span>
                </div>
            </div>

            <div className="flex flex-1 flex-col gap-3">{children}</div>

            <Link
                to={to}
                className="flex items-center justify-center gap-1 border-t border-neutral-100 pt-3 text-caption font-medium text-primary-600 hover:text-primary-700"
            >
                {linkLabel}
                <ArrowRight size={12} weight="bold" />
            </Link>
        </Card>
    );
}
