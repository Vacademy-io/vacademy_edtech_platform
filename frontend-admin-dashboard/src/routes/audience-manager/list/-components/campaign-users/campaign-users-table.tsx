import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useLeadCounsellorOptions } from '@/hooks/use-lead-counsellor-options';
import { CounsellorFilter } from '@/components/shared/leads/counsellor-filter';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import {
    ExportColumnPickerDialog,
    type ExportColumnOption,
} from '@/components/shared/leads/export-column-picker-dialog';
import { CustomFieldMultiSelectFilter } from '@/components/shared/leads/custom-field-multi-select-filter';
import { ManageListFiltersLink } from '@/components/shared/leads/manage-list-filters-link';
import { UtmFilterControls } from '@/components/shared/leads/utm-filter-controls';
import {
    hasUtmSelection,
    toUtmFiltersPayload,
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
import { toast } from 'sonner';
import {
    MagnifyingGlass,
    Funnel,
    Flame,
    CheckCircle,
    UserPlus,
    UserMinus,
    UploadSimple,
    DownloadSimple,
    PaperPlaneTilt,
    X,
    Clock,
    CaretDown,
    Trash,
    ArrowsLeftRight,
    Phone,
    CircleNotch,
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
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { StudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/student-sidebar-provider';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { CallAllWithAiButton } from './call-all-ai-button';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { useLeadStatuses } from '@/hooks/use-lead-statuses';
import { useLeadTiers } from '@/hooks/use-lead-tiers';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { useLeadProfiles, fetchBatchProfiles } from '@/hooks/use-lead-profiles';
import { useLatestNotesBatch, fetchLatestNotesBatch } from '@/hooks/use-latest-notes-batch';
import {
    fetchLeadJourneyBatch,
    formatJourneyForExport,
    type JourneyEvent,
} from '@/components/shared/leads/lead-journey-export';
import { useCampaignUsers } from '../../-hooks/useCampaignUsers';
import { useCustomFieldSetup } from '../../-hooks/useCustomFieldSetup';
import { CustomFieldSetupItem } from '../../-services/get-custom-field-setup';
import { fetchCampaignLeads } from '../../-services/get-campaign-users';
import { CampaignUserTable } from './campaign-users-columns';
import { convertToLocalDateTime } from '@/constants/helper';
import { cn, parseHtmlToString } from '@/lib/utils';
import { LeadBulkImportDialog } from './LeadBulkImportDialog';
import { SendMessageDialog } from './SendMessageDialog';
import { CommunicationHistory } from './CommunicationHistory';
import { parseCustomFieldsFromJson } from '../../-utils/lead-bulk-import-utils';
import { AddLeadNoteDialog } from '@/components/shared/add-lead-note-dialog';
import {
    BulkAssignCounsellorDialog,
    type BulkAssignMode,
} from '@/components/shared/leads/bulk-assign-counsellor-dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import type { LeadCardVM } from '@/components/shared/leads/lead-view-model';
import { MyButton } from '@/components/design-system/button';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { DeleteLeadsDialog } from '@/components/shared/leads/delete-leads-dialog';
import { MigrateLeadsDialog } from '@/components/shared/leads/migrate-leads-dialog';
import { AssignCounselorToLeadDialog } from '@/components/shared/assign-counselor-to-lead-dialog';
import {
    LeadEmptyState,
    LeadTable,
    LeadPagination,
    ManageColumnsPopover,
    useColumnOrderPrefs,
    orderColumnIds,
    type LeadColumnToggle,
    useLeadColumnPrefs,
    buildLeadColumnToggles,
    useUpdateLeadTier,
    campaignRowToVM,
    type LeadActionHandlers,
    type LeadSortKey,
    type LeadSortDirection,
} from '@/components/shared/leads';
import { usePoolForAudience } from '@/services/counselor-pool';
import { Tag } from '@phosphor-icons/react';
import { BulkLeadStatusDialog } from '@/components/shared/leads/bulk-lead-status-dialog';
import { FreebieDownloadsPanel } from '@/components/shared/freebies/FreebieDownloadsPanel';
import { LeadListLeadsEnhancedHeader } from './LeadListLeadsEnhancedHeader';
import { ListShareBar } from './ListShareBar';
import { LeadListDetailHeader } from './LeadListDetailHeader';
import { LeadListDetailTabs, type LeadListTab } from './LeadListDetailTabs';
import { ListShareTab } from './ListShareTab';
import { ListAutomationsTab } from './ListAutomationsTab';
import { listCampaignKey, useListCampaign } from '../../-hooks/useListCampaign';
import { CreateCampaignDialog } from '../create-campaign-dialog/CreateCampaignDialog';

// Every row in this view is from the same audience, so "Lead source" is
// redundant — hidden by default and not offered in the Manage Column list.
// The campaign type is redundant here for the same reason, but it ships AFTER
// users already have saved column prefs, and `defaultHidden` only seeds the very
// first open. So it stays in the Manage Column list: new users get it hidden,
// everyone else can switch it off themselves.
const AUDIENCE_LEADS_DEFAULT_HIDDEN = ['source', 'campaignType'];

const ALL_VALUE = '__ALL__'; // every lead regardless of status (default — enrolled leads stay visible)
const ALL_ACTIVE_VALUE = '__ACTIVE__'; // all leads except those enrolled/Converted
const ALL_CONVERTED_VALUE = '__CONVERTED__'; // only leads enrolled into a course
const ALL_SLA_VALUE = '__ALL_SLA__'; // every lead regardless of SLA stage (TAT / follow-up)
type SlaFilter =
    | 'TAT_BEFORE'
    | 'TAT_OVERDUE'
    | 'FOLLOW_UP_DUE'
    | 'FOLLOW_UP_OVERDUE'
    | 'ANY_OVERDUE';
const buildSlaOptions = (t: TFunction): { value: string; label: string }[] => [
    { value: ALL_SLA_VALUE, label: t('filters.sla.label') },
    { value: 'ANY_OVERDUE', label: t('filters.sla.anyOverdue') },
    { value: 'TAT_OVERDUE', label: t('filters.sla.reachOutOverdue') },
    { value: 'TAT_BEFORE', label: t('filters.sla.reachOutDueSoon') },
    { value: 'FOLLOW_UP_DUE', label: t('filters.sla.followUpDue') },
    { value: 'FOLLOW_UP_OVERDUE', label: t('filters.sla.followUpOverdue') },
];
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;

const generateKeyFromName = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

const csvSafe = (val: unknown) => {
    if (val === undefined || val === null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
};

interface CampaignUsersTableProps {
    campaignId: string;
    campaignName?: string;
    customFieldsJson?: string;
    campaignType?: string;
}

/** Outer wrapper — keeps StudentSidebar context scoped to this page. */
export const CampaignUsersTable = (props: CampaignUsersTableProps) => (
    <StudentSidebarProvider>
        <CampaignUsersContent {...props} />
    </StudentSidebarProvider>
);

const CampaignUsersContent = ({
    campaignId,
    campaignName,
    customFieldsJson,
    campaignType,
}: CampaignUsersTableProps) => {
    const { t, i18n } = useTranslation('audienceManagerCampaignUsersTable');
    // Institute tier catalog + the institute's own names for "Tier" / "Lead status".
    const tierCatalog = useLeadTiers();
    const terminology = useLeadTerminology();
    const isOptOut = !!campaignType?.toUpperCase().includes('OPT_OUT');
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id;
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { setSelectedStudent } = useStudentSidebar();
    // Built every render (cheap): a memo could keep raw keys from before the catalog loaded.
    const slaOptions = buildSlaOptions(t);

    // ── Filter state ─────────────────────────────────────────
    const [page, setPage] = useState(0);
    const [sortBy, setSortBy] = useState<LeadSortKey>('SUBMITTED_AT');
    const [sortDirection, setSortDirection] = useState<LeadSortDirection>('DESC');
    const handleSortChange = (nextSortBy: LeadSortKey, nextSortDirection: LeadSortDirection) => {
        setPage(0);
        setSortBy(nextSortBy);
        setSortDirection(nextSortDirection);
    };
    const [searchInput, setSearchInput] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    // Multi-select arrays: empty = no filter (show all). Tier values: HOT/WARM/COLD.
    const [tierFilters, setTierFilters] = useState<string[]>([]);
    // Lead status multi-select. Empty = all leads. Special sentinels handled by
    // handleLeadStatusChange to stay mutually exclusive with custom statuses.
    const [leadStatusFilters, setLeadStatusFilters] = useState<string[]>([]);
    // SLA-state multi-select — matches `audience_response.tat_reminder_stage`.
    const [slaFilters, setSlaFilters] = useState<string[]>([]);
    // Counsellor filter — userIds of assigned counsellors. Empty = all counsellors.
    const ALL_COUNSELLORS_VALUE = '__ALL_COUNSELLORS__';
    // Sentinel for the "Unassigned" dropdown entry → leads no counsellor owns
    // (sent to the backend as is_unassigned: true, assigned_counselor_id omitted).
    const UNASSIGNED_COUNSELLOR_VALUE = '__UNASSIGNED__';
    const [counsellorFilters, setCounsellorFilters] = useState<string[]>([]);
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
    const [fromDate, setFromDate] = useState('');
    // Call-history filter — '' = no filter (NOT_CALLED / CALLED / CALLED_ONCE /
    // CALLED_TWICE_PLUS / AI_CALLED / MANUAL_CALLED).
    const [callHistoryFilter, setCallHistoryFilter] = useState<string>('');
    const [toDate, setToDate] = useState('');
    const [appliedRange, setAppliedRange] = useState<{ from: string; to: string }>({
        from: '',
        to: '',
    });

    // Custom-field filters — keyed by custom_field_id → selected values (multi-select).
    // Only fields the admin enabled in Lead Settings render a control.
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
    // Sentinel selections (contains / empty / ranges) decode into operator
    // entries; plain values stay an IN entry.
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
        setPage(0);
        setUtmFilters((prev) => {
            const next = { ...prev };
            if (values.length === 0) delete next[dimension];
            else next[dimension] = values;
            return next;
        });
    };
    const utmFiltersPayload = useMemo(() => toUtmFiltersPayload(utmFilters), [utmFilters]);

    // ── Dialog state ─────────────────────────────────────────
    const [showBulkImport, setShowBulkImport] = useState(false);
    const [showSendMessage, setShowSendMessage] = useState(false);
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
    const [isExporting, setIsExporting] = useState(false);
    const [exportPickerOpen, setExportPickerOpen] = useState(false);
    const [selectedExportCols, setSelectedExportCols] = useState<Set<string>>(new Set());

    // Debounce search input → appliedSearch (drives the query key).
    useEffect(() => {
        const trimmed = searchInput.trim();
        if (trimmed === appliedSearch) return;
        const timer = window.setTimeout(() => {
            setAppliedSearch(trimmed);
            setPage(0);
        }, SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput, appliedSearch]);

    // Reset all state when the campaign changes — filter values are campaign-specific.
    useEffect(() => {
        setPage(0);
        setSearchInput('');
        setAppliedSearch('');
        setTierFilters([]);
        setLeadStatusFilters([]);
        setSlaFilters([]);
        setCounsellorFilters([]);
        setFromDate('');
        setToDate('');
        setAppliedRange({ from: '', to: '' });
        setCustomFieldFilters({});
    }, [campaignId]);

    // ── Custom-field setup (drives the side panel's response card) ───────────
    const bulkImportCustomFields = useMemo(
        () => parseCustomFieldsFromJson(customFieldsJson),
        [customFieldsJson]
    );
    const customFields = useMemo(() => {
        if (!customFieldsJson) return [];
        try {
            const parsed = JSON.parse(customFieldsJson);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }, [customFieldsJson]);

    const { data: customFieldSetup, isLoading: isCfLoading } = useCustomFieldSetup(instituteId);
    const customFieldMap = useMemo(() => {
        const map = new Map<string, CustomFieldSetupItem>();
        if (!customFieldSetup) return map;
        customFieldSetup.forEach((field) => {
            const reg = (key?: string) => {
                if (!key) return;
                map.set(key, field);
                map.set(key.toLowerCase(), field);
                map.set(key.toUpperCase(), field);
                const norm = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                if (norm && norm !== key.toLowerCase()) map.set(norm, field);
            };
            reg(field.custom_field_id);
            reg(field.field_key);
            if (field.field_name) reg(generateKeyFromName(field.field_name));
        });
        return map;
    }, [customFieldSetup]);

    const campaignFieldsMap = useMemo(() => {
        const map = new Map<string, { name: string; key?: string }>();
        map.set('opted_out_from', {
            name: t('campaignFields.optedOutFrom'),
            key: 'opted_out_from',
        });
        if (customFields.length === 0) return map;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        customFields.forEach((cf: any) => {
            const fieldId = cf.custom_field?.id || cf.id || cf._id || cf.field_id;
            if (!fieldId) return;
            const meta = cf.custom_field || {};
            const fieldName = meta.fieldName || meta.field_name || cf.field_name || '';
            const fieldKey = meta.fieldKey || meta.field_key || generateKeyFromName(fieldName);
            if (!fieldName) return;
            map.set(fieldId, { name: fieldName, key: fieldKey });
            map.set(fieldId.toLowerCase(), { name: fieldName, key: fieldKey });
            map.set(fieldId.toUpperCase(), { name: fieldName, key: fieldKey });
        });
        return map;
    }, [customFields, t]);

    // Declared here (before exportColumnOptions) so the memo can reference it
    // without a temporal dead zone error — the hook call is order-safe.
    const leadSettings = useLeadSettings();
    const showOps = !leadSettings.isLoading && leadSettings.enabled;

    // Columns available for the export picker — built from known fields so the
    // user can toggle them before the async fetch runs.
    const exportColumnOptions = useMemo<ExportColumnOption[]>(() => {
        const cols: ExportColumnOption[] = [
            { key: 'lead_id', label: t('exportColumns.leadId') },
            { key: 'submitted_at', label: t('exportColumns.submittedAt') },
            { key: 'name', label: t('exportColumns.name') },
            { key: 'email', label: t('exportColumns.email') },
            { key: 'mobile', label: t('exportColumns.mobile') },
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const seenNames = new Set<string>();
        (customFields as any[]).forEach((cf) => {
            const fieldId = cf.custom_field?.id || cf.id || cf._id || cf.field_id;
            if (!fieldId) return;
            const meta = cf.custom_field || {};
            const fieldName = meta.fieldName || meta.field_name || cf.field_name || '';
            if (!fieldName || seenNames.has(fieldName)) return;
            seenNames.add(fieldName);
            cols.push({ key: `cf__${fieldId}`, label: fieldName });
        });
        // Deep links / page refreshes lose the `customFields` route param the
        // campaign card passes on navigation — without it the picker offered no
        // custom-field columns at all. Fall back to the institute custom-field
        // catalog so the columns are always pickable.
        if (customFields.length === 0) {
            (customFieldSetup ?? [])
                .filter((f) => !f.is_hidden)
                .sort((a, b) => (a.form_order ?? 0) - (b.form_order ?? 0))
                .forEach((f) => {
                    if (!f.custom_field_id || !f.field_name) return;
                    if (seenNames.has(f.field_name)) return;
                    seenNames.add(f.field_name);
                    cols.push({ key: `cf__${f.custom_field_id}`, label: f.field_name });
                });
        }
        if (showOps) {
            cols.push(
                { key: 'lead_status', label: t('exportColumns.leadStatus') },
                { key: 'counsellor', label: t('exportColumns.counsellor') },
                { key: 'activity_notes', label: t('exportColumns.activityNotes') },
                { key: 'notes_count', label: t('exportColumns.notesCount') },
                { key: 'lead_journey', label: t('exportColumns.leadJourney') }
            );
        }
        return cols;
    }, [customFields, customFieldSetup, showOps, t]);

    // ── Server query ─────────────────────────────────────────
    const leadsPayload = useMemo(() => {
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
        const specialStatuses = new Set([ALL_VALUE, ALL_ACTIVE_VALUE, ALL_CONVERTED_VALUE]);
        const customStatusKeys = leadStatusFilters.filter((v) => !specialStatuses.has(v));
        const nonUnassignedCounsellorIds = counsellorFilters.filter(
            (v) => v !== UNASSIGNED_COUNSELLOR_VALUE
        );
        const onlyUnassigned =
            counsellorFilters.includes(UNASSIGNED_COUNSELLOR_VALUE) &&
            nonUnassignedCounsellorIds.length === 0;
        return {
            audience_id: campaignId,
            page,
            size: PAGE_SIZE,
            sort_by: sortBy,
            sort_direction: sortDirection,
            submitted_from_local: startOfDayIso(appliedRange.from),
            submitted_to_local: endOfDayIso(appliedRange.to),
            search_query: appliedSearch || undefined,
            lead_tier: tierFilters.length > 0 ? tierFilters.join(',') : undefined,
            lead_status_id: customStatusKeys.length > 0 ? customStatusKeys.join(',') : undefined,
            // Unfiltered view hides converted leads only when the institute turned on
            // LEAD_SETTING.hideConvertedInAllLeads; a picked status always gets every lead.
            conversion_status_filter: (leadStatusFilters.includes(ALL_ACTIVE_VALUE) ||
            (leadSettings.hideConvertedInAllLeads && leadStatusFilters.length === 0)
                ? 'EXCLUDE_CONVERTED'
                : leadStatusFilters.includes(ALL_CONVERTED_VALUE)
                  ? 'ONLY_CONVERTED'
                  : 'ALL') as 'EXCLUDE_CONVERTED' | 'ALL' | 'ONLY_CONVERTED',
            sla_filter: slaFilters.length > 0 ? (slaFilters.join(',') as SlaFilter) : undefined,
            assigned_counselor_id:
                nonUnassignedCounsellorIds.length > 0
                    ? nonUnassignedCounsellorIds.join(',')
                    : undefined,
            is_unassigned: onlyUnassigned ? true : undefined,
            custom_field_filters: customFieldFiltersPayload.length
                ? customFieldFiltersPayload
                : undefined,
            utm_filters: utmFiltersPayload,
            call_history_filter: callHistoryFilter || undefined,
        };
    }, [
        campaignId,
        page,
        sortBy,
        sortDirection,
        appliedRange,
        appliedSearch,
        tierFilters,
        leadStatusFilters,
        slaFilters,
        counsellorFilters,
        customFieldFiltersPayload,
        utmFiltersPayload,
        callHistoryFilter,
        leadSettings.hideConvertedInAllLeads,
        ALL_VALUE,
        ALL_ACTIVE_VALUE,
        ALL_CONVERTED_VALUE,
        UNASSIGNED_COUNSELLOR_VALUE,
    ]);

    // Wait for lead settings so the first request already carries the right conversion filter;
    // a disabled query is not "loading" in v5, so count the settings wait too.
    const {
        data: usersResponse,
        isLoading: usersLoading,
        error,
    } = useCampaignUsers(leadsPayload, { enabled: !leadSettings.isLoading });
    const isLoading = usersLoading || leadSettings.isLoading;

    // ── Settings + per-row data ──────────────────────────────
    const showScore = showOps && leadSettings.showScoreInEnquiryTable;
    const { statuses: leadStatusCatalog, filterStatuses: leadStatusFilterOptions } =
        useLeadStatuses();

    const leadUserIds = useMemo(
        () =>
            (usersResponse?.content ?? [])
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((lead: any) => lead.user?.id || lead.user_id || '')
                .filter((id: string): id is string => !!id),
        [usersResponse]
    );
    const { profiles: leadProfiles } = useLeadProfiles(leadUserIds, showOps, instituteId);
    const { notesByUserId } = useLatestNotesBatch(leadUserIds, showOps);

    // ── Transform server rows → CampaignUserTable[] ─────────────
    const tableRows = useMemo<CampaignUserTable[]>(() => {
        if (!usersResponse?.content) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return usersResponse.content.map((lead: any, index: number) => {
            const user = lead.user || {};
            const customValues = lead.custom_field_values || {};
            const submittedAt = lead.submitted_at_local
                ? convertToLocalDateTime(lead.submitted_at_local)
                : '-';

            const responseFields: Array<{
                id: string;
                name: string;
                type: string;
                rawValue: string | null;
            }> = [];
            const apiMetaSrc = lead.custom_field_metadata ?? {};
            Object.entries(customValues).forEach(([fieldId, rawVal]) => {
                const value = rawVal == null ? null : String(rawVal);
                if (value === null || value === '') return;
                let name = fieldId;
                let type = 'textfield';
                const cf = campaignFieldsMap.get(fieldId);
                if (cf?.name) name = cf.name;
                const setup =
                    customFieldMap.get(fieldId) || customFieldMap.get(fieldId.toLowerCase());
                if (setup?.field_name) name = setup.field_name;
                if (setup?.field_type) type = setup.field_type;
                const apiMeta = apiMetaSrc[fieldId];
                if (apiMeta?.fieldName || apiMeta?.field_name)
                    name = apiMeta.fieldName ?? apiMeta.field_name;
                if (apiMeta?.fieldType || apiMeta?.field_type)
                    type = apiMeta.fieldType ?? apiMeta.field_type;
                responseFields.push({ id: fieldId, name, type, rawValue: value });
            });

            const row: CampaignUserTable = {
                id: lead.response_id || lead.user_id || `${index}`,
                index: page * PAGE_SIZE + index,
                submittedAt,
                full_name: user.full_name || user.name || lead.parent_name || null,
                email: user.email || lead.parent_email || null,
                phone_number: user.mobile_number || lead.parent_mobile || null,
                opted_out_from: lead.source_audience_name || null,
                _user_id: user.id || lead.user_id || null,
                _user: user,
                _custom_field_values: customValues,
                _audience_campaign_name: lead.campaign_name || campaignName || null,
                _audience_campaign_type: lead.campaign_type || campaignType || null,
                _utm_campaign: lead.utm_campaign || null,
                _utm_source: lead.utm_source || null,
                _tat_due_at: lead.tat_due_at ?? null,
                _tat_due_overridden: lead.tat_due_overridden ?? null,
                _is_duplicate: lead.is_duplicate ?? null,
                _follow_up_priority: lead.follow_up_priority ?? null,
                _follow_up_due_at: lead.follow_up_due_at ?? null,
                _tat_overdue: lead.tat_overdue ?? null,
                _tat_due_soon: lead.tat_due_soon ?? null,
                _follow_up_overdue: lead.follow_up_overdue ?? null,
                _sla_closed: lead.sla_closed ?? null,
                _first_response_at: lead.first_response_at ?? null,
                _lead_status: lead.lead_status ?? null,
                _response_id: lead.response_id ?? null,
                _response_fields: responseFields,
                // The submitted_at_local ISO is needed for the VM's relative time + sort.
                _submitted_iso: lead.submitted_at_local,
            };
            return row;
        });
    }, [usersResponse, page, customFieldMap, campaignFieldsMap, campaignName, campaignType]);

    const totalElements = usersResponse?.totalElements ?? 0;
    const totalPages = usersResponse?.totalPages ?? 0;

    const vms = useMemo(() => tableRows.map(campaignRowToVM), [tableRows]);

    // ── Actions for the LeadTable ────────────────────────────
    const invalidateKeys: string[][] = [['campaignUsers', campaignId], ['lead-profiles-batch']];
    const updateTier = useUpdateLeadTier({ invalidateKeys });
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
        }),
        [setSelectedStudent, updateTier]
    );
    // Enhanced lead side panel: Previous / Next and quick actions run on these rows.
    const handleStatusUpdated = () => {
        queryClient.invalidateQueries({ queryKey: ['campaignUsers', campaignId] });
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
    // Response ids of the ticked rows — what "Send message" targets when a selection exists.
    const selectedResponseIds = useMemo(() => Array.from(selectedLeads.keys()), [selectedLeads]);
    const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
    const [bulkMigrateOpen, setBulkMigrateOpen] = useState(false);
    const canDeleteLeads = isAdminForInstitute(instituteId);
    // Which flow the "Bulk actions" menu opened: assign (round-robin default)
    // or unassign (REMOVE).
    const [bulkActionMode, setBulkActionMode] = useState<BulkAssignMode>('ROUND_ROBIN');
    const [bulkStatusOpen, setBulkStatusOpen] = useState(false);

    // Selection works in every view (previously Unassigned-only, which made
    // reassign/remove unreachable); drop it on filter change so stale ids
    // can't leak into an assign.
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

    // Select every lead matching the current filter (across all pages), not just
    // the rows on screen — fetches all ids in one call (same pattern as export).
    const [selectAllLoading, setSelectAllLoading] = useState(false);
    const selectAllAcrossPages = async () => {
        if (!totalElements) return;
        try {
            setSelectAllLoading(true);
            const res = await fetchCampaignLeads({ ...leadsPayload, page: 0, size: totalElements });
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

    // Column show/hide is persisted per user (localStorage), seeded with the
    // source column hidden. Kept on its own storage key so this audience view
    // and the Recent Leads page each remember their own layout.
    const { hiddenColumns, toggleColumn, resetColumns } = useLeadColumnPrefs(
        'crm-lead-columns:audience-leads',
        AUDIENCE_LEADS_DEFAULT_HIDDEN
    );
    // Order is a second, independent preference, paired with visibility exactly as
    // Recent Leads and Manage Payments pair them.
    const { columnOrder, setColumnOrder, resetColumnOrder } = useColumnOrderPrefs(
        'crm-lead-column-order:audience-leads'
    );
    /** Reset restores BOTH halves of the layout: what is hidden and what order it is in. */
    const handleResetColumns = () => {
        resetColumns();
        resetColumnOrder();
    };
    // "Manage Column" list — source stays hidden and is not offered here.
    const naturalColumnToggles = useMemo(
        () =>
            buildLeadColumnToggles(showOps, showScore, {
                tier: terminology.tier,
                leadStatus: terminology.leadStatus,
                campaignType: terminology.campaignType,
                leadSource: terminology.leadSource,
            }).filter((c) => c.id !== 'source'),
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

    // ── Filter handlers ──────────────────────────────────────
    const handleTierChange = (values: string[]) => {
        setPage(0);
        setTierFilters(values);
    };
    const handleLeadStatusChange = (newValues: string[]) => {
        setPage(0);
        // ALL_ACTIVE / ALL_CONVERTED are exclusive — selecting one clears all others.
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
    const setCounsellor = (values: string[]) => {
        setPage(0);
        setCounsellorFilters(values);
    };
    const setSla = (values: string[]) => {
        setPage(0);
        setSlaFilters(values);
    };
    const handleApplyDate = () => {
        setPage(0);
        setAppliedRange({ from: fromDate, to: toDate });
    };
    const handleClearAllFilters = () => {
        setPage(0);
        setSearchInput('');
        setAppliedSearch('');
        setTierFilters([]);
        setLeadStatusFilters([]);
        setSlaFilters([]);
        setCounsellorFilters([]);
        setFromDate('');
        setToDate('');
        setAppliedRange({ from: '', to: '' });
        setCustomFieldFilters({});
        setUtmFilters({});
    };

    const isDateFilterActive = !!appliedRange.from || !!appliedRange.to;
    const isAnyFilterActive =
        isDateFilterActive ||
        !!appliedSearch ||
        tierFilters.length > 0 ||
        leadStatusFilters.length > 0 ||
        slaFilters.length > 0 ||
        counsellorFilters.length > 0 ||
        customFieldFiltersPayload.length > 0 ||
        hasUtmSelection(utmFilters);

    // Active filter chips
    const chips: { label: string; onRemove: () => void }[] = [];
    if (appliedSearch)
        chips.push({
            label: t('chips.search', { query: appliedSearch }),
            onRemove: () => {
                setSearchInput('');
                setAppliedSearch('');
            },
        });
    if (isDateFilterActive)
        chips.push({
            label: t('chips.date', {
                from: appliedRange.from || t('chips.datePlaceholder'),
                to: appliedRange.to || t('chips.datePlaceholder'),
            }),
            onRemove: () => {
                setFromDate('');
                setToDate('');
                setAppliedRange({ from: '', to: '' });
            },
        });
    if (tierFilters.length > 0)
        chips.push({
            label: t('chips.tier', { values: tierFilters.join(', ') }),
            onRemove: () => setTierFilters([]),
        });
    if (leadStatusFilters.length > 0) {
        const statusLabels = leadStatusFilters.map((v) => {
            if (v === ALL_ACTIVE_VALUE) return t('chips.statusActive');
            if (v === ALL_CONVERTED_VALUE) return t('chips.statusConverted');
            return leadStatusCatalog.find((s) => s.status_key === v)?.label ?? v;
        });
        chips.push({
            label: t('chips.status', { values: statusLabels.join(', ') }),
            onRemove: () => setLeadStatusFilters([]),
        });
    }
    if (slaFilters.length > 0)
        chips.push({
            label: t('chips.sla', {
                values: slaFilters
                    .map((v) => slaOptions.find((o) => o.value === v)?.label ?? v)
                    .join(', '),
            }),
            onRemove: () => setSlaFilters([]),
        });
    if (counsellorFilters.length > 0) {
        const cLabels = counsellorFilters.map((id) =>
            id === UNASSIGNED_COUNSELLOR_VALUE
                ? t('chips.counsellorUnassigned')
                : counsellorOptions.find((c) => c.id === id)?.full_name ??
                  t('chips.counsellorSelected')
        );
        chips.push({
            label: t('chips.counsellor', { values: cLabels.join(', ') }),
            onRemove: () => setCounsellorFilters([]),
        });
    }
    customFieldFiltersPayload.forEach((f) => {
        const fieldName =
            filterCustomFields.find((cf) => cf.customFieldId === f.field_id)?.fieldName ??
            t('chips.customFieldFallback');
        chips.push({
            label: t('chips.customField', { fieldName, value: filterEntryValueLabel(f) }),
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

    // ── CSV export ───────────────────────────────────────────
    const handleExport = async () => {
        if (!totalElements) {
            toast.info(t('toasts.noLeadsToExport'));
            return;
        }
        setIsExporting(true);
        try {
            toast.info(t('toasts.exportStarting'));
            const allDataPayload = { ...leadsPayload, page: 0, size: totalElements };
            const response = await fetchCampaignLeads(allDataPayload);
            if (!response.content || response.content.length === 0) {
                toast.info(t('toasts.noDataToExport'));
                return;
            }

            // Batch-resolve counsellor + notes + journey only for the ops columns the
            // user selected in the picker — skip the fetches if none are selected.
            const exportUserIds = Array.from(
                new Set(
                    response.content
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .map((lead: any) => lead.user?.id || lead.user_id || '')
                        .filter((id: string): id is string => !!id)
                )
            );
            let exportProfiles: Record<string, { assigned_counselor_name?: string | null }> = {};
            let exportNotes: Record<
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
            > = {};
            let exportJourney: Record<string, JourneyEvent[]> = {};
            const needsOps =
                showOps &&
                (selectedExportCols.has('lead_status') ||
                    selectedExportCols.has('counsellor') ||
                    selectedExportCols.has('activity_notes') ||
                    selectedExportCols.has('notes_count') ||
                    selectedExportCols.has('lead_journey'));
            if (needsOps && exportUserIds.length > 0) {
                try {
                    [exportProfiles, exportNotes, exportJourney] = await Promise.all([
                        fetchBatchProfiles(exportUserIds, instituteId ?? ''),
                        fetchLatestNotesBatch(exportUserIds),
                        fetchLeadJourneyBatch(exportUserIds),
                    ]);
                } catch (e) {
                    console.warn('Failed to enrich CSV with counsellor/notes/journey', e);
                }
            }

            // Discover all custom-field IDs; only include those the user picked.
            const allFieldIds = new Set<string>();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            customFields.forEach((field: any) => {
                const fieldId = field.custom_field?.id || field.id || field._id || field.field_id;
                if (fieldId) allFieldIds.add(fieldId);
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            response.content.forEach((lead: any) => {
                const customValues = lead.custom_field_values || {};
                Object.keys(customValues).forEach((key) => allFieldIds.add(key));
            });
            // Picker options can also come from the institute catalog (the
            // deep-link fallback in exportColumnOptions); a checked field must
            // become a column even when neither the campaign JSON nor the row
            // data mentioned it (it just exports empty).
            selectedExportCols.forEach((key) => {
                if (key.startsWith('cf__')) allFieldIds.add(key.slice('cf__'.length));
            });
            // For fields the picker knew about, respect the user's selection.
            // For fields discovered from the data only (not in picker), always include them.
            const knownCfKeys = new Set(
                exportColumnOptions.filter((c) => c.key.startsWith('cf__')).map((c) => c.key)
            );
            const fieldIdsArray = Array.from(allFieldIds).filter((fieldId) => {
                const colKey = `cf__${fieldId}`;
                return knownCfKeys.has(colKey) ? selectedExportCols.has(colKey) : true;
            });

            // Build headers respecting column selection.
            const csvHeaders: string[] = [];
            if (selectedExportCols.has('lead_id')) csvHeaders.push(t('csv.headers.leadId'));
            if (selectedExportCols.has('submitted_at'))
                csvHeaders.push(t('csv.headers.submittedAt'));
            if (selectedExportCols.has('name')) csvHeaders.push(t('csv.headers.name'));
            if (selectedExportCols.has('email')) csvHeaders.push(t('csv.headers.email'));
            if (selectedExportCols.has('mobile')) csvHeaders.push(t('csv.headers.mobile'));

            const fieldIdToHeaderNameMap: Record<string, string> = {};
            fieldIdsArray.forEach((fieldId) => {
                let headerName = fieldId;
                const cf = campaignFieldsMap.get(fieldId);
                if (cf?.name) headerName = cf.name;
                const setup =
                    customFieldMap.get(fieldId) || customFieldMap.get(fieldId.toLowerCase());
                if (setup?.field_name) headerName = setup.field_name;
                fieldIdToHeaderNameMap[fieldId] = headerName;
                csvHeaders.push(headerName.includes(',') ? `"${headerName}"` : headerName);
            });
            if (showOps && selectedExportCols.has('lead_status'))
                csvHeaders.push(t('csv.headers.leadStatus'));
            if (showOps && selectedExportCols.has('counsellor'))
                csvHeaders.push(t('csv.headers.counsellor'));
            if (showOps && selectedExportCols.has('activity_notes'))
                csvHeaders.push(t('csv.headers.activityNotes'));
            if (showOps && selectedExportCols.has('notes_count'))
                csvHeaders.push(t('csv.headers.notesCount'));
            if (showOps && selectedExportCols.has('lead_journey'))
                csvHeaders.push(t('csv.headers.leadJourney'));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const csvRows = response.content.map((lead: any) => {
                const user = lead.user || {};
                const customValues = lead.custom_field_values || {};
                const submittedAt = lead.submitted_at_local
                    ? convertToLocalDateTime(lead.submitted_at_local)
                    : '-';
                const row: string[] = [];
                if (selectedExportCols.has('lead_id'))
                    row.push(csvSafe(lead.response_id || lead.user_id || '-'));
                if (selectedExportCols.has('submitted_at')) row.push(csvSafe(submittedAt));
                if (selectedExportCols.has('name'))
                    row.push(csvSafe(user.full_name || user.name || '-'));
                if (selectedExportCols.has('email')) row.push(csvSafe(user.email || '-'));
                if (selectedExportCols.has('mobile')) row.push(csvSafe(user.mobile_number || '-'));

                fieldIdsArray.forEach((fieldId) => {
                    row.push(csvSafe(customValues[fieldId]));
                });

                if (showOps) {
                    const userId = user.id || lead.user_id || '';
                    const counsellor = userId
                        ? exportProfiles[userId]?.assigned_counselor_name ?? ''
                        : '';
                    const summary = userId ? exportNotes[userId] : undefined;
                    const recent = summary?.recent ?? [];
                    const notesBlock = recent
                        .map((n, idx) => {
                            const label = n.title?.trim() || t('csv.noteFallbackLabel');
                            const rawBody = n.description ?? '';
                            const body = (
                                /<\/?[a-z][^>]*>/i.test(rawBody)
                                    ? parseHtmlToString(rawBody)
                                    : rawBody
                            ).trim();
                            const date = n.created_at ? convertToLocalDateTime(n.created_at) : '';
                            return [
                                `${idx + 1}. ${label} - ${body}`,
                                `   ${t('csv.updatedByLabel')} - ${n.actor_name || ''}`,
                                `   ${t('csv.dateLabel')} - ${date}`,
                            ].join('\n');
                        })
                        .join('\n\n');
                    if (selectedExportCols.has('lead_status'))
                        row.push(csvSafe(lead.lead_status ?? ''));
                    if (selectedExportCols.has('counsellor')) row.push(csvSafe(counsellor));
                    if (selectedExportCols.has('activity_notes')) row.push(csvSafe(notesBlock));
                    if (selectedExportCols.has('notes_count'))
                        row.push(csvSafe(summary?.count ?? 0));
                    if (selectedExportCols.has('lead_journey'))
                        row.push(
                            csvSafe(
                                formatJourneyForExport(userId ? exportJourney[userId] : undefined)
                            )
                        );
                }
                return row.join(',');
            });

            const csv = [csvHeaders.join(','), ...csvRows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                `${campaignName || 'campaign_users'}_${new Date().toISOString().split('T')[0]}.csv`
            );
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast.success(t('toasts.exportSuccess', { count: response.content.length }));
        } catch (err) {
            console.error('Export failed:', err);
            toast.error(t('toasts.exportFailed'));
        } finally {
            setIsExporting(false);
        }
    };

    // Which counsellor pool this list feeds, if any. Resolves to null for the many
    // lists that aren't auto-assigned, in which case the chip simply doesn't render.
    const { data: pool } = usePoolForAudience(campaignId);

    // ── List page sections + the list's own record ──────────────
    const [tab, setTab] = useState<LeadListTab>('leads');
    const { data: listCampaign } = useListCampaign(campaignId);
    // Wizard step the Edit dialog opens on; null = closed.
    const [editStep, setEditStep] = useState<number | null>(null);
    const closeEdit = () => {
        setEditStep(null);
        // Saving changes the list's name / status / settings shown above.
        queryClient.invalidateQueries({
            queryKey: listCampaignKey(instituteId ?? '', campaignId),
        });
    };
    // Counsellor names for the pool card, from the option lists already loaded.
    const counsellorNames = new Map<string, string>();
    for (const o of [...assignableCounsellorOptions, ...counsellorOptions]) {
        counsellorNames.set(o.id, o.full_name);
    }
    const goToAddResponse = () =>
        navigate({
            to: '/audience-manager/list/campaign-users/add',
            search: {
                campaignId,
                campaignName,
                customFields: customFieldsJson,
            },
            // Router's typed search doesn't model these dynamic params.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

    return (
        <div className="flex w-full flex-col gap-6">
            {/* Heading */}
            <LeadListDetailHeader
                campaign={listCampaign}
                fallbackName={campaignName ?? t('heading.fallbackTitle')}
                respondentsLabel={
                    isLoading
                        ? t('heading.loadingRespondents')
                        : t('heading.respondentsCount', {
                              count: totalElements,
                              formattedCount: totalElements.toLocaleString(i18n.language),
                          })
                }
                isOptOut={isOptOut}
                pool={pool}
                onAddResponse={goToAddResponse}
                onEdit={() => setEditStep(0)}
            />

            {/* Summary header. */}
            {campaignId && <ListShareBar campaignId={campaignId} />}
            {campaignId && !isOptOut && <LeadListLeadsEnhancedHeader audienceId={campaignId} />}

            <LeadListDetailTabs
                value={tab}
                onChange={setTab}
                counts={{ leads: isLoading ? undefined : totalElements }}
            />

            {/* Leads tab. Kept mounted while another tab is open so filters, selection
                and the side panel survive a tab switch. */}
            <div className={cn('flex flex-col gap-6', tab !== 'leads' && 'hidden')}>
                {/* Which freebies this list's leads took from the website. Renders nothing
                for lists that never gated a resource. */}
                {campaignId && !isOptOut && (
                    <FreebieDownloadsPanel audienceId={campaignId} hideWhenEmpty collapsible />
                )}

                {/* Toolbar — left filters, right actions */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <MultiSelectFilter
                            label={terminology.tier}
                            icon={<Flame className="size-4 shrink-0 text-neutral-400" />}
                            options={tierCatalog.tiers.map((tier) => ({
                                value: tier.tier_key,
                                label: tier.label,
                            }))}
                            selected={tierFilters}
                            onChange={handleTierChange}
                            widthClass="w-36"
                        />
                        <MultiSelectFilter
                            label={terminology.leadStatus}
                            icon={<CheckCircle className="size-4 shrink-0 text-neutral-400" />}
                            options={[
                                { value: ALL_ACTIVE_VALUE, label: t('filters.leadStatus.active') },
                                // Built-in, not a catalog row — see Lead Settings -> All Leads View.
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
                            widthClass="w-44"
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
                                widthClass="w-44"
                            />
                        )}
                        {showOps && (
                            <CounsellorFilter
                                values={counsellorFilters}
                                onChange={setCounsellor}
                                unassignedValue={UNASSIGNED_COUNSELLOR_VALUE}
                                options={counsellorOptions}
                                isLoading={counsellorOptionsLoading}
                            />
                        )}
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
                        <Select
                            value={callHistoryFilter || 'ANY'}
                            onValueChange={(v) => {
                                setCallHistoryFilter(v === 'ANY' ? '' : v);
                                setPage(0);
                            }}
                        >
                            <SelectTrigger className="h-10 w-44">
                                <Phone className="mr-1.5 size-4 shrink-0 text-neutral-400" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ANY">
                                    {t('filters.callHistory.placeholder')}
                                </SelectItem>
                                <SelectItem value="NOT_CALLED">
                                    {t('filters.callHistory.notCalled')}
                                </SelectItem>
                                <SelectItem value="CALLED">
                                    {t('filters.callHistory.called')}
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
                        <UtmFilterControls
                            surface="LEADS"
                            instituteId={instituteId ?? ''}
                            selection={utmFilters}
                            onChange={setUtmFilter}
                        />
                        <ManageListFiltersLink surface="LEADS" />
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-10">
                                    <Funnel className="mr-1.5 size-4" />
                                    {t('filters.moreFilters')}
                                    {isDateFilterActive && (
                                        <span className="ml-1.5 size-1.5 rounded-full bg-primary-500" />
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-72 space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-neutral-600">
                                            {t('filters.dateFrom')}
                                        </Label>
                                        <Input
                                            type="date"
                                            value={fromDate}
                                            onChange={(e) => setFromDate(e.target.value)}
                                            className="h-9"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-neutral-600">
                                            {t('filters.dateTo')}
                                        </Label>
                                        <Input
                                            type="date"
                                            value={toDate}
                                            onChange={(e) => setToDate(e.target.value)}
                                            className="h-9"
                                        />
                                    </div>
                                </div>
                                <Button size="sm" className="w-full" onClick={handleApplyDate}>
                                    {t('filters.applyDates')}
                                </Button>
                            </PopoverContent>
                        </Popover>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-10"
                            onClick={() => setShowSendMessage(true)}
                        >
                            <PaperPlaneTilt className="mr-1.5 size-4" />
                            {t('toolbar.sendMessage')}
                        </Button>
                        {!isOptOut && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-10"
                                onClick={() => setShowBulkImport(true)}
                            >
                                <UploadSimple className="mr-1.5 size-4" />
                                {t('toolbar.importCsv')}
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
                            variant="outline"
                            size="sm"
                            className="h-10"
                            onClick={() => {
                                setSelectedExportCols(
                                    new Set(exportColumnOptions.map((c) => c.key))
                                );
                                setExportPickerOpen(true);
                            }}
                            disabled={isExporting || !totalElements}
                        >
                            <DownloadSimple className="mr-1.5 size-4" />
                            {isExporting ? t('toolbar.exporting') : t('toolbar.export')}
                        </Button>
                        <CallAllWithAiButton
                            audienceId={campaignId}
                            instituteId={instituteId}
                            totalElements={totalElements}
                            selectedLeads={selectedLeads}
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
                        {isAnyFilterActive && (
                            <button
                                type="button"
                                onClick={handleClearAllFilters}
                                className="px-1 text-xs font-medium text-primary-600 hover:underline"
                            >
                                {t('filters.clearAll')}
                            </button>
                        )}
                    </div>
                )}

                {/* Search + result count */}
                <div className="flex flex-wrap items-center justify-between gap-3">
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
                    <div className="text-sm text-neutral-500">
                        {isLoading ? (
                            <span className="flex items-center gap-1.5">
                                <CircleNotch className="size-3.5 animate-spin" />
                                {t('search.loadingResults')}
                            </span>
                        ) : (
                            t('search.resultsCount', {
                                count: totalElements,
                                shown: tableRows.length.toLocaleString(i18n.language),
                                total: totalElements.toLocaleString(i18n.language),
                            })
                        )}
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
                                    {t('bulkToolbar.selectedCount', { count: selectedLeads.size })}
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
                                                ? t('bulkToolbar.selecting')
                                                : t('bulkToolbar.selectAll', {
                                                      count: totalElements,
                                                  })}
                                        </MyButton>
                                    )}
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => setSelectedLeads(new Map())}
                                    >
                                        {t('bulkToolbar.clear')}
                                    </MyButton>
                                    <MyDropdown
                                        dropdownList={[
                                            {
                                                label: t('bulkToolbar.sendMessage'),
                                                value: 'send-message',
                                                icon: <PaperPlaneTilt className="size-4" />,
                                            },
                                            {
                                                label: t('bulkToolbar.assignLeads'),
                                                value: 'assign',
                                                icon: <UserPlus className="size-4" />,
                                            },
                                            {
                                                label: t('bulkToolbar.unassignLeads'),
                                                value: 'unassign',
                                                icon: <UserMinus className="size-4" />,
                                            },
                                            // Not admin-gated, unlike move/delete below: changing
                                            // status is a counsellor's normal daily action and the
                                            // per-row status chip already allows it.
                                            {
                                                label: t('bulkToolbar.changeStatus'),
                                                value: 'status',
                                                icon: <Tag className="size-4" />,
                                            },
                                            // Move and delete are admin-only, matching those
                                            // endpoints' own checks.
                                            ...(canDeleteLeads
                                                ? [
                                                      {
                                                          label: t('bulkToolbar.moveLeads'),
                                                          value: 'migrate',
                                                          icon: (
                                                              <ArrowsLeftRight className="size-4" />
                                                          ),
                                                      },
                                                      {
                                                          label: t('bulkToolbar.deleteLeads'),
                                                          value: 'delete',
                                                          icon: (
                                                              <Trash className="size-4 text-danger-600" />
                                                          ),
                                                      },
                                                  ]
                                                : []),
                                        ]}
                                        onSelect={(value) => {
                                            if (value === 'status') {
                                                setBulkStatusOpen(true);
                                                return;
                                            }
                                            if (value === 'send-message') {
                                                setShowSendMessage(true);
                                                return;
                                            }
                                            if (value === 'delete') {
                                                setBulkDeleteOpen(true);
                                                return;
                                            }
                                            if (value === 'migrate') {
                                                setBulkMigrateOpen(true);
                                                return;
                                            }
                                            setBulkActionMode(
                                                value === 'unassign' ? 'REMOVE' : 'ROUND_ROBIN'
                                            );
                                            setBulkAssignOpen(true);
                                        }}
                                    >
                                        <MyButton buttonType="primary" scale="small">
                                            {t('bulkToolbar.bulkActions')}
                                            <CaretDown className="size-3.5" />
                                        </MyButton>
                                    </MyDropdown>
                                </div>
                            </div>
                        )}
                        {error ? (
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
                                isLoading={isLoading || isCfLoading}
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
                                        title={
                                            isAnyFilterActive
                                                ? t('emptyState.noResultsTitle')
                                                : t('emptyState.noDataTitle')
                                        }
                                        description={
                                            isAnyFilterActive
                                                ? t('emptyState.noResultsDescription')
                                                : t('emptyState.noDataDescription')
                                        }
                                        onClear={
                                            isAnyFilterActive ? handleClearAllFilters : undefined
                                        }
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
                            // Keep the selection when nothing moved -- the admin probably wants to
                            // pick a different status rather than reselect every row.
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
                        // This view is one list, so exclude it from the picker.
                        currentAudienceId={campaignId}
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
                </SidebarProvider>

                {/* Pagination */}
                <LeadPagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>

            {/* Communication history for this campaign — loads when its tab opens. */}
            {tab === 'history' && (
                <CommunicationHistory
                    campaignId={campaignId}
                    onSendMessage={() => setShowSendMessage(true)}
                />
            )}
            {tab === 'share' && (
                <ListShareTab
                    campaignId={campaignId}
                    campaign={listCampaign}
                    formFields={bulkImportCustomFields}
                    onEdit={setEditStep}
                />
            )}
            {tab === 'auto' && (
                <ListAutomationsTab
                    campaignId={campaignId}
                    campaign={listCampaign}
                    instituteId={instituteId ?? ''}
                    pool={pool}
                    counsellorNames={counsellorNames}
                    formFields={bulkImportCustomFields}
                    onEdit={setEditStep}
                />
            )}

            {/* Edit list — the same create/edit dialog as the Lead Lists card. */}
            {listCampaign && (
                <CreateCampaignDialog
                    isOpen={editStep !== null}
                    onClose={closeEdit}
                    campaign={listCampaign}
                    initialStep={editStep ?? 0}
                />
            )}

            {/* Dialogs anchored at the page level */}
            <LeadBulkImportDialog
                open={showBulkImport}
                onOpenChange={setShowBulkImport}
                campaignId={campaignId}
                campaignName={campaignName || t('dialogs.campaignFallbackName')}
                instituteId={instituteId || ''}
                customFields={bulkImportCustomFields}
            />
            <SendMessageDialog
                open={showSendMessage}
                onOpenChange={setShowSendMessage}
                campaignId={campaignId}
                campaignName={campaignName || t('dialogs.campaignFallbackName')}
                instituteId={instituteId || ''}
                customFields={bulkImportCustomFields}
                leadCount={totalElements}
                selectedResponseIds={selectedResponseIds}
            />
            <ExportColumnPickerDialog
                open={exportPickerOpen}
                onOpenChange={setExportPickerOpen}
                columns={exportColumnOptions}
                selected={selectedExportCols}
                onSelectedChange={setSelectedExportCols}
                onExport={() => {
                    setExportPickerOpen(false);
                    handleExport();
                }}
                isExporting={isExporting}
            />
        </div>
    );
};
