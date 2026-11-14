import { useEffect, useMemo, useState } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import {
    ArrowSquareOut,
    CalendarCheck,
    CalendarPlus,
    Copy,
    DotsThreeVertical,
    Eye,
    Info,
    MagnifyingGlass,
    NotePencil,
    Plus,
    Star,
    Trash,
    UserPlus,
    UsersThree,
    WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import {
    useDeleteMentor,
    useMentorDashboard,
    useMentorSessions,
    useMentorsPaged,
    useProvisionBookingPage,
} from '../-hooks/use-mentorship';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { StatusChips } from '@/components/design-system/chips';
import type { ColumnDef } from '@tanstack/react-table';
import { reportApiError } from '@/lib/report-api-error';

const MENTORS_PAGE_SIZE = 20;

// Empty selection means "all", so no 'any' member is needed — see MentorFilters.
const buildStatusOptions = (t: TFunction) => [
    { label: t('statusOptionActive'), value: 'active' },
    { label: t('statusOptionInactive'), value: 'inactive' },
];
const buildDiscoverableOptions = (t: TFunction) => [
    { label: t('discoverableOptionListed'), value: 'listed' },
    { label: t('discoverableOptionHidden'), value: 'hidden' },
];
const buildCapacityOptions = (t: TFunction) => [
    { label: t('capacityOptionAvailable'), value: 'available' },
    { label: t('capacityOptionFull'), value: 'full' },
    { label: t('capacityOptionNoBooking'), value: 'no-booking' },
];
import type { MentorDTO } from '../-types/mentorship-types';
import { AddMentorDialog } from '../-components/AddMentorDialog';
import { AssignMenteesDialog } from '../-components/AssignMenteesDialog';
import { BulkAssignDialog } from '../-components/BulkAssignDialog';
import { MentorAvatar } from '../-components/MentorAvatar';
import { EditMentorDialog } from '../-components/EditMentorDialog';
import { MentorFeedbackDialog } from '../-components/MentorFeedbackDialog';
import { MentorshipPageHeader } from '../-components/MentorshipPageHeader';
import { CapacityChip, CapacityMeter, RatingChip } from '../-components/MentorChips';
import { MyInput } from '@/components/design-system/input';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import { QuickViews, type QuickView } from '@/components/shared/crm-enhance';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import {
    applyMentorFilters,
    DEFAULT_MENTOR_FILTERS,
    isDefaultMentorFilters,
    type MentorFilters,
} from '../-utils/filter-mentors';
import { ScheduleSessionDialog } from '../-components/ScheduleSessionDialog';

export const Route = createLazyFileRoute('/mentorship/mentors/')({
    component: MentorsRoute,
});

function MentorsRoute() {
    return (
        <LayoutContainer>
            <MentorsPage />
        </LayoutContainer>
    );
}

function MentorsPage() {
    const { t } = useTranslation('mentorshipMentorsIndex');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setNavHeading]);

    const instituteId = getInstituteId();
    const { data, isLoading, isError, refetch } = useMentorDashboard(instituteId);
    // The visible list is paginated; the dashboard keeps stats + the full list for dialogs.
    const [page, setPage] = useState(0);
    const mentorsPage = useMentorsPaged(instituteId, page, MENTORS_PAGE_SIZE);
    const pagedMentors = mentorsPage.data?.content ?? [];
    const deleteMentor = useDeleteMentor();
    const provisionBooking = useProvisionBookingPage();

    const navigate = useNavigate();
    /** One mentor gets their own URL, so a detail view is shareable and the back button works. */
    const openMentor = (m: MentorDTO) =>
        navigate({ to: '/mentorship/mentors/$mentorId', params: { mentorId: m.id } });

    const [addOpen, setAddOpen] = useState(false);
    const [filters, setFilters] = useState<MentorFilters>(DEFAULT_MENTOR_FILTERS);
    const [scheduleMentor, setScheduleMentor] = useState<MentorDTO | null>(null);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const search = filters.search;
    const setFilter = <K extends keyof MentorFilters>(key: K, value: MentorFilters[K]) =>
        // Any filter change starts the list over: staying on page 4 of an unfiltered
        // list after narrowing to two mentors shows an empty table.
        setFilters((f) => ({ ...f, [key]: value }));
    const [editMentor, setEditMentor] = useState<MentorDTO | null>(null);
    const [feedbackMentor, setFeedbackMentor] = useState<MentorDTO | null>(null);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [assignMentor, setAssignMentor] = useState<MentorDTO | null>(null);
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<MentorDTO | null>(null);

    const statusOptions = useMemo(() => buildStatusOptions(t), [t]);
    const discoverableOptions = useMemo(() => buildDiscoverableOptions(t), [t]);
    const capacityOptions = useMemo(() => buildCapacityOptions(t), [t]);

    const mentors = data?.mentors ?? [];

    // Any active filter switches from the server-paginated page to a filter over the
    // full mentor list the dashboard already loaded — a page-local filter would
    // silently hide matches sitting on other pages.
    const searching = !isDefaultMentorFilters(filters);
    const visibleMentors = searching ? applyMentorFilters(mentors, filters) : pagedMentors;

    // Quick views: counts over the full mentor list the dashboard already loaded, each
    // one a preset of the same filters below — so a count and its list always agree.
    // Built every render (not memoised) so the labels follow a language switch.
    const facetOnly = (f: Partial<MentorFilters>): MentorFilters => ({
        ...DEFAULT_MENTOR_FILTERS,
        search: filters.search,
        ...f,
    });
    const sameFacets = (a: MentorFilters, b: MentorFilters) =>
        a.status.join() === b.status.join() &&
        a.discoverable.join() === b.discoverable.join() &&
        a.capacity.join() === b.capacity.join();
    const quickViewDefs: Array<{
        key: string;
        label: string;
        preset: MentorFilters;
        tone?: QuickView['tone'];
    }> = [
        { key: 'all', label: t('quickViewAll'), preset: facetOnly({}) },
        {
            key: 'active',
            label: t('quickViewActive'),
            preset: facetOnly({ status: ['active'] }),
            tone: 'success',
        },
        {
            key: 'inactive',
            label: t('quickViewInactive'),
            preset: facetOnly({ status: ['inactive'] }),
        },
        {
            key: 'listed',
            label: t('quickViewListed'),
            preset: facetOnly({ discoverable: ['listed'] }),
            tone: 'info',
        },
        {
            key: 'full',
            label: t('quickViewFull'),
            preset: facetOnly({ capacity: ['full'] }),
            tone: 'danger',
        },
        {
            key: 'noBooking',
            label: t('quickViewNoBooking'),
            preset: facetOnly({ capacity: ['no-booking'] }),
            tone: 'warning',
        },
    ];
    const quickViews: QuickView[] = quickViewDefs.map((v) => ({
        key: v.key,
        label: v.label,
        tone: v.tone,
        count: applyMentorFilters(mentors, { ...v.preset, search: '' }).length,
        active: sameFacets(filters, v.preset),
        onSelect: () => {
            setFilters(v.preset);
            setPage(0);
        },
    }));

    // Upcoming load per mentor, from the sessions endpoint the dashboard already
    // uses. The mentor row is where an admin decides who to assign next, so "how
    // busy are they" belongs here and not one click away.
    const upcomingSessions = useMentorSessions(instituteId, { lifecycle: 'UPCOMING' });
    const upcomingByMentor = useMemo(() => {
        const acc: Record<string, number> = {};
        for (const s of upcomingSessions.data ?? []) {
            if (s.mentor_id) acc[s.mentor_id] = (acc[s.mentor_id] ?? 0) + 1;
        }
        return acc;
    }, [upcomingSessions.data]);

    const remove = async (m: MentorDTO) => {
        if (!instituteId) return;
        try {
            await deleteMentor.mutateAsync({ id: m.id, instituteId });
            toast.success(t('toastMentorRemoved'));
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'remove-mentor' },
                extra: { mentorId: m.id, assignedStudents: m.assigned_student_count },
                fallbackMessage: t('errorRemoveMentor'),
            });
        }
    };

    const enableBooking = async (m: MentorDTO) => {
        if (!instituteId) return;
        setBookingId(m.id);
        try {
            await provisionBooking.mutateAsync({ id: m.id, instituteId });
            toast.success(t('toastBookingPageSetUp'));
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'provision-booking-page' },
                extra: { mentorId: m.id },
                fallbackMessage: t('errorSetUpBookingPage'),
            });
        } finally {
            setBookingId(null);
        }
    };

    const totalCount = searching
        ? visibleMentors.length
        : mentorsPage.data?.total_elements ?? visibleMentors.length;
    const rangeStart =
        visibleMentors.length === 0 ? 0 : searching ? 1 : page * MENTORS_PAGE_SIZE + 1;
    const rangeEnd = searching
        ? visibleMentors.length
        : page * MENTORS_PAGE_SIZE + visibleMentors.length;

    /** Public 1:1 booking link an admin can share for this mentor. */
    const bookingUrl = (m: MentorDTO): string =>
        `${BASE_URL_LEARNER_DASHBOARD}/booking-response?instituteId=${instituteId}&slug=${m.booking_page_slug}`;

    const copyBookingLink = async (m: MentorDTO) => {
        try {
            await navigator.clipboard.writeText(bookingUrl(m));
            toast.success(t('toastBookingLinkCopied'));
        } catch {
            toast.error(t('errorCopyLink'));
        }
    };

    const columns = useMemo<ColumnDef<MentorDTO>[]>(
        () => [
            {
                id: 'mentor',
                header: t('columnMentor'),
                size: 230,
                cell: ({ row }) => {
                    const m = row.original;
                    return (
                        <div className="flex min-w-0 items-center gap-3">
                            <MentorAvatar
                                fileId={m.profile_image_file_id}
                                name={m.display_name || m.name}
                                className="size-9 shrink-0 text-caption"
                            />
                            <div className="flex min-w-0 flex-col">
                                <button
                                    type="button"
                                    onClick={() => openMentor(m)}
                                    className="truncate text-left text-body font-medium text-neutral-700 hover:text-primary-600 hover:underline"
                                    title={t('openMentorProfileTitle')}
                                >
                                    {m.display_name || m.name || t('mentorFallback')}
                                </button>
                                <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate text-caption text-neutral-400">
                                        {m.title || m.email || ''}
                                    </span>
                                    <RatingChip mentor={m} onClick={() => setFeedbackMentor(m)} />
                                </span>
                            </div>
                        </div>
                    );
                },
            },
            {
                id: 'expertise',
                header: t('columnExpertise'),
                size: 150,
                cell: ({ row }) => {
                    const tags = row.original.expertise_tags ?? [];
                    if (tags.length === 0) {
                        return <span className="text-caption text-neutral-300">—</span>;
                    }
                    return (
                        <span
                            className="line-clamp-2 text-caption text-neutral-600"
                            title={tags.join(', ')}
                        >
                            {tags.join(', ')}
                        </span>
                    );
                },
            },
            {
                id: 'assigned',
                header: t('columnAssignedStudents'),
                size: 130,
                cell: ({ row }) => <CapacityChip mentor={row.original} />,
            },
            {
                id: 'upcoming',
                header: t('columnUpcomingSessions'),
                size: 140,
                cell: ({ row }) => (
                    <span className="text-body tabular-nums text-neutral-700">
                        {upcomingByMentor[row.original.id] ?? 0}
                    </span>
                ),
            },
            {
                id: 'capacity',
                header: t('columnCapacity'),
                size: 130,
                cell: ({ row }) => <CapacityMeter mentor={row.original} />,
            },
            {
                id: 'status',
                header: t('columnStatus'),
                size: 100,
                cell: ({ row }) => (
                    <div className="flex flex-col items-start gap-1">
                        <StatusChips
                            status={
                                (row.original.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
                                    ? 'ACTIVE'
                                    : 'INACTIVE'
                            }
                        >
                            {(row.original.status || 'ACTIVE').toLowerCase()}
                        </StatusChips>
                        <span className="text-caption text-neutral-400">
                            {row.original.is_discoverable ? t('statusListed') : t('statusHidden')}
                            {!row.original.booking_page_slug && (
                                <span className="text-warning-600">
                                    {' · '}
                                    {t('statusNoBookingPage')}
                                </span>
                            )}
                        </span>
                    </div>
                ),
            },
            {
                id: 'actions',
                header: t('columnActions'),
                size: 130,
                cell: ({ row }) => {
                    const m = row.original;
                    const label = m.display_name || m.name || t('mentorFallbackLower');
                    return (
                        <div className="flex items-center gap-1">
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => openMentor(m)}
                                aria-label={t('viewMentorAriaLabel', { name: label })}
                                title={t('viewMentorTitle')}
                            >
                                <Eye size={18} />
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => setAssignMentor(m)}
                                aria-label={t('assignStudentsAriaLabel', { name: label })}
                                title={t('assignStudentsTitle')}
                            >
                                {/* Not UsersThree: that icon is the header's
                                    "Bulk assign", and one icon for two different
                                    actions is what made this row unreadable. */}
                                <UserPlus size={18} />
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => {
                                    setScheduleMentor(m);
                                    setScheduleOpen(true);
                                }}
                                aria-label={t('scheduleSessionAriaLabel', { name: label })}
                                title={t('scheduleSessionTitle')}
                            >
                                <CalendarPlus size={18} />
                            </MyButton>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        layoutVariant="icon"
                                        aria-label={t('moreActionsAriaLabel', { name: label })}
                                    >
                                        <DotsThreeVertical size={18} weight="bold" />
                                    </MyButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                    <DropdownMenuItem
                                        className="gap-2"
                                        onClick={() => setEditMentor(m)}
                                    >
                                        <NotePencil size={16} /> {t('editProfileMenuItem')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="gap-2"
                                        onClick={() => setFeedbackMentor(m)}
                                    >
                                        <Star size={16} /> {t('sessionFeedbackMenuItem')}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {m.booking_page_slug ? (
                                        <>
                                            <DropdownMenuItem
                                                className="gap-2"
                                                onClick={() => copyBookingLink(m)}
                                            >
                                                <Copy size={16} /> {t('copyBookingLinkMenuItem')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="gap-2"
                                                onClick={() =>
                                                    window.open(
                                                        bookingUrl(m),
                                                        '_blank',
                                                        'noopener,noreferrer'
                                                    )
                                                }
                                            >
                                                <ArrowSquareOut size={16} />{' '}
                                                {t('openBookingPageMenuItem')}
                                            </DropdownMenuItem>
                                        </>
                                    ) : (
                                        <DropdownMenuItem
                                            className="gap-2"
                                            disabled={bookingId === m.id}
                                            onClick={() => enableBooking(m)}
                                        >
                                            <CalendarCheck size={16} /> {t('enableBookingMenuItem')}
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="gap-2 text-danger-600 focus:text-danger-600"
                                        onClick={() => setConfirmRemove(m)}
                                    >
                                        <Trash size={16} /> {t('removeMentorMenuItem')}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    );
                },
            },
        ],
        // The cells close over setState setters and `navigate`, all of which are
        // stable; the values that actually change what a cell renders are listed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [upcomingByMentor, bookingId, instituteId, t]
    );

    return (
        <div className="flex flex-col gap-6 p-6">
            <MentorshipPageHeader
                title={t('pageTitle')}
                subtitle={t('pageSubtitle')}
                icon={UsersThree}
            >
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => setBulkOpen(true)}
                    disable={mentors.length === 0}
                    title={mentors.length === 0 ? t('bulkAssignDisabledTitle') : t('bulkAssignTitle')}
                >
                    <UsersThree size={18} /> {t('bulkAssignButton')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => {
                        setScheduleMentor(null);
                        setScheduleOpen(true);
                    }}
                    disable={mentors.length === 0}
                    title={
                        mentors.length === 0
                            ? t('scheduleOneOnOneDisabledTitle')
                            : t('scheduleOneOnOneTitle')
                    }
                >
                    <CalendarPlus size={18} /> {t('scheduleOneOnOneButton')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    onClick={() => setAddOpen(true)}
                >
                    <Plus size={18} /> {t('addMentorButton')}
                </MyButton>
            </MentorshipPageHeader>

            {!isLoading && !isError && mentors.length > 0 && <QuickViews views={quickViews} />}

            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative w-full sm:w-80">
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                        />
                        <MyInput
                            input={search}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) => {
                                setFilter('search', e.target.value);
                                setPage(0);
                            }}
                            inputType="text"
                            inputPlaceholder={t('searchPlaceholder')}
                            className="pl-9 sm:w-full"
                        />
                    </div>
                    <MultiSelectFilter
                        label={t('statusFilterLabel')}
                        options={statusOptions}
                        selected={filters.status}
                        onChange={(v) => {
                            setFilter('status', v);
                            setPage(0);
                        }}
                    />
                    <MultiSelectFilter
                        label={t('visibilityFilterLabel')}
                        options={discoverableOptions}
                        selected={filters.discoverable}
                        onChange={(v) => {
                            setFilter('discoverable', v);
                            setPage(0);
                        }}
                    />
                    <MultiSelectFilter
                        label={t('capacityFilterLabel')}
                        options={capacityOptions}
                        selected={filters.capacity}
                        onChange={(v) => {
                            setFilter('capacity', v);
                            setPage(0);
                        }}
                    />
                </div>
                {searching && (
                    <span className="text-caption text-neutral-500">
                        {t('filterMatchCount', {
                            visible: visibleMentors.length,
                            count: mentors.length,
                        })}
                        {' · '}
                        <button
                            type="button"
                            className="font-medium text-primary-500 hover:text-primary-600"
                            onClick={() => setFilters(DEFAULT_MENTOR_FILTERS)}
                        >
                            {t('clearFiltersButton')}
                        </button>
                    </span>
                )}

                {isLoading || mentorsPage.isLoading ? (
                    <div className="flex flex-col gap-3">
                        {[1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4"
                            >
                                <div className="flex items-center gap-3">
                                    <Skeleton className="size-10 rounded-full" />
                                    <div className="flex flex-col gap-1.5">
                                        <Skeleton className="h-3.5 w-32" />
                                        <Skeleton className="h-3 w-20" />
                                    </div>
                                </div>
                                <Skeleton className="h-8 w-24" />
                            </div>
                        ))}
                    </div>
                ) : isError || mentorsPage.isError ? (
                    <div className="flex flex-col items-start gap-3 rounded-lg border border-danger-100 bg-danger-50 p-4">
                        <div className="flex items-center gap-2">
                            <WarningCircle size={18} weight="fill" className="text-danger-600" />
                            <p className="text-body text-danger-600">{t('errorLoadMentors')}</p>
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => {
                                refetch();
                                mentorsPage.refetch();
                            }}
                        >
                            {t('retryButton')}
                        </MyButton>
                    </div>
                ) : pagedMentors.length === 0 && mentors.length === 0 ? (
                    <EmptyMentors t={t} onAdd={() => setAddOpen(true)} />
                ) : visibleMentors.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
                        <MagnifyingGlass size={32} className="text-neutral-300" />
                        <p className="text-body font-medium text-neutral-700">
                            {t('noMentorsMatchSearch', { search: search.trim() })}
                        </p>
                        <p className="text-caption text-neutral-500">{t('noMentorsMatchHint')}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                            <MyTable<MentorDTO>
                                data={{
                                    content: visibleMentors,
                                    total_pages: searching ? 1 : mentorsPage.data?.total_pages ?? 1,
                                    page_no: searching ? 0 : page,
                                    page_size: MENTORS_PAGE_SIZE,
                                    total_elements: totalCount,
                                    last: searching ? true : mentorsPage.data?.last ?? true,
                                }}
                                columns={columns}
                                isLoading={false}
                                error={null}
                                currentPage={searching ? 0 : page}
                                scrollable
                            />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-caption text-neutral-500">
                                {t('resultsSummary', {
                                    start: rangeStart,
                                    end: rangeEnd,
                                    count: totalCount,
                                })}
                            </span>
                            {!searching && (mentorsPage.data?.total_pages ?? 0) > 1 && (
                                <MyPagination
                                    currentPage={page}
                                    totalPages={mentorsPage.data?.total_pages ?? 1}
                                    onPageChange={setPage}
                                />
                            )}
                        </div>
                    </div>
                )}
            </div>

            <p className="flex items-start gap-2 rounded-lg border border-info-100 bg-info-50 px-3 py-2 text-caption text-neutral-600">
                <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                {t('listNote', { learners: instituteTerms().learners.toLowerCase() })}
            </p>

            {instituteId && (
                <AddMentorDialog
                    instituteId={instituteId}
                    open={addOpen}
                    onOpenChange={setAddOpen}
                />
            )}
            {instituteId && (
                <EditMentorDialog
                    instituteId={instituteId}
                    mentor={editMentor}
                    open={!!editMentor}
                    onOpenChange={(o) => {
                        if (!o) setEditMentor(null);
                    }}
                />
            )}
            <MentorFeedbackDialog
                mentor={feedbackMentor}
                instituteId={instituteId}
                open={!!feedbackMentor}
                onOpenChange={(o) => {
                    if (!o) setFeedbackMentor(null);
                }}
            />
            {instituteId && (
                <BulkAssignDialog
                    instituteId={instituteId}
                    mentors={mentors}
                    open={bulkOpen}
                    onOpenChange={setBulkOpen}
                />
            )}
            {instituteId && (
                <AssignMenteesDialog
                    instituteId={instituteId}
                    mentor={assignMentor}
                    open={!!assignMentor}
                    onOpenChange={(o) => {
                        if (!o) setAssignMentor(null);
                    }}
                />
            )}

            <ScheduleSessionDialog
                instituteId={instituteId}
                open={scheduleOpen}
                onOpenChange={(o) => {
                    setScheduleOpen(o);
                    if (!o) setScheduleMentor(null);
                }}
                mentor={scheduleMentor}
            />

            <AlertDialog
                open={!!confirmRemove}
                onOpenChange={(o) => {
                    if (!o) setConfirmRemove(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('removeMentorConfirmTitle', {
                                name:
                                    confirmRemove?.display_name ||
                                    confirmRemove?.name ||
                                    t('mentorFallback'),
                            })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmRemove?.assigned_student_count
                                ? t('removeMentorUnassignNote', {
                                      count: confirmRemove.assigned_student_count,
                                  })
                                : ''}
                            {t('removeMentorConfirmBody')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('cancelButton')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-500 hover:bg-danger-600"
                            onClick={() => {
                                if (confirmRemove) void remove(confirmRemove);
                                setConfirmRemove(null);
                            }}
                        >
                            {t('removeMentorButton')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function EmptyMentors({ t, onAdd }: { t: TFunction; onAdd: () => void }) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-200 p-10 text-center">
            <UsersThree size={40} className="text-neutral-300" />
            <div className="flex flex-col gap-1">
                <p className="text-body font-medium text-neutral-700">{t('emptyMentorsHeading')}</p>
                <p className="text-caption text-neutral-500">{t('emptyMentorsSubheading')}</p>
            </div>
            <MyButton type="button" buttonType="primary" scale="medium" onClick={onAdd}>
                <Plus size={18} /> {t('addFirstMentorButton')}
            </MyButton>
        </div>
    );
}
