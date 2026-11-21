import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChatCircleDots, Prohibit, WarningCircle, Trophy } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { getBadgesEnabled } from '@/routes/settings/-services/badges-settings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { LeaderboardShareDialog } from './LeaderboardShareDialog';
import {
    getMessages,
    sendMessage as apiSendMessage,
    deleteMessage as apiDeleteMessage,
    editMessage as apiEditMessage,
    markRead,
    createBatchConversation,
    classifyChatSendError,
    describeDeleteChatError,
    describeEditChatError,
    type ChatConversationResponse,
    type ChatMessageResponse,
    type SendChatMessageRequest,
    type ChatMessagePayload,
} from '@/services/chat/chatApi';
import { getChatUser } from '@/services/chat/getChatUser';
import { useChatStream } from '@/hooks/useChatStream';
import { ChatThread, type ThreadMessage } from './ChatThread';
import { ReportMessageDialog } from './ReportMessageDialog';
import { MessageComposer } from './MessageComposer';

interface BatchChatPanelProps {
    /** Package-session id of the batch whose group chat to embed. */
    packageSessionId: string;
    className?: string;
}

// Constrains the embedded thread so it scrolls inside the tab rather than the page.
const PANEL_HEIGHT_CLASS = 'h-[60vh] min-h-[420px]'; // design-lint-ignore: viewport-relative embedded chat height has no spacing token

const mergeById = (existing: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] => {
    const map = new Map<string, ThreadMessage>();
    for (const m of existing) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);
    // Tiebreak on createdAt so rapid optimistic sends with near-equal seqs keep send order.
    return Array.from(map.values()).sort(
        (a, b) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt)
    );
};

/**
 * Embeds ONE batch group conversation as a self-contained, real-time chat panel.
 * Mirrors the single-conversation handlers of ChatScreen (optimistic send +
 * reconcile, retry/dismiss, soft-delete, SSE catch-up) without the conversation
 * list, community rules / acknowledgement gate, reports, or DM concerns — batch
 * groups have none of those.
 */
export function BatchChatPanel({ packageSessionId, className }: BatchChatPanelProps) {
    const { userId } = useMemo(() => getChatUser(), []);
    const { instituteDetails } = useInstituteDetailsStore();
    const { data: badgesEnabled } = useQuery({
        queryKey: ['badges-enabled'],
        queryFn: getBadgesEnabled,
        staleTime: 5 * 60 * 1000,
    });
    const [leaderboardOpen, setLeaderboardOpen] = useState(false);
    // Public, white-labelled leaderboard URL — points at the institute's LEARNER portal.
    const leaderboardUrl = (() => {
        if (!packageSessionId) return '';
        const rawBase = instituteDetails?.learner_portal_base_url || BASE_URL_LEARNER_DASHBOARD;
        const base =
            rawBase.startsWith('http://') || rawBase.startsWith('https://')
                ? rawBase
                : `https://${rawBase}`;
        return `${base.replace(/\/+$/, '')}/leaderboard/${packageSessionId}`;
    })();

    const [conversation, setConversation] = useState<ChatConversationResponse | null>(null);
    const [messages, setMessages] = useState<ThreadMessage[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [opening, setOpening] = useState(true);
    const [chatDisabled, setChatDisabled] = useState(false);
    const [disabledMessage, setDisabledMessage] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [reportTarget, setReportTarget] = useState<ChatMessageResponse | null>(null);

    // Latest known seq for this conversation — used for SSE reconnect resync.
    const latestSeqRef = useRef<number>(0);
    // Monotonic per-pending offset so rapid multi-sends keep their send order.
    const pendingSeqCounterRef = useRef<number>(0);
    // The open conversation id, in a ref so SSE handlers can filter without re-subscribing.
    const conversationIdRef = useRef<string | undefined>(undefined);
    conversationIdRef.current = conversation?.id;

    // ── Open the batch conversation + load the first page ─────────────────────
    useEffect(() => {
        if (!packageSessionId) {
            setOpening(false);
            return;
        }
        let cancelled = false;
        setOpening(true);
        setLoadError(false);
        setChatDisabled(false);
        setDisabledMessage(null);
        setConversation(null);
        setMessages([]);
        setHasMore(false);
        latestSeqRef.current = 0;

        (async () => {
            try {
                const convo = await createBatchConversation(packageSessionId);
                if (cancelled) return;
                setConversation(convo);
                conversationIdRef.current = convo.id;

                const page = await getMessages(convo.id, { limit: 40 });
                if (cancelled) return;
                const sorted = mergeById([], page.messages);
                setMessages(sorted);
                setHasMore(page.hasMore);
                latestSeqRef.current = page.latestSeq ?? sorted[sorted.length - 1]?.seq ?? 0;

                // Mark read up to the latest message if there's an unread badge.
                const last = sorted[sorted.length - 1];
                if (last && convo.unreadCount > 0) {
                    void markRead(convo.id, last.id).catch(() => undefined);
                }
            } catch (err) {
                if (cancelled) return;
                if (classifyChatSendError(err)?.code === 'CHAT_DISABLED') {
                    setChatDisabled(true);
                    const apiMessage = (
                        err as { response?: { data?: { message?: string } } }
                    )?.response?.data?.message;
                    setDisabledMessage(apiMessage ?? null);
                } else {
                    setLoadError(true);
                }
            } finally {
                if (!cancelled) setOpening(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [packageSessionId]);

    // ── Load earlier (pagination) ─────────────────────────────────────────────
    const handleLoadMore = useCallback(async () => {
        const convoId = conversationIdRef.current;
        if (!convoId || messages.length === 0) return;
        const oldest = messages[0];
        if (!oldest) return;
        try {
            const page = await getMessages(convoId, { beforeCursor: oldest.seq, limit: 40 });
            const sorted = [...page.messages].sort((a, b) => a.seq - b.seq);
            setMessages((prev) => mergeById(sorted, prev));
            setHasMore(page.hasMore);
        } catch {
            toast.error('Failed to load earlier messages.');
        }
    }, [messages]);

    // ── Send (optimistic) ─────────────────────────────────────────────────────
    // Performs the network send for an already-present optimistic row keyed by
    // tempId/dedupKey. Shared by first-send and retry.
    const dispatchSend = useCallback(
        async (conversationId: string, body: SendChatMessageRequest, dedupKey: string) => {
            const tempId = `temp-${dedupKey}`;
            try {
                const saved = await apiSendMessage(conversationId, {
                    ...body,
                    clientDedupKey: dedupKey,
                });
                // Reconcile: drop the optimistic temp row, add the server message.
                setMessages((prev) => {
                    const withoutTemp = prev.filter((m) => m.id !== tempId);
                    return mergeById(withoutTemp, [saved]);
                });
                latestSeqRef.current = Math.max(latestSeqRef.current, saved.seq);
            } catch (err) {
                const rejection = classifyChatSendError(err);
                if (rejection) {
                    // Deterministic 4xx rule rejection — drop the optimistic bubble
                    // entirely (it will never be accepted) and surface the reason.
                    setMessages((prev) => prev.filter((m) => m.id !== tempId));
                    toast.error(rejection.message);
                } else {
                    // Transient error — keep the bubble, marked failed for retry.
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === tempId ? { ...m, pending: false, failed: true } : m
                        )
                    );
                    toast.error('Message failed to send.');
                }
            }
        },
        []
    );

    const handleSend = useCallback(
        async (body: SendChatMessageRequest) => {
            const convoId = conversationIdRef.current;
            if (!convoId) return;
            const dedupKey = body.clientDedupKey ?? crypto.randomUUID();
            const tempId = `temp-${dedupKey}`;
            const user = getChatUser();
            const optimistic: ThreadMessage = {
                id: tempId,
                clientDedupKey: dedupKey,
                conversationId: convoId,
                senderId: userId,
                senderName: user.userName,
                senderRole: user.userRole,
                contentType: body.contentType ?? 'TEXT',
                content: body.text,
                attachmentUrl: body.attachmentUrl,
                attachmentName: body.attachmentName,
                attachmentMime: body.attachmentMime,
                attachmentSize: body.attachmentSize,
                // Monotonic offset keeps rapid sends in order; +0.001 per pending row.
                seq: (latestSeqRef.current || 0) + 0.001 * ++pendingSeqCounterRef.current,
                createdAt: new Date().toISOString(),
                pending: true,
            };
            setMessages((prev) => mergeById(prev, [optimistic]));
            await dispatchSend(convoId, body, dedupKey);
        },
        [userId, dispatchSend]
    );

    // ── Retry a failed send ────────────────────────────────────────────────────
    const handleRetry = useCallback(
        (message: ThreadMessage) => {
            const dedupKey = message.clientDedupKey;
            if (!dedupKey) return;
            // Re-mark the existing optimistic row as pending (not failed).
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === message.id ? { ...m, pending: true, failed: false } : m
                )
            );
            void dispatchSend(
                message.conversationId,
                {
                    contentType: message.contentType,
                    text: message.content,
                    attachmentUrl: message.attachmentUrl,
                    attachmentName: message.attachmentName,
                    attachmentMime: message.attachmentMime,
                    attachmentSize: message.attachmentSize,
                    replyToMessageId: message.replyToMessageId,
                },
                dedupKey
            );
        },
        [dispatchSend]
    );

    // ── Soft-delete a message ──────────────────────────────────────────────────
    const handleDelete = useCallback(async (message: ThreadMessage) => {
        try {
            const updated = await apiDeleteMessage(message.conversationId, message.id);
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
        } catch (err) {
            toast.error(describeDeleteChatError(err));
        }
    }, []);

    // ── Edit a message ────────────────────────────────────────────────────
    const handleEdit = useCallback(async (message: ThreadMessage, text: string) => {
        try {
            const updated = await apiEditMessage(message.conversationId, message.id, { text });
            setMessages((prev) =>
                prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
            );
        } catch (err) {
            toast.error(describeEditChatError(err));
            // Rethrow so the dialog stays open on the text the user is still trying to save.
            throw err;
        }
    }, []);

    // ── SSE: receive new messages (filtered to THIS conversation) ──────────────
    const onStreamMessage = useCallback(
        (payload: ChatMessagePayload) => {
            // The stream carries all of the user's events — only act on ours.
            if (payload.conversationId !== conversationIdRef.current) return;
            const msg = payload.message;
            if (!msg) return;
            const isOwn = msg.senderId === userId;

            setMessages((prev) => {
                // Reconcile ONLY the optimistic temp row matching THIS message — matching by
                // content + type so other in-flight sends from the same user aren't dropped.
                // (The SSE payload doesn't carry the client dedup key.)
                let replaced = false;
                const withoutTemp = prev.filter((m) => {
                    if (
                        !replaced &&
                        m.id.startsWith('temp-') &&
                        m.senderId === msg.senderId &&
                        (m.content ?? '') === (msg.content ?? '') &&
                        m.contentType === msg.contentType
                    ) {
                        replaced = true;
                        return false;
                    }
                    return true;
                });
                return mergeById(withoutTemp, [msg]);
            });
            latestSeqRef.current = Math.max(latestSeqRef.current, msg.seq);
            // Mark read for incoming messages from others while the thread is open.
            if (!isOwn) {
                void markRead(payload.conversationId, msg.id).catch(() => undefined);
            }
        },
        [userId]
    );

    const onStreamReconnect = useCallback(() => {
        const id = conversationIdRef.current;
        if (!id) return;
        // Catch up on anything missed while disconnected, reconciling against any
        // pending optimistic temp- rows so placeholders are replaced, not duplicated.
        void getMessages(id, { sinceCursor: latestSeqRef.current, limit: 40 })
            .then((page) => {
                if (page.messages.length === 0) return;
                const fresh = mergeById([], page.messages);
                setMessages((prev) => {
                    let next = prev;
                    for (const m of fresh) {
                        let matched = false;
                        next = next.filter((p) => {
                            if (
                                !matched &&
                                p.id.startsWith('temp-') &&
                                p.senderId === m.senderId &&
                                (p.content ?? '') === (m.content ?? '') &&
                                p.contentType === m.contentType
                            ) {
                                matched = true;
                                return false;
                            }
                            return true;
                        });
                    }
                    return mergeById(next, fresh);
                });
                latestSeqRef.current = Math.max(
                    latestSeqRef.current,
                    page.latestSeq ?? fresh[fresh.length - 1]?.seq ?? 0
                );
            })
            .catch(() => undefined);
    }, []);

    // ── SSE: an existing message changed in place (edited / deleted) ──────
    // Kept off the new-message path, which reconciles optimistic sends and treats the payload as a
    // fresh arrival — neither is right for a message the thread already holds.
    const onStreamMessageUpdated = useCallback((payload: ChatMessagePayload) => {
        const msg = payload.message;
        if (!msg || payload.conversationId !== conversationIdRef.current) return;
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
    }, []);

    useChatStream({
        onMessage: onStreamMessage,
        onMessageUpdated: onStreamMessageUpdated,
        onReconnect: onStreamReconnect,
        enabled: Boolean(userId) && Boolean(conversation),
    });

    const shellClass = cn(
        'flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm',
        PANEL_HEIGHT_CLASS,
        className
    );

    // ── States ─────────────────────────────────────────────────────────────────
    if (chatDisabled) {
        return (
            <div className={shellClass}>
                <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                    <Prohibit size={48} weight="duotone" className="mb-3 text-neutral-300" />
                    <p className="text-sm font-medium text-neutral-600">
                        Messaging is turned off for this institute
                    </p>
                    {disabledMessage && (
                        <p className="mt-1 max-w-xs text-xs text-neutral-400">{disabledMessage}</p>
                    )}
                </div>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className={shellClass}>
                <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                    <WarningCircle size={48} weight="duotone" className="mb-3 text-neutral-300" />
                    <p className="text-sm font-medium text-neutral-600">
                        Couldn&apos;t load the discussion
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-neutral-400">
                        Something went wrong opening these messages. Please try again
                        later.
                    </p>
                </div>
            </div>
        );
    }

    if (opening || !conversation) {
        return (
            <div className={shellClass}>
                <div className="flex-1 space-y-3 bg-neutral-50 px-4 py-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div
                            key={i}
                            className={cn(
                                'h-12 w-2/3 animate-pulse rounded-2xl bg-neutral-200',
                                i % 2 === 0 ? '' : 'ml-auto'
                            )}
                        />
                    ))}
                </div>
            </div>
        );
    }

    const cannotPost = !conversation.canPost;
    const composerDisabledReason = cannotPost
        ? 'You do not have permission to post in this conversation.'
        : undefined;

    return (
        <div className={shellClass}>
            <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-primary-100 text-primary-600">
                    <ChatCircleDots size={18} weight="duotone" />
                </div>
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-neutral-700">
                        {conversation.title?.trim() || 'Discussion'}
                    </div>
                    <div className="text-xs text-neutral-400">Group messages</div>
                </div>
                {badgesEnabled === true && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setLeaderboardOpen(true)}
                        className="ml-auto gap-1.5"
                    >
                        <Trophy size={16} weight="fill" />
                        Leaderboard
                    </MyButton>
                )}
            </header>

            <LeaderboardShareDialog
                open={leaderboardOpen}
                onOpenChange={setLeaderboardOpen}
                packageSessionId={packageSessionId}
                batchName={conversation.title?.trim() || 'Discussion'}
                shareUrl={leaderboardUrl}
            />

            <ChatThread
                conversation={conversation}
                messages={messages}
                currentUserId={userId}
                isLoading={false}
                hasMore={hasMore}
                onLoadMore={handleLoadMore}
                onReport={setReportTarget}
                onRetry={handleRetry}
                onDelete={handleDelete}
                onEdit={handleEdit}
            />

            <MessageComposer
                conversationId={conversation.id}
                disabled={cannotPost}
                disabledReason={composerDisabledReason}
                allowAttachments
                onSend={handleSend}
            />

            <ReportMessageDialog
                target={reportTarget}
                conversationId={conversation.id}
                onClose={() => setReportTarget(null)}
            />
        </div>
    );
}
