import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EnvelopeSimple, Paperclip, PaperPlaneTilt, Warning } from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { EmailConversation } from '../../-services/email-inbox-api';
import { isSystemSender } from '../../-utils/email-text';
import { EmailAvatar } from './email-avatar';

interface Props {
    conversations: EmailConversation[];
    selectedEmail: string | null;
    onSelect: (email: string) => void;
    loading: boolean;
    /** True when there are more pages to load. Hides the sentinel + "Loading more" footer when false. */
    hasMore: boolean;
    /** Called when the bottom sentinel scrolls into view. Should be debounced/dedup'd by the caller. */
    onLoadMore: () => void;
    /** True while a load-more request is in flight (renders a footer skeleton). */
    loadingMore: boolean;
    /** True while a search is active — the empty state then says "no matches". */
    searching?: boolean;
}

/** The message list, laid out like Gmail's: sender, subject, time; bold while unread. */
export function EmailConversationList({
    conversations,
    selectedEmail,
    onSelect,
    loading,
    hasMore,
    onLoadMore,
    loadingMore,
    searching = false,
}: Props) {
    const { t, i18n } = useTranslation('communicationEmailConversationList');
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    // Infinite scroll — fire onLoadMore the moment the bottom sentinel enters view.
    // Re-binds whenever hasMore/onLoadMore change so the latest closure is observed.
    useEffect(() => {
        const target = sentinelRef.current;
        if (!target || !hasMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry && entry.isIntersecting) {
                    onLoadMore();
                }
            },
            // `root: null` -> uses nearest scroll ancestor (the ScrollArea viewport)
            { root: null, rootMargin: '120px', threshold: 0 }
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, [hasMore, onLoadMore]);

    return (
        <aside
            className={cn(
                'w-full shrink-0 flex-col border-e border-neutral-200 bg-white md:w-96',
                selectedEmail ? 'hidden md:flex' : 'flex'
            )}
        >
            <ScrollArea className="flex-1">
                {loading && conversations.length === 0 ? (
                    <div className="space-y-px">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <RowSkeleton key={i} />
                        ))}
                    </div>
                ) : conversations.length === 0 ? (
                    <EmptyState searching={searching} />
                ) : (
                    <>
                        <ul className="divide-y divide-neutral-100 contain-inline-size">
                            {conversations.map((c) => (
                                <ConversationRow
                                    key={c.email}
                                    conversation={c}
                                    selected={selectedEmail === c.email}
                                    onClick={() => onSelect(c.email)}
                                    t={t}
                                    locale={i18n.language}
                                />
                            ))}
                        </ul>

                        {/* Infinite-scroll sentinel + loading footer */}
                        {hasMore && (
                            <div ref={sentinelRef} aria-hidden>
                                {loadingMore ? (
                                    <div className="space-y-px">
                                        {Array.from({ length: 3 }).map((_, i) => (
                                            <RowSkeleton key={i} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-6" />
                                )}
                            </div>
                        )}
                        {!hasMore && conversations.length > 0 && (
                            <p className="py-3 text-center text-caption text-neutral-400">
                                {t('endOfConversations')}
                            </p>
                        )}
                    </>
                )}
            </ScrollArea>
        </aside>
    );
}

function ConversationRow({
    conversation: c,
    selected,
    onClick,
    t,
    locale,
}: {
    conversation: EmailConversation;
    selected: boolean;
    onClick: () => void;
    t: TFunction;
    locale: string;
}) {
    const display = c.name || c.email;
    const unread = (c.unreadCount ?? 0) > 0;
    const isOutgoing = c.lastMessageDirection === 'OUTGOING';
    // The backend's verdict when it sent one; the same sender rule locally when it predates the field.
    const system = c.system ?? isSystemSender(c.email, c.lastMessageSubject);
    const subject = c.lastMessageSubject || c.lastMessagePreview || t('noSubject');

    return (
        <li>
            <button
                type="button"
                onClick={onClick}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                    'flex w-full items-start gap-3 border-s-4 px-3 py-2.5 text-start transition-colors focus:outline-none focus-visible:bg-neutral-50',
                    selected
                        ? 'border-s-primary-500 bg-primary-50'
                        : 'border-s-transparent hover:bg-neutral-50 hover:shadow-sm'
                )}
            >
                <EmailAvatar seed={c.email} label={display} size="md" />

                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <p
                            className={cn(
                                'min-w-0 flex-1 truncate text-sm',
                                unread
                                    ? 'font-bold text-neutral-900'
                                    : 'font-medium text-neutral-800'
                            )}
                        >
                            {display}
                        </p>
                        {c.hasAttachments && (
                            <Paperclip
                                size={14}
                                className="shrink-0 self-center text-neutral-500"
                                aria-label={t('hasAttachments')}
                            />
                        )}
                        <span
                            className={cn(
                                'shrink-0 whitespace-nowrap text-xs',
                                unread ? 'font-bold text-neutral-900' : 'text-neutral-500'
                            )}
                        >
                            {c.lastMessageTime ? formatTime(c.lastMessageTime, t, locale) : ''}
                        </span>
                    </div>

                    {c.name && <p className="truncate text-xs text-neutral-500">{c.email}</p>}

                    <div className="mt-0.5 flex items-center gap-2">
                        <p
                            className={cn(
                                'flex min-w-0 flex-1 items-center gap-1 truncate text-sm',
                                system
                                    ? 'text-warning-700'
                                    : unread
                                      ? 'font-semibold text-neutral-900'
                                      : 'text-neutral-600'
                            )}
                        >
                            {system ? (
                                <Warning
                                    size={13}
                                    weight="fill"
                                    className="shrink-0 text-warning-600"
                                />
                            ) : (
                                isOutgoing && (
                                    <PaperPlaneTilt
                                        size={12}
                                        weight="fill"
                                        className="shrink-0 text-neutral-400"
                                        aria-label={t('you')}
                                    />
                                )
                            )}
                            <span className="truncate">
                                {system ? t('deliveryFailed') : subject}
                            </span>
                        </p>
                        {unread && (
                            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 px-1.5 text-2xs font-semibold text-white">
                                {(c.unreadCount ?? 0) > 99 ? '99+' : c.unreadCount}
                            </span>
                        )}
                    </div>
                </div>
            </button>
        </li>
    );
}

function RowSkeleton() {
    return (
        <div className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
            </div>
        </div>
    );
}

function EmptyState({ searching }: { searching: boolean }) {
    const { t } = useTranslation('communicationEmailConversationList');
    return (
        <div className="flex h-full items-center justify-center px-6 py-12">
            <div className="text-center text-neutral-500">
                <EnvelopeSimple size={36} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">{searching ? t('noMatches') : t('noConversations')}</p>
                {!searching && (
                    <p className="mt-1 text-xs opacity-70">{t('noConversationsHint')}</p>
                )}
            </div>
        </div>
    );
}

function formatTime(timestamp: string, t: TFunction, locale: string): string {
    try {
        const d = new Date(timestamp);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
        }
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return t('yesterday');
        return d.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
        });
    } catch {
        return '';
    }
}
