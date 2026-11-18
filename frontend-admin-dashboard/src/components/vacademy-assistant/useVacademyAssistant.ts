import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    ASSISTANT_SESSION_VIEW,
    ASSISTANT_SESSION_CONTINUE,
} from '@/constants/urls';
import { useSelectedStudentMirrorStore } from '@/stores/assistant/selected-student-mirror';
import type {
    AssistantActionRequestData,
    AssistantActionStatus,
    AssistantChatView,
    AssistantErrorData,
    AssistantMessage,
    AssistantMessageData,
    AssistantPastChat,
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
    learners: 'Searching learners…',
    learner_report: 'Fetching learner data…',
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

/** Most follow-up chips shown under an answer, and the longest one kept. */
const MAX_FOLLOW_UPS = 3;
const MAX_FOLLOW_UP_CHARS = 120;

/**
 * Follow-up questions from a message event or a history message: strings only, trimmed, at most
 * three. Nothing when the answer came without any (they are never made up here).
 */
export function followUps(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out = value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v !== '' && v.length <= MAX_FOLLOW_UP_CHARS)
        .slice(0, MAX_FOLLOW_UPS);
    return out.length ? out : undefined;
}

/**
 * A history chat as panel messages. Its cards are read-only: one still open in its own chat is
 * shown as expired, since continuing the chat retires it.
 */
export function messagesFromHistory(view: AssistantChatView): AssistantMessage[] {
    return (view.messages ?? []).map((m) => {
        const base = { id: `history-${m.id}`, createdAt: m.created_at ?? undefined };
        if (m.role === 'action' && m.action) {
            const status: AssistantActionStatus =
                m.action.status === 'pending' ? 'expired' : m.action.status;
            return {
                ...base,
                role: 'action',
                content: m.action.summary || m.content,
                action: {
                    actionId: '',
                    summary: m.action.summary || m.content,
                    status,
                    details: cardLines(m.action.details),
                    warnings: cardLines(m.action.warnings),
                },
            };
        }
        return {
            ...base,
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content ?? '',
            suggestions: m.role === 'assistant' ? followUps(m.suggestions) : undefined,
        };
    });
}

const nowIso = () => new Date().toISOString();

/**
 * Drives one Vacademy Assistant conversation: creates/reuses a session, posts
 * the user message through the authenticated axios instance (so it inherits the
 * `Authorization` + `clientId` headers and the `/ai-service` 401 exemption),
 * then reads the SSE answer via fetch (EventSource can't send the auth header).
 *
 * A chat picked from the history opens read-only (`pastChat`); continuing it
 * (explicitly, or by sending a message) reopens it on the server so new
 * questions go into the same conversation.
 */
export function useVacademyAssistant() {
    const { t } = useTranslation('dashboardIndex');
    const [messages, setMessages] = useState<AssistantMessage[]>([]);
    const [status, setStatus] = useState<AssistantStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    /** What the assistant is doing right now (a tool's progress line), while it works. */
    const [activity, setActivity] = useState<string | null>(null);
    const [sessionId, setSessionIdState] = useState<string | null>(null);
    const [pastChat, setPastChatState] = useState<AssistantPastChat | null>(null);
    const [loadingChat, setLoadingChat] = useState(false);
    const sessionIdRef = useRef<string | null>(null);
    const pastChatRef = useRef<AssistantPastChat | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const setSessionId = useCallback((id: string | null) => {
        sessionIdRef.current = id;
        setSessionIdState(id);
    }, []);
    const setPastChat = useCallback((chat: AssistantPastChat | null) => {
        pastChatRef.current = chat;
        setPastChatState(chat);
    }, []);

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
                    createdAt: nowIso(),
                });
            }
            return next;
        });
    }, []);

    const finalizeAssistant = useCallback((content: string, suggestions?: string[]) => {
        setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant' && last.streaming) {
                next[next.length - 1] = {
                    ...last,
                    content: content || last.content,
                    streaming: false,
                    suggestions,
                };
            } else if (content) {
                next.push({
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content,
                    streaming: false,
                    createdAt: nowIso(),
                    suggestions,
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
                            if (data?.content) {
                                setActivity(null);
                                appendToStreamingAssistant(data.content);
                            }
                        } else if (frame.event === 'message') {
                            const data = frame.data as AssistantMessageData;
                            if (data?.type === 'assistant') {
                                setActivity(null);
                                finalizeAssistant(
                                    data.content || '',
                                    followUps(
                                        data.suggestions ??
                                            (data.metadata as { suggestions?: unknown } | null)
                                                ?.suggestions
                                    )
                                );
                            } else if (data?.type === 'tool_call') {
                                // One progress line in a fixed slot (it replaces the previous
                                // one), so the conversation does not jump while tools run.
                                const toolName = String(
                                    (data.metadata as { tool_name?: string } | null)?.tool_name ??
                                        ''
                                );
                                setActivity(
                                    TOOL_ACTIVITY_LABELS[toolName] ??
                                        t('assistant.panel.activity.working')
                                );
                            }
                            // tool_result stays hidden — the answer summarizes it.
                        } else if (frame.event === 'action_request') {
                            const data = frame.data as AssistantActionRequestData;
                            if (data?.action_id) {
                                setActivity(null);
                                setMessages((prev) => [
                                    ...prev,
                                    {
                                        id: `action-${data.action_id}`,
                                        role: 'action',
                                        content: data.summary || 'Confirm this change?',
                                        createdAt: nowIso(),
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
                setActivity(null);
                // Any bubble still flagged streaming is now complete.
                setMessages((prev) =>
                    prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
                );
            }
        },
        [appendToStreamingAssistant, finalizeAssistant, t]
    );

    /**
     * Reopen the past chat on screen so new messages go into it. Its open cards were retired by
     * the server, so they are shown as expired. False when it could not be reopened.
     */
    const continueChat = useCallback(async (): Promise<boolean> => {
        const chat = pastChatRef.current;
        if (!chat) return true;
        try {
            await authenticatedAxiosInstance.post(ASSISTANT_SESSION_CONTINUE(chat.id));
        } catch {
            setError(t('assistant.panel.errors.continue'));
            return false;
        }
        setSessionId(chat.id);
        setPastChat(null);
        setMessages((prev) =>
            prev.map((m) =>
                m.action && (m.action.status === 'pending' || m.action.status === 'working')
                    ? { ...m, action: { ...m.action, status: 'expired' } }
                    : m
            )
        );
        return true;
    }, [setPastChat, setSessionId, t]);

    const sendMessage = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || status === 'streaming' || status === 'connecting') return;

            setError(null);
            // Sending from a past chat continues it first.
            if (pastChatRef.current && !(await continueChat())) return;
            setMessages((prev) => [
                ...prev.map((m) => (m.suggestions ? { ...m, suggestions: undefined } : m)),
                { id: crypto.randomUUID(), role: 'user', content: trimmed, createdAt: nowIso() },
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
                    setSessionId(sessionId);
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
        [continueChat, runStream, setSessionId, status]
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
            if (!sessionId || !actionId) return;
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
                            createdAt: nowIso(),
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

    /** Leave the live chat for an empty one; the live chat is closed (it stays in the history). */
    const reset = useCallback(async () => {
        abortRef.current?.abort();
        const sid = sessionIdRef.current;
        setSessionId(null);
        setPastChat(null);
        setMessages([]);
        setError(null);
        setActivity(null);
        setStatus('idle');
        if (sid) {
            try {
                await authenticatedAxiosInstance.post(ASSISTANT_SESSION_CLOSE(sid));
            } catch {
                // Best-effort close; the session expires on its own otherwise.
            }
        }
    }, [setPastChat, setSessionId]);

    /**
     * Show a chat from the history, read-only until it is continued. Picking the live chat just
     * returns to it. False when the chat could not be loaded (the live chat stays on screen).
     */
    const openChat = useCallback(
        async (id: string): Promise<boolean> => {
            if (!id) return false;
            if (id === sessionIdRef.current || id === pastChatRef.current?.id) return true;
            setLoadingChat(true);
            setError(null);
            let view: AssistantChatView | null = null;
            try {
                view = (await authenticatedAxiosInstance.get(ASSISTANT_SESSION_VIEW(id)))
                    .data as AssistantChatView;
            } catch {
                setError(t('assistant.panel.errors.loadChat'));
            }
            setLoadingChat(false);
            if (!view || !Array.isArray(view.messages)) return false;
            await reset();
            setMessages(messagesFromHistory(view));
            setPastChat({ id: view.id || id, title: view.title || '' });
            return true;
        },
        [reset, setPastChat, t]
    );

    /** Forget a chat the panel shows once it was deleted from the history. */
    const forgetChat = useCallback(
        (id: string) => {
            if (id === sessionIdRef.current || id === pastChatRef.current?.id) {
                abortRef.current?.abort();
                setSessionId(null);
                setPastChat(null);
                setMessages([]);
                setError(null);
                setActivity(null);
                setStatus('idle');
            }
        },
        [setPastChat, setSessionId]
    );

    return {
        messages,
        status,
        error,
        activity,
        sessionId,
        pastChat,
        loadingChat,
        sendMessage,
        reset,
        resolveAction,
        openChat,
        continueChat,
        forgetChat,
    };
}
