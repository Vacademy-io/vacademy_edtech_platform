import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { TELEPHONY_AI_CALL_CONNECT } from '@/constants/urls';

export interface PlaceAiCallRequest {
    instituteId: string;
    /** The lead's audience_response id — the backend resolves phone + user id from it. */
    responseId: string;
    userId?: string;
    /** Optional — chosen AI agent id; blank ⇒ institute's default AI campaign. */
    campaignId?: string;
    /** Optional — chosen caller-ID number id; blank ⇒ provider default. */
    preferredNumberId?: string;
}

export interface PlaceAiCallResponse {
    /** Absent when the call was QUEUED — no call log row exists until it dials. */
    callLogId?: string | null;
    /** QUEUED (waiting for a free line) | the call-log status once a dial went out. */
    status: string;
    /** True only when a provider accepted a real dial. A queued call is NOT dispatched. */
    dispatched: boolean;
    providerMessage?: string;
    /** Set when queued: the ai_call_queue row that now owns this call. */
    queueItemId?: string | null;
    /** Calls ahead of this one in this institute's lane. 0 = next up. */
    queuePosition?: number | null;
    /** Rough wait before it goes out, in minutes. */
    queueEtaMinutes?: number | null;
}

/**
 * POST /v1/telephony/ai-call/connect → requests an AI voice-agent call.
 * Fire-and-forget: the AI talks to the lead, and the outcome (which decides
 * whether a counsellor is assigned) lands later via the end-of-call webhook.
 *
 * With a free line this dials immediately and comes back dispatched=true, exactly as
 * it always did. When the fleet is busy the call is QUEUED instead and dials on its
 * own — accepted, not failed. Callers must branch on {@link PlaceAiCallResponse.status}
 * before treating dispatched=false as a refusal.
 */
export const placeAiCall = async (req: PlaceAiCallRequest): Promise<PlaceAiCallResponse> => {
    const { data } = await authenticatedAxiosInstance.post<PlaceAiCallResponse>(
        TELEPHONY_AI_CALL_CONNECT,
        req
    );
    return data;
};
