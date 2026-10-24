import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatCircleDots, UsersFour, ArrowLeft, Prohibit, Trophy } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import {
    listConversations,
    getMessages,
    sendMessage as apiSendMessage,
    deleteMessage as apiDeleteMessage,
    editMessage as apiEditMessage,
    markRead,
    getRules,
    acknowledgeRules,
    createBatchConversation,
    createCommunityConversation,
    createDirectConversation,
    searchBatches,
    searchPeople,
    classifyChatSendError,
    describeDeleteChatError,
    describeEditChatError,
    type ChatConversationResponse,
    type ChatMessageResponse,
    type ChatRulesResponse,
    type SendChatMessageRequest,
    type ChatMessagePayload,
    type ChatBatchResponse,
    type ChatPersonResponse,
} from '@/services/chat/chatApi';
import { getChatUser } from '@/services/chat/getChatUser';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getBadgesEnabled } from '@/routes/settings/-services/badges-settings';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { LeaderboardShareDialog } from './LeaderboardShareDialog';
import { useChatStream } from '@/hooks/useChatStream';
import { useIsMobile } from '@/hooks/use-mobile';
import { ConversationList } from './ConversationList';
import { ChatThread, type ThreadMessage } from './ChatThread';
import { MessageComposer } from './MessageComposer';
import { NewChatModal } from './NewChatModal';
import { CommunityRulesPanel } from './CommunityRulesPanel';
import { RulesEditor } from './RulesEditor';
import { ReportsReviewQueue } from './ReportsReviewQueue';
import { ReportMessageDialog } from './ReportMessageDialog';
import { ChatPageHeader, type ChatView } from './ChatPageHeader';
import { ConversationDetailsPanel } from './ConversationDetailsPanel';
import {
    getTerminology,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const CONVERSATIONS_KEY = ['chat', 'conversations'] as const;

/**
 * Shown both when the open thread reports CHAT_DISABLED and when the whole institute has chat off
 * (so there is no thread to open at all).
 */
const ChatDisabledNotice = () => (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <Prohibit size={48} weight="duotone" className="mb-3 text-neutral-300" />
        <p className="text-sm font-medium text-neutral-600">Chat is currently disabled</p>
        <p className="mt-1 max-w-xs text-xs text-neutral-400">
            Chat has been turned off for this institute. Reach out to an administrator if you think
            this is a mistake.
        </p>
    </div>
);

const conversationTitle = (c: ChatConversationResponse): string => {
    if (c.title) return c.title;
    if (c.type === 'COMMUNITY') return 'Community';
    if (c.type === 'BATCH_GROUP')
        return `${getTerminology(ContentTerms.Batch, SystemTerms.Batch)} Group`;
    return 'Direct Message';
};

const mergeById = (existing: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] => {
    const map = new Map<string, ThreadMessage>();
    for (const m of existing) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);
    // Tiebreak on createdAt so rapid optimistic sends with near-equal seqs keep send order.
    return Array.from(map.values()).sort(
        (a, b) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt)
    );
};

export function ChatScreen({
    initialConversationId,
}: {
    /** Open this conversation on load (e.g. from a chat push deep-link ?conversationId=). */
    initialConversationId?: string;
} = {}) {
    const queryClient = useQueryClient();
    const deepLinkedRef = useRef(false);
    const isMobile = useIsMobile();
    const { userId } = useMemo(() => getChatUser(), []);
    const { instituteDetails } = useInstituteDetailsStore();
    const { data: badgesEnabled } = useQuery({
        queryKey: ['badges-enabled'],
        queryFn: getBadgesEnabled,
        staleTime: 5 * 60 * 1000,
    });

    // Public, white-labelled leaderboard URL for a batch group — points at the
    // institute's LEARNER portal (not the admin origin) so the page resolves the institute.
    const buildLeaderboardUrl = (packageSessionId?: string | null) => {
        if (!packageSessionId) return '';
        const rawBase = instituteDetails?.learner_portal_base_url || BASE_URL_LEARNER_DASHBOARD;
        const base =
            rawBase.startsWith('http://') || rawBase.startsWith('https://')
                ? rawBase
                : `https://${rawBase}`;
        return `${base.replace(/\/+$/, '')}/leaderboard/${packageSessionId}`;
    };
    // Open the leaderboard preview dialog (with copy/share) for a batch group.
    const [leaderboardDialog, setLeaderboardDialog] = useState<{
        packageSessionId: string;
        batchName: string;
    } | null>(null);

    const [showReports, setShowReports] = useState(false);
    const [search, setSearch] = useState('');
    const [activeId, setActiveId] = useState<string | undefined>(undefined);
    // The server list is capped (top 30, most-recently-messaged first, never-messaged last), so a
    // batch/DM opened from search is often NOT in it. Hold the opened conversation here so the
    // background list refetch can't blank the thread out from under the user.
    const [openedConversation, setOpenedConversation] = useState<ChatConversationResponse | null>(
        null
    );
    // The institute community, provisioned on mount. Held separately so it survives every list
    // refetch: it is a usually-never-messaged channel, so on an older backend (before the community
    // was pinned to the top of the page) recency ordering buries it past the cap and the refetched
    // list drops it again.
    const [communityConversation, setCommunityConversation] =
        useState<ChatConversationResponse | null>(null);
    const [newChatOpen, setNewChatOpen] = useState(false);
    const [rulesEditorOpen, setRulesEditorOpen] = useState(false);

    // Inline search across batches (start/open a batch conversation) + people (start a DM).
    const searchTrimmed = search.trim();
    const [batchResults, setBatchResults] = useState<ChatBatchResponse[]>([]);
    const [peopleResults, setPeopleResults] = useState<ChatPersonResponse[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);

    const [messages, setMessages] = useState<ThreadMessage[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [rules, setRules] = useState<ChatRulesResponse | null>(null);
    const [isAcknowledging, setIsAcknowledging] = useState(false);
    const [chatDisabled, setChatDisabled] = useState(false);

    // Report dialog state (reason + details are collected inside ReportMessageDialog).
    const [reportTarget, setReportTarget] = useState<ChatMessageResponse | null>(null);

    // Latest known seq for the open conversation — used for SSE resync.
    const latestSeqRef = useRef<number>(0);
    // Monotonic per-pending offset so rapid multi-sends keep their send order.
    const pendingSeqCounterRef = useRef<number>(0);
    const activeIdRef = useRef<string | undefined>(undefined);
    activeIdRef.current = activeId;
    // Read by the SSE handler (which is ref-held, so it must not close over the state).
    const openedConversationIdRef = useRef<string | undefined>(undefined);
    openedConversationIdRef.current = openedConversation?.id;

    // ── Conversations ────────────────────────────────────────────────────
    const {
        data: conversations = [],
        isLoading: conversationsLoading,
        error: conversationsError,
    } = useQuery({
        queryKey: CONVERSATIONS_KEY,
        queryFn: () => listConversations(),
        refetchOnWindowFocus: false,
        // Chat being off for the institute is a permanent answer, not a blip — retrying only
        // repeats the same 403.
        retry: (failureCount, err) =>
            classifyChatSendError(err)?.code !== 'CHAT_DISABLED' && failureCount < 2,
    });

    // Chat stays off until an institute opts in, so every chat endpoint answers 403 CHAT_DISABLED
    // and the list comes back empty. The per-thread `chatDisabled` below can't cover that: it is
    // set while opening a conversation, and here there is none to open. Without this the screen
    // sits on "Select a conversation to start chatting" beside an empty list — an instruction that
    // can never be followed.
    const instituteChatDisabled =
        classifyChatSendError(conversationsError)?.code === 'CHAT_DISABLED';

    const activeConversation = useMemo(() => {
        const fromList = conversations.find((c) => c.id === activeId);
        if (fromList) return fromList;
        // Fall back to the locally-held copy for a conversation outside the capped server list.
        if (openedConversation && openedConversation.id === activeId) return openedConversation;
        return communityConversation && communityConversation.id === activeId
            ? communityConversation
            : undefined;
    }, [conversations, activeId, openedConversation, communityConversation]);

    // The sidebar keeps showing the conversation the user just opened, even when the server list
    // (capped + ordered by last message) doesn't carry it. The institute community is pinned to the
    // top the same way, so it is always reachable no matter how many batch channels fill the page.
    const listedConversations = useMemo(() => {
        const withOpened =
            openedConversation && !conversations.some((c) => c.id === openedConversation.id)
                ? [openedConversation, ...conversations]
                : conversations;
        if (!communityConversation) return withOpened;
        const rest = withOpened.filter((c) => c.id !== communityConversation.id);
        const fromList = withOpened.find((c) => c.id === communityConversation.id);
        // Prefer the server's copy (fresh preview/unread) but keep the pinned position.
        return [fromList ?? communityConversation, ...rest];
    }, [conversations, openedConversation, communityConversation]);

    const refetchConversations = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    }, [queryClient]);

    // Seed/replace a conversation in the cached list so the thread panel (which derives
    // activeConversation from this cache) renders immediately, before any list refetch lands.
    const upsertConversation = useCallback(
        (conv: ChatConversationResponse) => {
            queryClient.setQueryData<ChatConversationResponse[]>(CONVERSATIONS_KEY, (prev) => {
                const list = prev ?? [];
                const idx = list.findIndex((c) => c.id === conv.id);
                if (idx === -1) return [conv, ...list];
                const next = list.slice();
                next[idx] = { ...next[idx], ...conv };
                return next;
            });
        },
        [queryClient]
    );

    // ── Auto-provision the institute community on mount ───────────────────
    // Mirrors the learner app. Get-or-create is idempotent, so this both creates the channel for an
    // institute that never had one and joins the caller (admins land as MODERATOR, mentors/teachers
    // as MEMBER) — which is what gives them a read cursor and posting rights. Held in local state
    // rather than written into the conversations cache: seeding the cache would flip the list query
    // out of its loading state, which the auto-select below waits on.
    // Fail-soft: a 403 just means chat or the community channel is off for this institute.
    useEffect(() => {
        let cancelled = false;
        createCommunityConversation()
            .then((community) => {
                if (cancelled) return;
                setCommunityConversation(community);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    // Patch a single conversation in the cached list (preview/unread/order) without a refetch.
    const patchConversation = useCallback(
        (conversationId: string, patch: (c: ChatConversationResponse) => ChatConversationResponse) => {
            // Keep the locally-held copy in step too — it's the only carrier for a conversation
            // that isn't in the capped server list.
            setOpenedConversation((prev) =>
                prev && prev.id === conversationId ? patch(prev) : prev
            );
            setCommunityConversation((prev) =>
                prev && prev.id === conversationId ? patch(prev) : prev
            );
            queryClient.setQueryData<ChatConversationResponse[]>(CONVERSATIONS_KEY, (prev) => {
                const list = prev ?? [];
                const idx = list.findIndex((c) => c.id === conversationId);
                const current = list[idx];
                if (!current) return list;
                const updated = patch(current);
                const next = list.slice();
                next.splice(idx, 1);
                return [updated, ...next];
            });
        },
        [queryClient]
    );

    // ── Load messages + rules when the active conversation changes ────────
    const loadInitial = useCallback(
        async (conversation: ChatConversationResponse) => {
            setMessagesLoading(true);
            setMessages([]);
            setRules(null);
            setChatDisabled(false);
            latestSeqRef.current = 0;
            try {
                const page = await getMessages(conversation.id, { limit: 40 });
                const sorted = mergeById([], page.messages);
                setMessages(sorted);
                setHasMore(page.hasMore);
                latestSeqRef.current = page.latestSeq ?? sorted[sorted.length - 1]?.seq ?? 0;

                // Mark read up to the latest message, then clear the badge locally.
                const last = sorted[sorted.length - 1];
                if (last && conversation.unreadCount > 0) {
                    void markRead(conversation.id, last.id).catch(() => undefined);
                    patchConversation(conversation.id, (c) => ({ ...c, unreadCount: 0 }));
                }
            } catch (err) {
                if (classifyChatSendError(err)?.code === 'CHAT_DISABLED') {
                    setChatDisabled(true);
                } else {
                    toast.error('Failed to load messages.');
                }
            } finally {
                setMessagesLoading(false);
            }

            if (conversation.type === 'COMMUNITY') {
                try {
                    const r = await getRules(conversation.id);
                    setRules(r);
                } catch {
                    // Rules are non-fatal; the thread still works.
                }
            }
        },
        [patchConversation]
    );

    const handleSelect = useCallback(
        async (conversation: ChatConversationResponse) => {
            setShowReports(false);
            setActiveId(conversation.id);
            setOpenedConversation(conversation);
            let conv = conversation;
            // Opening a channel the caller hasn't joined (e.g. an admin viewing every batch, or a
            // teacher opening a mapped batch) must ensure membership so the read cursor + posting work.
            // get-or-provision is idempotent; for an already-joined channel we skip the round-trip.
            if (!conversation.memberRole) {
                try {
                    if (conversation.type === 'BATCH_GROUP' && conversation.referenceId) {
                        conv = await createBatchConversation(conversation.referenceId);
                    } else if (conversation.type === 'COMMUNITY') {
                        conv = await createCommunityConversation();
                    }
                    if (conv.id !== conversation.id) setActiveId(conv.id);
                    upsertConversation(conv);
                    setOpenedConversation(conv);
                } catch {
                    conv = conversation; // read still works even if joining failed
                }
            }
            void loadInitial(conv);
        },
        [loadInitial, upsertConversation]
    );

    // ── Inline search: batches + people (debounced) ───────────────────────
    useEffect(() => {
        if (!searchTrimmed) {
            setBatchResults([]);
            setPeopleResults([]);
            setSearchLoading(false);
            return;
        }
        let cancelled = false;
        setSearchLoading(true);
        const handle = setTimeout(() => {
            void Promise.allSettled([
                searchBatches(searchTrimmed, 20),
                searchPeople({ nameQuery: searchTrimmed, pageNumber: 0, pageSize: 20 }),
            ])
                .then(([b, p]) => {
                    if (cancelled) return;
                    setBatchResults(b.status === 'fulfilled' ? (b.value.batches ?? []) : []);
                    setPeopleResults(p.status === 'fulfilled' ? (p.value.people ?? []) : []);
                })
                .finally(() => {
                    if (!cancelled) setSearchLoading(false);
                });
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [searchTrimmed]);

    const openConversationFresh = useCallback(
        (conv: ChatConversationResponse) => {
            setSearch('');
            upsertConversation(conv); // seed so the thread renders immediately (before the refetch)
            // Held separately from the query cache: the refetch below replaces the cache wholesale
            // with the server's capped list, which a just-opened (often never-messaged) batch/DM
            // won't be part of — without this the thread would blank out a moment after opening.
            setOpenedConversation(conv);
            refetchConversations(); // reconcile the list (ordering/preview) in the background
            setShowReports(false);
            setActiveId(conv.id);
            void loadInitial(conv);
        },
        [loadInitial, refetchConversations, upsertConversation]
    );

    const handleSelectBatch = useCallback(
        async (batch: ChatBatchResponse) => {
            try {
                openConversationFresh(await createBatchConversation(batch.packageSessionId));
            } catch {
                toast.error("Couldn't open this batch. Please try again.");
            }
        },
        [openConversationFresh]
    );

    const handleSelectPerson = useCallback(
        async (person: ChatPersonResponse) => {
            try {
                openConversationFresh(
                    await createDirectConversation({
                        targetUserId: person.userId,
                        targetUserName: person.fullName,
                        targetUserRole: person.role,
                    })
                );
            } catch {
                toast.error("Couldn't start the conversation. Please try again.");
            }
        },
        [openConversationFresh]
    );

    // ── Load earlier (pagination) ─────────────────────────────────────────
    const handleLoadMore = useCallback(async () => {
        if (!activeId || messages.length === 0) return;
        const oldest = messages[0];
        if (!oldest) return;
        try {
            const page = await getMessages(activeId, { beforeCursor: oldest.seq, limit: 40 });
            const sorted = [...page.messages].sort((a, b) => a.seq - b.seq);
            setMessages((prev) => mergeById(sorted, prev));
            setHasMore(page.hasMore);
        } catch {
            toast.error('Failed to load earlier messages.');
        }
    }, [activeId, messages]);

    // ── Send (optimistic) ─────────────────────────────────────────────────
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
                patchConversation(conversationId, (c) => ({
                    ...c,
                    lastMessagePreview: saved.content || 'Attachment',
                    lastMessageAt: saved.createdAt,
                    lastMessageSeq: saved.seq,
                    lastMessageSenderId: saved.senderId,
                }));
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
        [patchConversation]
    );

    const handleSend = useCallback(
        async (body: SendChatMessageRequest) => {
            if (!activeId) return;
            const dedupKey = body.clientDedupKey ?? crypto.randomUUID();
            const tempId = `temp-${dedupKey}`;
            const user = getChatUser();
            const optimistic: ThreadMessage = {
                id: tempId,
                clientDedupKey: dedupKey,
                conversationId: activeId,
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
            await dispatchSend(activeId, body, dedupKey);
        },
        [activeId, userId, dispatchSend]
    );

    // ── Retry a failed send ───────────────────────────────────────────────
    const handleRetry = useCallback(
        (message: ThreadMessage) => {
            const conversationId = message.conversationId;
            const dedupKey = message.clientDedupKey;
            if (!dedupKey) return;
            // Re-mark the existing optimistic row as pending (not failed).
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === message.id ? { ...m, pending: true, failed: false } : m
                )
            );
            void dispatchSend(
                conversationId,
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

    // ── Delete a message ──────────────────────────────────────────────────
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

    // ── Acknowledge community rules ───────────────────────────────────────
    const handleAcknowledge = useCallback(async () => {
        if (!activeId) return;
        setIsAcknowledging(true);
        try {
            const updated = await acknowledgeRules(activeId);
            setRules(updated);
        } catch {
            toast.error('Could not accept the rules.');
        } finally {
            setIsAcknowledging(false);
        }
    }, [activeId]);

    // ── Report a message ──────────────────────────────────────────────────
    const handleReport = useCallback((message: ChatMessageResponse) => {
        setReportTarget(message);
    }, []);

    // ── SSE: receive new messages + read receipts ─────────────────────────
    const onStreamMessage = useCallback(
        (payload: ChatMessagePayload) => {
            const msg = payload.message;
            if (!msg) return;
            const isActive = payload.conversationId === activeIdRef.current;
            const isOwn = msg.senderId === userId;

            if (isActive) {
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
                // Only mark read for incoming messages from others while the thread is open.
                if (!isOwn) {
                    void markRead(payload.conversationId, msg.id).catch(() => undefined);
                }
            }

            // Update the single conversation's preview/unread in-place; only refetch the
            // whole list when the message belongs to a conversation we don't know yet.
            // The conversation held locally (opened from search, outside the capped list) counts as
            // known — otherwise every message in it would trigger a pointless full-list refetch.
            const known =
                payload.conversationId === openedConversationIdRef.current ||
                (
                    queryClient.getQueryData<ChatConversationResponse[]>(CONVERSATIONS_KEY) ?? []
                ).some((c) => c.id === payload.conversationId);
            if (!known) {
                refetchConversations();
                return;
            }
            patchConversation(payload.conversationId, (c) => ({
                ...c,
                lastMessagePreview: msg.content || 'Attachment',
                lastMessageAt: msg.createdAt,
                lastMessageSeq: msg.seq,
                lastMessageSenderId: msg.senderId,
                unreadCount: isActive || isOwn ? c.unreadCount : c.unreadCount + 1,
            }));
        },
        [userId, queryClient, refetchConversations, patchConversation]
    );

    const onStreamRead = useCallback(
        (payload: ChatMessagePayload) => {
            // Another of the user's sessions read up to a seq; clear our local badge.
            if (payload.readerUserId && payload.readerUserId === userId) {
                patchConversation(payload.conversationId, (c) => ({ ...c, unreadCount: 0 }));
            }
        },
        [userId, patchConversation]
    );

    const onStreamReconnect = useCallback(() => {
        // Catch the list up after a reconnect.
        refetchConversations();
        const id = activeIdRef.current;
        if (!id) return;
        // Catch up on anything missed while disconnected, reconciling against any
        // pending optimistic temp- rows so placeholders are replaced, not duplicated.
        void getMessages(id, { sinceCursor: latestSeqRef.current, limit: 40 })
            .then((page) => {
                if (page.messages.length === 0) return;
                const fresh = mergeById([], page.messages);
                setMessages((prev) => {
                    // Drop any pending optimistic temp- row that the fresh page already
                    // contains (matched by content + sender + type) so we don't duplicate.
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
    }, [refetchConversations]);

    // ── SSE: an existing message changed in place (edited / deleted) ──────
    // NOT routed through onStreamMessage: that path reconciles optimistic sends, bumps the unread
    // badge and rewrites the conversation-list preview — all wrong for a message that already exists.
    const onStreamMessageUpdated = useCallback(
        (payload: ChatMessagePayload) => {
            const msg = payload.message;
            if (!msg) return;
            if (payload.conversationId === activeIdRef.current) {
                setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
            }
            // The list preview only belongs to this message while it is still the newest one.
            patchConversation(payload.conversationId, (c) =>
                c.lastMessageSeq === msg.seq
                    ? { ...c, lastMessagePreview: msg.content || 'Attachment' }
                    : c
            );
        },
        [patchConversation]
    );

    useChatStream({
        onMessage: onStreamMessage,
        onMessageUpdated: onStreamMessageUpdated,
        onRead: onStreamRead,
        onReconnect: onStreamReconnect,
        enabled: Boolean(userId),
    });

    // Keep the active conversation's rules editor in sync after save.
    const handleRulesSaved = useCallback((updated: ChatRulesResponse) => {
        setRules(updated);
    }, []);

    // Auto-select the first conversation on first load — DESKTOP ONLY. On mobile
    // the list and thread share one column, so auto-selecting would trap the user
    // in a thread with the list hidden (mirrors the learner app behavior).
    // Deep-links resolve against the DISPLAYED list so a locally-held conversation (the community)
    // opens too, not just one that made the capped server page. Waits for the list query to settle,
    // so which thread opens doesn't depend on whether community provisioning wins the race.
    useEffect(() => {
        if (activeId || showReports || conversationsLoading || listedConversations.length === 0) {
            return;
        }
        // A chat push deep-link takes precedence and opens even on mobile.
        if (initialConversationId && !deepLinkedRef.current) {
            const target = listedConversations.find((c) => c.id === initialConversationId);
            if (target) {
                deepLinkedRef.current = true;
                handleSelect(target);
                return;
            }
        }
        if (!isMobile) {
            // Unchanged landing behaviour: the most recently active real conversation. The community
            // is pinned to the top of the list for reachability, but it shouldn't displace the thread
            // an admin was working in — it's only auto-opened when there is nothing else.
            const first =
                listedConversations.find((c) => c.type !== 'COMMUNITY') ?? listedConversations[0];
            if (first) handleSelect(first);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listedConversations, conversationsLoading, isMobile, initialConversationId]);

    const isCommunity = activeConversation?.type === 'COMMUNITY';
    const ackRequired = rules?.rules?.acknowledgement_required;
    const composerGated = Boolean(isCommunity && ackRequired && rules && !rules.acknowledged);
    const cannotPost = activeConversation ? !activeConversation.canPost : false;
    const allowAttachments = rules?.rules?.posting?.allow_attachments ?? true;

    const composerDisabledReason = composerGated
        ? 'Accept the community guidelines above to post.'
        : cannotPost
          ? 'You do not have permission to post in this conversation.'
          : undefined;

    // Fit within the viewport below the navbar + LayoutContainer margins/padding (~9rem of chrome)
    // and the page header + tabs above the frame (~6.5rem), so the composer stays visible without
    // scrolling. No min-height (it would overflow short screens).
    const shellClass =
        'flex h-[calc(100dvh-15.5rem)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm'; // design-lint-ignore: viewport-relative chat height has no spacing token

    const view: ChatView = showReports ? 'reports' : 'messages';
    const handleViewChange = (next: ChatView) => {
        if (next === 'reports') {
            setShowReports(true);
            setActiveId(undefined);
        } else {
            setShowReports(false);
        }
    };
    // Unread across the conversations already listed (no extra request).
    const unreadTotal = listedConversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    const canShowLeaderboard =
        badgesEnabled === true &&
        activeConversation?.type === 'BATCH_GROUP' &&
        Boolean(activeConversation.referenceId);
    const openLeaderboard = () => {
        if (!activeConversation?.referenceId) return;
        setLeaderboardDialog({
            packageSessionId: activeConversation.referenceId,
            batchName: conversationTitle(activeConversation),
        });
    };

    // Chat off for the whole institute leaves nothing to render in either pane — no conversations to
    // list, no thread to open, and the reports queue is chat's own moderation queue. Say so once,
    // full width, instead of showing an empty list beside "Select a conversation to start chatting".
    if (instituteChatDisabled) {
        return (
            <div className="flex flex-col gap-4">
                <ChatPageHeader view="messages" />
                <div className={shellClass}>
                    <ChatDisabledNotice />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <ChatPageHeader
                view={view}
                onViewChange={handleViewChange}
                onNewMessage={() => setNewChatOpen(true)}
                unreadTotal={unreadTotal}
            />
            <div className={shellClass}>
                {/* Left: conversation list (hidden on the Reports tab, which uses the full width) */}
                <aside
                    className={cn(
                        'w-full shrink-0 border-r border-neutral-200 bg-neutral-50 md:w-80',
                        showReports ? 'hidden' : activeId ? 'hidden md:block' : 'block'
                    )}
                >
                    <div className="flex h-full flex-col">
                        <div className="min-h-0 flex-1">
                            <ConversationList
                                conversations={listedConversations}
                                activeId={showReports ? undefined : activeId}
                                isLoading={conversationsLoading}
                                search={search}
                                onSearchChange={setSearch}
                                onSelect={handleSelect}
                                onNewChat={() => setNewChatOpen(true)}
                                searchActive={searchTrimmed.length > 0}
                                searchLoading={searchLoading}
                                batchResults={batchResults}
                                peopleResults={peopleResults}
                                onSelectBatch={handleSelectBatch}
                                onSelectPerson={handleSelectPerson}
                            />
                        </div>
                    </div>
                </aside>

                {/* Right: thread / reports / empty */}
                <main
                    className={cn(
                        'flex min-w-0 flex-1 flex-col',
                        !activeId && !showReports ? 'hidden md:flex' : 'flex'
                    )}
                >
                    {showReports ? (
                        <div className="min-h-0 flex-1">
                            <ReportsReviewQueue />
                        </div>
                    ) : activeConversation ? (
                        <>
                            <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-4 py-3">
                                <button
                                    type="button"
                                    onClick={() => setActiveId(undefined)}
                                    className="text-neutral-400 hover:text-neutral-600 md:hidden"
                                    aria-label="Back"
                                >
                                    <ArrowLeft size={18} />
                                </button>
                                <div
                                    className={cn(
                                        'flex size-9 items-center justify-center rounded-full',
                                        isCommunity
                                            ? 'bg-primary-100 text-primary-600'
                                            : 'bg-neutral-100 text-neutral-500'
                                    )}
                                >
                                    {isCommunity ? (
                                        <UsersFour size={18} weight="duotone" />
                                    ) : (
                                        <ChatCircleDots size={18} weight="duotone" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-neutral-700">
                                        {conversationTitle(activeConversation)}
                                    </div>
                                    <div className="text-xs text-neutral-400">
                                        {activeConversation.type === 'DIRECT'
                                            ? 'Direct message'
                                            : activeConversation.type === 'BATCH_GROUP'
                                              ? `${getTerminology(ContentTerms.Batch, SystemTerms.Batch)} group`
                                              : 'Community channel'}
                                    </div>
                                </div>
                                {canShowLeaderboard && (
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={openLeaderboard}
                                        className="ml-auto gap-1.5"
                                    >
                                        <Trophy size={16} weight="fill" />
                                        Leaderboard
                                    </MyButton>
                                )}
                            </header>

                            {chatDisabled ? (
                                <ChatDisabledNotice />
                            ) : (
                                <>
                                    {isCommunity && rules && (
                                        <CommunityRulesPanel
                                            rules={rules}
                                            isAcknowledging={isAcknowledging}
                                            onAcknowledge={handleAcknowledge}
                                            onEdit={
                                                rules.canEdit
                                                    ? () => setRulesEditorOpen(true)
                                                    : undefined
                                            }
                                        />
                                    )}

                                    <ChatThread
                                        conversation={activeConversation}
                                        messages={messages}
                                        currentUserId={userId}
                                        isLoading={messagesLoading}
                                        hasMore={hasMore}
                                        onLoadMore={handleLoadMore}
                                        onReport={handleReport}
                                        onRetry={handleRetry}
                                        onDelete={handleDelete}
                                        onEdit={handleEdit}
                                    />

                                    <MessageComposer
                                        conversationId={activeConversation.id}
                                        disabled={composerGated || cannotPost}
                                        disabledReason={composerDisabledReason}
                                        allowAttachments={allowAttachments}
                                        onSend={handleSend}
                                    />
                                </>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-1 flex-col items-center justify-center text-center">
                            <ChatCircleDots
                                size={48}
                                weight="duotone"
                                className="mb-3 text-neutral-300"
                            />
                            <p className="text-sm text-neutral-500">
                                Select a conversation to start chatting.
                            </p>
                        </div>
                    )}
                </main>

                {/* Right: conversation details (wide screens only) */}
                {!showReports && activeConversation && !chatDisabled && (
                    <aside className="hidden w-72 shrink-0 border-l border-neutral-200 bg-neutral-50 xl:block">
                        <ConversationDetailsPanel
                            conversation={activeConversation}
                            title={conversationTitle(activeConversation)}
                            rules={isCommunity ? rules : null}
                            onEditRules={
                                isCommunity && rules?.canEdit
                                    ? () => setRulesEditorOpen(true)
                                    : undefined
                            }
                            onOpenLeaderboard={canShowLeaderboard ? openLeaderboard : undefined}
                            onOpenReports={() => handleViewChange('reports')}
                        />
                    </aside>
                )}

                <NewChatModal
                    open={newChatOpen}
                    onOpenChange={setNewChatOpen}
                    onConversationReady={(conversation) => {
                        refetchConversations();
                        handleSelect(conversation);
                    }}
                />

                {activeConversation && isCommunity && rules && (
                    <RulesEditor
                        open={rulesEditorOpen}
                        onOpenChange={setRulesEditorOpen}
                        conversationId={activeConversation.id}
                        initial={rules}
                        onSaved={handleRulesSaved}
                    />
                )}

                <ReportMessageDialog
                    target={reportTarget}
                    conversationId={activeId}
                    onClose={() => setReportTarget(null)}
                />

                <LeaderboardShareDialog
                    open={Boolean(leaderboardDialog)}
                    onOpenChange={(o) => !o && setLeaderboardDialog(null)}
                    packageSessionId={leaderboardDialog?.packageSessionId ?? null}
                    batchName={leaderboardDialog?.batchName}
                    shareUrl={buildLeaderboardUrl(leaderboardDialog?.packageSessionId)}
                />
            </div>
        </div>
    );
}
