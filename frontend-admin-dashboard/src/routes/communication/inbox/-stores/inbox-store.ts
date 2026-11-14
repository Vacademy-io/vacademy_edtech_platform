import { create } from 'zustand';
import { InboxConversation, InboxFilter, InboxMessage } from '../-services/inbox-api';
import type { ApiErrorInfo } from '../-utils/whatsapp-errors';

interface InboxState {
    conversations: InboxConversation[];
    selectedPhone: string | null;
    messages: InboxMessage[];
    searchQuery: string;
    /** ALL | UNANSWERED (bot handed over, nobody replied) | FAILED (a send was refused). */
    filter: InboxFilter;
    isLoadingConversations: boolean;
    isLoadingMessages: boolean;
    /**
     * Why the last load failed, or null. Kept separately from the data so a failed background poll
     * can be reported without throwing away the conversations already on screen.
     */
    conversationsError: ApiErrorInfo | null;
    messagesError: ApiErrorInfo | null;
    hasMoreConversations: boolean;
    hasMoreMessages: boolean;
    conversationOffset: number;

    setConversations: (conversations: InboxConversation[]) => void;
    appendConversations: (conversations: InboxConversation[]) => void;
    selectPhone: (phone: string | null) => void;
    setMessages: (messages: InboxMessage[]) => void;
    prependMessages: (messages: InboxMessage[]) => void;
    appendMessage: (message: InboxMessage) => void;
    setSearchQuery: (query: string) => void;
    setFilter: (filter: InboxFilter) => void;
    setIsLoadingConversations: (loading: boolean) => void;
    setIsLoadingMessages: (loading: boolean) => void;
    setConversationsError: (error: ApiErrorInfo | null) => void;
    setMessagesError: (error: ApiErrorInfo | null) => void;
    setHasMoreConversations: (hasMore: boolean) => void;
    setHasMoreMessages: (hasMore: boolean) => void;
    incrementOffset: () => void;
    resetOffset: () => void;

    // Update conversation's last message when a new message is sent/received
    updateConversationLastMessage: (phone: string, message: string, type: string) => void;
    /** Clear the "Unanswered" badge locally right after a reply, without waiting for a poll. */
    markConversationAnswered: (phone: string) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
    conversations: [],
    selectedPhone: null,
    messages: [],
    searchQuery: '',
    filter: 'ALL',
    isLoadingConversations: false,
    isLoadingMessages: false,
    conversationsError: null,
    messagesError: null,
    hasMoreConversations: true,
    hasMoreMessages: true,
    conversationOffset: 0,

    setConversations: (conversations) => set({ conversations }),
    appendConversations: (newConvos) =>
        set((state) => {
            // Deduplicate by phone
            const existing = new Set(state.conversations.map((c) => c.phone));
            const unique = newConvos.filter((c) => !existing.has(c.phone));
            return { conversations: [...state.conversations, ...unique] };
        }),
    selectPhone: (phone) =>
        set({ selectedPhone: phone, messages: [], hasMoreMessages: true, messagesError: null }),
    setMessages: (messages) => set({ messages }),
    prependMessages: (olderMessages) =>
        set((state) => ({ messages: [...olderMessages, ...state.messages] })),
    appendMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setFilter: (filter) => set({ filter, conversationOffset: 0, hasMoreConversations: true }),
    setIsLoadingConversations: (loading) => set({ isLoadingConversations: loading }),
    setIsLoadingMessages: (loading) => set({ isLoadingMessages: loading }),
    setConversationsError: (conversationsError) => set({ conversationsError }),
    setMessagesError: (messagesError) => set({ messagesError }),
    setHasMoreConversations: (hasMore) => set({ hasMoreConversations: hasMore }),
    setHasMoreMessages: (hasMore) => set({ hasMoreMessages: hasMore }),
    incrementOffset: () => set((state) => ({ conversationOffset: state.conversationOffset + 30 })),
    resetOffset: () => set({ conversationOffset: 0 }),

    updateConversationLastMessage: (phone, message, type) =>
        set((state) => ({
            conversations: state.conversations.map((c) =>
                c.phone === phone
                    ? {
                          ...c,
                          lastMessage: message.substring(0, 60),
                          lastMessageType: type,
                          lastMessageTime: new Date().toISOString(),
                          // A message we have only just handed to the provider has no verdict from
                          // WhatsApp yet, so the row shows one tick until the next poll brings one.
                          lastMessageStatus: undefined,
                          unreadCount: type === 'INCOMING' ? (c.unreadCount || 0) + 1 : 0,
                      }
                    : c
            ),
        })),

    markConversationAnswered: (phone) =>
        set((state) => ({
            conversations:
                // On the Unanswered tab an answered conversation no longer belongs in the list.
                state.filter === 'UNANSWERED'
                    ? state.conversations.filter((c) => c.phone !== phone)
                    : state.conversations.map((c) =>
                          c.phone === phone
                              ? {
                                    ...c,
                                    awaitingReply: false,
                                    escalationId: undefined,
                                    escalationReason: undefined,
                                    escalationMessage: undefined,
                                }
                              : c
                      ),
        })),
}));
