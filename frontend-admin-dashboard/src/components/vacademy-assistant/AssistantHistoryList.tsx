import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChatsCircle, MagnifyingGlass, Trash, Warning } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSISTANT_SESSIONS, ASSISTANT_SESSION_VIEW } from '@/constants/urls';
import { cn } from '@/lib/utils';
import { formatChatTime, groupChatsByDay } from './assistant-format';
import type { AssistantChatList, AssistantChatSummary } from './types';

/** Every history query starts with this key, so one invalidation refreshes them all. */
export const ASSISTANT_CHATS_KEY = 'assistant-chats';
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

const FOCUS_RING =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1';

async function fetchChats(page: number, pageSize: number, q: string): Promise<AssistantChatList> {
    const { data } = await authenticatedAxiosInstance.get(ASSISTANT_SESSIONS, {
        params: { page, page_size: pageSize, ...(q ? { q } : {}) },
    });
    return {
        items: Array.isArray(data?.items) ? (data.items as AssistantChatSummary[]) : [],
        page: Number(data?.page ?? page),
        page_size: Number(data?.page_size ?? pageSize),
        has_more: Boolean(data?.has_more),
    };
}

/** The caller's latest chats (for the panel's empty state). */
export function useRecentChats(enabled: boolean, limit = 3) {
    return useQuery({
        queryKey: [ASSISTANT_CHATS_KEY, 'recent', limit],
        queryFn: async () => (await fetchChats(0, limit, '')).items,
        enabled,
        staleTime: 30 * 1000,
    });
}

function ChatRow({
    chat,
    current,
    onOpen,
    onDeleted,
}: {
    chat: AssistantChatSummary;
    current: boolean;
    onOpen: (id: string) => void;
    onDeleted: (id: string) => void;
}) {
    const { t, i18n } = useTranslation('dashboardIndex');
    const queryClient = useQueryClient();
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [failed, setFailed] = useState(false);
    const keepRef = useRef<HTMLButtonElement>(null);
    const title = chat.title || t('assistant.panel.history.untitled');

    useEffect(() => {
        if (confirming) keepRef.current?.focus();
    }, [confirming]);

    const remove = async () => {
        setDeleting(true);
        setFailed(false);
        try {
            await authenticatedAxiosInstance.delete(ASSISTANT_SESSION_VIEW(chat.id));
            onDeleted(chat.id);
            await queryClient.invalidateQueries({ queryKey: [ASSISTANT_CHATS_KEY] });
        } catch {
            setFailed(true);
            setDeleting(false);
        }
    };

    if (confirming) {
        return (
            <li className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2">
                <p className="truncate text-caption text-neutral-700">{title}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-caption font-semibold text-danger-700">
                        {t('assistant.panel.history.deletePrompt')}
                    </span>
                    <div className="flex items-center gap-2">
                        <MyButton
                            ref={keepRef}
                            buttonType="secondary"
                            scale="small"
                            disable={deleting}
                            onClick={() => {
                                setConfirming(false);
                                setFailed(false);
                            }}
                        >
                            {t('assistant.panel.history.keep')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            disable={deleting}
                            onClick={remove}
                            className="bg-danger-600 hover:bg-danger-700 active:bg-danger-700"
                        >
                            {t('assistant.panel.history.confirmDelete')}
                        </MyButton>
                    </div>
                </div>
                {failed && (
                    <p role="alert" className="mt-1 text-caption text-danger-700">
                        {t('assistant.panel.errors.delete')}
                    </p>
                )}
            </li>
        );
    }

    return (
        <li className="group flex items-center gap-1 rounded-md transition-colors hover:bg-neutral-50 motion-reduce:transition-none">
            <button
                type="button"
                onClick={() => onOpen(chat.id)}
                aria-label={t('assistant.panel.history.open', { title })}
                aria-current={current ? 'true' : undefined}
                className={cn(
                    'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start',
                    FOCUS_RING
                )}
            >
                <ChatsCircle size={16} className="shrink-0 text-neutral-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-body text-neutral-800">{title}</span>
                {current ? (
                    <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-2xs font-medium text-primary-600">
                        {t('assistant.panel.history.current')}
                    </span>
                ) : (
                    <span className="shrink-0 text-2xs text-neutral-400">
                        {formatChatTime(chat.last_active, i18n.language)}
                    </span>
                )}
            </button>
            <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label={t('assistant.panel.history.delete', { title })}
                title={t('assistant.panel.history.confirmDelete')}
                className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-danger-50 hover:text-danger-600 motion-reduce:transition-none',
                    FOCUS_RING
                )}
            >
                <Trash size={15} aria-hidden="true" />
            </button>
        </li>
    );
}

function ChatGroup({
    heading,
    chats,
    currentId,
    onOpen,
    onDeleted,
}: {
    heading: string;
    chats: AssistantChatSummary[];
    currentId: string | null;
    onOpen: (id: string) => void;
    onDeleted: (id: string) => void;
}) {
    const headingId = useId();
    if (!chats.length) return null;
    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-1">
            <h3
                id={headingId}
                className="px-2 text-2xs font-semibold uppercase tracking-wide text-neutral-500"
            >
                {heading}
            </h3>
            <ul className="flex flex-col gap-0.5">
                {chats.map((chat) => (
                    <ChatRow
                        key={chat.id}
                        chat={chat}
                        current={chat.id === currentId}
                        onOpen={onOpen}
                        onDeleted={onDeleted}
                    />
                ))}
            </ul>
        </section>
    );
}

/** "Recent chats": the caller's chats grouped Today / Earlier, searchable by title. */
export function AssistantHistoryList({
    currentId,
    onOpen,
    onDeleted,
}: {
    currentId: string | null;
    onOpen: (id: string) => void;
    onDeleted: (id: string) => void;
}) {
    const { t } = useTranslation('dashboardIndex');
    const searchId = useId();
    const searchRef = useRef<HTMLInputElement>(null);
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');

    useEffect(() => {
        searchRef.current?.focus();
    }, []);
    useEffect(() => {
        const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [search]);

    const chats = useInfiniteQuery({
        queryKey: [ASSISTANT_CHATS_KEY, 'list', query],
        queryFn: ({ pageParam }) => fetchChats(pageParam, PAGE_SIZE, query),
        initialPageParam: 0,
        getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
        staleTime: 30 * 1000,
    });

    const items = chats.data?.pages.flatMap((p) => p.items) ?? [];
    const { today, earlier } = groupChatsByDay(items);

    return (
        <div className="flex flex-col gap-3 p-4">
            <div className="relative">
                <label htmlFor={searchId} className="sr-only">
                    {t('assistant.panel.history.search')}
                </label>
                <MagnifyingGlass
                    size={16}
                    className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                    aria-hidden="true"
                />
                <Input
                    ref={searchRef}
                    id={searchId}
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('assistant.panel.history.search')}
                    className="ps-9"
                    maxLength={100}
                />
            </div>

            {chats.isPending ? (
                <div
                    className="flex flex-col gap-2"
                    role="status"
                    aria-label={t('assistant.panel.history.loading')}
                >
                    <span className="sr-only">{t('assistant.panel.history.loading')}</span>
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                    ))}
                </div>
            ) : chats.isError && !items.length ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <Warning size={24} className="text-danger-500" aria-hidden="true" />
                    <p role="alert" className="text-caption text-neutral-600">
                        {t('assistant.panel.history.error')}
                    </p>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={chats.isFetching}
                        onClick={() => void chats.refetch()}
                    >
                        {t('assistant.panel.history.retry')}
                    </MyButton>
                </div>
            ) : !items.length ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <span className="flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                        <ChatsCircle size={20} aria-hidden="true" />
                    </span>
                    <p className="text-caption text-neutral-500" role="status">
                        {query
                            ? t('assistant.panel.history.noMatches', { query })
                            : t('assistant.panel.history.empty')}
                    </p>
                </div>
            ) : (
                <>
                    <ChatGroup
                        heading={t('assistant.panel.history.today')}
                        chats={today}
                        currentId={currentId}
                        onOpen={onOpen}
                        onDeleted={onDeleted}
                    />
                    <ChatGroup
                        heading={t('assistant.panel.history.earlier')}
                        chats={earlier}
                        currentId={currentId}
                        onOpen={onOpen}
                        onDeleted={onDeleted}
                    />
                    {chats.hasNextPage && (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            disable={chats.isFetchingNextPage}
                            onClick={() => void chats.fetchNextPage()}
                            className="self-center"
                        >
                            {t('assistant.panel.history.loadMore')}
                        </MyButton>
                    )}
                </>
            )}
        </div>
    );
}

/** The three latest chats as a compact list, for the empty state. */
export function RecentChatsCompact({
    chats,
    onOpen,
    onViewAll,
}: {
    chats: AssistantChatSummary[];
    onOpen: (id: string) => void;
    onViewAll: () => void;
}) {
    const { t, i18n } = useTranslation('dashboardIndex');
    const headingId = useId();
    if (!chats.length) return null;
    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
                <h3
                    id={headingId}
                    className="text-2xs font-semibold uppercase tracking-wide text-neutral-500"
                >
                    {t('assistant.panel.recentChats')}
                </h3>
                <button
                    type="button"
                    onClick={onViewAll}
                    className={cn(
                        'rounded-sm text-caption font-medium text-primary-600 hover:underline',
                        FOCUS_RING
                    )}
                >
                    {t('assistant.panel.viewAll')}
                </button>
            </div>
            <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
                {chats.map((chat) => {
                    const title = chat.title || t('assistant.panel.history.untitled');
                    return (
                        <li key={chat.id}>
                            <button
                                type="button"
                                onClick={() => onOpen(chat.id)}
                                aria-label={t('assistant.panel.history.open', { title })}
                                className={cn(
                                    'flex min-h-10 w-full items-center gap-2 px-3 py-2 text-start transition-colors hover:bg-neutral-50 motion-reduce:transition-none',
                                    FOCUS_RING
                                )}
                            >
                                <ChatsCircle
                                    size={14}
                                    className="shrink-0 text-neutral-400"
                                    aria-hidden="true"
                                />
                                <span className="min-w-0 flex-1 truncate text-caption text-neutral-700">
                                    {title}
                                </span>
                                <span className="shrink-0 text-2xs text-neutral-400">
                                    {formatChatTime(chat.last_active, i18n.language)}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
