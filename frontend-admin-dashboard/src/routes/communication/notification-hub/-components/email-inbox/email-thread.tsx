import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowBendUpLeft,
    ArrowLeft,
    ArrowUp,
    DotsThree,
    EnvelopeSimple,
    Paperclip,
    Warning,
} from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { getInboundEmailHtml, type EmailMessage } from '../../-services/email-inbox-api';
import {
    extractBouncedRecipients,
    isSystemMessage,
    resolveOrigin,
    splitQuotedReply,
} from '../../-utils/email-text';
import {
    defaultOpenKeys,
    foldRows,
    messageKey,
    threadTitle,
    visibleAttachments,
} from '../../-utils/email-thread-layout';
import { EmailHtmlFrame } from './email-html-frame';
import { EmailAttachmentList } from './email-attachments';
import { EmailAvatar } from './email-avatar';

/** Bounce bodies longer than this start collapsed behind "Show details". */
const BOUNCE_DETAILS_COLLAPSE_AT = 300;
/** Where the reader was when they asked for older messages, so the prepend does not move them. */
interface ScrollRestore {
    firstKey?: string;
    scrollHeight: number;
    scrollTop: number;
}

const VIEWPORT_SELECTOR = '[data-radix-scroll-area-viewport]';

interface Props {
    selectedEmail: string | null;
    counterpartyName?: string;
    instituteId: string;
    messages: EmailMessage[];
    loading: boolean;
    hasMore: boolean;
    onLoadOlder: () => void;
    /** Opens the reply composer. Hidden when not provided (bounce daemons). */
    onReply?: () => void;
    /** Mobile-only: returns to the conversation list. */
    onBack?: () => void;
    /** The counterparty is a mail-system sender (bounce daemon) — replying is pointless. */
    system?: boolean;
    /** Rendered under the last message — the inline reply composer while it is open. */
    composer?: ReactNode;
}

/**
 * The reading pane, laid out like a Gmail thread: the subject as the title, then one sheet of
 * messages — the newest (and the newest one they sent us) open, the rest collapsed to a
 * one-line summary — and Reply at the bottom.
 */
export function EmailThread({
    selectedEmail,
    counterpartyName,
    instituteId,
    messages,
    loading,
    hasMore,
    onLoadOlder,
    onReply,
    onBack,
    system = false,
    composer,
}: Props) {
    const { t } = useTranslation('communicationEmailThread');
    const scrollRootRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const pendingRestore = useRef<ScrollRestore | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [unfolded, setUnfolded] = useState(false);

    const firstKey = messageKey(messages[0]);
    const lastKey = messageKey(messages[messages.length - 1]);

    const getViewport = () =>
        scrollRootRef.current?.querySelector<HTMLElement>(VIEWPORT_SELECTOR) ?? null;

    // A new thread: open its newest message and the newest one the person sent us.
    useEffect(() => {
        pendingRestore.current = null;
        setUnfolded(false);
        setExpanded(new Set());
    }, [selectedEmail]);

    useEffect(() => {
        setExpanded((prev) => {
            const next = new Set(prev);
            for (const key of defaultOpenKeys(messages)) next.add(key);
            return next.size === prev.size ? prev : next;
        });
        // Keyed on the newest message: a poll/reply that appends one opens it too.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEmail, lastKey]);

    // A different thread, or a message appended at the bottom: show the newest message from its
    // first line (Gmail). A short thread opens at the top so the subject stays in view.
    useEffect(() => {
        if (pendingRestore.current) return;
        const viewport = getViewport();
        if (!viewport) return;
        if (messages.length <= 2 || !lastKey) {
            viewport.scrollTop = 0;
            return;
        }
        const newest = Array.from(
            viewport.querySelectorAll<HTMLElement>('[data-message-key]')
        ).find((el) => el.dataset.messageKey === lastKey);
        newest?.scrollIntoView({ block: 'start' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEmail, lastKey]);

    // Older messages were prepended: keep what the reader was looking at where it was.
    useLayoutEffect(() => {
        const pending = pendingRestore.current;
        if (!pending || pending.firstKey === firstKey) return;
        pendingRestore.current = null;
        const viewport = getViewport();
        if (!viewport) return;
        viewport.scrollTop = pending.scrollTop + (viewport.scrollHeight - pending.scrollHeight);
    }, [firstKey]);

    // Opening the composer scrolls it into view so the admin sees where they are typing. Keyed on
    // open/closed, not the element (a new one every parent render, e.g. each list poll).
    const composerOpen = !!composer;
    useEffect(() => {
        if (composerOpen) bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, [composerOpen]);

    const title = useMemo(() => threadTitle(messages), [messages]);

    if (!selectedEmail) {
        return <EmptyThread />;
    }

    const display = counterpartyName || latestCounterpartyName(messages) || selectedEmail;

    const handleLoadOlder = () => {
        const viewport = getViewport();
        pendingRestore.current = {
            firstKey,
            scrollHeight: viewport?.scrollHeight ?? 0,
            scrollTop: viewport?.scrollTop ?? 0,
        };
        setUnfolded(true);
        onLoadOlder();
    };

    const toggle = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const rows = foldRows(messages, expanded, unfolded);

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-white">
            <Toolbar onBack={onBack} onReply={onReply} system={system} />

            {/* Radix wraps content in a display:table div that grows to its widest no-wrap
                child; block keeps the thread inside the pane on narrow screens. */}
            <ScrollArea
                ref={scrollRootRef}
                className="flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block"
            >
                <div className="mx-auto max-w-4xl px-4 pb-8 sm:px-6">
                    <h2 className="break-words pb-4 pt-5 text-h3 font-normal text-neutral-900">
                        {title || display}
                    </h2>

                    {hasMore && (
                        <div className="flex justify-center pb-3">
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={handleLoadOlder}
                                className="gap-1"
                            >
                                <ArrowUp size={12} /> {t('loadOlderMessages')}
                            </MyButton>
                        </div>
                    )}

                    {loading && messages.length === 0 ? (
                        <div className="space-y-3">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <Skeleton key={i} className="h-16 rounded-md" />
                            ))}
                        </div>
                    ) : messages.length === 0 ? (
                        <p className="py-8 text-center text-sm text-neutral-500">
                            {t('noMessages')}
                        </p>
                    ) : (
                        <div className="border-t border-neutral-200">
                            {rows.map((row) =>
                                row.kind === 'fold' ? (
                                    <FoldDivider
                                        key={`fold-${row.count}-${row.afterKey}`}
                                        count={row.count}
                                        onClick={() => setUnfolded(true)}
                                    />
                                ) : (
                                    <div key={row.key} data-message-key={row.key}>
                                        <MessageItem
                                            msg={row.msg}
                                            open={expanded.has(row.key)}
                                            onToggle={() => toggle(row.key)}
                                            threadDisplayName={display}
                                            threadTitle={title}
                                            instituteId={instituteId}
                                            onReply={onReply}
                                        />
                                    </div>
                                )
                            )}
                        </div>
                    )}

                    {messages.length > 0 &&
                        (composer ? (
                            <div className="pt-4">{composer}</div>
                        ) : (
                            onReply && (
                                <div className="flex gap-2 pt-5">
                                    <MyButton
                                        buttonType="secondary"
                                        scale="medium"
                                        onClick={onReply}
                                        className="gap-2 rounded-full"
                                    >
                                        <ArrowBendUpLeft size={16} />
                                        {t('reply')}
                                    </MyButton>
                                </div>
                            )
                        ))}
                    <div ref={bottomRef} />
                </div>
            </ScrollArea>
        </div>
    );
}

function Toolbar({
    onBack,
    onReply,
    system,
}: {
    onBack?: () => void;
    onReply?: () => void;
    system: boolean;
}) {
    const { t } = useTranslation('communicationEmailThread');
    return (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200 px-2 sm:px-4">
            {onBack && (
                <MyButton
                    buttonType="text"
                    scale="small"
                    layoutVariant="icon"
                    onClick={onBack}
                    className="md:hidden"
                    title={t('backToConversations')}
                    aria-label={t('backToConversations')}
                >
                    <ArrowLeft size={18} />
                </MyButton>
            )}
            <div className="flex-1" />
            {system && !onReply && (
                <span className="text-xs italic text-neutral-500">{t('automatedSender')}</span>
            )}
            {onReply && (
                <MyButton
                    buttonType="text"
                    scale="small"
                    layoutVariant="icon"
                    onClick={onReply}
                    title={t('reply')}
                    aria-label={t('reply')}
                >
                    <ArrowBendUpLeft size={18} />
                </MyButton>
            )}
        </header>
    );
}

function FoldDivider({ count, onClick }: { count: number; onClick: () => void }) {
    const { t } = useTranslation('communicationEmailThread');
    return (
        <div className="relative flex h-10 items-center border-b border-neutral-200">
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-neutral-200" />
            <button
                type="button"
                onClick={onClick}
                className="relative ms-4 flex size-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                title={t('moreMessages', { count })}
                aria-label={t('moreMessages', { count })}
            >
                {count}
            </button>
        </div>
    );
}

interface ItemProps {
    msg: EmailMessage;
    open: boolean;
    onToggle: () => void;
    threadDisplayName: string;
    threadTitle: string;
    instituteId: string;
    onReply?: () => void;
}

function MessageItem(props: ItemProps) {
    return props.open ? <OpenMessage {...props} /> : <CollapsedMessage {...props} />;
}

/** Who a message is from / to, as the header shows it. */
function useParties(msg: EmailMessage, threadDisplayName: string) {
    const { t } = useTranslation('communicationEmailThread');
    if (msg.direction === 'OUTGOING') {
        return {
            name: t('you'),
            address: msg.instituteAddress,
            to: threadDisplayName || msg.counterpartyEmail,
            avatarSeed: msg.instituteAddress || 'you',
            // Initials of the sending address ("support@vacademy.io" → SV), not of "You".
            avatarLabel: msg.instituteAddress || t('you'),
        };
    }
    return {
        name: msg.counterpartyName || threadDisplayName || msg.counterpartyEmail,
        address: msg.counterpartyEmail,
        to: msg.instituteAddress,
        avatarSeed: msg.counterpartyEmail,
        avatarLabel: msg.counterpartyName || threadDisplayName || msg.counterpartyEmail,
    };
}

function CollapsedMessage({ msg, onToggle, threadDisplayName }: ItemProps) {
    const { t, i18n } = useTranslation('communicationEmailThread');
    const parties = useParties(msg, threadDisplayName);
    const bounce = isSystemMessage(msg);
    const files = visibleAttachments(msg);
    const snippet = bounce ? t('deliveryFailed') : msg.bodyPreview || msg.subject || t('noSubject');

    return (
        <button
            type="button"
            onClick={onToggle}
            className="flex w-full items-center gap-3 border-b border-neutral-200 px-1 py-3 text-start hover:bg-neutral-50 focus:outline-none focus-visible:bg-neutral-50"
        >
            <EmailAvatar
                seed={parties.avatarSeed}
                label={parties.avatarLabel}
                outgoing={msg.direction === 'OUTGOING'}
                size="sm"
            />
            <span className="w-32 shrink-0 truncate text-sm font-medium text-neutral-900 sm:w-44">
                {parties.name}
            </span>
            <span
                className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    bounce ? 'text-warning-700' : 'text-neutral-500'
                )}
            >
                {snippet}
            </span>
            {files.length > 0 && <Paperclip size={14} className="shrink-0 text-neutral-500" />}
            <time
                className="shrink-0 whitespace-nowrap text-xs text-neutral-500"
                dateTime={msg.timestamp}
            >
                {formatShortDate(msg.timestamp, i18n.language)}
            </time>
        </button>
    );
}

function OpenMessage({
    msg,
    onToggle,
    threadDisplayName,
    threadTitle,
    instituteId,
    onReply,
}: ItemProps) {
    const { t, i18n } = useTranslation('communicationEmailThread');
    const parties = useParties(msg, threadDisplayName);
    const bounce = isSystemMessage(msg);
    const origin = resolveOrigin(msg);
    const files = visibleAttachments(msg);
    const showSubject = !!msg.subject && msg.subject.trim() !== threadTitle.trim();
    const canReply = !!onReply && msg.direction === 'INCOMING' && !bounce;

    return (
        <article className="border-b border-neutral-200 py-4">
            <header className="flex items-start gap-3">
                {/* The header is the collapse target, like Gmail's; actions sit outside it. */}
                <button
                    type="button"
                    onClick={onToggle}
                    className="flex min-w-0 flex-1 items-start gap-3 text-start focus:outline-none"
                >
                    <EmailAvatar
                        seed={parties.avatarSeed}
                        label={parties.avatarLabel}
                        outgoing={msg.direction === 'OUTGOING'}
                        size="md"
                    />
                    <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className="text-sm font-semibold text-neutral-900">
                                {parties.name}
                            </span>
                            {parties.address && (
                                <span className="truncate text-xs text-neutral-500">
                                    &lt;{parties.address}&gt;
                                </span>
                            )}
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                            {parties.to && (
                                <span className="truncate">
                                    {t('toAddress', { address: parties.to })}
                                </span>
                            )}
                            {!bounce && <OriginLabel origin={origin} />}
                            <DeliveryLabel msg={msg} />
                        </p>
                    </div>
                </button>
                <div className="flex shrink-0 items-center gap-1 pt-0.5">
                    {files.length > 0 && <Paperclip size={14} className="text-neutral-500" />}
                    <time
                        className="whitespace-nowrap text-xs text-neutral-500"
                        dateTime={msg.timestamp}
                        title={formatLongDate(msg.timestamp, i18n.language)}
                    >
                        <span className="hidden sm:inline">
                            {formatHeaderDate(msg.timestamp, i18n.language)}
                        </span>
                        <span className="sm:hidden">
                            {formatShortDate(msg.timestamp, i18n.language)}
                        </span>
                    </time>
                    {canReply && (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            layoutVariant="icon"
                            onClick={onReply}
                            title={t('reply')}
                            aria-label={t('reply')}
                        >
                            <ArrowBendUpLeft size={16} />
                        </MyButton>
                    )}
                </div>
            </header>

            <div className="mt-3 ps-0 sm:ps-12">
                {showSubject && (
                    <p className="mb-2 break-words text-sm font-medium text-neutral-900">
                        {msg.subject}
                    </p>
                )}
                {bounce ? (
                    <BounceBody msg={msg} />
                ) : msg.direction === 'OUTGOING' ? (
                    <OutgoingBody msg={msg} />
                ) : (
                    <IncomingBody msg={msg} instituteId={instituteId} />
                )}
                {msg.id && files.length > 0 && (
                    <EmailAttachmentList
                        messageId={msg.id}
                        instituteId={instituteId}
                        attachments={files}
                    />
                )}
            </div>
        </article>
    );
}

function OriginLabel({ origin }: { origin: string }) {
    const { t } = useTranslation('communicationEmailThread');
    return (
        <span className="rounded-sm bg-neutral-100 px-1.5 py-px text-2xs font-medium text-neutral-600">
            {t(`origin.${origin}`)}
        </span>
    );
}

const NOT_DELIVERED = new Set(['FAILED', 'BOUNCED', 'REJECTED', 'COMPLAINT']);

/** Our own email that did not (yet) go out — never let it read as delivered. */
function DeliveryLabel({ msg }: { msg: EmailMessage }) {
    const { t } = useTranslation('communicationEmailThread');
    const status = msg.direction === 'OUTGOING' ? msg.deliveryStatus?.toUpperCase() : undefined;
    const deferred = status === 'DEFERRED';
    if (!status || (!deferred && !NOT_DELIVERED.has(status))) return null;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-2xs font-medium',
                deferred ? 'bg-warning-50 text-warning-700' : 'bg-danger-50 text-danger-600'
            )}
            title={msg.deliveryErrorMessage || undefined}
        >
            <Warning size={10} weight="fill" />
            {deferred ? t('queued') : t('notDelivered')}
        </span>
    );
}

// The original HTML of inbound emails, fetched once per message for the session.
const inboundHtmlCache = new Map<string, Promise<string | null>>();

function useInboundHtml(msg: EmailMessage, instituteId: string) {
    const [state, setState] = useState<{ html: string | null; done: boolean }>({
        html: null,
        done: !msg.hasHtml,
    });
    useEffect(() => {
        if (!msg.hasHtml || !msg.id || !instituteId) {
            setState({ html: null, done: true });
            return;
        }
        let cancelled = false;
        let pending = inboundHtmlCache.get(msg.id);
        if (!pending) {
            pending = getInboundEmailHtml(msg.id, instituteId);
            pending.catch(() => inboundHtmlCache.delete(msg.id));
            inboundHtmlCache.set(msg.id, pending);
        }
        pending
            .then((html) => !cancelled && setState({ html, done: true }))
            .catch(() => !cancelled && setState({ html: null, done: true }));
        return () => {
            cancelled = true;
        };
    }, [msg.id, msg.hasHtml, instituteId]);
    return state;
}

/**
 * What a person sent us: their original HTML when the email has one (fetched on open), the
 * plain text meanwhile and as the fallback.
 */
function IncomingBody({ msg, instituteId }: { msg: EmailMessage; instituteId: string }) {
    const { html, done } = useInboundHtml(msg, instituteId);
    if (html) return <EmailHtmlFrame html={html} title={`email-${msg.id}`} />;
    return (
        <div className={cn(!done && 'opacity-70')}>
            <TextBody text={msg.body || msg.bodyPreview || ''} />
        </div>
    );
}

/** Plain text with the quoted chain behind Gmail's ••• toggle. */
function TextBody({ text }: { text: string }) {
    const { t } = useTranslation('communicationEmailThread');
    const [showQuoted, setShowQuoted] = useState(false);
    const { main, quoted } = splitQuotedReply(text);
    return (
        <div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-900">
                {main || '—'}
            </p>
            {quoted && (
                <>
                    <button
                        type="button"
                        onClick={() => setShowQuoted((v) => !v)}
                        className="mt-2 inline-flex h-4 items-center rounded-sm bg-neutral-200 px-1 text-neutral-600 hover:bg-neutral-300"
                        title={showQuoted ? t('hideTrimmedContent') : t('showTrimmedContent')}
                        aria-label={showQuoted ? t('hideTrimmedContent') : t('showTrimmedContent')}
                        aria-expanded={showQuoted}
                    >
                        <DotsThree size={16} weight="bold" />
                    </button>
                    {showQuoted && (
                        <pre className="mt-2 whitespace-pre-wrap break-words border-s border-neutral-300 ps-3 font-sans text-sm leading-relaxed text-neutral-600">
                            {quoted}
                        </pre>
                    )}
                </>
            )}
        </div>
    );
}

/** Something we sent: its HTML as the recipient saw it. */
function OutgoingBody({ msg }: { msg: EmailMessage }) {
    if (msg.body)
        return <EmailHtmlFrame html={msg.body} title={`email-${msg.id || msg.timestamp}`} />;
    return <TextBody text={msg.bodyPreview || ''} />;
}

/** A bounce / mail-system notice: whose address failed, with the daemon's text behind a toggle. */
function BounceBody({ msg }: { msg: EmailMessage }) {
    const { t } = useTranslation('communicationEmailThread');
    const [showDetails, setShowDetails] = useState(false);
    const details = (msg.body || msg.bodyPreview || '').trim();
    const long = details.length > BOUNCE_DETAILS_COLLAPSE_AT;
    const bounced = extractBouncedRecipients(details);

    return (
        <div className="space-y-1 rounded-md border border-warning-200 bg-warning-50 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-sm font-semibold text-warning-700">
                <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-warning-600" />
                <span className="break-words">
                    {bounced.length > 0
                        ? t('deliveryFailedTo', { address: bounced.join(', ') })
                        : t('deliveryFailed')}
                </span>
            </p>
            <p className="text-xs text-warning-700">{t('deliveryFailedHint')}</p>
            {details && (
                <div className="pt-0.5">
                    {long && (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            onClick={() => setShowDetails((v) => !v)}
                            className="h-6 px-1.5 text-2xs"
                        >
                            {showDetails ? t('hideDetails') : t('showDetails')}
                        </MyButton>
                    )}
                    {(!long || showDetails) && (
                        <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-neutral-600">
                            {details}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}

/** The counterparty's display name as the newest inbound message reported it. */
function latestCounterpartyName(messages: EmailMessage[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const name = messages[i]?.counterpartyName;
        if (name) return name;
    }
    return undefined;
}

function EmptyThread() {
    const { t } = useTranslation('communicationEmailThread');
    return (
        <div className="flex flex-1 items-center justify-center bg-white">
            <div className="text-center text-neutral-500">
                <EnvelopeSimple size={56} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">{t('selectConversation')}</p>
                <p className="mt-1 text-xs opacity-70">{t('selectConversationHint')}</p>
            </div>
        </div>
    );
}

function safeDate(timestamp: string): Date | null {
    const d = new Date(timestamp);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** "4:01 PM" today, "Oct 21" this year, "Oct 21, 2025" before. */
function formatShortDate(timestamp: string, locale: string): string {
    const d = safeDate(timestamp);
    if (!d) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    });
}

/** "Oct 21, 4:01 PM (2 hours ago)" — Gmail's header date. */
function formatHeaderDate(timestamp: string, locale: string): string {
    const d = safeDate(timestamp);
    if (!d) return '';
    const now = new Date();
    const absolute = d.toLocaleString(locale, {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
    const relative = relativeTime(d, now, locale);
    return relative ? `${absolute} (${relative})` : absolute;
}

function formatLongDate(timestamp: string, locale: string): string {
    const d = safeDate(timestamp);
    return d ? d.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' }) : '';
}

/** "2 hours ago" within the last week, else nothing (the absolute date says enough). */
function relativeTime(d: Date, now: Date, locale: string): string {
    const seconds = Math.round((d.getTime() - now.getTime()) / 1000);
    const abs = Math.abs(seconds);
    if (abs > 7 * 86400) return '';
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (abs < 60) return rtf.format(seconds, 'second');
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
    return rtf.format(Math.round(seconds / 86400), 'day');
}
