/**
 * Call Log tab data layer — the operational, row-level call list (every call,
 * AI + human, inbound + outbound, every provider) for the CRM Reports Center.
 *
 * Backed by the telephony dashboard endpoints (admin-core-service):
 *   POST /v1/telephony/calls/search        — paginated, RBAC-scoped, filtered
 *   POST /v1/telephony/calls/metrics       — KPI strip + worklist chip badges
 *   GET  /v1/telephony/calls/dispositions  — call-outcome catalog (picker; settable only)
 *   GET  /v1/telephony/calls/dispositions/options — full filter vocabulary (catalog + AI)
 *   POST /v1/telephony/calls/{id}/disposition — set a call's outcome
 *   POST /v1/telephony/calls/export        — CSV/XLSX blob
 *   GET  /v1/telephony/calls/{id}/recording — presigned recording URL
 *
 * Request/response payloads are snake_case (backend @JsonNaming contract). The
 * search endpoint returns a Spring Page (camelCase envelope) whose `content`
 * rows are snake_case — adapted here into the MyTable/MyPagination page shape.
 */
import { isAxiosError } from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

const CALLS_BASE = `${BASE_URL}/admin-core-service/v1/telephony/calls`;

// ── Shared scope (from the Reports shell) ──────────────────────────────────

export interface CallLogScope {
    instituteId: string;
    /** yyyy-MM-dd (inclusive). */
    fromDate: string;
    /** yyyy-MM-dd (inclusive). */
    toDate: string;
    /** Optional instant window (epoch millis, UTC) — the "last 1h / 3h / 24h" presets.
     *  When set it overrides fromDate/toDate on the server. toTs omitted = now. */
    fromTs?: number;
    toTs?: number;
    teamId?: string;
    counsellorUserId?: string;
}

/** Tab-local filters layered on top of the shared scope. */
export interface CallLogFilters {
    direction?: 'INBOUND' | 'OUTBOUND';
    callType?: 'AI' | 'HUMAN';
    providerType?: string;
    statuses?: string[];
    dispositionKeys?: string[];
    fromNumber?: string;
    toNumber?: string;
    leadName?: string;
    hasRecording?: boolean;
    missedInbound?: boolean;
    callbacksDue?: boolean;
    sortBy?: 'TIME' | 'DURATION' | 'STATUS';
    sortDirection?: 'ASC' | 'DESC';
}

/** Build the snake_case search/metrics/export request body. */
function buildSearchBody(scope: CallLogScope, f: CallLogFilters, page?: number, size?: number) {
    return {
        institute_id: scope.instituteId,
        from_date: scope.fromDate,
        to_date: scope.toDate,
        from_ts: scope.fromTs,
        to_ts: scope.toTs,
        team_id: scope.teamId,
        counsellor_user_id: scope.counsellorUserId,
        direction: f.direction,
        call_type: f.callType,
        provider_type: f.providerType,
        statuses: f.statuses && f.statuses.length ? f.statuses : undefined,
        disposition_keys:
            f.dispositionKeys && f.dispositionKeys.length ? f.dispositionKeys : undefined,
        from_number: f.fromNumber || undefined,
        to_number: f.toNumber || undefined,
        lead_name: f.leadName || undefined,
        has_recording: f.hasRecording,
        missed_inbound: f.missedInbound,
        callbacks_due: f.callbacksDue,
        sort_by: f.sortBy,
        sort_direction: f.sortDirection,
        page,
        size,
    };
}

// ── Per-call technical diagnostics (voice-bot contract, rulesVersion 1) ─────

export type CallHealth = 'GREEN' | 'AMBER' | 'RED';
/** A fault never fires GREEN — it is either a warning or a breakage. */
export type CallFaultLevel = 'AMBER' | 'RED';

/**
 * The fault vocabulary is CLOSED and APPEND-ONLY — it mirrors
 * `voice_bot_service/app/diagnostics.py` (ALL_FAULTS), which is the source of
 * truth. Renaming a code silently breaks every call already stored, so codes are
 * only ever added. The order here is also the bot's HEADLINE_PRIORITY, i.e. the
 * order faults must be shown in.
 */
// A code missing here renders as "Unrecognised fault code" in the sheet — which
// is exactly what REPLY_LOOP did on call 597aeb3f, because it shipped in the bot
// and not here.
//
// ORDER IS THE CONTRACT, and it had silently drifted: this list used to open
// CRASH, TTS_WEDGE, REPLY_UNPLAYED… while the bot's HEADLINE_PRIORITY opens
// CRASH, BOT_SILENT, STT_DEAF… so the two sides disagreed from index 1. A call
// with BOT_SILENT + TTS_WEDGE showed "Voice synthesis stalled" here and "The
// agent never spoke" in the bot's own headline — precisely the inversion the
// BOT_SILENT and STT_DEAF comments in diagnostics.py exist to prevent. Kept in
// lockstep now by test_fe_fault_list_matches_headline_priority (python suite),
// which parses THIS array.
export const CALL_FAULT_CODES = [
    'CRASH',
    'BOT_SILENT',
    'STT_DEAF',
    'CALLER_IGNORED',
    'REPLY_LOOP',
    'OPENING_REPLAYED',
    'HANDBACK_LOOP',
    'REPEATED_LINE',
    'TTS_WEDGE',
    'REPLY_UNPLAYED',
    'ANSWER_DELETED',
    'DEAD_AIR',
    'FALSE_REASK',
    'LIKELY_MACHINE',
    'SLOW_TTS',
    'SLOW_LLM',
    'TRANSFER_FAILED',
    'PROMPT_UNFILLED',
] as const;
export type CallFaultCode = (typeof CALL_FAULT_CODES)[number];

/**
 * Verbatim `diagnostics` blob the voice bot posts with its end-of-call report
 * (see `voice_bot_service/app/diagnostics.py::to_payload`). camelCase inside —
 * it is stored and re-served exactly as the bot produced it, not re-serialized
 * through the snake_case telephony contract.
 *
 * EVERY field is optional: a call recorded before this shipped, or by a bot
 * version that predates a key, simply omits it, and the UI must degrade to
 * "not reported" rather than inventing a value. In particular
 * `turnTaking.answersDeleted === null` means NOT MEASURED and must never be
 * rendered as 0 — see the honesty note in the bot module's docstring.
 */
export interface CallDiagnostics {
    rulesVersion?: number | null;
    health?: CallHealth | null;
    /** Sorted fault codes. Unknown (newer-bot) codes may appear — render them raw. */
    faults?: string[] | null;
    faultLevels?: Record<string, CallFaultLevel> | null;
    headline?: string | null;
    headlineText?: string | null;
    tts?: {
        letterlessSkipped?: number | null;
        wedges?: number | null;
        wedgeReconnects?: number | null;
        stalls?: number | null;
        stallCapHit?: boolean | null;
        silentGenerations?: number | null;
        ttfbP50?: number | null;
        ttfbP95?: number | null;
        ttfbMax?: number | null;
        /** Speech cache. null (never 0) means the cache was off or unreadable,
         *  i.e. NOT MEASURED — render it that way, the same discipline the bot
         *  applies to every other signal in this blob. */
        cacheHits?: number | null;
        cacheMisses?: number | null;
        cacheCharsSaved?: number | null;
        cacheSecsSaved?: number | null;
        cacheHitRate?: number | null;
    } | null;
    playout?: {
        repliesGenerated?: number | null;
        repliesNeverPlayed?: number | null;
    } | null;
    turnTaking?: {
        userTurns?: number | null;
        botTurns?: number | null;
        bargeIns?: number | null;
        orphanReasks?: number | null;
        orphanFalseReasks?: number | null;
        /** Longest run of bot turns that began the same way (REPLY_LOOP). */
        maxReplyRestarts?: number | null;
        /** Sentences dropped because the bot had already said them this call. */
        repeatsSuppressed?: number | null;
        /** Opening clauses dropped because they only parroted the caller's answer back. */
        echoesTrimmed?: number | null;
        /**
         * Turns where the WHOLE reply was suppressed as already-said, so the caller
         * got a content-free "you talk" line instead of an answer. Drives
         * HANDBACK_LOOP. Absent on rows written before rules v3.
         */
        handbacks?: number | null;
        /**
         * Caller turns the agent swallowed while waiting for an opening it then
         * never said (CALLER_IGNORED). Absent on rows written before rules v7.
         */
        swallowedTurns?: number | null;
        /** Times a repeat was said anyway rather than hand back twice running. */
        repeatEscalations?: number | null;
        /** The opening said again after the caller had already spoken (OPENING_REPLAYED). */
        openingReplays?: number | null;
        /** 5+-word sentences played twice without the caller asking (REPEATED_LINE). */
        repeatedLines?: number | null;
        repeatedLineSamples?: string[] | null;
        /** Operator/voicemail lines filtered out of the agent's context. */
        carrierAnnouncements?: number | null;
        nudges?: number | null;
        idleHangup?: boolean | null;
        capFarewell?: boolean | null;
        /** null = NOT MEASURED. Never render as 0. */
        answersDeleted?: number | null;
        /** The discarded caller answers, verbatim (bounded to 20 by the bot). */
        answersDeletedSamples?: string[] | null;
        answersDeletedSrc?: 'measured' | null;
        /**
         * Lost the same way, but a part-word scrap ("वो।") rather than an answer —
         * rules v3 stopped counting these as `answersDeleted`, because one of them
         * turned a healthy call AMBER and claimed an answer had gone missing.
         * Evidence only: it fires no fault. Absent on rows written before v3.
         */
        fragmentsLost?: number | null;
        fragmentsLostSamples?: string[] | null;
    } | null;
    latency?: {
        llmTtfbP50?: number | null;
        llmTtfbP95?: number | null;
        sttTtfbP50?: number | null;
        sttTtfbP95?: number | null;
        deadAirP95?: number | null;
        deadAirMax?: number | null;
    } | null;
    setup?: {
        greetPath?: string | null;
        greetDelaySecs?: number | null;
        setupSecs?: number | null;
    } | null;
    machine?: {
        score?: number | null;
        markers?: string[] | null;
        firstUserSecs?: number | null;
        longestUserSecs?: number | null;
        /** Always "inferred" in v1 — this is a heuristic, not a measurement. */
        src?: 'inferred' | null;
    } | null;
    infra?: {
        sttReconnects?: number | null;
        promptUnfilled?: string[] | null;
        crash?: string | null;
        transferRequested?: boolean | null;
        transferRegistered?: boolean | null;
    } | null;
    /** Set (with health = null) when the bot's own payload build failed. */
    error?: string | null;
}

/**
 * The non-sensitive summary of a verdict: `CallDetailDTO.diagHealth/diagFaults`,
 * which the backend serves to every dashboard viewer (the full blob is gated —
 * see {@link CallDetail.diagnostics}). Snake_case on the wire like the rest of
 * the telephony contract; the camelCase spellings are accepted too so the UI
 * doesn't silently read "not reported" if a payload ever lands unconverted.
 *
 * Declared on {@link CallRow} as well, even though the search DTO does not carry
 * them today: the list reads them opportunistically, so the day the row gains a
 * verdict the dots light up with no frontend change, and until then the row
 * simply says "not reported" rather than guessing.
 */
export interface CallHealthFields {
    diag_health?: CallHealth | null;
    diagHealth?: CallHealth | null;
    diag_faults?: string[] | null;
    diagFaults?: string[] | null;
}

export function rowCallHealth(row: CallHealthFields): CallHealth | null {
    return row.diag_health ?? row.diagHealth ?? null;
}

export function rowCallFaults(row: CallHealthFields): string[] {
    const faults = row.diag_faults ?? row.diagFaults;
    return Array.isArray(faults) ? faults : [];
}

// ── Follow-up gist (V510) ──────────────────────────────────────────────────

/**
 * Should a human counsellor call this lead next. Closed vocabulary from the bot,
 * used ONLY to colour the gist sentence and to filter on — it is never rendered
 * as a word on its own. The sentence is the product.
 */
export type FollowUp = 'CALL' | 'CALL_LATER' | 'SKIP';

/**
 * `CallRowDTO.followUp/followUpGist` — the counsellor's one-sentence answer to
 * "do I call this lead myself?": the recommendation and the concrete reason from
 * the call. Served on the LIST so it reads inline under the disposition with no
 * per-row fetch. Both spellings accepted, same reasoning as {@link CallHealthFields}.
 *
 * NULL followUp means NOT ASSESSED (a human call, an older bot, a call the caller
 * never spoke on). It must never be read as CALL.
 */
export interface CallFollowUpFields {
    follow_up?: FollowUp | null;
    followUp?: FollowUp | null;
    follow_up_gist?: string | null;
    followUpGist?: string | null;
}

export function rowFollowUp(row: CallFollowUpFields): FollowUp | null {
    return row.follow_up ?? row.followUp ?? null;
}

export function rowFollowUpGist(row: CallFollowUpFields): string | null {
    const g = row.follow_up_gist ?? row.followUpGist;
    return typeof g === 'string' && g.trim() ? g.trim() : null;
}

// ── Row type (snake_case) ──────────────────────────────────────────────────

export interface CallRow extends CallHealthFields, CallFollowUpFields {
    id: string;
    provider_type: string | null;
    call_type: 'AI' | 'HUMAN';
    direction: 'INBOUND' | 'OUTBOUND';
    status: string;
    termination_reason: string | null;
    from_number: string | null;
    to_number: string | null;
    lead_number: string | null;
    caller_id: string | null;
    /** epoch millis (Jackson default for Timestamp) or ISO string — coerce with toMillis. */
    start_time: number | string | null;
    answer_time: number | string | null;
    end_time: number | string | null;
    duration_seconds: number | null;
    has_recording: boolean;
    counsellor_user_id: string | null;
    counsellor_name: string | null;
    response_id: string | null;
    user_id: string | null;
    lead_name: string | null;
    /** IVR option the inbound caller chose, e.g. "1 · Shivir Info". */
    ivr_selection: string | null;
    disposition_key: string | null;
    disposition_notes: string | null;
    dispositioned_at: number | string | null;
    ai_disposition: string | null;
    /** Rupees the TTS speech cache kept off this call's bill. Null when the bot
     *  did not measure, and on the engines with no confirmed per-minute cost
     *  (edge is free; smallest has no invoice rate yet). */
    ttsCacheSavedInr?: number | null;
    callback_at: number | string | null;
    created_at: number | string | null;
    // ── Inline on the table since 2026-09-11 (older backends omit these) ──
    /** The lead's pipeline status (lead_status row), editable from the table. */
    lead_status_id?: string | null;
    lead_status_key?: string | null;
    lead_status_label?: string | null;
    lead_status_color?: string | null;
    /** call_intelligence.status; null/undefined = never queued. */
    ci_status?: 'PENDING' | 'TRANSCRIBING' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
    /** The analysis' two-line "what happened / what's next". */
    ci_short_update?: string | null;
    ci_caller_rating?: number | null;
    ci_outcome_rating?: number | null;
    ci_lead_sentiment?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | null;
    ci_conversion_likelihood?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
    /** In-call actions the AI agent took / promised. */
    ai_callback?: boolean;
    transferred?: boolean;
    sends_total?: number;
    sends_sent?: number;
}

/** MyTable / MyPagination page shape. */
export interface CallPage {
    content: CallRow[];
    total_pages: number;
    page_no: number;
    page_size: number;
    total_elements: number;
    last: boolean;
}

// ── POST /dispositions/counts — the chip strip above the table ─────────────

export interface DispositionCount {
    /** Normalized key — send it back as dispositionKeys to filter. '' = no outcome set. */
    key: string;
    label: string | null;
    color: string | null;
    category: string | null;
    settable: boolean;
    count: number;
}

export const dispositionCountsKey = (scope: CallLogScope, f: CallLogFilters) =>
    ['crm-call-log-disposition-counts', scope, f] as const;

export async function fetchDispositionCounts(
    scope: CallLogScope,
    f: CallLogFilters
): Promise<DispositionCount[]> {
    const { data } = await authenticatedAxiosInstance.post(
        `${CALLS_BASE}/dispositions/counts`,
        buildSearchBody(scope, f)
    );
    return Array.isArray(data) ? data : [];
}

// ── POST /bulk/* — row-checkbox actions ────────────────────────────────────

export interface BulkResult {
    updated: number;
    updated_ids: string[];
    failed: { call_log_id: string; error: string }[];
}

async function bulk(path: string, body: Record<string, unknown>): Promise<BulkResult> {
    const { data } = await authenticatedAxiosInstance.post(`${CALLS_BASE}/bulk/${path}`, body);
    return data as BulkResult;
}

export const bulkSetDisposition = (
    instituteId: string,
    callLogIds: string[],
    dispositionKey: string,
    notes?: string
) => bulk('disposition', { institute_id: instituteId, call_log_ids: callLogIds, disposition_key: dispositionKey, notes });

export const bulkSetLeadStatus = (instituteId: string, callLogIds: string[], statusId: string) =>
    bulk('lead-status', { institute_id: instituteId, call_log_ids: callLogIds, status_id: statusId });

export const bulkAnalyze = (instituteId: string, callLogIds: string[]) =>
    bulk('analyze', { institute_id: instituteId, call_log_ids: callLogIds });

// ── POST /search ───────────────────────────────────────────────────────────

export const callLogSearchKey = (
    scope: CallLogScope,
    f: CallLogFilters,
    page: number,
    size: number
) => ['crm-call-log-search', scope, f, page, size] as const;

export async function fetchCallLog(
    scope: CallLogScope,
    f: CallLogFilters,
    page: number,
    size: number
): Promise<CallPage> {
    const { data } = await authenticatedAxiosInstance.post(
        `${CALLS_BASE}/search`,
        buildSearchBody(scope, f, page, size)
    );
    // Spring Page envelope is camelCase; map into the table page shape.
    return {
        content: Array.isArray(data?.content) ? data.content : [],
        total_pages: data?.totalPages ?? 0,
        page_no: data?.number ?? page,
        page_size: data?.size ?? size,
        total_elements: data?.totalElements ?? 0,
        last: data?.last ?? true,
    };
}

// ── POST /metrics ──────────────────────────────────────────────────────────

export interface CallMetrics {
    total_calls: number;
    connected_calls: number;
    connect_rate: number | null;
    total_talk_seconds: number;
    avg_talk_seconds: number | null;
    unique_leads: number;
    inbound_calls: number;
    outbound_calls: number;
    ai_calls: number;
    human_calls: number;
    missed_inbound_due: number;
    callbacks_due: number;
}

export const callLogMetricsKey = (scope: CallLogScope, f: CallLogFilters) =>
    ['crm-call-log-metrics', scope, f] as const;

export async function fetchCallMetrics(
    scope: CallLogScope,
    f: CallLogFilters
): Promise<CallMetrics> {
    const { data } = await authenticatedAxiosInstance.post(
        `${CALLS_BASE}/metrics`,
        buildSearchBody(scope, f)
    );
    return data;
}

// ── GET /dispositions ──────────────────────────────────────────────────────

export interface DispositionOption {
    id: string;
    disposition_key: string;
    label: string;
    color: string | null;
    category: 'CONNECTED' | 'NOT_CONNECTED' | 'CALLBACK' | 'OTHER' | string;
    maps_to_lead_status: boolean;
    /**
     * Whether a counsellor may APPLY this outcome. False for AI-sourced outcomes —
     * they're reported by the agent and only exist to be filtered on; `POST
     * /{id}/disposition` rejects them. Absent on an older backend ⇒ treat as settable
     * (that backend only ever returned catalog rows).
     */
    settable?: boolean;
    /** CATALOG | AI_SETTINGS | AI_AGENT | OBSERVED — where the outcome was declared. */
    source?: string;
}

export const dispositionCatalogKey = (instituteId: string) =>
    ['crm-call-disposition-catalog', instituteId] as const;

/**
 * The outcomes a counsellor may SET — `call_disposition_catalog` only. This is the
 * quick-disposition picker's list and the only vocabulary the apply endpoint accepts.
 */
export async function fetchDispositionCatalog(instituteId: string): Promise<DispositionOption[]> {
    const { data } = await authenticatedAxiosInstance.get(`${CALLS_BASE}/dispositions`, {
        params: { instituteId },
    });
    return Array.isArray(data) ? data : [];
}

// ── GET /dispositions/options (filter vocabulary) ──────────────────────────

export const dispositionOptionsKey = (instituteId: string) =>
    ['crm-call-disposition-options', instituteId] as const;

/**
 * The wider vocabulary the Disposition FILTER must offer: the settable catalog plus
 * the AI outcomes the institute configured in Settings → AI Calling (built-ins,
 * custom outcomes, assign/stop lists), the ones its AI agents declare, and the ones
 * its calls have actually returned.
 *
 * The catalog alone can't drive this filter: an AI call's outcome lives in
 * `ai_call_result.disposition` and is never a catalog code, so on an AI-heavy
 * institute every option matched zero rows.
 *
 * Falls back to the catalog when the endpoint isn't deployed yet, so the dropdown
 * degrades to its old contents instead of emptying.
 */
export async function fetchDispositionFilterOptions(
    instituteId: string
): Promise<DispositionOption[]> {
    try {
        const { data } = await authenticatedAxiosInstance.get(
            `${CALLS_BASE}/dispositions/options`,
            {
                params: { instituteId },
            }
        );
        if (Array.isArray(data) && data.length) return data;
    } catch (error) {
        if (!isCallLogEndpointMissing(error)) throw error;
    }
    return fetchDispositionCatalog(instituteId);
}

/** Alphanumerics only, upper-cased — mirrors the backend's disposition match key. */
export function normalizeDispositionKey(raw: string | null | undefined): string {
    return raw ? raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '';
}

// ── POST /{id}/disposition ─────────────────────────────────────────────────

export interface ApplyDispositionResult {
    call_log_id: string;
    disposition_key: string;
    disposition_label: string;
    disposition_color: string | null;
    category: string;
    dispositioned_at: number | null;
    callback_at: number | null;
    lead_status_synced: boolean;
}

export async function applyDisposition(
    instituteId: string,
    callLogId: string,
    dispositionKey: string,
    notes?: string,
    callbackAtEpochMillis?: number | null
): Promise<ApplyDispositionResult> {
    const { data } = await authenticatedAxiosInstance.post(
        `${CALLS_BASE}/${callLogId}/disposition`,
        {
            disposition_key: dispositionKey,
            notes: notes || undefined,
            callback_at_epoch_millis: callbackAtEpochMillis ?? undefined,
        },
        { params: { instituteId } }
    );
    return data;
}

// ── POST /export (blob) ────────────────────────────────────────────────────

export async function exportCallLog(
    scope: CallLogScope,
    f: CallLogFilters,
    format: 'csv' | 'xlsx'
): Promise<void> {
    const res = await authenticatedAxiosInstance.post(
        `${CALLS_BASE}/export`,
        buildSearchBody(scope, f),
        { params: { format }, responseType: 'blob' }
    );
    const blob = new Blob([res.data], {
        type:
            format === 'xlsx'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `calls-${scope.fromDate}-to-${scope.toDate}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ── GET /{id}/detail ───────────────────────────────────────────────────────

/** One curated provider diagnostic field (hangup cause, SIP/cause code, error, …). */
export interface CallDetailKeyVal {
    label: string;
    value: string;
}

/** Deep per-call detail — richer than the search row, used by the "more details" popover. */
export interface CallDetail extends CallHealthFields, CallFollowUpFields {
    id: string;
    provider_type: string | null;
    direction: 'INBOUND' | 'OUTBOUND' | null;
    status: string | null;
    termination_reason: string | null;
    provider_call_id: string | null;
    start_time: number | string | null;
    answer_time: number | string | null;
    end_time: number | string | null;
    duration_seconds: number | null;
    price: number | null;
    provider_details: CallDetailKeyVal[];
    /** Verbatim provider webhook body — present only for callers who may unmask numbers. */
    raw_provider_response: string | null;
    /**
     * Was the TTS speech cache running on THIS call? Decided by the backend, not
     * inferred here: the panel must not appear for the agents nobody has enabled
     * it for. Null = it was off (or the call predates the feature) — the panel is
     * hidden. True includes the case where it ran and hit nothing, which is a real
     * reading and must still be shown.
     */
    tts_cache_active?: boolean | null;
    /** Highest-priority fired fault code, e.g. "TTS_WEDGE". */
    diag_headline?: string | null;
    /** Human sentence for {@link diag_headline}, written by the bot. */
    diag_headline_text?: string | null;
    /** Threshold-set version the verdict was computed under. */
    diag_rules_version?: number | null;
    /**
     * Full technical diagnostics for AI calls. Three ways this is null, and the
     * UI must tell them apart:
     *   1. not an AI call / recorded before diagnostics shipped → nothing to show;
     *   2. the caller's role is on masked numbers — the blob carries verbatim
     *      caller utterances (`turnTaking.answersDeletedSamples`) and raw crash
     *      text, so the backend withholds it while still sending the summary
     *      fields above (see {@link isMaskedNumber});
     *   3. the backend predates the field entirely.
     * Absence is never "healthy".
     */
    diagnostics?: CallDiagnostics | null;
}

export const callDetailKey = (instituteId: string, callLogId: string) =>
    ['crm-call-log-detail', instituteId, callLogId] as const;

export async function fetchCallDetail(instituteId: string, callLogId: string): Promise<CallDetail> {
    const { data } = await authenticatedAxiosInstance.get(`${CALLS_BASE}/${callLogId}/detail`, {
        params: { instituteId },
    });
    return {
        ...data,
        provider_details: Array.isArray(data?.provider_details) ? data.provider_details : [],
        // Explicit so an older backend (no slice 3) resolves to null rather than
        // `undefined` — the health sheet distinguishes "not reported" from "loading".
        diagnostics: (data?.diagnostics as CallDiagnostics | undefined) ?? null,
    };
}

/**
 * One thing an AI call promised, and what became of it.
 *
 * A failed send used to be visible only in the engagement inbox, and a queued or
 * successful one nowhere at all - so "it said it would WhatsApp the link, did it?"
 * had no answer on the call itself.
 */
export interface CallAction {
    id: string;
    rule_id?: string | null;
    action_type?: string | null;
    channel?: string | null;
    /** OPEN (queued) | DISPATCHING | SENT | FAILED | EXPIRED */
    status?: string | null;
    template_name?: string | null;
    error_message?: string | null;
    created_at?: string | null;
    dispatched_at?: string | null;
}

export const callActionsKey = (instituteId: string, callLogId: string) =>
    ['crm-call-log-actions', instituteId, callLogId] as const;

export async function fetchCallActions(
    instituteId: string,
    callLogId: string
): Promise<CallAction[]> {
    const { data } = await authenticatedAxiosInstance.get(`${CALLS_BASE}/${callLogId}/actions`, {
        params: { instituteId },
    });
    return Array.isArray(data) ? data : [];
}

// ── GET /{id}/recording ────────────────────────────────────────────────────

export async function fetchRecordingUrl(
    instituteId: string,
    callLogId: string
): Promise<string | null> {
    const res = await authenticatedAxiosInstance.get(`${CALLS_BASE}/${callLogId}/recording`, {
        params: { instituteId },
    });
    const url = res?.data?.url;
    return typeof url === 'string' && url.length > 0 ? url : null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sentinel `telephony_call_log.user_id` writes when the call could not be tied to
 * a person (the column is NOT NULL, so an unlinked call stores this literal
 * rather than NULL — ~20% of rows). It is a truthy string, so every `if
 * (row.user_id)` check passes for calls that have no lead behind them at all;
 * use {@link callRowLeadUserId} instead of reading the field directly.
 */
export const UNLINKED_CALL_USER_ID = 'UNKNOWN';

/** The row's real lead user id, or null when the call isn't linked to anyone. */
export function callRowLeadUserId(row: Pick<CallRow, 'user_id'>): string | null {
    const id = row.user_id?.trim();
    return !id || id === UNLINKED_CALL_USER_ID ? null : id;
}

/**
 * True when the backend masked this number for the caller (`*******1234`).
 *
 * A masked value is display-only: it must never be handed to anything that
 * dials, messages, or looks a person up by phone, because the digits are gone.
 * Whether numbers arrive masked is per-role and admin-configurable — Settings →
 * Display Settings → "Call Log phone numbers" (backend:
 * `CallNumberVisibilityService`).
 */
export function isMaskedNumber(value: string | null | undefined): boolean {
    return !!value && value.includes('*');
}

/** Coerce a Jackson timestamp (epoch millis number OR ISO string) to millis. */
export function toMillis(v: number | string | null | undefined): number | null {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
}

/**
 * True when the dashboard endpoints aren't deployed on this backend yet
 * (post-merge, pre-deploy). The gateway answers unknown paths with an empty 403
 * rather than 404, so both mean "deploy pending" here.
 */
export function isCallLogEndpointMissing(error: unknown): boolean {
    return (
        isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 403)
    );
}
