import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { placeAiCall } from './services/place-ai-call';

interface UsePlaceAiCallOptions {
    /** Extra query keys to invalidate after the call is queued. */
    invalidateKeys?: QueryKey[];
}

/**
 * Mutation hook for the recent-leads "AI Call" action. Unlike usePlaceCall, the
 * AI call is fire-and-forget — there's no counsellor leg and no live SSE; the
 * outcome arrives later on the end-of-call webhook and is processed server-side
 * (assign-or-retry per Settings → AI Calling). So this just POSTs and toasts.
 */
export function usePlaceAiCall({ invalidateKeys = [] }: UsePlaceAiCallOptions = {}) {
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';

    return useMutation({
        mutationFn: (vars: {
            responseId: string;
            userId?: string;
            leadName?: string;
            campaignId?: string;
            preferredNumberId?: string;
        }) =>
            placeAiCall({
                instituteId,
                responseId: vars.responseId,
                userId: vars.userId,
                campaignId: vars.campaignId,
                preferredNumberId: vars.preferredNumberId,
            }),
        onSuccess: (resp, vars) => {
            // `dispatched` is the ONLY field that means a call actually went out.
            //
            // `status` cannot carry that: CallStatus.QUEUED is the CALL LOG's word for
            // "the provider accepted the dial", so a phone that is ringing right now and
            // a call still waiting for a free line BOTH report status === 'QUEUED'.
            // Branching on it sent every successful dial down the waiting path, which
            // returned early and skipped the invalidations below — so a placed AI call
            // never appeared in the lead list or call history until a manual refresh.
            const queueKeys = [['ai-call-queue-summary'], ['ai-call-queue-items']];
            if (resp && resp.dispatched) {
                toast.success(
                    resp.providerMessage ||
                        `AI call placed${vars.leadName ? ` for ${vars.leadName}` : ''}`
                );
                queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
                queryClient.invalidateQueries({ queryKey: ['telephony-call-history'] });
                // The queue holds a row for this call too (DIALED), so the Call Queue
                // page must not keep showing it as waiting.
                for (const key of [...queueKeys, ...invalidateKeys]) {
                    queryClient.invalidateQueries({ queryKey: key });
                }
                return;
            }
            // ACCEPTED BUT WAITING is not a failure. Every line is busy, so the call sits
            // in the queue and dials itself; the server's message carries its place in
            // line and a rough wait. A queue row is what distinguishes this from a skip.
            if (resp && resp.queueItemId) {
                toast.info(
                    resp.providerMessage ||
                        `AI call queued${vars.leadName ? ` for ${vars.leadName}` : ''}`
                );
                for (const key of queueKeys) {
                    queryClient.invalidateQueries({ queryKey: key });
                }
                return;
            }
            // A skip is HTTP 200 with dispatched=false and no queue row (lead already
            // assigned, duplicate within 30s, daily cap reached). Toasting "queued" for
            // those told the user a call was placed when nothing was dialled — the phone
            // simply never rang, with no reason shown anywhere.
            toast.warning(resp?.providerMessage || 'AI call was not placed');
        },
        onError: (err) => toast.error(extractServerErrorMessage(err)),
    });
}

function extractServerErrorMessage(err: unknown): string {
    if (err && typeof err === 'object') {
        const e = err as {
            response?: { data?: { ex?: string; message?: string } };
            message?: string;
        };
        if (typeof e.response?.data?.ex === 'string') return e.response.data.ex;
        if (typeof e.response?.data?.message === 'string') return e.response.data.message;
        if (typeof e.message === 'string') return e.message;
    }
    return 'Could not place AI call';
}
