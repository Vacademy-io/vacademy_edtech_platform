import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useInboxStore } from '../-stores/inbox-store';
import { InboxConversation, InboxFilter } from '../-services/inbox-api';
import { DeliveryTicks, deliveryState } from './delivery-ticks';
import { formatConversationTime } from '../-utils/day-labels';
import { MagnifyingGlass, WarningCircle, HandWaving, ArrowClockwise } from '@phosphor-icons/react';

interface Props {
    onLoadMore: () => void;
    /** Re-run the conversation load after it failed. */
    onRetry: () => void;
}

function buildFilters(t: TFunction): Array<{ key: InboxFilter; label: string; title: string }> {
    return [
        { key: 'ALL', label: t('filters.all.label'), title: t('filters.all.title') },
        {
            key: 'UNANSWERED',
            label: t('filters.unanswered.label'),
            title: t('filters.unanswered.title'),
        },
        {
            key: 'FAILED',
            label: t('filters.failed.label'),
            title: t('filters.failed.title'),
        },
    ];
}

/**
 * The row's last line. A learner's sticker, photo, voice note or reaction carries no text, so it is
 * named ("Photo: caption", "Reacted 👍") instead of showing "[sticker]" or nothing.
 */
function lastMessagePreview(c: InboxConversation, t: TFunction): string {
    const kind = c.lastMessageKind;
    if (!kind) return c.lastMessage || '';
    if (kind === 'reaction') {
        return c.lastMessage
            ? t('lastKind.reaction', { emoji: c.lastMessage })
            : t('lastKind.reactionRemoved');
    }
    const known = [
        'image',
        'video',
        'audio',
        'voice',
        'sticker',
        'document',
        'location',
        'contacts',
    ];
    const label = t(`lastKind.${known.includes(kind) ? kind : 'other'}`);
    return c.lastMessage ? `${label}: ${c.lastMessage}` : label;
}

export function ConversationList({ onLoadMore, onRetry }: Props) {
    const { t } = useTranslation('communicationConversationList');
    const conversations = useInboxStore((s) => s.conversations);
    const selectedPhone = useInboxStore((s) => s.selectedPhone);
    const selectPhone = useInboxStore((s) => s.selectPhone);
    const searchQuery = useInboxStore((s) => s.searchQuery);
    const setSearchQuery = useInboxStore((s) => s.setSearchQuery);
    const filter = useInboxStore((s) => s.filter);
    const setFilter = useInboxStore((s) => s.setFilter);
    const isLoading = useInboxStore((s) => s.isLoadingConversations);
    const hasMore = useInboxStore((s) => s.hasMoreConversations);
    const error = useInboxStore((s) => s.conversationsError);

    const filters = buildFilters(t);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        if (scrollHeight - scrollTop - clientHeight < 100 && hasMore && !isLoading) {
            onLoadMore();
        }
    };

    return (
        <div
            className={`w-full md:w-80 shrink-0 border-r flex-col bg-white ${
                selectedPhone ? 'hidden md:flex' : 'flex'
            }`}
        >
            {/* Search */}
            <div className="p-3 border-b">
                <div className="relative">
                    <MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                        className="w-full pl-8 pr-3 py-2 text-sm border rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-green-400"
                    />
                </div>

                {/* Filters — hidden while searching, since search spans every conversation */}
                {!searchQuery && (
                    <div className="mt-2 flex gap-1">
                        {filters.map((f) => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                title={f.title}
                                className={`flex-1 rounded-md px-2 py-1 text-caption font-medium transition ${
                                    filter === f.key
                                        ? 'bg-green-100 text-green-700'
                                        : 'text-gray-500 hover:bg-gray-100'
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* A load that failed is said out loud. With conversations already on screen it is a
                thin strip above them — a background poll failing must not blank the list — and with
                nothing on screen it replaces the "no conversations yet" line, which would otherwise
                claim this institute has never sent a WhatsApp message. */}
            {error && (
                <div className="border-b border-red-200 bg-red-50 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-red-700">
                        <WarningCircle size={14} /> {error.title}
                    </p>
                    {error.detail && (
                        <p className="mt-0.5 text-caption text-red-600">{error.detail}</p>
                    )}
                    <button
                        onClick={onRetry}
                        disabled={isLoading}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-caption font-medium text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-60"
                    >
                        <ArrowClockwise size={12} />
                        {isLoading ? t('retrying') : t('tryAgain')}
                    </button>
                </div>
            )}

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
                {conversations.length === 0 && !isLoading && !error ? (
                    <p className="p-4 text-sm text-gray-400 text-center">{emptyText(filter, t)}</p>
                ) : (
                    conversations.map((c) => (
                        <button
                            key={c.phone}
                            onClick={() => selectPhone(c.phone)}
                            className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 transition ${
                                selectedPhone === c.phone ? 'bg-green-50 border-l-2 border-l-green-500' : ''
                            }`}
                        >
                            <div className="flex justify-between items-start">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-gray-800 truncate">
                                        {c.senderName || c.phone}
                                    </p>
                                    {c.senderName && (
                                        <p className="text-xs text-gray-400 truncate">{c.phone}</p>
                                    )}
                                </div>
                                <div className="flex flex-col items-end ml-2 shrink-0">
                                    <span className="text-[10px] text-gray-400">
                                        {formatConversationTime(c.lastMessageTime)}
                                    </span>
                                    {(c.unreadCount ?? 0) > 0 && (
                                        <span className="mt-1 bg-green-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                                            {c.unreadCount}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* State badges: the bot handed over, or a message never landed.
                                A plain unanswered chat gets no chip — its green unread count says
                                the same thing, and on the Unanswered tab that would be every row. */}
                            {(!!c.escalationId || (c.failedCount ?? 0) > 0) && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {!!c.escalationId && (
                                        <span
                                            title={escalationTitle(c, t)}
                                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-px text-caption font-medium text-amber-700"
                                        >
                                            <HandWaving size={10} /> {t('botHandedOver')}
                                        </span>
                                    )}
                                    {(c.failedCount ?? 0) > 0 && (
                                        <span
                                            title={t('notDeliveredCount', { count: c.failedCount ?? 0 })}
                                            className="inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-px text-caption font-medium text-red-600"
                                        >
                                            <WarningCircle size={10} />
                                            {c.failedCount === 1
                                                ? t('notDelivered')
                                                : t('notDeliveredCountShort', { count: c.failedCount ?? 0 })}
                                        </span>
                                    )}
                                </div>
                            )}

                            <p className="text-xs text-gray-500 mt-1 truncate">
                                {/* The real state of the last outgoing message. This used to be a
                                    hard-coded single tick, so a read message and a refused one
                                    looked identical here. */}
                                {c.lastMessageType === 'OUTGOING' && (
                                    <DeliveryTicks
                                        state={deliveryState(c.lastMessageStatus)}
                                        size={12}
                                        className="mr-1"
                                    />
                                )}
                                {lastMessagePreview(c, t)}
                            </p>
                        </button>
                    ))
                )}
                {isLoading && (
                    <p className="p-3 text-xs text-gray-400 text-center">{t('loading')}</p>
                )}
            </div>
        </div>
    );
}

function emptyText(filter: InboxFilter, t: TFunction): string {
    if (filter === 'UNANSWERED') return t('empty.unanswered');
    if (filter === 'FAILED') return t('empty.failed');
    return t('empty.all');
}

/** Tooltip explaining why the bot stepped aside on this conversation. */
function escalationTitle(c: InboxConversation, t: TFunction): string {
    const why =
        c.escalationReason === 'MAX_TURNS'
            ? t('escalation.maxTurns')
            : c.escalationReason === 'AI_ERROR'
              ? t('escalation.aiError')
              : c.escalationReason === 'MANUAL'
                ? t('escalation.manual')
                : c.escalationReason === 'EXISTING_LEAD'
                  ? t('escalation.existingLead')
                  : c.escalationReason === 'CRM_SAVE_FAILED'
                    ? t('escalation.crmSaveFailed')
                    : t('escalation.noInfo');
    if (!c.escalationMessage) return why;
    if (c.escalationReason === 'EXISTING_LEAD') {
        return t('escalation.withLeadMessage', { why, message: c.escalationMessage });
    }
    if (c.escalationReason === 'CRM_SAVE_FAILED') {
        return t('escalation.withAnswers', { why, message: c.escalationMessage });
    }
    return t('escalation.withMessage', { why, message: c.escalationMessage });
}
