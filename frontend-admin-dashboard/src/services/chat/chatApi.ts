import { BASE_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getChatUser } from './getChatUser';

/** Chat base — notification-service v1. */
export const CHAT_BASE = `${BASE_URL}/notification-service/v1/chat`;
export const SSE_BASE = `${BASE_URL}/notification-service/v1/sse`;

// ──────────────────────────────────────────────────────────────────────────
// Types (mirror the API contract exactly)
// ──────────────────────────────────────────────────────────────────────────
export type ChatConversationType = 'DIRECT' | 'BATCH_GROUP' | 'COMMUNITY';

export interface ChatConversationResponse {
    id: string;
    type: ChatConversationType;
    instituteId: string;
    referenceId?: string;
    title?: string;
    otherUserId?: string;
    lastMessagePreview?: string;
    lastMessageSenderId?: string;
    lastMessageAt?: string;
    lastMessageSeq?: number;
    unreadCount: number;
    memberRole?: string;
    rulesVersion?: number;
    canPost: boolean;
    /** Institute setting (students only): may the caller edit/delete a message THEY sent? */
    canEditOwnMessages?: boolean;
    canDeleteOwnMessages?: boolean;
}

export interface ChatMessageResponse {
    id: string;
    conversationId: string;
    senderId: string;
    senderName?: string;
    senderRole?: string;
    contentType: string;
    content?: string;
    attachmentUrl?: string;
    attachmentName?: string;
    attachmentMime?: string;
    attachmentSize?: number;
    replyToMessageId?: string;
    seq: number;
    isEdited?: boolean;
    isDeleted?: boolean;
    isFlagged?: boolean;
    createdAt: string;
}

export interface ChatMessagePageResponse {
    messages: ChatMessageResponse[];
    hasMore: boolean;
    oldestSeq?: number;
    latestSeq?: number;
}

export interface ChatPersonResponse {
    userId: string;
    fullName?: string;
    email?: string;
    mobileNumber?: string;
    role: string;
}

export interface SendChatMessageRequest {
    contentType?: string;
    text?: string;
    richTextType?: string;
    attachmentUrl?: string;
    attachmentName?: string;
    attachmentMime?: string;
    attachmentSize?: number;
    replyToMessageId?: string;
    clientDedupKey?: string;
}

export interface ChatRulesGuidelines {
    title?: string;
    items?: string[];
}

export interface ChatRulesPosting {
    slow_mode_seconds?: number;
    allow_links?: boolean;
    allow_attachments?: boolean;
    new_member_readonly_minutes?: number;
}

export interface ChatRulesAutoModeration {
    banned_keywords?: string[];
    action?: 'BLOCK' | 'FLAG';
}

export interface ChatRulesDto {
    guidelines?: ChatRulesGuidelines;
    acknowledgement_required?: boolean;
    posting?: ChatRulesPosting;
    auto_moderation?: ChatRulesAutoModeration;
}

export interface ChatRulesResponse {
    rules?: ChatRulesDto;
    currentVersion: number;
    acknowledged: boolean;
    isOverride: boolean;
    canEdit: boolean;
}

export interface ChatReportResponse {
    id: string;
    instituteId: string;
    conversationId: string;
    conversationType?: ChatConversationType;
    messageId?: string;
    reporterId: string;
    reason: string;
    details?: string;
    status: string;
    reviewedBy?: string;
    reviewedAt?: string;
    createdAt: string;
    reportedMessage?: ChatMessageResponse;
}

export interface ChatBatchResponse {
    packageSessionId: string;
    name?: string;
    /** Existing batch-group conversation id, or undefined if the batch has no conversation yet. */
    conversationId?: string;
}

export interface ChatBatchSearchResponse {
    batches: ChatBatchResponse[];
}

export interface ChatPeopleSearchRequest {
    roles?: string[];
    nameQuery?: string;
    pageNumber: number;
    pageSize: number;
}

export interface ChatPeopleSearchResponse {
    people: ChatPersonResponse[];
    pageNumber: number;
    pageSize: number;
    totalElements: number;
    hasNext: boolean;
}

export interface SpringPage<T> {
    content: T[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
    first: boolean;
    last: boolean;
}

export interface CreateReportRequest {
    conversationId: string;
    messageId?: string;
    reason: string;
    details?: string;
}

export type ReportStatus = 'OPEN' | 'REVIEWING' | 'ACTIONED' | 'DISMISSED';

// ──────────────────────────────────────────────────────────────────────────
// SSE event payloads
// ──────────────────────────────────────────────────────────────────────────
export interface ChatMessagePayload {
    conversationId: string;
    conversationType: ChatConversationType;
    message?: ChatMessageResponse;
    readerUserId?: string;
    lastReadSeq?: number;
}

export interface ChatAnnouncementEvent {
    type: 'CHAT_MESSAGE' | 'CHAT_READ';
    modeType: 'CHAT';
    instituteId: string;
    eventId: string;
    data: ChatMessagePayload;
}

// ──────────────────────────────────────────────────────────────────────────
// Endpoint helpers — identity is always threaded as query params.
// ──────────────────────────────────────────────────────────────────────────
const identityParams = () => {
    const { userId, instituteId, userRole, userName } = getChatUser();
    return { userId, instituteId, userRole, userName };
};

export const listConversations = async (
    type?: ChatConversationType,
    limit = 30
): Promise<ChatConversationResponse[]> => {
    const res = await authenticatedAxiosInstance.get(`${CHAT_BASE}/conversations`, {
        params: { ...identityParams(), ...(type ? { type } : {}), limit },
    });
    return res.data;
};

export const getMessages = async (
    conversationId: string,
    opts: { beforeCursor?: number; sinceCursor?: number; limit?: number } = {}
): Promise<ChatMessagePageResponse> => {
    const { userId } = getChatUser();
    const res = await authenticatedAxiosInstance.get(
        `${CHAT_BASE}/conversations/${conversationId}/messages`,
        {
            params: {
                userId,
                ...(opts.beforeCursor != null ? { beforeCursor: opts.beforeCursor } : {}),
                ...(opts.sinceCursor != null ? { sinceCursor: opts.sinceCursor } : {}),
                limit: opts.limit ?? 40,
            },
        }
    );
    return res.data;
};

export const sendMessage = async (
    conversationId: string,
    body: SendChatMessageRequest
): Promise<ChatMessageResponse> => {
    const { userId, userRole, userName } = getChatUser();
    const res = await authenticatedAxiosInstance.post(
        `${CHAT_BASE}/conversations/${conversationId}/messages`,
        body,
        { params: { userId, userRole, userName } }
    );
    return res.data;
};

export interface EditChatMessageRequest {
    text: string;
    richTextType?: string;
}

/**
 * Rewrite the body of a message you sent. Sender-only server-side; the message keeps its position in
 * the thread and comes back with `isEdited` set.
 */
export const editMessage = async (
    conversationId: string,
    messageId: string,
    body: EditChatMessageRequest
): Promise<ChatMessageResponse> => {
    const res = await authenticatedAxiosInstance.patch(
        `${CHAT_BASE}/conversations/${conversationId}/messages/${messageId}`,
        body
    );
    return res.data;
};

export const deleteMessage = async (
    conversationId: string,
    messageId: string
): Promise<ChatMessageResponse> => {
    // Identity is derived server-side from the auth principal + clientId header;
    // no identity query params are threaded here.
    const res = await authenticatedAxiosInstance.delete(
        `${CHAT_BASE}/conversations/${conversationId}/messages/${messageId}`
    );
    return res.data;
};

export const markRead = async (
    conversationId: string,
    upToMessageId: string
): Promise<{ success: boolean }> => {
    const { userId } = getChatUser();
    const res = await authenticatedAxiosInstance.post(
        `${CHAT_BASE}/conversations/${conversationId}/read`,
        { upToMessageId },
        { params: { userId } }
    );
    return res.data;
};

export const createDirectConversation = async (body: {
    targetUserId: string;
    targetUserName?: string;
    targetUserRole?: string;
}): Promise<ChatConversationResponse> => {
    const res = await authenticatedAxiosInstance.post(`${CHAT_BASE}/conversations/direct`, body, {
        params: identityParams(),
    });
    return res.data;
};

export const createBatchConversation = async (
    packageSessionId: string
): Promise<ChatConversationResponse> => {
    const res = await authenticatedAxiosInstance.post(
        `${CHAT_BASE}/conversations/batch/${packageSessionId}`,
        {},
        { params: identityParams() }
    );
    return res.data;
};

export const createCommunityConversation = async (): Promise<ChatConversationResponse> => {
    const res = await authenticatedAxiosInstance.post(
        `${CHAT_BASE}/conversations/community`,
        {},
        { params: identityParams() }
    );
    return res.data;
};

export const getRules = async (conversationId: string): Promise<ChatRulesResponse> => {
    const { userId } = getChatUser();
    const res = await authenticatedAxiosInstance.get(
        `${CHAT_BASE}/conversations/${conversationId}/rules`,
        { params: { userId } }
    );
    return res.data;
};

export const updateRules = async (
    conversationId: string,
    rules: ChatRulesDto
): Promise<ChatRulesResponse> => {
    const { userId } = getChatUser();
    const res = await authenticatedAxiosInstance.put(
        `${CHAT_BASE}/conversations/${conversationId}/rules`,
        { rules },
        { params: { userId } }
    );
    return res.data;
};

export const acknowledgeRules = async (conversationId: string): Promise<ChatRulesResponse> => {
    const { userId, userRole, userName } = getChatUser();
    const res = await authenticatedAxiosInstance.post(
        `${CHAT_BASE}/conversations/${conversationId}/rules/acknowledge`,
        {},
        { params: { userId, userRole, userName } }
    );
    return res.data;
};

export const searchPeople = async (
    body: ChatPeopleSearchRequest
): Promise<ChatPeopleSearchResponse> => {
    const { userId, instituteId, userRole } = getChatUser();
    const res = await authenticatedAxiosInstance.post(`${CHAT_BASE}/people/search`, body, {
        params: { userId, instituteId, userRole },
    });
    return res.data;
};

/**
 * Search batches to start/open a batch conversation. Role-scoped server-side:
 * admin = all institute batches, teacher = faculty-mapped batches, students = none.
 */
export const searchBatches = async (
    nameQuery?: string,
    pageSize = 30
): Promise<ChatBatchSearchResponse> => {
    const res = await authenticatedAxiosInstance.post(
        `${CHAT_BASE}/batches/search`,
        { nameQuery, pageSize },
        { params: identityParams() }
    );
    return res.data;
};

export const createReport = async (body: CreateReportRequest): Promise<ChatReportResponse> => {
    const { userId } = getChatUser();
    const res = await authenticatedAxiosInstance.post(`${CHAT_BASE}/reports`, body, {
        params: { userId },
    });
    return res.data;
};

export const listAdminReports = async (
    status?: ReportStatus,
    page = 0,
    size = 20
): Promise<SpringPage<ChatReportResponse>> => {
    const { instituteId } = getChatUser();
    const res = await authenticatedAxiosInstance.get(`${CHAT_BASE}/reports/admin`, {
        params: { instituteId, ...(status ? { status } : {}), page, size },
    });
    return res.data;
};

export const reviewReport = async (
    reportId: string,
    status: ReportStatus
): Promise<ChatReportResponse> => {
    const { userId } = getChatUser();
    const res = await authenticatedAxiosInstance.patch(
        `${CHAT_BASE}/reports/admin/${reportId}`,
        { status },
        { params: { userId } }
    );
    return res.data;
};

// ──────────────────────────────────────────────────────────────────────────
// Send rejection mapping
// ──────────────────────────────────────────────────────────────────────────
/**
 * Backend rule-rejection codes the send endpoint raises (as the
 * ResponseStatusException reason / response message). These are deterministic
 * 4xx rejections — the message should NOT be re-queued as a failed send.
 */
export type ChatRejectionCode =
    | 'SLOW_MODE'
    | 'BLOCKED_BY_MODERATION'
    | 'RULES_NOT_ACKNOWLEDGED'
    | 'LINKS_NOT_ALLOWED'
    | 'ATTACHMENTS_NOT_ALLOWED'
    | 'NEW_MEMBER_READONLY'
    | 'CHAT_DISABLED';

const REJECTION_MESSAGES: Record<ChatRejectionCode, string> = {
    SLOW_MODE: 'Slow mode is on — please wait a moment before posting again.',
    BLOCKED_BY_MODERATION: 'Your message was blocked by the community guidelines.',
    RULES_NOT_ACKNOWLEDGED: 'Accept the community guidelines above to post.',
    LINKS_NOT_ALLOWED: 'Links are not allowed in this conversation.',
    ATTACHMENTS_NOT_ALLOWED: 'Attachments are not allowed in this conversation.',
    NEW_MEMBER_READONLY: "New members can't post yet — please try again later.",
    CHAT_DISABLED: 'Chat is currently disabled for this institute.',
};

/**
 * Why opening a direct conversation failed, in words that match reality.
 *
 * The open-a-DM endpoint rejects with a different set of codes than sending a
 * message does, and all of them are permanent: chat switched off for the institute,
 * or a role pair the institute's DM matrix forbids. A generic "please try again"
 * on those sends people round a loop that can never finish, so each gets its own
 * sentence and only genuinely transient failures keep the retry wording.
 */
export const describeDirectChatError = (err: unknown, fallback: string): string => {
    const response = (err as { response?: { status?: number; data?: { message?: string } } })
        ?.response;
    const status = response?.status;
    if (status == null || status < 400 || status >= 500) return fallback;
    const raw = response?.data?.message ?? '';
    if (raw.includes('CHAT_DISABLED')) {
        return 'In-app messaging is turned off for this institute. Enable Chat in Settings to message from here.';
    }
    if (raw.includes('DM_NOT_ALLOWED')) {
        return "Your institute's chat settings don't allow direct messages between these two roles.";
    }
    if (raw.includes('CANNOT_DM_SELF')) return "You can't message yourself.";
    if (raw.includes('TARGET_REQUIRED')) return "That person's account is missing, so a chat can't be opened.";
    return fallback;
};

/**
 * Explains why a delete was refused. The server distinguishes "you may not moderate here" from a
 * transient failure, and a blanket "please try again" on the former sends a moderator round a loop
 * that can never succeed.
 */
export const describeDeleteChatError = (err: unknown): string => {
    const response = (err as { response?: { status?: number; data?: { message?: string } } })
        ?.response;
    const raw = response?.data?.message ?? '';
    if (raw.includes('NOT_ALLOWED')) {
        return 'Only the sender or a moderator of this conversation can delete this message.';
    }
    if (raw.includes('MESSAGE_NOT_FOUND')) return 'That message is no longer available.';
    return 'Failed to delete the message.';
};

/**
 * Explains why an edit was refused, so a rule rejection reads as a rule rejection rather than a
 * "try again" the user can never satisfy.
 */
export const describeEditChatError = (err: unknown): string => {
    const response = (err as { response?: { status?: number; data?: { message?: string } } })
        ?.response;
    const raw = response?.data?.message ?? '';
    if (raw.includes('NOT_THE_SENDER')) return 'You can only edit your own messages.';
    if (raw.includes('MESSAGE_DELETED'))
        return 'This message was deleted and can no longer be edited.';
    if (raw.includes('EMPTY_MESSAGE')) return 'A message cannot be empty — delete it instead.';
    if (raw.includes('BLOCKED_BY_MODERATION')) {
        return "That wording isn't allowed by this channel's rules.";
    }
    if (raw.includes('LINKS_NOT_ALLOWED')) return "This channel's rules don't allow links.";
    if (raw.includes('CHAT_DISABLED')) return 'Chat is turned off for this institute.';
    if (raw.includes('MESSAGE_NOT_FOUND')) return 'That message is no longer available.';
    return 'Failed to save the edit.';
};

/**
 * Maps a send-failure error to a known rule-rejection. Returns the code +
 * friendly message for deterministic 4xx rejections, or null for transient
 * errors (network/5xx) that should leave the message in a retryable failed state.
 */
export const classifyChatSendError = (
    err: unknown
): { code: ChatRejectionCode; message: string } | null => {
    const response = (err as { response?: { status?: number; data?: { message?: string } } })
        ?.response;
    const status = response?.status;
    if (status == null || status < 400 || status >= 500) return null;
    const raw = response?.data?.message ?? '';
    const code = (Object.keys(REJECTION_MESSAGES) as ChatRejectionCode[]).find((c) =>
        raw.includes(c)
    );
    if (!code) return null;
    return { code, message: REJECTION_MESSAGES[code] };
};
