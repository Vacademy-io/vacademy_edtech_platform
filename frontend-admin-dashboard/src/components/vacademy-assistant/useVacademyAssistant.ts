import { useCallback, useRef, useState } from 'react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getInstituteId } from '@/constants/helper';
import {
    ASSISTANT_SESSION_INIT,
    ASSISTANT_SESSION_MESSAGE,
    ASSISTANT_SESSION_STREAM,
    ASSISTANT_SESSION_CLOSE,
    ASSISTANT_ACTION_CONFIRM,
    ASSISTANT_ACTION_CANCEL,
} from '@/constants/urls';
import { useSelectedStudentMirrorStore } from '@/stores/assistant/selected-student-mirror';
import type {
    AssistantActionRequestData,
    AssistantActionStatus,
    AssistantErrorData,
    AssistantMessage,
    AssistantMessageData,
    AssistantStatus,
} from './types';

interface StreamFrame {
    event: string;
    data: unknown;
}

/** Parse complete `event:/data:` SSE frames out of a text buffer; return the leftover. */
function parseSseBuffer(buffer: string): { frames: StreamFrame[]; rest: string } {
    const frames: StreamFrame[] = [];
    let rest = buffer;
    let sep = rest.indexOf('\n\n');
    while (sep !== -1) {
        const rawFrame = rest.slice(0, sep);
        rest = rest.slice(sep + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of rawFrame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
        }
        if (dataLines.length) {
            try {
                frames.push({ event, data: JSON.parse(dataLines.join('\n')) });
            } catch {
                // Ignore a malformed frame rather than breaking the stream.
            }
        }
        sep = rest.indexOf('\n\n');
    }
    return { frames, rest };
}

const CREDITS_EXHAUSTED_MSG =
    'AI credits are exhausted for your institute. Please add credits to keep using the assistant.';
const GENERIC_ERROR_MSG = 'Could not reach the assistant. Please try again in a moment.';

/** Friendly one-liners shown while a tool runs, so waits feel purposeful. */
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
    search_help_knowledge: 'Searching help articles…',
    find_learner: 'Searching learners…',
    get_student_360: 'Fetching learner data…',
    get_payment_history: 'Fetching payment history…',
    get_fee_dues: 'Checking fee dues…',
    get_subscription_plans: 'Checking payment plans…',
    list_batch_learners: 'Loading the batch roster…',
    get_class_schedule: 'Checking the schedule…',
    get_institute_overview: 'Gathering institute stats…',
    trigger_full_report: 'Starting the full report…',
    update_learner_profile: 'Preparing the change…',
    manage_enrollment: 'Preparing the change…',
    find_batch: 'Finding the batch…',
    search_fee_records: 'Searching fee records…',
    get_collections_summary: 'Summing collections…',
    list_recent_enrollments: 'Loading recent enrollments…',
    find_assessment: 'Finding the assessment…',
    get_assessment_results: 'Loading submissions…',
    get_assessment_leaderboard: 'Loading the leaderboard…',
    list_announcements: 'Loading announcements…',
    send_announcement: 'Preparing the announcement…',
    load_tools: 'Loading the right tools…',
    crm_leads: 'Looking up leads…',
    crm_calls: 'Checking calls…',
    crm_meetings: 'Checking meetings…',
    crm_messages: 'Reading lead messages…',
    crm_reports: 'Running the CRM report…',
    crm_collections: 'Checking dues and collections…',
    crm_lead_activity: 'Preparing the change…',
    crm_lead_edit: 'Preparing the change…',
    crm_lead_merge: 'Preparing the change…',
    crm_lead_intake: 'Preparing the change…',
    crm_team_edit: 'Preparing the change…',
    crm_meetings_edit: 'Preparing the change…',
};

/**
 * The card's state after Confirm / Cancel, from the endpoint's status. 'pending': not settled (an
 * hourly limit, or a run that broke off) — the card stays open. 'executing': another Confirm of the
 * same card is already applying it, which is not a failure.
 */
export function actionStatusFrom(status: string): AssistantActionStatus {
    switch (status) {
        case 'executed':
            return 'executed';
        case 'cancelled':
            return 'cancelled';
        case 'pending':
            return 'pending';
        case 'executing':
            return 'applying';
        default:
            return 'failed';
    }
}

/** A card's detail or warning lines from the event: strings only, at most 20. */
export function cardLines(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const lines = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    return lines.length ? lines.slice(0, 20) : undefined;
}

/**
 * Current page context sent with every message so the assistant can resolve
 * "this student" (route + the student open in the side view / profile overlay).
 * The route also tells the backend which tools to offer (e.g. the CRM tools on
 * CRM pages); it is only a hint and never decides what the user may see.
 * Read non-reactively at send time — always the state at the moment of asking.
 */
function getPageContext(): Record<string, unknown> {
    const student = useSelectedStudentMirrorStore.getState().student;
    return {
        route: typeof window !== 'undefined' ? window.location.pathname : '',
        ...(student ? { selected_student: student } : {}),
    };
}

/**
 * Drives one Vacademy Assistant conversation: creates/reuses a session, posts
 * the user message through the authenticated axios instance (so it inherits the
 * `Authorization` + `clientId` headers and the `/ai-service` 401 exemption),
 * then reads the SSE answer via fetch (EventSource can't send the auth header).
 */
export function useVacademyAssistant() {
    const [messages, setMessages] = useState<AssistantMessage[]>([]);
    const [status, setStatus] = useState<AssistantStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const appendToStreamingAssistant = useCallback((delta: string) => {
        setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant' && last.streaming) {
                next[next.length - 1] = { ...last, content: last.content + delta };
            } else {
                next.push({
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: delta,
                    streaming: true,
                });
            }
            return next;
        });
    }, []);

    const finalizeAssistant = useCallback((content: string) => {
        setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant' && last.streaming) {
                next[next.length - 1] = {
                    ...last,
                    content: content || last.content,
                    streaming: false,
                };
            } else if (content) {
                next.push({
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content,
                    streaming: false,
                });
            }
            return next;
        });
    }, []);

    const runStream = useCallback(
        async (sessionId: string) => {
            const token = getTokenFromCookie(TokenKey.accessToken);
            const instituteId = getInstituteId();
            const controller = new AbortController();
            abortRef.current = controller;
            setStatus('streaming');

            try {
                const response = await fetch(ASSISTANT_SESSION_STREAM(sessionId), {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token ?? ''}`,
                        ...(instituteId ? { clientId: instituteId } : {}),
                        Accept: 'text/event-stream',
                    },
                    signal: controller.signal,
                });

                if (!response.ok || !response.body) {
                    if (response.status === 402) {
                        setError(CREDITS_EXHAUSTED_MSG);
                    } else {
                        setError(GENERIC_ERROR_MSG);
                    }
                    setStatus('error');
                    return;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const { frames, rest } = parseSseBuffer(buffer);
                    buffer = rest;
                    for (const frame of frames) {
                        if (frame.event === 'token') {
                            const data = frame.data as { content?: string };
                            if (data?.content) appendToStreamingAssistant(data.content);
                        } else if (frame.event === 'message') {
                            const data = frame.data as AssistantMessageData;
                            if (data?.type === 'assistant') {
                                finalizeAssistant(data.content || '');
                            } else if (data?.type === 'tool_call') {
                                // Surface tool activity as a small status line so the
                                // user sees what the assistant is doing while it works.
                                const toolName = String(
                                    (data.metadata as { tool_name?: string } | null)?.tool_name ??
                                        ''
                                );
                                const label = TOOL_ACTIVITY_LABELS[toolName];
                                if (label) {
                                    setMessages((prev) => [
                                        ...prev,
                                        {
                                            id: `status-${data.id ?? crypto.randomUUID()}`,
                                            role: 'status',
                                            content: label,
                                        },
                                    ]);
                                }
                            }
                            // tool_result stays hidden — the answer summarizes it.
                        } else if (frame.event === 'action_request') {
                            const data = frame.data as AssistantActionRequestData;
                            if (data?.action_id) {
                                setMessages((prev) => [
                                    ...prev,
                                    {
                                        id: `action-${data.action_id}`,
                                        role: 'action',
                                        content: data.summary || 'Confirm this change?',
                                        action: {
                                            actionId: data.action_id,
                                            summary: data.summary || '',
                                            status: 'pending',
                                            details: cardLines(data.details),
                                            warnings: cardLines(data.warnings),
                                        },
                                    },
                                ]);
                            }
                        } else if (frame.event === 'error') {
                            const data = frame.data as AssistantErrorData;
                            setError(
                                data?.code === 402
                                    ? CREDITS_EXHAUSTED_MSG
                                    : data?.message || GENERIC_ERROR_MSG
                            );
                        }
                    }
                }
                setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
            } catch (e) {
                if ((e as Error)?.name === 'AbortError') return;
                setError('The assistant connection was interrupted. Please try again.');
                setStatus('error');
            } finally {
                // Any bubble still flagged streaming is now complete.
                setMessages((prev) =>
                    prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
                );
            }
        },
        [appendToStreamingAssistant, finalizeAssistant]
    );

    const sendMessage = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || status === 'streaming' || status === 'connecting') return;

            setError(null);
            setMessages((prev) => [
                ...prev,
                { id: crypto.randomUUID(), role: 'user', content: trimmed },
            ]);
            setStatus('connecting');

            try {
                const contextMeta = getPageContext();
                let sessionId = sessionIdRef.current;
                if (!sessionId) {
                    const resp = await authenticatedAxiosInstance.post(ASSISTANT_SESSION_INIT, {
                        initial_message: trimmed,
                        context_meta: contextMeta,
                    });
                    sessionId = resp.data?.session_id ?? null;
                    sessionIdRef.current = sessionId;
                } else {
                    await authenticatedAxiosInstance.post(ASSISTANT_SESSION_MESSAGE(sessionId), {
                        message: trimmed,
                        context_meta: contextMeta,
                    });
                }

                if (!sessionId) throw new Error('No session id returned');
                await runStream(sessionId);
            } catch (e) {
                const httpStatus = (e as { response?: { status?: number } })?.response?.status;
                setError(httpStatus === 402 ? CREDITS_EXHAUSTED_MSG : GENERIC_ERROR_MSG);
                setStatus('error');
            }
        },
        [runStream, status]
    );

    const setActionStatus = useCallback((actionId: string, status: AssistantActionStatus) => {
        setMessages((prev) =>
            prev.map((m) =>
                m.action?.actionId === actionId ? { ...m, action: { ...m.action, status } } : m
            )
        );
    }, []);

    /** Confirm or cancel a pending write action (the nonce-backed card). */
    const resolveAction = useCallback(
        async (actionId: string, decision: 'confirm' | 'cancel') => {
            const sessionId = sessionIdRef.current;
            if (!sessionId) return;
            setActionStatus(actionId, 'working');
            try {
                const url =
                    decision === 'confirm'
                        ? ASSISTANT_ACTION_CONFIRM(sessionId, actionId)
                        : ASSISTANT_ACTION_CANCEL(sessionId, actionId);
                const resp = await authenticatedAxiosInstance.post(url);
                const status = String(resp.data?.status || '').toLowerCase();
                const mapped = actionStatusFrom(status);
                setActionStatus(actionId, mapped);
                if (resp.data?.message) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            role: 'assistant',
                            content: String(resp.data.message),
                        },
                    ]);
                }
            } catch {
                setActionStatus(actionId, 'pending');
                setError('Could not process that action. Please try again.');
            }
        },
        [setActionStatus]
    );

    const reset = useCallback(async () => {
        abortRef.current?.abort();
        const sid = sessionIdRef.current;
        sessionIdRef.current = null;
        setMessages([]);
        setError(null);
        setStatus('idle');
        if (sid) {
            try {
                await authenticatedAxiosInstance.post(ASSISTANT_SESSION_CLOSE(sid));
            } catch {
                // Best-effort close; the session expires on its own otherwise.
            }
        }
    }, []);

    return { messages, status, error, sendMessage, reset, resolveAction };
}
