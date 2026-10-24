import { useEffect, useMemo, useRef, useState } from 'react';
import { RangeSegment } from './RangeSegment';
import { RecentLeadsEnhancedHeader } from './RecentLeadsEnhancedHeader';
import { LeadFilterSection, LeadFiltersPanel } from './LeadFiltersPanel';
import { useUtmListFilters } from '@/components/shared/leads/use-utm-list-filters';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { parseLockedParams, searchSignature } from './pinned-filters';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { convertToLocalDateTime } from '@/constants/helper';
import { cn, parseHtmlToString } from '@/lib/utils';
import {
    ChartLineUp,
    CheckCircle,
    Clock,
    DownloadSimple,
    Flame,
    Folders,
    Funnel,
    Kanban,
    LinkSimple,
    MagnifyingGlass,
    Megaphone,
    PhoneCall,
    Plus,
    SlidersHorizontal,
    UserCircle,
    X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePickerButton } from '@/components/shared/crm-enhance/date-picker-button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useActiveSidebarSection } from '@/components/common/layout-container/sidebar/use-active-sidebar-section';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { fetchRecentLeads, type RecentLeadDetail } from '../../list/-services/get-recent-leads';
import { handleFetchCampaignsList } from '../../list/-services/get-campaigns-list';
import {
    buildCampaignTypeFilterOptions,
    buildDefaultCampaignTypeOptions,
    filterByCampaignTypes,
    resolveLeadAudienceIds,
} from '../../list/-utils/campaign-types';
import { useCustomFieldSetup } from '../../list/-hooks/useCustomFieldSetup';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { StudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/student-sidebar-provider';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { useLeadProfiles, fetchBatchProfiles } from '@/hooks/use-lead-profiles';
import { useLatestNotesBatch, fetchLatestNotesBatch } from '@/hooks/use-latest-notes-batch';
import {
    fetchLeadJourneyBatch,
    formatJourneyForExport,
    type JourneyEvent,
} from '@/components/shared/leads/lead-journey-export';
import { useLeadStatuses } from '@/hooks/use-lead-statuses';
import { useLeadCounsellorOptions } from '@/hooks/use-lead-counsellor-options';
import { useLeadTiers } from '@/hooks/use-lead-tiers';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { CounsellorFilter } from '@/components/shared/leads/counsellor-filter';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import {
    ManageColumnsPopover,
    useLeadColumnPrefs,
    useColumnOrderPrefs,
    orderColumnIds,
    buildLeadColumnToggles,
    type LeadColumnToggle,
} from '@/components/shared/leads';
import {
    ExportColumnPickerDialog,
    type ExportColumnOption,
} from '@/components/shared/leads/export-column-picker-dialog';
import {
    CallHistoryFilter,
    isCallCountFilter,
    normalizeCallCount,
    DEFAULT_CALL_COUNT,
} from '@/components/shared/leads/call-history-filter';
import { CustomFieldMultiSelectFilter } from '@/components/shared/leads/custom-field-multi-select-filter';
import { ManageListFiltersLink } from '@/components/shared/leads/manage-list-filters-link';
import { UtmFilterControls } from '@/components/shared/leads/utm-filter-controls';
import {
    hasUtmSelection,
    toUtmFiltersPayload,
    utmSelectionKey,
    utmValueLabel,
} from '@/components/shared/leads/utm-filter-encoding';
import {
    UTM_FILTER_DIMENSIONS,
    type UtmFilterDimension,
    type UtmFilterSelection,
} from '@/services/utm-list-filters';
import { CustomFieldRangeFilter } from '@/components/shared/leads/custom-field-range-filter';
import {
    decodeSelectionToEntries,
    filterEntryValueLabel,
    isRangeFieldType,
    removeEntryFromSelection,
} from '@/components/shared/leads/custom-field-filter-encoding';
import { useLeadFilterCustomFields } from '@/components/shared/leads/use-lead-filter-custom-fields';
import { AddLeadNoteDialog } from '@/components/shared/add-lead-note-dialog';
import { AssignCounselorToLeadDialog } from '@/components/shared/assign-counselor-to-lead-dialog';
import {
    BulkAssignCounsellorDialog,
    type BulkAssignMode,
} from '@/components/shared/leads/bulk-assign-counsellor-dialog';
import {
    WorkedWindowFilter,
    workedWindowFromIso,
    WORKED_WINDOW_CUSTOM,
} from '@/components/shared/leads/worked-window-filter';
import { BulkLeadStatusDialog } from '@/components/shared/leads/bulk-lead-status-dialog';
import type { LeadCardVM } from '@/components/shared/leads/lead-view-model';
import { MyButton } from '@/components/design-system/button';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import { DeleteLeadsDialog } from '@/components/shared/leads/delete-leads-dialog';
import { MigrateLeadsDialog } from '@/components/shared/leads/migrate-leads-dialog';
import { useLeadActionVisibility } from '@/lib/display-settings/lead-actions';
import { AddLeadDialog } from './add-lead-dialog';
import { restoreAudienceLeads } from '@/routes/audience-manager/list/-services/delete-audience-lead';
import {
    ArrowCounterClockwise,
    ArrowsLeftRight,
    CircleNotch,
    Tag,
    Trash,
    UserMinus,
    UserPlus,
} from '@phosphor-icons/react';
import {
    LeadEmptyState,
    LeadTable,
    LeadPagination,
    useUpdateLeadTier,
    usePlaceCall,
    usePlaceAiCall,
    useAiCallButtonEnabled,
    AiCallDialog,
    type AiCallDialogTarget,
    recentLeadToVM,
    type LeadActionHandlers,
    type LeadSortKey,
    type LeadSortDirection,
} from '@/components/shared/leads';

import {
    ALL_AUDIENCES_VALUE,
    ALL_TIERS_VALUE,
    ALL_ACTIVE_VALUE,
    ALL_STATUSES_VALUE,
    ALL_CONVERTED_VALUE,
    ALL_SLA_VALUE,
    ALL_COUNSELLORS_VALUE,
    UNASSIGNED_COUNSELLOR_VALUE,
    ALL_DATE_VALUE,
    CUSTOM_DATE_VALUE,
    DEFAULT_RANGE_DAYS,
    UTM_SEARCH_PARAM,
} from './recent-leads-search';

type SlaFilter =
    | 'TAT_BEFORE'
    | 'TAT_OVERDUE'
    | 'FOLLOW_UP_DUE'
    | 'FOLLOW_UP_OVERDUE'
    | 'ANY_OVERDUE';
/** Factory (not the i18next.t() singleton) so it only ever renders once a
 * useTranslation('audienceManagerRecentLeadsPage') consumer is mounted. */
const buildSlaOptions = (t: TFunction): { value: string; label: string; helper?: string }[] => [
    { value: ALL_SLA_VALUE, label: t('slaOptions.all') },
    {
        value: 'ANY_OVERDUE',
        label: t('slaOptions.anyOverdueLabel'),
        helper: t('slaOptions.anyOverdueHelper'),
    },
    { value: 'TAT_OVERDUE', label: t('slaOptions.firstContactMissed') },
    { value: 'TAT_BEFORE', label: t('slaOptions.firstContactComingUp') },
    { value: 'FOLLOW_UP_DUE', label: t('slaOptions.followUpComingUp') },
    { value: 'FOLLOW_UP_OVERDUE', label: t('slaOptions.followUpMissed') },
];
/** `duplicates` URL value → the API's duplicate_filter; anything else = no filter. */
const toDuplicateFilter = (value: string | undefined): 'EXCLUDE' | 'ONLY' | undefined => {
    const v = value?.trim().toLowerCase();
    if (v === 'exclude') return 'EXCLUDE';
    if (v === 'only') return 'ONLY';
    return undefined;
};

const SEARCH_DEBOUNCE_MS = 500;
const PAGE_SIZE_OPTIONS = [10, 20, 50];

const startOfDayIso = (date: string): string | undefined => {
    if (!date) return undefined;
    const d = new Date(`${date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
const endOfDayIso = (date: string): string | undefined => {
    if (!date) return undefined;
    const d = new Date(`${date}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
const toDateInputValue = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
// Date filter is a preset day-range select (no custom calendar) so a counsellor
// can switch windows in one click. "ALL" disables the submitted-date filter.
// (Preset sentinels live in ./recent-leads-search so URL deep-links share them.)
const buildDateRangeOptions = (t: TFunction): { value: string; label: string }[] => [
    { value: '1', label: t('dateRangeOptions.last24Hours') },
    { value: '7', label: t('dateRangeOptions.last7Days') },
    { value: '15', label: t('dateRangeOptions.last15Days') },
    { value: '30', label: t('dateRangeOptions.last30Days') },
    { value: ALL_DATE_VALUE, label: t('dateRangeOptions.allTime') },
    { value: CUSTOM_DATE_VALUE, label: t('dateRangeOptions.customRange') },
];
const rangeForPreset = (preset: string): { from: string; to: string } => {
    if (preset === ALL_DATE_VALUE) return { from: '', to: '' };
    const n = Number(preset);
    if (!Number.isFinite(n) || n <= 0) return { from: '', to: '' };
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (n - 1));
    return { from: toDateInputValue(start), to: toDateInputValue(now) };
};

const displayAudience = (lead: RecentLeadDetail) =>
    lead.campaign_name || lead.source_audience_name || '-';
const csvSafe = (val: unknown) => {
    if (val === undefined || val === null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
};

// Leads submitted through the simple form store the person's own identity under
// these raw custom_field_values keys too; the export already carries them via
// the Name / Email / Mobile base columns, so they're excluded from the
// custom-field columns to avoid duplicate data.
const IDENTITY_CF_KEYS = new Set(['full_name', 'email', 'phone']);

/**
 * Single SLA-filter option content. Pulled out of the inline JSX so the
 * RecentLeadsContent function stays under CodeFactor's complexity threshold.
 * When `helper` is set, render the two-line label + subtitle pattern.
 */
const SlaOptionLabel = ({ label, helper }: { label: string; helper?: string }) => {
    if (!helper) return <>{label}</>;
    return (
        <div className="flex flex-col">
            <span>{label}</span>
            <span className="text-caption text-muted-foreground">{helper}</span>
        </div>
    );
};

export const RecentLeadsPage = () => {
    const { t } = useTranslation('audienceManagerRecentLeadsPage');
    const { setNavHeading } = useNavHeadingStore();
    // Every Enquiry sub-tab (Untouched, Processed, All Leads, …) is this page, so
    // name the one the user opened rather than "Recent Leads" for all of them. The
    // built-in "Recent Leads" entry adds nothing, so that page reads as it always did.
    const activeLabel = useActiveSidebarSection()?.label;
    const sectionLabel = activeLabel && activeLabel !== t('nav.title') ? activeLabel : undefined;
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{sectionLabel || t('nav.title')}</h1>);
    }, [setNavHeading, t, sectionLabel]);

    // Every sidebar sub-tab points at THIS pathname and differs only in its query
    // string, so moving between them never unmounts the content — its filter state is
    // seeded from the URL once and then keeps writing itself back, which overwrote the
    // tab the user just clicked. Remount on an external navigation so the seeding runs
    // again; `selfWriteRef` holds the signature the content last wrote, so its own
    // URL updates are not mistaken for one.
    const urlSearch = useSearch({ from: '/audience-manager/recent-leads/' });
    const signature = searchSignature(urlSearch as Record<string, unknown>);
    const selfWriteRef = useRef(signature);
    const [entryKey, setEntryKey] = useState(0);
    useEffect(() => {
        if (signature === selfWriteRef.current) return;
        selfWriteRef.current = signature;
        setEntryKey((k) => k + 1);
    }, [signature]);

    return (
        <StudentSidebarProvider>
            <RecentLeadsContent
                key={entryKey}
                selfWriteRef={selfWriteRef}
                sectionLabel={sectionLabel}
            />
        </StudentSidebarProvider>
    );
};

const RecentLeadsContent = ({
    selfWriteRef,
    sectionLabel,
}: {
    /** Set to the signature of every search object this component writes, so the
     *  parent can tell those apart from a sub-tab click. */
    selfWriteRef: React.MutableRefObject<string>;
    /** The sidebar sub-tab this list was opened from ("All Leads"), if any. */
    sectionLabel?: string;
}) => {
    const { t } = useTranslation('audienceManagerRecentLeadsPage');
    const { t: tCampaignType } = useTranslation('audienceManagerCampaignTypeDropdown');
    // Built every render, not memoised: the first render runs before this page's
    // catalog has loaded, and a memo kept the raw keys (slaOptions.*) in dev.
    const slaOptions = buildSlaOptions(t);
    const dateRangeOptions = buildDateRangeOptions(t);
    // Institute tier catalog (custom tiers + labels + colours) and the institute's
    // own names for "Tier" / "Lead status".
    const tierCatalog = useLeadTiers();
    const terminology = useLeadTerminology();
    const term = terminology.campaignType;
    const tierLabels: Record<string, string> = useMemo(
        () => Object.fromEntries(tierCatalog.tiers.map((tier) => [tier.tier_key, tier.label])),
        [tierCatalog.tiers]
    );
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id;
    const { setSelectedStudent } = useStudentSidebar();
    const queryClient = useQueryClient();

    // Filters are URL-driven: state seeds from the search params on mount
    // (drill-through links from Reports / Sales Dashboard land here) and the
    // effect below writes every change back with replace:true — same pattern
    // as the Follow-ups page (use-follow-ups-view-state.ts).
    const urlSearch = useSearch({ from: '/audience-manager/recent-leads/' });
    // Filters this ROUTE owns (sidebar sub-tabs bake them into their link). They cannot
    // be removed, and "Clear all" puts them back to the value the route asked for rather
    // than dropping them — otherwise an "Untouched Leads" tab quietly becomes "all leads".
    // Captured at mount, for the same reason pinnedEntryRef below is. This component is
    // REMOUNTED on an external navigation, so reading the live URL here means reacting to
    // the sub-tab the user has just left for: the old instance re-rendered, its URL-writing
    // effect fired because this dep changed, and it put its stale filters back over the tab
    // that was clicked. That is why a sub-tab took two or three clicks to stick.
    const lockRef = useRef(urlSearch.lock);
    const lockedParams = useMemo(() => parseLockedParams(lockRef.current), []);
    // Route-owned like `lock`: a sidebar sub-tab says whether duplicate enquiries count
    // (`duplicates=exclude` on All Leads) or are the whole list (`duplicates=only`).
    const duplicatesRef = useRef(urlSearch.duplicates);
    const duplicateFilter = toDuplicateFilter(duplicatesRef.current);
    // Captured once: the component remounts on an external navigation, so the search at
    // mount IS the tab's intent even after the user has since narrowed things down.
    const pinnedEntryRef = useRef<Record<string, string | undefined>>({
        range: urlSearch.range,
        from: urlSearch.from,
        to: urlSearch.to,
        status: urlSearch.status,
        tier: urlSearch.tier,
        sla: urlSearch.sla,
        counsellor: urlSearch.counsellor,
        audience: urlSearch.audience,
        campaignType: urlSearch.campaignType,
        source: urlSearch.source,
        called: urlSearch.called,
        calledCount: urlSearch.calledCount,
        calledWithin: urlSearch.calledWithin,
        workedWithin: urlSearch.workedWithin,
        search: urlSearch.search,
        statusExclude: urlSearch.statusExclude,
    });
    const isLocked = (param: string) => lockedParams.has(param as never);
    /** The route's value for a pinned filter, or the cleared value when it is not pinned. */
    const clearedOr = (param: string, cleared: string) =>
        isLocked(param) ? pinnedEntryRef.current[param] ?? cleared : cleared;
    /**
     * Like {@link clearedOr}, but the tab's entry value wins even when the filter
     * is NOT locked.
     *
     * Used for the date window. A sub-tab that opens on "All time" should go back
     * to All time when the user clears, not to the 30-day default it never showed
     * them — that default is for someone arriving at Recent Leads cold. Locking
     * the filter would also achieve it, at the cost of not being able to look at
     * a narrower window at all.
     */
    const entryOr = (param: string, fallback: string) => pinnedEntryRef.current[param] ?? fallback;
    const clearedOrList = (param: string): string[] => {
        if (!isLocked(param)) return [];
        const v = pinnedEntryRef.current[param];
        return v ? v.split(',').filter(Boolean) : [];
    };
    const navigate = useNavigate({ from: '/audience-manager/recent-leads/' });

    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(20);
    const [sortBy, setSortBy] = useState<LeadSortKey>('SUBMITTED_AT');
    const [sortDirection, setSortDirection] = useState<LeadSortDirection>('DESC');
    const handleSortChange = (nextSortBy: LeadSortKey, nextSortDirection: LeadSortDirection) => {
        setPage(0);
        setSortBy(nextSortBy);
        setSortDirection(nextSortDirection);
    };
    const [rangeDays, setRangeDays] = useState<string>(
        () =>
            urlSearch.range ??
            (urlSearch.from || urlSearch.to ? CUSTOM_DATE_VALUE : DEFAULT_RANGE_DAYS)
    );
    // Custom-range state (only used when rangeDays === CUSTOM_DATE_VALUE).
    const [customFrom, setCustomFrom] = useState(urlSearch.from ?? '');
    const [customTo, setCustomTo] = useState(urlSearch.to ?? '');
    // Which custom-range calendar is open: the start date's, the end date's, or none.
    const [customOpen, setCustomOpen] = useState<'from' | 'to' | null>(null);
    // Summary header and the long filter list start closed so the leads table is in
    // view; the active-filter chips below always show what is applied.
    const [showSummary, setShowSummary] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    // Same query as the UTM controls, so the Campaign links section hides with them.
    const utmControls = useUtmListFilters('LEADS', instituteId || undefined);
    // "Worked in the last …" windows. Rolling, and independent of the submitted-date
    // range above: a lead submitted 3 months ago that I called this morning belongs in
    // "called in the last 24h", and the submitted filter can never say so.
    const [calledWindow, setCalledWindow] = useState(urlSearch.calledWithin ?? '');
    const [workedWindow, setWorkedWindow] = useState(urlSearch.workedWithin ?? '');
    // Explicit from–to, only read while the matching window holds WORKED_WINDOW_CUSTOM.
    const [calledRange, setCalledRange] = useState({
        from: urlSearch.calledFrom ?? '',
        to: urlSearch.calledTo ?? '',
    });
    const [workedRange, setWorkedRange] = useState({
        from: urlSearch.workedFrom ?? '',
        to: urlSearch.workedTo ?? '',
    });
    // Recomputed per render on purpose — an absolute instant frozen in state would
    // silently go stale as the page sits open, so "last 24 hours" would keep meaning
    // 24 hours before the page loaded rather than 24 hours before now.
    // A preset is rolling and open-ended at the top; a custom range bounds both ends
    // by calendar day, exactly like the submitted-date filter beside it.
    const calledIsCustom = calledWindow === WORKED_WINDOW_CUSTOM;
    const workedIsCustom = workedWindow === WORKED_WINDOW_CUSTOM;
    const calledFromIso = calledIsCustom
        ? startOfDayIso(calledRange.from)
        : workedWindowFromIso(calledWindow);
    const calledToIso = calledIsCustom ? endOfDayIso(calledRange.to) : undefined;
    const workedFromIso = workedIsCustom
        ? startOfDayIso(workedRange.from)
        : workedWindowFromIso(workedWindow);
    const workedToIso = workedIsCustom ? endOfDayIso(workedRange.to) : undefined;
    const appliedRange = useMemo(
        () =>
            rangeDays === CUSTOM_DATE_VALUE
                ? { from: customFrom, to: customTo }
                : rangeForPreset(rangeDays),
        [rangeDays, customFrom, customTo]
    );
    // Audience multi-select — campaign ids. Empty = all campaigns.
    const [audienceFilters, setAudienceFilters] = useState<string[]>(() =>
        urlSearch.audience
            ? urlSearch.audience.split(',').filter((v) => v && v !== ALL_AUDIENCES_VALUE)
            : []
    );
    // Campaign-type multi-select — narrows both the audience dropdown and the
    // leads to audiences of these types. Empty = every type.
    const [campaignTypeFilters, setCampaignTypeFilters] = useState<string[]>(() =>
        urlSearch.campaignType ? urlSearch.campaignType.split(',').filter(Boolean) : []
    );

    const [searchInput, setSearchInput] = useState(urlSearch.search ?? '');
    const [appliedSearch, setAppliedSearch] = useState(urlSearch.search ?? '');
    useEffect(() => {
        const trimmed = searchInput.trim();
        if (trimmed === appliedSearch) return;
        const timer = window.setTimeout(() => {
            setAppliedSearch(trimmed);
            setPage(0);
        }, SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput, appliedSearch]);

    // Multi-select arrays seeded from URL (comma-separated strings). Empty = no filter.
    const [tierFilters, setTierFilters] = useState<string[]>(() =>
        urlSearch.tier ? urlSearch.tier.split(',') : []
    );
    // Lead-status multi-select. Empty = all leads. ALL_ACTIVE / ALL_CONVERTED are
    // exclusive: handleLeadStatusChange enforces mutual exclusion with custom statuses.
    const [statusExclude, setStatusExclude] = useState(urlSearch.statusExclude === '1');
    const [leadStatusFilters, setLeadStatusFilters] = useState<string[]>(() =>
        urlSearch.status ? urlSearch.status.split(',') : []
    );
    // SLA-state multi-select.
    const [slaFilters, setSlaFilters] = useState<string[]>(() =>
        urlSearch.sla ? urlSearch.sla.split(',') : []
    );
    // Counsellor multi-select — userIds (may include UNASSIGNED_COUNSELLOR_VALUE).
    const [counsellorFilters, setCounsellorFilters] = useState<string[]>(() =>
        urlSearch.counsellor ? urlSearch.counsellor.split(',') : []
    );
    // Source-type filter — URL-only for now (no dropdown); drill-through links
    // from the Reports source breakdown set it. Empty string = all sources.
    const [sourceFilter, setSourceFilter] = useState<string>(urlSearch.source ?? '');

    // Call-history filter — has this lead been call-attempted (AI or manual), and
    // how many times. Single-select; '' = no filter.
    const [callHistoryFilter, setCallHistoryFilter] = useState<string>(urlSearch.called ?? '');
    // Attempt count for the "Called exactly N" / "Called at least N" options.
    // Only sent when one of those is selected — every other call-history value
    // ignores it, so it must not vary the request otherwise.
    const [callCountValue, setCallCountValue] = useState<number>(() =>
        urlSearch.calledCount ? normalizeCallCount(urlSearch.calledCount) : DEFAULT_CALL_COUNT
    );
    const callCountParam = isCallCountFilter(callHistoryFilter) ? callCountValue : undefined;

    // Custom-field filters — keyed by custom_field_id, each holding the selected
    // values (multi-select). Only fields the admin enabled in Lead Settings
    // render a control; an empty map means none are active.
    const { fields: filterCustomFields } = useLeadFilterCustomFields(instituteId);
    const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string[]>>({});
    const setCustomFieldFilter = (fieldId: string, values: string[]) => {
        setPage(0);
        setCustomFieldFilters((prev) => {
            const next = { ...prev };
            if (values.length === 0) delete next[fieldId];
            else next[fieldId] = values;
            return next;
        });
    };
    // Serialized {field_id, operator, values} payload + a stable cache key
    // (order-independent). Sentinel selections (contains / empty / ranges)
    // decode into their operator entries; plain values stay an IN entry.
    const customFieldFiltersPayload = useMemo(
        () =>
            Object.entries(customFieldFilters)
                .filter(([, vals]) => vals.length > 0)
                .flatMap(([fieldId, values]) => decodeSelectionToEntries(fieldId, values)),
        [customFieldFilters]
    );
    const customFieldFiltersKey = useMemo(
        () =>
            customFieldFiltersPayload
                .map((f) => `${f.field_id}:${f.operator ?? 'IN'}=${[...f.values].sort().join(',')}`)
                .sort()
                .join('|'),
        [customFieldFiltersPayload]
    );

    // Campaign (UTM) filters — one value list per dimension. The controls
    // render nothing while the institute's UTM setting is off, so the state
    // simply stays empty on institutes that never use campaign links.
    const [utmFilters, setUtmFilters] = useState<UtmFilterSelection>(() => {
        const initial: UtmFilterSelection = {};
        for (const dimension of UTM_FILTER_DIMENSIONS) {
            const raw = urlSearch[UTM_SEARCH_PARAM[dimension]];
            if (raw) initial[dimension] = raw.split(',').filter(Boolean);
        }
        return initial;
    });
    const { t: tUtm } = useTranslation('utmListFilters');
    const setUtmFilter = (dimension: UtmFilterDimension, values: string[]) => {
        setPage(0);
        setUtmFilters((prev) => {
            const next = { ...prev };
            if (values.length === 0) delete next[dimension];
            else next[dimension] = values;
            return next;
        });
    };
    const utmFiltersPayload = useMemo(() => toUtmFiltersPayload(utmFilters), [utmFilters]);
    const utmFiltersKey = useMemo(() => utmSelectionKey(utmFilters), [utmFilters]);

    // Write the applied filters back to the URL (replace, not push — filter
    // tweaks shouldn't pollute browser history). Arrays are serialised as
    // comma-separated strings; empty arrays are omitted so the bare URL stays clean.
    useEffect(() => {
        const nextSearch = {
            // Carried through untouched: the route owns it, not the user.
            lock: lockRef.current || undefined,
            duplicates: duplicatesRef.current || undefined,
            status: leadStatusFilters.length > 0 ? leadStatusFilters.join(',') : undefined,
            statusExclude: statusExclude ? '1' : undefined,
            tier: tierFilters.length > 0 ? tierFilters.join(',') : undefined,
            sla: slaFilters.length > 0 ? slaFilters.join(',') : undefined,
            counsellor: counsellorFilters.length > 0 ? counsellorFilters.join(',') : undefined,
            audience: audienceFilters.length > 0 ? audienceFilters.join(',') : undefined,
            campaignType:
                campaignTypeFilters.length > 0 ? campaignTypeFilters.join(',') : undefined,
            search: appliedSearch || undefined,
            range: rangeDays === DEFAULT_RANGE_DAYS ? undefined : rangeDays,
            from: rangeDays === CUSTOM_DATE_VALUE && customFrom ? customFrom : undefined,
            to: rangeDays === CUSTOM_DATE_VALUE && customTo ? customTo : undefined,
            source: sourceFilter || undefined,
            called: callHistoryFilter || undefined,
            calledCount: callCountParam ? String(callCountParam) : undefined,
            calledWithin: calledWindow || undefined,
            calledFrom: calledIsCustom && calledRange.from ? calledRange.from : undefined,
            calledTo: calledIsCustom && calledRange.to ? calledRange.to : undefined,
            workedWithin: workedWindow || undefined,
            workedFrom: workedIsCustom && workedRange.from ? workedRange.from : undefined,
            workedTo: workedIsCustom && workedRange.to ? workedRange.to : undefined,
            utmSource: utmFilters.source?.length ? utmFilters.source.join(',') : undefined,
            utmMedium: utmFilters.medium?.length ? utmFilters.medium.join(',') : undefined,
            utmCampaign: utmFilters.campaign?.length ? utmFilters.campaign.join(',') : undefined,
            utmContent: utmFilters.content?.length ? utmFilters.content.join(',') : undefined,
            utmTerm: utmFilters.term?.length ? utmFilters.term.join(',') : undefined,
            utmChannel: utmFilters.source_type?.length
                ? utmFilters.source_type.join(',')
                : undefined,
        };
        // Record what we are about to write so the parent does not read our own
        // update back as a sub-tab click and remount us mid-edit.
        selfWriteRef.current = searchSignature(nextSearch);
        void navigate({ search: nextSearch, replace: true });
    }, [
        navigate,
        leadStatusFilters,
        statusExclude,
        tierFilters,
        slaFilters,
        counsellorFilters,
        audienceFilters,
        campaignTypeFilters,
        appliedSearch,
        rangeDays,
        customFrom,
        customTo,
        sourceFilter,
        callHistoryFilter,
        callCountParam,
        calledWindow,
        workedWindow,
        selfWriteRef,
        calledIsCustom,
        workedIsCustom,
        calledRange,
        workedRange,
        utmFilters,
    ]);
    // Filter options — hierarchy scoped: a manager sees themselves + their
    // counsellor reports; pure admins get the institute-wide roster.
    const { options: counsellorOptions, isLoading: counsellorOptionsLoading } =
        useLeadCounsellorOptions();
    // Assignment TARGETS for the bulk-assign dialog: an ADMIN who also holds
    // the COUNSELLOR role filters by their hierarchy above, but may still
    // assign leads to any counsellor of the institute.
    const { options: assignableCounsellorOptions } = useLeadCounsellorOptions({
        assignable: true,
    });

    const leadSettings = useLeadSettings();
    const showOps = !leadSettings.isLoading && leadSettings.enabled;
    const showScore = showOps && leadSettings.showScoreInEnquiryTable;

    // Custom lead-status catalog — drives both the filter dropdown and the
    // editable status chip in the table.
    const { statuses: leadStatusCatalog, filterStatuses: leadStatusFilterOptions } =
        useLeadStatuses();

    // Table UI state — column show/hide is persisted per user (localStorage) so
    // the "Manage Column" choice survives reloads and navigation.
    const { hiddenColumns, toggleColumn, resetColumns } = useLeadColumnPrefs(
        'crm-lead-columns:recent-leads'
    );
    // Order is a second, independent preference — Manage Payments already pairs these two
    // the same way, so the two tables behave identically.
    const { columnOrder, setColumnOrder, resetColumnOrder } = useColumnOrderPrefs(
        'crm-lead-column-order:recent-leads'
    );
    /** Reset restores BOTH halves of the layout: what is hidden and what order it is in. */
    const handleResetColumns = () => {
        resetColumns();
        resetColumnOrder();
    };

    const [noteTarget, setNoteTarget] = useState<{
        userId: string;
        userName: string;
        responseId?: string;
    } | null>(null);
    const [counsellorTarget, setCounsellorTarget] = useState<{
        userId: string;
        userName: string;
    } | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    // "Manage Column" toggle list — only the columns actually visible for the
    // current config (the Lead-name column is always shown).
    const naturalColumnToggles = useMemo(
        () =>
            buildLeadColumnToggles(showOps, showScore, {
                tier: terminology.tier,
                leadStatus: terminology.leadStatus,
                campaignType: terminology.campaignType,
                leadSource: terminology.leadSource,
            }),
        [
            showOps,
            showScore,
            terminology.tier,
            terminology.leadStatus,
            terminology.campaignType,
            terminology.leadSource,
        ]
    );
    const toggleableColumns = useMemo(() => {
        const byId = new Map(naturalColumnToggles.map((t) => [t.id, t]));
        return orderColumnIds([...byId.keys()], columnOrder)
            .map((id) => byId.get(id))
            .filter((t): t is LeadColumnToggle => !!t);
    }, [naturalColumnToggles, columnOrder]);

    const audiencesQuery = useQuery(
        handleFetchCampaignsList({ institute_id: instituteId ?? '', page: 0, size: 200 })
    );
    const audienceOptions = useMemo(
        () =>
            (audiencesQuery.data?.content ?? [])
                .map((c) => ({
                    id: c.id || c.campaign_id || c.audience_id || '',
                    name: c.campaign_name || t('filters.audience.untitled'),
                    campaignType: c.campaign_type,
                    status: c.status,
                }))
                .filter((opt) => opt.id !== ''),
        [audiencesQuery.data, t]
    );
    // Same options as the Lead List's Campaign Type filter: the defaults, then
    // every other type saved on this institute's audiences.
    const campaignTypeOptions = useMemo(
        () =>
            buildCampaignTypeFilterOptions(buildDefaultCampaignTypeOptions(tCampaignType), [
                ...audienceOptions.map((opt) => opt.campaignType),
                ...campaignTypeFilters,
            ]),
        [tCampaignType, audienceOptions, campaignTypeFilters]
    );
    // Audiences of the picked campaign types — what the audience dropdown offers.
    const typeAudienceOptions = useMemo(
        () => filterByCampaignTypes(audienceOptions, campaignTypeFilters),
        [audienceOptions, campaignTypeFilters]
    );
    // The audiences the leads are narrowed to. With no campaign type picked this
    // is audienceFilters itself, so the request is exactly what it was before the
    // type filter existed. The 200-row audience fetch above covers every institute
    // (the largest has ~80 audiences).
    const resolvedAudienceIds = useMemo(
        () => resolveLeadAudienceIds(audienceFilters, campaignTypeFilters, audienceOptions),
        [audienceFilters, campaignTypeFilters, audienceOptions]
    );
    // The type → audience mapping needs the audience list, so the leads request
    // waits for it. Once it is in, null means no audience of these types: skip the
    // request, because sending no audience ids would mean "all leads". Keyed on
    // having data, not on status, so a failed background refetch keeps the list
    // already loaded instead of blanking the leads.
    const hasAudienceList = audiencesQuery.data !== undefined;
    const waitingForTypeAudiences = campaignTypeFilters.length > 0 && !hasAudienceList;
    const noTypeAudiences = !waitingForTypeAudiences && resolvedAudienceIds === null;
    // An audience list that never loaded can't be mapped to types — show the
    // error, not "0 leads".
    const typeAudiencesError =
        waitingForTypeAudiences && audiencesQuery.isError ? audiencesQuery.error : null;

    // Translate the multi-select status filter into the two backend params.
    const specialStatuses = new Set([ALL_STATUSES_VALUE, ALL_ACTIVE_VALUE, ALL_CONVERTED_VALUE]);
    const customStatusKeys = leadStatusFilters.filter((v) => !specialStatuses.has(v));
    // The same picks, read the other way round when exclude mode is on. The Active /
    // Enrolled sentinels are conversion filters, not status keys, so they never invert.
    const leadStatusId =
        !statusExclude && customStatusKeys.length > 0 ? customStatusKeys.join(',') : undefined;
    const leadStatusExcludeId =
        statusExclude && customStatusKeys.length > 0 ? customStatusKeys.join(',') : undefined;
    // "Deleted leads" view — deleted leads are hidden everywhere by default; this is the one
    // place they can be seen, and the only way to restore one from the UI.
    const [showDeleted, setShowDeleted] = useState(false);
    // The unfiltered "All leads" view hides converted leads only when the institute turned on
    // LEAD_SETTING.hideConvertedInAllLeads. Picking a specific status (including the
    // institute's CONVERTED one) and the Deleted view always get every lead.
    const hideConvertedByDefault =
        leadSettings.hideConvertedInAllLeads && leadStatusFilters.length === 0 && !showDeleted;
    const conversionFilter: 'EXCLUDE_CONVERTED' | 'ALL' | 'ONLY_CONVERTED' =
        leadStatusFilters.includes(ALL_ACTIVE_VALUE) || hideConvertedByDefault
            ? 'EXCLUDE_CONVERTED'
            : leadStatusFilters.includes(ALL_CONVERTED_VALUE)
              ? 'ONLY_CONVERTED'
              : 'ALL';
    // Undefined (not EXCLUDE_DELETED) when off, so the backend's own default applies and the
    // param stays absent from the normal request.
    const audienceStatusFilter: 'ONLY_DELETED' | undefined = showDeleted
        ? 'ONLY_DELETED'
        : undefined;

    // Restore needs no confirm dialog: unlike delete it's additive, and the rows are already
    // sitting in a view the admin had to opt into.
    const restoreMutation = useMutation({
        mutationFn: () =>
            restoreAudienceLeads({
                responseIds: Array.from(selectedLeads.keys()),
                instituteId: instituteId ?? '',
            }),
        onSuccess: (restored: number) => {
            toast.success(t('toasts.leadRestored', { count: restored }));
            setSelectedLeads(new Map());
            handleStatusUpdated();
        },
        onError: (error: unknown) => {
            const message =
                (error as { response?: { data?: { ex?: string } } })?.response?.data?.ex ??
                t('toasts.restoreFailed');
            toast.error(message);
        },
    });
    const nonUnassignedCounsellorIds = counsellorFilters.filter(
        (v) => v !== UNASSIGNED_COUNSELLOR_VALUE
    );
    const onlyUnassigned =
        counsellorFilters.includes(UNASSIGNED_COUNSELLOR_VALUE) &&
        nonUnassignedCounsellorIds.length === 0;

    // Audience multi-select → request params. Exactly one pick routes to the
    // per-campaign query (audience_id, which also honours the source filter);
    // two or more go to the institute-wide query narrowed by audience_ids.
    // Strictly either/or — sending both would be ambiguous server-side.
    const audienceParams = useMemo(() => {
        const ids = resolvedAudienceIds ?? [];
        return {
            audience_id: ids.length === 1 ? ids[0] : undefined,
            audience_ids: ids.length > 1 ? ids : undefined,
        };
    }, [resolvedAudienceIds]);

    const {
        data,
        isLoading: leadsLoading,
        error,
    } = useQuery({
        queryKey: [
            'recent-leads',
            instituteId,
            duplicateFilter,
            appliedRange.from,
            appliedRange.to,
            (resolvedAudienceIds ?? []).join(','),
            // Keeps a type with no audiences (request skipped) from reading the
            // cached unfiltered list, which has the same empty audience ids.
            campaignTypeFilters.join(','),
            appliedSearch,
            tierFilters.join(','),
            leadStatusFilters.join(','),
            leadStatusId,
            leadStatusExcludeId,
            leadStatusExcludeId,
            conversionFilter,
            audienceStatusFilter,
            slaFilters.join(','),
            counsellorFilters.join(','),
            sourceFilter,
            callHistoryFilter,
            callCountParam,
            calledWindow,
            workedWindow,
            // The raw yyyy-mm-dd, NOT the derived instants: a preset's instant is
            // Date.now()-based and would change the key on every single render.
            calledRange.from,
            calledRange.to,
            workedRange.from,
            workedRange.to,
            customFieldFiltersKey,
            utmFiltersKey,
            page,
            pageSize,
            sortBy,
            sortDirection,
        ],
        queryFn: () =>
            fetchRecentLeads({
                institute_id: instituteId ?? '',
                ...audienceParams,
                submitted_from_local: startOfDayIso(appliedRange.from),
                submitted_to_local: endOfDayIso(appliedRange.to),
                search_query: appliedSearch || undefined,
                lead_tier: tierFilters.length > 0 ? tierFilters.join(',') : undefined,
                lead_status_id: leadStatusId,
                lead_status_exclude_id: leadStatusExcludeId,
                duplicate_filter: duplicateFilter,
                conversion_status_filter: conversionFilter,
                audience_status_filter: audienceStatusFilter,
                sla_filter: slaFilters.length > 0 ? (slaFilters.join(',') as SlaFilter) : undefined,
                assigned_counselor_id:
                    nonUnassignedCounsellorIds.length > 0
                        ? nonUnassignedCounsellorIds.join(',')
                        : undefined,
                is_unassigned: onlyUnassigned ? true : undefined,
                source_type: sourceFilter || undefined,
                call_history_filter: callHistoryFilter || undefined,
                call_count_value: callCountParam,
                called_from_local: calledFromIso,
                called_to_local: calledToIso,
                activity_from_local: workedFromIso,
                activity_to_local: workedToIso,
                custom_field_filters: customFieldFiltersPayload.length
                    ? customFieldFiltersPayload
                    : undefined,
                utm_filters: utmFiltersPayload,
                sort_by: sortBy,
                sort_direction: sortDirection,
                page,
                size: pageSize,
            }),
        // Wait for lead settings so the first request already carries the right conversion filter.
        enabled:
            !!instituteId &&
            !leadSettings.isLoading &&
            !waitingForTypeAudiences &&
            !noTypeAudiences,
        staleTime: 30 * 1000,
    });
    // A disabled query is not "loading" in v5, so count the settings and audience-list waits too.
    const isLoading =
        leadsLoading ||
        leadSettings.isLoading ||
        (waitingForTypeAudiences && audiencesQuery.isPending);

    const totalPages = data?.totalPages ?? 0;
    const totalElements = data?.totalElements ?? 0;

    const vms = useMemo(() => (data?.content ?? []).map(recentLeadToVM), [data]);
    const userIds = useMemo(
        () =>
            (data?.content ?? [])
                .map((l) => l.user?.id || l.user_id || '')
                .filter((id): id is string => !!id),
        [data]
    );
    const { profiles: leadProfiles } = useLeadProfiles(userIds, showOps, instituteId);
    const { notesByUserId } = useLatestNotesBatch(userIds, showOps);

    const invalidateKeys = [['recent-leads'], ['lead-profiles-batch']];
    const updateTier = useUpdateLeadTier({ invalidateKeys });
    const placeCall = usePlaceCall({ invalidateKeys });
    const placeAiCall = usePlaceAiCall({ invalidateKeys });
    // The robot "AI call" button only shows when an admin has turned it on in
    // Settings → AI Calling. Automated AI workflows are unaffected by this.
    const showAiButton = useAiCallButtonEnabled();
    // Per-row AI call opens a chooser (which agent speaks) instead of silently
    // dialing with the institute default.
    const [aiCallTarget, setAiCallTarget] = useState<AiCallDialogTarget | null>(null);

    const actions: LeadActionHandlers = useMemo(
        () => ({
            onOpenDetails: (vm) => {
                // Open the compact side-view sheet, NOT the fullscreen overlay.
                setSelectedStudent(vm.toStudent(), { openOverlay: false });
                setIsSidebarOpen(true);
            },
            onAddNote: (userId, userName, responseId) =>
                setNoteTarget({ userId, userName, responseId }),
            onAssignCounsellor: (userId, userName) => setCounsellorTarget({ userId, userName }),
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
            onAiCallLead: showAiButton
                ? (vm) => {
                      if (!vm.responseId) return;
                      setAiCallTarget({
                          responseId: vm.responseId,
                          userId: vm.userId ?? undefined,
                          leadName: vm.name,
                      });
                  }
                : undefined,
        }),
        [setSelectedStudent, updateTier, placeCall, showAiButton, t]
    );
    // Enhanced lead side panel: Previous / Next and quick actions run on these rows.

    // The backend mirrors a per-response status change onto the user's profile
    // conversion_status, so the side-view agrees. Invalidate the profile/batch caches too
    // (not just the list) or the side-view could still serve a stale cached profile.
    const handleStatusUpdated = () => {
        queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
        queryClient.invalidateQueries({ queryKey: ['user-lead-profile'] });
        queryClient.invalidateQueries({ queryKey: ['lead-profiles-batch'] });
    };

    // ── Bulk assign / remove counsellor (multi-select, every view) ──
    // Keyed by RESPONSE id, not user id: a row is one campaign response and the same person
    // can hold several, so keying by user collapsed their rows into one checkbox. The value
    // carries the userId too, because the assign actions operate per person.
    const [selectedLeads, setSelectedLeads] = useState<
        Map<string, { userId: string; responseId: string; name: string }>
    >(new Map());
    const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
    const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
    const [bulkMigrateOpen, setBulkMigrateOpen] = useState(false);
    const canDeleteLeads = isAdminForInstitute(instituteId);
    // "Add New Lead" — off for every role until Display Settings → Lead Actions turns it on.
    const { canAddLead } = useLeadActionVisibility();
    const [addLeadOpen, setAddLeadOpen] = useState(false);
    // Which flow the "Bulk actions" menu opened: assign (round-robin default)
    // or unassign (REMOVE).
    const [bulkActionMode, setBulkActionMode] = useState<BulkAssignMode>('ROUND_ROBIN');

    // Selection works in EVERY view (assign, reassign AND bulk-remove need
    // assigned leads too — it was previously Unassigned-only, which made the
    // dialog's Remove mode unreachable). Drop it when the counsellor filter
    // changes so stale ids can't leak into an assign.
    useEffect(() => {
        setSelectedLeads(new Map());
    }, [counsellorFilters]);

    const toggleLeadRow = (responseId: string, vm: LeadCardVM) =>
        setSelectedLeads((prev) => {
            const next = new Map(prev);
            if (next.has(responseId)) next.delete(responseId);
            else if (vm.userId)
                next.set(responseId, { userId: vm.userId, responseId, name: vm.name });
            return next;
        });

    const toggleAllLeads = (checked: boolean, selectableVms: LeadCardVM[]) =>
        setSelectedLeads((prev) => {
            const next = new Map(prev);
            selectableVms.forEach((v) => {
                if (!v.userId || !v.responseId) return;
                if (checked)
                    next.set(v.responseId, {
                        userId: v.userId,
                        responseId: v.responseId,
                        name: v.name,
                    });
                else next.delete(v.responseId);
            });
            return next;
        });

    const handleBulkAssignSuccess = () => {
        setSelectedLeads(new Map());
        handleStatusUpdated();
    };

    // Select every lead matching the current filter (across all pages) — fetches
    // all matching ids in one call, mirroring the paginated query's params.
    const [selectAllLoading, setSelectAllLoading] = useState(false);
    const selectAllAcrossPages = async () => {
        if (!totalElements || noTypeAudiences) return;
        try {
            setSelectAllLoading(true);
            const res = await fetchRecentLeads({
                institute_id: instituteId ?? '',
                ...audienceParams,
                submitted_from_local: startOfDayIso(appliedRange.from),
                submitted_to_local: endOfDayIso(appliedRange.to),
                search_query: appliedSearch || undefined,
                lead_tier: tierFilters.length > 0 ? tierFilters.join(',') : undefined,
                lead_status_id: leadStatusId,
                lead_status_exclude_id: leadStatusExcludeId,
                duplicate_filter: duplicateFilter,
                conversion_status_filter: conversionFilter,
                audience_status_filter: audienceStatusFilter,
                sla_filter: slaFilters.length > 0 ? (slaFilters.join(',') as SlaFilter) : undefined,
                assigned_counselor_id:
                    nonUnassignedCounsellorIds.length > 0
                        ? nonUnassignedCounsellorIds.join(',')
                        : undefined,
                is_unassigned: onlyUnassigned ? true : undefined,
                source_type: sourceFilter || undefined,
                call_history_filter: callHistoryFilter || undefined,
                call_count_value: callCountParam,
                called_from_local: calledFromIso,
                called_to_local: calledToIso,
                activity_from_local: workedFromIso,
                activity_to_local: workedToIso,
                custom_field_filters: customFieldFiltersPayload.length
                    ? customFieldFiltersPayload
                    : undefined,
                utm_filters: utmFiltersPayload,
                page: 0,
                size: totalElements,
            });
            const map = new Map<string, { userId: string; responseId: string; name: string }>();
            (res.content ?? []).forEach((lead) => {
                const uid = lead.user?.id || lead.user_id;
                // Keyed by response id to match the per-row selection — a person with several
                // responses is several selected rows, not one.
                if (!uid || !lead.response_id) return;
                map.set(lead.response_id, {
                    userId: uid,
                    responseId: lead.response_id,
                    name: lead.user?.full_name || lead.parent_name || uid,
                });
            });
            setSelectedLeads(map);
        } catch {
            toast.error(t('toasts.selectAllFailed'));
        } finally {
            setSelectAllLoading(false);
        }
    };

    // Filters
    const handleClearFilter = () => {
        setAudienceFilters(clearedOrList('audience'));
        setCampaignTypeFilters(clearedOrList('campaignType'));
        setSearchInput(clearedOr('search', ''));
        setAppliedSearch(clearedOr('search', ''));
        setTierFilters(clearedOrList('tier'));
        setLeadStatusFilters(clearedOrList('status'));
        setStatusExclude(isLocked('statusExclude') && pinnedEntryRef.current.statusExclude === '1');
        setSlaFilters(clearedOrList('sla'));
        setCounsellorFilters(clearedOrList('counsellor'));
        setSourceFilter(clearedOr('source', ''));
        setCallHistoryFilter(clearedOr('called', ''));
        setCallCountValue(
            isLocked('calledCount') && pinnedEntryRef.current.calledCount
                ? Number(pinnedEntryRef.current.calledCount)
                : DEFAULT_CALL_COUNT
        );
        setCustomFieldFilters({});
        setUtmFilters({});
        setRangeDays(entryOr('range', DEFAULT_RANGE_DAYS));
        setCustomFrom(entryOr('from', ''));
        setCustomTo(entryOr('to', ''));
        setCalledWindow(clearedOr('calledWithin', ''));
        setWorkedWindow(clearedOr('workedWithin', ''));
        setPage(0);
    };
    const setDateRange = (value: string) => {
        if (isLocked('range')) return;
        setPage(0);
        setRangeDays(value);
        if (value === CUSTOM_DATE_VALUE) {
            // Seed the custom inputs with the last 30 days so a counsellor can
            // tweak from a sensible starting point instead of empty fields.
            if (!customFrom && !customTo) {
                const seed = rangeForPreset(DEFAULT_RANGE_DAYS);
                setCustomFrom(seed.from);
                setCustomTo(seed.to);
            }
            setCustomOpen('from');
        }
    };
    const setCounsellor = (values: string[]) => {
        setPage(0);
        if (isLocked('counsellor')) return;
        setCounsellorFilters(values);
    };
    const setTier = (values: string[]) => {
        setPage(0);
        setTierFilters(values);
    };
    const handleLeadStatusChange = (newValues: string[]) => {
        setPage(0);
        const justAddedActive =
            newValues.includes(ALL_ACTIVE_VALUE) && !leadStatusFilters.includes(ALL_ACTIVE_VALUE);
        const justAddedConverted =
            newValues.includes(ALL_CONVERTED_VALUE) &&
            !leadStatusFilters.includes(ALL_CONVERTED_VALUE);
        if (justAddedActive) {
            setLeadStatusFilters([ALL_ACTIVE_VALUE]);
        } else if (justAddedConverted) {
            setLeadStatusFilters([ALL_CONVERTED_VALUE]);
        } else {
            setLeadStatusFilters(
                newValues.filter((v) => v !== ALL_ACTIVE_VALUE && v !== ALL_CONVERTED_VALUE)
            );
        }
    };
    const setSla = (values: string[]) => {
        setPage(0);
        setSlaFilters(values);
    };
    const handleAudienceChange = (values: string[]) => {
        setPage(0);
        setAudienceFilters(values);
    };
    // Picked audiences that are not of the new types would be invisible in the
    // dropdown yet still narrow the leads, so drop them. Only once the audience
    // list is in — before that every pick would look type-less and be wiped
    // (resolveLeadAudienceIds still keeps the leads inside the types meanwhile).
    const handleCampaignTypeChange = (values: string[]) => {
        setPage(0);
        setCampaignTypeFilters(values);
        if (values.length === 0 || !hasAudienceList) return;
        const keep = new Set(filterByCampaignTypes(audienceOptions, values).map((opt) => opt.id));
        setAudienceFilters((prev) => prev.filter((id) => keep.has(id)));
    };

    const isFilterActive =
        rangeDays !== DEFAULT_RANGE_DAYS ||
        audienceFilters.length > 0 ||
        campaignTypeFilters.length > 0 ||
        !!appliedSearch ||
        tierFilters.length > 0 ||
        leadStatusFilters.length > 0 ||
        slaFilters.length > 0 ||
        counsellorFilters.length > 0 ||
        !!sourceFilter ||
        !!callHistoryFilter ||
        !!calledWindow ||
        !!workedWindow ||
        customFieldFiltersPayload.length > 0 ||
        hasUtmSelection(utmFilters);

    // CSV export (shared by "Export" + "Export selected")
    const [isExporting, setIsExporting] = useState(false);
    const [exportPickerOpen, setExportPickerOpen] = useState(false);
    const [selectedExportCols, setSelectedExportCols] = useState<Set<string>>(new Set());
    // Institute custom-field catalog — names the custom-field export columns
    // and seeds the picker options (same source the Lead List page uses).
    const { data: customFieldSetup } = useCustomFieldSetup(instituteId);

    const exportColumnOptions = useMemo<ExportColumnOption[]>(() => {
        const cols: ExportColumnOption[] = [
            { key: 'lead_id', label: t('export.columns.leadId') },
            { key: 'submitted_at', label: t('export.columns.submittedAt') },
            { key: 'name', label: t('export.columns.name') },
            { key: 'email', label: t('export.columns.email') },
            { key: 'mobile', label: t('export.columns.mobile') },
            { key: 'audience', label: t('export.columns.audience') },
            { key: 'campaign_type', label: t('export.columns.campaignType', { term }) },
            { key: 'utm_campaign', label: t('export.columns.utmCampaign') },
        ];
        // Custom-field columns: the institute catalog gives the full pickable
        // set (Recent Leads is cross-campaign, so no single form definition
        // applies); rows on the current page can additionally surface fields
        // that no longer exist in the setup but still hold values on old leads.
        const seenIds = new Set<string>();
        const seenNames = new Set<string>();
        const pushCf = (id: string | undefined, name: string | undefined) => {
            if (!id || !name || IDENTITY_CF_KEYS.has(id)) return;
            if (seenIds.has(id) || seenNames.has(name)) return;
            seenIds.add(id);
            seenNames.add(name);
            cols.push({ key: `cf__${id}`, label: name });
        };
        (customFieldSetup ?? [])
            .filter((f) => !f.is_hidden)
            .sort((a, b) => (a.form_order ?? 0) - (b.form_order ?? 0))
            .forEach((f) => pushCf(f.custom_field_id, f.field_name));
        (data?.content ?? []).forEach((lead) => {
            const meta = lead.custom_field_metadata ?? {};
            Object.keys(lead.custom_field_values ?? {}).forEach((id) => {
                const m = meta[id] ?? {};
                pushCf(id, m.fieldName ?? m.field_name ?? id);
            });
        });
        if (showOps) {
            cols.push(
                { key: 'lead_status', label: t('export.columns.leadStatus') },
                { key: 'counsellor', label: t('export.columns.counsellor') },
                { key: 'activity_notes', label: t('export.columns.activityNotes') },
                { key: 'notes_count', label: t('export.columns.notesCount') },
                { key: 'lead_journey', label: t('export.columns.leadJourney') }
            );
        }
        return cols;
    }, [showOps, customFieldSetup, data, t, term]);
    const exportLeadsCsv = async (leads: RecentLeadDetail[], prefix: string) => {
        if (leads.length === 0) {
            toast.info(t('export.noLeadsToExport'));
            return;
        }
        const ids = Array.from(
            new Set(leads.map((l) => l.user?.id || l.user_id || '').filter(Boolean))
        ) as string[];
        const needsOps =
            showOps &&
            (selectedExportCols.has('lead_status') ||
                selectedExportCols.has('counsellor') ||
                selectedExportCols.has('activity_notes') ||
                selectedExportCols.has('notes_count') ||
                selectedExportCols.has('lead_journey'));
        const [prof, nts, jny] = await Promise.all([
            needsOps ? fetchBatchProfiles(ids, instituteId ?? '') : Promise.resolve({}),
            needsOps ? fetchLatestNotesBatch(ids) : Promise.resolve({}),
            needsOps ? fetchLeadJourneyBatch(ids) : Promise.resolve({}),
        ]);
        const baseHeaders: string[] = [];
        if (selectedExportCols.has('lead_id')) baseHeaders.push(t('export.columns.leadId'));
        if (selectedExportCols.has('submitted_at'))
            baseHeaders.push(t('export.columns.submittedAt'));
        if (selectedExportCols.has('name')) baseHeaders.push(t('export.columns.name'));
        if (selectedExportCols.has('email')) baseHeaders.push(t('export.columns.email'));
        if (selectedExportCols.has('mobile')) baseHeaders.push(t('export.columns.mobile'));
        if (selectedExportCols.has('audience')) baseHeaders.push(t('export.columns.audience'));
        if (selectedExportCols.has('campaign_type'))
            baseHeaders.push(t('export.columns.campaignType', { term }));
        if (selectedExportCols.has('utm_campaign'))
            baseHeaders.push(t('export.columns.utmCampaign'));
        // Custom-field columns. Fields the picker listed follow the user's
        // selection; fields discovered only in the fetched data (not in the
        // catalog / current page when the picker was built) are always
        // included so no submitted answer silently drops out of the CSV.
        const knownCfKeys = new Set(
            exportColumnOptions.filter((c) => c.key.startsWith('cf__')).map((c) => c.key)
        );
        const discoveredFieldIds = new Set<string>();
        const metaNameById = new Map<string, string>();
        leads.forEach((lead) => {
            const meta = lead.custom_field_metadata ?? {};
            Object.keys(lead.custom_field_values ?? {}).forEach((id) => {
                if (IDENTITY_CF_KEYS.has(id)) return;
                discoveredFieldIds.add(id);
                const m = meta[id] ?? {};
                const name = m.fieldName ?? m.field_name;
                if (name && !metaNameById.has(id)) metaNameById.set(id, name);
            });
        });
        const setupNameById = new Map(
            (customFieldSetup ?? []).map((f) => [f.custom_field_id, f.field_name])
        );
        const cfFieldIds = Array.from(discoveredFieldIds).filter((id) =>
            knownCfKeys.has(`cf__${id}`) ? selectedExportCols.has(`cf__${id}`) : true
        );
        const cfHeaders = cfFieldIds.map((id) =>
            csvSafe(setupNameById.get(id) || metaNameById.get(id) || id)
        );
        const tail: string[] = [];
        if (showOps) {
            if (selectedExportCols.has('lead_status')) tail.push(t('export.columns.leadStatus'));
            if (selectedExportCols.has('counsellor')) tail.push(t('export.columns.counsellor'));
            if (selectedExportCols.has('activity_notes'))
                tail.push(t('export.columns.activityNotes'));
            if (selectedExportCols.has('notes_count')) tail.push(t('export.columns.notesCount'));
            if (selectedExportCols.has('lead_journey')) tail.push(t('export.columns.leadJourney'));
        }
        const rows = leads.map((lead) => {
            const u = lead.user ?? {};
            const userId = u.id || lead.user_id || '';
            const row: string[] = [];
            if (selectedExportCols.has('lead_id'))
                row.push(csvSafe(lead.response_id || lead.user_id || '-'));
            if (selectedExportCols.has('submitted_at'))
                row.push(
                    csvSafe(
                        lead.submitted_at_local
                            ? convertToLocalDateTime(lead.submitted_at_local)
                            : '-'
                    )
                );
            if (selectedExportCols.has('name'))
                row.push(csvSafe(u.full_name || lead.parent_name || '-'));
            if (selectedExportCols.has('email'))
                row.push(csvSafe(u.email || lead.parent_email || '-'));
            if (selectedExportCols.has('mobile'))
                row.push(csvSafe(u.mobile_number || lead.parent_mobile || '-'));
            if (selectedExportCols.has('audience')) row.push(csvSafe(displayAudience(lead)));
            if (selectedExportCols.has('campaign_type'))
                row.push(csvSafe(lead.campaign_type ?? ''));
            if (selectedExportCols.has('utm_campaign')) row.push(csvSafe(lead.utm_campaign ?? ''));
            cfFieldIds.forEach((fieldId) => row.push(csvSafe(lead.custom_field_values?.[fieldId])));
            if (showOps) {
                const cName = userId
                    ? (prof as Record<string, { assigned_counselor_name?: string | null }>)[userId]
                          ?.assigned_counselor_name ?? ''
                    : '';
                const summary = userId
                    ? (
                          nts as Record<
                              string,
                              {
                                  recent: Array<{
                                      title?: string;
                                      description?: string | null;
                                      created_at?: string;
                                      actor_name?: string | null;
                                  }>;
                                  count: number;
                              }
                          >
                      )[userId]
                    : undefined;
                const recent = summary?.recent ?? [];
                const block = recent
                    .map((n, idx) => {
                        const raw = n.description ?? '';
                        const body = (
                            /<\/?[a-z][^>]*>/i.test(raw) ? parseHtmlToString(raw) : raw
                        ).trim();
                        return [
                            `${idx + 1}. ${n.title?.trim() || t('export.notes.defaultTitle')} - ${body}`,
                            `   ${t('export.notes.updatedBy', { name: n.actor_name || '' })}`,
                            `   ${t('export.notes.date', {
                                date: n.created_at ? convertToLocalDateTime(n.created_at) : '',
                            })}`,
                        ].join('\n');
                    })
                    .join('\n\n');
                if (selectedExportCols.has('lead_status'))
                    row.push(
                        csvSafe(
                            leadStatusCatalog.find((s) => s.status_key === lead.lead_status)
                                ?.label ??
                                lead.lead_status ??
                                ''
                        )
                    );
                if (selectedExportCols.has('counsellor')) row.push(csvSafe(cName));
                if (selectedExportCols.has('activity_notes')) row.push(csvSafe(block));
                if (selectedExportCols.has('notes_count')) row.push(csvSafe(summary?.count ?? 0));
                if (selectedExportCols.has('lead_journey'))
                    row.push(
                        csvSafe(
                            formatJourneyForExport(
                                userId ? (jny as Record<string, JourneyEvent[]>)[userId] : undefined
                            )
                        )
                    );
            }
            return row.join(',');
        });
        const csv = [[...baseHeaders, ...cfHeaders, ...tail].join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${prefix}_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success(t('export.exportedLeads', { count: leads.length }));
    };

    const handleExportAll = async () => {
        if (!instituteId || noTypeAudiences) return;
        setIsExporting(true);
        try {
            const allLeads: RecentLeadDetail[] = [];
            let pageNo = 0;
            let last = false;
            while (!last) {
                const resp = await fetchRecentLeads({
                    institute_id: instituteId,
                    ...audienceParams,
                    submitted_from_local: startOfDayIso(appliedRange.from),
                    submitted_to_local: endOfDayIso(appliedRange.to),
                    search_query: appliedSearch || undefined,
                    lead_tier: tierFilters.length > 0 ? tierFilters.join(',') : undefined,
                    lead_status_id: leadStatusId,
                    lead_status_exclude_id: leadStatusExcludeId,
                    duplicate_filter: duplicateFilter,
                    conversion_status_filter: conversionFilter,
                    audience_status_filter: audienceStatusFilter,
                    sla_filter:
                        slaFilters.length > 0 ? (slaFilters.join(',') as SlaFilter) : undefined,
                    assigned_counselor_id:
                        nonUnassignedCounsellorIds.length > 0
                            ? nonUnassignedCounsellorIds.join(',')
                            : undefined,
                    is_unassigned: onlyUnassigned ? true : undefined,
                    source_type: sourceFilter || undefined,
                    call_history_filter: callHistoryFilter || undefined,
                    call_count_value: callCountParam,
                    called_from_local: calledFromIso,
                    called_to_local: calledToIso,
                    activity_from_local: workedFromIso,
                    activity_to_local: workedToIso,
                    custom_field_filters: customFieldFiltersPayload.length
                        ? customFieldFiltersPayload
                        : undefined,
                    utm_filters: utmFiltersPayload,
                    page: pageNo,
                    size: 200,
                });
                if (resp?.content?.length) allLeads.push(...resp.content);
                last = resp?.last ?? true;
                pageNo += 1;
                if (pageNo > 200) break;
            }
            await exportLeadsCsv(allLeads, 'recent_leads');
        } catch (err) {
            console.error('Recent leads export failed:', err);
            toast.error(t('export.exportFailed'));
        } finally {
            setIsExporting(false);
        }
    };
    // Active filter chips
    // `param` names the search key a chip stands for, so a pinned one can render a lock
    // instead of a remove cross. Chips with no param (custom fields, UTM) are never pinned.
    const chips: { label: string; onRemove: () => void; param?: string }[] = [];
    if (appliedSearch)
        chips.push({
            label: t('chips.search', { query: appliedSearch }),
            param: 'search',
            onRemove: () => {
                setSearchInput('');
                setAppliedSearch('');
            },
        });
    if (campaignTypeFilters.length > 0) {
        const types = campaignTypeFilters.map(
            (value) => campaignTypeOptions.find((o) => o.value === value)?.label ?? value
        );
        chips.push({
            label: t('chips.campaignType', { term, types: types.join(', ') }),
            onRemove: () => handleCampaignTypeChange([]),
            param: 'campaignType',
        });
    }
    if (audienceFilters.length > 0) {
        const names = audienceFilters.map(
            (id) => audienceOptions.find((o) => o.id === id)?.name ?? t('chips.fallbackSelected')
        );
        chips.push({
            label: t('chips.audience', { names: names.join(', ') }),
            onRemove: () => handleAudienceChange([]),
            param: 'audience',
        });
    }
    if (tierFilters.length > 0)
        chips.push({
            label: t('chips.tier', {
                tiers: tierFilters.map((v) => tierLabels[v] ?? v).join(', '),
            }),
            onRemove: () => setTierFilters([]),
            param: 'tier',
        });
    if (leadStatusFilters.length > 0) {
        const statusLabels = leadStatusFilters.map((v) => {
            if (v === ALL_ACTIVE_VALUE) return t('chips.statusActive');
            if (v === ALL_CONVERTED_VALUE) return t('chips.statusConverted');
            return leadStatusCatalog.find((s) => s.status_key === v)?.label ?? v;
        });
        chips.push({
            label: statusExclude
                ? t('chips.statusExcluded', { statuses: statusLabels.join(', ') })
                : t('chips.status', { statuses: statusLabels.join(', ') }),
            onRemove: () => setLeadStatusFilters([]),
            param: 'status',
        });
    }
    if (slaFilters.length > 0)
        chips.push({
            label: t('chips.sla', {
                states: slaFilters
                    .map((v) => slaOptions.find((o) => o.value === v)?.label ?? v)
                    .join(', '),
            }),
            onRemove: () => setSlaFilters([]),
            param: 'sla',
        });
    if (counsellorFilters.length > 0) {
        const cLabels = counsellorFilters.map((id) =>
            id === UNASSIGNED_COUNSELLOR_VALUE
                ? t('chips.unassigned')
                : counsellorOptions.find((c) => c.id === id)?.full_name ??
                  t('chips.fallbackSelected')
        );
        chips.push({
            label: t('chips.counsellor', { names: cLabels.join(', ') }),
            onRemove: () => setCounsellorFilters([]),
            param: 'counsellor',
        });
    }
    if (sourceFilter)
        chips.push({
            label: t('chips.source', { source: sourceFilter }),
            param: 'source',
            onRemove: () => {
                setPage(0);
                setSourceFilter('');
            },
        });
    customFieldFiltersPayload.forEach((f) => {
        const fieldName =
            filterCustomFields.find((cf) => cf.customFieldId === f.field_id)?.fieldName ??
            t('chips.fallbackField');
        chips.push({
            label: t('chips.customField', { field: fieldName, value: filterEntryValueLabel(f) }),
            // Remove only this entry's backing values — one field can carry
            // several chips (values + contains + empty) at once.
            onRemove: () =>
                setCustomFieldFilter(
                    f.field_id,
                    removeEntryFromSelection(customFieldFilters[f.field_id] ?? [], f)
                ),
        });
    });
    UTM_FILTER_DIMENSIONS.forEach((dimension) => {
        (utmFilters[dimension] ?? []).forEach((value) => {
            chips.push({
                label: tUtm('chip', {
                    dimension: tUtm(
                        `dimensions.${dimension === 'source_type' ? 'sourceType' : dimension}`
                    ),
                    value: utmValueLabel(value, tUtm('untagged')),
                }),
                onRemove: () =>
                    setUtmFilter(
                        dimension,
                        (utmFilters[dimension] ?? []).filter((v) => v !== value)
                    ),
            });
        });
    });
    // Worked-window chips reuse the date-range preset labels ("Last 7 days"), so the
    // two windows read the same way even though one is rolling and one is calendar-day.
    const workedWindowLabel = (hours: string): string => {
        const days = Number(hours) / 24;
        if (days === 1) return t('dateRangeOptions.last24Hours');
        if (days === 7) return t('dateRangeOptions.last7Days');
        if (days === 15) return t('dateRangeOptions.last15Days');
        if (days === 30) return t('dateRangeOptions.last30Days');
        return t('chips.dateRangeFallback');
    };
    // A custom window reads out its own dates; without both it is not applied yet,
    // so the chip says so rather than claiming a filter that is doing nothing.
    const windowChipLabel = (window: string, range: { from: string; to: string }): string => {
        if (window !== WORKED_WINDOW_CUSTOM) return workedWindowLabel(window);
        return range.from && range.to
            ? t('chips.dateRangeCustomWithDates', { from: range.from, to: range.to })
            : t('chips.dateRangeCustomFallback');
    };
    const customRangeLabels = {
        setDates: t('filters.customDate.setDates'),
        from: t('filters.customDate.from'),
        to: t('filters.customDate.to'),
        done: t('filters.customDate.done'),
    };
    if (calledWindow) {
        chips.push({
            label: t('chips.calledWithin', {
                window: windowChipLabel(calledWindow, calledRange),
            }),
            param: 'calledWithin',
            onRemove: () => {
                setCalledWindow('');
                setCalledRange({ from: '', to: '' });
                setPage(0);
            },
        });
    }
    if (workedWindow) {
        chips.push({
            label: t('chips.workedWithin', {
                window: windowChipLabel(workedWindow, workedRange),
            }),
            param: 'workedWithin',
            onRemove: () => {
                setWorkedWindow('');
                setWorkedRange({ from: '', to: '' });
                setPage(0);
            },
        });
    }
    if (rangeDays !== DEFAULT_RANGE_DAYS) {
        let label: string;
        if (rangeDays === CUSTOM_DATE_VALUE) {
            label =
                customFrom && customTo
                    ? t('chips.dateRangeCustomWithDates', { from: customFrom, to: customTo })
                    : t('chips.dateRangeCustomFallback');
        } else {
            label =
                dateRangeOptions.find((o) => o.value === rangeDays)?.label ??
                t('chips.dateRangeFallback');
        }
        chips.push({
            label,
            param: 'range',
            onRemove: () => {
                setRangeDays(DEFAULT_RANGE_DAYS);
                setCustomFrom('');
                setCustomTo('');
            },
        });
    }

    // Pinned filters are the sub-tab's identity, not something the user picked: the tab's
    // own label already says what it narrows to, and rendering them chipped the whole row
    // (one I2CAN tab pins nine statuses). They stay applied, they just stop shouting.
    const visibleChips = chips.filter((c) => !(c.param && isLocked(c.param)));
    // Filters behind the Filters button (range and search stay on screen).
    const hiddenFilterCount = visibleChips.filter(
        (c) => c.param !== 'range' && c.param !== 'search'
    ).length;

    // Bulk actions: shown as inline buttons.
    const bulkItems = [
        {
            label: t('bulk.assignLeads'),
            value: 'assign',
            icon: <UserPlus className="size-4" />,
        },
        {
            label: t('bulk.unassignLeads'),
            value: 'unassign',
            icon: <UserMinus className="size-4" />,
        },
        // Not admin-gated, unlike delete/move below:
        // changing status is a counsellor's normal daily
        // action and the single-row chip already allows it.
        {
            label: t('bulk.changeStatus'),
            value: 'status',
            icon: <Tag className="size-4" />,
        },
        // Delete/restore are admin-only, matching the endpoints'
        // own check. In the deleted-leads view the only sensible
        // action is putting them back.
        ...(canDeleteLeads
            ? [
                  showDeleted
                      ? {
                            label: t('bulk.restoreLeads'),
                            value: 'restore',
                            icon: <ArrowCounterClockwise className="size-4 text-primary-600" />,
                        }
                      : {
                            label: t('bulk.deleteLeads'),
                            value: 'delete',
                            icon: <Trash className="size-4 text-danger-600" />,
                        },
              ]
            : []),
        // Moving a deleted lead is refused server-side (restore it
        // first), so the action is hidden in the deleted view
        // rather than offered and then skipped.
        ...(canDeleteLeads && !showDeleted
            ? [
                  {
                      label: t('bulk.moveLeads'),
                      value: 'migrate',
                      icon: <ArrowsLeftRight className="size-4" />,
                  },
              ]
            : []),
    ];
    const onBulkSelect = (value: string) => {
        if (value === 'status') {
            setBulkStatusOpen(true);
            return;
        }
        if (value === 'migrate') {
            setBulkMigrateOpen(true);
            return;
        }
        if (value === 'delete') {
            setBulkDeleteOpen(true);
            return;
        }
        if (value === 'restore') {
            restoreMutation.mutate();
            return;
        }
        setBulkActionMode(value === 'unassign' ? 'REMOVE' : 'ROUND_ROBIN');
        setBulkAssignOpen(true);
    };

    return (
        <div className="flex w-full flex-col gap-4">
            {/* Heading — while a (re)filtered query is in flight there is no count yet;
                a spinner avoids flashing a misleading "0 Leads". */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="flex items-center gap-2 text-2xl font-semibold text-neutral-900">
                    {/* The section name stays put while filters change, so the user
                        always knows which list the count belongs to. */}
                    {sectionLabel && (
                        <>
                            <span>{sectionLabel}</span>
                            <span className="font-normal text-neutral-300">·</span>
                        </>
                    )}
                    {isLoading ? (
                        <>
                            <CircleNotch className="size-5 animate-spin text-neutral-400" />
                            {t('heading.loading')}
                        </>
                    ) : (
                        t('heading.leadsCount', { count: totalElements })
                    )}
                </h1>
                <div className="flex items-center gap-2">
                    {!lockRef.current && !showDeleted && (
                        <Button
                            variant="outline"
                            className="h-10 gap-1.5"
                            aria-expanded={showSummary}
                            onClick={() => setShowSummary((v) => !v)}
                        >
                            <ChartLineUp className="size-4 text-neutral-500" />
                            {showSummary
                                ? t('toolbar.summaryHide', { defaultValue: 'Hide summary' })
                                : t('toolbar.summaryShow', { defaultValue: 'Show summary' })}
                        </Button>
                    )}
                    {canAddLead && !showDeleted && (
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            onClick={() => setAddLeadOpen(true)}
                        >
                            <Plus className="size-4" weight="bold" />
                            {t('toolbar.addLead')}
                        </MyButton>
                    )}
                </div>
            </div>

            {/* Summary header. Not on a
                pinned sidebar sub-tab or the deleted view: those carry their own filter. */}
            {!lockRef.current && !showDeleted && showSummary && <RecentLeadsEnhancedHeader />}

            {/* Toolbar — left filters, right actions (search lives in its own row below) */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant={showFilters ? 'default' : 'outline'}
                        className="h-10 gap-1.5"
                        aria-expanded={showFilters}
                        onClick={() => setShowFilters((v) => !v)}
                    >
                        <Funnel className="size-4" />
                        {t('toolbar.filters', { defaultValue: 'Filters' })}
                        {hiddenFilterCount > 0 && (
                            <span className="rounded-full bg-primary-100 px-1.5 text-xs font-semibold text-primary-700">
                                {hiddenFilterCount}
                            </span>
                        )}
                    </Button>
                    <RangeSegment
                        value={rangeDays}
                        options={dateRangeOptions.map((o) => o.value)}
                        onChange={setDateRange}
                        disabled={isLocked('range')}
                    />
                    {rangeDays === CUSTOM_DATE_VALUE && (
                        <div className="flex items-center gap-1.5">
                            <DatePickerButton
                                label={t('filters.customDate.from')}
                                value={customFrom}
                                onChange={setCustomFrom}
                                max={customTo || format(new Date(), 'yyyy-MM-dd')}
                                placeholder={t('filters.customDate.setDates')}
                                open={customOpen === 'from'}
                                onOpenChange={(open) => setCustomOpen(open ? 'from' : null)}
                                className="h-10"
                            />
                            <DatePickerButton
                                label={t('filters.customDate.to')}
                                value={customTo}
                                onChange={setCustomTo}
                                min={customFrom || undefined}
                                max={format(new Date(), 'yyyy-MM-dd')}
                                placeholder={t('filters.customDate.setDates')}
                                open={customOpen === 'to'}
                                onOpenChange={(open) => setCustomOpen(open ? 'to' : null)}
                                className="h-10"
                            />
                        </div>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <SettingsQuickAccessButton
                        settingsKey={SettingsTabs.LeadSettings}
                        label={t('toolbar.leadSettings')}
                    />
                    {/* Deleted leads are hidden from every view by default; this is the only
                        place they surface, and the only route back for one (Restore). Admin-only,
                        matching the delete/restore endpoints' own check. */}
                    {canDeleteLeads && (
                        <Button
                            variant={showDeleted ? 'default' : 'outline'}
                            size="sm"
                            className={cn(
                                'h-10',
                                showDeleted && 'bg-danger-600 hover:bg-danger-700'
                            )}
                            onClick={() => {
                                setShowDeleted((v) => !v);
                                setPage(0);
                                setSelectedLeads(new Map());
                            }}
                            title={
                                showDeleted
                                    ? t('toolbar.backToActiveTitle')
                                    : t('toolbar.showDeletedTitle')
                            }
                        >
                            <Trash className="mr-1.5 size-4" />
                            {showDeleted
                                ? t('toolbar.viewingDeletedButton')
                                : t('toolbar.deletedLeadsButton')}
                        </Button>
                    )}
                    <ManageColumnsPopover
                        columns={toggleableColumns}
                        hiddenColumns={hiddenColumns}
                        onToggle={toggleColumn}
                        onReset={handleResetColumns}
                        onReorder={setColumnOrder}
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-10"
                        onClick={() => {
                            setSelectedExportCols(new Set(exportColumnOptions.map((c) => c.key)));
                            setExportPickerOpen(true);
                        }}
                        disabled={isExporting || !data?.totalElements}
                    >
                        <DownloadSimple className="mr-1.5 size-4" />
                        {isExporting ? t('toolbar.exporting') : t('toolbar.export')}
                    </Button>
                </div>
            </div>

            {/* Filters panel — grouped by what each filter answers, under its own button. */}
            {showFilters && (
                <LeadFiltersPanel
                    title={t('filtersPanel.title', { defaultValue: 'Filters' })}
                    activeCount={hiddenFilterCount}
                    activeLabel={t('filtersPanel.active', {
                        count: hiddenFilterCount,
                        defaultValue: '{{count}} active',
                    })}
                    closeLabel={t('filtersPanel.close', { defaultValue: 'Close filters' })}
                    onClose={() => setShowFilters(false)}
                    actions={
                        <>
                            <ManageListFiltersLink surface="LEADS" />
                            {hiddenFilterCount > 0 && (
                                <button
                                    type="button"
                                    onClick={handleClearFilter}
                                    className="px-1 text-xs font-medium text-primary-600 hover:underline"
                                >
                                    {t('chips.clearAll')}
                                </button>
                            )}
                        </>
                    }
                >
                    <LeadFilterSection
                        title={t('filtersPanel.sections.pipeline', { defaultValue: 'Pipeline' })}
                        icon={Kanban}
                        activeCount={
                            tierFilters.length + leadStatusFilters.length + slaFilters.length
                        }
                    >
                        {showOps && (
                            <MultiSelectFilter
                                label={terminology.tier}
                                icon={<Flame className="size-4 shrink-0 text-neutral-400" />}
                                options={tierCatalog.tiers.map((tier) => ({
                                    value: tier.tier_key,
                                    label: tier.label,
                                }))}
                                selected={tierFilters}
                                onChange={setTier}
                                locked={isLocked('tier')}
                                widthClass="w-36"
                            />
                        )}
                        <MultiSelectFilter
                            label={terminology.leadStatus}
                            icon={<CheckCircle className="size-4 shrink-0 text-neutral-400" />}
                            options={[
                                {
                                    value: ALL_ACTIVE_VALUE,
                                    label: t('filters.leadStatus.active'),
                                },
                                // Built-in, not a catalog row — it filters on conversion_status,
                                // so it has its own switch in Lead Settings.
                                ...(leadSettings.showConvertedFilterOption
                                    ? [
                                          {
                                              value: ALL_CONVERTED_VALUE,
                                              label: t('filters.leadStatus.converted'),
                                          },
                                      ]
                                    : []),
                                ...leadStatusFilterOptions.map((s) => ({
                                    value: s.status_key,
                                    label: s.label,
                                })),
                            ]}
                            selected={leadStatusFilters}
                            onChange={handleLeadStatusChange}
                            locked={isLocked('status')}
                            widthClass="w-44"
                            exclude={{
                                value: statusExclude,
                                onChange: (next) => {
                                    setStatusExclude(next);
                                    setPage(0);
                                },
                                label: t('filters.leadStatus.excludeSelected'),
                            }}
                        />
                        {showOps && (
                            <MultiSelectFilter
                                label={t('filters.sla.label')}
                                icon={<Clock className="size-4 shrink-0 text-neutral-400" />}
                                options={slaOptions
                                    .filter((o) => o.value !== ALL_SLA_VALUE)
                                    .map((o) => ({ value: o.value, label: o.label }))}
                                selected={slaFilters}
                                onChange={setSla}
                                locked={isLocked('sla')}
                                widthClass="w-44"
                            />
                        )}
                    </LeadFilterSection>
                    <LeadFilterSection
                        title={t('filtersPanel.sections.owner', {
                            defaultValue: 'Owner & source',
                        })}
                        icon={UserCircle}
                        activeCount={
                            counsellorFilters.length +
                            campaignTypeFilters.length +
                            audienceFilters.length
                        }
                    >
                        {showOps && (
                            <CounsellorFilter
                                values={counsellorFilters}
                                onChange={setCounsellor}
                                unassignedValue={UNASSIGNED_COUNSELLOR_VALUE}
                                options={counsellorOptions}
                                isLoading={counsellorOptionsLoading}
                            />
                        )}
                        <MultiSelectFilter
                            label={t('filters.campaignType.label', { term })}
                            icon={<Folders className="size-4 shrink-0 text-neutral-400" />}
                            options={campaignTypeOptions}
                            selected={campaignTypeFilters}
                            onChange={handleCampaignTypeChange}
                            locked={isLocked('campaignType')}
                            widthClass="w-48"
                        />
                        <MultiSelectFilter
                            label={t('filters.audience.label', {
                                term: terminology.leadSource,
                            })}
                            icon={<Megaphone className="size-4 shrink-0 text-neutral-400" />}
                            options={typeAudienceOptions.map((opt) => ({
                                value: opt.id,
                                label: opt.name,
                            }))}
                            selected={audienceFilters}
                            onChange={handleAudienceChange}
                            locked={isLocked('audience')}
                            widthClass="w-44"
                        />
                    </LeadFilterSection>
                    <LeadFilterSection
                        title={t('filtersPanel.sections.activity', { defaultValue: 'Activity' })}
                        icon={PhoneCall}
                        activeCount={
                            [callHistoryFilter, calledWindow, workedWindow].filter(Boolean).length
                        }
                    >
                        <CallHistoryFilter
                            value={callHistoryFilter}
                            onValueChange={(v) => {
                                setCallHistoryFilter(v);
                                setPage(0);
                            }}
                            count={callCountValue}
                            onCountChange={(n) => {
                                setCallCountValue(n);
                                setPage(0);
                            }}
                        />
                        <WorkedWindowFilter
                            kind="CALLED"
                            value={calledWindow}
                            onValueChange={(v) => {
                                setCalledWindow(v);
                                setPage(0);
                            }}
                            labels={{
                                anyLabel: t('filters.calledWithin.any'),
                                placeholder: t('filters.calledWithin.placeholder'),
                                optionLabel: (hours) => workedWindowLabel(String(hours)),
                                customLabel: t('dateRangeOptions.customRange'),
                            }}
                            custom={{
                                from: calledRange.from,
                                to: calledRange.to,
                                onChange: (from, to) => {
                                    setCalledRange({ from, to });
                                    setPage(0);
                                },
                                labels: customRangeLabels,
                            }}
                        />
                        <WorkedWindowFilter
                            kind="ACTIVITY"
                            value={workedWindow}
                            onValueChange={(v) => {
                                setWorkedWindow(v);
                                setPage(0);
                            }}
                            labels={{
                                anyLabel: t('filters.workedWithin.any'),
                                placeholder: t('filters.workedWithin.placeholder'),
                                optionLabel: (hours) => workedWindowLabel(String(hours)),
                                customLabel: t('dateRangeOptions.customRange'),
                            }}
                            custom={{
                                from: workedRange.from,
                                to: workedRange.to,
                                onChange: (from, to) => {
                                    setWorkedRange({ from, to });
                                    setPage(0);
                                },
                                labels: customRangeLabels,
                            }}
                        />
                    </LeadFilterSection>
                    {utmControls.enabled && utmControls.dimensions.length > 0 && (
                        <LeadFilterSection
                            title={t('filtersPanel.sections.campaign', {
                                defaultValue: 'Campaign links',
                            })}
                            icon={LinkSimple}
                            activeCount={
                                Object.values(utmFilters).filter((v) => (v?.length ?? 0) > 0).length
                            }
                        >
                            <UtmFilterControls
                                surface="LEADS"
                                instituteId={instituteId ?? ''}
                                selection={utmFilters}
                                onChange={setUtmFilter}
                            />
                        </LeadFilterSection>
                    )}
                    {filterCustomFields.length > 0 && (
                        <LeadFilterSection
                            title={t('filtersPanel.sections.custom', {
                                defaultValue: 'Custom fields',
                            })}
                            icon={SlidersHorizontal}
                            activeCount={
                                Object.values(customFieldFilters).filter(
                                    (v) => (v?.length ?? 0) > 0
                                ).length
                            }
                        >
                            {filterCustomFields.map((f) =>
                                isRangeFieldType(f.fieldType) ? (
                                    <CustomFieldRangeFilter
                                        key={f.customFieldId}
                                        fieldId={f.customFieldId}
                                        fieldName={f.fieldName}
                                        fieldType={f.fieldType}
                                        selected={customFieldFilters[f.customFieldId] ?? []}
                                        onChange={(vals) =>
                                            setCustomFieldFilter(f.customFieldId, vals)
                                        }
                                    />
                                ) : (
                                    <CustomFieldMultiSelectFilter
                                        key={f.customFieldId}
                                        instituteId={instituteId ?? ''}
                                        fieldId={f.customFieldId}
                                        fieldName={f.fieldName}
                                        selected={customFieldFilters[f.customFieldId] ?? []}
                                        onChange={(vals) =>
                                            setCustomFieldFilter(f.customFieldId, vals)
                                        }
                                    />
                                )
                            )}
                        </LeadFilterSection>
                    )}
                </LeadFiltersPanel>
            )}

            {/* Active filter chips */}
            {visibleChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {visibleChips.map((chip, i) => (
                        <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-600"
                        >
                            {chip.label}
                            <button
                                type="button"
                                onClick={chip.onRemove}
                                className="text-neutral-400 hover:text-neutral-700"
                                aria-label={t('chips.removeAriaLabel', { label: chip.label })}
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                    <button
                        type="button"
                        onClick={handleClearFilter}
                        className="px-1 text-xs font-medium text-primary-600 hover:underline"
                    >
                        {t('chips.clearAll')}
                    </button>
                </div>
            )}

            {/* Search + result count — its own row, mirroring the reference layout */}
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
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <span>{t('search.showing')}</span>
                    <Select
                        value={String(pageSize)}
                        onValueChange={(v) => {
                            setPageSize(Number(v));
                            setPage(0);
                        }}
                    >
                        <SelectTrigger className="h-8 w-20">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PAGE_SIZE_OPTIONS.map((n) => (
                                <SelectItem key={n} value={String(n)}>
                                    {n}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <span>
                        {isLoading
                            ? t('search.resultsPending')
                            : t('search.resultsCount', { count: totalElements })}
                    </span>
                </div>
            </div>

            {/* Table */}
            <SidebarProvider
                style={{ ['--sidebar-width' as string]: '565px' }}
                defaultOpen={false}
                open={isSidebarOpen}
                onOpenChange={setIsSidebarOpen}
            >
                <div className="min-w-0 flex-1">
                    {/* Bulk-action toolbar — any view with a selection (assign / remove counsellor). */}
                    {selectedLeads.size > 0 && (
                        <div className="mb-2 flex items-center justify-between rounded-lg border border-primary-200 bg-primary-50 px-3 py-2">
                            <span className="text-body font-medium text-primary-700">
                                {t('bulk.selectedCount', { count: selectedLeads.size })}
                            </span>
                            <div className="flex gap-2">
                                {selectedLeads.size < totalElements && (
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        disable={selectAllLoading}
                                        onClick={selectAllAcrossPages}
                                    >
                                        {selectAllLoading
                                            ? t('bulk.selecting')
                                            : t('bulk.selectAll', { count: totalElements })}
                                    </MyButton>
                                )}
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => setSelectedLeads(new Map())}
                                >
                                    {t('bulk.clear')}
                                </MyButton>
                                {bulkItems.map((item) => (
                                    <MyButton
                                        key={item.value}
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => onBulkSelect(item.value)}
                                    >
                                        {item.icon}
                                        {item.label}
                                    </MyButton>
                                ))}
                            </div>
                        </div>
                    )}
                    {error || typeAudiencesError ? (
                        <LeadEmptyState
                            title={t('emptyState.errorTitle')}
                            description={t('emptyState.errorDescription')}
                        />
                    ) : (
                        <LeadTable
                            vms={vms}
                            profiles={leadProfiles}
                            notes={notesByUserId}
                            statuses={leadStatusCatalog}
                            showOps={showOps}
                            showScore={showScore}
                            isLoading={isLoading}
                            actions={actions}
                            onStatusUpdated={handleStatusUpdated}
                            hiddenColumns={hiddenColumns}
                            columnOrder={columnOrder}
                            selectable
                            selectedIds={new Set(selectedLeads.keys())}
                            onToggleRow={toggleLeadRow}
                            onToggleAll={toggleAllLeads}
                            sortBy={sortBy}
                            sortDirection={sortDirection}
                            onSortChange={handleSortChange}
                            emptyState={
                                <LeadEmptyState
                                    onClear={isFilterActive ? handleClearFilter : undefined}
                                />
                            }
                        />
                    )}
                </div>
                <StudentSidebar
                    selectedTab="overview"
                    examType="EXAM"
                    isStudentList={false}
                    defaultLeadProfile
                />

                <BulkAssignCounsellorDialog
                    open={bulkAssignOpen}
                    onOpenChange={setBulkAssignOpen}
                    instituteId={instituteId ?? ''}
                    leads={Array.from(selectedLeads.values())}
                    counsellorOptions={assignableCounsellorOptions}
                    initialMode={bulkActionMode}
                    onSuccess={handleBulkAssignSuccess}
                />

                <BulkLeadStatusDialog
                    open={bulkStatusOpen}
                    onOpenChange={setBulkStatusOpen}
                    instituteId={instituteId ?? ''}
                    responseIds={Array.from(selectedLeads.keys())}
                    statuses={leadStatusCatalog}
                    onSuccess={(result) => {
                        // Keep the selection when nothing moved — the admin probably
                        // wants to pick a different status rather than reselect.
                        if (result.updated > 0) setSelectedLeads(new Map());
                        handleStatusUpdated();
                    }}
                />

                <DeleteLeadsDialog
                    open={bulkDeleteOpen}
                    onOpenChange={setBulkDeleteOpen}
                    instituteId={instituteId ?? ''}
                    responseIds={Array.from(selectedLeads.keys())}
                    onSuccess={() => {
                        setSelectedLeads(new Map());
                        handleStatusUpdated();
                    }}
                />

                <MigrateLeadsDialog
                    open={bulkMigrateOpen}
                    onOpenChange={setBulkMigrateOpen}
                    instituteId={instituteId ?? ''}
                    responseIds={Array.from(selectedLeads.keys())}
                    // Recent Leads spans every list, so the selection can come from several —
                    // there is no single "current" list to exclude from the picker.
                    onSuccess={() => {
                        setSelectedLeads(new Map());
                        handleStatusUpdated();
                    }}
                />

                {noteTarget && (
                    <AddLeadNoteDialog
                        open={!!noteTarget}
                        onOpenChange={(o) => !o && setNoteTarget(null)}
                        userId={noteTarget.userId}
                        userName={noteTarget.userName}
                        audienceResponseId={noteTarget.responseId}
                    />
                )}
                {counsellorTarget && (
                    <AssignCounselorToLeadDialog
                        open={!!counsellorTarget}
                        onOpenChange={(o) => !o && setCounsellorTarget(null)}
                        userId={counsellorTarget.userId}
                        userName={counsellorTarget.userName}
                        invalidateKeys={[['lead-profiles-batch']]}
                    />
                )}
                <AiCallDialog
                    target={aiCallTarget}
                    onClose={() => setAiCallTarget(null)}
                    isPending={placeAiCall.isPending}
                    onConfirm={(target, agentId, numberId) => {
                        placeAiCall.mutate(
                            {
                                responseId: target.responseId,
                                userId: target.userId,
                                leadName: target.leadName,
                                campaignId: agentId || undefined,
                                preferredNumberId: numberId || undefined,
                            },
                            { onSuccess: () => setAiCallTarget(null) }
                        );
                    }}
                />
            </SidebarProvider>

            {/* Pagination */}
            <LeadPagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

            <ExportColumnPickerDialog
                open={exportPickerOpen}
                onOpenChange={setExportPickerOpen}
                columns={exportColumnOptions}
                selected={selectedExportCols}
                onSelectedChange={setSelectedExportCols}
                onExport={() => {
                    setExportPickerOpen(false);
                    handleExportAll();
                }}
                isExporting={isExporting}
            />

            {canAddLead && (
                <AddLeadDialog
                    open={addLeadOpen}
                    onOpenChange={setAddLeadOpen}
                    audiences={audienceOptions}
                    isLoading={audiencesQuery.isLoading}
                    campaignTypeTerm={terminology.campaignType}
                    audienceTerm={terminology.leadSource}
                />
            )}
        </div>
    );
};
