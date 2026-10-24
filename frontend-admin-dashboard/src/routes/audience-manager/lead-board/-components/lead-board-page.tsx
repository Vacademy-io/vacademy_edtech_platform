import { useEffect, useMemo, useRef, useState } from 'react';
import { LeadBoardEnhancedStrip } from './LeadBoardEnhancedStrip';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    CalendarBlank,
    CircleNotch,
    Clock,
    Flame,
    MagnifyingGlass,
    Megaphone,
    Phone,
    X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { fetchRecentLeads, type RecentLeadDetail } from '../../list/-services/get-recent-leads';
import { handleFetchCampaignsList } from '../../list/-services/get-campaigns-list';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { StudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/student-sidebar-provider';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { NO_STATUS_KEY, useLeadStatuses, type LeadStatus } from '@/hooks/use-lead-statuses';
import { useLeadTiers } from '@/hooks/use-lead-tiers';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { useLeadCounsellorOptions } from '@/hooks/use-lead-counsellor-options';
import { CounsellorFilter } from '@/components/shared/leads/counsellor-filter';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import { CustomFieldMultiSelectFilter } from '@/components/shared/leads/custom-field-multi-select-filter';
import { ManageListFiltersLink } from '@/components/shared/leads/manage-list-filters-link';
import { UtmFilterControls } from '@/components/shared/leads/utm-filter-controls';
import { toUtmFiltersPayload, utmValueLabel } from '@/components/shared/leads/utm-filter-encoding';
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
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import {
    LeadEmptyState,
    LeadStatusBoard,
    ManageColumnsPopover,
    useLeadColumnPrefs,
    useUpdateLeadTier,
    usePlaceCall,
    usePlaceAiCall,
    useAiCallButtonEnabled,
    AiCallDialog,
    type AiCallDialogTarget,
    recentLeadToVM,
    type LeadActionHandlers,
} from '@/components/shared/leads';

import {
    UNASSIGNED_COUNSELLOR_VALUE,
    ALL_DATE_VALUE,
    CUSTOM_DATE_VALUE,
    DEFAULT_RANGE_DAYS,
} from '../../recent-leads/-components/recent-leads-search';

/**
 * Lead Board — the Kanban twin of Recent Leads. Same URL-driven filters (they
 * share the recent-leads search schema, so drill-through links work on both
 * pages), but leads render as drag-and-drop cards in one column per
 * lead-status. Statuses come from the institute's catalog; the "Manage Column"
 * picker persists which columns are visible per user.
 */

type SlaFilter =
    | 'TAT_BEFORE'
    | 'TAT_OVERDUE'
    | 'FOLLOW_UP_DUE'
    | 'FOLLOW_UP_OVERDUE'
    | 'ANY_OVERDUE';
// Factory-with-parameter: these are module-scope (referenced from useMemo
// below before any component has necessarily rendered), so the labels are
// resolved lazily from the translator rather than baked in at import time.
const buildSlaOptions = (t: TFunction): { value: string; label: string }[] => [
    { value: 'ANY_OVERDUE', label: t('slaOptions.anyOverdue') },
    { value: 'TAT_OVERDUE', label: t('slaOptions.firstContactMissed') },
    { value: 'TAT_BEFORE', label: t('slaOptions.firstContactComingUp') },
    { value: 'FOLLOW_UP_DUE', label: t('slaOptions.followUpComingUp') },
    { value: 'FOLLOW_UP_OVERDUE', label: t('slaOptions.followUpMissed') },
];
const SEARCH_DEBOUNCE_MS = 500;

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

export const LeadBoardPage = () => {
    const { t } = useTranslation('audienceManagerLeadBoardPage');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('heading.title')}</h1>);
    }, [setNavHeading, t]);
    return (
        <StudentSidebarProvider>
            <LeadBoardContent />
        </StudentSidebarProvider>
    );
};

const LeadBoardContent = () => {
    const { t } = useTranslation('audienceManagerLeadBoardPage');
    // Built every render (cheap): a memo could keep raw keys from before the catalog loaded.
    const slaOptions = buildSlaOptions(t);
    const dateRangeOptions = buildDateRangeOptions(t);
    // Institute tier catalog (custom tiers + labels) and its own name for "Tier".
    const tierCatalog = useLeadTiers();
    const terminology = useLeadTerminology();
    const tierLabels: Record<string, string> = useMemo(
        () => Object.fromEntries(tierCatalog.tiers.map((tier) => [tier.tier_key, tier.label])),
        [tierCatalog.tiers]
    );
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id;
    const { setSelectedStudent } = useStudentSidebar();
    const queryClient = useQueryClient();

    // Filters are URL-driven with the SAME params as Recent Leads (shared
    // schema), so links can be swapped between the two views.
    const urlSearch = useSearch({ from: '/audience-manager/lead-board/' });
    const navigate = useNavigate({ from: '/audience-manager/lead-board/' });

    const [rangeDays, setRangeDays] = useState<string>(
        () =>
            urlSearch.range ??
            (urlSearch.from || urlSearch.to ? CUSTOM_DATE_VALUE : DEFAULT_RANGE_DAYS)
    );
    const [customFrom, setCustomFrom] = useState(urlSearch.from ?? '');
    const [customTo, setCustomTo] = useState(urlSearch.to ?? '');
    const [customOpen, setCustomOpen] = useState(false);
    const appliedRange = useMemo(
        () =>
            rangeDays === CUSTOM_DATE_VALUE
                ? { from: customFrom, to: customTo }
                : rangeForPreset(rangeDays),
        [rangeDays, customFrom, customTo]
    );
    const [audienceFilters, setAudienceFilters] = useState<string[]>(() =>
        urlSearch.audience ? urlSearch.audience.split(',').filter(Boolean) : []
    );

    const [searchInput, setSearchInput] = useState(urlSearch.search ?? '');
    const [appliedSearch, setAppliedSearch] = useState(urlSearch.search ?? '');
    useEffect(() => {
        const trimmed = searchInput.trim();
        if (trimmed === appliedSearch) return;
        const timer = window.setTimeout(() => setAppliedSearch(trimmed), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput, appliedSearch]);

    const [tierFilters, setTierFilters] = useState<string[]>(() =>
        urlSearch.tier ? urlSearch.tier.split(',') : []
    );
    const [slaFilters, setSlaFilters] = useState<string[]>(() =>
        urlSearch.sla ? urlSearch.sla.split(',') : []
    );
    const [counsellorFilters, setCounsellorFilters] = useState<string[]>(() =>
        urlSearch.counsellor ? urlSearch.counsellor.split(',') : []
    );
    // URL-only (drill-through links from Reports); no dropdown here either.
    const [sourceFilter, setSourceFilter] = useState<string>(urlSearch.source ?? '');
    const [callHistoryFilter, setCallHistoryFilter] = useState<string>(urlSearch.called ?? '');

    const { fields: filterCustomFields } = useLeadFilterCustomFields(instituteId);
    const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string[]>>({});
    const setCustomFieldFilter = (fieldId: string, values: string[]) => {
        setCustomFieldFilters((prev) => {
            const next = { ...prev };
            if (values.length === 0) delete next[fieldId];
            else next[fieldId] = values;
            return next;
        });
    };
    const customFieldFiltersPayload = useMemo(
        () =>
            Object.entries(customFieldFilters)
                .filter(([, vals]) => vals.length > 0)
                .flatMap(([fieldId, values]) => decodeSelectionToEntries(fieldId, values)),
        [customFieldFilters]
    );

    // Campaign (UTM) filters — one value list per dimension. The controls
    // render nothing while the institute's UTM setting is off.
    const [utmFilters, setUtmFilters] = useState<UtmFilterSelection>({});
    const { t: tUtm } = useTranslation('utmListFilters');
    const setUtmFilter = (dimension: UtmFilterDimension, values: string[]) => {
        setUtmFilters((prev) => {
            const next = { ...prev };
            if (values.length === 0) delete next[dimension];
            else next[dimension] = values;
            return next;
        });
    };
    const utmFiltersPayload = useMemo(() => toUtmFiltersPayload(utmFilters), [utmFilters]);

    // Write applied filters back to the URL (replace — filter tweaks shouldn't
    // pollute browser history). The board has no status param: columns ARE the
    // statuses, and the column picker below owns visibility.
    useEffect(() => {
        void navigate({
            search: {
                tier: tierFilters.length > 0 ? tierFilters.join(',') : undefined,
                sla: slaFilters.length > 0 ? slaFilters.join(',') : undefined,
                counsellor: counsellorFilters.length > 0 ? counsellorFilters.join(',') : undefined,
                audience: audienceFilters.length > 0 ? audienceFilters.join(',') : undefined,
                search: appliedSearch || undefined,
                range: rangeDays === DEFAULT_RANGE_DAYS ? undefined : rangeDays,
                from: rangeDays === CUSTOM_DATE_VALUE && customFrom ? customFrom : undefined,
                to: rangeDays === CUSTOM_DATE_VALUE && customTo ? customTo : undefined,
                source: sourceFilter || undefined,
                called: callHistoryFilter || undefined,
            },
            replace: true,
        });
    }, [
        navigate,
        tierFilters,
        slaFilters,
        counsellorFilters,
        audienceFilters,
        appliedSearch,
        rangeDays,
        customFrom,
        customTo,
        sourceFilter,
        callHistoryFilter,
    ]);

    const { options: counsellorOptions, isLoading: counsellorOptionsLoading } =
        useLeadCounsellorOptions();

    const leadSettings = useLeadSettings();
    const showOps = !leadSettings.isLoading && leadSettings.enabled;
    const showScore = showOps && leadSettings.showScoreInEnquiryTable;

    // Status catalog → board columns. The picker persists hidden status keys per
    // user, same mechanism as the table's "Manage Column".
    // Full catalog on purpose: `show_in_filter` governs the FILTER dropdowns only.
    // The board already has its own per-user column hiding below, and dropping a
    // column here would strand every lead carrying that status with no way back.
    const { statuses: leadStatusCatalog, isLoading: statusesLoading } = useLeadStatuses();
    const { hiddenColumns, toggleColumn, resetColumns } = useLeadColumnPrefs(
        'crm-lead-board:hidden-statuses'
    );
    const orderedStatuses = useMemo(() => {
        const catalog = [...leadStatusCatalog]
            .filter((s) => s.is_active)
            .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
        if (catalog.length === 0) return catalog;
        // Synthetic first column: leads that were never staged (no lead_status_id
        // and no legacy conversion_status) — the backend matches these via the
        // __NO_STATUS__ sentinel. Drag OUT of it stages a lead; drops INTO it are
        // disabled (there is no status to assign). Empty color → neutral dot.
        const noStatusColumn: LeadStatus = {
            id: NO_STATUS_KEY,
            status_key: NO_STATUS_KEY,
            label: t('board.noStatusColumnLabel'),
            color: '',
            display_order: 0,
            is_default: false,
            is_active: true,
            is_system: true,
        };
        return [noStatusColumn, ...catalog];
    }, [leadStatusCatalog, t]);
    const visibleStatuses = useMemo(
        () => orderedStatuses.filter((s) => !hiddenColumns.has(s.status_key)),
        [orderedStatuses, hiddenColumns]
    );
    const columnToggles = useMemo(
        () => orderedStatuses.map((s) => ({ id: s.status_key, label: s.label })),
        [orderedStatuses]
    );

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

    const audiencesQuery = useQuery(
        handleFetchCampaignsList({ institute_id: instituteId ?? '', page: 0, size: 200 })
    );
    const audienceOptions = useMemo(
        () =>
            (audiencesQuery.data?.content ?? [])
                .map((c) => ({
                    id: c.id || c.campaign_id || c.audience_id || '',
                    name: c.campaign_name || t('filters.audience.untitled'),
                }))
                .filter((opt) => opt.id !== ''),
        [audiencesQuery.data, t]
    );

    // Joined once so the basePayload memo can depend on a stable primitive.
    const counsellorIdsParam = counsellorFilters
        .filter((v) => v !== UNASSIGNED_COUNSELLOR_VALUE)
        .join(',');
    const onlyUnassigned =
        counsellorFilters.includes(UNASSIGNED_COUNSELLOR_VALUE) && counsellorIdsParam === '';

    // Shared per-column request body. Status + sort + paging are added by each
    // column. conversion_status_filter must be ALL so the Converted column can
    // actually show its leads (the backend excludes converted by default).
    const basePayload = useMemo<Record<string, unknown>>(
        () => ({
            institute_id: instituteId ?? '',
            audience_id: audienceFilters.length === 1 ? audienceFilters[0] : undefined,
            submitted_from_local: startOfDayIso(appliedRange.from),
            submitted_to_local: endOfDayIso(appliedRange.to),
            search_query: appliedSearch || undefined,
            lead_tier: tierFilters.length > 0 ? tierFilters.join(',') : undefined,
            conversion_status_filter: 'ALL',
            sla_filter: slaFilters.length > 0 ? (slaFilters.join(',') as SlaFilter) : undefined,
            assigned_counselor_id: counsellorIdsParam || undefined,
            is_unassigned: onlyUnassigned ? true : undefined,
            source_type: sourceFilter || undefined,
            call_history_filter: callHistoryFilter || undefined,
            custom_field_filters: customFieldFiltersPayload.length
                ? customFieldFiltersPayload
                : undefined,
            utm_filters: utmFiltersPayload,
        }),
        [
            instituteId,
            audienceFilters,
            appliedRange.from,
            appliedRange.to,
            appliedSearch,
            tierFilters,
            slaFilters,
            counsellorIdsParam,
            onlyUnassigned,
            sourceFilter,
            callHistoryFilter,
            customFieldFiltersPayload,
            utmFiltersPayload,
        ]
    );

    // The summary strip above the board pushes it down; take its height off the board so
    // the columns still end at the bottom of the screen (no second page scroll).
    const stripRef = useRef<HTMLDivElement>(null);
    const [stripHeight, setStripHeight] = useState(0);
    useEffect(() => {
        const el = stripRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => setStripHeight(el.offsetHeight));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const invalidateKeys = [['lead-board'], ['recent-leads'], ['lead-profiles-batch']];
    const updateTier = useUpdateLeadTier({ invalidateKeys });
    const placeCall = usePlaceCall({ invalidateKeys });
    const placeAiCall = usePlaceAiCall({ invalidateKeys });
    const showAiButton = useAiCallButtonEnabled();
    const [aiCallTarget, setAiCallTarget] = useState<AiCallDialogTarget | null>(null);

    const actions: LeadActionHandlers = useMemo(
        () => ({
            onOpenDetails: (vm) => {
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

    // A board drop mirrors the inline status chip: refresh the table + profile
    // caches so the other leads surfaces agree with the new column.
    const handleStatusChanged = () => {
        queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
        queryClient.invalidateQueries({ queryKey: ['user-lead-profile'] });
        queryClient.invalidateQueries({ queryKey: ['lead-profiles-batch'] });
    };

    const handleClearFilter = () => {
        setAudienceFilters([]);
        setSearchInput('');
        setAppliedSearch('');
        setTierFilters([]);
        setSlaFilters([]);
        setCounsellorFilters([]);
        setSourceFilter('');
        setCallHistoryFilter('');
        setCustomFieldFilters({});
        setUtmFilters({});
        setRangeDays(DEFAULT_RANGE_DAYS);
        setCustomFrom('');
        setCustomTo('');
    };
    const setDateRange = (value: string) => {
        setRangeDays(value);
        if (value === CUSTOM_DATE_VALUE) {
            if (!customFrom && !customTo) {
                const seed = rangeForPreset(DEFAULT_RANGE_DAYS);
                setCustomFrom(seed.from);
                setCustomTo(seed.to);
            }
            setCustomOpen(true);
        }
    };

    // Active filter chips (same content as Recent Leads, minus status).
    const chips: { label: string; onRemove: () => void }[] = [];
    if (appliedSearch)
        chips.push({
            label: t('chips.search', { query: appliedSearch }),
            onRemove: () => {
                setSearchInput('');
                setAppliedSearch('');
            },
        });
    if (audienceFilters.length > 0) {
        const names = audienceFilters.map(
            (id) => audienceOptions.find((o) => o.id === id)?.name ?? t('chips.fallbackSelected')
        );
        chips.push({
            label: t('chips.audience', { names: names.join(', ') }),
            onRemove: () => setAudienceFilters([]),
        });
    }
    if (tierFilters.length > 0)
        chips.push({
            // tierFilters holds raw enum values (HOT/WARM/COLD) — map through
            // tierLabels so the chip shows the translated label, not the enum.
            label: t('chips.tier', {
                tiers: tierFilters.map((v) => tierLabels[v] ?? v).join(', '),
            }),
            onRemove: () => setTierFilters([]),
        });
    if (slaFilters.length > 0)
        chips.push({
            label: t('chips.sla', {
                states: slaFilters
                    .map((v) => slaOptions.find((o) => o.value === v)?.label ?? v)
                    .join(', '),
            }),
            onRemove: () => setSlaFilters([]),
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
        });
    }
    if (sourceFilter)
        chips.push({
            label: t('chips.source', { source: sourceFilter }),
            onRemove: () => setSourceFilter(''),
        });
    customFieldFiltersPayload.forEach((f) => {
        const fieldName =
            filterCustomFields.find((cf) => cf.customFieldId === f.field_id)?.fieldName ??
            t('chips.fallbackField');
        chips.push({
            label: t('chips.customField', { field: fieldName, value: filterEntryValueLabel(f) }),
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
            onRemove: () => {
                setRangeDays(DEFAULT_RANGE_DAYS);
                setCustomFrom('');
                setCustomTo('');
            },
        });
    }

    return (
        <div className="flex w-full flex-col gap-4">
            <div>
                <h1 className="text-2xl font-semibold text-neutral-900">{t('heading.title')}</h1>
                <p className="mt-0.5 text-sm text-neutral-500">{t('heading.subtitle')}</p>
            </div>

            {/* Toolbar — same filters as Recent Leads (minus the status dropdown:
                columns ARE the statuses; the picker on the right owns visibility). */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    {showOps && (
                        <MultiSelectFilter
                            label={terminology.tier}
                            icon={<Flame className="size-4 shrink-0 text-neutral-400" />}
                            options={tierCatalog.tiers.map((tier) => ({
                                value: tier.tier_key,
                                label: tier.label,
                            }))}
                            selected={tierFilters}
                            onChange={setTierFilters}
                            widthClass="w-36"
                        />
                    )}
                    {showOps && (
                        <MultiSelectFilter
                            label={t('filters.sla.label')}
                            icon={<Clock className="size-4 shrink-0 text-neutral-400" />}
                            options={slaOptions}
                            selected={slaFilters}
                            onChange={setSlaFilters}
                            widthClass="w-44"
                        />
                    )}
                    {showOps && (
                        <CounsellorFilter
                            values={counsellorFilters}
                            onChange={setCounsellorFilters}
                            unassignedValue={UNASSIGNED_COUNSELLOR_VALUE}
                            options={counsellorOptions}
                            isLoading={counsellorOptionsLoading}
                        />
                    )}
                    <MultiSelectFilter
                        label={t('filters.audience.label', { term: terminology.leadSource })}
                        icon={<Megaphone className="size-4 shrink-0 text-neutral-400" />}
                        options={audienceOptions.map((opt) => ({
                            value: opt.id,
                            label: opt.name,
                        }))}
                        selected={audienceFilters}
                        onChange={setAudienceFilters}
                        widthClass="w-44"
                    />
                    <Select
                        value={callHistoryFilter || 'ANY'}
                        onValueChange={(v) => setCallHistoryFilter(v === 'ANY' ? '' : v)}
                    >
                        <SelectTrigger className="h-10 w-44">
                            <Phone className="mr-1.5 size-4 shrink-0 text-neutral-400" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ANY">{t('filters.callHistory.any')}</SelectItem>
                            <SelectItem value="NOT_CALLED">
                                {t('filters.callHistory.notCalled')}
                            </SelectItem>
                            <SelectItem value="CALLED">
                                {t('filters.callHistory.calledAny')}
                            </SelectItem>
                            <SelectItem value="CALLED_ONCE">
                                {t('filters.callHistory.calledOnce')}
                            </SelectItem>
                            <SelectItem value="CALLED_TWICE_PLUS">
                                {t('filters.callHistory.calledTwicePlus')}
                            </SelectItem>
                            <SelectItem value="AI_CALLED">
                                {t('filters.callHistory.aiCalled')}
                            </SelectItem>
                            <SelectItem value="MANUAL_CALLED">
                                {t('filters.callHistory.manualCalled')}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    {filterCustomFields.map((f) =>
                        isRangeFieldType(f.fieldType) ? (
                            <CustomFieldRangeFilter
                                key={f.customFieldId}
                                fieldId={f.customFieldId}
                                fieldName={f.fieldName}
                                fieldType={f.fieldType}
                                selected={customFieldFilters[f.customFieldId] ?? []}
                                onChange={(vals) => setCustomFieldFilter(f.customFieldId, vals)}
                            />
                        ) : (
                            <CustomFieldMultiSelectFilter
                                key={f.customFieldId}
                                instituteId={instituteId ?? ''}
                                fieldId={f.customFieldId}
                                fieldName={f.fieldName}
                                selected={customFieldFilters[f.customFieldId] ?? []}
                                onChange={(vals) => setCustomFieldFilter(f.customFieldId, vals)}
                            />
                        )
                    )}
                    <UtmFilterControls
                        surface="LEADS"
                        instituteId={instituteId ?? ''}
                        selection={utmFilters}
                        onChange={setUtmFilter}
                    />
                    <ManageListFiltersLink surface="LEADS" />
                    <Select value={rangeDays} onValueChange={setDateRange}>
                        <SelectTrigger className="h-10 w-40">
                            <CalendarBlank className="mr-1.5 size-4 text-neutral-400" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {dateRangeOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {rangeDays === CUSTOM_DATE_VALUE && (
                        <Popover open={customOpen} onOpenChange={setCustomOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-10">
                                    <CalendarBlank className="mr-1.5 size-4 text-neutral-400" />
                                    {customFrom && customTo
                                        ? t('filters.customDate.rangeDisplay', {
                                              from: customFrom,
                                              to: customTo,
                                          })
                                        : t('filters.customDate.setDates')}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-72 space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-neutral-600">
                                            {t('filters.customDate.from')}
                                        </Label>
                                        <Input
                                            type="date"
                                            value={customFrom}
                                            onChange={(e) => setCustomFrom(e.target.value)}
                                            className="h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-neutral-600">
                                            {t('filters.customDate.to')}
                                        </Label>
                                        <Input
                                            type="date"
                                            value={customTo}
                                            onChange={(e) => setCustomTo(e.target.value)}
                                            className="h-9"
                                        />
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    className="w-full"
                                    onClick={() => setCustomOpen(false)}
                                >
                                    {t('filters.customDate.done')}
                                </Button>
                            </PopoverContent>
                        </Popover>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <SettingsQuickAccessButton
                        settingsKey={SettingsTabs.LeadSettings}
                        label={t('toolbar.leadSettings')}
                    />
                    <ManageColumnsPopover
                        columns={columnToggles}
                        hiddenColumns={hiddenColumns}
                        onToggle={toggleColumn}
                        onReset={resetColumns}
                    />
                </div>
            </div>

            {/* Active filter chips */}
            {chips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {chips.map((chip, i) => (
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

            {/* Search — filters every column at once */}
            <div className="relative w-full sm:w-80">
                <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                <Input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder={t('search.placeholder')}
                    className="h-10 w-full pl-8"
                    aria-label={t('search.ariaLabel')}
                />
            </div>

            {/* Board */}
            <SidebarProvider
                style={{ ['--sidebar-width' as string]: '565px' }}
                defaultOpen={false}
                open={isSidebarOpen}
                onOpenChange={setIsSidebarOpen}
            >
                <div className="min-w-0 flex-1">
                    {/* Board summary strip; its height is taken off the board below. */}
                    <div ref={stripRef} className="flow-root">
                        {!statusesLoading && visibleStatuses.length > 0 && (
                            <LeadBoardEnhancedStrip
                                statuses={visibleStatuses}
                                scopeId={instituteId ?? ''}
                                basePayload={basePayload}
                            />
                        )}
                    </div>
                    {statusesLoading ? (
                        <div className="flex items-center gap-2 py-16 text-sm text-neutral-500">
                            <CircleNotch className="size-5 animate-spin text-neutral-400" />
                            {t('board.loading')}
                        </div>
                    ) : orderedStatuses.length === 0 ? (
                        <LeadEmptyState
                            title={t('board.noStatusesTitle')}
                            description={t('board.noStatusesDescription')}
                        />
                    ) : visibleStatuses.length === 0 ? (
                        <LeadEmptyState
                            title={t('board.allHiddenTitle')}
                            description={t('board.allHiddenDescription')}
                            onClear={resetColumns}
                        />
                    ) : (
                        <div
                            className="min-h-96"
                            // Viewport-relative height (no spacing token exists for it): the
                            // board fills the space below the toolbar so each column scrolls
                            // internally — required for per-column infinite scroll.
                            style={{ height: `calc(100vh - ${330 + stripHeight}px)` }} // design-lint-ignore: viewport height minus the strip
                        >
                            <LeadStatusBoard
                                statuses={visibleStatuses}
                                fetchFn={(payload) =>
                                    fetchRecentLeads(
                                        payload as unknown as Parameters<typeof fetchRecentLeads>[0]
                                    )
                                }
                                basePayload={basePayload}
                                surfaceId="lead-board"
                                scopeId={instituteId ?? ''}
                                showScore={showScore}
                                showOps={showOps}
                                toVM={(raw) => recentLeadToVM(raw as RecentLeadDetail)}
                                actions={actions}
                                onStatusChanged={handleStatusChanged}
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
        </div>
    );
};
