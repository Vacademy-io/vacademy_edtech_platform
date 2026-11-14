import { useEffect, useMemo, useState } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import {
    CalendarCheck,
    CalendarPlus,
    ChatCircle,
    CheckCircle,
    Clock,
    Copy,
    GoogleLogo,
    LinkSimple,
    MagnifyingGlass,
    NotePencil,
    Star,
    UserCircleCheck,
    UsersThree,
    WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { createDirectConversation, describeDirectChatError } from '@/services/chat/chatApi';
import { useMyMenteesPaged, useMyMentorProfile } from '../-hooks/use-mentorship';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { MyInput } from '@/components/design-system/input';
import type { ColumnDef } from '@tanstack/react-table';
import { StatStrip } from '@/components/shared/crm-enhance';
import { dayOfMonth, relativeDay, shortMonth, timeOfDay } from '../-utils/format-session-time';

const MENTEES_PAGE_SIZE = 20;
import { initiateMyGoogle } from '../-services/mentorship-service';
import type { MenteeDTO } from '../-types/mentorship-types';
import { MenteeDetailSheet } from '../-components/MenteeDetailSheet';
import { ScheduleSessionDialog } from '../-components/ScheduleSessionDialog';
import { AvailabilityDialog } from '../-components/AvailabilityDialog';
import { MyScheduleCard } from '../-components/MyScheduleCard';
import { MentorshipPageHeader } from '../-components/MentorshipPageHeader';
import { MentorAvatar } from '../-components/MentorAvatar';
import { RecordSessionDialog } from '../-components/RecordSessionDialog';
import { useMyAwaitingReview } from '../-hooks/use-mentorship';
import type { MentorSessionDTO } from '../-types/mentorship-types';
import { reportApiError } from '@/lib/report-api-error';
import { useChatEnabled } from '@/hooks/use-chat-enabled';
import { messageActionTitle } from '../-utils/chat-availability';

export const Route = createLazyFileRoute('/mentorship/my-mentorship/')({
    component: MyMentorshipRoute,
});

function MyMentorshipRoute() {
    return (
        <LayoutContainer>
            <MyMentorshipPage />
        </LayoutContainer>
    );
}

function MyMentorshipPage() {
    const { t, i18n } = useTranslation('mentorshipMyMentorshipIndex');
    const { t: tFormat } = useTranslation('mentorshipFormatSessionTimeUtils');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);

    const navigate = useNavigate();
    const instituteId = getInstituteId();
    const [menteePage, setMenteePage] = useState(0);
    const { data, isLoading, isError, refetch } = useMyMenteesPaged(
        instituteId,
        menteePage,
        MENTEES_PAGE_SIZE
    );
    const profileQuery = useMyMentorProfile(instituteId);
    const [messagingId, setMessagingId] = useState<string | null>(null);
    const [detailMentee, setDetailMentee] = useState<MenteeDTO | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [availabilityOpen, setAvailabilityOpen] = useState(false);
    const [recordSession, setRecordSession] = useState<MentorSessionDTO | null>(null);
    const [menteeSearch, setMenteeSearch] = useState('');
    const [scheduleFor, setScheduleFor] = useState<MenteeDTO | null>(null);
    // The header's "Schedule 1:1" opens the same dialog without a learner picked.
    const [scheduleAny, setScheduleAny] = useState(false);
    const awaitingReview = useMyAwaitingReview(instituteId);
    // In-App Messages is off until an institute switches it on. A mentor sees the
    // action disabled-and-explained rather than hidden, so they can ask for it.
    const chat = useChatEnabled();

    const profile = profileQuery.data;

    // Search filters the loaded page rather than asking the server: the mentee endpoint
    // takes no query, and a mentor's list is small enough that the page in hand is the
    // list. The count below always says which of the two the numbers refer to.
    const allMentees = useMemo(() => data?.content ?? [], [data?.content]);
    const menteeQuery = menteeSearch.trim().toLowerCase();
    const mentees = useMemo(
        () =>
            menteeQuery
                ? allMentees.filter((m) =>
                      [m.name, m.email, m.mobile_number].some((f) =>
                          (f ?? '').toLowerCase().includes(menteeQuery)
                      )
                  )
                : allMentees,
        [allMentees, menteeQuery]
    );

    const connectGoogle = async () => {
        if (!instituteId) return;
        setConnecting(true);
        try {
            const { oauth_url } = await initiateMyGoogle(instituteId);
            window.location.href = oauth_url;
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'connect-google' },
                fallbackMessage: t('connectGoogleError'),
            });
            setConnecting(false);
        }
    };

    const myBookingUrl = profile?.booking_page_slug
        ? `${BASE_URL_LEARNER_DASHBOARD}/booking-response?instituteId=${instituteId}&slug=${profile.booking_page_slug}`
        : null;

    const copyMyBookingLink = async () => {
        if (!myBookingUrl) return;
        try {
            await navigator.clipboard.writeText(myBookingUrl);
            toast.success(t('bookingLink.copiedToast'));
        } catch {
            toast.error(t('bookingLink.copyFailedToast'));
        }
    };

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
                fallbackMessage: describeDirectChatError(error, t('chatError')),
            });
        } finally {
            setMessagingId(null);
        }
    };

    const menteeColumns = useMemo<ColumnDef<MenteeDTO>[]>(
        () => [
            {
                id: 'student',
                header: t('table.student'),
                size: 240,
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
                                    onClick={() => setDetailMentee(m)}
                                    className="truncate text-left text-body font-medium text-neutral-700 hover:text-primary-600 hover:underline"
                                    title={t('table.openProfileTitle')}
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
                id: 'contact',
                header: t('table.phone'),
                size: 140,
                cell: ({ row }) => (
                    <span className="text-body tabular-nums text-neutral-600">
                        {row.original.mobile_number || '—'}
                    </span>
                ),
            },
            {
                id: 'assigned',
                header: t('table.assigned'),
                size: 120,
                cell: ({ row }) => (
                    <span className="text-caption text-neutral-500">
                        {row.original.assignment_method === 'ROUND_ROBIN'
                            ? t('table.autoAssigned')
                            : t('table.assigned')}
                    </span>
                ),
            },
            {
                id: 'actions',
                header: t('table.actions'),
                size: 150,
                cell: ({ row }) => {
                    const m = row.original;
                    const label = m.name || t('table.defaultStudentLabel');
                    return (
                        <div className="flex items-center gap-1">
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => setScheduleFor(m)}
                                aria-label={t('table.scheduleAriaLabel', { name: label })}
                                title={t('table.scheduleTitle')}
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
                                aria-label={t('table.messageAriaLabel', { name: label })}
                                title={messageActionTitle(chat.enabled)}
                            >
                                <ChatCircle size={18} />
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => setDetailMentee(m)}
                                aria-label={t('table.openAriaLabel', { name: label })}
                                title={t('table.openRowTitle')}
                            >
                                <NotePencil size={18} />
                            </MyButton>
                        </div>
                    );
                },
            },
        ],
        // `message` and the setters are stable for the row's purposes; only the
        // in-flight message id changes what a cell renders.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [messagingId, chat.enabled, t]
    );

    // The backend refuses every /my-* mentorship endpoint for someone who isn't a mentor
    // here, so an error means "wrong screen for you" far more often than "something
    // broke". Rendering the rest of the page anyway left a trail of empty cards and a red
    // alert; this says the one useful thing and points at the admin views instead.
    if (!profileQuery.isLoading && profileQuery.isError) {
        return (
            <div className="flex flex-col gap-6 p-6">
                <MentorshipPageHeader
                    title={t('pageTitle')}
                    subtitle={t('pageSubtitle')}
                    icon={UserCircleCheck}
                />
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
                    <UsersThree size={40} className="text-neutral-300" />
                    <div className="flex flex-col gap-1">
                        <p className="text-body font-medium text-neutral-700">
                            {t('notMentor.title')}
                        </p>
                        <p className="max-w-md text-caption text-neutral-500">
                            {t('notMentor.description')}
                        </p>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => profileQuery.refetch()}
                    >
                        {t('retry')}
                    </MyButton>
                </div>
            </div>
        );
    }

    const awaitingCount = awaitingReview.data?.length ?? 0;
    const myCap = profile?.max_mentees ?? null;
    const myAssigned = profile?.assigned_student_count ?? 0;
    const myRated = (profile?.rating_count ?? 0) > 0 && profile?.average_rating != null;

    return (
        <div className="flex flex-col gap-6 p-6">
            <MentorshipPageHeader
                title={t('pageTitle')}
                subtitle={t('pageSubtitle')}
                icon={UserCircleCheck}
            >
                {profile && (
                    <>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setAvailabilityOpen(true)}
                            title={t('bookingLink.editAvailabilityTitle')}
                        >
                            <Clock size={18} /> {t('bookingLink.editAvailability')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setScheduleAny(true)}
                            title={t('table.scheduleTitle')}
                        >
                            <CalendarPlus size={18} /> {t('header.schedule')}
                        </MyButton>
                    </>
                )}
            </MentorshipPageHeader>

            {profileQuery.isLoading && (
                <div className="flex flex-col gap-3">
                    <Skeleton className="h-16 w-full rounded-lg" />
                    <Skeleton className="h-16 w-full rounded-lg" />
                </div>
            )}


            {profile && (
                <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    {/* Who learners see when they open the booking link. */}
                    <div className="flex h-full flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-3">
                            <MentorAvatar
                                fileId={profile.profile_image_file_id}
                                name={profile.display_name || profile.name}
                                className="size-14 shrink-0 text-title"
                            />
                            <div className="flex min-w-0 flex-col">
                                <span className="truncate text-subtitle font-semibold text-neutral-900">
                                    {profile.display_name ||
                                        profile.name ||
                                        t('profile.youFallback')}
                                </span>
                                <span className="truncate text-caption text-neutral-500">
                                    {profile.title || t('profile.mentorFallback')}
                                </span>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <span className="rounded-full bg-primary-50 px-2.5 py-1 text-caption font-medium text-primary-600">
                                {t('profile.menteesAssigned', {
                                    count: profile.assigned_student_count ?? 0,
                                })}
                            </span>
                            {myRated && (
                                <span className="flex items-center gap-1 rounded-full bg-warning-50 px-2.5 py-1 text-caption font-medium text-warning-700">
                                    <Star size={12} weight="fill" />
                                    {t('profile.ratingChip', {
                                        rating: (profile.average_rating ?? 0).toFixed(1),
                                        count: profile.rating_count ?? 0,
                                    })}
                                </span>
                            )}
                        </div>
                        {(profile.expertise_tags?.length ?? 0) > 0 && (
                            <span className="text-caption text-neutral-500">
                                {t('profile.expertise', {
                                    tags: (profile.expertise_tags ?? []).join(', '),
                                })}
                            </span>
                        )}
                    </div>

                    {/* Stacked, not side-by-side: at a third of the row an inline
                        layout cannot shrink a Google address or a booking URL, and
                        both were being cut off mid-word. */}
                    <div className="flex h-full flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-3">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50">
                                <GoogleLogo size={20} weight="bold" className="text-primary-600" />
                            </span>
                            <span className="min-w-0 flex-1 text-body font-medium text-neutral-700">
                                {t('googleCalendar.title')}
                            </span>
                            {profile.google_connected && (
                                <span className="flex shrink-0 items-center gap-1 rounded-full bg-success-50 px-2.5 py-1 text-caption text-success-600">
                                    <CheckCircle size={14} weight="fill" />{' '}
                                    {t('googleCalendar.connected')}
                                </span>
                            )}
                        </div>
                        <p className="text-caption text-neutral-500">
                            {profile.google_connected
                                ? t('googleCalendar.connectedDescription')
                                : t('googleCalendar.disconnectedDescription')}
                        </p>
                        {profile.google_connected ? (
                            profile.google_email && (
                                <span className="truncate text-caption text-neutral-400">
                                    {profile.google_email}
                                </span>
                            )
                        ) : (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="small"
                                className="mt-auto w-fit"
                                onClick={connectGoogle}
                                disable={connecting}
                            >
                                {connecting ? t('googleCalendar.redirecting') : t('googleCalendar.connect')}
                            </MyButton>
                        )}
                    </div>

                    <div className="flex h-full flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-3">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50">
                                <CalendarCheck
                                    size={20}
                                    weight="bold"
                                    className="text-primary-600"
                                />
                            </span>
                            <span className="min-w-0 flex-1 text-body font-medium text-neutral-700">
                                {t('bookingLink.title')}
                            </span>
                        </div>
                        <p className="text-caption text-neutral-500">
                            {myBookingUrl
                                ? t('bookingLink.shareDescription')
                                : t('bookingLink.notSetUpDescription')}
                        </p>
                        {myBookingUrl && (
                            <span className="flex min-w-0 items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-caption text-neutral-500">
                                <LinkSimple size={12} className="shrink-0" />
                                <span className="truncate" title={myBookingUrl}>
                                    {myBookingUrl}
                                </span>
                            </span>
                        )}
                        <div className="mt-auto flex flex-wrap items-center gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setAvailabilityOpen(true)}
                                title={t('bookingLink.editAvailabilityTitle')}
                            >
                                <Clock size={16} /> {t('bookingLink.editAvailability')}
                            </MyButton>
                            {myBookingUrl && (
                                <>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={copyMyBookingLink}
                                        title={t('bookingLink.copyLinkTitle')}
                                    >
                                        <Copy size={16} /> {t('bookingLink.copyLink')}
                                    </MyButton>
                                    <a
                                        href={myBookingUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-caption font-medium text-primary-500 hover:text-primary-600"
                                        title={t('bookingLink.openTitle')}
                                    >
                                        {t('bookingLink.open')}
                                    </a>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {profile && (
                <StatStrip
                    items={[
                        {
                            key: 'mentees',
                            icon: UsersThree,
                            label: t('kpi.mentees'),
                            value: myAssigned,
                            detail: myCap
                                ? t('kpi.menteesLeft', {
                                      count: Math.max(0, myCap - myAssigned),
                                      cap: myCap,
                                  })
                                : t('kpi.menteesNoLimit'),
                        },
                        {
                            key: 'rating',
                            icon: Star,
                            tint: 'warning',
                            label: t('kpi.rating'),
                            value: myRated ? (profile.average_rating ?? 0).toFixed(1) : '—',
                            detail: myRated
                                ? t('kpi.ratingDetail', { count: profile.rating_count ?? 0 })
                                : t('kpi.ratingNone'),
                        },
                        {
                            key: 'record',
                            icon: NotePencil,
                            tint: awaitingCount > 0 ? 'danger' : 'success',
                            label: t('kpi.toRecord'),
                            value: awaitingCount,
                            detail: t('kpi.toRecordDetail'),
                            loading: awaitingReview.isLoading,
                        },
                    ]}
                />
            )}

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2">
                <MyScheduleCard instituteId={instituteId} />

                {awaitingCount > 0 && (
                    <div className="flex flex-col gap-3 rounded-xl border border-warning-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-start gap-2">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning-50 text-warning-600">
                                    <NotePencil size={16} weight="duotone" />
                                </span>
                                <div className="flex min-w-0 flex-col">
                                    <span className="text-body font-semibold text-neutral-700">
                                        {t('awaitingReview.heading', {
                                            count: awaitingCount,
                                        })}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {t('awaitingReview.description')}
                                    </span>
                                </div>
                            </div>
                            <span className="shrink-0 rounded-full bg-danger-50 px-2 py-0.5 text-caption font-medium text-danger-600">
                                {t('awaitingReview.notCounted')}
                            </span>
                        </div>
                        <div className="flex flex-col divide-y divide-neutral-100">
                            {(awaitingReview.data ?? []).slice(0, 5).map((session) => (
                                <div
                                    key={session.booking_instance_id}
                                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 leading-none text-neutral-600">
                                            <span className="text-body font-semibold tabular-nums">
                                                {dayOfMonth(session.scheduled_start_utc)}
                                            </span>
                                            <span className="text-caption font-medium text-neutral-400">
                                                {shortMonth(
                                                    session.scheduled_start_utc,
                                                    i18n.language
                                                )}
                                            </span>
                                        </span>
                                        <div className="flex min-w-0 flex-col">
                                            <span className="truncate text-body text-neutral-700">
                                                {session.student_name ||
                                                    t('awaitingReview.menteeFallback')}
                                            </span>
                                            <span className="truncate text-caption text-neutral-400">
                                                {session.scheduled_start_utc
                                                    ? `${relativeDay(session.scheduled_start_utc, tFormat, i18n.language)} · ${timeOfDay(session.scheduled_start_utc, i18n.language)}`
                                                    : ''}
                                            </span>
                                        </div>
                                    </div>
                                    <MyButton
                                        type="button"
                                        buttonType="primary"
                                        scale="small"
                                        onClick={() => setRecordSession(session)}
                                    >
                                        {t('awaitingReview.record')}
                                    </MyButton>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex flex-col">
                        <h3 className="flex items-center gap-2 text-title font-semibold text-neutral-700">
                            {t('mentees.heading')}
                            {!isLoading && !isError && (
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-medium text-neutral-500">
                                    {menteeQuery
                                        ? t('mentees.filteredCount', {
                                              count: mentees.length,
                                              total: allMentees.length,
                                          })
                                        : data?.total_elements ?? allMentees.length}
                                </span>
                            )}
                        </h3>
                        <p className="text-caption text-neutral-500">{t('mentees.subtitle')}</p>
                    </div>
                    <div className="relative w-full sm:w-72">
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                        />
                        <MyInput
                            input={menteeSearch}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                setMenteeSearch(e.target.value)
                            }
                            inputType="text"
                            inputPlaceholder={t('mentees.searchPlaceholder')}
                            className="pl-9 sm:w-full"
                        />
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex flex-col gap-3">
                        {[1, 2].map((i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4"
                            >
                                <div className="flex items-center gap-3">
                                    <Skeleton className="size-10 rounded-full" />
                                    <div className="flex flex-col gap-1.5">
                                        <Skeleton className="h-3.5 w-32" />
                                        <Skeleton className="h-3 w-24" />
                                    </div>
                                </div>
                                <Skeleton className="h-8 w-40" />
                            </div>
                        ))}
                    </div>
                ) : isError ? (
                    <div className="flex flex-col items-start gap-3 rounded-lg border border-danger-100 bg-danger-50 p-4">
                        <div className="flex items-center gap-2">
                            <WarningCircle size={18} weight="fill" className="text-danger-600" />
                            <p className="text-body text-danger-600">{t('mentees.loadError')}</p>
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
                ) : allMentees.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
                        <UsersThree size={40} className="text-neutral-300" />
                        <div className="flex flex-col gap-1">
                            <p className="text-body font-medium text-neutral-700">
                                {t('mentees.emptyTitle')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('mentees.emptyDescription')}
                            </p>
                        </div>
                    </div>
                ) : mentees.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
                        <MagnifyingGlass size={32} className="text-neutral-300" />
                        <p className="text-body font-medium text-neutral-700">
                            {t('mentees.noSearchMatch', { query: menteeSearch.trim() })}
                        </p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setMenteeSearch('')}
                        >
                            {t('mentees.clearSearch')}
                        </MyButton>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                            <MyTable<MenteeDTO>
                                data={{
                                    content: mentees,
                                    total_pages: data?.total_pages ?? 1,
                                    page_no: menteePage,
                                    page_size: MENTEES_PAGE_SIZE,
                                    total_elements: data?.total_elements ?? mentees.length,
                                    last: data?.last ?? true,
                                }}
                                columns={menteeColumns}
                                isLoading={false}
                                error={null}
                                currentPage={menteePage}
                                scrollable
                            />
                        </div>
                        {!menteeQuery && (data?.total_pages ?? 0) > 1 && (
                            <MyPagination
                                currentPage={menteePage}
                                totalPages={data?.total_pages ?? 1}
                                onPageChange={setMenteePage}
                            />
                        )}
                    </div>
                )}
            </div>

            <MenteeDetailSheet
                mentee={detailMentee}
                instituteId={instituteId}
                open={!!detailMentee}
                onOpenChange={(o) => {
                    if (!o) setDetailMentee(null);
                }}
                asMentor
                mentorSlug={profile?.booking_page_slug}
            />

            <ScheduleSessionDialog
                instituteId={instituteId}
                open={!!scheduleFor || scheduleAny}
                onOpenChange={(o) => {
                    if (!o) {
                        setScheduleFor(null);
                        setScheduleAny(false);
                    }
                }}
                asMentor
                mentorSlug={profile?.booking_page_slug}
                student={
                    scheduleFor
                        ? { user_id: scheduleFor.student_user_id, name: scheduleFor.name }
                        : null
                }
            />

            <RecordSessionDialog
                session={recordSession}
                instituteId={instituteId}
                open={!!recordSession}
                onOpenChange={(o) => {
                    if (!o) setRecordSession(null);
                }}
            />

            <AvailabilityDialog
                instituteId={instituteId}
                open={availabilityOpen}
                onOpenChange={setAvailabilityOpen}
            />
        </div>
    );
}
