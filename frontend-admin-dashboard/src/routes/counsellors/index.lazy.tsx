import { createLazyFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { ShiftsTodayCard } from './-components/ShiftsTodayCard';
import { CounsellorsEnhancedHeader } from './-components/CounsellorsEnhancedHeader';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
    MagnifyingGlass,
    User,
    UsersThree,
    ChatCircleText,
    ArrowsClockwise,
    Crown,
    ChartLineUp,
    Phone,
    SquaresFour,
    List as ListIcon,
    Sparkle,
    Target,
} from '@phosphor-icons/react';
import { CounsellorLeadsTab } from './-components/CounsellorLeadsTab';
import { CounsellorActivityTab } from './-components/CounsellorActivityTab';
import { CounsellorCallsTab } from './-components/CounsellorCallsTab';
import { CounsellorInsightsTab } from './-components/CounsellorInsightsTab';
import { useCallIntelligenceEnabled } from '@/components/shared/leads';
import { ReassignDialog } from './-components/ReassignDialog';
import { FeatureDisabledNotice } from './-components/FeatureDisabledNotice';
import { MyPagination } from '@/components/design-system/pagination';
import { ConversionBySourceWidget } from '@/routes/sales-dashboard/-components/ConversionBySourceWidget';
import { CallsPerDayWidget } from '@/routes/sales-dashboard/-components/CallsPerDayWidget';
import { CounsellorRatingBadge } from '@/components/counsellor/CounsellorRatingBadge';
import { useCounsellorRatingBatch } from '@/components/counsellor/useCounsellorRating';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import {
    fetchCounsellorLeads,
    fetchMyTeam,
    fetchCounsellors,
    setCounsellorStatus,
    type WorkbenchCounsellor,
    type WorkbenchLead,
} from './-services/counsellor-workbench-services';
import {
    TargetPeriodSelector,
    type TargetPeriodValue,
} from './-components/targets/target-period-selector';
import { useTargetProgress } from './-components/targets/use-target-progress';
import { TargetProgress } from './-components/targets/target-progress';
import { TargetsSettingsDialog } from './-components/targets/targets-settings-dialog';
import { CounsellorTargetsTab } from './-components/targets/counsellor-targets-tab';
import type { TargetProgressItem } from './-services/counsellor-target-services';

export const Route = createLazyFileRoute('/counsellors/')({
    component: RouteComponent,
});

type DetailTab = 'leads' | 'activity' | 'calls' | 'coaching' | 'performance' | 'targets';
type StatusFilter = 'all' | 'active' | 'inactive';
type ViewMode = 'cards' | 'list';

const VIEW_MODE_KEY = 'counsellors-view-mode';

function isCounsellorsPageEnabled(): boolean {
    // Must resolve through getActiveRoleDisplaySettingsKey so custom-role users
    // read the toggle from their own role's settings, not the teacher default.
    const ds = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey());
    // Toggled from Display Settings → CRM → Leads sub-tabs, same place as
    // Lead List / Recent Leads / Follow-ups. Off by default per
    // SUB_ITEMS_HIDDEN_BY_DEFAULT in admin-defaults.
    const leadsTab = ds?.sidebar?.find((t) => t.id === 'leads');
    const sub = leadsTab?.subTabs?.find((s) => s.id === 'counsellors');
    return sub?.visible === true;
}

/**
 * Exported so the `/counsellors/$userId` lazy route can mount the same
 * gate-then-page wrapper without duplicating the feature-disabled check.
 */
export function CounsellorsRouteWrapper() {
    const { t } = useTranslation('counsellorsIndex');
    if (!isCounsellorsPageEnabled()) {
        return (
            <FeatureDisabledNotice
                title={t('featureDisabled.title')}
                settingsLabel={t('featureDisabled.settingsLabel')}
            />
        );
    }
    return <WorkbenchPage />;
}

function RouteComponent() {
    return <CounsellorsRouteWrapper />;
}

/**
 * Shared by both `/counsellors` (no drawer) and `/counsellors/$userId` (drawer
 * open for that user). Reading the URL param with `{ strict: false }` lets the
 * SAME component render at either route without throwing in the no-param case.
 *
 * URL is the source of truth for which drawer is open — opening / closing the
 * drawer navigates, and a hard refresh on `/counsellors/<id>` reopens the
 * drawer for that user. Makes the URL shareable: paste it to a colleague and
 * they land directly on that counsellor's leads + activity.
 */
export function WorkbenchPage() {
    const { t } = useTranslation('counsellorsIndex');
    const { setNavHeading } = useNavHeadingStore();
    const instituteId = getInstituteId();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    // Both routes can render this — `userId` is the param when at the
    // /counsellors/$userId subroute, undefined when at /counsellors.
    const params = useParams({ strict: false }) as { userId?: string };
    const urlUserId = params?.userId;

    useEffect(() => {
        setNavHeading('Counsellors');
    }, [setNavHeading]);

    // UI state. Search + statusFilter feed the server query so the page
    // count stays meaningful (no "page 2 of 5 with zero results").
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        if (typeof window === 'undefined') return 'cards';
        return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'cards';
    });
    function changeViewMode(next: ViewMode) {
        setViewMode(next);
        localStorage.setItem(VIEW_MODE_KEY, next);
    }
    // Targets: the timeline the roster progress is evaluated against, and the
    // bulk/per-person "Set targets" dialog.
    const [targetPeriod, setTargetPeriod] = useState<TargetPeriodValue>({ periodType: 'MONTH' });
    const [targetsDialogOpen, setTargetsDialogOpen] = useState(false);
    // Debounce so we don't fire a server request on every keystroke.
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    // Open-drawer state holds the FULL counsellor object — not just the id —
    // because the displayed list is now server-paginated, so a `find` against
    // the current page would lose the drawer if the manager paginated away
    // (or if a status flip caused the row to drop out of the active filter).
    const [openCounsellor, setOpenCounsellor] = useState<WorkbenchCounsellor | null>(null);
    const [detailTab, setDetailTab] = useState<DetailTab>('leads');
    const [reassignOpen, setReassignOpen] = useState(false);
    const [reassignLeads, setReassignLeads] = useState<WorkbenchLead[]>([]);
    const [reassignFromUserId, setReassignFromUserId] = useState<string | null>(null);
    const [reassignFromName, setReassignFromName] = useState<string | null>(null);
    // Counsellor-level flows move ALL open leads server-side (no 500 cap);
    // per-row reassign stays scoped to the one lead.
    const [reassignAllMode, setReassignAllMode] = useState(false);
    const [reassignTotalOpen, setReassignTotalOpen] = useState<number | null>(null);
    // True when the reassign dialog is opened from the "Mark inactive"
    // action — submit then atomically reassigns AND flips pool memberships
    // INACTIVE in one backend transaction. Cancelling leaves the counsellor
    // ACTIVE (no partial state).
    const [reassignMarkInactive, setReassignMarkInactive] = useState(false);
    // Holds the user_id of the counsellor we're currently fetching open
    // leads for, so the "Mark inactive" button can show a spinner.
    const [pendingMarkInactiveId, setPendingMarkInactiveId] = useState<string | null>(null);

    // Display-only breadcrumb: the caller's own team (empty for users
    // without a team membership — no longer an error state).
    const teamQuery = useQuery({
        queryKey: ['workbench-my-team', instituteId],
        enabled: !!instituteId,
        queryFn: () => fetchMyTeam(instituteId!),
    });

    // Page size adapts to the current view: a 12-cell grid (3×4 / 4×3) for
    // cards, 20 rows for the list. Page state resets to 0 when the inputs
    // that re-shape the page count change.
    const pageSize = viewMode === 'cards' ? 12 : 20;
    const [page, setPage] = useState(0);
    useEffect(() => {
        setPage(0);
    }, [search, statusFilter, viewMode]);

    // Role-based roster: every COUNSELLOR-role user the caller may see —
    // hierarchy scope for scoped callers, institute-wide for pure admins.
    const counsellorsQuery = useQuery({
        queryKey: ['workbench-counsellors', instituteId, search, statusFilter, page, pageSize],
        enabled: !!instituteId,
        queryFn: () =>
            fetchCounsellors(instituteId!, {
                search,
                status: statusFilter,
                page,
                size: pageSize,
            }),
        placeholderData: (prev) => prev,
    });

    // Candidates for the reassign dialog's target dropdown need the WHOLE
    // visible roster, not just the current page. Separate query so the
    // display list can paginate while reassign still picks across everyone.
    // Cached by react-query so we don't re-fetch on every row click.
    const candidatesQuery = useQuery({
        queryKey: ['workbench-counsellors-candidates', instituteId],
        enabled: !!instituteId,
        queryFn: () => fetchCounsellors(instituteId!, { size: 500 }),
    });

    // Assignment TARGETS for the reassign dialog. Separate from `candidates`
    // (the caller-visible roster that drives stats/drawer): an ADMIN who also
    // holds the COUNSELLOR role sees only their hierarchy scope on this page,
    // but may still reassign leads to any counsellor of the institute.
    const assignableCandidatesQuery = useQuery({
        queryKey: ['workbench-counsellors-candidates', instituteId, 'assignable'],
        enabled: !!instituteId,
        queryFn: () => fetchCounsellors(instituteId!, { size: 500, assignable: true }),
    });

    const counsellors = counsellorsQuery.data?.content ?? [];
    const totalCounsellors = counsellorsQuery.data?.totalElements ?? 0;
    const totalPages = Math.max(1, counsellorsQuery.data?.totalPages ?? 1);
    const candidates = candidatesQuery.data?.content ?? [];

    // Warm the rating cache only for the visible page — full-list warming
    // would scale poorly once the roster grows past a few pages.
    useCounsellorRatingBatch(
        instituteId,
        counsellors.map((c) => c.user_id)
    );

    // Target-vs-completed for the visible page, in one request. Keyed to the
    // selected timeline so switching week/month/custom refetches.
    const targetProgress = useTargetProgress(
        instituteId,
        counsellors.map((c) => c.user_id),
        targetPeriod
    );

    // URL → drawer sync. When the URL carries a userId, find that counsellor
    // in the full candidate list (settings-side size=500 fetch) and pin the
    // drawer to them. Falls back to the current page if the candidate set
    // hasn't loaded yet. Skip when the in-memory state already matches the
    // URL — otherwise typing in the search box would yank focus around.
    useEffect(() => {
        if (!urlUserId) {
            if (openCounsellor !== null) setOpenCounsellor(null);
            return;
        }
        if (openCounsellor?.user_id === urlUserId) return;
        const found =
            candidates.find((c) => c.user_id === urlUserId) ??
            counsellors.find((c) => c.user_id === urlUserId) ??
            null;
        if (found) {
            setOpenCounsellor(found);
            setDetailTab('leads');
        }
    }, [urlUserId, candidates, counsellors, openCounsellor]);

    /**
     * Open the drawer for a counsellor — drives URL state, not local state.
     * URL change wakes the effect above which then sets openCounsellor.
     */
    function openDrawer(c: WorkbenchCounsellor) {
        setDetailTab('leads');
        void navigate({
            to: '/counsellors/$userId',
            params: { userId: c.user_id },
        });
    }

    function closeDrawer() {
        void navigate({ to: '/counsellors' });
    }

    // ACTIVE direction: legacy direct flip — no leads to move, no dialog
    // needed. (For INACTIVE we go through the reassign-first flow below.)
    const setActiveMutation = useMutation({
        mutationFn: (userId: string) => setCounsellorStatus(userId, instituteId!, 'ACTIVE'),
        onSuccess: () => {
            // BOTH lists need to refetch:
            //   * `workbench-counsellors`           — the paginated display list
            //   * `workbench-counsellors-candidates` — the size=500 query that
            //     feeds the reassign dialog's target dropdown. Without this,
            //     a counsellor just marked back to ACTIVE stays filtered out
            //     of the target list (the dropdown is gated on `is_active`)
            //     until the user hard-refreshes — which is the bug you saw
            //     after flipping someone inactive → active.
            queryClient.invalidateQueries({ queryKey: ['workbench-counsellors', instituteId] });
            queryClient.invalidateQueries({
                queryKey: ['workbench-counsellors-candidates', instituteId],
            });
            toast.success(t('toast.markedActive'));
        },
        onError: (e) => {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.statusChangeError'));
        },
    });

    /**
     * Shared opener for the reassign dialog, pre-populated with the
     * counsellor's open leads.
     *
     * markInactive=true → the reassign-first INACTIVE flow: manager picks a
     * target (or RR / MANUAL) and confirms — backend atomically reassigns AND
     * flips pool memberships INACTIVE in one transaction. Cancelling leaves
     * the counsellor ACTIVE.
     *
     * markInactive=false → plain bulk reassign — used to move the leads of an
     * ALREADY-INACTIVE counsellor later (leads left behind by "mark inactive
     * without reassigning" don't get stranded).
     */
    async function openReassignFlow(userId: string, displayName: string, markInactive: boolean) {
        if (!instituteId) return;
        setPendingMarkInactiveId(userId);
        try {
            // Needs the counsellor's ASSIGNED-but-not-yet-converted leads (the
            // same set the card's "Assigned leads" count reflects). 'OPEN' is
            // the backend's virtual filter for that (conversion_status NULL OR
            // != 'CONVERTED') — converted leads are done and shouldn't be
            // moved. Size 500 is the existing safety cap — beyond that we'd
            // want a multi-page accumulator; flag if a counsellor routinely
            // sits on more than ~500 open leads.
            const leads = await fetchCounsellorLeads(instituteId, userId, 'OPEN', 0, 500);
            setReassignFromUserId(userId);
            setReassignFromName(displayName);
            setReassignLeads(leads?.content ?? []);
            // The dialog list is a preview (page cap 500); the commit moves the
            // TRUE total server-side via reassignAll.
            setReassignTotalOpen(leads?.totalElements ?? leads?.content?.length ?? 0);
            setReassignAllMode(true);
            setReassignMarkInactive(markInactive);
            setReassignOpen(true);
        } catch (e) {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.loadLeadsError'));
        } finally {
            setPendingMarkInactiveId(null);
        }
    }

    function startMarkInactive(userId: string, displayName: string) {
        return openReassignFlow(userId, displayName, true);
    }

    function startReassignLeads(userId: string, displayName: string) {
        return openReassignFlow(userId, displayName, false);
    }

    function handleStatusToggle(userId: string, displayName: string, currentlyActive: boolean) {
        if (currentlyActive) {
            void startMarkInactive(userId, displayName);
        } else {
            setActiveMutation.mutate(userId);
        }
    }

    function handleLeadReassign(lead: WorkbenchLead) {
        setReassignFromUserId(lead.assigned_counselor_id);
        setReassignFromName(lead.assigned_counselor_name);
        setReassignLeads([lead]);
        // Per-row: scope strictly to this one lead — never sweep the pipeline.
        setReassignAllMode(false);
        setReassignTotalOpen(null);
        setReassignMarkInactive(false);
        setReassignOpen(true);
    }

    function handleReassignComplete() {
        // Reassign-and-mark-inactive flips pool memberships, so the
        // candidates list (which gates the reassign dropdown on is_active)
        // also needs to refetch — otherwise the just-inactivated counsellor
        // would still appear as a valid target on the next dialog open.
        queryClient.invalidateQueries({ queryKey: ['workbench-counsellors', instituteId] });
        queryClient.invalidateQueries({
            queryKey: ['workbench-counsellors-candidates', instituteId],
        });
        queryClient.invalidateQueries({ queryKey: ['workbench-leads', instituteId] });
    }

    /**
     * "Mark inactive without reassigning" — the manager chooses to take the
     * counsellor offline but leave their leads assigned to them as-is (no
     * round-robin / target). Uses the dedicated status endpoint, which flips
     * pool memberships INACTIVE without touching any lead assignment. The
     * leads simply stay with the (now inactive) counsellor until someone
     * reassigns them later.
     */
    async function handleMarkInactiveWithoutReassign() {
        if (!instituteId || !reassignFromUserId) return;
        try {
            await setCounsellorStatus(reassignFromUserId, instituteId, 'INACTIVE');
            toast.success(t('toast.markedInactive'));
            handleReassignComplete();
            setReassignOpen(false);
            setReassignMarkInactive(false);
        } catch (e) {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.markInactiveError'));
        }
    }

    function handleReassignDialogOpenChange(next: boolean) {
        setReassignOpen(next);
        if (!next) setReassignMarkInactive(false);
    }

    if (!instituteId) return null;

    // Stat chips count over ALL counsellors, not just the current page.
    // Fall back to current page values until the all-candidates query
    // resolves, so the chips don't flash zeros on first load.
    const statSource = candidates.length > 0 ? candidates : counsellors;
    const activeCount = statSource.filter((c) => c.is_active).length;
    const totalOpenLeads = statSource.reduce((sum, c) => sum + c.open_leads_count, 0);

    return (
        <LayoutContainer>
            {/* ── Page header ────────────────────────────────────── */}
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="text-caption text-neutral-500">
                        {teamQuery.data?.ancestor_names?.join(' › ') ||
                            t('header.breadcrumbFallback')}
                    </div>
                    <h1 className="text-h1 font-medium text-neutral-900">
                        {teamQuery.data?.team_name ?? t('header.titleFallback')}
                    </h1>
                    <p className="mt-1 text-subtitle text-neutral-500">{t('header.subtitle')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <StatChip icon={UsersThree} label={t('stats.counsellors')} value={totalCounsellors} />
                    <StatChip icon={Crown} label={t('stats.active')} value={activeCount} tone="success" />
                    <StatChip
                        icon={ChatCircleText}
                        label={t('stats.assignedLeads')}
                        value={totalOpenLeads}
                        tone="primary"
                    />
                </div>
            </div>

            {/* Summary header. */}
            <CounsellorsEnhancedHeader counsellors={statSource} />
            <ShiftsTodayCard counsellors={statSource} />

            {/* ── Search + filter bar ────────────────────────────── */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative min-w-64 flex-1 sm:flex-none">
                    <MagnifyingGlass
                        size={16}
                        className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                    />
                    <input
                        className="w-full rounded-md border border-neutral-300 py-2 ps-9 pe-3 text-body"
                        placeholder={t('search.placeholder')}
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                </div>
                <div className="flex overflow-hidden rounded-md border border-neutral-300">
                    {(['all', 'active', 'inactive'] as StatusFilter[]).map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setStatusFilter(s)}
                            className={cn(
                                'px-3 py-1.5 text-caption font-medium capitalize',
                                statusFilter === s
                                    ? 'bg-primary-500 text-white'
                                    : 'bg-white text-neutral-700 hover:bg-neutral-50'
                            )}
                        >
                            {t(`statusFilter.${s}`)}
                        </button>
                    ))}
                </div>
                <TargetPeriodSelector value={targetPeriod} onChange={setTargetPeriod} />
                <button
                    type="button"
                    onClick={() => setTargetsDialogOpen(true)}
                    className="flex items-center gap-1.5 rounded-md border border-primary-300 bg-primary-50 px-3 py-1.5 text-caption font-medium text-primary-700 hover:bg-primary-100"
                >
                    <Target size={14} /> {t('targets.setTargets')}
                </button>
                <div
                    className="ms-auto flex overflow-hidden rounded-md border border-neutral-300"
                    role="group"
                    aria-label={t('viewMode.ariaLabel')}
                >
                    <button
                        type="button"
                        onClick={() => changeViewMode('cards')}
                        title={t('viewMode.cardTitle')}
                        aria-pressed={viewMode === 'cards'}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium',
                            viewMode === 'cards'
                                ? 'bg-primary-500 text-white'
                                : 'bg-white text-neutral-700 hover:bg-neutral-50'
                        )}
                    >
                        <SquaresFour size={14} /> {t('viewMode.cards')}
                    </button>
                    <button
                        type="button"
                        onClick={() => changeViewMode('list')}
                        title={t('viewMode.listTitle')}
                        aria-pressed={viewMode === 'list'}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium',
                            viewMode === 'list'
                                ? 'bg-primary-500 text-white'
                                : 'bg-white text-neutral-700 hover:bg-neutral-50'
                        )}
                    >
                        <ListIcon size={14} /> {t('viewMode.list')}
                    </button>
                </div>
            </div>

            {/* ── Counsellor cards grid ──────────────────────────── */}
            {counsellorsQuery.isLoading ? (
                <div className="rounded-md border border-neutral-200 bg-white p-8 text-center text-subtitle text-neutral-500">
                    {t('list.loading')}
                </div>
            ) : counsellors.length === 0 ? (
                <div className="rounded-md border border-neutral-200 bg-white p-8 text-center text-subtitle text-neutral-500">
                    {totalCounsellors === 0 && !search && statusFilter === 'all'
                        ? t('list.emptyTeam')
                        : t('list.emptyFiltered')}
                </div>
            ) : viewMode === 'list' ? (
                <CounsellorTable
                    counsellors={counsellors}
                    instituteId={instituteId}
                    progressByUser={targetProgress.byUser}
                    progressLoading={targetProgress.isFetching}
                    statusPendingId={
                        pendingMarkInactiveId ??
                        (setActiveMutation.isPending ? setActiveMutation.variables ?? null : null)
                    }
                    onOpen={(uid) => {
                        const c = counsellors.find((x) => x.user_id === uid);
                        if (c) openDrawer(c);
                    }}
                    onToggleStatus={(uid, isActive) => {
                        const c = counsellors.find((x) => x.user_id === uid);
                        // isActive here is the NEXT state requested.
                        handleStatusToggle(uid, c?.full_name ?? uid, !isActive);
                    }}
                    onReassignLeads={(uid) => {
                        const c = counsellors.find((x) => x.user_id === uid);
                        void startReassignLeads(uid, c?.full_name ?? uid);
                    }}
                />
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {counsellors.map((c) => (
                        <CounsellorCard
                            key={c.user_id}
                            counsellor={c}
                            instituteId={instituteId}
                            progress={targetProgress.byUser[c.user_id]}
                            progressLoading={targetProgress.isFetching}
                            onOpen={() => openDrawer(c)}
                            onToggleStatus={() =>
                                handleStatusToggle(c.user_id, c.full_name ?? c.user_id, c.is_active)
                            }
                            onReassignLeads={() =>
                                void startReassignLeads(c.user_id, c.full_name ?? c.user_id)
                            }
                            statusLoading={
                                pendingMarkInactiveId === c.user_id ||
                                (setActiveMutation.isPending &&
                                    setActiveMutation.variables === c.user_id)
                            }
                        />
                    ))}
                </div>
            )}

            {totalCounsellors > pageSize && (
                <div className="mt-4 flex items-center justify-between">
                    <span className="text-caption text-neutral-500">
                        {t('pagination.showing', {
                            from: page * pageSize + 1,
                            to: Math.min((page + 1) * pageSize, totalCounsellors),
                            total: totalCounsellors,
                        })}
                        {counsellorsQuery.isFetching ? t('pagination.loadingSuffix') : ''}
                    </span>
                    <MyPagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                    />
                </div>
            )}

            {/* ── Detail slide-over panel (Radix Sheet, portaled) ── */}
            <DetailDrawer
                open={!!openCounsellor}
                onOpenChange={(o) => {
                    if (!o) closeDrawer();
                }}
                counsellor={openCounsellor}
                tab={detailTab}
                onTabChange={setDetailTab}
                instituteId={instituteId}
                onReassign={handleLeadReassign}
            />

            <ReassignDialog
                open={reassignOpen}
                onOpenChange={handleReassignDialogOpenChange}
                instituteId={instituteId}
                fromUserId={reassignFromUserId}
                fromUserName={reassignFromName}
                openLeads={reassignLeads}
                reassignAll={reassignAllMode}
                totalOpenLeads={reassignTotalOpen ?? undefined}
                candidates={
                    (assignableCandidatesQuery.data?.content?.length ?? 0) > 0
                        ? assignableCandidatesQuery.data!.content
                        : candidates
                }
                markInactive={reassignMarkInactive}
                onComplete={handleReassignComplete}
                onMarkInactiveWithoutReassign={handleMarkInactiveWithoutReassign}
            />

            <TargetsSettingsDialog
                open={targetsDialogOpen}
                onOpenChange={setTargetsDialogOpen}
                instituteId={instituteId}
                // Set targets across the whole team (size=500 candidates), not
                // just the current page — falls back to the page while loading.
                // Only ACTIVE counsellors: an inactive (offline) counsellor
                // shouldn't be handed a target.
                counsellors={(candidates.length > 0 ? candidates : counsellors)
                    .filter((c) => c.is_active)
                    .map((c) => ({
                        user_id: c.user_id,
                        full_name: c.full_name,
                    }))}
                onSaved={() =>
                    queryClient.invalidateQueries({ queryKey: ['counsellor-target-progress'] })
                }
            />
        </LayoutContainer>
    );
}

// ─── Stat chip ────────────────────────────────────────────────

function StatChip({
    icon: Icon,
    label,
    value,
    tone = 'neutral',
}: {
    icon: typeof UsersThree;
    label: string;
    value: number;
    tone?: 'neutral' | 'primary' | 'success';
}) {
    const toneClass =
        tone === 'primary'
            ? 'bg-primary-50 text-primary-700'
            : tone === 'success'
              ? 'bg-success-50 text-success-700'
              : 'bg-neutral-100 text-neutral-700';
    return (
        <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${toneClass}`}>
            <Icon size={16} />
            <span className="text-caption">
                <span className="font-semibold">{value}</span>{' '}
                <span className="opacity-70">{label}</span>
            </span>
        </div>
    );
}

// ─── Counsellor card ──────────────────────────────────────────

function CounsellorCard({
    counsellor,
    instituteId,
    progress,
    progressLoading,
    onOpen,
    onToggleStatus,
    onReassignLeads,
    statusLoading,
}: {
    counsellor: WorkbenchCounsellor;
    instituteId: string;
    progress: TargetProgressItem[] | undefined;
    progressLoading: boolean;
    onOpen: () => void;
    onToggleStatus: () => void;
    /** Bulk-move this counsellor's open leads — surfaced for INACTIVE
     *  counsellors so leads left behind by "mark inactive without
     *  reassigning" can still be moved later. */
    onReassignLeads: () => void;
    statusLoading: boolean;
}) {
    const { t } = useTranslation('counsellorsIndex');
    const name = counsellor.full_name || t('card.unnamed');
    return (
        <button
            type="button"
            onClick={onOpen}
            className={cn(
                'group relative flex flex-col items-stretch overflow-hidden rounded-xl border bg-white text-left shadow-sm transition-all hover:border-primary-300 hover:shadow-md',
                counsellor.is_active ? 'border-neutral-200' : 'border-neutral-200 opacity-75'
            )}
        >
            <div
                className={cn('h-1', counsellor.is_active ? 'bg-primary-500' : 'bg-neutral-300')}
            />
            <div className="flex items-start gap-3 px-4 py-3">
                <Avatar name={name} large />
                <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-body font-semibold text-neutral-900">{name}</div>
                    {counsellor.role_label ? (
                        <div className="truncate text-caption italic text-neutral-700">
                            {counsellor.role_label}
                        </div>
                    ) : (
                        counsellor.email && (
                            <div className="truncate text-caption text-neutral-500">
                                {counsellor.email}
                            </div>
                        )
                    )}
                </div>
                <CounsellorRatingBadge
                    instituteId={instituteId}
                    userId={counsellor.user_id}
                    size="md"
                />
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-neutral-100 bg-neutral-50 px-4 py-2.5 text-caption">
                <div>
                    <div className="text-neutral-500">{t('card.assignedLeads')}</div>
                    <div className="text-body font-semibold text-neutral-900">
                        {counsellor.open_leads_count}
                    </div>
                </div>
                <div>
                    <div className="text-neutral-500">{t('card.team')}</div>
                    <div className="truncate text-body font-medium text-neutral-700">
                        {counsellor.team_name ?? '—'}
                    </div>
                </div>
            </div>

            <div className="border-t border-neutral-100 px-4 py-2.5">
                <div className="mb-1.5 text-caption text-neutral-500">{t('card.targets')}</div>
                <TargetProgress items={progress} compact loading={progressLoading} />
            </div>

            <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-2.5">
                <span
                    className={cn(
                        'flex items-center gap-1.5 text-caption font-medium',
                        counsellor.is_active ? 'text-success-700' : 'text-neutral-500'
                    )}
                >
                    <span
                        className={cn(
                            'inline-block size-1.5 rounded-full',
                            counsellor.is_active ? 'bg-success-500' : 'bg-neutral-400'
                        )}
                    />
                    {counsellor.is_active ? t('card.active') : t('card.inactive')}
                </span>
                <span className="flex items-center gap-1">
                    {!counsellor.is_active && counsellor.open_leads_count > 0 && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onReassignLeads();
                            }}
                            disabled={statusLoading}
                            className="rounded-md px-2.5 py-1 text-caption font-medium text-primary-700 transition-colors hover:bg-primary-50"
                        >
                            {t('card.reassignLeads')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            // INACTIVE direction goes through the reassign dialog,
                            // which is the explicit confirmation. ACTIVE direction
                            // is a direct flip, so keep the confirm prompt there.
                            if (counsellor.is_active) {
                                onToggleStatus();
                            } else if (window.confirm(t('card.confirmMarkActive', { name }))) {
                                onToggleStatus();
                            }
                        }}
                        disabled={statusLoading}
                        className={cn(
                            'rounded-md px-2.5 py-1 text-caption font-medium transition-colors',
                            counsellor.is_active
                                ? 'text-danger-600 hover:bg-danger-50'
                                : 'text-success-700 hover:bg-success-50'
                        )}
                    >
                        {statusLoading
                            ? '…'
                            : counsellor.is_active
                              ? t('card.markInactive')
                              : t('card.markActive')}
                    </button>
                </span>
            </div>
        </button>
    );
}

// ─── List view ────────────────────────────────────────────────

function CounsellorTable({
    counsellors,
    instituteId,
    progressByUser,
    progressLoading,
    statusPendingId,
    onOpen,
    onToggleStatus,
    onReassignLeads,
}: {
    counsellors: WorkbenchCounsellor[];
    instituteId: string;
    progressByUser: Record<string, TargetProgressItem[]>;
    progressLoading: boolean;
    statusPendingId: string | null;
    onOpen: (userId: string) => void;
    onToggleStatus: (userId: string, isActive: boolean) => void;
    /** Bulk-move a counsellor's open leads — surfaced for INACTIVE rows. */
    onReassignLeads: (userId: string) => void;
}) {
    const { t } = useTranslation('counsellorsIndex');
    return (
        <div className="overflow-auto rounded-md border border-neutral-200 bg-white">
            <table className="w-full text-body">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-caption uppercase tracking-wide text-neutral-500">
                    <tr>
                        <th className="px-3 py-2.5 text-start">{t('table.colCounsellor')}</th>
                        <th className="px-3 py-2.5 text-start">{t('table.colTeam')}</th>
                        <th className="px-3 py-2.5 text-end">{t('table.colRating')}</th>
                        <th className="px-3 py-2.5 text-end">{t('table.colAssignedLeads')}</th>
                        <th className="px-3 py-2.5 text-start">{t('table.colTargets')}</th>
                        <th className="px-3 py-2.5 text-start">{t('table.colStatus')}</th>
                        <th className="px-3 py-2.5 text-end">{t('table.colActions')}</th>
                    </tr>
                </thead>
                <tbody>
                    {counsellors.map((c) => {
                        const name = c.full_name || t('card.unnamed');
                        const pending = statusPendingId === c.user_id;
                        return (
                            <tr
                                key={c.user_id}
                                className={cn(
                                    'cursor-pointer border-t border-neutral-100 hover:bg-neutral-50',
                                    !c.is_active && 'opacity-75'
                                )}
                                onClick={() => onOpen(c.user_id)}
                            >
                                <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-2.5">
                                        <Avatar name={name} />
                                        <div className="min-w-0 leading-tight">
                                            <div className="truncate text-body font-medium text-neutral-900">
                                                {name}
                                            </div>
                                            <div className="truncate text-caption text-neutral-500">
                                                {c.email ?? c.role_label ?? '—'}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-3 py-2.5 text-neutral-700">
                                    {c.team_name ?? '—'}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                    <span className="inline-flex">
                                        <CounsellorRatingBadge
                                            instituteId={instituteId}
                                            userId={c.user_id}
                                            size="sm"
                                        />
                                    </span>
                                </td>
                                <td className="px-3 py-2.5 text-right text-body font-semibold text-neutral-900">
                                    {c.open_leads_count}
                                </td>
                                <td className="min-w-44 px-3 py-2.5">
                                    <TargetProgress
                                        items={progressByUser[c.user_id]}
                                        compact
                                        loading={progressLoading}
                                    />
                                </td>
                                <td className="px-3 py-2.5">
                                    <span
                                        className={cn(
                                            'inline-flex items-center gap-1.5 text-caption font-medium',
                                            c.is_active ? 'text-success-700' : 'text-neutral-500'
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                'size-1.5 rounded-full',
                                                c.is_active ? 'bg-success-500' : 'bg-neutral-400'
                                            )}
                                        />
                                        {c.is_active ? t('card.active') : t('card.inactive')}
                                    </span>
                                </td>
                                <td className="px-3 py-2.5 text-end">
                                    {!c.is_active && c.open_leads_count > 0 && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onReassignLeads(c.user_id);
                                            }}
                                            disabled={pending}
                                            className="rounded-md px-2.5 py-1 text-caption font-medium text-primary-700 transition-colors hover:bg-primary-50"
                                        >
                                            {t('card.reassignLeads')}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            // INACTIVE goes through the
                                            // reassign dialog (its own
                                            // confirmation); ACTIVE keeps the
                                            // direct confirm prompt.
                                            if (c.is_active) {
                                                onToggleStatus(c.user_id, !c.is_active);
                                            } else if (
                                                window.confirm(
                                                    t('card.confirmMarkActive', { name })
                                                )
                                            ) {
                                                onToggleStatus(c.user_id, !c.is_active);
                                            }
                                        }}
                                        disabled={pending}
                                        className={cn(
                                            'rounded-md px-2.5 py-1 text-caption font-medium transition-colors',
                                            c.is_active
                                                ? 'text-danger-600 hover:bg-danger-50'
                                                : 'text-success-700 hover:bg-success-50'
                                        )}
                                    >
                                        {pending
                                            ? '…'
                                            : c.is_active
                                              ? t('card.markInactive')
                                              : t('card.markActive')}
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ─── Detail drawer ────────────────────────────────────────────

function DetailDrawer({
    open,
    onOpenChange,
    counsellor,
    tab,
    onTabChange,
    instituteId,
    onReassign,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    counsellor: WorkbenchCounsellor | null;
    tab: DetailTab;
    onTabChange: (t: DetailTab) => void;
    instituteId: string;
    onReassign: (lead: WorkbenchLead) => void;
}) {
    const { t } = useTranslation('counsellorsIndex');
    // Coaching tab only exists when the institute has Call Intelligence on.
    // (Hook must run before the early return below — Rules of Hooks.)
    const callIntelligenceEnabled = useCallIntelligenceEnabled();
    // Sheet handles focus trap, Escape, overlay click — we just supply the
    // content. `counsellor` can be null briefly during the close animation
    // (state cleared as the sheet starts to fade out); the early-return
    // keeps the closing frame clean.
    if (!counsellor) return null;
    const name = counsellor.full_name || t('card.unnamed');
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
                <div className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4">
                    <Avatar name={name} large />
                    <div className="min-w-0 flex-1 leading-tight">
                        <div className="truncate text-h3 font-medium text-neutral-900">{name}</div>
                        <div className="truncate text-caption text-neutral-500">
                            {counsellor.email ?? counsellor.role_label ?? '—'}
                        </div>
                    </div>
                    <CounsellorRatingBadge
                        instituteId={instituteId}
                        userId={counsellor.user_id}
                        size="lg"
                    />
                    {/* SheetContent renders its own close button (X) at top-right. */}
                </div>

                <Tabs
                    value={tab}
                    onValueChange={(v) => onTabChange(v as DetailTab)}
                    className="flex min-h-0 flex-1 flex-col"
                >
                    <TabsList className="m-3 gap-2">
                        <TabsTrigger value="leads">
                            <ChatCircleText size={14} className="me-1.5" />{' '}
                            {t('drawer.tabLeads', { count: counsellor.open_leads_count })}
                        </TabsTrigger>
                        <TabsTrigger value="activity">
                            <ArrowsClockwise size={14} className="me-1.5" /> {t('drawer.tabActivity')}
                        </TabsTrigger>
                        <TabsTrigger value="calls">
                            <Phone size={14} className="me-1.5" /> {t('drawer.tabCalls')}
                        </TabsTrigger>
                        {callIntelligenceEnabled && (
                            <TabsTrigger value="coaching">
                                <Sparkle size={14} className="me-1.5" /> {t('drawer.tabCoaching')}
                            </TabsTrigger>
                        )}
                        <TabsTrigger value="performance">
                            <ChartLineUp size={14} className="me-1.5" /> {t('drawer.tabPerformance')}
                        </TabsTrigger>
                        <TabsTrigger value="targets">
                            <Target size={14} className="me-1.5" /> {t('drawer.tabTargets')}
                        </TabsTrigger>
                    </TabsList>
                    <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                        {tab === 'leads' && (
                            <CounsellorLeadsTab
                                instituteId={instituteId}
                                counsellorUserId={counsellor.user_id}
                                onReassign={onReassign}
                            />
                        )}
                        {tab === 'activity' && (
                            <CounsellorActivityTab
                                instituteId={instituteId}
                                counsellorUserId={counsellor.user_id}
                            />
                        )}
                        {tab === 'calls' && (
                            <CounsellorCallsTab
                                instituteId={instituteId}
                                counsellorUserId={counsellor.user_id}
                            />
                        )}
                        {tab === 'coaching' && callIntelligenceEnabled && (
                            <CounsellorInsightsTab
                                instituteId={instituteId}
                                counsellorUserId={counsellor.user_id}
                            />
                        )}
                        {tab === 'performance' && (
                            <div className="space-y-4">
                                <ConversionBySourceWidget
                                    instituteId={instituteId}
                                    counsellorUserId={counsellor.user_id}
                                />
                                <CallsPerDayWidget
                                    instituteId={instituteId}
                                    counsellorUserId={counsellor.user_id}
                                />
                            </div>
                        )}
                        {tab === 'targets' && (
                            <CounsellorTargetsTab
                                instituteId={instituteId}
                                counsellorUserId={counsellor.user_id}
                            />
                        )}
                    </div>
                </Tabs>
            </SheetContent>
        </Sheet>
    );
}

// ─── Avatar ───────────────────────────────────────────────────

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
    const initial = (name || '?').trim().slice(0, 1).toUpperCase();
    return (
        <div
            className={cn(
                'flex shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700',
                large ? 'size-11 text-h3' : 'text-h4 size-9'
            )}
            aria-hidden="true"
        >
            {initial || <User size={16} />}
        </div>
    );
}
