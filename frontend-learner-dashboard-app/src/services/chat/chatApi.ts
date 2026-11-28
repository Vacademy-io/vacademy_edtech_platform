import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getChatUser } from "./getChatUser";

/** Base for all chat endpoints. */
const CHAT_BASE = `${BASE_URL}/notification-service/v1/chat`;

// ── Types (mirror the backend contract) ──────────────────────────────────────

export type ChatConversationType = "DIRECT" | "BATCH_GROUP" | "COMMUNITY";

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
  action?: "BLOCK" | "FLAG";
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

export interface PeopleSearchRequest {
  roles?: string[];
  nameQuery?: string;
  pageNumber: number;
  pageSize: number;
}

export interface PeopleSearchResponse {
  people: ChatPersonResponse[];
  pageNumber: number;
  pageSize: number;
  totalElements: number;
  hasNext: boolean;
}

export interface ChatReportRequest {
  conversationId: string;
  messageId?: string;
  reason: string;
  details?: string;
}

// ── Real-time SSE payload shapes ─────────────────────────────────────────────

export type ChatEventType = "CHAT_MESSAGE" | "CHAT_READ";

export interface ChatMessagePayload {
  conversationId: string;
  conversationType: ChatConversationType;
  message?: ChatMessageResponse;
  readerUserId?: string;
  lastReadSeq?: number;
}

export interface ChatAnnouncementEvent {
  type: ChatEventType;
  modeType: "CHAT";
  instituteId: string;
  eventId: string;
  data: ChatMessagePayload;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/**
 * React Query key for the conversation list. Shared by ChatScreen (which patches it live from the
 * SSE stream) and the sidebar unread badge, so both read the same cached list.
 */
export const CONVERSATIONS_KEY = ["chat", "conversations"] as const;

/** React Query key for the unread total behind the sidebar badge (see getUnreadCount). */
export const UNREAD_COUNT_KEY = ["chat", "unread-count"] as const;

/** GET /conversations/unread-count — total unread for the badge; a cheap aggregate, safe to poll. */
export async function getUnreadCount(): Promise<number> {
  const res = await authenticatedAxiosInstance.get<{ count?: number }>(
    `${CHAT_BASE}/conversations/unread-count`,
  );
  return res.data?.count ?? 0;
}

/** GET /conversations — full list (DMs + batch groups + community), sorted desc. */
export async function listConversations(
  type?: ChatConversationType,
  limit = 30,
): Promise<ChatConversationResponse[]> {
  const { userId, instituteId, userRole } = await getChatUser();
  const res = await authenticatedAxiosInstance.get<ChatConversationResponse[]>(
    `${CHAT_BASE}/conversations`,
    { params: { userId, instituteId, userRole, type, limit } },
  );
  return res.data ?? [];
}

/** GET /conversations/{id}/messages — paginated history. */
export async function getMessages(
  conversationId: string,
  opts: { beforeCursor?: number; sinceCursor?: number; limit?: number } = {},
): Promise<ChatMessagePageResponse> {
  const { userId } = await getChatUser();
  const res = await authenticatedAxiosInstance.get<ChatMessagePageResponse>(
    `${CHAT_BASE}/conversations/${conversationId}/messages`,
    {
      params: {
        userId,
        beforeCursor: opts.beforeCursor,
        sinceCursor: opts.sinceCursor,
        limit: opts.limit ?? 40,
      },
    },
  );
  return res.data;
}

/** POST /conversations/{id}/messages — send a message. */
export async function sendMessage(
  conversationId: string,
  body: SendChatMessageRequest,
): Promise<ChatMessageResponse> {
  const { userId, userRole, userName } = await getChatUser();
  const res = await authenticatedAxiosInstance.post<ChatMessageResponse>(
    `${CHAT_BASE}/conversations/${conversationId}/messages`,
    body,
    { params: { userId, userRole, userName } },
  );
  return res.data;
}

/** DELETE /conversations/{id}/messages/{messageId} — soft-delete (tombstone) a message. */
export interface EditChatMessageRequest {
  text: string;
}

/** Rewrite the body of a message you sent. Sender-only server-side. */
export async function editMessage(
  conversationId: string,
  messageId: string,
  body: EditChatMessageRequest,
): Promise<ChatMessageResponse> {
  const res = await authenticatedAxiosInstance.patch<ChatMessageResponse>(
    `${CHAT_BASE}/conversations/${conversationId}/messages/${messageId}`,
    body,
  );
  return res.data;
}

export async function deleteMessage(
  conversationId: string,
  messageId: string,
): Promise<ChatMessageResponse> {
  const res = await authenticatedAxiosInstance.delete<ChatMessageResponse>(
    `${CHAT_BASE}/conversations/${conversationId}/messages/${messageId}`,
  );
  return res.data;
}

/** POST /conversations/{id}/read — mark read up to a message. */
export async function markRead(
  conversationId: string,
  upToMessageId: string,
): Promise<{ success: boolean }> {
  const { userId } = await getChatUser();
  const res = await authenticatedAxiosInstance.post<{ success: boolean }>(
    `${CHAT_BASE}/conversations/${conversationId}/read`,
    { upToMessageId },
    { params: { userId } },
  );
  return res.data;
}

/** POST /conversations/direct — open/get a 1:1 DM with a target user. */
export async function openDirectConversation(body: {
  targetUserId: string;
  targetUserName?: string;
  targetUserRole?: string;
}): Promise<ChatConversationResponse> {
  const { userId, instituteId, userRole, userName } = await getChatUser();
  const res = await authenticatedAxiosInstance.post<ChatConversationResponse>(
    `${CHAT_BASE}/conversations/direct`,
    body,
    { params: { userId, instituteId, userRole, userName } },
  );
  return res.data;
}

/** POST /conversations/batch/{packageSessionId} — open/get the batch group. */
export async function openBatchConversation(
  packageSessionId: string,
): Promise<ChatConversationResponse> {
  const { userId, instituteId, userRole, userName } = await getChatUser();
  const res = await authenticatedAxiosInstance.post<ChatConversationResponse>(
    `${CHAT_BASE}/conversations/batch/${packageSessionId}`,
    null,
    { params: { userId, instituteId, userRole, userName } },
  );
  return res.data;
}

/** POST /conversations/community — auto-provision / get the institute community. */
export async function openCommunityConversation(): Promise<ChatConversationResponse> {
  const { userId, instituteId, userRole, userName } = await getChatUser();
  const res = await authenticatedAxiosInstance.post<ChatConversationResponse>(
    `${CHAT_BASE}/conversations/community`,
    null,
    { params: { userId, instituteId, userRole, userName } },
  );
  return res.data;
}

/** GET /conversations/{id}/rules — fetch the effective rules + ack state. */
export async function getRules(
  conversationId: string,
): Promise<ChatRulesResponse> {
  const { userId } = await getChatUser();
  const res = await authenticatedAxiosInstance.get<ChatRulesResponse>(
    `${CHAT_BASE}/conversations/${conversationId}/rules`,
    { params: { userId } },
  );
  return res.data;
}

/** PUT /conversations/{id}/rules — update rules (admins only; canEdit gates UI). */
export async function updateRules(
  conversationId: string,
  rules: ChatRulesDto,
): Promise<ChatRulesResponse> {
  const { userId } = await getChatUser();
  const res = await authenticatedAxiosInstance.put<ChatRulesResponse>(
    `${CHAT_BASE}/conversations/${conversationId}/rules`,
    { rules },
    { params: { userId } },
  );
  return res.data;
}

/** POST /conversations/{id}/rules/acknowledge — accept the guidelines. */
export async function acknowledgeRules(
  conversationId: string,
): Promise<ChatRulesResponse> {
  const { userId, userRole, userName } = await getChatUser();
  const res = await authenticatedAxiosInstance.post<ChatRulesResponse>(
    `${CHAT_BASE}/conversations/${conversationId}/rules/acknowledge`,
    null,
    { params: { userId, userRole, userName } },
  );
  return res.data;
}

/** POST /chat/people/search — search people to start a DM with. */
export async function searchPeople(
  body: PeopleSearchRequest,
): Promise<PeopleSearchResponse> {
  const { userId, instituteId, userRole } = await getChatUser();
  const res = await authenticatedAxiosInstance.post<PeopleSearchResponse>(
    `${CHAT_BASE}/people/search`,
    body,
    { params: { userId, instituteId, userRole } },
  );
  return res.data;
}

/** POST /chat/reports — report a conversation or message. */
export async function reportChat(
  body: ChatReportRequest,
): Promise<ChatReportResponse> {
  const { userId } = await getChatUser();
  const res = await authenticatedAxiosInstance.post<ChatReportResponse>(
    `${CHAT_BASE}/reports`,
    body,
    { params: { userId } },
  );
  return res.data;
}


// Re-exported so callers keep importing chat helpers from one place, while the
// implementation stays free of URL/config imports and therefore unit-testable.
export { describeDirectChatError } from "./direct-chat-error";
