import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, TELEPHONY_AI_CALL_CAMPAIGN } from '@/constants/urls';

export interface StartAiCampaignRequest {
    /** The audience/campaign id (a lead list). */
    audienceId: string;
    instituteId: string;
    /** true = just count eligible leads, don't place any calls (for the confirm dialog). */
    dryRun?: boolean;
    /** Optional chosen AI agent id; blank ⇒ institute's default. */
    campaignId?: string;
    /** Optional chosen caller-ID number id; blank ⇒ provider default. */
    preferredNumberId?: string;
    /** Optional: call ONLY these audience responses (the checked rows). */
    responseIds?: string[];
    /** Calls in parallel (1..3). 1 = strictly one at a time, next starts when one ends. */
    parallel?: number;
}

export interface StartAiCampaignResult {
    /** All leads in the list. */
    total: number;
    /** Leads that will actually be called (have a saved contact / user). */
    eligible: number;
    /** false for a dry run; true once the calls have been queued. */
    dispatched: boolean;
    message: string;
}

/**
 * POST /v1/telephony/ai-call/campaign/{audienceId}?instituteId=&dryRun= — bulk AI
 * calls for a lead list. The backend counts synchronously (so we get total/eligible
 * back immediately) and then paces the per-lead calls on a background pool; each
 * lead's outcome + counsellor assignment arrives later via the end-of-call webhook.
 */
export const startAiCallCampaign = async (
    req: StartAiCampaignRequest
): Promise<StartAiCampaignResult> => {
    const { data } = await authenticatedAxiosInstance.post<StartAiCampaignResult>(
        TELEPHONY_AI_CALL_CAMPAIGN(req.audienceId),
        {
            responseIds: req.responseIds?.length ? req.responseIds : undefined,
            parallel: req.parallel,
        },
        {
            params: {
                instituteId: req.instituteId,
                dryRun: req.dryRun ?? false,
                campaignId: req.campaignId || undefined,
                preferredNumberId: req.preferredNumberId || undefined,
            },
        }
    );
    return data;
};

export interface AiCampaignCallStatus {
    callLogId: string;
    responseId: string;
    /** CallStatus name: INITIATED/QUEUED/COUNSELLOR_RINGING/ANSWERED/IN_PROGRESS/COMPLETED/NO_ANSWER/BUSY/FAILED/CANCELLED */
    status: string;
    durationSeconds: number | null;
    createdAt: string | null;
    disposition: string | null;
}

/** Live per-lead statuses for the campaign progress dialog (poll every few seconds). */
export const fetchAiCampaignStatus = async (
    audienceId: string,
    instituteId: string,
    sinceEpochMs: number
): Promise<AiCampaignCallStatus[]> => {
    const { data } = await authenticatedAxiosInstance.get<AiCampaignCallStatus[]>(
        `${TELEPHONY_AI_CALL_CAMPAIGN(audienceId)}/status`,
        { params: { instituteId, sinceEpochMs } }
    );
    return data ?? [];
};

// ── Bulk-run progress, read from the QUEUE ──────────────────────────────────
//
// The older `/campaign/{id}/status` endpoint reads the CALL LOG, which only knows
// about calls that have already dialled. Against a fleet that carries a few calls at
// once, a 100-lead run showed three rows and no trace of the other ninety-seven — and
// a lead the queue cancelled or expired never produced a call-log row at all, so a
// progress bar counting them could never reach its own total.

export interface BulkRunSummary {
    audienceId: string;
    /** Everything the run enqueued. The honest denominator. */
    total: number;
    waiting: number;
    /** Handed to the provider and still on a line. */
    dialing: number;
    completed: number;
    /** Ended without a call: cancelled, expired, or failed to place. */
    dropped: number;
    finished: number;
    runFinished: boolean;
    /** Rough wait for what is still queued, in minutes. */
    etaMinutes: number;
    byStatus?: Record<string, number>;
}

export interface BulkRunItem {
    id: string;
    responseId?: string | null;
    userId?: string | null;
    phoneNumber?: string | null;
    agentName?: string | null;
    status: string;
    statusReason?: string | null;
    /** Place in this institute's lane. Only set while still waiting. */
    aheadInLane?: number | null;
    etaMinutes?: number | null;
    /** The live call behind a DIALED row — the queue row alone cannot tell you. */
    callStatus?: string | null;
    callDurationSeconds?: number | null;
    live?: boolean;
    callLogId?: string | null;
}

const AI_QUEUE_BASE = `${BASE_URL}/admin-core-service/v1/telephony/ai-queue`;

export const fetchBulkRunSummary = async (
    audienceId: string,
    instituteId: string
): Promise<BulkRunSummary> => {
    const { data } = await authenticatedAxiosInstance.get<BulkRunSummary>(
        `${AI_QUEUE_BASE}/bulk-run`,
        { params: { instituteId, audienceId } }
    );
    return data;
};

export const fetchBulkRunItems = async (
    audienceId: string,
    instituteId: string,
    size = 200
): Promise<BulkRunItem[]> => {
    const { data } = await authenticatedAxiosInstance.get<{ content?: BulkRunItem[] }>(
        `${AI_QUEUE_BASE}/bulk-run/items`,
        { params: { instituteId, audienceId, page: 0, size } }
    );
    return data?.content ?? [];
};

/**
 * Stop the calls a bulk run still has waiting.
 *
 * Scoped to this run by `sourceRef`. The unscoped form of this endpoint cancels every
 * waiting call the institute has — other campaigns, automations, counsellors' own
 * clicks — which is never what someone stopping one campaign means.
 */
export const cancelBulkRun = async (
    audienceId: string,
    instituteId: string
): Promise<{ cancelled: number }> => {
    const { data } = await authenticatedAxiosInstance.post(
        `${AI_QUEUE_BASE}/cancel`,
        { sourceRef: audienceId, reason: 'Cancelled from the campaign progress dialog' },
        { params: { instituteId } }
    );
    return data;
};
