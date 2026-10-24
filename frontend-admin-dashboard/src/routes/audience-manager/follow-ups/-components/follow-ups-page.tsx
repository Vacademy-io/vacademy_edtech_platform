import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { FollowUpsAgenda } from './FollowUpsAgenda';
import { FollowUpsEnhancedHeader } from './FollowUpsEnhancedHeader';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
    CalendarBlank,
    DownloadSimple,
    Flame,
    Folders,
    ListBullets,
    MagnifyingGlass,
    Megaphone,
    X,
} from '@phosphor-icons/react';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getCurrentInstituteId, getUserRoleForInstitute } from '@/lib/auth/instituteUtils';
import { getUserId } from '@/utils/userDetails';
import {
    fetchAudienceLeadByResponseId,
    fetchRecentLeads,
} from '../../list/-services/get-recent-leads';
import { fetchCompletedFollowUps } from '../-services/get-completed-follow-ups';
import { handleFetchCampaignsList } from '../../list/-services/get-campaigns-list';
import {
    buildCampaignTypeFilterOptions,
    buildDefaultCampaignTypeOptions,
    filterByCampaignTypes,
    resolveLeadAudienceIds,
} from '../../list/-utils/campaign-types';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import { ManageListFiltersLink } from '@/components/shared/leads/manage-list-filters-link';
import { useListBuiltInFilterControls } from '@/components/shared/leads/use-list-built-in-filter-controls';
import { UtmFilterControls } from '@/components/shared/leads/utm-filter-controls';
import { toUtmFiltersPayload } from '@/components/shared/leads/utm-filter-encoding';
import type { UtmFilterDimension, UtmFilterSelection } from '@/services/utm-list-filters';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { StudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/student-sidebar-provider';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { followUpStatusFilter, useLeadSettings } from '@/hooks/use-lead-settings';
import { useLeadProfiles } from '@/hooks/use-lead-profiles';
import { useLatestNotesBatch } from '@/hooks/use-latest-notes-batch';
import { useLeadStatuses } from '@/hooks/use-lead-statuses';
import { useLeadCounsellorOptions } from '@/hooks/use-lead-counsellor-options';
import { useCustomFieldSetup } from '@/routes/audience-manager/list/-hooks/useCustomFieldSetup';
import {
    buildExportHeader,
    completedToExportRow,
    exportCustomFields,
    leadToExportRow,
} from './follow-up-export-columns';
import { CounsellorFilter } from '@/components/shared/leads/counsellor-filter';
import { AddLeadNoteDialog } from '@/components/shared/add-lead-note-dialog';
import { AssignCounselorToLeadDialog } from '@/components/shared/assign-counselor-to-lead-dialog';
import {
    CompleteFollowUpPopover,
    LeadEmptyState,
    LeadTable,
    usePlaceCall,
    useUpdateLeadTier,
    mapRecentLeadToStudent,
    recentLeadToVM,
    startBackgroundExport,
    useIsExporting,
    type LeadActionHandlers,
    type LeadTableExtraColumn,
} from '@/components/shared/leads';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { LeadPagination } from '@/components/shared/leads';
import { FollowUpStatTiles } from './follow-up-stat-tiles';
import { CompletedFollowUpsTable } from './completed-follow-ups-table';
import {
    COMPLETED_CUSTOM_RANGE,
    COMPLETED_DEFAULT_RANGE,
    COMPLETED_RANGE_PRESETS,
    completedRangeForPreset,
    completedWindow,
} from './completed-range';
import {
    bucketWindow,
    effectiveDueMs,
    intersectWindows,
    type FollowUpBucket,
} from './follow-up-buckets';
import { dateRangeFileSuffix, dueDateWindow } from './due-range';
import { FollowUpsCalendarView } from './follow-ups-calendar-view';
import { useFollowUpsViewState } from './use-follow-ups-view-state';
import { parseLockedParams } from '../../recent-leads/-components/pinned-filters';

/**
 * Follow-ups — at-a-glance task list of leads needing counsellor action.
 *
 * **Deliberately minimal toolbar.** A counsellor on shift should land here and
 * instantly see today's workload — four big bucket cards (Pending / Today /
 * Upcoming / All) drive everything. No tier, status, audience, date or column
 * controls live here on purpose; that's the Recent Leads / Lead List job. The
 * toolbar holds only what a queue needs: a name/phone/email search, an export
 * of the current view, and — for admins — the **counsellor filter** so a
 * manager can drill into one rep's queue.
 *
 * Counsellors are server-locked to their own assignment via
 * `assigned_counselor_id = currentUserId`; admins can switch with the filter.
 *
 * Data comes from `POST /audience/leads` with `follow_up_pending` plus the
 * bucket's due window, so the server does the bucketing: the four card counts
 * are `totalElements` of four `size:1` probes and the list is one real page.
 * Nothing is classified client-side, which is why the counts survive past the
 * first page.
 */

const PAGE_SIZE = 20;
// Matches Recent Leads. Both pages hit the same endpoint, so keeping the pacing
// identical keeps the load a keystroke puts on the server predictable.
const SEARCH_DEBOUNCE_MS = 500;
// The calendar view can jump to any day in the bucket, so it takes the bucket whole.
const CALENDAR_FETCH_SIZE = 500;
const EMPTY_COUNTS: Record<FollowUpBucket, number> = {
    completed: 0,
    overdue: 0,
    today: 0,
    upcoming: 0,
    all: 0,
};
/** Bucket window, narrowed by the due-date filter, as the API's snake-case params. */
const toWindowParams = (
    b: FollowUpBucket,
    now: Date = new Date(),
    due: { from?: string; to?: string } = {}
) => {
    // Today is already one day, so the due-date filter has nothing to narrow there — and
    // it is hidden on that tile, so a range set elsewhere must not quietly empty it.
    const w = intersectWindows(bucketWindow(b, now), b === 'today' ? {} : due);
    return { follow_up_from: w.from, follow_up_to: w.to };
};
/** "All time" on the Completed range — completedWindow() reads it as no window. */
const COMPLETED_ALL_TIME = 'ALL';
// Hidden on this surface to keep triage focused.
const HIDDEN_COLUMNS = new Set(['score']);
// Static cache keys every mutation on this page must refresh.
const INVALIDATE_KEYS: string[][] = [['follow-ups'], ['lead-profiles-batch']];

export const FollowUpsPage = () => {
    const { t } = useTranslation('audienceManagerFollowUpsPage');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);
    return (
        <StudentSidebarProvider>
            <FollowUpsContent />
        </StudentSidebarProvider>
    );
};

const FollowUpsContent = () => {
    const { t } = useTranslation('audienceManagerFollowUpsPage');
    const { t: tAgenda } = useTranslation('crmPages');
    // Agenda is a client-side view of the list data.
    const [agenda, setAgenda] = useState(false);
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id;
    const { setSelectedStudent } = useStudentSidebar();
    const queryClient = useQueryClient();

    // URL-driven view state (List | Calendar + month / day / counsellor).
    // Extracted into a hook to keep this component's cyclomatic complexity low.
    const {
        view,
        setView,
        monthStr,
        setMonthStr,
        selectedDateStr,
        setSelectedDateStr,
        counsellorFilters,
        setCounsellorFilters,
    } = useFollowUpsViewState();

    // ── Role detection ───────────────────────────────────────────────────────
    // ADMIN sees the whole team + a counsellor filter; anyone else (counsellor,
    // teacher, …) is locked to their own follow-ups.
    const isAdmin = useMemo(() => {
        const id = getCurrentInstituteId();
        if (!id) return false;
        return getUserRoleForInstitute(id) === 'ADMIN';
    }, []);
    const currentUserId = useMemo(() => getUserId() ?? '', []);

    // Seeded from the route so a sub-tab link opens on its own tile, and kept in step
    // with it: every sub-tab shares this pathname, so switching between them does not
    // remount the page. The page never writes the param back, so there is no loop.
    const {
        bucket: bucketParam,
        lock,
        status: statusParam,
        statusExclude,
    } = useSearch({ from: '/audience-manager/follow-ups/' });
    const [bucket, setBucket] = useState<FollowUpBucket>(bucketParam ?? 'today');
    useEffect(() => {
        if (bucketParam) setBucket(bucketParam);
    }, [bucketParam]);

    const leadSettings = useLeadSettings();
    const showOps = !leadSettings.isLoading && leadSettings.enabled;
    const showScore = showOps && leadSettings.showScoreInEnquiryTable;
    const { statuses: leadStatusCatalog } = useLeadStatuses();

    const [noteTarget, setNoteTarget] = useState<{
        userId: string;
        userName: string;
        responseId?: string;
        /** Pre-select a dialog tab — 'FOLLOW_UP' for the "schedule next" flow
         *  after marking a follow-up complete. */
        initialActionType?: string;
        /** Closes the follow-up being completed — runs only once the next
         *  one is saved, so dismissing the dialog leaves it pending. */
        onFollowUpScheduled?: () => void;
    } | null>(null);
    const [counsellorTarget, setCounsellorTarget] = useState<{
        userId: string;
        userName: string;
    } | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    // Counsellor options, role + hierarchy scoped by the backend: a scoped
    // caller (COUNSELLOR role) gets self + their counsellor reports; a pure
    // admin gets the institute-wide COUNSELLOR-role roster.
    const {
        options: counsellorOptions,
        scoped: isScopedCounsellor,
        isLoading: counsellorOptionsLoading,
    } = useLeadCounsellorOptions();

    // Managers (scoped with reports) and admins get the drill-in filter; a
    // leaf counsellor's single-option filter would be noise.
    const canFilterCounsellors = isAdmin || (isScopedCounsellor && counsellorOptions.length > 1);

    // Admins and scoped counsellors rely on the backend's hierarchy RBAC when
    // no explicit counsellor is picked (a scoped manager sees own + reports).
    // Any other role keeps the old client-side lock to their own follow-ups.
    // Several ids go as one comma-separated value, which is how the lead query
    // has always taken this filter (Recent Leads does the same).
    const effectiveCounsellorId =
        isAdmin || isScopedCounsellor
            ? counsellorFilters.length > 0
                ? counsellorFilters.join(',')
                : undefined
            : currentUserId || undefined;

    // Source (the institute's name for campaign type) and Label (its name for the
    // audience) are two different things to the client, and neither is a UTM tag.
    // Same wiring as Recent Leads: picking Sources narrows which Labels the second
    // dropdown offers, and the request carries the resolved audience ids.
    // ?lock=bucket — the sub-tab owns its bucket, so a card click must not move off it.
    const bucketLocked = parseLockedParams(lock).has('bucket');
    const terminology = useLeadTerminology();
    // Admins switch individual filters off from the gear below; a hidden filter
    // must also stop filtering, or it would narrow the list invisibly.
    const { isVisible: filterVisible } = useListBuiltInFilterControls('LEADS');
    const { t: tCampaignType } = useTranslation('audienceManagerCampaignTypeDropdown');
    const [campaignTypeFilters, setCampaignTypeFilters] = useState<string[]>([]);
    const [audienceFilters, setAudienceFilters] = useState<string[]>([]);
    // Interest level recorded on the follow-up. Offered only to an institute that
    // configured the list (Lead settings → Follow-up fields); everyone else never
    // sees the control and nothing is sent.
    const [interestFilters, setInterestFilters] = useState<string[]>([]);
    const interestOptions = useMemo(
        () =>
            leadSettings.followUpFields.enabled ? leadSettings.followUpFields.interestLevels : [],
        [leadSettings.followUpFields.enabled, leadSettings.followUpFields.interestLevels]
    );
    const activeInterests = useMemo(
        () => interestFilters.filter((level) => interestOptions.includes(level)),
        [interestFilters, interestOptions]
    );
    const [utmFilters, setUtmFilters] = useState<UtmFilterSelection>({});
    const setUtmFilter = (dimension: UtmFilterDimension, values: string[]) =>
        setUtmFilters((prev) => {
            const next = { ...prev };
            if (values.length === 0) delete next[dimension];
            else next[dimension] = values;
            return next;
        });
    const utmFiltersPayload = useMemo(() => toUtmFiltersPayload(utmFilters), [utmFilters]);

    const audiencesQuery = useQuery(
        handleFetchCampaignsList({ institute_id: instituteId ?? '', page: 0, size: 200 })
    );
    const audienceOptions = useMemo(
        () =>
            (audiencesQuery.data?.content ?? [])
                .map((c) => ({
                    id: c.id || c.campaign_id || c.audience_id || '',
                    name: c.campaign_name || t('filters.audienceUntitled'),
                    campaignType: c.campaign_type,
                }))
                .filter((opt) => opt.id !== ''),
        [audiencesQuery.data, t]
    );
    const campaignTypeOptions = useMemo(
        () =>
            buildCampaignTypeFilterOptions(buildDefaultCampaignTypeOptions(tCampaignType), [
                ...audienceOptions.map((opt) => opt.campaignType),
                ...campaignTypeFilters,
            ]),
        [tCampaignType, audienceOptions, campaignTypeFilters]
    );
    const typeAudienceOptions = useMemo(
        () => filterByCampaignTypes(audienceOptions, campaignTypeFilters),
        [audienceOptions, campaignTypeFilters]
    );
    const activeCampaignTypes = useMemo(
        () => (filterVisible('campaignType') ? campaignTypeFilters : []),
        [filterVisible, campaignTypeFilters]
    );
    const activeAudiences = useMemo(
        () => (filterVisible('audience') ? audienceFilters : []),
        [filterVisible, audienceFilters]
    );
    const resolvedAudienceIds = useMemo(
        () => resolveLeadAudienceIds(activeAudiences, activeCampaignTypes, audienceOptions),
        [activeAudiences, activeCampaignTypes, audienceOptions]
    );
    // null means "no audience has these Sources". Sending no ids would mean "every
    // lead", which is the opposite of what was asked — so the queries stand down.
    const waitingForTypeAudiences =
        activeCampaignTypes.length > 0 && audiencesQuery.data === undefined;
    const noTypeAudiences = !waitingForTypeAudiences && resolvedAudienceIds === null;
    // One id goes to the per-campaign query, several to the institute-wide one.
    // Strictly either/or — sending both is ambiguous server-side.
    const audienceParams = useMemo(() => {
        const ids = resolvedAudienceIds ?? [];
        return {
            audience_id: ids.length === 1 ? ids[0] : undefined,
            audience_ids: ids.length > 1 ? ids : undefined,
        };
    }, [resolvedAudienceIds]);

    // Search runs on the server with the rest of the filter, so it searches every
    // follow-up rather than whatever happened to be on screen. Debounced rather
    // than button-driven, same as Recent Leads — a queue is scanned, not queried.

    // ?status=…[&statusExclude=1] — the sidebar sub-tab decides which lead statuses its
    // queue covers (e.g. an institute that parks lost leads in their own tab links here
    // with status=LOST&statusExclude=1). No picker on this page; the route owns it.
    // Completed honours it too, so a lost lead's closed calls stay out of that list.
    // On top of the route, Lead Settings -> hideLostInFollowUps (on by default) keeps
    // LOST leads out of every bucket; see followUpStatusFilter.
    const statusKeys = (statusParam ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .join(',');
    const { leadStatusId, leadStatusExcludeId } = followUpStatusFilter(
        statusKeys,
        statusExclude === '1',
        leadSettings.hideLostInFollowUps
    );
    // Hold the queries until the setting is known, so an institute that switched it off
    // never sees a LOST-less list flash first.
    const statusFilterReady = !leadSettings.isLoading;

    // Completed tile controls. Its own search and window because it queries a
    // different endpoint. The lead filters above (Source, Label, UTM, interest
    // level) go with it too — they used to show on this tab without filtering it.
    const [completedRange, setCompletedRange] = useState(COMPLETED_DEFAULT_RANGE);
    const [completedFrom, setCompletedFrom] = useState('');
    const [completedTo, setCompletedTo] = useState('');
    const [completedSearchInput, setCompletedSearchInput] = useState('');
    const [completedSearch, setCompletedSearch] = useState('');
    useEffect(() => {
        const trimmed = completedSearchInput.trim();
        if (trimmed === completedSearch) return;
        const timer = window.setTimeout(() => setCompletedSearch(trimmed), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [completedSearchInput, completedSearch]);
    const completedParams = useMemo(
        () => ({
            search: completedSearch || undefined,
            ...completedWindow(completedRange, completedFrom, completedTo),
            leadStatusId,
            leadStatusExcludeId,
            audienceIds: resolvedAudienceIds?.length ? resolvedAudienceIds : undefined,
            utmFilters: utmFiltersPayload,
            interestLevels: activeInterests.length ? activeInterests : undefined,
        }),
        [
            completedSearch,
            completedRange,
            completedFrom,
            completedTo,
            leadStatusId,
            leadStatusExcludeId,
            resolvedAudienceIds,
            utmFiltersPayload,
            activeInterests,
        ]
    );

    // Due-date filter for the open buckets; see due-range.ts. Empty = any date.
    const [dueFrom, setDueFrom] = useState('');
    const [dueTo, setDueTo] = useState('');
    const dueWindow = useMemo(() => dueDateWindow(dueFrom, dueTo), [dueFrom, dueTo]);

    const [searchInput, setSearchInput] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [page, setPage] = useState(0);
    useEffect(() => {
        const trimmed = searchInput.trim();
        if (trimmed === appliedSearch) return;
        const timer = window.setTimeout(() => setAppliedSearch(trimmed), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput, appliedSearch]);
    useEffect(
        () => setPage(0),
        [
            bucket,
            appliedSearch,
            effectiveCounsellorId,
            audienceParams,
            utmFiltersPayload,
            completedParams,
            dueWindow,
        ]
    );

    /** One request shape for every bucket; only the window moves. */
    const baseFilter = useMemo(
        () => ({
            institute_id: instituteId ?? '',
            assigned_counselor_id: effectiveCounsellorId,
            // A converted lead is no longer a pending follow-up.
            conversion_status_filter: 'EXCLUDE_CONVERTED' as const,
            lead_status_id: leadStatusId,
            lead_status_exclude_id: leadStatusExcludeId,
            search_query: appliedSearch || undefined,
            follow_up_pending: true,
            ...audienceParams,
            utm_filters: utmFiltersPayload,
            follow_up_interest_levels: activeInterests.length ? activeInterests : undefined,
        }),
        [
            instituteId,
            effectiveCounsellorId,
            leadStatusId,
            leadStatusExcludeId,
            appliedSearch,
            audienceParams,
            utmFiltersPayload,
            activeInterests,
        ]
    );

    // Tile counts: one cheap request per bucket, size 1, read totalElements. The page used
    // to count the 200 rows it had fetched, which for a real institute meant the tiles read
    // 200 / 0 / 0 / 200 no matter what the pipeline actually held.
    //
    // Keyed under the same ['follow-ups', …] root as the list so that completing a
    // follow-up — every caller invalidates exactly ['follow-ups'] — moves the tiles
    // too. A sibling 'follow-ups-counts' root would not have been matched.
    const { data: counts = EMPTY_COUNTS, isLoading: countsLoading } = useQuery({
        queryKey: [
            'follow-ups',
            'counts',
            baseFilter,
            instituteId,
            effectiveCounsellorId,
            completedParams,
            dueWindow,
        ],
        queryFn: async () => {
            const buckets: FollowUpBucket[] = ['overdue', 'today', 'upcoming', 'all'];
            const now = new Date();
            // Completed comes from the follow-up endpoint, not the leads one — it
            // counts events, and a lead can have several.
            const [results, completed] = await Promise.all([
                Promise.all(
                    buckets.map((b) =>
                        fetchRecentLeads({
                            ...baseFilter,
                            ...toWindowParams(b, now, dueWindow),
                            page: 0,
                            size: 1,
                        })
                    )
                ),
                fetchCompletedFollowUps({
                    instituteId: instituteId ?? '',
                    counsellorUserId: effectiveCounsellorId,
                    ...completedParams,
                    page: 0,
                    size: 1,
                }).catch(() => undefined),
            ]);
            return buckets.reduce(
                (acc, b, i) => ({ ...acc, [b]: results[i]?.totalElements ?? 0 }),
                { ...EMPTY_COUNTS, completed: completed?.totalElements ?? 0 }
            );
        },
        enabled: !!instituteId && !noTypeAudiences && statusFilterReady,
        staleTime: 30 * 1000,
    });

    const { data, isLoading, error } = useQuery({
        queryKey: ['follow-ups', 'list', baseFilter, bucket, page, view, dueWindow],
        queryFn: () =>
            fetchRecentLeads({
                ...baseFilter,
                ...toWindowParams(bucket, undefined, dueWindow),
                page: view === 'calendar' ? 0 : page,
                // The calendar lets the user jump to any day, so it needs the whole bucket
                // rather than one page of it.
                size: view === 'calendar' ? CALENDAR_FETCH_SIZE : PAGE_SIZE,
            }),
        enabled: !!instituteId && !noTypeAudiences && bucket !== 'completed' && statusFilterReady,
        staleTime: 30 * 1000,
    });

    // Completed follow-ups: its own endpoint, its own paging, same counsellor scope.
    const {
        data: completedPage,
        isLoading: completedLoading,
        error: completedError,
    } = useQuery({
        queryKey: [
            'follow-ups',
            'completed',
            instituteId,
            effectiveCounsellorId,
            completedParams,
            page,
        ],
        queryFn: () =>
            fetchCompletedFollowUps({
                instituteId: instituteId ?? '',
                counsellorUserId: effectiveCounsellorId,
                ...completedParams,
                page,
                size: PAGE_SIZE,
            }),
        // Same guard as the open buckets: a Source with no audiences must show
        // nothing, not every completed follow-up.
        enabled: !!instituteId && !noTypeAudiences && bucket === 'completed' && statusFilterReady,
        staleTime: 30 * 1000,
    });

    const totalPages =
        bucket === 'completed' ? completedPage?.totalPages ?? 0 : data?.totalPages ?? 0;

    // Build VMs, filter to pending follow-ups, classify into buckets, sort by
    // soonest-due so the top of the list is always the most urgent task.
    // The server has already narrowed to the bucket, so there is nothing left to classify
    // here — only the ordering: priority follow-ups (reattempts) first, as the server pages
    // them, then soonest-due.
    const pendingVms = useMemo(() => (data?.content ?? []).map(recentLeadToVM), [data]);
    const sortedVms = useMemo(
        () =>
            [...pendingVms].sort(
                (a, b) =>
                    Number(!!b.followUpPriority) - Number(!!a.followUpPriority) ||
                    effectiveDueMs(a) - effectiveDueMs(b)
            ),
        [pendingVms]
    );

    // Profiles + notes for the visible vms. On the calendar view the user can
    // jump to any day, so we need profiles/notes for ALL pending VMs (not just
    // the current bucket's sorted slice) — otherwise selecting a day outside
    // the active bucket would render without profile/notes data.
    const userIds = useMemo(() => {
        const source = view === 'calendar' ? pendingVms : sortedVms;
        return source.map((vm) => vm.userId ?? '').filter((id): id is string => !!id);
    }, [view, pendingVms, sortedVms]);
    const { profiles: leadProfiles } = useLeadProfiles(userIds, showOps, instituteId);
    const { notesByUserId } = useLatestNotesBatch(userIds, showOps);

    const updateTier = useUpdateLeadTier({ invalidateKeys: INVALIDATE_KEYS });
    const placeCall = usePlaceCall({ invalidateKeys: INVALIDATE_KEYS });

    const actions: LeadActionHandlers = useMemo(
        () => ({
            onOpenDetails: (vm) => {
                // Open the compact side-view sheet, NOT the fullscreen overlay.
                setSelectedStudent(vm.toStudent(), { openOverlay: false });
                setIsSidebarOpen(true);
            },
            onAddNote: (userId, userName, responseId) =>
                setNoteTarget({ userId, userName, responseId }),
            // Counsellors can't reassign — pass undefined so the affordance hides.
            onAssignCounsellor: isAdmin
                ? (userId, userName) => setCounsellorTarget({ userId, userName })
                : undefined,
            onSetTier: (userId, _userName, tier) => updateTier.mutate({ userId, tier }),
            onCallLead: (vm, preferredNumberId) => {
                if (!vm.responseId) return;
                placeCall.mutate({
                    responseId: vm.responseId,
                    userId: vm.userId ?? undefined,
                    preferredNumberId,
                });
            },
            canCall: (vm) => {
                if (!vm.responseId)
                    return { allowed: false, reason: t('callReasons.noSubmissionId') };
                const phone = vm.phone && vm.phone !== '-' ? vm.phone : '';
                if (!phone) return { allowed: false, reason: t('callReasons.noPhone') };
                if (placeCall.isPending)
                    return { allowed: false, reason: t('callReasons.callInProgress') };
                return { allowed: true };
            },
        }),
        [setSelectedStudent, updateTier, isAdmin, placeCall, t]
    );
    // Enhanced lead side panel: Previous / Next and quick actions run on these rows.
    // Inline "Mark complete" row action — the close flow for the follow-up the
    // row represents. Rows are leads (one row can carry several open
    // follow-ups), so the popover fetches the lead's open follow-ups on demand
    // and the user completes the pending one. "Schedule next" re-opens the
    // add-note dialog on the Follow Up tab.
    const extraColumns: LeadTableExtraColumn[] = useMemo(
        () => [
            {
                id: 'complete',
                header: t('table.actionHeader'),
                thClass: 'w-32',
                render: (vm) =>
                    vm.responseId && vm.userId ? (
                        <CompleteFollowUpPopover
                            audienceResponseId={vm.responseId}
                            userId={vm.userId}
                            invalidateKeys={INVALIDATE_KEYS}
                            onScheduleNext={(closeCurrent) =>
                                setNoteTarget({
                                    userId: vm.userId!,
                                    userName: vm.name,
                                    responseId: vm.responseId,
                                    initialActionType: 'FOLLOW_UP',
                                    onFollowUpScheduled: () => void closeCurrent(),
                                })
                            }
                        />
                    ) : (
                        <span className="text-sm text-neutral-300">—</span>
                    ),
            },
        ],
        [t]
    );

    const handleStatusUpdated = () => queryClient.invalidateQueries({ queryKey: ['follow-ups'] });

    // Pre-compute the view body so the JSX below is a single expression instead
    // of a nested ternary (which CodeFactor / SonarJS flag as complexity).
    let viewBody: ReactNode;
    if (bucket === 'completed') {
        // Rows here are follow-ups, not leads, so none of LeadTable applies.
        viewBody = completedError ? (
            <LeadEmptyState
                title={t('errors.loadFailedTitle')}
                description={t('errors.loadFailedDescription')}
            />
        ) : (
            <CompletedFollowUpsTable
                rows={completedPage?.content ?? []}
                isLoading={completedLoading}
                onOpenLead={(row) => {
                    if (!row.audience_response_id) return;
                    // Fetch the real lead rather than stubbing one: the side
                    // sheet's Lead Profile tab reads custom-field answers off it.
                    void fetchAudienceLeadByResponseId(row.audience_response_id)
                        .then((lead) => {
                            setSelectedStudent(mapRecentLeadToStudent(lead), {
                                openOverlay: false,
                            });
                            setIsSidebarOpen(true);
                        })
                        .catch(() => toast.error(t('errors.loadFailedTitle')));
                }}
                counsellorName={(userId) =>
                    counsellorOptions.find((o) => o.id === userId)?.full_name ?? '—'
                }
            />
        );
    } else if (view === 'calendar') {
        viewBody = (
            <FollowUpsCalendarView
                vms={pendingVms}
                monthStr={monthStr}
                onMonthChange={setMonthStr}
                selectedDateStr={selectedDateStr}
                onSelectDate={setSelectedDateStr}
                isLoading={isLoading}
                error={error}
                profiles={leadProfiles}
                notes={notesByUserId}
                statuses={leadStatusCatalog}
                showOps={showOps}
                showScore={showScore}
                actions={actions}
                onStatusUpdated={handleStatusUpdated}
                hiddenColumns={HIDDEN_COLUMNS}
                extraColumns={extraColumns}
            />
        );
    } else if (error) {
        viewBody = (
            <LeadEmptyState
                title={t('errors.loadFailedTitle')}
                description={t('errors.loadFailedDescription')}
            />
        );
    } else if (agenda) {
        viewBody = (
            <FollowUpsAgenda
                vms={sortedVms}
                profiles={leadProfiles}
                onOpen={actions.onOpenDetails}
                rowActions={extraColumns}
            />
        );
    } else {
        viewBody = (
            <LeadTable
                vms={sortedVms}
                profiles={leadProfiles}
                notes={notesByUserId}
                statuses={leadStatusCatalog}
                showOps={showOps}
                showScore={showScore}
                isLoading={isLoading}
                actions={actions}
                onStatusUpdated={handleStatusUpdated}
                hiddenColumns={HIDDEN_COLUMNS}
                extraColumns={extraColumns}
                emptyState={
                    <LeadEmptyState
                        title={buildEmptyTitle(t, isAdmin, bucket, counts, appliedSearch)}
                        description={buildEmptyDescription(
                            t,
                            isAdmin,
                            bucket,
                            counts,
                            appliedSearch
                        )}
                    />
                }
            />
        );
    }

    // Export walks the CURRENT bucket page by page rather than dumping the table, so what
    // lands in the CSV is what the filter says — not the twenty rows on screen. The walk
    // runs in the background and paces itself; see background-export.ts for why.
    const isExporting = useIsExporting('follow-ups');
    // Every custom field the institute has configured becomes a column, so an
    // institute with a "Courses" field gets Courses without this file naming it.
    const { data: customFieldSetup } = useCustomFieldSetup(instituteId ?? undefined);
    const exportFields = useMemo(() => exportCustomFields(customFieldSetup), [customFieldSetup]);
    const exportHeader = buildExportHeader(
        {
            name: t('export.columns.name'),
            email: t('export.columns.email'),
            phone: t('export.columns.phone'),
            source: t('export.columns.source'),
            leadOwner: t('export.columns.leadOwner'),
            status: t('export.columns.status'),
            interestLevel: t('export.columns.interestLevel'),
            dueAt: t('export.columns.dueAt'),
            followUpNote: t('export.columns.followUpNote'),
            studentResponse: t('export.columns.studentResponse'),
            followUpMode: t('export.columns.followUpMode'),
            nextAction: t('export.columns.nextAction'),
        },
        exportFields
    );
    const handleExport = () => {
        // The file says which slice it is: bucket plus the date range it was cut to, so
        // five downloads side by side in a folder don't need opening to tell apart.
        const completedDates =
            completedRange === COMPLETED_CUSTOM_RANGE
                ? { from: completedFrom, to: completedTo }
                : completedRangeForPreset(completedRange);
        let rangeSuffix = '';
        if (bucket === 'completed')
            rangeSuffix = dateRangeFileSuffix(completedDates.from, completedDates.to);
        else if (bucket !== 'today') rangeSuffix = dateRangeFileSuffix(dueFrom, dueTo);
        const fileName = `follow-ups_${bucket}${rangeSuffix}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
        const labels = {
            progress: (done: number, total: number) =>
                total > 0
                    ? t('export.progress', {
                          done: done.toLocaleString(),
                          total: total.toLocaleString(),
                      })
                    : t('export.running'),
            done: (count: number) => t('export.done', { count }),
            failed: t('export.failed'),
            alreadyRunning: t('export.alreadyRunning'),
            truncated: (count: number) => t('export.truncated', { count }),
            partial: (count: number) => t('export.partial', { count }),
        };

        // Completed is its own endpoint — a row there is a closed follow-up, not a
        // lead, so the leads walk would have exported the wrong thing entirely (and
        // used to be disabled for exactly that reason).
        if (bucket === 'completed') {
            startBackgroundExport({
                key: 'follow-ups',
                fileName,
                header: exportHeader,
                fetchPage: (page, size) =>
                    fetchCompletedFollowUps({
                        instituteId: instituteId ?? '',
                        counsellorUserId: effectiveCounsellorId,
                        ...completedParams,
                        page,
                        size,
                        includeLeadDetail: true,
                    }),
                rowKey: (row) => row.id,
                toRow: (row) => completedToExportRow(row, exportFields),
                labels,
            });
            return;
        }

        const window = toWindowParams(bucket, undefined, dueWindow);
        startBackgroundExport({
            key: 'follow-ups',
            fileName,
            header: exportHeader,
            fetchPage: (page, size) => fetchRecentLeads({ ...baseFilter, ...window, page, size }),
            rowKey: (lead) => lead.response_id,
            toRow: (lead) => {
                const vm = recentLeadToVM(lead);
                return leadToExportRow(
                    lead,
                    vm.name,
                    vm.email,
                    vm.phone,
                    vm.audience,
                    exportFields
                );
            },
            labels,
        });
    };

    // Subline copy (counts-aware so a counsellor sees workload immediately).
    const subline =
        counts.today === 0 && counts.overdue === 0
            ? isAdmin
                ? t('subline.teamAllCaughtUp')
                : t('subline.selfAllCaughtUp')
            : `${t('subline.tasksDueToday', {
                  count: counts.today,
                  context: isAdmin ? 'admin' : 'user',
              })}${
                  counts.overdue > 0 ? t('subline.overdueSuffix', { count: counts.overdue }) : ''
              }`;

    return (
        <div className="flex w-full flex-col gap-4">
            {/* Heading row: who/what on the left, the two things you can DO on the right. */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-h1 font-semibold text-card-foreground">
                        {canFilterCounsellors ? t('heading.team') : t('heading.mine')}
                    </h1>
                    <p className="mt-0.5 text-body text-muted-foreground">{t('heading.blurb')}</p>
                    <p
                        className={cn(
                            'mt-1 text-body',
                            counts.overdue > 0 ? 'text-danger-600' : 'text-muted-foreground'
                        )}
                    >
                        {subline} · {format(new Date(), 'EEEE, MMM d')}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disabled={isExporting || counts[bucket] === 0}
                        onClick={handleExport}
                    >
                        <DownloadSimple className="size-4" />
                        {isExporting ? t('export.running') : t('export.action')}
                    </MyButton>
                </div>
            </div>

            {/* Bucket cards — the dominant element */}
            <FollowUpStatTiles
                counts={counts}
                active={bucket}
                onChange={setBucket}
                locked={bucketLocked}
            />

            {/* Summary header. */}
            <FollowUpsEnhancedHeader
                allowed={(isAdmin || isScopedCounsellor) && statusFilterReady}
                leadStatusId={leadStatusId}
                leadStatusExcludeId={leadStatusExcludeId}
            />

            {/* View toggle on the left, counsellor filter on the right — this row
                renders in both views, which the search toolbar below does not. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                    value={agenda && view === 'list' ? 'agenda' : view}
                    onValueChange={(v) => {
                        setAgenda(v === 'agenda');
                        setView(v === 'calendar' ? 'calendar' : 'list');
                    }}
                    className={bucket === 'completed' ? 'invisible' : undefined}
                >
                    <TabsList className="h-11 gap-1 rounded-xl border border-neutral-200 bg-card p-1">
                        <TabsTrigger
                            value="list"
                            className="h-9 gap-1.5 rounded-lg px-4 text-body data-[state=active]:bg-primary-500 data-[state=active]:text-neutral-50 data-[state=active]:shadow-none"
                        >
                            <ListBullets className="size-4" />
                            {t('tabs.list')}
                        </TabsTrigger>
                        <TabsTrigger
                            value="calendar"
                            className="h-9 gap-1.5 rounded-lg px-4 text-body data-[state=active]:bg-primary-500 data-[state=active]:text-neutral-50 data-[state=active]:shadow-none"
                        >
                            <CalendarBlank className="size-4" />
                            {t('tabs.calendar')}
                        </TabsTrigger>
                        <TabsTrigger
                            value="agenda"
                            className="h-9 gap-1.5 rounded-lg px-4 text-body data-[state=active]:bg-primary-500 data-[state=active]:text-neutral-50 data-[state=active]:shadow-none"
                        >
                            <ListBullets className="size-4" />
                            {tAgenda('followUps.agenda.tab')}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* Filters. On their own row rather than in the search toolbar below,
                because that toolbar is list-view only and these apply to both. */}
            <div className="flex flex-wrap items-center gap-2">
                {canFilterCounsellors && filterVisible('counsellor') && (
                    <CounsellorFilter
                        values={counsellorFilters}
                        onChange={setCounsellorFilters}
                        options={counsellorOptions}
                        isLoading={counsellorOptionsLoading}
                    />
                )}
                {filterVisible('campaignType') && (
                    <MultiSelectFilter
                        label={t('filters.campaignType', { term: terminology.campaignType })}
                        icon={<Folders className="size-4 shrink-0 text-neutral-400" />}
                        options={campaignTypeOptions}
                        selected={campaignTypeFilters}
                        onChange={(vals) => {
                            setCampaignTypeFilters(vals);
                            // The Labels on offer just changed; drop any that no
                            // longer belong to a selected Source.
                            setAudienceFilters([]);
                        }}
                        widthClass="w-48"
                    />
                )}
                {filterVisible('audience') && (
                    <MultiSelectFilter
                        label={t('filters.audience', { term: terminology.leadSource })}
                        icon={<Megaphone className="size-4 shrink-0 text-neutral-400" />}
                        options={typeAudienceOptions.map((opt) => ({
                            value: opt.id,
                            label: opt.name,
                        }))}
                        selected={audienceFilters}
                        onChange={setAudienceFilters}
                        widthClass="w-48"
                    />
                )}
                <UtmFilterControls
                    surface="LEADS"
                    instituteId={instituteId ?? ''}
                    selection={utmFilters}
                    onChange={setUtmFilter}
                />
                {interestOptions.length > 0 && (
                    <MultiSelectFilter
                        label={t('filters.interestLevel')}
                        icon={<Flame className="size-4 shrink-0 text-neutral-400" />}
                        options={interestOptions.map((level) => ({ value: level, label: level }))}
                        selected={activeInterests}
                        onChange={setInterestFilters}
                        widthClass="w-48"
                    />
                )}
                {/* Completed has its own range below — it filters on when a follow-up
                    was closed, this one on when it is due. Today is one day already. */}
                {bucket !== 'completed' && bucket !== 'today' && (
                    <div className="flex items-center gap-1.5">
                        <CalendarBlank className="size-4 shrink-0 text-neutral-400" />
                        <Input
                            type="date"
                            value={dueFrom}
                            max={dueTo || undefined}
                            onChange={(e) => setDueFrom(e.target.value)}
                            className="h-10 w-40"
                            aria-label={t('dueRange.from')}
                            title={t('dueRange.from')}
                        />
                        <span className="text-caption text-muted-foreground">→</span>
                        <Input
                            type="date"
                            value={dueTo}
                            min={dueFrom || undefined}
                            onChange={(e) => setDueTo(e.target.value)}
                            className="h-10 w-40"
                            aria-label={t('dueRange.to')}
                            title={t('dueRange.to')}
                        />
                        {(dueFrom || dueTo) && (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => {
                                    setDueFrom('');
                                    setDueTo('');
                                }}
                                aria-label={t('dueRange.clear')}
                                title={t('dueRange.clear')}
                            >
                                <X className="size-4" />
                            </MyButton>
                        )}
                    </div>
                )}
                <ManageListFiltersLink surface="LEADS" />
            </div>

            {/* Search on the left, count + export on the right — list view only.
                Same row shape as Recent Leads so the two queues read alike. */}
            {/* Completed has its own search and window — the lead filters above
                query leads, and these rows are follow-up events. */}
            {bucket === 'completed' && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-full sm:w-72">
                            <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                            <Input
                                type="text"
                                value={completedSearchInput}
                                onChange={(e) => setCompletedSearchInput(e.target.value)}
                                placeholder={t('search.placeholder')}
                                className="h-10 w-full pl-8"
                                aria-label={t('search.placeholder')}
                            />
                        </div>
                        <Select value={completedRange} onValueChange={setCompletedRange}>
                            <SelectTrigger className="h-10 w-44">
                                <CalendarBlank className="mr-1.5 size-4 text-neutral-400" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {COMPLETED_RANGE_PRESETS.map((p) => (
                                    <SelectItem key={p} value={p}>
                                        {t('completedRange.preset', { count: Number(p) })}
                                    </SelectItem>
                                ))}
                                <SelectItem value={COMPLETED_ALL_TIME}>
                                    {t('completedRange.allTime')}
                                </SelectItem>
                                <SelectItem value={COMPLETED_CUSTOM_RANGE}>
                                    {t('completedRange.custom')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        {completedRange === COMPLETED_CUSTOM_RANGE && (
                            <div className="flex items-center gap-1.5">
                                <Input
                                    type="date"
                                    value={completedFrom}
                                    onChange={(e) => setCompletedFrom(e.target.value)}
                                    className="h-10 w-40"
                                    aria-label={t('completedRange.from')}
                                />
                                <span className="text-caption text-muted-foreground">→</span>
                                <Input
                                    type="date"
                                    value={completedTo}
                                    onChange={(e) => setCompletedTo(e.target.value)}
                                    className="h-10 w-40"
                                    aria-label={t('completedRange.to')}
                                />
                            </div>
                        )}
                    </div>
                    <p className="text-body text-muted-foreground">
                        {t('showing.prefix')}{' '}
                        <span className="font-semibold text-card-foreground">
                            {completedLoading
                                ? '…'
                                : (completedPage?.totalElements ?? 0).toLocaleString()}
                        </span>{' '}
                        {t('showing.suffix', {
                            count: completedPage?.totalElements ?? 0,
                            context: 'completed',
                        })}
                    </p>
                </div>
            )}

            {view === 'list' && bucket !== 'completed' && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="relative w-full sm:w-80">
                        <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                        <Input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder={t('search.placeholder')}
                            className="h-10 w-full pl-8"
                            aria-label={t('search.placeholder')}
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        <p className="text-body text-muted-foreground">
                            {t('showing.prefix')}{' '}
                            <span className="font-semibold text-card-foreground">
                                {countsLoading ? '…' : counts[bucket].toLocaleString()}
                            </span>{' '}
                            {t('showing.suffix', {
                                count: counts[bucket],
                                context: bucket === 'all' ? undefined : bucket,
                            })}
                        </p>
                    </div>
                </div>
            )}

            {/* View body — calendar or list */}
            <SidebarProvider
                style={{ ['--sidebar-width' as string]: '565px' }}
                defaultOpen={false}
                open={isSidebarOpen}
                onOpenChange={setIsSidebarOpen}
            >
                <div className="min-w-0 flex-1">
                    {viewBody}
                    {view === 'list' && totalPages > 1 && (
                        <div className="mt-3">
                            <LeadPagination
                                currentPage={page}
                                totalPages={totalPages}
                                onPageChange={setPage}
                            />
                        </div>
                    )}
                </div>
                <StudentSidebar
                    selectedTab="overview"
                    examType="EXAM"
                    isStudentList={false}
                    defaultLeadProfile
                />

                {noteTarget && (
                    <AddLeadNoteDialog
                        open={!!noteTarget}
                        onOpenChange={(o) => !o && setNoteTarget(null)}
                        userId={noteTarget.userId}
                        userName={noteTarget.userName}
                        // Without the response id the dialog's Follow Up tab is
                        // permanently disabled (canSubmit requires it).
                        audienceResponseId={noteTarget.responseId}
                        initialActionType={noteTarget.initialActionType}
                        onFollowUpScheduled={noteTarget.onFollowUpScheduled}
                        // Scheduling a follow-up changes followUpDueAt — refresh
                        // the queue so the new task appears without a reload.
                        onSuccess={() =>
                            queryClient.invalidateQueries({ queryKey: ['follow-ups'] })
                        }
                    />
                )}
                {counsellorTarget && (
                    <AssignCounselorToLeadDialog
                        open={!!counsellorTarget}
                        onOpenChange={(o) => !o && setCounsellorTarget(null)}
                        userId={counsellorTarget.userId}
                        userName={counsellorTarget.userName}
                        invalidateKeys={[['lead-profiles-batch'], ['follow-ups']]}
                    />
                )}
            </SidebarProvider>
        </div>
    );
};

const buildEmptyTitle = (
    t: TFunction,
    isAdmin: boolean,
    bucket: FollowUpBucket,
    counts: Record<FollowUpBucket, number>,
    search: string
): string => {
    // The search narrows the counts too, so without this branch a search that
    // matches nothing reports the whole team as caught up.
    if (search) return t('empty.title.noMatches');
    if (counts.all === 0)
        return isAdmin ? t('empty.title.teamAllCaughtUp') : t('empty.title.selfAllCaughtUp');
    if (bucket === 'overdue') return t('empty.title.noOverdue');
    if (bucket === 'today') return t('empty.title.nothingToday');
    if (bucket === 'upcoming') return t('empty.title.noUpcoming');
    return t('empty.title.default');
};

const buildEmptyDescription = (
    t: TFunction,
    isAdmin: boolean,
    bucket: FollowUpBucket,
    counts: Record<FollowUpBucket, number>,
    search: string
): string => {
    if (search) return t('empty.description.noMatches', { query: search });
    // When the active bucket is empty but other buckets have items, nudge the
    // user to switch — that's what the cards above are for.
    if (bucket === 'today' && counts.overdue > 0) {
        return t('empty.description.overdueNudge', { count: counts.overdue });
    }
    if (bucket === 'today' && counts.upcoming > 0) {
        return t('empty.description.upcomingNudge');
    }
    return isAdmin
        ? t('empty.description.teamAllCaughtUp')
        : t('empty.description.selfAllCaughtUp');
};
