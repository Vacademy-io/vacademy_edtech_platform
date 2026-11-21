import { useMemo, useState } from 'react';
import {
    CalendarBlank,
    CalendarPlus,
    CheckCircle,
    Clock,
    Eye,
    MagnifyingGlass,
    Star,
    UserMinus,
    VideoCamera,
    WarningCircle,
    XCircle,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MyTable } from '@/components/design-system/table';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { useMentorDashboard, useMentorSessions } from '../-hooks/use-mentorship';
import {
    dayOfMonth,
    relativeDay,
    sessionDateTime,
    shortMonth,
    timeOfDay,
} from '../-utils/format-session-time';
import { SessionActionDialog } from './SessionActionDialog';
import { MentorAvatar } from './MentorAvatar';
import type { MentorSessionDTO } from '../-types/mentorship-types';

/** The lifecycle states an admin filters by, in the order they matter. */
function buildFilters(t: TFunction) {
    return [
        { key: '', label: t('filters.all') },
        { key: 'UPCOMING', label: t('filters.upcoming') },
        { key: 'AWAITING_REVIEW', label: t('filters.awaitingReview') },
        { key: 'COMPLETED', label: t('filters.completed') },
        { key: 'NO_SHOW', label: t('filters.noShows') },
        { key: 'CANCELLED', label: t('filters.cancelled') },
    ] as const;
}

/**
 * Every mentorship session in one place: who, when, what happened, and how the
 * learner rated it. Read-only — an admin observes here; the mentor records the
 * outcome and the learner gives the rating.
 */
export function MentorSessionsPanel({
    instituteId,
    mentorId,
    studentUserId,
}: {
    instituteId: string | undefined;
    /** Set to scope the view to one mentor (mentor-wise) or one learner. */
    mentorId?: string;
    studentUserId?: string;
}) {
    const { t } = useTranslation('mentorshipMentorSessionsPanel');
    const { t: tFormat, i18n } = useTranslation('mentorshipFormatSessionTimeUtils');
    const FILTERS = useMemo(() => buildFilters(t), [t]);
    // Narrows the rows already loaded — no request per keystroke.
    const [search, setSearch] = useState('');
    const [lifecycle, setLifecycle] = useState<string>('');
    // Only offered when the panel isn't already scoped to one mentor — inside a
    // mentor's own detail view the filter would be a no-op.
    const [mentorFilter, setMentorFilter] = useState<string[]>([]);
    const [detail, setDetail] = useState<MentorSessionDTO | null>(null);
    const [acting, setActing] = useState<{
        session: MentorSessionDTO;
        action: 'cancel' | 'reschedule';
    } | null>(null);
    // The mentor narrowing is applied on the CLIENT rather than in the query. The
    // endpoint takes a single mentorId, so a multi-select can't be expressed there —
    // and the backend already loads the whole institute window before filtering, so
    // one unscoped fetch serves every selection instead of a refetch per change.
    const { data, isLoading, isError, refetch } = useMentorSessions(instituteId, {
        mentorId,
        studentUserId,
        lifecycle: lifecycle || undefined,
    });
    const scoped = useMemo(() => {
        const all = data ?? [];
        if (mentorId || mentorFilter.length === 0) return all;
        return all.filter((s) => s.mentor_id != null && mentorFilter.includes(s.mentor_id));
    }, [data, mentorId, mentorFilter]);
    const query = search.trim().toLowerCase();
    const sessions = useMemo(
        () =>
            query
                ? scoped.filter((s) =>
                      [s.mentor_name, s.student_name, s.topic, s.title].some((f) =>
                          (f ?? '').toLowerCase().includes(query)
                      )
                  )
                : scoped,
        [scoped, query]
    );
    // The week ahead, from the same rows — only where "what's coming" is the question.
    const showWeek = !studentUserId && (lifecycle === '' || lifecycle === 'UPCOMING');

    // The mentor list is already cached by the dashboard query, so the filter costs
    // nothing extra on a screen an admin has usually arrived at from there.
    const mentorsQuery = useMentorDashboard(mentorId ? undefined : instituteId);
    // No "All mentors" member: an empty selection already means all, and a magic
    // member would have to be special-cased everywhere it's read.
    const mentorOptions = useMemo(
        () =>
            (mentorsQuery.data?.mentors ?? []).map((m) => ({
                label: m.display_name || m.name || t('fallback.mentor'),
                value: m.id,
            })),
        [mentorsQuery.data, t]
    );

    const columns = useMemo<ColumnDef<MentorSessionDTO>[]>(
        () => [
            {
                id: 'mentor',
                header: t('columns.mentor'),
                size: 200,
                cell: ({ row }) => {
                    const s = row.original;
                    return (
                        <div className="flex min-w-0 items-center gap-2.5">
                            <MentorAvatar
                                fileId={null}
                                name={s.mentor_name}
                                className="size-8 shrink-0 text-caption"
                            />
                            <button
                                type="button"
                                onClick={() => setDetail(s)}
                                className="truncate text-left text-body font-medium text-neutral-700 hover:text-primary-600 hover:underline"
                                title={t('openSessionDetails')}
                            >
                                {s.mentor_name || t('fallback.mentor')}
                            </button>
                        </div>
                    );
                },
            },
            {
                id: 'mentee',
                header: t('columns.mentee'),
                size: 170,
                cell: ({ row }) => (
                    <span className="truncate text-body text-neutral-600">
                        {row.original.student_name || t('fallback.learner')}
                    </span>
                ),
            },
            {
                id: 'when',
                header: t('columns.when'),
                size: 170,
                cell: ({ row }) => {
                    const s = row.original;
                    const today = isToday(s.scheduled_start_utc);
                    return (
                        <span className="flex items-center gap-2.5">
                            {/* Leading date block — turns a wall of rows into something scannable. */}
                            <span
                                className={cn(
                                    'flex size-10 shrink-0 flex-col items-center justify-center rounded-lg border leading-none',
                                    today
                                        ? 'border-primary-200 bg-primary-50 text-primary-600'
                                        : 'border-neutral-200 bg-neutral-50 text-neutral-600'
                                )}
                            >
                                <span className="text-body font-semibold tabular-nums">
                                    {dayOfMonth(s.scheduled_start_utc)}
                                </span>
                                <span className="text-caption font-medium tracking-wide text-neutral-400">
                                    {shortMonth(s.scheduled_start_utc, i18n.language)}
                                </span>
                            </span>
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate text-caption font-medium text-neutral-700">
                                    {relativeDay(s.scheduled_start_utc, tFormat, i18n.language)}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {timeOfDay(s.scheduled_start_utc, i18n.language)}
                                </span>
                            </span>
                        </span>
                    );
                },
            },
            {
                id: 'duration',
                header: t('columns.duration'),
                size: 100,
                cell: ({ row }) => (
                    <span className="text-body tabular-nums text-neutral-600">
                        {row.original.duration_minutes
                            ? t('durationMinutes', { count: row.original.duration_minutes })
                            : '—'}
                    </span>
                ),
            },
            {
                id: 'topic',
                header: t('columns.topic'),
                size: 180,
                cell: ({ row }) => (
                    <span
                        className="line-clamp-2 text-body text-neutral-600"
                        title={row.original.topic ?? undefined}
                    >
                        {row.original.topic || row.original.title || '—'}
                    </span>
                ),
            },
            {
                id: 'status',
                header: t('columns.status'),
                size: 150,
                cell: ({ row }) => <LifecycleBadge lifecycle={row.original.lifecycle} />,
            },
            {
                id: 'rating',
                header: t('columns.rating'),
                size: 100,
                cell: ({ row }) =>
                    typeof row.original.rating === 'number' ? (
                        <span className="flex w-fit items-center gap-1 rounded-full bg-warning-50 px-2 py-1 text-caption text-warning-700">
                            <Star size={12} weight="fill" className="text-warning-500" />
                            {row.original.rating}
                        </span>
                    ) : (
                        <span className="text-caption text-neutral-300">—</span>
                    ),
            },
            {
                id: 'actions',
                header: t('columns.actions'),
                size: 140,
                cell: ({ row }) => {
                    const s = row.original;
                    const who = t('whoAndTemplate', {
                        mentor: s.mentor_name || t('fallback.mentorLower'),
                        student: s.student_name || t('fallback.learnerLower'),
                    });
                    if (s.lifecycle !== 'UPCOMING') {
                        return (
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => setDetail(s)}
                                aria-label={t('viewSessionAria', { who })}
                                title={t('viewSessionDetailsTitle')}
                            >
                                <Eye size={18} />
                            </MyButton>
                        );
                    }
                    return (
                        <div className="flex items-center gap-1">
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                disable={!s.meet_link}
                                onClick={() =>
                                    window.open(
                                        s.meet_link as string,
                                        '_blank',
                                        'noopener,noreferrer'
                                    )
                                }
                                aria-label={
                                    s.meet_link
                                        ? t('joinSessionAria', { who })
                                        : t('noMeetingLinkAria', { who })
                                }
                                // Shown disabled rather than hidden: a missing link means
                                // Meet allocation hasn't landed (or failed), and that is
                                // something an admin needs to see, not something to hide.
                                title={
                                    s.meet_link ? t('joinMeetingTitle') : t('noMeetingLinkTitle')
                                }
                            >
                                <VideoCamera size={18} />
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => setActing({ session: s, action: 'reschedule' })}
                                aria-label={t('rescheduleAria')}
                                title={t('rescheduleTitle')}
                            >
                                <CalendarPlus size={18} />
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => setActing({ session: s, action: 'cancel' })}
                                aria-label={t('cancelAria')}
                                title={t('cancelTitle')}
                            >
                                <XCircle size={18} className="text-danger-500" />
                            </MyButton>
                        </div>
                    );
                },
            },
        ],
        // tFormat and the language feed the When cell's relative-day label.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, tFormat, i18n.language]
    );

    return (
        <div className="flex flex-col gap-4">
            {showWeek && !isLoading && !isError && (
                <WeekAhead sessions={scoped} onOpen={setDetail} />
            )}
            <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200">
                    <div className="flex flex-wrap gap-1">
                        {FILTERS.map((f) => (
                            <button
                                key={f.key || 'all'}
                                type="button"
                                onClick={() => setLifecycle(f.key)}
                                className={`-mb-px border-b-2 px-3 py-2 text-body transition-colors ${
                                    lifecycle === f.key
                                        ? 'border-primary-500 font-medium text-primary-600'
                                        : 'border-transparent text-neutral-500 hover:text-neutral-700'
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                    {!mentorId && (
                        <div className="pb-2">
                            <MultiSelectFilter
                                label={t('mentorsFilterLabel')}
                                options={mentorOptions}
                                selected={mentorFilter}
                                onChange={setMentorFilter}
                                placeholder={t('mentorsSearchPlaceholder')}
                                widthClass="w-52"
                            />
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="relative w-full sm:w-80">
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                        />
                        <MyInput
                            input={search}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                setSearch(e.target.value)
                            }
                            inputType="text"
                            inputPlaceholder={t('searchPlaceholder', {
                                learner: instituteTerms().learner.toLowerCase(),
                            })}
                            className="pl-9 sm:w-full"
                        />
                    </div>
                    {!isLoading && !isError && (
                        <span className="text-caption text-neutral-500">
                            {t('shownCount', { count: sessions.length })}
                        </span>
                    )}
                </div>

                {isLoading ? (
                    <div className="flex flex-col gap-2">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-16 w-full rounded-lg" />
                        ))}
                    </div>
                ) : isError ? (
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
                ) : sessions.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
                        <CalendarBlank size={36} className="text-neutral-300" />
                        <p className="text-body font-medium text-neutral-700">
                            {lifecycle || query ? t('emptyStateFiltered') : t('emptyStateAll')}
                        </p>
                        <p className="max-w-md text-caption text-neutral-500">
                            {t('emptyStateHint')}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                        <MyTable<MentorSessionDTO>
                            data={{
                                content: sessions,
                                total_pages: 1,
                                page_no: 0,
                                page_size: sessions.length,
                                total_elements: sessions.length,
                                last: true,
                            }}
                            columns={columns}
                            isLoading={false}
                            error={null}
                            currentPage={0}
                            scrollable
                        />
                    </div>
                )}
            </div>

            <SessionDetailDialog session={detail} onOpenChange={(o) => !o && setDetail(null)} />

            <SessionActionDialog
                session={acting?.session ?? null}
                action={acting?.action ?? null}
                instituteId={instituteId}
                onOpenChange={(o) => {
                    if (!o) setActing(null);
                }}
            />
        </div>
    );
}

const isToday = (epochMillis?: number | null) =>
    !!epochMillis && new Date(epochMillis).toDateString() === new Date().toDateString();

const LIFECYCLE_BAR: Record<string, string> = {
    UPCOMING: 'border-info-500',
    AWAITING_REVIEW: 'border-warning-500',
    COMPLETED: 'border-success-500',
    NO_SHOW: 'border-danger-500',
};

/**
 * Today and the six days after it, each with its sessions, from the rows the panel
 * already loaded. A glance at how the week fills up; a click opens the session.
 */
function WeekAhead({
    sessions,
    onOpen,
}: {
    sessions: MentorSessionDTO[];
    onOpen: (s: MentorSessionDTO) => void;
}) {
    const { t, i18n } = useTranslation('mentorshipMentorSessionsPanel');
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const key = d.toDateString();
        const list = sessions
            .filter(
                (s) =>
                    !!s.scheduled_start_utc &&
                    new Date(s.scheduled_start_utc).toDateString() === key
            )
            .sort((a, b) => (a.scheduled_start_utc ?? 0) - (b.scheduled_start_utc ?? 0));
        return { d, key, list, today: i === 0 };
    });
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col">
                <span className="flex items-center gap-2 text-subtitle font-semibold text-neutral-900">
                    <CalendarBlank size={18} weight="duotone" className="text-neutral-500" />
                    {t('week.title')}
                </span>
                <span className="text-caption text-neutral-500">{t('week.subtitle')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {days.map(({ d, key, list, today }) => (
                    <div
                        key={key}
                        className={cn(
                            'flex min-w-0 flex-col gap-1.5 rounded-lg border p-2',
                            today ? 'border-primary-200 bg-primary-50' : 'border-neutral-200'
                        )}
                    >
                        <div className="flex items-center justify-between gap-1">
                            <span className="text-caption text-neutral-500">
                                {d.toLocaleDateString(i18n.language, { weekday: 'short' })}
                            </span>
                            <span className="text-body font-semibold tabular-nums text-neutral-800">
                                {d.getDate()}
                            </span>
                            <span
                                className={cn(
                                    'rounded-full px-1.5 text-caption tabular-nums',
                                    list.length
                                        ? 'bg-info-50 text-info-700'
                                        : 'bg-neutral-100 text-neutral-400'
                                )}
                            >
                                {list.length}
                            </span>
                        </div>
                        {list.slice(0, 2).map((s) => (
                            <button
                                key={s.booking_instance_id}
                                type="button"
                                onClick={() => onOpen(s)}
                                className={cn(
                                    'min-w-0 truncate rounded border-l-2 bg-white px-1.5 py-1 text-left text-caption text-neutral-700 hover:bg-neutral-50',
                                    LIFECYCLE_BAR[s.lifecycle] ?? 'border-neutral-300'
                                )}
                                title={`${s.mentor_name ?? ''} → ${s.student_name ?? ''}`}
                            >
                                <b className="font-semibold">
                                    {timeOfDay(s.scheduled_start_utc, i18n.language)}
                                </b>{' '}
                                {(s.student_name || t('fallback.learner')).split(' ')[0]}
                            </button>
                        ))}
                        {list.length > 2 && (
                            <span className="text-caption text-neutral-400">
                                {t('week.more', { count: list.length - 2 })}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

/** One word for a session's state, coloured by whether it needs attention. */
export function LifecycleBadge({ lifecycle }: { lifecycle: string }) {
    const { t } = useTranslation('mentorshipMentorSessionsPanel');
    const map: Record<string, { label: string; tone: string; icon: React.ReactNode }> = {
        COMPLETED: {
            label: t('lifecycle.completed'),
            tone: 'bg-success-50 text-success-600',
            icon: <CheckCircle size={12} weight="fill" />,
        },
        NO_SHOW: {
            label: t('lifecycle.noShow'),
            tone: 'bg-danger-50 text-danger-600',
            icon: <UserMinus size={12} weight="fill" />,
        },
        CANCELLED: {
            label: t('lifecycle.cancelled'),
            tone: 'bg-neutral-100 text-neutral-500',
            icon: <XCircle size={12} weight="fill" />,
        },
        RESCHEDULED: {
            label: t('lifecycle.rescheduled'),
            tone: 'bg-neutral-100 text-neutral-500',
            icon: <Clock size={12} weight="fill" />,
        },
        UPCOMING: {
            label: t('lifecycle.upcoming'),
            tone: 'bg-info-50 text-info-600',
            icon: <CalendarBlank size={12} weight="fill" />,
        },
        AWAITING_REVIEW: {
            label: t('lifecycle.awaitingReview'),
            tone: 'bg-warning-50 text-warning-700',
            icon: <Clock size={12} weight="fill" />,
        },
    };
    const entry = map[lifecycle] ?? {
        label: lifecycle,
        tone: 'bg-neutral-100 text-neutral-500',
        icon: null,
    };
    return (
        <span
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-caption ${entry.tone}`}
        >
            {entry.icon}
            {entry.label}
        </span>
    );
}

/** Everything about one session, as the admin brief lists it. */
function SessionDetailDialog({
    session,
    onOpenChange,
}: {
    session: MentorSessionDTO | null;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('mentorshipMentorSessionsPanel');
    if (!session) return null;
    return (
        <MyDialog
            heading={t('detailDialog.heading')}
            open={!!session}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
        >
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <span className="text-body font-semibold text-neutral-700">
                        {session.title || t('detailDialog.defaultTitle')}
                    </span>
                    <LifecycleBadge lifecycle={session.lifecycle} />
                </div>

                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    <Field
                        label={t('fieldLabels.mentor')}
                        value={session.mentor_name}
                        sub={session.mentor_email}
                    />
                    <Field
                        label={t('fieldLabels.learner')}
                        value={session.student_name}
                        sub={session.student_email}
                    />
                    <Field
                        label={t('fieldLabels.when')}
                        value={sessionDateTime(session.scheduled_start_utc)}
                    />
                    <Field
                        label={t('fieldLabels.duration')}
                        value={
                            session.duration_minutes
                                ? t('durationMinutesShort', { count: session.duration_minutes })
                                : '—'
                        }
                    />
                    <Field label={t('fieldLabels.topic')} value={session.topic || '—'} />
                    <Field
                        label={t('fieldLabels.bookingStatus')}
                        value={session.booking_status || '—'}
                    />
                </dl>

                {session.meet_link && (
                    <a
                        href={session.meet_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-fit items-center gap-1.5 text-caption font-medium text-primary-600 hover:text-primary-700"
                    >
                        <VideoCamera size={14} /> {t('detailDialog.openMeetingLink')}
                    </a>
                )}

                {session.notes && (
                    <div className="flex flex-col gap-1">
                        <span className="text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('detailDialog.mentorNotesLabel')}
                        </span>
                        <p className="rounded-md bg-neutral-50 p-3 text-caption text-neutral-600">
                            {session.notes}
                        </p>
                    </div>
                )}

                {typeof session.rating === 'number' && (
                    <div className="flex flex-col gap-1">
                        <span className="text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('detailDialog.learnerFeedbackLabel')}
                        </span>
                        <span className="flex items-center gap-1.5 text-body text-neutral-700">
                            <Star size={14} weight="fill" className="text-warning-500" />
                            {t('detailDialog.ratingOutOfFive', { rating: session.rating })}
                        </span>
                        {session.feedback_comment && (
                            <p className="rounded-md bg-neutral-50 p-3 text-caption text-neutral-600">
                                {session.feedback_comment}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </MyDialog>
    );
}

function Field({
    label,
    value,
    sub,
}: {
    label: string;
    value?: string | null;
    sub?: string | null;
}) {
    return (
        <div className="flex flex-col">
            <dt className="text-caption text-neutral-400">{label}</dt>
            <dd className="text-body text-neutral-700">{value || '—'}</dd>
            {sub && <dd className="text-caption text-neutral-400">{sub}</dd>}
        </div>
    );
}
