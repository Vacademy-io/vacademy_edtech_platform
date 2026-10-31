import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCallback } from 'react';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { placeCall, type PlaceCallResponse } from './services/place-call';
import { fetchCallHistory } from './services/call-history';
import { TELEPHONY_CALL_EVENTS } from '@/constants/urls';

/**
 * Normalised call status pushed from the backend SSE stream — mirrors the
 * Java enum CallStatus.
 */
type CallStatus =
    | 'INITIATED'
    | 'QUEUED'
    | 'COUNSELLOR_RINGING'
    | 'COUNSELLOR_ANSWERED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'NO_ANSWER'
    | 'BUSY'
    | 'FAILED'
    | 'CANCELLED';

interface CallEvent {
    correlationId: string;
    providerCallId?: string;
    status: CallStatus;
    durationSeconds?: number | null;
    recordingUrl?: string | null;
}

const TERMINAL: ReadonlySet<CallStatus> = new Set<CallStatus>([
    'COMPLETED',
    'NO_ANSWER',
    'BUSY',
    'FAILED',
    'CANCELLED',
]);

/**
 * Terminal statuses that warrant a post-call disposition. CANCELLED is
 * excluded — the counsellor never reached the lead's line, nothing to log.
 * A no-answer/busy/failed attempt IS a disposition (retry context matters).
 */
const DISPOSITION_STATUSES: ReadonlySet<CallStatus> = new Set<CallStatus>([
    'COMPLETED',
    'NO_ANSWER',
    'BUSY',
    'FAILED',
]);

const formatDuration = (s?: number | null): string => {
    if (!s || s <= 0) return '';
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
};

const labelFor = (status: CallStatus, durationSeconds?: number | null): string => {
    switch (status) {
        case 'INITIATED':
        case 'QUEUED':
            return 'Starting the call…';
        case 'COUNSELLOR_RINGING':
            return 'Ringing your phone…';
        case 'COUNSELLOR_ANSWERED':
            // You picked up — Exotel is now ringing the lead's phone.
            return 'You picked up · ringing the lead…';
        case 'IN_PROGRESS':
            // Lead also picked up — both sides bridged, conversation live.
            return 'Lead picked up · connected';
        case 'COMPLETED': {
            const d = formatDuration(durationSeconds);
            return d ? `Call ended · ${d}` : 'Call ended';
        }
        case 'NO_ANSWER':
            return 'No answer';
        case 'BUSY':
            return 'Lead is busy';
        case 'FAILED':
            return 'Call failed';
        case 'CANCELLED':
            return 'Call cancelled';
        default:
            return 'Call in progress';
    }
};

interface UsePlaceCallOptions {
    /** Extra query keys to invalidate when a call terminates (lists / KPIs). */
    invalidateKeys?: QueryKey[];
}

/**
 * Mutation hook for the recent-leads Call action. On click:
 *   1. POST /v1/telephony/calls/connect → returns a callLogId + SSE URL.
 *   2. Open EventSource on the SSE URL — server fans webhook updates to us.
 *   3. Update a single toast.loading() in place as the status moves through
 *      QUEUED → COUNSELLOR_RINGING → COUNSELLOR_ANSWERED → IN_PROGRESS →
 *      terminal. Toast becomes the live status surface; no polling.
 *   4. On terminal status, close the stream, swap to success/error toast,
 *      invalidate caller-supplied query keys so the row reflects the new call.
 *   5. For real outcomes (COMPLETED / NO_ANSWER / BUSY / FAILED) open the
 *      post-call disposition sheet (see post-call-disposition-sheet.tsx) so the
 *      counsellor logs outcome + status + note + follow-up in one submit.
 */
export function usePlaceCall({ invalidateKeys = [] }: UsePlaceCallOptions = {}) {
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() ?? '';

    const onSuccess = useCallback(
        (
            resp: PlaceCallResponse,
            vars: { responseId?: string; userId?: string; leadName?: string }
        ) => {
            // The lead row to file the disposition against: the one the caller
            // knew, else the one the backend linked for a learner call. Neither
            // exists for a learner with no lead row — that call skips the sheet
            // rather than posting a status change against a blank target.
            const dispositionResponseId = vars.responseId ?? resp.responseId ?? null;
            // Post-call providers (Airtel) emit no live progress feed — the call
            // outcome only exists once the provider exports its CDR (minutes after
            // hang-up) and our importer promotes the row. Don't fake a streaming
            // status: show an honest "call placed" toast and poll call-history
            // opportunistically so that IF the CDR lands while the counsellor is
            // still on the page we surface the real outcome + disposition. We
            // never show the scary "live updates lost" here.
            if (resp.realtimeEvents === false) {
                const toastId = toast.loading(
                    'Call placed — your phone should ring now. The call outcome will appear in call history once the call ends.',
                    { duration: Infinity }
                );
                let resolved = false;
                let attempts = 0;
                let timer: number | null = null;
                const POLL_INTERVAL_MS = 20_000;
                const POLL_FIRST_DELAY_MS = 25_000;
                const POLL_MAX_ATTEMPTS = 18; // ~6 min
                const clearTimer = () => {
                    if (timer !== null) {
                        window.clearTimeout(timer);
                        timer = null;
                    }
                };
                const invalidateAll = () => {
                    queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
                    queryClient.invalidateQueries({ queryKey: ['lead-profiles-batch'] });
                    queryClient.invalidateQueries({ queryKey: ['latest-notes-batch'] });
                    queryClient.invalidateQueries({ queryKey: ['telephony-call-history'] });
                    for (const key of invalidateKeys) {
                        queryClient.invalidateQueries({ queryKey: key });
                    }
                };
                let dispositionFired = false;
                const maybeCaptureDisposition = (
                    status: CallStatus,
                    durationSeconds?: number | null
                ) => {
                    if (dispositionFired || !DISPOSITION_STATUSES.has(status)) return;
                    if (!dispositionResponseId) return;
                    dispositionFired = true;
                    void import('./post-call-disposition-sheet')
                        .then((m) =>
                            m.openPostCallDisposition({
                                callLogId: resp.callLogId,
                                status: status as 'COMPLETED' | 'NO_ANSWER' | 'BUSY' | 'FAILED',
                                durationSeconds: durationSeconds ?? null,
                                leadUserId: vars.userId,
                                leadName: vars.leadName,
                                responseId: dispositionResponseId,
                                queryClient,
                            })
                        )
                        .catch(() => {
                            /* best-effort — never block the next call */
                        });
                };
                const pollOnce = async () => {
                    if (resolved) return;
                    attempts += 1;
                    const userId = vars.userId;
                    if (userId) {
                        try {
                            const history = await fetchCallHistory(userId, instituteId, 0, 5);
                            const row = history?.content?.find((c) => c.id === resp.callLogId);
                            if (row && row.status === 'COMPLETED') {
                                resolved = true;
                                clearTimer();
                                toast.success(labelFor('COMPLETED', row.durationSeconds), {
                                    id: toastId,
                                    duration: 4000,
                                });
                                invalidateAll();
                                maybeCaptureDisposition('COMPLETED', row.durationSeconds);
                                return;
                            }
                            if (row && TERMINAL.has(row.status as CallStatus)) {
                                resolved = true;
                                clearTimer();
                                toast.error(labelFor(row.status as CallStatus, row.durationSeconds), {
                                    id: toastId,
                                    duration: 4000,
                                });
                                invalidateAll();
                                maybeCaptureDisposition(row.status as CallStatus, row.durationSeconds);
                                return;
                            }
                        } catch {
                            /* non-fatal — try again next tick */
                        }
                    }
                    if (attempts >= POLL_MAX_ATTEMPTS) {
                        // Call almost certainly still in progress, or the CDR hasn't
                        // imported yet. Resolve softly — the row will update in call
                        // history when the import lands.
                        resolved = true;
                        clearTimer();
                        toast.message('Call placed · the outcome will appear in call history shortly.', {
                            id: toastId,
                            duration: 6000,
                        });
                        invalidateAll();
                        return;
                    }
                    timer = window.setTimeout(pollOnce, POLL_INTERVAL_MS);
                };
                timer = window.setTimeout(pollOnce, POLL_FIRST_DELAY_MS);
                return;
            }

            // One toast id, updated in place so the sales person sees one
            // continuously-evolving status row instead of stacked toasts.
            // Initial text matches the QUEUED label so the first SSE event
            // doesn't visibly swap text — it's the "placed but not ringing
            // yet" moment between /connect responding and the counsellor's
            // phone actually ringing.
            const toastId = toast.loading('Starting the call…', { duration: Infinity });

            // SSE — server publishes one "status" event per webhook callback.
            // EventSource can't send Authorization headers; the callLogId UUID
            // (returned only to the counsellor who placed the call) is the
            // capability token. The endpoint is on the public-paths list so
            // we do NOT pass `withCredentials: true` — sending credentials to
            // a public endpoint breaks CORS preflight on most setups, and the
            // server doesn't need them here anyway.
            const url = TELEPHONY_CALL_EVENTS(resp.callLogId);
            const es = new EventSource(url);

            // Tracks whether the toast has already been resolved (terminal
            // event received OR fallback poll determined the call is done).
            // Anything that fires after this point is a no-op.
            let resolved = false;
            // Track whether ANY real event has arrived. If yes and SSE errors,
            // we assume the connection dropped on the terminal frame rather
            // than the call truly stalling — the row in DB has the truth.
            let receivedAnyEvent = false;
            // Recovery timer: when SSE errors, give it a few seconds, then
            // poll the call log to determine the actual final state.
            let recoveryTimer: number | null = null;
            const clearRecoveryTimer = () => {
                if (recoveryTimer !== null) {
                    window.clearTimeout(recoveryTimer);
                    recoveryTimer = null;
                }
            };
            // Fallback polling: in multi-replica prod, the SSE stream is open
            // on whichever pod the EventSource hit, but Exotel's status webhook
            // can land on a DIFFERENT pod. CallEventBus is in-JVM, so the SSE
            // subscriber on pod A never sees events published on pod B and
            // `onerror` never fires (the stream is healthy, just silent).
            // Polling the call-history API every 20s — stateless, hits the DB —
            // catches the terminal status regardless of which pod processed the
            // webhook. Stops as soon as anything resolves the toast.
            let pollTimer: number | null = null;
            let pollAttempts = 0;
            const POLL_INTERVAL_MS = 20_000;
            const POLL_FIRST_DELAY_MS = 25_000; // SSE gets first shot
            const POLL_MAX_ATTEMPTS = 15;       // ~5 min total
            const clearPollTimer = () => {
                if (pollTimer !== null) {
                    window.clearTimeout(pollTimer);
                    pollTimer = null;
                }
            };

            const resolveAs = (kind: 'success' | 'error' | 'silent', message?: string) => {
                if (resolved) return;
                resolved = true;
                clearRecoveryTimer();
                clearPollTimer();
                try {
                    es.close();
                } catch {
                    /* noop */
                }
                if (kind === 'success' && message) {
                    toast.success(message, { id: toastId, duration: 4000 });
                } else if (kind === 'error' && message) {
                    toast.error(message, { id: toastId, duration: 4000 });
                } else {
                    // Silent close — just dismiss the loading toast.
                    toast.dismiss(toastId);
                }
                queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
                queryClient.invalidateQueries({ queryKey: ['lead-profiles-batch'] });
                queryClient.invalidateQueries({ queryKey: ['latest-notes-batch'] });
                queryClient.invalidateQueries({ queryKey: ['telephony-call-history'] });
                for (const key of invalidateKeys) {
                    queryClient.invalidateQueries({ queryKey: key });
                }
            };

            // Post-call disposition capture: once the toast has resolved with a
            // real outcome, open the disposition sheet (outcome + status + note +
            // next follow-up in one submit). Lazy import keeps the sheet bundle
            // off the hot call path; failures are swallowed — disposition capture
            // is best-effort and must never block the calling flow. Fires at most
            // once per call regardless of which channel (SSE / poll / recovery)
            // delivered the terminal status.
            let dispositionFired = false;
            const maybeCaptureDisposition = (
                status: CallStatus,
                durationSeconds?: number | null
            ) => {
                if (dispositionFired || !DISPOSITION_STATUSES.has(status)) return;
                if (!dispositionResponseId) return;
                dispositionFired = true;
                void import('./post-call-disposition-sheet')
                    .then((m) =>
                        m.openPostCallDisposition({
                            callLogId: resp.callLogId,
                            status: status as 'COMPLETED' | 'NO_ANSWER' | 'BUSY' | 'FAILED',
                            durationSeconds: durationSeconds ?? null,
                            leadUserId: vars.userId,
                            leadName: vars.leadName,
                            responseId: dispositionResponseId,
                            queryClient,
                        })
                    )
                    .catch(() => {
                        /* best-effort — never block the next call */
                    });
            };

            es.addEventListener('status', (e) => {
                let ev: CallEvent;
                try {
                    ev = JSON.parse((e as MessageEvent).data) as CallEvent;
                } catch {
                    return;
                }
                receivedAnyEvent = true;
                clearRecoveryTimer();
                const text = labelFor(ev.status, ev.durationSeconds);
                if (ev.status === 'COMPLETED') {
                    resolveAs('success', text);
                    maybeCaptureDisposition(ev.status, ev.durationSeconds);
                } else if (TERMINAL.has(ev.status)) {
                    resolveAs('error', text);
                    maybeCaptureDisposition(ev.status, ev.durationSeconds);
                } else {
                    toast.loading(text, { id: toastId, duration: Infinity });
                }
            });

            // Heartbeat pings — connection is healthy.
            es.addEventListener('ping', () => clearRecoveryTimer());

            const pollOnce = async () => {
                if (resolved) return;
                pollAttempts += 1;
                const userId = vars.userId;
                if (!userId) {
                    // No userId → can't look up call history. Give up polling.
                    return;
                }
                try {
                    const history = await fetchCallHistory(userId, instituteId, 0, 5);
                    const row = history?.content?.find((c) => c.id === resp.callLogId);
                    if (!row) {
                        // Row not yet visible — keep polling.
                    } else if (row.status === 'COMPLETED') {
                        resolveAs('success', labelFor('COMPLETED', row.durationSeconds));
                        maybeCaptureDisposition('COMPLETED', row.durationSeconds);
                        return;
                    } else if (TERMINAL.has(row.status as CallStatus)) {
                        resolveAs('error', labelFor(row.status as CallStatus, row.durationSeconds));
                        maybeCaptureDisposition(row.status as CallStatus, row.durationSeconds);
                        return;
                    } else if (!receivedAnyEvent) {
                        // Mid-call status from the DB — SSE clearly isn't
                        // delivering. Update the toast text so the counsellor
                        // sees forward motion instead of "Starting the call…"
                        // for minutes.
                        toast.loading(labelFor(row.status as CallStatus, row.durationSeconds), {
                            id: toastId,
                            duration: Infinity,
                        });
                    }
                } catch {
                    /* poll errors are non-fatal — try again next tick */
                }
                if (pollAttempts >= POLL_MAX_ATTEMPTS) {
                    // Give up after ~5 min. Soft message rather than success/error
                    // because we don't actually know the call's fate.
                    if (!resolved) {
                        toast.message('Live updates lost · check call history shortly', {
                            id: toastId,
                            duration: 6000,
                        });
                        resolved = true;
                        try { es.close(); } catch { /* noop */ }
                    }
                    return;
                }
                pollTimer = window.setTimeout(pollOnce, POLL_INTERVAL_MS);
            };
            pollTimer = window.setTimeout(pollOnce, POLL_FIRST_DELAY_MS);

            es.onerror = () => {
                if (resolved) return;
                if (recoveryTimer !== null) return;  // already scheduled
                // The most common reason we hit onerror after a real call:
                // server's complete() closed the stream microseconds before the
                // final terminal frame reached the browser. Wait briefly, then
                // poll the call log via the history endpoint — the DB has the
                // truth. (If a real network drop happened mid-call, the poll
                // will return the latest known status and we render that.)
                recoveryTimer = window.setTimeout(async () => {
                    recoveryTimer = null;
                    if (resolved) return;
                    const userId = vars.userId;
                    if (!userId) {
                        // No userId to look up by → close silently rather than
                        // false-flag the call as lost.
                        resolveAs('silent');
                        return;
                    }
                    try {
                        const history = await fetchCallHistory(userId, instituteId, 0, 5);
                        const row = history?.content?.find((c) => c.id === resp.callLogId);
                        if (!row) {
                            resolveAs('silent');
                            return;
                        }
                        const text = labelFor(row.status as CallStatus, row.durationSeconds);
                        if (row.status === 'COMPLETED') {
                            resolveAs('success', text);
                            maybeCaptureDisposition('COMPLETED', row.durationSeconds);
                        } else if (TERMINAL.has(row.status as CallStatus)) {
                            resolveAs('error', text);
                            maybeCaptureDisposition(
                                row.status as CallStatus,
                                row.durationSeconds
                            );
                        } else if (receivedAnyEvent) {
                            // We saw events but the row isn't terminal yet —
                            // SSE genuinely dropped mid-call. Soft message.
                            toast.message('Live updates lost · check call history shortly', {
                                id: toastId,
                                duration: 6000,
                            });
                            resolved = true;
                            try { es.close(); } catch { /* noop */ }
                        } else {
                            resolveAs('silent');
                        }
                    } catch {
                        // Polling failed — close silently rather than show a
                        // false "lost updates" message.
                        resolveAs('silent');
                    }
                }, 4000);
            };
        },
        [queryClient, invalidateKeys, instituteId]
    );

    return useMutation({
        mutationFn: (vars: {
            /** CRM lead row. Omit for a learner call — `userId` then identifies
             *  the person and the backend resolves the rest. */
            responseId?: string;
            userId?: string;
            preferredNumberId?: string;
            /** Lead's display name — shown on the post-call disposition sheet
             *  header. Optional; the sheet falls back to a generic label. */
            leadName?: string;
        }) =>
            placeCall({
                instituteId,
                responseId: vars.responseId,
                userId: vars.userId,
                preferredNumberId: vars.preferredNumberId,
            }),
        onSuccess,
        onError: (err) => toast.error(extractServerErrorMessage(err)),
    });
}

/**
 * Pulls the human-readable error out of an axios/server error.
 *
 * The backend's GlobalExceptionHandler returns an ErrorInfo body with shape:
 *   { url, ex, responseCode, date }
 * where `ex` is the actual VacademyException message
 * (e.g. "Your Exotel account is out of balance. Top up at my.exotel.com…").
 *
 * Plain `err.message` on an axios error is just "Request failed with status
 * code 510" — useless to the counsellor. We dig into the response body first
 * and fall back to the generic message only if we can't find anything.
 */
function extractServerErrorMessage(err: unknown): string {
    if (err && typeof err === 'object') {
        const e = err as {
            response?: { data?: { ex?: string; message?: string } };
            message?: string;
        };
        if (e.response?.data?.ex && typeof e.response.data.ex === 'string') {
            return e.response.data.ex;
        }
        if (e.response?.data?.message && typeof e.response.data.message === 'string') {
            return e.response.data.message;
        }
        if (typeof e.message === 'string') return e.message;
    }
    return 'Could not place call';
}
