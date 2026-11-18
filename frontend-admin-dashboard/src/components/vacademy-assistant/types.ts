// Types for the Vacademy Assistant widget. The SSE payload shapes mirror
// ai_service app/routers/assistant.py / assistant_service.py.

export type AssistantRole = 'user' | 'assistant' | 'action' | 'status';

/** GET /assistant/capabilities — the tool groups THIS caller may use. */
export interface AssistantCapabilities {
    groups: Array<{ key: string; mode: 'READ' | 'WRITE'; tools: string[] }>;
}

/**
 * `applying`: another Confirm of the same card is already running it. `expired`: the card can no
 * longer be confirmed (it timed out, or its chat was reopened from the history).
 */
export type AssistantActionStatus =
    | 'pending'
    | 'working'
    | 'applying'
    | 'executed'
    | 'cancelled'
    | 'failed'
    | 'expired';

/** A proposed write awaiting the user's Confirm/Cancel (nonce-backed card). */
export interface AssistantAction {
    actionId: string;
    summary: string;
    status: AssistantActionStatus;
    /** What changes, one line each (e.g. a lead and its status from → to). */
    details?: string[];
    /** What the user should know before confirming (shown highlighted). */
    warnings?: string[];
}

export interface AssistantMessage {
    id: string;
    role: AssistantRole;
    content: string;
    /** True while assistant tokens are still streaming into this bubble. */
    streaming?: boolean;
    /** Present when role === 'action'. */
    action?: AssistantAction;
    /** ISO time the message was written (shown as a subtle timestamp). */
    createdAt?: string;
    /** Follow-up questions offered after an assistant answer (at most three). */
    suggestions?: string[];
}

/** `event: action_request` — the backend proposed a write and wants confirmation. */
export interface AssistantActionRequestData {
    action_id: string;
    tool: string;
    summary: string;
    expires_at?: string;
    details?: string[];
    warnings?: string[];
}

export type AssistantStatus = 'idle' | 'connecting' | 'streaming' | 'error';

/** `event: token`  — a streamed chunk of the assistant's answer. */
export interface AssistantTokenData {
    content: string;
}

/** `event: message` — a persisted message row. */
export interface AssistantMessageData {
    id: number | string;
    type: 'user' | 'assistant' | 'tool_call' | 'tool_result';
    content: string;
    metadata?: Record<string, unknown> | null;
    created_at?: string;
    /** Follow-up questions for an assistant answer (also in metadata.suggestions). */
    suggestions?: string[];
}

/** GET /assistant/sessions — one of the caller's chats. */
export interface AssistantChatSummary {
    id: string;
    title: string;
    last_active: string | null;
    message_count: number;
    is_open: boolean;
}

export interface AssistantChatList {
    items: AssistantChatSummary[];
    page: number;
    page_size: number;
    has_more: boolean;
}

/** GET /assistant/sessions/{id} — one chat as the panel shows it. */
export interface AssistantChatView {
    id: string;
    title: string;
    is_open: boolean;
    last_active: string | null;
    messages: Array<{
        id: string;
        role: 'user' | 'assistant' | 'action';
        content: string;
        created_at?: string | null;
        suggestions?: string[] | null;
        action?: {
            summary: string;
            status: 'pending' | 'applying' | 'executed' | 'cancelled' | 'failed' | 'expired';
            details?: string[] | null;
            warnings?: string[] | null;
        } | null;
    }>;
}

/** A past chat open in the panel: read-only until it is continued. */
export interface AssistantPastChat {
    id: string;
    title: string;
}

/** `event: error` — a recoverable error (e.g. code 402 = out of credits). */
export interface AssistantErrorData {
    type?: string;
    code?: number;
    message: string;
}
