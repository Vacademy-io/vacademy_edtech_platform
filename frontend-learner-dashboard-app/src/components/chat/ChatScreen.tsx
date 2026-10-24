import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import axios from "axios";
import {
  PencilSimpleLine,
  Megaphone,
  CaretLeft,
  ArrowClockwise,
  ChatSlash,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CourseLeaderboard } from "@/routes/study-library/courses/course-details/-components/CourseLeaderboard";
import { toast } from "sonner";
import { getChatUser } from "@/services/chat/getChatUser";
import {
  CONVERSATIONS_KEY,
  UNREAD_COUNT_KEY,
  listConversations,
  getMessages,
  sendMessage,
  deleteMessage,
  editMessage,
  markRead,
  openCommunityConversation,
  getRules,
  acknowledgeRules,
  type ChatConversationResponse,
  type ChatRulesResponse,
  type ChatMessagePayload,
} from "@/services/chat/chatApi";
import { useChatStream } from "@/hooks/useChatStream";
import { ConversationList } from "./ConversationList";
import { ChatThread, type UiChatMessage } from "./ChatThread";
import {
  MessageComposer,
  type ComposerAttachment,
} from "./MessageComposer";
import { NewChatModal } from "./NewChatModal";
import { CommunityRulesPanel } from "./CommunityRulesPanel";
import { initialsOf } from "./chatUtils";

/**
 * Known rule-rejection reason codes the backend returns as the
 * ResponseStatusException reason (Spring surfaces it in `data.message`),
 * mapped to the `ruleRejection.*` catalog key for a learner-friendly toast.
 */
const RULE_REJECTION_KEYS: Record<string, string> = {
  SLOW_MODE: "ruleRejection.slowMode",
  BLOCKED_BY_MODERATION: "ruleRejection.blockedByModeration",
  RULES_NOT_ACKNOWLEDGED: "ruleRejection.rulesNotAcknowledged",
  LINKS_NOT_ALLOWED: "ruleRejection.linksNotAllowed",
  ATTACHMENTS_NOT_ALLOWED: "ruleRejection.attachmentsNotAllowed",
  NEW_MEMBER_READONLY: "ruleRejection.newMemberReadonly",
  CHAT_DISABLED: "ruleRejection.chatDisabled",
};

/** Extracts the Spring ResponseStatusException reason from an error, if present. */
function reasonOf(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  const message = (err.response?.data as { message?: string } | undefined)
    ?.message;
  return typeof message === "string" ? message : undefined;
}

/**
 * A deterministic rule rejection is a 4xx with a recognised reason code — it
 * will never succeed on retry, so the optimistic bubble should be removed.
 */
function isDeterministicRejection(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const status = err.response?.status;
  if (status == null || status < 400 || status >= 500) return false;
  const reason = reasonOf(err);
  return !!reason && reason in RULE_REJECTION_KEYS;
}

function upsertConversation(
  list: ChatConversationResponse[],
  conv: ChatConversationResponse,
): ChatConversationResponse[] {
  const idx = list.findIndex((c) => c.id === conv.id);
  if (idx === -1) return [conv, ...list];
  const next = list.slice();
  next[idx] = conv;
  return next;
}

export function ChatScreen({
  initialConversationId,
}: {
  /** Open this conversation on load (e.g. from a chat push deep-link ?conversationId=). */
  initialConversationId?: string;
} = {}) {
  const { t } = useTranslation("chatFeatureA");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [currentUserId, setCurrentUserId] = useState("");
  // Read from callbacks (loadThread) without making them depend on it.
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);

  // Per-conversation message buffers (server + optimistic), keyed by id.
  const [threads, setThreads] = useState<Record<string, UiChatMessage[]>>({});
  const [threadMeta, setThreadMeta] = useState<
    Record<string, { hasMore: boolean; oldestSeq?: number }>
  >({});
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [rules, setRules] = useState<ChatRulesResponse | null>(null);
  const [acking, setAcking] = useState(false);

  // Track selection in a ref so SSE callbacks read the latest value.
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  // Newest seq of the currently-open thread, so a reconnect catches up from the
  // right point (sinceCursor must be the LATEST loaded seq, not the oldest).
  const latestSeqRef = useRef<number | undefined>(undefined);

  // ── Resolve current user once ──────────────────────────────────────────────
  useEffect(() => {
    getChatUser().then((u) => setCurrentUserId(u.userId));
  }, []);

  // ── Conversation list ──────────────────────────────────────────────────────
  const {
    data: conversations = [],
    isLoading: convsLoading,
    error: convsError,
    refetch: refetchConversations,
  } = useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: () => listConversations(undefined, 30),
    retry: (failureCount, err) =>
      // Don't retry a deliberate kill-switch; do retry transient failures.
      reasonOf(err) === "CHAT_DISABLED" ? false : failureCount < 2,
  });

  // Kill-switch: backend returns 403 "CHAT_DISABLED" when chat is turned off
  // for the institute — show a friendly empty state, not an error.
  const chatDisabled =
    axios.isAxiosError(convsError) &&
    convsError.response?.status === 403 &&
    reasonOf(convsError) === "CHAT_DISABLED";

  const selectedConv = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  // ── Auto-provision the institute community on mount ────────────────────────
  useEffect(() => {
    let cancelled = false;
    openCommunityConversation()
      .then((community) => {
        if (cancelled) return;
        queryClient.setQueryData<ChatConversationResponse[]>(
          CONVERSATIONS_KEY,
          (prev) => upsertConversation(prev ?? [], community),
        );
      })
      .catch((err) => {
        console.error("Failed to provision community channel:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  // ── Load a thread's messages + rules when selection changes ────────────────
  const loadThread = useCallback(
    async (conv: ChatConversationResponse) => {
      setLoadingThreadId(conv.id);
      setRules(null);
      try {
        const page = await getMessages(conv.id, { limit: 40 });
        setThreads((prev) => ({ ...prev, [conv.id]: page.messages }));
        setThreadMeta((prev) => ({
          ...prev,
          [conv.id]: { hasMore: page.hasMore, oldestSeq: page.oldestSeq },
        }));
        latestSeqRef.current =
          page.latestSeq ?? page.messages[page.messages.length - 1]?.seq;

        // Mark the newest message read. Not gated on the (possibly stale, cached) unreadCount alone: a
        // newest message from someone else may be unread even when the cached row says 0. markRead is
        // idempotent server-side.
        const newest = page.messages[page.messages.length - 1];
        if (newest && (conv.unreadCount > 0 || newest.senderId !== currentUserIdRef.current)) {
          markRead(conv.id, newest.id).catch(() => undefined);
          queryClient.setQueryData<ChatConversationResponse[]>(
            CONVERSATIONS_KEY,
            (prev) =>
              (prev ?? []).map((c) =>
                c.id === conv.id ? { ...c, unreadCount: 0 } : c,
              ),
          );
        }
      } catch (err) {
        console.error("Failed to load messages:", err);
        toast.error(t("screen.loadThreadError"));
      } finally {
        setLoadingThreadId((id) => (id === conv.id ? null : id));
      }

      // Community channels carry rules + a possible acknowledgement gate.
      if (conv.type === "COMMUNITY") {
        getRules(conv.id)
          .then(setRules)
          .catch(() => setRules(null));
      }
    },
    [queryClient, t],
  );

  const handleSelect = useCallback(
    (conv: ChatConversationResponse) => {
      setSelectedId(conv.id);
      void loadThread(conv);
      // Keep the URL in sync with the open conversation so refresh restores
      // it and the sidebar's per-mentor chat mapping follows the selection
      // (dm carries the other user's id for direct chats only).
      void navigate({
        to: "/chat",
        search: {
          conversationId: conv.id,
          dm: conv.type === "DIRECT" ? (conv.otherUserId ?? undefined) : undefined,
        },
        replace: true,
      });
    },
    [loadThread, navigate],
  );

  // Deep-link: open the conversation from ?conversationId= (chat push tap or a
  // sidebar mentor entry). Reacts to every change, not just the first, so
  // switching mentors from the sidebar switches the thread in place.
  const refetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialConversationId || initialConversationId === selectedIdRef.current) {
      return;
    }
    const match = conversations.find((c) => c.id === initialConversationId);
    if (match) {
      handleSelect(match);
      return;
    }
    // A just-created conversation may not be in the list yet — refetch once.
    if (refetchedForRef.current !== initialConversationId) {
      refetchedForRef.current = initialConversationId;
      void refetchConversations();
    }
  }, [initialConversationId, conversations, handleSelect, refetchConversations]);

  const handleLoadMore = useCallback(async () => {
    if (!selectedConv) return;
    const meta = threadMeta[selectedConv.id];
    if (!meta?.hasMore || meta.oldestSeq == null) return;
    setLoadingMore(true);
    try {
      const page = await getMessages(selectedConv.id, {
        beforeCursor: meta.oldestSeq,
        limit: 40,
      });
      setThreads((prev) => ({
        ...prev,
        [selectedConv.id]: [...page.messages, ...(prev[selectedConv.id] ?? [])],
      }));
      setThreadMeta((prev) => ({
        ...prev,
        [selectedConv.id]: { hasMore: page.hasMore, oldestSeq: page.oldestSeq },
      }));
    } catch (err) {
      console.error("Failed to load older messages:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [selectedConv, threadMeta]);

  // ── Real-time receive ──────────────────────────────────────────────────────
  const handleIncoming = useCallback(
    (payload: ChatMessagePayload) => {
      const msg = payload.message;
      if (!msg) return;
      const convId = payload.conversationId;

      // Keep the reconnect cursor for the open thread current.
      if (
        selectedIdRef.current === convId &&
        (latestSeqRef.current == null || msg.seq > latestSeqRef.current)
      ) {
        latestSeqRef.current = msg.seq;
      }

      // Append to the thread buffer, deduping by id and reconciling an
      // optimistic message that matches our own send.
      setThreads((prev) => {
        const existing = prev[convId];
        if (!existing) return prev; // not loaded yet — list preview is enough
        if (existing.some((m) => m.id === msg.id)) return prev;
        const optimisticIdx = existing.findIndex(
          (m) => m.pending && m.senderId === msg.senderId && m.content === msg.content,
        );
        let next: UiChatMessage[];
        if (optimisticIdx !== -1) {
          next = existing.slice();
          next[optimisticIdx] = msg;
        } else {
          next = [...existing, msg];
        }
        return { ...prev, [convId]: next };
      });

      // Update the conversation list preview + unread badge.
      queryClient.setQueryData<ChatConversationResponse[]>(
        CONVERSATIONS_KEY,
        (prev) => {
          const list = prev ?? [];
          const idx = list.findIndex((c) => c.id === convId);
          if (idx === -1) {
            // New conversation we don't know about yet — pull a fresh list.
            void refetchConversations();
            return list;
          }
          const isOpen = selectedIdRef.current === convId;
          const isOwn = msg.senderId === currentUserId;
          const updated: ChatConversationResponse = {
            ...list[idx],
            lastMessagePreview: msg.content || "Attachment",
            lastMessageAt: msg.createdAt,
            lastMessageSeq: msg.seq,
            lastMessageSenderId: msg.senderId,
            unreadCount:
              isOpen || isOwn ? list[idx].unreadCount : list[idx].unreadCount + 1,
          };
          const next = list.slice();
          next.splice(idx, 1);
          return [updated, ...next];
        },
      );

      // If the open conversation received it, mark read immediately.
      if (selectedIdRef.current === convId && msg.senderId !== currentUserId) {
        markRead(convId, msg.id).catch(() => undefined);
      }
    },
    [queryClient, refetchConversations, currentUserId],
  );

  const handleRead = useCallback(
    (payload: ChatMessagePayload) => {
      // Another of the user's sessions read up to a seq; clear our badge.
      if (payload.readerUserId && payload.readerUserId === currentUserId) {
        queryClient.setQueryData<ChatConversationResponse[]>(
          CONVERSATIONS_KEY,
          (prev) =>
            (prev ?? []).map((c) =>
              c.id === payload.conversationId ? { ...c, unreadCount: 0 } : c,
            ),
        );
      }
    },
    [queryClient, currentUserId],
  );

  const handleReconnect = useCallback(() => {
    // After a reconnect, catch up the open thread, mark what arrived while paused as read (the user is
    // looking at it — otherwise the server pushes it and the list/badge show it unread), THEN refetch
    // the list so its unread counts reflect that read.
    const openId = selectedIdRef.current;
    if (!openId) {
      void refetchConversations();
      return;
    }
    // sinceCursor must be the NEWEST loaded seq so we fetch only messages that
    // arrived while disconnected (read from a ref — threadMeta here is stale).
    getMessages(openId, { sinceCursor: latestSeqRef.current, limit: 40 })
      .then((page) => {
        setThreads((prev) => {
          const existing = prev[openId] ?? [];
          if (page.messages.length === 0) return prev;

          const seenIds = new Set(existing.map((m) => m.id));
          const next = existing.slice();

          for (const msg of page.messages) {
            if (seenIds.has(msg.id)) continue; // already present by id

            // A resynced message may be our own send that's still sitting as a
            // pending/failed optimistic placeholder — REPLACE it rather than
            // appending a duplicate. The server message carries no
            // clientDedupKey, so match on content+senderId+contentType
            // (mirrors handleIncoming's reconciliation).
            const optimisticIdx = next.findIndex(
              (m) =>
                (m.pending || m.failed) &&
                m.senderId === msg.senderId &&
                m.content === msg.content &&
                m.contentType === msg.contentType,
            );
            if (optimisticIdx !== -1) {
              next[optimisticIdx] = msg;
            } else {
              next.push(msg);
            }
            seenIds.add(msg.id);
          }

          return { ...prev, [openId]: next };
        });
        if (page.latestSeq != null) latestSeqRef.current = page.latestSeq;
        const newest = page.messages[page.messages.length - 1];
        if (newest && selectedIdRef.current === openId && !document.hidden) {
          return markRead(openId, newest.id).catch(() => undefined);
        }
        return undefined;
      })
      .catch(() => undefined)
      .finally(() => {
        void refetchConversations();
      });
  }, [refetchConversations]);

  // Leaving /chat: the sidebar badge switches back to the polled unread total, which may predate what was
  // read here — refresh it.
  useEffect(
    () => () => {
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    },
    [queryClient],
  );

  // ── SSE: an existing message changed in place (edited / deleted) ───────────
  // Deliberately NOT handleIncoming: that path treats the payload as a new arrival — it bumps the
  // unread badge, rewrites the conversation-list preview and floats the thread to the top, none of
  // which is right for a message the list already knows about.
  const handleMessageUpdated = useCallback((payload: ChatMessagePayload) => {
    const msg = payload.message;
    const convId = payload.conversationId;
    if (!msg || !convId) return;
    setThreads((prev) => {
      const existing = prev[convId];
      if (!existing) return prev;
      return {
        ...prev,
        [convId]: existing.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)),
      };
    });
  }, []);

  useChatStream({
    enabled: currentUserId.length > 0,
    onMessage: handleIncoming,
    onMessageUpdated: handleMessageUpdated,
    onRead: handleRead,
    onReconnect: handleReconnect,
  });

  // ── Send (optimistic) ──────────────────────────────────────────────────────

  /**
   * Drives the actual POST for a row that is already present in the thread
   * buffer as a pending optimistic message. Shared by first-send and retry so a
   * retry reuses the SAME clientDedupKey (idempotent on the backend) and reads
   * content/attachment off the row, not the cleared composer.
   */
  const performSend = useCallback(
    async (convId: string, row: UiChatMessage) => {
      const clientDedupKey = row.clientDedupKey;
      if (!clientDedupKey) return;

      // Ensure the row shows as pending (matters on retry of a failed row).
      setThreads((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.clientDedupKey === clientDedupKey
            ? { ...m, pending: true, failed: false }
            : m,
        ),
      }));

      try {
        const saved = await sendMessage(convId, {
          contentType: row.contentType,
          text: row.content || undefined,
          attachmentUrl: row.attachmentUrl,
          attachmentName: row.attachmentName,
          attachmentMime: row.attachmentMime,
          attachmentSize: row.attachmentSize,
          clientDedupKey,
        });

        // Reconcile: replace the optimistic row by clientDedupKey or id.
        setThreads((prev) => {
          const list = prev[convId] ?? [];
          if (list.some((m) => m.id === saved.id)) {
            // SSE already delivered it — just drop the optimistic placeholder.
            return {
              ...prev,
              [convId]: list.filter((m) => m.clientDedupKey !== clientDedupKey),
            };
          }
          return {
            ...prev,
            [convId]: list.map((m) =>
              m.clientDedupKey === clientDedupKey ? saved : m,
            ),
          };
        });

        // Move the conversation to the top with a fresh preview.
        queryClient.setQueryData<ChatConversationResponse[]>(
          CONVERSATIONS_KEY,
          (prev) => {
            const cur = prev ?? [];
            const idx = cur.findIndex((c) => c.id === convId);
            if (idx === -1) return cur;
            const updated: ChatConversationResponse = {
              ...cur[idx],
              lastMessagePreview: saved.content || "Attachment",
              lastMessageAt: saved.createdAt,
              lastMessageSeq: saved.seq,
              lastMessageSenderId: saved.senderId,
            };
            const next = cur.slice();
            next.splice(idx, 1);
            return [updated, ...next];
          },
        );
      } catch (err) {
        console.error("Failed to send message:", err);

        const reason = reasonOf(err);
        const reasonKey = reason && RULE_REJECTION_KEYS[reason];
        toast.error(reasonKey ? t(reasonKey) : t("screen.sendGenericError"));

        if (isDeterministicRejection(err)) {
          // A rule rejection (e.g. banned word / slow mode) will never succeed
          // on retry — remove the optimistic bubble entirely.
          setThreads((prev) => ({
            ...prev,
            [convId]: (prev[convId] ?? []).filter(
              (m) => m.clientDedupKey !== clientDedupKey,
            ),
          }));
        } else {
          // Transient/network failure — keep the row so it can be retried.
          setThreads((prev) => ({
            ...prev,
            [convId]: (prev[convId] ?? []).map((m) =>
              m.clientDedupKey === clientDedupKey
                ? { ...m, pending: false, failed: true }
                : m,
            ),
          }));
        }
      }
    },
    [queryClient, t],
  );

  const handleSend = useCallback(
    async (text: string, attachment?: ComposerAttachment) => {
      if (!selectedConv) return;
      const convId = selectedConv.id;
      const clientDedupKey = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const user = await getChatUser();

      const optimistic: UiChatMessage = {
        id: `optimistic-${clientDedupKey}`,
        conversationId: convId,
        senderId: user.userId,
        senderName: user.userName,
        senderRole: user.userRole,
        contentType: attachment ? "IMAGE" : "TEXT",
        content: text || undefined,
        attachmentUrl: attachment?.url,
        attachmentName: attachment?.name,
        attachmentMime: attachment?.mime,
        attachmentSize: attachment?.size,
        seq: Number.MAX_SAFE_INTEGER,
        createdAt: nowIso,
        clientDedupKey,
        pending: true,
      };

      setThreads((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] ?? []), optimistic],
      }));

      await performSend(convId, optimistic);
    },
    [selectedConv, performSend],
  );

  // ── Retry / dismiss a failed optimistic send ───────────────────────────────
  const handleRetry = useCallback(
    (row: UiChatMessage) => {
      void performSend(row.conversationId, row);
    },
    [performSend],
  );

  const handleDismissFailed = useCallback((row: UiChatMessage) => {
    setThreads((prev) => ({
      ...prev,
      [row.conversationId]: (prev[row.conversationId] ?? []).filter(
        (m) => m.clientDedupKey !== row.clientDedupKey,
      ),
    }));
  }, []);

  // ── Delete one of the user's own messages ──────────────────────────────────
  const handleDelete = useCallback(async (row: UiChatMessage) => {
    const convId = row.conversationId;
    try {
      await deleteMessage(convId, row.id);
      // Mark deleted locally; the SSE echo will also reconcile this row.
      setThreads((prev) => ({
        ...prev,
        [convId]: (prev[convId] ?? []).map((m) =>
          m.id === row.id
            ? { ...m, isDeleted: true, content: undefined, attachmentUrl: undefined }
            : m,
        ),
      }));
    } catch (err) {
      console.error("Failed to delete message:", err);
      toast.error(t("screen.deleteError"));
    }
  }, [t]);

  const handleEdit = useCallback(
    async (row: UiChatMessage, text: string) => {
      const convId = row.conversationId;
      try {
        const updated = await editMessage(convId, row.id, { text });
        setThreads((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.id === updated.id ? { ...m, ...updated } : m,
          ),
        }));
      } catch (err) {
        console.error("Failed to edit message:", err);
        toast.error(t("screen.editError"));
        // Rethrow so the dialog stays open on the text the user is still trying to save.
        throw err;
      }
    },
    [t],
  );

  // ── Community acknowledgement ──────────────────────────────────────────────
  const handleAcknowledge = useCallback(async () => {
    if (!selectedConv) return;
    setAcking(true);
    try {
      const updated = await acknowledgeRules(selectedConv.id);
      setRules(updated);
    } catch (err) {
      console.error("Failed to acknowledge rules:", err);
      toast.error(t("screen.acknowledgeError"));
    } finally {
      setAcking(false);
    }
  }, [selectedConv, t]);

  // ── Composer gating ────────────────────────────────────────────────────────
  const ackGateActive =
    selectedConv?.type === "COMMUNITY" &&
    rules?.rules?.acknowledgement_required === true &&
    rules?.acknowledged === false;

  const composerDisabled =
    !selectedConv || selectedConv.canPost === false || ackGateActive;

  const composerDisabledReason = !selectedConv
    ? ""
    : ackGateActive
      ? t("screen.ackGateReason")
      : t("common.noPermissionToPost");

  const threadMessages = selectedConv ? (threads[selectedConv.id] ?? []) : [];
  const selectedMeta = selectedConv ? threadMeta[selectedConv.id] : undefined;

  // For a DM with no title, fall back to the other participant's name if one is
  // available among the loaded messages (the backend exposes otherUserId on the
  // conversation, but no name field — so we read it off a message they sent).
  // No new API call: if no name is available we keep the generic label.
  const dmOtherName =
    selectedConv?.type === "DIRECT" && !selectedConv.title?.trim()
      ? threadMessages.find(
          (m) =>
            m.senderId === selectedConv.otherUserId &&
            !!m.senderName?.trim(),
        )?.senderName?.trim()
      : undefined;

  const headerTitle =
    selectedConv?.title?.trim() ||
    dmOtherName ||
    (selectedConv?.type === "COMMUNITY"
      ? t("common.typeCommunity")
      : selectedConv?.type === "BATCH_GROUP"
        ? t("screen.headerGroupFallback")
        : t("common.typeDirectMessage"));

  // ── Kill-switch: chat turned off for the institute ─────────────────────────
  if (chatDisabled) {
    return (
      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 bg-background p-6 text-center",
          // Fills the fillViewport column LayoutContainer gives the /chat route.
          "min-h-0 flex-1",
        )}
      >
        <ChatSlash size={40} weight="duotone" className="text-muted-foreground" />
        <p className="text-body font-medium text-foreground">
          {t("screen.chatDisabledTitle")}
        </p>
        <p className="max-w-xs text-caption text-muted-foreground">
          {t("screen.chatDisabledDescription")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full overflow-hidden",
        // Fills the fillViewport column LayoutContainer gives the /chat route.
        "min-h-0 flex-1",
      )}
    >
      {/* ── Conversation list pane ── */}
      <aside
        className={cn(
          "flex w-full flex-col border-e border-border bg-background sm:w-80 sm:shrink-0",
          selectedId && "hidden sm:flex",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h1 className="text-h3 font-semibold text-foreground">{t("screen.header.messages")}</h1>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("screen.header.refreshAria")}
              onClick={() => refetchConversations()}
            >
              <ArrowClockwise size={18} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("screen.newMessage")}
              onClick={() => setNewChatOpen(true)}
            >
              <PencilSimpleLine size={18} />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <ConversationList
            conversations={conversations}
            selectedId={selectedId ?? undefined}
            isLoading={convsLoading}
            onSelect={handleSelect}
          />
        </div>
      </aside>

      {/* ── Thread pane ── */}
      <section
        className={cn(
          "flex min-w-0 flex-1 flex-col bg-background",
          !selectedId && "hidden sm:flex",
        )}
      >
        {!selectedConv ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-stack p-6 text-center">
            <Megaphone size={40} weight="duotone" className="text-muted-foreground" />
            <p className="text-body font-medium text-foreground">
              {t("screen.emptySelection.title")}
            </p>
            <p className="max-w-xs text-caption text-muted-foreground">
              {t("screen.emptySelection.description")}
            </p>
            <Button type="button" onClick={() => setNewChatOpen(true)}>
              <PencilSimpleLine size={18} className="me-1.5" />
              {t("screen.newMessage")}
            </Button>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("screen.header.backAria")}
                className="sm:hidden"
                onClick={() => setSelectedId(null)}
              >
                <CaretLeft size={20} />
              </Button>
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-500"
              >
                {selectedConv.type === "COMMUNITY" ? (
                  <Megaphone size={18} weight="duotone" />
                ) : (
                  initialsOf(headerTitle)
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-semibold text-foreground">
                  {headerTitle}
                </p>
                <p className="truncate text-caption text-muted-foreground">
                  {selectedConv.type === "COMMUNITY"
                    ? t("screen.header.communitySubtitle")
                    : selectedConv.type === "BATCH_GROUP"
                      ? t("common.typeGroupMessages")
                      : t("common.typeDirectMessage")}
                </p>
              </div>
              {selectedConv.type === "BATCH_GROUP" && selectedConv.referenceId && (
                <CourseLeaderboard
                  packageSessionId={selectedConv.referenceId}
                  variant="compact"
                />
              )}
            </header>

            {selectedConv.type === "COMMUNITY" && rules && (
              <CommunityRulesPanel
                rules={rules}
                isAcknowledging={acking}
                onAcknowledge={handleAcknowledge}
              />
            )}

            <ChatThread
              conversation={selectedConv}
              messages={threadMessages}
              currentUserId={currentUserId}
              isLoading={loadingThreadId === selectedConv.id}
              hasMore={selectedMeta?.hasMore ?? false}
              isLoadingMore={loadingMore}
              onLoadMore={handleLoadMore}
              onRetry={handleRetry}
              onDismissFailed={handleDismissFailed}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />

            <MessageComposer
              conversationId={selectedConv.id}
              disabled={composerDisabled}
              disabledReason={composerDisabledReason}
              allowAttachments={
                rules?.rules?.posting?.allow_attachments !== false
              }
              onSend={handleSend}
            />
          </>
        )}
      </section>

      <NewChatModal
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onConversationReady={(conv) => {
          queryClient.setQueryData<ChatConversationResponse[]>(
            CONVERSATIONS_KEY,
            (prev) => upsertConversation(prev ?? [], conv),
          );
          handleSelect(conv);
        }}
      />
    </div>
  );
}
