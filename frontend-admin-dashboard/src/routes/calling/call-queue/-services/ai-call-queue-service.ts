/**
 * AI call queue data layer — this institute's own queue only.
 *
 * Backed by the institute-scoped queue endpoints (admin-core-service):
 *   GET    /v1/telephony/ai-queue/summary?instituteId=   — depth, in-flight, ETA
 *   GET    /v1/telephony/ai-queue?instituteId=&status=   — paged rows (Spring Page envelope)
 *   POST   /v1/telephony/ai-queue/pause?instituteId=     — hold the queue (nothing lost)
 *   POST   /v1/telephony/ai-queue/resume?instituteId=    — let it dial again
 *   POST   /v1/telephony/ai-queue/cancel?instituteId=    — cancel everything still waiting
 *   DELETE /v1/telephony/ai-queue/{id}?instituteId=      — cancel one waiting call
 *
 * Every endpoint is validated server-side against the caller's institute, so this
 * page can only ever read or cancel its own calls — the fleet-wide view and the
 * capacity controls live behind separate super-admin routes and are deliberately
 * not reachable from here.
 *
 * Payloads are camelCase (these controllers use the default naming strategy, unlike
 * the snake_case call-search endpoints next door in call-log-service.ts).
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

const QUEUE_BASE = `${BASE_URL}/admin-core-service/v1/telephony/ai-queue`;

/** Lifecycle of one queued call. Mirrors the backend AiCallQueueStatus enum. */
export type QueueStatus = 'QUEUED' | 'DISPATCHING' | 'DIALED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

/**
 * Filter values the list accepts: any real status, plus LIVE.
 *
 * Two of these are not queue statuses:
 *
 * ACTIVE (the default) is waiting + already dialling — what "the queue" means to a
 * person. Filtering to QUEUED alone shows an empty table exactly when calling is
 * working normally, because a call only waits when every line is busy.
 *
 * LIVE is on a call right now. A queue row reads DIALED from the instant the provider
 * accepts and never moves again, so liveness can only be answered by joining the call
 * log — which the backend does for this filter.
 */
export type QueueFilter = QueueStatus | 'ACTIVE' | 'LIVE' | 'ALL' | '';

export interface QueueItem {
    id: string;
    instituteId: string;
    instituteName?: string | null;
    /** The AI agent as a person names it, resolved from the campaign id. */
    agentName?: string | null;
    provider?: string | null;
    source?: string | null;
    /** MANUAL | AUTOMATION | BULK_MANUAL | WORKFLOW_EXPLICIT */
    callTrigger?: string | null;
    priority?: number;
    sourceRef?: string | null;
    /** Campaign name behind a BULK row — what makes a specific run findable here. */
    sourceName?: string | null;
    status: QueueStatus;
    /** Why it ended where it did — the only explanation an admin gets for a skip. */
    statusReason?: string | null;
    responseId?: string | null;
    userId?: string | null;
    /** The lead's name from their CRM record. */
    leadName?: string | null;
    phoneNumber?: string | null;
    campaignId?: string | null;
    campaignName?: string | null;
    attempts?: number;
    notBefore?: string | null;
    expiresAt?: string | null;
    callLogId?: string | null;
    dispatchedAt?: string | null;
    createdAt?: string | null;
    /** Calls ahead of this one in THIS institute's lane. Only set while QUEUED. */
    aheadInLane?: number | null;
    etaMinutes?: number | null;
    /** Live state of the actual call, for rows that have already dialled. */
    callStatus?: string | null;
    callDurationSeconds?: number | null;
    /** True while the call is still up. The queue row alone cannot tell you this. */
    live?: boolean;
}

/**
 * Depth and wait for this institute.
 *
 * Carries no capacity numbers by design — the size of the shared calling pool is an
 * internal operating fact, so the API does not return it here and the UI has nothing
 * to accidentally render.
 */
export interface QueueSummary {
    instituteId: string;
    queued: number;
    /** This institute's own calls currently on a line. Not a share of anything. */
    inFlight: number;
    paused: boolean;
    etaMinutes: number;
    byStatus?: Record<string, number>;
}

/** Spring Page envelope, trimmed to what the table needs. */
export interface QueuePage {
    content: QueueItem[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
}

export async function fetchQueueSummary(instituteId: string): Promise<QueueSummary> {
    const { data } = await authenticatedAxiosInstance.get(`${QUEUE_BASE}/summary`, {
        params: { instituteId },
    });
    return data;
}

export async function fetchQueueItems(args: {
    instituteId: string;
    status?: QueueFilter;
    /** Bulk-run (audience) id — narrows the list to one campaign. */
    sourceRef?: string;
    page?: number;
    size?: number;
}): Promise<QueuePage> {
    const { data } = await authenticatedAxiosInstance.get(QUEUE_BASE, {
        params: {
            instituteId: args.instituteId,
            // Omitted rather than sent blank: the backend treats an absent status as
            // "no filter", and an empty string would be compared against the column.
            ...(args.status ? { status: args.status } : {}),
            ...(args.sourceRef ? { sourceRef: args.sourceRef } : {}),
            page: args.page ?? 0,
            size: args.size ?? 25,
        },
    });
    return data;
}

/**
 * Cancel waiting calls. Only QUEUED rows are affected.
 *
 * <b>Pass `sourceRef` to stop ONE campaign.</b> Without it this cancels everything the
 * institute has waiting — other campaigns, workflow-driven calls and counsellors'
 * manual clicks included. An admin stopping a single bulk run must not silently take
 * the rest down with it.
 */
/**
 * Hold this institute's queue, or let it go again.
 *
 * Pausing is NOT cancelling: every waiting call keeps its place, its order and its
 * campaign, and the expiry clock stops for the duration — the dialler simply steps
 * over this institute until it is resumed. Use it to stop calls going out while you
 * look at what the last batch did.
 */
export async function setQueuePaused(
    instituteId: string,
    paused: boolean
): Promise<{ instituteId: string; paused: boolean; queued: number }> {
    const { data } = await authenticatedAxiosInstance.post(
        `${QUEUE_BASE}/${paused ? 'pause' : 'resume'}`,
        null,
        { params: { instituteId } }
    );
    return data;
}

export async function cancelAllQueued(
    instituteId: string,
    reason?: string,
    sourceRef?: string
): Promise<{ cancelled: number }> {
    const { data } = await authenticatedAxiosInstance.post(
        `${QUEUE_BASE}/cancel`,
        { reason, ...(sourceRef ? { sourceRef } : {}) },
        { params: { instituteId } }
    );
    return data;
}

export interface QueueRun {
    audienceId: string;
    name: string;
    startedAt?: string | null;
    total: number;
}

/** Bulk runs this institute has queued, newest first — the campaign filter's options. */
export async function fetchQueueRuns(instituteId: string): Promise<QueueRun[]> {
    const { data } = await authenticatedAxiosInstance.get<QueueRun[]>(`${QUEUE_BASE}/runs`, {
        params: { instituteId, limit: 20 },
    });
    return data ?? [];
}

/** Cancel one waiting call. A call already dialling cannot be taken back. */
export async function cancelQueuedItem(
    instituteId: string,
    id: string,
    reason?: string
): Promise<{ cancelled: boolean }> {
    const { data } = await authenticatedAxiosInstance.delete(`${QUEUE_BASE}/${id}`, {
        params: { instituteId, ...(reason ? { reason } : {}) },
    });
    return data;
}
