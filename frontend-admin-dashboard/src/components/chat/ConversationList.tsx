import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
    ChatCircleDots,
    UsersThree,
    UsersFour,
    User as UserIcon,
    MagnifyingGlass,
} from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type {
    ChatConversationResponse,
    ChatConversationType,
    ChatBatchResponse,
    ChatPersonResponse,
} from '@/services/chat/chatApi';
import { formatClockTime, toUtcDate } from './chatTime';

interface ConversationListProps {
    conversations: ChatConversationResponse[];
    activeId?: string;
    isLoading: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    onSelect: (conversation: ChatConversationResponse) => void;
    onNewChat: () => void;
    /** When the search box is non-empty, the list switches to batch + people search results. */
    searchActive: boolean;
    searchLoading: boolean;
    batchResults: ChatBatchResponse[];
    peopleResults: ChatPersonResponse[];
    onSelectBatch: (batch: ChatBatchResponse) => void;
    onSelectPerson: (person: ChatPersonResponse) => void;
}

const initialsOf = (name?: string): string => {
    const n = (name ?? '').trim();
    if (!n) return '?';
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''))
        .toUpperCase() || '?';
};

const typeIcon = (type: ChatConversationType) => {
    switch (type) {
        case 'COMMUNITY':
            return UsersFour;
        case 'BATCH_GROUP':
            return UsersThree;
        default:
            return UserIcon;
    }
};

const conversationTitle = (c: ChatConversationResponse): string => {
    if (c.title) return c.title;
    if (c.type === 'COMMUNITY') return 'Community';
    if (c.type === 'BATCH_GROUP') {
        return `${getTerminology(ContentTerms.Batch, SystemTerms.Batch)} Group`;
    }
    return 'Direct Message';
};

type ListFilter = 'all' | 'unread' | 'groups' | 'direct';

const LIST_FILTERS: { key: ListFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'groups', label: 'Groups' },
    { key: 'direct', label: 'Direct' },
];

const matchesFilter = (c: ChatConversationResponse, filter: ListFilter): boolean => {
    if (filter === 'unread') return c.unreadCount > 0;
    if (filter === 'groups') return c.type !== 'DIRECT';
    if (filter === 'direct') return c.type === 'DIRECT';
    return true;
};

const formatTime = (iso?: string): string => {
    const d = toUtcDate(iso);
    if (!d) return '';
    const now = new Date();
    const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
    if (sameDay) {
        return formatClockTime(d);
    }
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
};

export function ConversationList({
    conversations,
    activeId,
    isLoading,
    search,
    onSearchChange,
    onSelect,
    onNewChat,
    searchActive,
    searchLoading,
    batchResults,
    peopleResults,
    onSelectBatch,
    onSelectPerson,
}: ConversationListProps) {
    const batchPlural = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const batchSingular = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    // Client-side view over the already-loaded list; search results are not filtered by it.
    const [filter, setFilter] = useState<ListFilter>('all');
    const visible = conversations.filter((c) => matchesFilter(c, filter));
    const sections: { key: string; label: string; items: ChatConversationResponse[] }[] = [
        { key: 'pinned', label: 'Pinned', items: visible.filter((c) => c.type === 'COMMUNITY') },
        {
            key: 'groups',
            label: `${batchSingular} groups`,
            items: visible.filter((c) => c.type === 'BATCH_GROUP'),
        },
        {
            key: 'direct',
            label: 'Direct messages',
            items: visible.filter((c) => c.type === 'DIRECT'),
        },
    ].filter((sec) => sec.items.length > 0);
    // When searching, the open conversations whose title matches still surface as quick "Chats".
    const matchingConversations = conversations.filter((c) =>
        conversationTitle(c).toLowerCase().includes(search.trim().toLowerCase())
    );
    // A batch that's already an open conversation is shown under "Chats" — drop it from "Batches".
    const openConversationIds = new Set(conversations.map((c) => c.id));
    const dedupedBatchResults = batchResults.filter(
        (b) => !b.conversationId || !openConversationIds.has(b.conversationId)
    );

    return (
        <div className="flex size-full flex-col bg-neutral-50">
            {/* Header */}
            <div className="flex shrink-0 flex-col gap-2.5 border-b border-neutral-200 bg-white p-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-neutral-800">Messages</h2>
                    <Button
                        size="sm"
                        onClick={onNewChat}
                        className="bg-primary-500 text-white hover:opacity-90"
                    >
                        New message
                    </Button>
                </div>
                <div className="relative">
                    <MagnifyingGlass
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                    />
                    <Input
                        value={search}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={`Search ${batchPlural.toLowerCase()}, people...`}
                        className="pl-9"
                    />
                </div>
                {!searchActive && (
                    <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
                        {LIST_FILTERS.map((f) => (
                            <button
                                key={f.key}
                                type="button"
                                onClick={() => setFilter(f.key)}
                                aria-pressed={filter === f.key}
                                className={cn(
                                    'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                                    filter === f.key
                                        ? 'bg-white text-primary-600 shadow-sm'
                                        : 'text-neutral-500 hover:text-neutral-700'
                                )}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* List / search results */}
            <div className="flex-1 overflow-y-auto">
                {searchActive ? (
                    <SearchResults
                        loading={searchLoading}
                        conversations={matchingConversations}
                        batches={dedupedBatchResults}
                        people={peopleResults}
                        batchPlural={batchPlural}
                        activeId={activeId}
                        onSelectConversation={onSelect}
                        onSelectBatch={onSelectBatch}
                        onSelectPerson={onSelectPerson}
                    />
                ) : isLoading ? (
                    <div className="space-y-2 p-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div
                                key={i}
                                className="h-14 w-full animate-pulse rounded-md bg-neutral-100"
                            />
                        ))}
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                        <ChatCircleDots size={36} weight="duotone" className="mb-3 text-neutral-300" />
                        <p className="text-sm text-neutral-500">No conversations yet.</p>
                    </div>
                ) : sections.length === 0 ? (
                    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                        <ChatCircleDots
                            size={36}
                            weight="duotone"
                            className="mb-3 text-neutral-300"
                        />
                        <p className="text-sm text-neutral-500">No conversations in this view.</p>
                    </div>
                ) : (
                    sections.map((sec) => (
                        <div key={sec.key}>
                            <SectionLabel>{sec.label}</SectionLabel>
                            {sec.items.map((c) => (
                                <ConvRow
                                    key={c.id}
                                    c={c}
                                    active={c.id === activeId}
                                    onSelect={onSelect}
                                />
                            ))}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

function ConvRow({
    c,
    active,
    onSelect,
}: {
    c: ChatConversationResponse;
    active: boolean;
    onSelect: (c: ChatConversationResponse) => void;
}) {
    const Icon = typeIcon(c.type);
    return (
        <button
            type="button"
            onClick={() => onSelect(c)}
            className={cn(
                'flex w-full items-center gap-3 border-b border-l-2 border-neutral-100 px-3 py-3 text-left transition-colors',
                active
                    ? 'border-l-primary-500 bg-primary-50 hover:bg-primary-50'
                    : 'border-l-transparent bg-white hover:bg-neutral-50'
            )}
        >
            <div
                className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-full',
                    c.type === 'COMMUNITY'
                        ? 'bg-primary-100 text-primary-600'
                        : c.type === 'BATCH_GROUP'
                          ? 'bg-info-50 text-info-600'
                          : 'bg-neutral-100 text-neutral-500'
                )}
            >
                <Icon size={20} weight="duotone" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-neutral-700">
                        {conversationTitle(c)}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-400">
                        {formatTime(c.lastMessageAt)}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-neutral-500">
                        {c.lastMessagePreview || 'No messages yet'}
                    </span>
                    {c.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 px-1.5 text-caption font-semibold text-white">
                            {c.unreadCount > 99 ? '99+' : c.unreadCount}
                        </span>
                    )}
                </div>
            </div>
        </button>
    );
}

function SectionLabel({ children }: { children: ReactNode }) {
    return (
        <div className="px-3 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {children}
        </div>
    );
}

function SearchResults({
    loading,
    conversations,
    batches,
    people,
    batchPlural,
    activeId,
    onSelectConversation,
    onSelectBatch,
    onSelectPerson,
}: {
    loading: boolean;
    conversations: ChatConversationResponse[];
    batches: ChatBatchResponse[];
    people: ChatPersonResponse[];
    batchPlural: string;
    activeId?: string;
    onSelectConversation: (c: ChatConversationResponse) => void;
    onSelectBatch: (b: ChatBatchResponse) => void;
    onSelectPerson: (p: ChatPersonResponse) => void;
}) {
    const empty = !loading && conversations.length === 0 && batches.length === 0 && people.length === 0;
    return (
        <div>
            {conversations.length > 0 && (
                <>
                    <SectionLabel>Chats</SectionLabel>
                    {conversations.map((c) => (
                        <ConvRow
                            key={c.id}
                            c={c}
                            active={c.id === activeId}
                            onSelect={onSelectConversation}
                        />
                    ))}
                </>
            )}

            {batches.length > 0 && (
                <>
                    <SectionLabel>{batchPlural}</SectionLabel>
                    {batches.map((b) => (
                        <button
                            key={b.packageSessionId}
                            type="button"
                            onClick={() => onSelectBatch(b)}
                            className="flex w-full items-center gap-3 border-b border-neutral-100 bg-white p-3 text-left transition-colors hover:bg-neutral-50"
                        >
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-50 text-info-600">
                                <UsersThree size={20} weight="duotone" />
                            </div>
                            <span className="truncate text-sm font-medium text-neutral-700">
                                {b.name || 'Batch'}
                            </span>
                        </button>
                    ))}
                </>
            )}

            {people.length > 0 && (
                <>
                    <SectionLabel>People</SectionLabel>
                    {people.map((p) => (
                        <button
                            key={p.userId}
                            type="button"
                            onClick={() => onSelectPerson(p)}
                            className="flex w-full items-center gap-3 border-b border-neutral-100 bg-white p-3 text-left transition-colors hover:bg-neutral-50"
                        >
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-500">
                                {initialsOf(p.fullName)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-neutral-700">
                                    {p.fullName || p.email || 'Member'}
                                </div>
                                <div className="truncate text-xs text-neutral-500">
                                    {p.role}
                                    {p.email ? ` · ${p.email}` : ''}
                                </div>
                            </div>
                        </button>
                    ))}
                </>
            )}

            {loading && (
                <div className="space-y-2 p-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-12 w-full animate-pulse rounded-md bg-neutral-100" />
                    ))}
                </div>
            )}

            {empty && (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                    <MagnifyingGlass size={32} weight="duotone" className="mb-3 text-neutral-300" />
                    <p className="text-sm text-neutral-500">No matches found.</p>
                </div>
            )}
        </div>
    );
}
