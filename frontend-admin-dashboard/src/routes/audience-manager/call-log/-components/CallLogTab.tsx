/**
 * CallLogTab — the "Call Log" tab of the Reports Center
 * (/audience-manager/reports?tab=call-log). The operational, row-level call
 * list that the aggregate "Calling" tab drills into: every call (AI + human,
 * inbound + outbound, every provider) in one paginated, filterable table.
 *
 * Lazy-imported by the Reports shell; the shell owns the page chrome + the
 * shared filter bar (date range / team / counsellor) and passes the applied
 * window in via props (contract-fixed default export + ReportTabProps).
 *
 * Sections (top to bottom):
 *   1. KPI strip — total · connected · connect-rate · talk-time · AI vs human,
 *      from POST /metrics (honors the same filters as the table).
 *   2. Worklist chips — Missed inbound · Callbacks due (badge counts), plus the
 *      tab-local filter bar (status / direction / type / provider / disposition
 *      / number / lead name / has-recording).
 *   3. Paginated call table — status pill, AI/human badge, inline recording
 *      playback, and a per-row quick-disposition that syncs lead status. Admins
 *      additionally get a per-row health dot opening the technical post-mortem
 *      for AI calls (see ./CallHealth.tsx).
 *   4. Export — CSV / XLSX of the current filtered view (server-rendered).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ArrowsClockwise,
    ArrowBendUpRight,
    DownloadSimple,
    Info,
    PhoneIncoming,
    PhoneOutgoing,
    Robot,
    Sparkle,
    User,
    WarningCircle,
    Waveform,
    WhatsappLogo,
    ClockCounterClockwise,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyPagination } from '@/components/design-system/pagination';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SidebarProvider } from '@/components/ui/sidebar';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { CallIntelligencePanel, useCallIntelligenceEnabled } from '@/components/shared/leads';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import { ToolCostConfirmDialog } from '@/components/common/ai-credits/ToolCostConfirmDialog';
import { fetchCreditEstimate } from '@/services/ai-credits/get-ai-credits';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { fetchStudentDetailsOnce } from '@/services/get-student-details';
import {
    audienceLeadKey,
    fetchAudienceLeadByResponseId,
} from '@/routes/audience-manager/list/-services/get-recent-leads';
import { mapRecentLeadToStudent } from '@/components/shared/leads/lead-view-model';
import type { StudentTable } from '@/types/student-table-types';
import { TELEPHONY_CALL_STATUSES, humanizeCallStatus } from '@/hooks/use-lead-report-settings';
import {
    applyDisposition,
    bulkAnalyze,
    bulkSetDisposition,
    bulkSetLeadStatus,
    callDetailKey,
    callRowLeadUserId,
    isMaskedNumber,
    callLogMetricsKey,
    callLogSearchKey,
    dispositionCatalogKey,
    dispositionCountsKey,
    dispositionOptionsKey,
    exportCallLog,
    fetchCallDetail,
    fetchCallLog,
    fetchCallMetrics,
    fetchDispositionCatalog,
    fetchDispositionCounts,
    fetchDispositionFilterOptions,
    fetchRecordingUrl,
    isCallLogEndpointMissing,
    normalizeDispositionKey,
    rowFollowUpGist,
    rowCallHealth,
    rowFollowUp,
    toMillis,
    type BulkResult,
    type CallLogFilters,
    type CallLogScope,
    type FollowUp,
    type CallRow,
    type DispositionCount,
    type DispositionOption,
} from '../-services/call-log-service';
import { CallHealthCell, CallHealthSheet } from './CallHealth';
import { Checkbox } from '@/components/ui/checkbox';
import { LeadStatusSelect } from '@/components/shared/lead-status-select';
import { useLeadStatuses } from '@/hooks/use-lead-statuses';
import { useLeadCounsellorOptions } from '@/hooks/use-lead-counsellor-options';
import { BulkAssignCounsellorDialog } from '@/components/shared/leads/bulk-assign-counsellor-dialog';
import { MigrateLeadsDialog } from '@/components/shared/leads/migrate-leads-dialog';

/** Scope passed in by the page (date window + RBAC narrowing), same shape the Reports tabs used. */
export interface CallLogTabProps {
    instituteId: string;
    fromDate: string;
    toDate: string;
    /** Instant window (epoch millis) for the hour presets; overrides the dates when set. */
    fromTs?: number;
    toTs?: number;
    teamId?: string;
    counsellorUserId?: string;
}

const PAGE_SIZE = 25;
const ALL = '__ALL__';

/**
 * Provider vocabulary — every value `telephony_call_log.provider_type` can hold
 * (backend `ProviderType`), grouped by the call type it implies so the provider
 * filter can follow the Type filter.
 *
 * This list used to be three entries (Exotel, Aavtaar, Airtel), written when
 * those were the only providers. VACADEMY_AI — our own voice bot, by now the
 * majority of AI calls on several institutes — was never added, so choosing
 * Type = AI offered "AI (Aavtaar)" as the only provider and there was no way to
 * filter to (or even name, in the detail panel) the institute's own agent. PLIVO
 * (Vacademy Voice click-to-call) and MANUAL uploads were likewise unfilterable.
 *
 * Grouping is the backend's own rule, mirrored: a row is AI when its provider is
 * AAVTAAR / VACADEMY_AI / MOCK or an ai_call_result has landed for it
 * (CallSearchService.AI_LATERAL); everything else is HUMAN.
 */
type ProviderGroup = 'AI' | 'HUMAN';

function buildProviderOptions(t: TFunction): ReadonlyArray<{
    value: string;
    label: string;
    group: ProviderGroup;
    /** Hidden from the filter dropdown (test-only), still labelled in the detail panel. */
    filterable: boolean;
}> {
    return [
        { value: 'VACADEMY_AI', label: t('providers.vacademyAi'), group: 'AI', filterable: true },
        { value: 'AAVTAAR', label: t('providers.aavtaarAi'), group: 'AI', filterable: true },
        { value: 'MOCK', label: t('providers.mock'), group: 'AI', filterable: false },
        { value: 'PLIVO', label: t('providers.plivo'), group: 'HUMAN', filterable: true },
        { value: 'AIRTEL', label: t('providers.airtel'), group: 'HUMAN', filterable: true },
        { value: 'EXOTEL', label: t('providers.exotel'), group: 'HUMAN', filterable: true },
        { value: 'MANUAL', label: t('providers.manual'), group: 'HUMAN', filterable: true },
    ];
}

/**
 * The provider options to OFFER given the current Type filter: all filterable
 * providers when Type is "All", otherwise only the group that type implies. A
 * provider from the other group would always return zero rows, so listing it
 * is worse than useless — it is exactly how "AI shows only Aavtaar" read as a
 * broken filter.
 */
function providerOptionsFor(t: TFunction, callType: string) {
    return buildProviderOptions(t).filter(
        (p) => p.filterable && (callType === ALL || p.group === callType)
    );
}

// ── Formatting ─────────────────────────────────────────────────────────────

function fmtNumber(n: number | null | undefined): string {
    return n == null || Number.isNaN(n) ? '—' : n.toLocaleString();
}
function fmtPct(p: number | null | undefined): string {
    return p == null || Number.isNaN(p) ? '—' : `${p.toFixed(1)}%`;
}
function fmtTalkHm(seconds: number | null | undefined): string {
    if (seconds == null || Number.isNaN(seconds)) return '—';
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
}
function fmtDuration(s: number | null): string {
    if (!s || s <= 0) return '—';
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m ? `${m}m ${r}s` : `${r}s`;
}
function fmtDateTime(v: number | string | null): string {
    const ms = toMillis(v);
    if (ms == null) return '—';
    return new Date(ms).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const STATUS_TONE: Record<string, string> = {
    COMPLETED: 'bg-success-50 text-success-700',
    NO_ANSWER: 'bg-warning-50 text-warning-700',
    BUSY: 'bg-warning-50 text-warning-700',
    FAILED: 'bg-danger-50 text-danger-600',
    CANCELLED: 'bg-neutral-100 text-neutral-600',
    IN_PROGRESS: 'bg-info-50 text-info-700',
    COUNSELLOR_RINGING: 'bg-info-50 text-info-700',
    COUNSELLOR_ANSWERED: 'bg-info-50 text-info-700',
    QUEUED: 'bg-neutral-100 text-neutral-600',
    INITIATED: 'bg-neutral-100 text-neutral-600',
};

/**
 * Statuses where a "why did it end this way" popover earns its place — the call
 * didn't simply connect and complete.
 */
const DETAILABLE_STATUSES = new Set(['FAILED', 'BUSY', 'NO_ANSWER', 'CANCELLED']);

/**
 * Whether the status pill doubles as a details affordance. Status alone used to
 * decide this, which meant a COMPLETED call could never be inspected — and most
 * AI calls complete, including the ones where the caller sat through 10s of
 * silence. A call that reported a technical verdict has something to say
 * regardless of how it ended, so it earns the affordance too.
 */
function isDetailable(row: CallRow): boolean {
    return DETAILABLE_STATUSES.has(row.status) || rowCallHealth(row) != null;
}

/**
 * The instant, row-only seed for the side-sheet — enough to open it on the right
 * person while the real lead record loads. `_response_id` marks the selection as
 * a lead so the Lead Profile tab opens. Cast through unknown because the full
 * StudentTable has ~90 fields the sheet lazy-loads.
 *
 * This is deliberately thin: a call row simply does not contain a lead. Its
 * `lead_name` is `audience_response.parent_name` — the GUARDIAN, a different
 * person (see the note in lead-view-model.ts) — it has no email, and its number
 * may be masked. Everything real arrives from the hydration in `openLead`.
 */
function callRowSeedStudent(r: CallRow): StudentTable {
    const userId = callRowLeadUserId(r);
    const student: Record<string, unknown> = {
        id: userId,
        user_id: userId,
        full_name: r.lead_name || '',
        email: '',
        // Never the masked string: it is display text, and the Communications tab
        // would query the timeline by it and the composer would message it.
        mobile_number: isMaskedNumber(r.lead_number) ? '' : r.lead_number ?? '',
        status: 'INACTIVE',
        _response_id: r.response_id ?? null,
    };
    return student as unknown as StudentTable;
}

// NOTE ON SCOPE: the masked-numbers setting governs the CALL LOG surface — this
// table, the CSV/XLSX export, the detail popover and the technical diagnostics.
// It deliberately does NOT follow the lead into the side-sheet, which hydrates and
// behaves exactly as it does when opened from Recent Leads / Lead List / Lead
// Board / Follow-ups. Two reasons:
//   1. it would be false assurance — the same number is shown unmasked on all four
//      of those pages, so masking one panel contains nothing;
//   2. the sheet's Overview tab seeds an EDIT form from `_response_fields`
//      (EditLeadDetails) and writes it back, so rewriting an answer for display
//      risks persisting `*******1234` into the lead's real phone field. Today that
//      is prevented only by EditLeadDetails filtering phone fields with a regex
//      identical to the one such a masking pass would use — a coincidence, not a
//      guarantee.
// Making the mask a real access control means applying it across every lead
// surface, which is a deliberate product decision, not a Call Log detail.

// ── Main component (contract-fixed export + props) ─────────────────────────

export default function CallLogTab({
    instituteId,
    fromDate,
    toDate,
    fromTs,
    toTs,
    teamId,
    counsellorUserId,
}: CallLogTabProps) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const queryClient = useQueryClient();
    const scope: CallLogScope = { instituteId, fromDate, toDate, fromTs, toTs, teamId, counsellorUserId };

    // Shared lead side-sheet (same one Recent Leads / Follow-ups use). The
    // StudentSidebarProvider is mounted app-wide by the layout; we only own the
    // open/close state, via a local SidebarProvider around the sheet.
    const { setSelectedStudent } = useStudentSidebar();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    /**
     * Open the lead behind a call row: seed the sheet from the row so it opens
     * instantly, then replace the selection with the real lead.
     *
     * The replacement is the whole point. The sheet is NOT purely user-id driven —
     * its header, quick-contact chips, Communications tab (queried by email/phone),
     * WhatsApp/email composer and the Lead Profile tab's form-response card all read
     * the selected object verbatim. A call row carries none of that, which is why
     * those surfaces came up blank when opened from here.
     *
     * Two hydration paths, preferring the richer one:
     *   1. the call is tied to an audience response → fetch that lead and run it
     *      through `mapRecentLeadToStudent`, the SAME mapper Recent Leads / Lead
     *      List / Follow-ups use, so the sheet gets an identical object (identity,
     *      form answers + field metadata, guardian rows, campaign name);
     *   2. no response id (a call linked to a person but to no campaign) → fall
     *      back to the auth-service user record for at least name/email/phone.
     * If both fail the row-derived seed stands.
     */
    const openLeadRef = useRef(0);
    const openLead = async (r: CallRow) => {
        const userId = callRowLeadUserId(r);
        if (!userId) return;
        const token = ++openLeadRef.current;
        setSelectedStudent(callRowSeedStudent(r), { openOverlay: false });
        setIsSidebarOpen(true);

        const apply = (student: StudentTable) => {
            // A newer row was clicked while this was in flight — its selection wins.
            if (openLeadRef.current !== token) return;
            // Hydration must never take away a name we already had: if the lead's
            // auth user couldn't be resolved the mapper yields an empty full_name,
            // and the header would fall back from the row's name to "Unknown".
            const named: StudentTable = student.full_name
                ? student
                : { ...student, full_name: r.lead_name || '' };
            setSelectedStudent(named, { openOverlay: false });
        };

        if (r.response_id) {
            try {
                const lead = await queryClient.fetchQuery({
                    queryKey: audienceLeadKey(r.response_id),
                    queryFn: () => fetchAudienceLeadByResponseId(r.response_id as string),
                    staleTime: 2 * 60 * 1000,
                });
                apply(mapRecentLeadToStudent(lead));
                return;
            } catch {
                // Older backend (no single-lead read) or a deleted response —
                // fall through to the user-record path rather than leaving the
                // sheet on the row seed.
            }
        }

        try {
            const details = await fetchStudentDetailsOnce(queryClient, userId);
            apply({
                ...callRowSeedStudent(r),
                full_name: details?.full_name || r.lead_name || '',
                email: details?.email || '',
                mobile_number: details?.mobile_number || '',
            } as StudentTable);
        } catch {
            // Keep the seed.
        }
    };

    // Per-call transcript + AI intelligence — hosted in a dialog, gated by a
    // credits-cost confirmation. Column only shows when the feature is enabled.
    const intelEnabled = useCallIntelligenceEnabled();
    const [intelTarget, setIntelTarget] = useState<CallRow | null>(null);

    // Per-call technical health (AI calls). Admin-only: the panel speaks in
    // internal failure language ("TTS socket wedge", "answers discarded"), which
    // is the right vocabulary for whoever debugs the agent and the wrong one for
    // a counsellor working their list. Same gate the rest of the admin-only
    // affordances use — the server re-checks on the detail endpoint.
    const canSeeCallHealth = isAdminForInstitute(instituteId);
    const [healthTarget, setHealthTarget] = useState<CallRow | null>(null);

    // Tab-local filters.
    const [direction, setDirection] = useState<string>(ALL);
    const [callType, setCallType] = useState<string>(ALL);
    const [providerType, setProviderType] = useState<string>(ALL);
    const [status, setStatus] = useState<string>(ALL);
    // Multi-select: the search endpoint takes a list, and "show me Callback OR
    // Callback Requested OR Demo Booked" is the normal way this vocabulary is used —
    // it has as many entries as the institute has AI outcomes, so one-at-a-time
    // means one page load per outcome.
    const [dispositionKeys, setDispositionKeys] = useState<string[]>([]);
    const [leadName, setLeadName] = useState('');
    const [toNumber, setToNumber] = useState('');
    const [chip, setChip] = useState<'NONE' | 'MISSED' | 'CALLBACKS'>('NONE');
    const [page, setPage] = useState(0);

    const filters: CallLogFilters = useMemo(
        () => ({
            direction: direction === ALL ? undefined : (direction as CallLogFilters['direction']),
            callType: callType === ALL ? undefined : (callType as CallLogFilters['callType']),
            providerType: providerType === ALL ? undefined : providerType,
            statuses: status === ALL ? undefined : [status],
            dispositionKeys: dispositionKeys.length ? dispositionKeys : undefined,
            leadName: leadName.trim() || undefined,
            toNumber: toNumber.trim() || undefined,
            missedInbound: chip === 'MISSED' || undefined,
            callbacksDue: chip === 'CALLBACKS' || undefined,
            sortBy: 'TIME',
            sortDirection: 'DESC',
        }),
        [direction, callType, providerType, status, dispositionKeys, leadName, toNumber, chip]
    );

    // Any filter / scope change resets to the first page.
    const filterSig = JSON.stringify([scope, filters]);
    useEffect(() => setPage(0), [filterSig]);

    const retryUnlessMissing = (failureCount: number, error: unknown) =>
        !isCallLogEndpointMissing(error) && failureCount < 2;

    // Two disposition vocabularies, deliberately: the catalog is what a counsellor may
    // SET (the apply endpoint accepts nothing else), while the filter must also offer
    // the AI outcomes — configured in Settings → AI Calling and by the institute's AI
    // agents — because that's what the Disposition column actually shows for AI calls.
    const catalogQuery = useQuery({
        queryKey: dispositionCatalogKey(instituteId),
        queryFn: () => fetchDispositionCatalog(instituteId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
        retry: retryUnlessMissing,
    });
    const dispositionOptionsQuery = useQuery({
        queryKey: dispositionOptionsKey(instituteId),
        queryFn: () => fetchDispositionFilterOptions(instituteId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
        retry: retryUnlessMissing,
    });
    const metricsQuery = useQuery({
        queryKey: callLogMetricsKey(scope, filters),
        queryFn: () => fetchCallMetrics(scope, filters),
        enabled: !!instituteId,
        staleTime: 30_000,
        retry: retryUnlessMissing,
    });
    const searchQuery = useQuery({
        queryKey: callLogSearchKey(scope, filters, page, PAGE_SIZE),
        queryFn: () => fetchCallLog(scope, filters, page, PAGE_SIZE),
        enabled: !!instituteId,
        staleTime: 15_000,
        retry: retryUnlessMissing,
    });

    const [dispositionTarget, setDispositionTarget] = useState<CallRow | null>(null);

    // Disposition strip: every outcome in the window with a count. Keyed on the
    // filters WITHOUT the disposition selection, so the strip does not collapse to
    // the one chip you just clicked.
    const stripFilters: CallLogFilters = useMemo(() => {
        const { dispositionKeys: _omit, missedInbound: _m, callbacksDue: _c, ...rest } = filters;
        return rest;
    }, [filters]);
    const dispositionCountsQuery = useQuery({
        queryKey: dispositionCountsKey(scope, stripFilters),
        queryFn: () => fetchDispositionCounts(scope, stripFilters),
        enabled: !!instituteId,
        staleTime: 30_000,
        retry: retryUnlessMissing,
    });
    const toggleDispositionChip = (key: string) => {
        if (!key) return; // "Not set" is a count, not a filter the search can express
        setDispositionKeys((cur) => (cur.length === 1 && cur[0] === key ? [] : [key]));
    };

    // Lead statuses (for the inline status column + bulk status) and counsellors (bulk assign).
    const { statuses: leadStatuses } = useLeadStatuses();
    const { options: counsellorOptions } = useLeadCounsellorOptions({ assignable: true });

    // Row selection → bulk bar. Keyed by call id; cleared whenever the list changes.
    const [selected, setSelected] = useState<Set<string>>(new Set());
    useEffect(() => setSelected(new Set()), [filterSig, page]);
    const toggleRow = (id: string) =>
        setSelected((cur) => {
            const next = new Set(cur);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const [bulkDialog, setBulkDialog] = useState<
        'NONE' | 'STATUS' | 'DISPOSITION' | 'ASSIGN' | 'CAMPAIGN'
    >('NONE');

    const refreshLists = () => {
        queryClient.invalidateQueries({ queryKey: ['crm-call-log-search'] });
        queryClient.invalidateQueries({ queryKey: ['crm-call-log-metrics'] });
        queryClient.invalidateQueries({ queryKey: ['crm-call-log-disposition-counts'] });
    };

    const reportBulk = (res: BulkResult, verb: string) => {
        if (res.failed?.length) {
            toast.warning(t('bulk.partial', { updated: res.updated, failed: res.failed.length, verb }));
        } else {
            toast.success(t('bulk.done', { updated: res.updated, verb }));
        }
        setSelected(new Set());
        refreshLists();
    };
    const analyzeMutation = useMutation({
        mutationFn: () => bulkAnalyze(instituteId, [...selected]),
        onSuccess: (res) => reportBulk(res, t('bulk.verbAnalyze')),
        onError: () => toast.error(t('bulk.error')),
    });

    if (!instituteId) {
        return <EmptyBlock message={t('empty.pickInstitute')} />;
    }
    if (searchQuery.isError && isCallLogEndpointMissing(searchQuery.error)) {
        return <DeployPendingNotice />;
    }

    const metrics = metricsQuery.data;
    // Picker options: catalog only, and defensively re-filtered — an older cached
    // response, or a backend that starts folding AI outcomes into /dispositions, must
    // never put an unsettable option in front of a counsellor.
    const dispositions = (catalogQuery.data ?? []).filter((d) => d.settable !== false);
    const dispositionOptions = dispositionOptionsQuery.data ?? dispositions;
    /** Normalized outcome key → the vocabulary's label, so a row reads like the filter. */
    const dispositionLabels = new Map(
        dispositionOptions.map((d) => [normalizeDispositionKey(d.disposition_key), d.label])
    );
    const data = searchQuery.data;
    const rows = data?.content ?? [];
    const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
    const selectedRows = rows.filter((r) => selected.has(r.id));
    const selectedLeads = Array.from(
        new Map(
            selectedRows
                .filter((r) => callRowLeadUserId(r))
                .map((r) => [callRowLeadUserId(r) as string, { userId: callRowLeadUserId(r) as string, name: r.lead_name || '' }])
        ).values()
    );
    const selectedResponseIds = Array.from(
        new Set(selectedRows.map((r) => r.response_id).filter((x): x is string => !!x))
    );

    return (
        <SidebarProvider
            style={{ ['--sidebar-width' as string]: '565px' }}
            defaultOpen={false}
            open={isSidebarOpen}
            onOpenChange={setIsSidebarOpen}
        >
            <div className="flex w-full min-w-0 flex-col gap-6">
                {/* 1 — KPI strip */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                    <KpiStat
                        label={t('kpi.totalCalls')}
                        value={fmtNumber(metrics?.total_calls)}
                        tone="primary"
                        loading={metricsQuery.isLoading}
                    />
                    <KpiStat
                        label={t('kpi.connected')}
                        value={fmtNumber(metrics?.connected_calls)}
                        sub={fmtPct(metrics?.connect_rate)}
                        tone="success"
                        loading={metricsQuery.isLoading}
                    />
                    <KpiStat
                        label={t('kpi.talkTime')}
                        value={fmtTalkHm(metrics?.total_talk_seconds)}
                        sub={t('kpi.talkTimeUnit')}
                        tone="warning"
                        loading={metricsQuery.isLoading}
                    />
                    <KpiStat
                        label={t('kpi.uniqueLeads')}
                        value={fmtNumber(metrics?.unique_leads)}
                        tone="info"
                        loading={metricsQuery.isLoading}
                    />
                    <KpiStat
                        label={t('kpi.aiVsHuman')}
                        value={`${fmtNumber(metrics?.ai_calls)} / ${fmtNumber(metrics?.human_calls)}`}
                        sub={t('kpi.aiVsHumanUnit')}
                        tone="default"
                        loading={metricsQuery.isLoading}
                    />
                </div>

                {/* 2 — Worklist chips + filter bar */}
                <section className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                        <ChipToggle
                            active={chip === 'NONE'}
                            onClick={() => setChip('NONE')}
                            label={t('chips.allCalls')}
                        />
                        <ChipToggle
                            active={chip === 'MISSED'}
                            onClick={() => setChip(chip === 'MISSED' ? 'NONE' : 'MISSED')}
                            label={t('chips.missedInbound')}
                            count={metrics?.missed_inbound_due}
                            tone="danger"
                        />
                        <ChipToggle
                            active={chip === 'CALLBACKS'}
                            onClick={() => setChip(chip === 'CALLBACKS' ? 'NONE' : 'CALLBACKS')}
                            label={t('chips.callbacksDue')}
                            count={metrics?.callbacks_due}
                            tone="warning"
                        />
                        <div className="ml-auto flex items-center gap-2">
                            <ExportButton
                                scope={scope}
                                filters={filters}
                                disabled={rows.length === 0}
                            />
                        </div>
                    </div>

                    {/* Disposition strip — every outcome in this window, click to filter */}
                    {(dispositionCountsQuery.data?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="me-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                                {t('dispositionStrip.label')}
                            </span>
                            {(dispositionCountsQuery.data ?? []).map((d) => (
                                <DispositionChip
                                    key={d.key || '__none__'}
                                    item={d}
                                    active={dispositionKeys.length === 1 && dispositionKeys[0] === d.key}
                                    onClick={() => toggleDispositionChip(d.key)}
                                    notSetLabel={t('dispositionStrip.notSet')}
                                />
                            ))}
                            {dispositionKeys.length > 0 && (
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    onClick={() => setDispositionKeys([])}
                                >
                                    {t('dispositionStrip.clear')}
                                </MyButton>
                            )}
                        </div>
                    )}

                    <div className="flex flex-wrap items-end gap-3">
                        <FilterText
                            label={t('filters.leadName')}
                            value={leadName}
                            onChange={setLeadName}
                            placeholder={t('filters.leadNamePlaceholder')}
                        />
                        <FilterText
                            label={t('filters.number')}
                            value={toNumber}
                            onChange={setToNumber}
                            placeholder={t('filters.numberPlaceholder')}
                        />
                        <FilterSelect
                            label={t('filters.direction')}
                            value={direction}
                            onChange={setDirection}
                            options={[
                                { value: 'OUTBOUND', label: t('filters.directionOutbound') },
                                { value: 'INBOUND', label: t('filters.directionInbound') },
                            ]}
                        />
                        <FilterSelect
                            label={t('filters.type')}
                            value={callType}
                            onChange={(v) => {
                                setCallType(v);
                                // A provider from the other group can no longer match
                                // anything — drop it rather than leave a filter that
                                // silently returns an empty list.
                                if (
                                    providerType !== ALL &&
                                    !providerOptionsFor(t, v).some((p) => p.value === providerType)
                                ) {
                                    setProviderType(ALL);
                                }
                            }}
                            options={[
                                { value: 'HUMAN', label: t('filters.typeHuman') },
                                { value: 'AI', label: t('filters.typeAi') },
                            ]}
                        />
                        <FilterSelect
                            label={t('filters.provider')}
                            value={providerType}
                            onChange={setProviderType}
                            options={providerOptionsFor(t, callType).map((p) => ({
                                value: p.value,
                                label: p.label,
                            }))}
                        />
                        <FilterSelect
                            label={t('filters.status')}
                            value={status}
                            onChange={setStatus}
                            options={TELEPHONY_CALL_STATUSES.map((s) => ({
                                value: s,
                                label: humanizeCallStatus(s),
                            }))}
                        />
                        <FilterMultiSelect
                            label={t('filters.disposition')}
                            selected={dispositionKeys}
                            onChange={setDispositionKeys}
                            options={dispositionOptions.map((d) => ({
                                value: d.disposition_key,
                                label: d.label,
                            }))}
                        />
                    </div>
                </section>

                {/* 3 — Call table */}
                <section className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <h2 className="text-base font-semibold text-neutral-900">
                            {t('table.heading')}
                            {data && (
                                <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                                    {fmtNumber(data.total_elements)}
                                </span>
                            )}
                        </h2>
                    </div>

                    {/* Bulk bar — appears once a row is ticked */}
                    {selected.size > 0 && (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2">
                            <span className="text-sm font-medium text-primary-800">
                                {t('bulk.selected', { count: selected.size })}
                            </span>
                            <MyButton buttonType="text" scale="small" onClick={() => setSelected(new Set())}>
                                {t('bulk.clear')}
                            </MyButton>
                            <span className="mx-1 h-4 w-px bg-primary-200" aria-hidden />
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setBulkDialog('STATUS')}
                                disabled={selectedResponseIds.length === 0}
                            >
                                {t('bulk.leadStatus')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setBulkDialog('DISPOSITION')}
                            >
                                {t('bulk.disposition')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setBulkDialog('ASSIGN')}
                                disabled={selectedLeads.length === 0}
                            >
                                {t('bulk.assignCounsellor')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setBulkDialog('CAMPAIGN')}
                                disabled={selectedResponseIds.length === 0}
                            >
                                {t('bulk.addToCampaign')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => analyzeMutation.mutate()}
                                disabled={analyzeMutation.isPending}
                            >
                                <Sparkle size={14} weight="fill" className="me-1" />
                                {t('bulk.reanalyze')}
                            </MyButton>
                        </div>
                    )}

                    {searchQuery.isLoading ? (
                        <LoadingBlock />
                    ) : searchQuery.isError ? (
                        <ErrorNotice onRetry={() => searchQuery.refetch()} />
                    ) : rows.length === 0 ? (
                        <EmptyBlock message={t('table.empty')} />
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                            <th className="w-8 py-2 pe-2">
                                                <Checkbox
                                                    checked={allOnPageSelected}
                                                    onCheckedChange={(c) =>
                                                        setSelected(
                                                            c === true
                                                                ? new Set(rows.map((r) => r.id))
                                                                : new Set()
                                                        )
                                                    }
                                                    aria-label={t('bulk.selectPage')}
                                                />
                                            </th>
                                            <th className="py-2 pe-3">{t('table.columns.time')}</th>
                                            <th className="py-2 pe-3">{t('table.columns.lead')}</th>
                                            <th className="py-2 pe-3">{t('table.columns.leadStatus')}</th>
                                            <th className="py-2 pe-3">{t('table.columns.direction')}</th>
                                            <th className="py-2 pe-3">{t('table.columns.type')}</th>
                                            <th className="py-2 pe-3">{t('table.columns.status')}</th>
                                            {canSeeCallHealth && (
                                                <th
                                                    className="py-2 pr-3"
                                                    title={t('table.columns.healthTooltip')}
                                                >
                                                    {t('table.columns.health')}
                                                </th>
                                            )}
                                            <th className="py-2 pe-3 text-end">
                                                {t('table.columns.duration')}
                                            </th>
                                            <th className="py-2 pe-3">
                                                {t('table.columns.counsellor')}
                                            </th>
                                            <th className="py-2 pe-3">
                                                {t('table.columns.disposition')}
                                            </th>
                                            <th className="py-2 pe-3" title={t('table.columns.scoresTooltip')}>
                                                {t('table.columns.scores')}
                                            </th>
                                            <th className="min-w-64 py-2 pe-3">
                                                {t('table.columns.update')}
                                            </th>
                                            <th className="py-2 pe-3" title={t('table.columns.actionsTooltip')}>
                                                {t('table.columns.actions')}
                                            </th>
                                            <th className="py-2 pe-3">
                                                {t('table.columns.recording')}
                                            </th>
                                            {intelEnabled && (
                                                <th className="py-2 pe-3">
                                                    {t('table.columns.ai')}
                                                </th>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r) => (
                                            <tr
                                                key={r.id}
                                                className={cn(
                                                    'border-b border-neutral-100 last:border-0 hover:bg-neutral-50',
                                                    selected.has(r.id) && 'bg-primary-50/40'
                                                )}
                                            >
                                                <td className="py-2.5 pe-2 align-top">
                                                    <Checkbox
                                                        checked={selected.has(r.id)}
                                                        onCheckedChange={() => toggleRow(r.id)}
                                                        aria-label={t('bulk.selectRow')}
                                                    />
                                                </td>
                                                <td className="whitespace-nowrap py-2.5 pr-3 text-neutral-600">
                                                    {fmtDateTime(r.start_time ?? r.created_at)}
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <div className="flex flex-col">
                                                        {/* callRowLeadUserId, not `r.user_id`: unlinked
                                                        calls store the literal 'UNKNOWN', which is
                                                        truthy — those rows used to offer a profile
                                                        link that opened an empty sheet. */}
                                                        {callRowLeadUserId(r) ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => void openLead(r)}
                                                                className="w-fit text-left font-medium text-primary-600 hover:underline"
                                                                title={t('table.openLeadProfile')}
                                                            >
                                                                {r.lead_name || t('table.viewLead')}
                                                            </button>
                                                        ) : (
                                                            <span className="font-medium text-neutral-900">
                                                                {r.lead_name || '—'}
                                                            </span>
                                                        )}
                                                        <span className="text-xs text-neutral-500">
                                                            {r.lead_number || '—'}
                                                        </span>
                                                        {r.ivr_selection && (
                                                            <span
                                                                className="mt-1 inline-flex w-fit items-center rounded-sm bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-700"
                                                                title={t('table.ivrOptionChosen')}
                                                            >
                                                                {r.ivr_selection}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    {r.response_id ? (
                                                        <LeadStatusSelect
                                                            responseId={r.response_id}
                                                            currentStatus={r.lead_status_key ?? r.lead_status_label ?? null}
                                                            statuses={leadStatuses}
                                                            onUpdated={refreshLists}
                                                            size="sm"
                                                        />
                                                    ) : (
                                                        <span className="text-xs text-neutral-400">—</span>
                                                    )}
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <DirectionBadge direction={r.direction} />
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <TypeBadge callType={r.call_type} />
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <StatusCell instituteId={instituteId} row={r} />
                                                </td>
                                                {canSeeCallHealth && (
                                                    <td className="py-2.5 pr-3">
                                                        <CallHealthCell
                                                            instituteId={instituteId}
                                                            row={r}
                                                            onOpen={() => setHealthTarget(r)}
                                                        />
                                                    </td>
                                                )}
                                                <td className="py-2.5 pr-3 text-right text-neutral-700">
                                                    {fmtDuration(r.duration_seconds)}
                                                </td>
                                                <td className="py-2.5 pr-3 text-neutral-700">
                                                    {r.counsellor_name || '—'}
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <DispositionCell
                                                        row={r}
                                                        labels={dispositionLabels}
                                                        onEdit={() => setDispositionTarget(r)}
                                                    />
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <ScoresCell row={r} />
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <UpdateCell row={r} onOpen={() => setIntelTarget(r)} />
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <ActionsCell row={r} />
                                                </td>
                                                <td className="py-2.5 pr-3">
                                                    <RecordingCell
                                                        instituteId={instituteId}
                                                        row={r}
                                                    />
                                                </td>
                                                {intelEnabled && (
                                                    <td className="py-2.5 pr-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => setIntelTarget(r)}
                                                            className="inline-flex items-center gap-1 rounded-md border border-primary-100 bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100"
                                                            title={t('intelligenceDialog.heading')}
                                                        >
                                                            <Sparkle size={14} weight="fill" />
                                                            {t('table.columns.ai')}
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {data && data.total_pages > 1 && (
                                <MyPagination
                                    currentPage={page}
                                    totalPages={data.total_pages}
                                    onPageChange={setPage}
                                />
                            )}
                        </>
                    )}
                </section>

                {/* Quick-disposition dialog */}
                <DispositionDialog
                    instituteId={instituteId}
                    call={dispositionTarget}
                    options={dispositions}
                    onClose={() => setDispositionTarget(null)}
                    onApplied={() => {
                        setDispositionTarget(null);
                        refreshLists();
                    }}
                />

                {/* Bulk dialogs */}
                <BulkLeadStatusDialog
                    open={bulkDialog === 'STATUS'}
                    onClose={() => setBulkDialog('NONE')}
                    statuses={leadStatuses}
                    count={selectedResponseIds.length}
                    onConfirm={async (statusId) => {
                        const res = await bulkSetLeadStatus(instituteId, [...selected], statusId);
                        setBulkDialog('NONE');
                        reportBulk(res, t('bulk.verbStatus'));
                    }}
                />
                <BulkDispositionDialog
                    open={bulkDialog === 'DISPOSITION'}
                    onClose={() => setBulkDialog('NONE')}
                    options={dispositions}
                    count={selected.size}
                    onConfirm={async (key, notes) => {
                        const res = await bulkSetDisposition(instituteId, [...selected], key, notes);
                        setBulkDialog('NONE');
                        reportBulk(res, t('bulk.verbDisposition'));
                    }}
                />
                <BulkAssignCounsellorDialog
                    open={bulkDialog === 'ASSIGN'}
                    onOpenChange={(o) => !o && setBulkDialog('NONE')}
                    instituteId={instituteId}
                    leads={selectedLeads}
                    counsellorOptions={counsellorOptions}
                    onSuccess={() => {
                        setBulkDialog('NONE');
                        setSelected(new Set());
                        refreshLists();
                    }}
                />
                <MigrateLeadsDialog
                    open={bulkDialog === 'CAMPAIGN'}
                    onOpenChange={(o) => !o && setBulkDialog('NONE')}
                    instituteId={instituteId}
                    responseIds={selectedResponseIds}
                    onSuccess={() => {
                        setSelected(new Set());
                        refreshLists();
                    }}
                />

                {/* Transcript + AI intelligence dialog (credits-gated) */}
                <CallIntelligenceDialog call={intelTarget} onClose={() => setIntelTarget(null)} />

                {/* Call health — technical post-mortem side sheet (admin-only) */}
                {canSeeCallHealth && (
                    <CallHealthSheet
                        instituteId={instituteId}
                        call={healthTarget}
                        onClose={() => setHealthTarget(null)}
                    />
                )}
            </div>

            {/* Shared lead side-sheet — opens to the Lead Profile tab. */}
            <StudentSidebar defaultLeadProfile />
        </SidebarProvider>
    );
}

// ── Disposition strip chip ─────────────────────────────────────────────────

function DispositionChip({
    item,
    active,
    onClick,
    notSetLabel,
}: {
    item: DispositionCount;
    active: boolean;
    onClick: () => void;
    notSetLabel: string;
}) {
    const isNone = !item.key;
    const label = isNone ? notSetLabel : item.label || humanizeCallStatus(item.key);
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={isNone}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                active
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : isNone
                      ? 'cursor-default border-neutral-200 bg-neutral-50 text-neutral-500'
                      : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
            )}
        >
            {item.color && !active && (
                // Colour is institute-authored catalog data, not a token — isolated here.
                <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                    aria-hidden
                />
            )}
            {label}
            <span
                className={cn(
                    'rounded-full px-1.5 text-caption tabular-nums',
                    active ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-600'
                )}
            >
                {fmtNumber(item.count)}
            </span>
        </button>
    );
}

// ── Intelligence columns ───────────────────────────────────────────────────

const SENTIMENT_TONE: Record<string, string> = {
    POSITIVE: 'bg-success-50 text-success-700',
    NEUTRAL: 'bg-neutral-100 text-neutral-600',
    NEGATIVE: 'bg-danger-50 text-danger-700',
};

/** Caller · Outcome · sentiment, compact — null when the call was never analysed. */
function ScoresCell({ row }: { row: CallRow }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    if (row.ci_status !== 'COMPLETED') {
        return <span className="text-xs text-neutral-400">—</span>;
    }
    const num = (v: number | null | undefined) =>
        v === null || v === undefined ? '–' : Number(v).toFixed(1).replace(/\.0$/, '');
    return (
        <div className="flex flex-col gap-0.5 text-xs">
            <span className="whitespace-nowrap text-neutral-700" title={t('scores.callerTooltip')}>
                {t('scores.caller')} <b className="tabular-nums">{num(row.ci_caller_rating)}</b>
            </span>
            <span className="whitespace-nowrap text-neutral-700" title={t('scores.outcomeTooltip')}>
                {t('scores.outcome')} <b className="tabular-nums">{num(row.ci_outcome_rating)}</b>
            </span>
            {row.ci_lead_sentiment && (
                <span
                    className={cn(
                        'w-fit rounded-full px-1.5 py-0.5 text-caption font-medium',
                        SENTIMENT_TONE[row.ci_lead_sentiment] ?? SENTIMENT_TONE.NEUTRAL
                    )}
                >
                    {t(`scores.sentiment.${row.ci_lead_sentiment.toLowerCase()}`)}
                </span>
            )}
        </div>
    );
}

/** The analysis' two-line update, or where the analysis is in its pipeline. */
function UpdateCell({ row, onOpen }: { row: CallRow; onOpen: () => void }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const status = row.ci_status;
    if (status === 'COMPLETED' && row.ci_short_update) {
        return (
            <button
                type="button"
                onClick={onOpen}
                className="line-clamp-2 max-w-sm text-left text-xs leading-snug text-neutral-700 hover:text-primary-700"
                title={t('update.openFull')}
            >
                {row.ci_short_update}
            </button>
        );
    }
    if (status === 'COMPLETED') {
        // Analysed before the two-line update existed (schema < 1.1).
        return (
            <button type="button" onClick={onOpen} className="text-xs text-primary-600 hover:underline">
                {t('update.viewAnalysis')}
            </button>
        );
    }
    if (status === 'PENDING' || status === 'TRANSCRIBING' || status === 'ANALYZING') {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                <ArrowsClockwise size={12} className="animate-spin" />
                {t('update.inProgress')}
            </span>
        );
    }
    if (status === 'FAILED') {
        return <span className="text-xs text-danger-600">{t('update.failed')}</span>;
    }
    if (status === 'SKIPPED') {
        return <span className="text-xs text-neutral-400">{t('update.skipped')}</span>;
    }
    return <span className="text-xs text-neutral-400">—</span>;
}

/** What happened in the call besides talking: sends, call-back, transfer. */
function ActionsCell({ row }: { row: CallRow }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const items: { key: string; icon: React.ReactNode; label: string; tone: string }[] = [];
    if ((row.sends_total ?? 0) > 0) {
        const sent = row.sends_sent ?? 0;
        const total = row.sends_total ?? 0;
        items.push({
            key: 'wa',
            icon: <WhatsappLogo size={14} weight="fill" />,
            label: sent === total ? t('actions.sent', { count: sent }) : t('actions.sentOf', { sent, total }),
            tone: sent === total ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700',
        });
    }
    if (row.ai_callback || row.callback_at) {
        items.push({
            key: 'cb',
            icon: <ClockCounterClockwise size={14} />,
            label: t('actions.callback'),
            tone: 'bg-primary-50 text-primary-700',
        });
    }
    if (row.transferred) {
        items.push({
            key: 'tr',
            icon: <ArrowBendUpRight size={14} />,
            label: t('actions.transferred'),
            tone: 'bg-neutral-100 text-neutral-700',
        });
    }
    if (items.length === 0) return <span className="text-xs text-neutral-400">—</span>;
    return (
        <div className="flex flex-wrap gap-1">
            {items.map((i) => (
                <span
                    key={i.key}
                    className={cn(
                        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-medium',
                        i.tone
                    )}
                >
                    {i.icon}
                    {i.label}
                </span>
            ))}
        </div>
    );
}

// ── Bulk dialogs ───────────────────────────────────────────────────────────

function BulkLeadStatusDialog({
    open,
    onClose,
    statuses,
    count,
    onConfirm,
}: {
    open: boolean;
    onClose: () => void;
    statuses: { id: string; label: string; color: string }[];
    count: number;
    onConfirm: (statusId: string) => Promise<void>;
}) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const [statusId, setStatusId] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) setStatusId('');
    }, [open]);
    return (
        <MyDialog
            heading={t('bulkStatusDialog.heading', { count })}
            open={open}
            onOpenChange={(o) => {
                if (!o) onClose();
            }}
            footer={
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    disabled={!statusId || busy}
                    onClick={async () => {
                        setBusy(true);
                        try {
                            await onConfirm(statusId);
                        } catch {
                            toast.error(t('bulk.error'));
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    {t('bulkStatusDialog.apply')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-3 py-2">
                <Label className="text-xs text-neutral-600">{t('bulkStatusDialog.status')}</Label>
                <div className="flex flex-wrap gap-2">
                    {statuses.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => setStatusId(s.id)}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                                statusId === s.id
                                    ? 'border-primary-500 bg-primary-50 text-primary-800'
                                    : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                            )}
                        >
                            {/* Lead-status colour is institute-authored data, not a token. */}
                            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.label}
                        </button>
                    ))}
                    {statuses.length === 0 && (
                        <span className="text-xs text-neutral-500">{t('bulkStatusDialog.none')}</span>
                    )}
                </div>
            </div>
        </MyDialog>
    );
}

function BulkDispositionDialog({
    open,
    onClose,
    options,
    count,
    onConfirm,
}: {
    open: boolean;
    onClose: () => void;
    options: DispositionOption[];
    count: number;
    onConfirm: (dispositionKey: string, notes?: string) => Promise<void>;
}) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const [key, setKey] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) {
            setKey('');
            setNotes('');
        }
    }, [open]);
    return (
        <MyDialog
            heading={t('bulkDispositionDialog.heading', { count })}
            open={open}
            onOpenChange={(o) => {
                if (!o) onClose();
            }}
            footer={
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    disabled={!key || busy}
                    onClick={async () => {
                        setBusy(true);
                        try {
                            await onConfirm(key, notes.trim() || undefined);
                        } catch {
                            toast.error(t('bulk.error'));
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    {t('dispositionDialog.save')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-3 py-2">
                <Label className="text-xs text-neutral-600">{t('dispositionDialog.outcome')}</Label>
                <div className="flex flex-wrap gap-2">
                    {options.map((o) => (
                        <button
                            key={o.disposition_key}
                            type="button"
                            onClick={() => setKey(o.disposition_key)}
                            className={cn(
                                'rounded-full border px-3 py-1 text-sm',
                                key === o.disposition_key
                                    ? 'border-primary-500 bg-primary-50 text-primary-800'
                                    : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                            )}
                        >
                            {o.label}
                        </button>
                    ))}
                    {options.length === 0 && (
                        <span className="text-xs text-neutral-500">{t('dispositionDialog.noOutcomes')}</span>
                    )}
                </div>
                <Label className="text-xs text-neutral-600">{t('dispositionDialog.notes')}</Label>
                <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('dispositionDialog.notesPlaceholder')}
                />
            </div>
        </MyDialog>
    );
}

// ── Worklist chip ──────────────────────────────────────────────────────────

function ChipToggle({
    active,
    onClick,
    label,
    count,
    tone = 'neutral',
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    count?: number;
    tone?: 'neutral' | 'danger' | 'warning';
}) {
    const badgeTone =
        tone === 'danger'
            ? 'bg-danger-100 text-danger-700'
            : tone === 'warning'
              ? 'bg-warning-100 text-warning-700'
              : 'bg-neutral-200 text-neutral-700';
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                active
                    ? 'border-primary-500 bg-primary-50 text-primary-600'
                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            )}
        >
            {label}
            {count != null && count > 0 && (
                <span className={cn('rounded-full px-1.5 text-xs font-semibold', badgeTone)}>
                    {count}
                </span>
            )}
        </button>
    );
}

// ── Filter controls ────────────────────────────────────────────────────────

function FilterText({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) {
    return (
        <div className="flex flex-col gap-1">
            <Label className="text-xs text-neutral-600">{label}</Label>
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="h-9 w-40"
            />
        </div>
    );
}

function FilterSelect({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
}) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    return (
        <div className="flex flex-col gap-1">
            <Label className="text-xs text-neutral-600">{label}</Label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="h-9 w-40 bg-white">
                    <SelectValue placeholder={t('filters.all')} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
                    {options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

/**
 * Multi-select sibling of {@link FilterSelect} — same caption-above-control shape,
 * but the control is the shared CRM combobox: type-to-search plus as many outcomes
 * as the user wants in one query. Empty selection = no filter, exactly like `ALL`.
 */
function FilterMultiSelect({
    label,
    selected,
    onChange,
    options,
}: {
    label: string;
    selected: string[];
    onChange: (v: string[]) => void;
    options: Array<{ value: string; label: string }>;
}) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    return (
        <div className="flex flex-col gap-1">
            <Label className="text-xs text-neutral-600">{label}</Label>
            <MultiSelectFilter
                label={t('filters.all')}
                options={options}
                selected={selected}
                onChange={onChange}
                placeholder={t('filters.searchPlaceholder', { label: label.toLowerCase() })}
                // twMerge lets these win over the component's default h-10 / w-44,
                // so the trigger lines up with the FilterSelect boxes beside it.
                widthClass="h-9 w-40"
                showSelectedLabel
            />
        </div>
    );
}

// ── Cell renderers ─────────────────────────────────────────────────────────

function DirectionBadge({ direction }: { direction: string }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const inbound = direction === 'INBOUND';
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                inbound ? 'bg-info-50 text-info-700' : 'bg-neutral-100 text-neutral-600'
            )}
        >
            {inbound ? (
                <PhoneIncoming size={12} weight="bold" />
            ) : (
                <PhoneOutgoing size={12} weight="bold" />
            )}
            {inbound ? t('directionBadge.in') : t('directionBadge.out')}
        </span>
    );
}

function TypeBadge({ callType }: { callType: 'AI' | 'HUMAN' }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const ai = callType === 'AI';
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                ai ? 'bg-primary-50 text-primary-600' : 'bg-neutral-100 text-neutral-600'
            )}
        >
            {ai ? <Robot size={12} weight="bold" /> : <User size={12} weight="bold" />}
            {ai ? t('typeBadge.ai') : t('typeBadge.human')}
        </span>
    );
}

function CallStatusPill({ status }: { status: string }) {
    return (
        <span
            className={cn(
                'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
                STATUS_TONE[status] ?? 'bg-neutral-100 text-neutral-600'
            )}
        >
            {humanizeCallStatus(status)}
        </span>
    );
}

function humanizeProvider(t: TFunction, p: string | null | undefined): string {
    if (!p) return '—';
    return buildProviderOptions(t).find((o) => o.value === p)?.label ?? p;
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-3 text-xs">
            <span className="shrink-0 text-neutral-500">{label}</span>
            <span className="text-right font-medium text-neutral-700">{value}</span>
        </div>
    );
}

/**
 * Status pill that, for calls that didn't simply complete (FAILED / BUSY /
 * NO_ANSWER / CANCELLED), doubles as a "why" affordance: clicking opens a popover
 * that lazily loads the deep detail (provider hangup/cause/error, price, timing).
 */
function StatusCell({ instituteId, row }: { instituteId: string; row: CallRow }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const [open, setOpen] = useState(false);
    const detailable = isDetailable(row);

    const detailQuery = useQuery({
        queryKey: callDetailKey(instituteId, row.id),
        queryFn: () => fetchCallDetail(instituteId, row.id),
        enabled: open && detailable,
        staleTime: 60_000,
        retry: false,
    });

    if (!detailable) return <CallStatusPill status={row.status} />;

    const d = detailQuery.data;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full hover:opacity-80"
                    title={t('statusDetail.whyEnded')}
                >
                    <CallStatusPill status={row.status} />
                    <Info size={14} className="text-neutral-400" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <CallStatusPill status={row.status} />
                    <span className="text-xs text-neutral-500">
                        {fmtDateTime(row.start_time ?? row.created_at)}
                    </span>
                </div>
                {detailQuery.isLoading ? (
                    <p className="text-xs text-neutral-500">{t('statusDetail.loading')}</p>
                ) : detailQuery.isError ? (
                    <p className="text-xs text-neutral-500">
                        {row.termination_reason
                            ? t('statusDetail.reasonPrefix', { reason: row.termination_reason })
                            : t('statusDetail.noDetail')}
                    </p>
                ) : d ? (
                    <div className="flex flex-col gap-1.5">
                        <DetailRow
                            label={t('statusDetail.reason')}
                            value={d.termination_reason || row.termination_reason || '—'}
                        />
                        <DetailRow
                            label={t('statusDetail.provider')}
                            value={humanizeProvider(t, d.provider_type)}
                        />
                        {d.provider_details.map((kv, i) => (
                            <DetailRow key={i} label={kv.label} value={kv.value} />
                        ))}
                        <DetailRow
                            label={t('statusDetail.attempted')}
                            value={fmtDateTime(d.start_time)}
                        />
                        <DetailRow
                            label={t('statusDetail.answered')}
                            value={d.answer_time ? fmtDateTime(d.answer_time) : '—'}
                        />
                        <DetailRow
                            label={t('statusDetail.duration')}
                            value={fmtDuration(d.duration_seconds)}
                        />
                        {d.price != null && (
                            <DetailRow label={t('statusDetail.cost')} value={String(d.price)} />
                        )}
                        {d.raw_provider_response && (
                            <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-primary-600">
                                    {t('statusDetail.viewRawResponse')}
                                </summary>
                                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-caption text-neutral-600">
                                    {d.raw_provider_response}
                                </pre>
                            </details>
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-neutral-500">{t('statusDetail.noDetail')}</p>
                )}
            </PopoverContent>
        </Popover>
    );
}

function DispositionCell({
    row,
    labels,
    onEdit,
}: {
    row: CallRow;
    /** Normalized outcome key → vocabulary label, so the cell reads like the filter. */
    labels: Map<string, string>;
    onEdit: () => void;
}) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    // Human-set disposition takes precedence; otherwise show the AI disposition (read-only).
    const current = row.disposition_key || row.ai_disposition;
    // Same normalization the filter matches on, so "Not_Interested" and
    // "NOT_INTERESTED" render as the one option the dropdown offers.
    const label = current
        ? labels.get(normalizeDispositionKey(current)) ?? humanizeCallStatus(current)
        : null;
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                {label ? (
                    <span className="inline-flex whitespace-nowrap rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                        {label}
                    </span>
                ) : (
                    <span className="text-xs text-neutral-400">—</span>
                )}
                <MyButton buttonType="text" scale="small" onClick={onEdit}>
                    {row.disposition_key ? t('disposition.edit') : t('disposition.set')}
                </MyButton>
            </div>
            <CallFollowUp row={row} />
        </div>
    );
}

/**
 * The counsellor's one-sentence answer to "do I call this lead myself?", directly
 * under the disposition: the recommendation and the concrete reason from the
 * call — "Worth a call — runs a 50-member hybrid studio, asked about pricing."
 *
 * The SENTENCE is the product. followUp (CALL / CALL_LATER / SKIP) only colours
 * it and gives it a leading dot; it is deliberately never rendered as a word,
 * because a one-word label is exactly what the disposition already is and it
 * tells a human nothing about what happened on the call or what to do next.
 *
 * Renders NOTHING when the call was not assessed. A human call, an older bot, or
 * a call the caller never spoke on carries no recommendation, and an empty cell
 * is the honest rendering of "not assessed" — never a grey "fine", and never a
 * colour standing in for a verdict that was not given. The one exception is a
 * gist with no level (the bot's own "Nothing to go on — …" on a gated call),
 * which renders in neutral so the counsellor still sees why.
 */
const FOLLOW_UP_STYLE: Record<FollowUp, { dot: string; text: string; titleKey: string }> = {
    CALL: {
        dot: 'bg-success-500',
        text: 'text-success-700',
        titleKey: 'followUp.titleCall',
    },
    CALL_LATER: {
        dot: 'bg-warning-500',
        text: 'text-warning-700',
        titleKey: 'followUp.titleCallLater',
    },
    SKIP: {
        dot: 'bg-neutral-400',
        text: 'text-neutral-500',
        titleKey: 'followUp.titleSkip',
    },
};

function CallFollowUp({ row }: { row: CallRow }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const level = rowFollowUp(row);
    const gist = rowFollowUpGist(row);
    if (!gist) return null;
    const style = level ? FOLLOW_UP_STYLE[level] : null;
    return (
        <div
            className="flex max-w-sm items-start gap-1.5"
            title={style ? `${t(style.titleKey)} — ${gist}` : gist}
        >
            <span
                aria-hidden="true"
                className={`mt-[5px] size-1.5 shrink-0 rounded-full ${style ? style.dot : 'bg-neutral-300'}`}
            />
            <span
                className={`line-clamp-2 text-caption leading-snug ${style ? style.text : 'text-neutral-500'}`}
            >
                {gist}
            </span>
        </div>
    );
}

function RecordingCell({ instituteId, row }: { instituteId: string; row: CallRow }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    if (!row.has_recording) return <span className="text-xs text-neutral-400">—</span>;
    if (url) return <audio controls src={url} className="h-8 w-44" />;

    const load = async () => {
        setLoading(true);
        setFailed(false);
        try {
            const u = await fetchRecordingUrl(instituteId, row.id);
            if (u) setUrl(u);
            else setFailed(true);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    return (
        <MyButton buttonType="secondary" scale="small" onClick={load} disable={loading}>
            <span className="flex items-center gap-1.5">
                <Waveform size={14} weight="fill" />
                {loading ? t('recording.loading') : failed ? t('common.retry') : t('recording.play')}
            </span>
        </MyButton>
    );
}

// ── Export ─────────────────────────────────────────────────────────────────

function ExportButton({
    scope,
    filters,
    disabled,
}: {
    scope: CallLogScope;
    filters: CallLogFilters;
    disabled: boolean;
}) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const run = async (format: 'csv' | 'xlsx') => {
        try {
            await exportCallLog(scope, filters, format);
            toast.success(t('export.successToast', { format: format.toUpperCase() }));
        } catch {
            toast.error(t('export.errorToast'));
        }
    };
    return (
        <div className="flex items-center gap-2">
            <MyButton
                buttonType="secondary"
                scale="small"
                onAsyncClick={() => run('csv')}
                disable={disabled}
            >
                <span className="flex items-center gap-1.5">
                    <DownloadSimple size={14} />
                    {t('export.csv')}
                </span>
            </MyButton>
            <MyButton
                buttonType="secondary"
                scale="small"
                onAsyncClick={() => run('xlsx')}
                disable={disabled}
            >
                <span className="flex items-center gap-1.5">
                    <DownloadSimple size={14} />
                    {t('export.excel')}
                </span>
            </MyButton>
        </div>
    );
}

// ── Quick-disposition dialog ───────────────────────────────────────────────

function DispositionDialog({
    instituteId,
    call,
    options,
    onClose,
    onApplied,
}: {
    instituteId: string;
    call: CallRow | null;
    options: DispositionOption[];
    onClose: () => void;
    onApplied: () => void;
}) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const [selected, setSelected] = useState<string>('');
    const [notes, setNotes] = useState('');
    const [callbackAt, setCallbackAt] = useState('');

    useEffect(() => {
        setSelected(call?.disposition_key ?? '');
        setNotes(call?.disposition_notes ?? '');
        setCallbackAt('');
    }, [call]);

    const selectedOption = options.find((o) => o.disposition_key === selected);
    const isCallback = selectedOption?.category === 'CALLBACK';

    const mutation = useMutation({
        mutationFn: () => {
            const ms = isCallback && callbackAt ? new Date(callbackAt).getTime() : null;
            return applyDisposition(instituteId, call!.id, selected, notes, ms);
        },
        onSuccess: (res) => {
            toast.success(
                res.lead_status_synced
                    ? t('dispositionDialog.savedStatusUpdated')
                    : t('dispositionDialog.saved')
            );
            onApplied();
        },
        onError: () => toast.error(t('dispositionDialog.saveError')),
    });

    return (
        <MyDialog
            heading={t('dispositionDialog.heading')}
            open={!!call}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            footer={
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    disable={!selected || mutation.isPending}
                    onAsyncClick={async () => {
                        await mutation.mutateAsync();
                    }}
                >
                    {t('dispositionDialog.save')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-4">
                {call && (
                    <p className="text-sm text-neutral-600">
                        {call.lead_name || t('common.leadFallback')} ·{' '}
                        {fmtDuration(call.duration_seconds)} · {humanizeCallStatus(call.status)}
                    </p>
                )}
                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-neutral-600">
                        {t('dispositionDialog.outcome')}
                    </Label>
                    <div className="flex flex-wrap gap-2">
                        {options.map((o) => (
                            <button
                                key={o.id}
                                type="button"
                                onClick={() => setSelected(o.disposition_key)}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                                    selected === o.disposition_key
                                        ? 'border-primary-500 bg-primary-50 text-primary-600'
                                        : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                                )}
                            >
                                {o.label}
                                {o.maps_to_lead_status && (
                                    <span className="text-xs text-neutral-400">
                                        {t('dispositionDialog.mapsToStatus')}
                                    </span>
                                )}
                            </button>
                        ))}
                        {options.length === 0 && (
                            <span className="text-sm text-neutral-400">
                                {t('dispositionDialog.noOutcomes')}
                            </span>
                        )}
                    </div>
                </div>
                {isCallback && (
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs text-neutral-600">
                            {t('dispositionDialog.callbackAt')}
                        </Label>
                        <Input
                            type="datetime-local"
                            value={callbackAt}
                            onChange={(e) => setCallbackAt(e.target.value)}
                            className="h-9 w-60"
                        />
                    </div>
                )}
                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-neutral-600">
                        {t('dispositionDialog.notes')}
                    </Label>
                    <Input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={t('dispositionDialog.notesPlaceholder')}
                        className="h-9"
                    />
                </div>
            </div>
        </MyDialog>
    );
}

// ── Transcript + AI intelligence dialog (credits-gated) ─────────────────────

/**
 * Hosts the shared {@link CallIntelligencePanel} in a dialog and gates every
 * analyze/re-analyze behind a credits-cost confirmation. Call Intelligence is
 * billed per analyzed call (re-analyzing the same call is idempotent — never
 * charged twice), so we fetch a live estimate + the institute balance and show
 * {@link ToolCostConfirmDialog} before the pipeline is triggered.
 */
function CallIntelligenceDialog({ call, onClose }: { call: CallRow | null; onClose: () => void }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    const [confirmData, setConfirmData] = useState<{
        credits: number | null;
        currentBalance: number | null;
        balanceAfter: number | null;
        sufficient: boolean | null;
    } | null>(null);
    const resolverRef = useRef<((v: boolean) => void) | null>(null);

    const settle = (v: boolean) => {
        const resolve = resolverRef.current;
        resolverRef.current = null;
        setConfirmData(null);
        resolve?.(v);
    };

    const confirmBeforeAnalyze = () =>
        new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
            void (async () => {
                try {
                    const est = await fetchCreditEstimate('call_intelligence');
                    setConfirmData({
                        credits: est.estimated_cost ?? null,
                        currentBalance: est.current_balance ?? null,
                        balanceAfter: est.balance_after ?? null,
                        sufficient: est.has_sufficient_credits ?? null,
                    });
                } catch {
                    // Estimate endpoint unavailable — still ask for explicit confirmation,
                    // just without the exact number.
                    setConfirmData({
                        credits: null,
                        currentBalance: null,
                        balanceAfter: null,
                        sufficient: null,
                    });
                }
            })();
        });

    return (
        <>
            <MyDialog
                heading={t('intelligenceDialog.heading')}
                open={!!call}
                onOpenChange={(o) => {
                    if (!o) onClose();
                }}
                dialogWidth="max-w-lg"
            >
                {call && (
                    <div className="flex flex-col gap-3">
                        <p className="text-sm text-neutral-600">
                            {call.lead_name || t('common.leadFallback')} ·{' '}
                            {fmtDuration(call.duration_seconds)} ·{' '}
                            {humanizeCallStatus(call.status)}
                        </p>
                        <CallIntelligencePanel
                            callLogId={call.id}
                            defaultExpanded
                            confirmBeforeAnalyze={confirmBeforeAnalyze}
                        />
                    </div>
                )}
            </MyDialog>

            <ToolCostConfirmDialog
                open={!!confirmData}
                onOpenChange={(o) => {
                    if (!o) settle(false);
                }}
                credits={confirmData?.credits ?? null}
                currentBalance={confirmData?.currentBalance ?? null}
                balanceAfter={confirmData?.balanceAfter ?? null}
                sufficient={confirmData?.sufficient ?? null}
                onConfirm={() => settle(true)}
                heading={t('intelligenceDialog.analyzeHeading')}
                confirmLabel={t('intelligenceDialog.analyzeConfirm')}
            />
        </>
    );
}

// ── Shared states / KPI ────────────────────────────────────────────────────

interface KpiStatProps {
    label: string;
    value: string;
    sub?: string;
    tone: 'primary' | 'success' | 'info' | 'warning' | 'default';
    loading?: boolean;
}
function KpiStat({ label, value, sub, tone, loading }: KpiStatProps) {
    const toneClass: Record<KpiStatProps['tone'], string> = {
        primary: 'text-primary-600',
        success: 'text-success-700',
        info: 'text-info-700',
        warning: 'text-warning-700',
        default: 'text-neutral-900',
    };
    return (
        <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                {label}
            </span>
            {loading ? (
                <span className="h-7 w-20 animate-pulse rounded bg-neutral-100" />
            ) : (
                <span className={cn('text-2xl font-bold tracking-tight', toneClass[tone])}>
                    {value}
                </span>
            )}
            {sub && <span className="text-xs text-neutral-500">{sub}</span>}
        </div>
    );
}

function DeployPendingNotice() {
    const { t } = useTranslation('audienceManagerCallLogTab');
    return (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center">
            <WarningCircle size={28} className="text-neutral-400" />
            <p className="text-sm font-medium text-neutral-700">{t('deployPending.title')}</p>
            <p className="max-w-md text-xs text-neutral-500">{t('deployPending.description')}</p>
        </div>
    );
}

function ErrorNotice({ onRetry }: { onRetry: () => void }) {
    const { t } = useTranslation('audienceManagerCallLogTab');
    return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
            <WarningCircle size={24} className="text-danger-500" />
            <p className="text-sm text-neutral-600">{t('error.loadFailed')}</p>
            <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                <span className="flex items-center gap-2">
                    <ArrowsClockwise size={14} />
                    {t('common.retry')}
                </span>
            </MyButton>
        </div>
    );
}

function LoadingBlock() {
    return <div className="h-64 animate-pulse rounded-lg bg-neutral-100" />;
}

function EmptyBlock({ message }: { message: string }) {
    return (
        <div className="flex h-32 items-center justify-center text-sm text-neutral-400">
            {message}
        </div>
    );
}
