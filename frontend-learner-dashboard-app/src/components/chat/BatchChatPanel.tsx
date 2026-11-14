import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { ChatSlash, WarningCircle, UsersThree } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CourseLeaderboard } from "@/routes/study-library/courses/course-details/-components/CourseLeaderboard";
import { toast } from "sonner";
import { getChatUser } from "@/services/chat/getChatUser";
import {
  openBatchConversation,
  getMessages,
  sendMessage,
  deleteMessage,
  markRead,
  CONVERSATIONS_KEY,
  UNREAD_COUNT_KEY,
  type ChatConversationResponse,
  type ChatMessagePayload,
} from "@/services/chat/chatApi";
import { useChatStream } from "@/hooks/useChatStream";
import { ChatThread, type UiChatMessage } from "./ChatThread";
import { MessageComposer, type ComposerAttachment } from "./MessageComposer";

/**
 * Known rule-rejection reason codes the backend returns as the
 * ResponseStatusException reason (Spring surfaces it in `data.message`),
 * mapped to the `ruleRejection.*` catalog key for a learner-friendly toast.
 * Mirrors ChatScreen.
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

/** Is this the kill-switch (chat turned off for the institute)? */
function isChatDisabled(err: unknown): boolean {
  return (
    axios.isAxiosError(err) &&
    err.response?.status === 403 &&
    reasonOf(err) === "CHAT_DISABLED"
  );
}

export interface BatchChatPanelProps {
  /** The package-session whose batch group chat to embed. */
  packageSessionId: string;
  className?: string;
}

/**
 * Embeds a single batch group conversation (the batch group chat for a
 * package-session) as a self-contained panel — open the conversation, load
 * history, stream new messages, and send/retry/delete — without any of the
 * conversation-list / community-rules / reports / DM machinery from ChatScreen.
 */
export function BatchChatPanel({
  packageSessionId,
  className,
}: BatchChatPanelProps) {
  const { t } = useTranslation("chatFeatureA");
  const [currentUserId, setCurrentUserId] = useState("");
  const [conversation, setConversation] =
    useState<ChatConversationResponse | null>(null);
  const [messages, setMessages] = useState<UiChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [oldestSeq, setOldestSeq] = useState<number | undefined>(undefined);

  const [isOpening, setIsOpening] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<"disabled" | "generic" | null>(null);
  const [disabledMessage, setDisabledMessage] = useState<string>("");

  // Newest seq of this thread, so a reconnect catches up from the right point
  // (sinceCursor must be the LATEST loaded seq, not the oldest).
  const latestSeqRef = useRef<number | undefined>(undefined);
  // Monotonic fractional offset for optimistic rows so multiple in-flight sends keep send order and
  // never sort above/below a resynced real message.
  const pendingSeqRef = useRef(0);
  // Conversation id in a ref so SSE callbacks read the latest value.
  const conversationIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  // The sidebar unread badge reads the shared conversation list (on /chat) or the polled unread total
  // (elsewhere); after reading this batch here, clear its unread in the former and refresh the latter.
  const syncReadToBadge = useCallback(
    (convId: string) => {
      queryClient.setQueryData<ChatConversationResponse[]>(CONVERSATIONS_KEY, (prev) =>
        prev?.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c)),
      );
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    },
    [queryClient],
  );
  conversationIdRef.current = conversation?.id ?? null;

  // ── Resolve current user once (learner getChatUser is async) ───────────────
  useEffect(() => {
    let cancelled = false;
    getChatUser()
      .then((u) => {
        if (!cancelled) setCurrentUserId(u.userId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Open the batch conversation + load its first page ──────────────────────
  useEffect(() => {
    if (!packageSessionId) return;
    let cancelled = false;

    setIsOpening(true);
    setError(null);
    setConversation(null);
    setMessages([]);
    setHasMore(false);
    setOldestSeq(undefined);
    latestSeqRef.current = undefined;

    (async () => {
      try {
        const conv = await openBatchConversation(packageSessionId);
        if (cancelled) return;
        setConversation(conv);

        const page = await getMessages(conv.id, { limit: 40 });
        if (cancelled) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setOldestSeq(page.oldestSeq);
        latestSeqRef.current =
          page.latestSeq ?? page.messages[page.messages.length - 1]?.seq;

        // Mark the newest message read if there's anything unread.
        const newest = page.messages[page.messages.length - 1];
        if (newest && conv.unreadCount > 0) {
          markRead(conv.id, newest.id)
            .then(() => syncReadToBadge(conv.id))
            .catch(() => undefined);
        }
      } catch (err) {
        if (cancelled) return;
        if (isChatDisabled(err)) {
          setDisabledMessage(reasonOf(err) || t("batchPanel.disabledFallback"));
          setError("disabled");
        } else {
          console.error("Failed to open batch conversation:", err);
          setError("generic");
        }
      } finally {
        if (!cancelled) setIsOpening(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packageSessionId, syncReadToBadge]);

  // ── Load older messages ────────────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    const convId = conversationIdRef.current;
    if (!convId || !hasMore || oldestSeq == null) return;
    setIsLoadingMore(true);
    try {
      const page = await getMessages(convId, {
        beforeCursor: oldestSeq,
        limit: 40,
      });
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.hasMore);
      setOldestSeq(page.oldestSeq);
    } catch (err) {
      console.error("Failed to load older messages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, oldestSeq]);

  // ── Real-time receive (filtered to THIS conversation) ──────────────────────
  const handleIncoming = useCallback(
    (payload: ChatMessagePayload) => {
      const convId = conversationIdRef.current;
      // The stream carries all of the user's events — only act on ours.
      if (!convId || payload.conversationId !== convId) return;
      const msg = payload.message;
      if (!msg) return;

      // Keep the reconnect cursor current.
      if (latestSeqRef.current == null || msg.seq > latestSeqRef.current) {
        latestSeqRef.current = msg.seq;
      }

      // Append, deduping by id and reconciling an optimistic row of our own.
      setMessages((existing) => {
        if (existing.some((m) => m.id === msg.id)) return existing;
        const optimisticIdx = existing.findIndex(
          (m) =>
            m.pending &&
            m.senderId === msg.senderId &&
            m.content === msg.content,
        );
        if (optimisticIdx !== -1) {
          const next = existing.slice();
          next[optimisticIdx] = msg;
          return next;
        }
        return [...existing, msg];
      });

      // Mark read immediately for messages we didn't send.
      if (msg.senderId !== currentUserId) {
        markRead(convId, msg.id).catch(() => undefined);
      }
    },
    [currentUserId],
  );

  const handleRead = useCallback(() => {
    // No unread badge to maintain inside the embedded panel; the open thread is
    // marked read as messages arrive, so nothing to do here.
  }, []);

  const handleReconnect = useCallback(() => {
    const convId = conversationIdRef.current;
    if (!convId) return;
    // sinceCursor must be the NEWEST loaded seq so we fetch only messages that
    // arrived while disconnected (read from a ref — state here is stale).
    getMessages(convId, { sinceCursor: latestSeqRef.current, limit: 40 })
      .then((page) => {
        if (page.messages.length === 0) return;
        setMessages((existing) => {
          const seenIds = new Set(existing.map((m) => m.id));
          const next = existing.slice();
          for (const msg of page.messages) {
            if (seenIds.has(msg.id)) continue;
            // A resynced message may be our own send still sitting as a
            // pending/failed optimistic placeholder — REPLACE rather than
            // append a duplicate (mirrors handleIncoming's reconciliation).
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
          return next;
        });
        if (page.latestSeq != null) latestSeqRef.current = page.latestSeq;
        // Messages that arrived while the stream was paused are on screen now — mark them read so the
        // server doesn't push them and the badge doesn't count them.
        const newest = page.messages[page.messages.length - 1];
        if (newest && !document.hidden) {
          markRead(convId, newest.id)
            .then(() => syncReadToBadge(convId))
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, [syncReadToBadge]);

  useChatStream({
    enabled: currentUserId.length > 0 && !!conversation,
    onMessage: handleIncoming,
    onRead: handleRead,
    onReconnect: handleReconnect,
  });

  // ── Send (optimistic) ──────────────────────────────────────────────────────
  /**
   * Drives the POST for a row already present in the thread as a pending
   * optimistic message. Shared by first-send and retry so a retry reuses the
   * SAME clientDedupKey (idempotent on the backend) and reads content off the
   * row, not a cleared composer.
   */
  const performSend = useCallback(async (convId: string, row: UiChatMessage) => {
    const clientDedupKey = row.clientDedupKey;
    if (!clientDedupKey) return;

    // Ensure the row shows as pending (matters on retry of a failed row).
    setMessages((prev) =>
      prev.map((m) =>
        m.clientDedupKey === clientDedupKey
          ? { ...m, pending: true, failed: false }
          : m,
      ),
    );

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

      // Reconcile: replace the optimistic row by clientDedupKey, or drop it if
      // the SSE echo already delivered the saved message.
      setMessages((prev) => {
        if (prev.some((m) => m.id === saved.id)) {
          return prev.filter((m) => m.clientDedupKey !== clientDedupKey);
        }
        return prev.map((m) =>
          m.clientDedupKey === clientDedupKey ? saved : m,
        );
      });
    } catch (err) {
      console.error("Failed to send message:", err);

      const reason = reasonOf(err);
      const reasonKey = reason && RULE_REJECTION_KEYS[reason];
      toast.error(reasonKey ? t(reasonKey) : t("screen.sendGenericError"));

      if (isDeterministicRejection(err)) {
        // A rule rejection (e.g. banned word / slow mode) will never succeed on
        // retry — remove the optimistic bubble entirely.
        setMessages((prev) =>
          prev.filter((m) => m.clientDedupKey !== clientDedupKey),
        );
      } else {
        // Transient/network failure — keep the row so it can be retried.
        setMessages((prev) =>
          prev.map((m) =>
            m.clientDedupKey === clientDedupKey
              ? { ...m, pending: false, failed: true }
              : m,
          ),
        );
      }
    }
  }, [t]);

  const handleSend = useCallback(
    async (text: string, attachment?: ComposerAttachment) => {
      const convId = conversationIdRef.current;
      if (!convId) return;
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
        seq: (latestSeqRef.current ?? 0) + 0.001 * ++pendingSeqRef.current,
        createdAt: nowIso,
        clientDedupKey,
        pending: true,
      };

      setMessages((prev) => [...prev, optimistic]);
      await performSend(convId, optimistic);
    },
    [performSend],
  );

  // ── Retry / dismiss a failed optimistic send ───────────────────────────────
  const handleRetry = useCallback(
    (row: UiChatMessage) => {
      void performSend(row.conversationId, row);
    },
    [performSend],
  );

  const handleDismissFailed = useCallback((row: UiChatMessage) => {
    setMessages((prev) =>
      prev.filter((m) => m.clientDedupKey !== row.clientDedupKey),
    );
  }, []);

  // ── Delete one of the user's own messages ──────────────────────────────────
  const handleDelete = useCallback(async (row: UiChatMessage) => {
    try {
      await deleteMessage(row.conversationId, row.id);
      // Mark deleted locally; the SSE echo will also reconcile this row.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === row.id
            ? {
                ...m,
                isDeleted: true,
                content: undefined,
                attachmentUrl: undefined,
              }
            : m,
        ),
      );
    } catch (err) {
      console.error("Failed to delete message:", err);
      toast.error(t("screen.deleteError"));
    }
  }, [t]);

  // ── States ─────────────────────────────────────────────────────────────────
  // Constrain height so the thread scrolls inside the tab.
  const shellClass = cn(
    "flex flex-col overflow-hidden rounded-lg border border-border bg-background",
    "h-[60vh]", // design-lint-ignore: viewport-relative thread height so the embedded chat scrolls inside the tab; no token equivalent
    className,
  );

  // Kill-switch: chat turned off for the institute.
  if (error === "disabled") {
    return (
      <div
        className={cn(
          shellClass,
          "items-center justify-center gap-3 p-6 text-center",
        )}
      >
        <ChatSlash size={40} weight="duotone" className="text-muted-foreground" />
        <p className="text-body font-medium text-foreground">
          {disabledMessage || t("batchPanel.disabledFallback")}
        </p>
      </div>
    );
  }

  // Generic error.
  if (error === "generic") {
    return (
      <div
        className={cn(
          shellClass,
          "items-center justify-center gap-3 p-6 text-center",
        )}
      >
        <WarningCircle
          size={40}
          weight="duotone"
          className="text-muted-foreground"
        />
        <p className="text-body font-medium text-foreground">
          {t("batchPanel.genericErrorTitle")}
        </p>
        <p className="max-w-xs text-caption text-muted-foreground">
          {t("batchPanel.genericErrorDescription")}
        </p>
      </div>
    );
  }

  // Loading skeleton while opening / loading the first page.
  if (isOpening || !conversation) {
    return (
      <div className={shellClass}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-hidden p-4">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                i % 2 === 0 ? "justify-start" : "justify-end",
              )}
            >
              <Skeleton className="h-12 w-48 rounded-2xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const composerDisabled = conversation.canPost === false;
  const composerDisabledReason = t("common.noPermissionToPost");
  // Sort by seq (createdAt tiebreak) so a pending bubble never renders below a resynced real message.
  const orderedMessages = [...messages].sort(
    (a, b) => a.seq - b.seq || (a.createdAt || "").localeCompare(b.createdAt || ""),
  );

  return (
    <div className={shellClass}>
      {/* Thread header */}
      <header className="flex items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500"
        >
          <UsersThree size={18} weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-foreground">
            {conversation.title?.trim() || t("common.typeGroupMessages")}
          </p>
          <p className="truncate text-caption text-muted-foreground">
            {t("common.typeGroupMessages")}
          </p>
        </div>
        {packageSessionId && (
          <CourseLeaderboard packageSessionId={packageSessionId} variant="compact" />
        )}
      </header>

      <ChatThread
        conversation={conversation}
        messages={orderedMessages}
        currentUserId={currentUserId}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={handleLoadMore}
        onRetry={handleRetry}
        onDismissFailed={handleDismissFailed}
        onDelete={handleDelete}
      />

      <MessageComposer
        conversationId={conversation.id}
        disabled={composerDisabled}
        disabledReason={composerDisabledReason}
        allowAttachments
        onSend={handleSend}
      />
    </div>
  );
}
