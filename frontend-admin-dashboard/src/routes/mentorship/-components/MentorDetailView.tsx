import { useMemo, useState } from 'react';
import {
    CalendarCheck,
    CalendarPlus,
    CaretRight,
    ChatCircle,
    Clock,
    EnvelopeSimple,
    Eye,
    Gauge,
    IdentificationCard,
    MagnifyingGlass,
    Star,
    UserPlus,
    UsersThree,
    WarningCircle,
    type Icon,
} from '@phosphor-icons/react';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyTable } from '@/components/design-system/table';
import { StatusChips } from '@/components/design-system/chips';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import {
    useMentorAvailability,
    useMentorDashboard,
    useMentorFeedback,
    useMentorMentees,
} from '../-hooks/use-mentorship';
import { MentorAvatar } from './MentorAvatar';
import { MentorSessionsPanel } from './MentorSessionsPanel';
import { MenteeDetailSheet } from './MenteeDetailSheet';
import { ScheduleSessionDialog } from './ScheduleSessionDialog';
import { AssignMenteesDialog } from './AssignMenteesDialog';
import { AvailabilitySummary, DAY_ORDER } from './MentorAvailabilitySummary';
import { createDirectConversation, describeDirectChatError } from '@/services/chat/chatApi';
import { reportApiError } from '@/lib/report-api-error';
import { useChatEnabled } from '@/hooks/use-chat-enabled';
import { messageActionTitle } from '../-utils/chat-availability';
import type { MenteeDTO, MentorDTO, MentorFeedbackDTO } from '../-types/mentorship-types';

export type MentorDetailTab = 'overview' | 'students' | 'availability' | 'sessions' | 'feedback';

const buildTabs = (t: TFunction): { key: MentorDetailTab; label: string }[] => [
    { key: 'overview', label: t('tabs.overview') },
    { key: 'students', label: t('tabs.students') },
    { key: 'availability', label: t('tabs.availability') },
    { key: 'sessions', label: t('tabs.sessions') },
    { key: 'feedback', label: t('tabs.feedback') },
];

/**
 * Everything an admin needs about one mentor, assembled from data that already
 * exists: the mentor row itself (profile, email, capacity, rating), their assigned
 * students, their availability, and their sessions — the last of which reuses the
 * very same sessions panel as the standalone screen, scoped to this mentor.
 *
 * The mentor comes out of the dashboard query the list screen already loaded, so
 * arriving here costs no extra request and this stays a view, not a data path.
 */
export function MentorDetailView({
    mentorId,
    instituteId,
    tab,
    onTabChange,
}: {
    mentorId: string;
    instituteId: string | undefined;
    tab: MentorDetailTab;
    onTabChange: (tab: MentorDetailTab) => void;
}) {
    const { t } = useTranslation('mentorshipMentorDetailView');
    const { data, isLoading, isError, refetch } = useMentorDashboard(instituteId);
    const mentor = (data?.mentors ?? []).find((m) => m.id === mentorId) ?? null;

    const mentees = useMentorMentees(mentor?.id, instituteId);
    const availability = useMentorAvailability(mentor?.id, instituteId);
    const feedback = useMentorFeedback(tab === 'feedback' ? mentor?.id : undefined, instituteId);

    // Header actions open the same dialogs the mentor list and the Students tab use.
    const [assignOpen, setAssignOpen] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);

    const setTab = onTabChange;
    const TABS = useMemo(() => buildTabs(t), [t]);

    if (isLoading) {
        return (
            <div className="flex flex-col gap-4 p-6">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-64 w-full rounded-lg" />
            </div>
        );
    }

    if (isError || !mentor) {
        return (
            <div className="flex flex-col gap-4 p-6">
                <Breadcrumb name={null} t={t} />
                <div className="flex flex-col items-start gap-3 rounded-lg border border-danger-100 bg-danger-50 p-4">
                    <div className="flex items-center gap-2">
                        <WarningCircle size={18} weight="fill" className="text-danger-600" />
                        <p className="text-body text-danger-600">
                            {isError ? t('errorLoad') : t('errorGone')}
                        </p>
                    </div>
                    {isError ? (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => refetch()}
                        >
                            {t('retry')}
                        </MyButton>
                    ) : (
                        <Link to="/mentorship/mentors">
                            <MyButton type="button" buttonType="secondary" scale="small">
                                {t('backToMentors')}
                            </MyButton>
                        </Link>
                    )}
                </div>
            </div>
        );
    }

    const assigned = mentor.assigned_student_count ?? 0;
    const cap = mentor.max_mentees ?? null;
    const name = mentor.display_name || mentor.name || t('mentorFallback');
    const menteeCount = mentees.data?.length ?? assigned;
    const feedbackCount = mentor.rating_count ?? 0;
    const rated = mentor.average_rating != null && feedbackCount > 0;
    const full = cap != null && cap > 0 && assigned >= cap;

    return (
        <div className="flex flex-col gap-5 p-6">
            <Breadcrumb name={name} t={t} />

            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                    <MentorAvatar
                        fileId={mentor.profile_image_file_id || mentor.profile_pic_file_id}
                        name={name}
                        className="size-16 text-title"
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                            <h2 className="text-h3 font-semibold text-neutral-900">{name}</h2>
                            <StatusChips
                                status={
                                    (mentor.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
                                        ? 'ACTIVE'
                                        : 'INACTIVE'
                                }
                            >
                                {(mentor.status || 'ACTIVE').toLowerCase()}
                            </StatusChips>
                        </span>
                        <span className="text-body text-neutral-500">
                            {mentor.title || t('roleFallback')}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-neutral-400">
                            {mentor.email && (
                                <span className="flex items-center gap-1">
                                    <EnvelopeSimple size={12} /> {mentor.email}
                                </span>
                            )}
                            <span className="flex items-center gap-1">
                                <Eye size={12} />
                                {mentor.is_discoverable
                                    ? t('headerListed', {
                                          learners: instituteTerms().learners.toLowerCase(),
                                      })
                                    : t('headerHidden', {
                                          learners: instituteTerms().learners.toLowerCase(),
                                      })}
                            </span>
                        </span>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => setAssignOpen(true)}
                        disable={!instituteId}
                    >
                        <UserPlus size={18} /> {t('assignStudentsButton')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setScheduleOpen(true)}
                        title={t('scheduleSessionTitle')}
                    >
                        <CalendarPlus size={18} /> {t('headerScheduleButton')}
                    </MyButton>
                </div>
            </div>

            <nav
                className="flex flex-wrap gap-1 border-b border-neutral-200"
                aria-label={t('navAriaLabel')}
            >
                {TABS.map((t) => {
                    const count =
                        t.key === 'students'
                            ? menteeCount
                            : t.key === 'feedback'
                              ? feedbackCount
                              : null;
                    return (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={cn(
                                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-body transition-colors',
                                tab === t.key
                                    ? 'border-primary-500 font-medium text-primary-600'
                                    : 'border-transparent text-neutral-500 hover:text-neutral-700'
                            )}
                        >
                            {t.label}
                            {count ? (
                                <span
                                    className={cn(
                                        'rounded-full px-1.5 text-caption tabular-nums',
                                        tab === t.key
                                            ? 'bg-primary-50 text-primary-600'
                                            : 'bg-neutral-100 text-neutral-500'
                                    )}
                                >
                                    {count}
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </nav>

            {tab === 'overview' && (
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <Stat
                            icon={UsersThree}
                            tone="primary"
                            label={t('statAssignedStudents')}
                            value={assigned}
                            detail={
                                cap
                                    ? full
                                        ? t('statAtCapacity')
                                        : t('statPlacesOpen', {
                                              count: Math.max(0, cap - assigned),
                                          })
                                    : t('statNoLimit')
                            }
                            onClick={() => setTab('students')}
                        />
                        <Stat
                            icon={Gauge}
                            tone={full ? 'danger' : 'success'}
                            label={t('statCapacity')}
                            value={cap ? `${assigned}/${cap}` : '∞'}
                        />
                        <Stat
                            icon={Star}
                            tone="warning"
                            label={t('statAverageRating')}
                            value={rated ? (mentor.average_rating as number).toFixed(1) : '—'}
                            onClick={() => setTab('feedback')}
                        />
                        <Stat
                            icon={ChatCircle}
                            tone="info"
                            label={t('statRatedSessions')}
                            value={feedbackCount}
                            onClick={() => setTab('feedback')}
                        />
                    </div>

                    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
                        <Card className="flex h-full flex-col gap-3 rounded-xl border-neutral-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-3">
                            <CardHeading icon={IdentificationCard}>
                                {t('mentorInformationHeading')}
                            </CardHeading>
                            <dl className="flex flex-col divide-y divide-neutral-100">
                                <Fact
                                    label={t('factExpertise')}
                                    value={
                                        (mentor.expertise_tags?.length ?? 0) > 0 ? (
                                            <span className="flex flex-wrap justify-end gap-1">
                                                {(mentor.expertise_tags ?? []).map((tag) => (
                                                    <span
                                                        key={tag}
                                                        className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-neutral-700"
                                                    >
                                                        {tag}
                                                    </span>
                                                ))}
                                            </span>
                                        ) : null
                                    }
                                />
                                <Fact
                                    label={t('factSessionDuration')}
                                    value={
                                        availability.data?.duration_minutes
                                            ? t('sessionMinutes', {
                                                  count: availability.data.duration_minutes,
                                              })
                                            : null
                                    }
                                />
                                <Fact
                                    label={t('factMaximumCapacity')}
                                    value={cap ? `${cap}` : t('unlimited')}
                                />
                                <Fact
                                    label={t('factDiscoverable')}
                                    value={
                                        mentor.is_discoverable
                                            ? t('discoverableYes')
                                            : t('discoverableNo')
                                    }
                                />
                                <Fact
                                    label={t('factBookingPage')}
                                    value={
                                        mentor.booking_page_slug ? (
                                            <span className="text-success-700">
                                                {t('bookingPageReady')}
                                            </span>
                                        ) : (
                                            <span className="text-warning-700">
                                                {t('bookingPageMissing')}
                                            </span>
                                        )
                                    }
                                />
                                <Fact
                                    label={t('factGoogleCalendar')}
                                    value={
                                        mentor.google_connected
                                            ? t('googleConnected')
                                            : t('googleNotConnected')
                                    }
                                />
                            </dl>
                            {mentor.bio && (
                                <p className="border-t border-neutral-100 pt-3 text-caption text-neutral-600">
                                    {mentor.bio}
                                </p>
                            )}
                        </Card>

                        <Card className="flex h-full flex-col gap-3 rounded-xl border-neutral-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-2">
                            <CardHeading icon={Clock}>
                                {t('availabilityThisWeekHeading')}
                            </CardHeading>
                            {availability.isLoading ? (
                                <Skeleton className="h-16 w-full rounded-md" />
                            ) : availability.isError ? (
                                <p className="text-caption text-neutral-400">
                                    {t('noBookingSetup')}
                                </p>
                            ) : (
                                <AvailabilitySummary page={availability.data} />
                            )}
                            <button
                                type="button"
                                onClick={() => setTab('availability')}
                                className="mt-auto flex items-center justify-center gap-1 border-t border-neutral-100 pt-3 text-caption font-medium text-primary-600 hover:text-primary-700"
                            >
                                {t('viewFullAvailability')}
                                <CaretRight size={12} weight="bold" />
                            </button>
                        </Card>
                    </div>
                </div>
            )}

            {tab === 'students' && (
                <MentorStudentsTab
                    instituteId={instituteId}
                    mentor={mentor}
                    mentees={mentees.data ?? []}
                    isLoading={mentees.isLoading}
                />
            )}

            {tab === 'availability' && (
                <Card className="flex h-full flex-col gap-4 rounded-xl border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
                    <CardHeading icon={CalendarCheck}>{t('weeklyHoursHeading')}</CardHeading>
                    {availability.isLoading ? (
                        <Skeleton className="h-24 w-full rounded-md" />
                    ) : availability.isError ? (
                        <p className="text-caption text-neutral-400">{t('noBookingSetup')}</p>
                    ) : (
                        <FullAvailability page={availability.data} t={t} />
                    )}
                </Card>
            )}

            {tab === 'sessions' && (
                // The same panel as the Sessions screen, scoped to this mentor — upcoming,
                // completed, cancelled and no-shows all filterable, with full history.
                <MentorSessionsPanel instituteId={instituteId} mentorId={mentor.id} />
            )}

            {tab === 'feedback' && (
                <FeedbackTab
                    loading={feedback.isLoading}
                    items={feedback.data ?? []}
                    average={rated ? (mentor.average_rating as number) : null}
                    count={feedbackCount}
                />
            )}

            {instituteId && (
                <AssignMenteesDialog
                    instituteId={instituteId}
                    mentor={mentor}
                    open={assignOpen}
                    onOpenChange={setAssignOpen}
                />
            )}
            <ScheduleSessionDialog
                instituteId={instituteId}
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                mentor={mentor}
            />
        </div>
    );
}

/**
 * Learner ratings: a summary built from the ratings already fetched for this tab,
 * then every comment. Nothing extra is requested.
 */
function FeedbackTab({
    loading,
    items,
    average,
    count,
}: {
    loading: boolean;
    items: MentorFeedbackDTO[];
    average: number | null;
    count: number;
}) {
    const { t } = useTranslation('mentorshipMentorDetailView');
    if (loading) return <Skeleton className="h-24 w-full rounded-md" />;
    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
                <Star size={32} className="text-neutral-300" />
                <p className="text-caption text-neutral-400">{t('noFeedbackYet')}</p>
            </div>
        );
    }
    const stars = [5, 4, 3, 2, 1].map((n) => ({
        n,
        count: items.filter((f) => Math.round(f.rating) === n).length,
    }));
    const peak = Math.max(1, ...stars.map((s) => s.count));
    return (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
            <Card className="flex flex-col gap-4 rounded-xl border-neutral-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-2">
                <CardHeading icon={Star}>{t('ratingSummaryHeading')}</CardHeading>
                <div className="flex items-center gap-3">
                    <span className="text-h1 font-bold tabular-nums text-neutral-900">
                        {average == null ? '—' : average.toFixed(1)}
                    </span>
                    <span className="flex flex-col">
                        <span className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <Star
                                    key={n}
                                    size={16}
                                    weight="fill"
                                    className={
                                        average != null && n <= Math.round(average)
                                            ? 'text-warning-500'
                                            : 'text-neutral-200'
                                    }
                                />
                            ))}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {t('ratingSummaryFrom', { count })}
                        </span>
                    </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                    {stars.map((s) => (
                        <li key={s.n} className="flex items-center gap-2 text-caption">
                            <span className="w-8 shrink-0 tabular-nums text-neutral-600">
                                {s.n} ★
                            </span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                                <span
                                    className={cn(
                                        'block h-full rounded-full',
                                        s.n >= 4
                                            ? 'bg-success-500'
                                            : s.n === 3
                                              ? 'bg-warning-500'
                                              : 'bg-danger-500'
                                    )}
                                    // Data-driven width: share of the most common rating.
                                    style={{ width: `${(s.count / peak) * 100}%` }}
                                />
                            </span>
                            <span className="w-8 shrink-0 text-right tabular-nums text-neutral-700">
                                {s.count}
                            </span>
                        </li>
                    ))}
                </ul>
            </Card>
            <Card className="flex flex-col gap-3 rounded-xl border-neutral-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-3">
                <CardHeading icon={ChatCircle}>
                    {t('whatLearnersSaidHeading', {
                        learners: instituteTerms().learners.toLowerCase(),
                    })}
                </CardHeading>
                <ul className="flex flex-col divide-y divide-neutral-100">
                    {items.map((f) => (
                        <li key={f.id} className="flex flex-col gap-1 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-caption font-medium text-neutral-700">
                                    {f.student_name || ''}
                                </span>
                                <span className="flex shrink-0 items-center gap-1 text-caption text-warning-700">
                                    <Star size={12} weight="fill" className="text-warning-500" />
                                    {f.rating}/5
                                </span>
                            </div>
                            {f.comment && (
                                <p className="text-caption text-neutral-600">{f.comment}</p>
                            )}
                        </li>
                    ))}
                </ul>
            </Card>
        </div>
    );
}

function CardHeading({ icon: IconCmp, children }: { icon: Icon; children: React.ReactNode }) {
    return (
        <span className="flex items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                <IconCmp size={16} weight="duotone" />
            </span>
            <span className="text-subtitle font-semibold text-neutral-900">{children}</span>
        </span>
    );
}

/**
 * A mentor's assigned students, as a table.
 *
 * Its own component so the search box and the open-student state can use hooks: the
 * parent returns early while the mentor is still loading, and hooks declared after
 * those returns would run in a different order on the next render.
 *
 * Clicking a student opens the side sheet rather than navigating away — an admin
 * reviewing a mentor's roster is comparing students, and losing the table each time
 * turned that into a back-button loop.
 */
function MentorStudentsTab({
    instituteId,
    mentor,
    mentees,
    isLoading,
}: {
    instituteId: string | undefined;
    mentor: MentorDTO;
    mentees: MenteeDTO[];
    isLoading: boolean;
}) {
    const { t } = useTranslation('mentorshipMentorDetailView');
    const [search, setSearch] = useState('');
    const [assignOpen, setAssignOpen] = useState(false);
    const [openMentee, setOpenMentee] = useState<MenteeDTO | null>(null);
    const [scheduleFor, setScheduleFor] = useState<MenteeDTO | null>(null);
    const [messagingId, setMessagingId] = useState<string | null>(null);
    const navigate = useNavigate();
    // In-App Messages is off until an institute switches it on. Staff see the action
    // disabled-and-explained rather than hidden — they're who can turn it on.
    const chat = useChatEnabled();

    const query = search.trim().toLowerCase();
    const visible = useMemo(
        () =>
            query
                ? mentees.filter((m) =>
                      [m.name, m.email, m.mobile_number].some((f) =>
                          (f ?? '').toLowerCase().includes(query)
                      )
                  )
                : mentees,
        [mentees, query]
    );

    const message = async (mentee: MenteeDTO) => {
        setMessagingId(mentee.student_user_id);
        try {
            const conv = await createDirectConversation({
                targetUserId: mentee.student_user_id,
                targetUserName: mentee.name ?? undefined,
                targetUserRole: 'STUDENT',
            });
            navigate({ to: '/chat', search: { conversationId: conv.id } });
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'open-mentee-chat' },
                extra: { studentUserId: mentee.student_user_id },
                // A 403 here is permanent (chat off, or a role pair the institute
                // forbids) — "try again" would be a lie.
                fallbackMessage: describeDirectChatError(error, t('chatErrorFallback')),
            });
        } finally {
            setMessagingId(null);
        }
    };

    const columns = useMemo<ColumnDef<MenteeDTO>[]>(
        () => [
            {
                id: 'student',
                header: t('columnStudent'),
                size: 250,
                cell: ({ row }) => {
                    const m = row.original;
                    return (
                        <div className="flex min-w-0 items-center gap-3">
                            <MentorAvatar
                                fileId={m.profile_pic_file_id}
                                name={m.name}
                                className="size-9 shrink-0 text-caption"
                            />
                            <div className="flex min-w-0 flex-col">
                                <button
                                    type="button"
                                    onClick={() => setOpenMentee(m)}
                                    className="truncate text-left text-body font-medium text-neutral-700 hover:text-primary-600 hover:underline"
                                    title={t('openStudentProfileTitle')}
                                >
                                    {m.name || m.student_user_id}
                                </button>
                                {m.email && (
                                    <span className="truncate text-caption text-neutral-400">
                                        {m.email}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                },
            },
            {
                id: 'phone',
                header: t('columnPhone'),
                size: 140,
                cell: ({ row }) => (
                    <span className="text-body tabular-nums text-neutral-600">
                        {row.original.mobile_number || '—'}
                    </span>
                ),
            },
            {
                id: 'method',
                header: t('columnAssigned'),
                size: 130,
                cell: ({ row }) => (
                    <span className="text-caption text-neutral-500">
                        {row.original.assignment_method === 'ROUND_ROBIN'
                            ? t('assignmentAutoAssigned')
                            : t('assignmentAssigned')}
                    </span>
                ),
            },
            {
                id: 'actions',
                header: t('columnActions'),
                size: 150,
                cell: ({ row }) => {
                    const m = row.original;
                    const label = m.name || t('defaultStudentLabel');
                    return (
                        <div className="flex items-center gap-1">
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => setOpenMentee(m)}
                                aria-label={t('viewStudentAriaLabel', { name: label })}
                                title={t('viewStudentTitle')}
                            >
                                <Eye size={18} />
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => setScheduleFor(m)}
                                aria-label={t('scheduleSessionAriaLabel', { name: label })}
                                title={t('scheduleSessionTitle')}
                            >
                                <CalendarPlus size={18} />
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => message(m)}
                                disable={!chat.enabled || messagingId === m.student_user_id}
                                aria-label={t('messageStudentAriaLabel', { name: label })}
                                title={messageActionTitle(chat.enabled)}
                            >
                                <ChatCircle size={18} />
                            </MyButton>
                        </div>
                    );
                },
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [messagingId, chat.enabled, t]
    );

    if (isLoading) return <Skeleton className="h-24 w-full rounded-md" />;

    // The assign dialog lives outside the early return so it is reachable from
    // the empty state too — which used to just tell the admin to go somewhere
    // else ("assign students from the mentor list") with no way to get there.
    const assignDialog = instituteId ? (
        <AssignMenteesDialog
            instituteId={instituteId}
            mentor={mentor}
            open={assignOpen}
            onOpenChange={setAssignOpen}
        />
    ) : null;

    if (mentees.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
                <UsersThree size={32} className="text-neutral-300" />
                <p className="text-body font-medium text-neutral-700">
                    {t('emptyStudentsHeading')}
                </p>
                <p className="text-caption text-neutral-500">{t('emptyStudentsSubheading')}</p>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="small"
                    onClick={() => setAssignOpen(true)}
                    disable={!instituteId}
                >
                    <UserPlus size={16} /> {t('assignStudentsButton')}
                </MyButton>
                {assignDialog}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
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
                        inputPlaceholder={t('searchPlaceholder')}
                        className="pl-9 sm:w-full"
                    />
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-caption text-neutral-500">
                        {query
                            ? t('matchCount', { visible: visible.length, count: mentees.length })
                            : t('studentCount', { count: mentees.length })}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setAssignOpen(true)}
                        disable={!instituteId}
                    >
                        <UserPlus size={16} /> {t('assignStudentsButton')}
                    </MyButton>
                </div>
            </div>

            {visible.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
                    <MagnifyingGlass size={32} className="text-neutral-300" />
                    <p className="text-body font-medium text-neutral-700">
                        {t('noSearchMatch', { search: search.trim() })}
                    </p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setSearch('')}
                    >
                        {t('clearSearchButton')}
                    </MyButton>
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                    <MyTable<MenteeDTO>
                        data={{
                            content: visible,
                            total_pages: 1,
                            page_no: 0,
                            page_size: visible.length,
                            total_elements: visible.length,
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

            <MenteeDetailSheet
                mentee={openMentee}
                instituteId={instituteId}
                open={!!openMentee}
                onOpenChange={(o) => {
                    if (!o) setOpenMentee(null);
                }}
                mentor={mentor}
            />

            <ScheduleSessionDialog
                instituteId={instituteId}
                open={!!scheduleFor}
                onOpenChange={(o) => {
                    if (!o) setScheduleFor(null);
                }}
                mentor={mentor}
                student={
                    scheduleFor
                        ? { user_id: scheduleFor.student_user_id, name: scheduleFor.name }
                        : null
                }
            />

            {assignDialog}
        </div>
    );
}

function Breadcrumb({ name, t }: { name: string | null; t: TFunction }) {
    return (
        <nav className="flex items-center gap-1.5 text-caption text-neutral-400">
            <Link to="/mentorship/mentors" className="hover:text-primary-600">
                {t('breadcrumbMentorsLink')}
            </Link>
            <CaretRight size={11} weight="bold" />
            <span className="text-neutral-600">{name ?? t('breadcrumbDefaultLabel')}</span>
        </nav>
    );
}

function Fact({ label, value }: { label: string; value?: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-3 py-2">
            <dt className="shrink-0 text-caption text-neutral-500">{label}</dt>
            <dd className="min-w-0 text-right text-caption text-neutral-700">
                {value || <span className="text-neutral-300">—</span>}
            </dd>
        </div>
    );
}

const STAT_TONE = {
    primary: 'bg-primary-50 text-primary-500',
    info: 'bg-info-50 text-info-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
    danger: 'bg-danger-50 text-danger-600',
} as const;

function Stat({
    label,
    value,
    detail,
    icon: IconCmp,
    tone,
    onClick,
}: {
    label: string;
    value: number | string;
    detail?: string;
    icon: Icon;
    tone: keyof typeof STAT_TONE;
    onClick?: () => void;
}) {
    const body = (
        <>
            <span className="flex items-center gap-2 text-neutral-600">
                <span
                    className={cn(
                        'flex size-8 items-center justify-center rounded-lg',
                        STAT_TONE[tone]
                    )}
                >
                    <IconCmp size={16} weight="duotone" />
                </span>
                <span className="truncate text-caption font-medium">{label}</span>
            </span>
            <span className="text-h2 font-bold tabular-nums text-neutral-900">{value}</span>
            {detail && <span className="text-caption text-neutral-500">{detail}</span>}
        </>
    );
    const cls =
        'flex min-w-0 flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm';
    return onClick ? (
        <button
            type="button"
            onClick={onClick}
            className={cn(cls, 'transition-shadow hover:shadow-md')}
        >
            {body}
        </button>
    ) : (
        <div className={cls}>{body}</div>
    );
}

const DAY_LABEL_KEYS: Record<string, string> = {
    MONDAY: 'dayMonday',
    TUESDAY: 'dayTuesday',
    WEDNESDAY: 'dayWednesday',
    THURSDAY: 'dayThursday',
    FRIDAY: 'dayFriday',
    SATURDAY: 'daySaturday',
    SUNDAY: 'daySunday',
};

/** Every configured day, including the ones with no hours — the gaps are the point. */
function FullAvailability({
    page,
    t,
}: {
    page?: {
        availability?: {
            weekly_windows?: { day_of_week: string; start_time: string; end_time: string }[];
        } | null;
        duration_minutes?: number | null;
        timezone?: string | null;
    } | null;
    t: TFunction;
}) {
    const windows = page?.availability?.weekly_windows ?? [];

    return (
        <div className="flex flex-col gap-2">
            {DAY_ORDER.map((day) => {
                const ranges = windows.filter((w) => w.day_of_week === day);
                return (
                    <div
                        key={day}
                        className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2 last:border-0"
                    >
                        <span className="w-28 shrink-0 text-body capitalize text-neutral-600">
                            {t(DAY_LABEL_KEYS[day] ?? day)}
                        </span>
                        {ranges.length === 0 ? (
                            <span className="flex-1 text-caption text-neutral-300">
                                {t('unavailableLabel')}
                            </span>
                        ) : (
                            <span className="flex-1 text-caption text-neutral-700">
                                {ranges.map((r) => `${r.start_time} – ${r.end_time}`).join(', ')}
                            </span>
                        )}
                        <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-caption ${
                                ranges.length === 0
                                    ? 'bg-neutral-100 text-neutral-400'
                                    : 'bg-success-50 text-success-600'
                            }`}
                        >
                            {ranges.length === 0 ? t('unavailableLabel') : t('availableLabel')}
                        </span>
                    </div>
                );
            })}
            <span className="flex items-center gap-1.5 pt-1 text-caption text-neutral-400">
                <CalendarCheck size={12} />
                {page?.duration_minutes
                    ? t('sessionsLengthMinutes', { count: page.duration_minutes })
                    : t('defaultLength')}
                {page?.timezone ? ` · ${page.timezone}` : ''}
            </span>
        </div>
    );
}
