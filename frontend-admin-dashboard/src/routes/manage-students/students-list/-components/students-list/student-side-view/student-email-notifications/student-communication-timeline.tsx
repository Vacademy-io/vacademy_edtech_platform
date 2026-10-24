import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    getUserCommunications,
    type CommunicationItem,
    type StatusEvent,
} from '@/services/communication-timeline-service';
import {
    fetchCallHistory,
    type CallLogItem,
} from '@/components/shared/leads/services/call-history';
import { CallRecordingPlayButton } from '@/components/shared/leads/lead-call-history';
import { useStudentSidebar } from '../../../../-context/selected-student-sidebar-context';
import { formatDistanceToNow, format } from 'date-fns';
import {
    ChatsCircle,
    Envelope,
    EnvelopeSimple,
    Phone,
    PhoneIncoming,
    PhoneOutgoing,
    Robot,
    WhatsappLogo,
    BellRinging,
    ChatTeardrop,
    ArrowUp,
    ArrowDown,
    CaretDown,
    CaretUp,
    FileText,
    ArrowClockwise,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { WhatsAppTemplateButtons } from '@/components/shared/whatsapp/whatsapp-template-buttons';
import {
    MessageOriginIcon,
    messageOriginKey,
    type MessageOrigin,
} from '@/components/shared/whatsapp/message-origin';
import { MyButton } from '@/components/design-system/button';
import { IndividualSendDialog } from './individual-send-dialog';
import {
    ResendMessageDialog,
    canResend,
    resendBlockedReason,
    showsResendControl,
} from './resend-message-dialog';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    getDisplaySettingsFromCache,
    getDisplaySettingsWithFallback,
} from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import {
    ProfileSkeleton,
    ProfileEmpty,
    ProfileError,
    ProfileTimeline,
    type ProfileTimelineItem,
} from '../profile-ui';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

// ─── HTML helpers ──────────────────────────────────────────────────────────
// The communication-timeline service often returns the raw email HTML in
// `title` / `bodyPreview` (e.g. starting with `<!DOCTYPE html>`). Showing that
// verbatim makes the timeline unreadable, so we strip tags client-side.

const HTML_LIKE = /^\s*<!?(?:DOCTYPE|html|head|body|div|p|span|table|tr|td|h\d|br|meta)\b/i;

const looksLikeHtml = (text?: string | null): boolean =>
    !!text && (HTML_LIKE.test(text) || /<[a-z][^>]*>/i.test(text));

// Decode the small set of named entities that show up in real emails. We
// intentionally avoid setting innerHTML on a temporary node here — that runs
// linked images and would broaden the XSS surface; a regex pass is enough for
// preview text.
const decodeEntities = (text: string): string =>
    text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// Plain-text version of an HTML string, suitable for one-line previews.
const htmlToPreviewText = (html: string, maxLen = 140): string => {
    const stripped = html
        // drop <style>/<script> blocks entirely so their CSS/JS doesn't
        // leak into the preview
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        // strip every remaining complete tag
        .replace(/<[^>]+>/g, ' ')
        // strip a dangling/unclosed tag — backend previews are often HTML cut
        // mid-tag (e.g. "<table align='center' width='600' style='...mar"), which
        // has no closing ">" so the rule above can't remove it.
        .replace(/<[^>]*$/g, ' ');
    const text = decodeEntities(stripped).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text;
};

// Best-effort subject extraction: prefer the document's <title>, fall back to
// the first heading, and finally to a truncated text preview.
const extractEmailSubject = (
    rawTitle: string | undefined,
    body: string | undefined,
    t: TFunction
): string => {
    const candidates = [rawTitle, body].filter(Boolean) as string[];
    for (const c of candidates) {
        const titleMatch = c.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch?.[1]) {
            const decoded = decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim();
            if (decoded) return decoded;
        }
        const h1 = c.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1?.[1]) {
            const decoded = decodeEntities(h1[1].replace(/<[^>]+>/g, ' '))
                .replace(/\s+/g, ' ')
                .trim();
            if (decoded) return decoded;
        }
    }
    if (rawTitle && !looksLikeHtml(rawTitle)) {
        const trimmed = rawTitle.trim();
        if (trimmed) return trimmed;
    }
    if (body) {
        const fallback = htmlToPreviewText(body, 80);
        if (fallback) return fallback;
    }
    return t('noSubject');
};

// The subject to show — and, on a resend, to send again. Prefer the one the send actually stored
// (notification_service reads it back off message_payload); the scrape above is the fallback for
// rows written before it was returned.
const emailSubjectOf = (item: CommunicationItem, t: TFunction): string =>
    item.subject?.trim() || extractEmailSubject(item.title, item.fullBody || item.bodyPreview, t);

/** Everything a row's resend needs that the row itself does not carry. */
export interface ResendContext {
    instituteId: string;
    userId?: string;
    recipientName?: string;
    /** Role display setting — off hides the control entirely for this role. */
    allowed: boolean;
    /** Refetch the timeline so the resent message appears. */
    onResent: () => void;
}

/**
 * Whether this admin's role may resend from the timeline.
 *
 * Read here rather than passed in because the timeline mounts in two places (the side view and the
 * profile overlay) and neither owns the flag. Cache-first: the side view has already loaded the
 * same blob by the time this renders, so this is normally free.
 *
 * Starts null, not false: rendering the control and then pulling it away reads as a bug, and
 * rendering nothing until the answer arrives is honest about not knowing yet.
 */
function useResendAllowed(): boolean | null {
    const [allowed, setAllowed] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        const resolve = async () => {
            try {
                const roleKey = getActiveRoleDisplaySettingsKey();
                const settings =
                    getDisplaySettingsFromCache(roleKey)?.studentSideView ??
                    (await getDisplaySettingsWithFallback(roleKey)).studentSideView;
                if (cancelled) return;
                // Undefined = an institute that saved its settings before this flag existed. The
                // merge has already applied the role's default, so undefined here only happens
                // when no settings resolved at all — treat that as the admin default, on.
                setAllowed(settings?.allowResendMessage ?? true);
            } catch {
                // A settings lookup that fails must not silently revoke an admin's action.
                if (!cancelled) setAllowed(true);
            }
        };
        void resolve();
        return () => {
            cancelled = true;
        };
    }, []);

    return allowed;
}

// ─── Channel Config ─────────────────────────────────────────────────────────
// Colors use design-system semantic tokens: info for email, success for WhatsApp,
// primary for push notifications, warning for SMS.

type ChannelConfig = Record<
    string,
    { icon: PhosphorIcon; pillClass: string; iconClass: string; label: string }
>;

const buildChannelConfig = (t: TFunction): ChannelConfig => ({
    EMAIL: {
        icon: Envelope,
        pillClass: 'bg-info-50 text-info-700 ring-1 ring-info-200',
        iconClass: 'text-info-600',
        label: t('channels.EMAIL'),
    },
    WHATSAPP: {
        icon: WhatsappLogo,
        pillClass: 'bg-success-50 text-success-700 ring-1 ring-success-200',
        iconClass: 'text-success-600',
        label: t('channels.WHATSAPP'),
    },
    PUSH: {
        icon: BellRinging,
        pillClass: 'bg-primary-50 text-primary-700 ring-1 ring-primary-200',
        iconClass: 'text-primary-600',
        label: t('channels.PUSH'),
    },
    SMS: {
        icon: ChatTeardrop,
        pillClass: 'bg-warning-50 text-warning-700 ring-1 ring-warning-200',
        iconClass: 'text-warning-600',
        label: t('channels.SMS'),
    },
    // Calls come from admin_core's telephony_call_log, not notification_service.
    // Separate databases, so this is the one channel merged client-side.
    CALL: {
        icon: Phone,
        pillClass: 'bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200',
        iconClass: 'text-neutral-600',
        label: t('channels.CALL'),
    },
});

// Status pill classes use semantic tokens only (no raw colors).
type StatusConfig = Record<string, { pillClass: string; label: string }>;

const buildStatusConfig = (t: TFunction): StatusConfig => ({
    PENDING: {
        pillClass: 'bg-warning-50 text-warning-700 ring-1 ring-warning-200',
        label: t('statuses.PENDING'),
    },
    SENT: {
        pillClass: 'bg-info-50 text-info-700 ring-1 ring-info-200',
        label: t('statuses.SENT'),
    },
    DELIVERED: {
        pillClass: 'bg-success-50 text-success-700 ring-1 ring-success-200',
        label: t('statuses.DELIVERED'),
    },
    READ: {
        pillClass: 'bg-success-50 text-success-700 ring-1 ring-success-200',
        label: t('statuses.READ'),
    },
    CLICKED: {
        pillClass: 'bg-primary-50 text-primary-700 ring-1 ring-primary-200',
        label: t('statuses.CLICKED'),
    },
    FAILED: {
        pillClass: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
        label: t('statuses.FAILED'),
    },
    BOUNCED: {
        pillClass: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
        label: t('statuses.BOUNCED'),
    },
    COMPLAINT: {
        pillClass: 'bg-warning-50 text-warning-700 ring-1 ring-warning-200',
        label: t('statuses.COMPLAINT'),
    },
    RECEIVED: {
        pillClass: 'bg-info-50 text-info-700 ring-1 ring-info-200',
        label: t('statuses.RECEIVED'),
    },
});

type ChannelFilter = 'ALL' | 'EMAIL' | 'WHATSAPP' | 'PUSH' | 'CALL';

const buildFilterOptions = (t: TFunction): Array<{ key: ChannelFilter; label: string }> => [
    { key: 'ALL', label: t('filters.all') },
    { key: 'EMAIL', label: t('channels.EMAIL') },
    { key: 'WHATSAPP', label: t('channels.WHATSAPP') },
    { key: 'PUSH', label: t('channels.PUSH') },
    { key: 'CALL', label: t('channels.CALL') },
];

// ─── Status Mini Timeline ───────────────────────────────────────────────────

const STATUS_FLOW_EMAIL = ['SENT', 'DELIVERED', 'READ', 'CLICKED'];

function StatusMiniTimeline({ events, status }: { events: StatusEvent[]; status: string }) {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const statusConfig = buildStatusConfig(t);
    const flow = STATUS_FLOW_EMAIL;
    const achieved = new Set(events.map((e) => e.status));
    // Also mark the current status
    achieved.add(status);

    return (
        <div className="mt-1.5 flex items-center gap-1">
            {flow.map((step, i) => {
                const active = achieved.has(step);
                return (
                    <div key={step} className="flex items-center gap-1">
                        <div
                            className={cn(
                                'size-2 rounded-full transition-colors',
                                active ? 'bg-success-500' : 'bg-neutral-200'
                            )}
                            title={statusConfig[step]?.label ?? step}
                        />
                        {i < flow.length - 1 && (
                            <div
                                className={cn(
                                    'h-px w-3',
                                    active ? 'bg-success-300' : 'bg-neutral-200'
                                )}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Date Separator ─────────────────────────────────────────────────────────

function DateSeparator({ date }: { date: Date }) {
    return (
        <div className="flex items-center gap-3 py-2">
            <div className="h-px flex-1 bg-neutral-200" />
            <span className="text-xs font-medium text-neutral-500">
                {format(date, 'MMM d, yyyy')}
            </span>
            <div className="h-px flex-1 bg-neutral-200" />
        </div>
    );
}

// ─── Status Pill ─────────────────────────────────────────────────────────────

function StatusPill({ statusKey }: { statusKey: string }) {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const statusConfig = buildStatusConfig(t);
    const cfg = statusConfig[statusKey] ?? statusConfig.PENDING!;
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                cfg.pillClass
            )}
        >
            {cfg.label}
        </span>
    );
}

// ─── WhatsApp header media (image / video / document) ────────────────────────
// Renders the actual attachment sent in a template's media header.

function TimelineHeaderMedia({ type, url }: { type?: string; url: string }) {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const mediaKind = (type || 'IMAGE').toUpperCase();

    if (mediaKind === 'VIDEO') {
        return <video src={url} controls className="mb-2 max-h-64 w-full rounded-md bg-neutral-100" />;
    }

    if (mediaKind === 'DOCUMENT') {
        return (
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1.5 text-xs text-info-600 hover:underline"
            >
                <FileText className="size-3.5" /> {t('headerMedia.viewDocument')}
            </a>
        );
    }

    // IMAGE (default) — click to open full size; hides itself if the URL is dead/expired.
    return (
        <a href={url} target="_blank" rel="noopener noreferrer">
            <img
                src={url}
                alt={t('headerMedia.attachmentAlt')}
                loading="lazy"
                onError={(e) => {
                    const anchor = e.currentTarget.closest('a');
                    if (anchor) anchor.style.display = 'none';
                }}
                className="mb-2 max-h-64 w-full rounded-md bg-neutral-100 object-contain"
            />
        </a>
    );
}

// ─── Origin ────────────────────────────────────────────────────────────────
// Which workflow or chatbot flow sent a WhatsApp message. Renders nothing when unknown.

function OriginLine({
    origin,
    className,
}: {
    origin: MessageOrigin | null | undefined;
    className?: string;
}) {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const key = messageOriginKey(origin);
    if (!key || !origin) return null;
    return (
        <span className={cn('flex min-w-0 items-center gap-1', className)}>
            <MessageOriginIcon type={origin.type} />
            <span className="truncate">{t(key, { name: origin.name })}</span>
        </span>
    );
}

// ─── Expanded Detail Body ───────────────────────────────────────────────────
// Rendered as the `body` slot of a ProfileTimelineItem when the item is
// expanded.  Click propagation is stopped so expanding text-selection inside
// the email HTML doesn't collapse the item.

function ExpandedDetail({
    item,
    onCollapse,
    onResend,
}: {
    item: CommunicationItem;
    onCollapse: () => void;
    /** Absent on rows that carry no resend control at all (inbound, or no institute). */
    onResend?: () => void;
}) {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const isEmail = item.channel === 'EMAIL';
    const subject = isEmail ? emailSubjectOf(item, t) : item.title;

    return (
        <div
            className="mt-2 space-y-3 border-t border-neutral-100 pt-3"
            onClick={(e) => e.stopPropagation()}
        >
            {/* EMAIL → render as an email-client card (Gmail-like): a sender row
                with a red envelope avatar + from/date/to, then the subject, then
                the email's own HTML body. Non-email channels keep the plain
                Message box. */}
            {isEmail && item.fullBody ? (
                <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                    {/* Header: sender identity + timestamp + recipient */}
                    <div className="flex items-start gap-2.5 border-b border-neutral-100 bg-neutral-50/70 px-3 py-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-danger-50 text-danger-600">
                            <EnvelopeSimple weight="fill" className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                                <span
                                    className="truncate text-xs font-semibold text-neutral-800"
                                    title={item.senderInfo || undefined}
                                >
                                    {item.senderInfo || t('expandedDetail.senderFallback')}
                                </span>
                                <span className="shrink-0 text-2xs text-neutral-400">
                                    {format(new Date(item.timestamp), 'MMM d, h:mm a')}
                                </span>
                            </div>
                            {item.recipientInfo && (
                                <div
                                    className="truncate text-2xs text-neutral-500"
                                    title={item.recipientInfo}
                                >
                                    {t('expandedDetail.toRecipient', {
                                        recipient: item.recipientInfo,
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Subject */}
                    {subject && (
                        <p className="px-3 pt-2.5 text-xs font-semibold text-neutral-900">
                            {subject}
                        </p>
                    )}
                    {/* Body — the email's own HTML, contained so wide markup scrolls
                        inside this box instead of widening the panel. */}
                    <div
                        className="max-h-96 max-w-full overflow-auto px-3 pb-3 pt-2 text-xs text-neutral-800 [&_img]:max-w-full [&_table]:max-w-full"
                        dangerouslySetInnerHTML={{ __html: item.fullBody }}
                    />
                </div>
            ) : (
                (item.fullBody || item.headerMediaUrl) && (
                    <div className="rounded-md border border-neutral-100 bg-neutral-50 p-2.5">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {t('expandedDetail.messageHeading')}
                        </p>
                        {item.headerMediaUrl && (
                            <TimelineHeaderMedia
                                type={item.headerType}
                                url={item.headerMediaUrl}
                            />
                        )}
                        {item.fullBody && (
                            <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-xs text-neutral-700">
                                {item.fullBody}
                            </p>
                        )}
                        {item.buttons && item.buttons.length > 0 && (
                            <WhatsAppTemplateButtons
                                buttons={item.buttons}
                                className="mt-2 rounded-md border border-neutral-200 bg-white"
                            />
                        )}
                    </div>
                )
            )}

            {/* Who sent it: the workflow or chatbot flow behind this message */}
            <OriginLine origin={item.origin} className="text-xs text-neutral-700" />

            {/* Template name */}
            {item.templateName && (
                <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-neutral-500">
                        {t('expandedDetail.templateLabel')}
                    </span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700">
                        {item.templateName}
                    </span>
                </div>
            )}

            {/* Sender / Recipient / Source — From/To already live in the email
                header above, so for email we only surface Source here. */}
            <div className="space-y-1 text-xs">
                {!isEmail && item.senderInfo && (
                    <div className="flex gap-2">
                        <span className="font-medium text-neutral-500">
                            {t('expandedDetail.fromLabel')}
                        </span>
                        <span className="text-neutral-700">{item.senderInfo}</span>
                    </div>
                )}
                {!isEmail && item.recipientInfo && (
                    <div className="flex gap-2">
                        <span className="font-medium text-neutral-500">
                            {t('expandedDetail.toLabel')}
                        </span>
                        <span className="text-neutral-700">{item.recipientInfo}</span>
                    </div>
                )}
                {item.source && (
                    <div className="flex gap-2">
                        <span className="font-medium text-neutral-500">
                            {t('expandedDetail.sourceLabel')}
                        </span>
                        <span className="text-neutral-700">{item.source}</span>
                    </div>
                )}
            </div>

            {/* Status delivery timeline */}
            {item.statusTimeline && item.statusTimeline.length > 0 && (
                <div>
                    <p className="mb-1.5 text-xs font-medium text-neutral-500">
                        {t('expandedDetail.deliveryTimelineHeading')}
                    </p>
                    <div className="space-y-1.5">
                        {item.statusTimeline.map((event, i) => (
                            <div
                                key={`${event.status}-${event.timestamp}-${i}`}
                                className="flex items-center gap-2 text-xs"
                            >
                                <div className="size-1.5 rounded-full bg-neutral-300" />
                                <StatusPill statusKey={event.status} />
                                <span className="text-neutral-500">
                                    {format(new Date(event.timestamp), 'MMM d, h:mm a')}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={onCollapse}
                    className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                    <CaretUp className="size-3" />
                    {t('expandedDetail.collapse')}
                </button>
                {/* Repeated here on purpose: by the time an admin has read the message the header
                    chip is scrolled out of view, and this is the moment they decide to resend. */}
                {onResend && <ResendButton item={item} onClick={onResend} />}
            </div>
        </div>
    );
}

// ─── Resend control ──────────────────────────────────────────────────────────
// Deliberately a filled chip rather than a bare icon: this is the only action on the whole tab,
// and as grey text beside the status pill it read as a label and went unnoticed. Rows we cannot
// replay keep the chip, disabled, with the reason on hover — silence there is indistinguishable
// from the feature not existing.

function ResendButton({
    item,
    onClick,
    className,
}: {
    item: CommunicationItem;
    onClick: () => void;
    className?: string;
}) {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const blocked = resendBlockedReason(item);
    const enabled = canResend(item);
    const tooltip = enabled
        ? t('resend.buttonTooltip')
        : t(`resend.blocked.${blocked}`, { defaultValue: t('resend.blocked.unsupportedChannel') });

    return (
        <button
            type="button"
            disabled={!enabled}
            title={tooltip}
            aria-label={tooltip}
            // The whole card toggles expand — a resend must not also open the row.
            onClick={(e) => {
                e.stopPropagation();
                if (enabled) onClick();
            }}
            className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                enabled
                    ? 'bg-primary-50 text-primary-600 ring-primary-200 hover:bg-primary-100'
                    : 'cursor-not-allowed bg-neutral-100 text-neutral-400 ring-neutral-200',
                className
            )}
        >
            <ArrowClockwise className="size-3" />
            {t('resend.button')}
        </button>
    );
}

// ─── Communication Timeline Item (card body for ProfileTimeline) ─────────────
// This component is rendered inside the `body` slot of each ProfileTimelineItem.
// It provides the expand/collapse interaction with preview text and delivery
// status dots — all behaviour the spec requires to be preserved.

function CommItemBody({ item, resend }: { item: CommunicationItem; resend: ResendContext }) {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const channelConfig = buildChannelConfig(t);
    const [expanded, setExpanded] = useState(false);
    const [resendOpen, setResendOpen] = useState(false);
    const channel = channelConfig[item.channel] ?? channelConfig.EMAIL!;
    const isInbound = item.direction === 'INBOUND';
    // Only an outbound message we can rebuild a send from — never an inbound one, and never a
    // free-text WhatsApp reply, which has no template for the send API to replay.
    // Shown on every outbound row (disabled where the send cannot be replayed); hidden only on
    // inbound ones, when the role's display settings withhold it, and when we have no institute
    // to send on behalf of.
    const showResend = resend.allowed && showsResendControl(item) && !!resend.instituteId;

    const isEmail = item.channel === 'EMAIL';
    // For emails prefer the COMPLETE fullBody — the backend's bodyPreview is often
    // HTML truncated mid-tag, which has no real text to extract. Fall back to
    // bodyPreview when fullBody is absent.
    const rawPreview = isEmail
        ? item.fullBody || item.bodyPreview || ''
        : item.bodyPreview || '';
    const displayPreview = looksLikeHtml(rawPreview)
        ? htmlToPreviewText(rawPreview, 160)
        : rawPreview;

    return (
        <div
            className="cursor-pointer select-none rounded-md border border-neutral-100 bg-neutral-50 p-2.5 transition-shadow hover:shadow-sm"
            onClick={() => setExpanded((v) => !v)}
        >
            {/* Direction label row */}
            <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                    {isInbound ? (
                        <ArrowDown className="size-3 shrink-0 text-success-500" />
                    ) : (
                        <ArrowUp className="size-3 shrink-0 text-info-500" />
                    )}
                    <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                        {isInbound
                            ? t('direction.received', { channel: channel.label })
                            : t('direction.sent', { channel: channel.label })}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <StatusPill statusKey={item.status} />
                    {showResend && <ResendButton item={item} onClick={() => setResendOpen(true)} />}
                    {expanded ? (
                        <CaretUp className="size-3 text-neutral-400" />
                    ) : (
                        <CaretDown className="size-3 text-neutral-400" />
                    )}
                </div>
            </div>

            {/* Body preview */}
            {!expanded && displayPreview && (
                <p className="line-clamp-2 text-xs text-neutral-600">{displayPreview}</p>
            )}

            {/* Timestamp (+ who sent it) + mini delivery dots */}
            <div className="mt-1.5 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-xs text-neutral-400">
                        {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                    </span>
                    {!expanded && (
                        <OriginLine origin={item.origin} className="text-xs text-neutral-500" />
                    )}
                </div>
                {item.channel === 'EMAIL' && !isInbound && (
                    <StatusMiniTimeline events={item.statusTimeline || []} status={item.status} />
                )}
            </div>

            {/* Expanded details */}
            {expanded && (
                <ExpandedDetail
                    item={item}
                    onCollapse={() => setExpanded(false)}
                    onResend={showResend ? () => setResendOpen(true) : undefined}
                />
            )}

            {/* Resend confirmation. Rendered in a portal, so its clicks never reach the card. */}
            {resendOpen && (
                <ResendMessageDialog
                    open={resendOpen}
                    onOpenChange={setResendOpen}
                    item={item}
                    instituteId={resend.instituteId}
                    emailSubject={emailSubjectOf(item, t)}
                    userId={resend.userId}
                    recipientName={resend.recipientName}
                    onSent={resend.onResent}
                />
            )}
        </div>
    );
}

// ─── Map a CommunicationItem → ProfileTimelineItem ───────────────────────────

function toTimelineItem(
    item: CommunicationItem,
    t: TFunction,
    channelConfig: ChannelConfig,
    resend: ResendContext
): ProfileTimelineItem {
    const channel = channelConfig[item.channel] ?? channelConfig.EMAIL!;
    const isEmail = item.channel === 'EMAIL';
    const displayTitle = isEmail ? emailSubjectOf(item, t) : item.title || t('noSubject');

    // Tone: direction-based — outbound=primary, inbound=success, failed/bounced=danger
    const failedStatuses = new Set(['FAILED', 'BOUNCED', 'COMPLAINT']);
    const tone =
        failedStatuses.has(item.status)
            ? 'danger'
            : item.direction === 'INBOUND'
              ? 'success'
              : 'primary';

    return {
        id: item.id,
        icon: channel.icon,
        tone,
        title: (
            <span className="truncate font-medium text-neutral-800" title={displayTitle}>
                {displayTitle}
            </span>
        ),
        meta: formatDistanceToNow(new Date(item.timestamp), { addSuffix: true }),
        body: <CommItemBody item={item} resend={resend} />,
    };
}

// ─── Call items ─────────────────────────────────────────────────────────────
// A call is not a message: no subject, no body, no delivery statuses. What
// matters is who dialled whom, whether it connected, how long it ran, and the
// recording. Rendered as a compact card so it sits alongside messages without
// pretending to be one.

const ENDED_WELL = new Set(['COMPLETED']);
const ENDED_BADLY = new Set(['NO_ANSWER', 'BUSY', 'FAILED', 'CANCELLED']);

const callStatusTone = (status: string) =>
    ENDED_WELL.has(status) ? 'success' : ENDED_BADLY.has(status) ? 'danger' : 'primary';

const callStatusPill = (status: string) =>
    ENDED_WELL.has(status)
        ? 'bg-success-50 text-success-700 ring-1 ring-success-200'
        : ENDED_BADLY.has(status)
          ? 'bg-danger-50 text-danger-700 ring-1 ring-danger-200'
          : 'bg-info-50 text-info-700 ring-1 ring-info-200';

const formatCallDuration = (t: TFunction, seconds?: number | null): string | null => {
    if (!seconds || seconds <= 0) return null;
    return t('call.duration', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
};

/** Call time: startTime is the provider's answer; AI calls only set createdAt. */
const callTimestamp = (c: CallLogItem): string =>
    c.startTime || c.createdAt || c.endTime || new Date(0).toISOString();

const CallItemBody = ({ item, instituteId }: { item: CallLogItem; instituteId: string }) => {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const duration = formatCallDuration(t, item.durationSeconds);
    const statusLabel = t(`call.status.${item.status}`, { defaultValue: item.status });
    return (
        <div className="mt-1.5 rounded-md border border-neutral-200 bg-white p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
                <span
                    className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium',
                        callStatusPill(item.status)
                    )}
                >
                    {statusLabel}
                </span>
                {duration && <span className="text-2xs text-neutral-500">{duration}</span>}
                {item.aiDisposition && (
                    <span className="text-2xs text-neutral-600">
                        {t('call.outcome')}:{' '}
                        <span className="font-medium">{item.aiDisposition}</span>
                    </span>
                )}
                {item.aiCallRetry != null && item.aiCallRetry > 0 && (
                    <span className="text-2xs text-neutral-400">
                        {t('call.attempt', { n: item.aiCallRetry + 1 })}
                    </span>
                )}
            </div>
            {/* The recording is the whole reason this channel exists in the tab.
                Presigned URL is fetched on first play, not on render — the
                counsellor may scroll past a dozen calls without listening. */}
            <div className="mt-2">
                {item.hasRecording ? (
                    <CallRecordingPlayButton callLogId={item.id} instituteId={instituteId} />
                ) : (
                    <span className="text-2xs text-neutral-400">{t('call.noRecording')}</span>
                )}
            </div>
        </div>
    );
};

function toCallTimelineItem(
    item: CallLogItem,
    t: TFunction,
    instituteId: string
): ProfileTimelineItem {
    const isAi = !!item.aiDisposition || item.aiCallRetry != null;
    const title = isAi
        ? t('call.aiCall')
        : item.direction === 'INBOUND'
          ? t('call.inbound')
          : t('call.outbound');
    return {
        id: `call-${item.id}`,
        icon: isAi ? Robot : item.direction === 'INBOUND' ? PhoneIncoming : PhoneOutgoing,
        tone: callStatusTone(item.status),
        title: <span className="truncate font-medium text-neutral-800">{title}</span>,
        meta: formatDistanceToNow(new Date(callTimestamp(item)), { addSuffix: true }),
        body: <CallItemBody item={item} instituteId={instituteId} />,
    };
}

/** One row of the merged feed — a message or a call — with the sort key hoisted. */
type FeedEntry =
    | { kind: 'message'; ts: string; item: CommunicationItem }
    | { kind: 'call'; ts: string; item: CallLogItem };

// ─── Main Component ─────────────────────────────────────────────────────────

export const StudentCommunicationTimeline = () => {
    const { t } = useTranslation('manageStudentsCommunicationTimeline');
    const channelConfig = buildChannelConfig(t);
    const filterOptions = buildFilterOptions(t);
    const { selectedStudent } = useStudentSidebar();
    const [page, setPage] = useState(0);
    const [channelFilter, setChannelFilter] = useState<ChannelFilter>('ALL');
    const pageSize = 20;
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id ?? '';
    const [sendDialog, setSendDialog] = useState<'EMAIL' | 'WHATSAPP' | null>(null);
    const resendAllowed = useResendAllowed();

    const email = selectedStudent?.email || undefined;
    const phone = selectedStudent?.mobile_number || undefined;
    const hasContact = !!(email || phone);
    const userId = selectedStudent?.user_id || undefined;

    // Messages come from notification_service, keyed by email/phone. Not asked
    // for at all under the CALL chip — that channel is unknown to it.
    const wantMessages = channelFilter !== 'CALL';
    const {
        data: timelineData,
        isLoading: messagesLoading,
        error: messagesError,
        refetch,
    } = useQuery({
        queryKey: ['communication-timeline', email, phone, page, channelFilter],
        queryFn: () =>
            getUserCommunications({
                email,
                phone,
                page,
                size: pageSize,
                channels: channelFilter === 'ALL' ? undefined : [channelFilter],
            }),
        enabled: hasContact && wantMessages,
        staleTime: 30000,
    });

    // Calls come from admin_core, keyed by the learner's user id — every call
    // to this person, whoever placed it and however (counsellor, admin, AI).
    // Fetched under ALL and CALL; the same page index as the messages so the
    // two paged sources interleave as evenly as two independent pages can.
    const wantCalls = channelFilter === 'ALL' || channelFilter === 'CALL';
    const {
        data: callsData,
        isLoading: callsLoading,
        error: callsError,
        refetch: refetchCalls,
    } = useQuery({
        queryKey: ['telephony-call-history', userId, instituteId, page, pageSize],
        queryFn: () => fetchCallHistory(userId!, instituteId, page, pageSize),
        enabled: !!userId && !!instituteId && wantCalls,
        staleTime: 30000,
    });

    const isLoading =
        (wantMessages && hasContact && messagesLoading) || (wantCalls && !!userId && callsLoading);
    // Under ALL, a failed call fetch must not blank the messages — degrade to
    // messages-only. Under CALL there is nothing else to show, so surface it.
    const error = wantMessages ? messagesError : callsError;

    // ─── Guard states ────────────────────────────────────────────────────────

    if (!hasContact) {
        return (
            <ProfileEmpty
                icon={Envelope}
                title={t('emptyStates.noContactTitle')}
                hint={t('emptyStates.noContactHint')}
            />
        );
    }

    if (isLoading) {
        return <ProfileSkeleton blocks={3} />;
    }

    if (error) {
        return (
            <ProfileError
                title={t('emptyStates.loadErrorTitle')}
                hint={t('emptyStates.loadErrorHint')}
                onRetry={() => {
                    void refetch();
                    void refetchCalls();
                }}
            />
        );
    }

    const communications = wantMessages ? timelineData?.content || [] : [];
    const calls = wantCalls ? callsData?.content || [] : [];

    // Shared by every row's resend button — the row itself knows the message, not who owns it.
    const resendContext: ResendContext = {
        instituteId,
        userId,
        recipientName: selectedStudent?.full_name || undefined,
        // null (still resolving) renders no control, same as an explicit false.
        allowed: resendAllowed === true,
        onResent: () => {
            void refetch();
        },
    };

    // Merge the two sources into one feed, newest first. Each is already a
    // page from its own service; sorting the union keeps the page coherent
    // even though the boundary between pages is only approximate.
    const feed: FeedEntry[] = [
        ...communications.map((item): FeedEntry => ({ kind: 'message', ts: item.timestamp, item })),
        ...calls.map((item): FeedEntry => ({ kind: 'call', ts: callTimestamp(item), item })),
    ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    // Group by date for separators
    const groupedItems: Array<{ type: 'date'; date: Date } | { type: 'item'; entry: FeedEntry }> =
        [];
    let lastDate: string | null = null;

    for (const entry of feed) {
        const itemDate = new Date(entry.ts);
        const dateKey = format(itemDate, 'yyyy-MM-dd');
        if (dateKey !== lastDate) {
            groupedItems.push({ type: 'date', date: itemDate });
            lastDate = dateKey;
        }
        groupedItems.push({ type: 'item', entry });
    }

    // Count by channel for filter chip badges
    const channelCounts = communications.reduce(
        (acc, item) => {
            acc[item.channel] = (acc[item.channel] || 0) + 1;
            return acc;
        },
        {} as Record<string, number>
    );
    if (calls.length > 0) channelCounts.CALL = calls.length;

    // Two paged sources → the feed's page count is whichever runs longer, and
    // its total is the sum. Good enough for a per-student view.
    const totalPages = Math.max(
        wantMessages ? timelineData?.totalPages ?? 0 : 0,
        wantCalls ? callsData?.totalPages ?? 0 : 0
    );
    const totalElements =
        (wantMessages ? timelineData?.totalElements ?? 0 : 0) +
        (wantCalls ? callsData?.totalElements ?? 0 : 0);

    return (
        <div className="flex flex-col gap-4">
            {/* ── Send Notification card (matches production) ──────────────── */}
            <div className="rounded-lg border border-neutral-200 bg-card p-3">
                <div className="mb-2 flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-info-50 text-info-600">
                        <BellRinging className="size-4" weight="duotone" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-semibold text-neutral-800">
                            {t('sendCard.heading')}
                        </h4>
                        <p className="text-2xs text-neutral-500">{t('sendCard.subheading')}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={!selectedStudent?.email}
                        onClick={() => {
                            if (selectedStudent) setSendDialog('EMAIL');
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 border-info-200 text-info-700 hover:border-info-300 hover:bg-info-50"
                    >
                        <Envelope className="size-3.5" />
                        {t('channels.EMAIL')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={!selectedStudent?.mobile_number}
                        onClick={() => {
                            if (selectedStudent) setSendDialog('WHATSAPP');
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 border-success-200 text-success-700 hover:border-success-300 hover:bg-success-50"
                    >
                        <WhatsappLogo className="size-3.5" />
                        {t('channels.WHATSAPP')}
                    </MyButton>
                </div>
            </div>

            {/* ── Channel filter chips ─────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
                {filterOptions.map((opt) => (
                    <button
                        key={opt.key}
                        type="button"
                        onClick={() => {
                            setChannelFilter(opt.key);
                            setPage(0);
                        }}
                        className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                            channelFilter === opt.key
                                ? 'bg-primary-500 text-white'
                                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        )}
                    >
                        {opt.label}
                        {opt.key !== 'ALL' && channelCounts[opt.key] ? (
                            <span className="ml-1 opacity-75">({channelCounts[opt.key]})</span>
                        ) : null}
                    </button>
                ))}
                {(timelineData || callsData) && (
                    <span className="ml-auto text-xs text-neutral-400">
                        {t('totalCount', { count: totalElements })}
                    </span>
                )}
            </div>

            {/* ── Timeline or empty state ──────────────────────────────────── */}
            {feed.length === 0 ? (
                <ProfileEmpty
                    icon={channelFilter === 'CALL' ? Phone : ChatsCircle}
                    title={t('emptyStates.noCommunicationsTitle')}
                    hint={
                        channelFilter === 'CALL'
                            ? t('emptyStates.noCalls')
                            : channelFilter !== 'ALL'
                              ? t('emptyStates.noChannelMessages', {
                                    channel: (
                                        channelConfig[channelFilter]?.label ?? channelFilter
                                    ).toLowerCase(),
                                    allLabel: t('filters.all'),
                                })
                              : t('emptyStates.noMessagesYet')
                    }
                    action={
                        channelFilter === 'ALL' ? (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="small"
                                onClick={() => {
                                    if (selectedStudent) setSendDialog('EMAIL');
                                }}
                                className="flex items-center gap-1.5"
                            >
                                <Envelope className="size-3.5" />
                                {t('emptyStates.sendFirstMessage')}
                            </MyButton>
                        ) : undefined
                    }
                />
            ) : (
                /* Render date separators interleaved with ProfileTimeline groups.
                   We collect consecutive items between separators and pass each
                   batch to a ProfileTimeline so the vertical spine line is
                   contained within each date group. */
                <div className="flex flex-col gap-2">
                    {(() => {
                        const sections: Array<
                            | { type: 'date'; date: Date; key: string }
                            | { type: 'group'; items: ProfileTimelineItem[]; key: string }
                        > = [];
                        let currentGroup: ProfileTimelineItem[] = [];

                        for (const entry of groupedItems) {
                            if (entry.type === 'date') {
                                if (currentGroup.length > 0) {
                                    sections.push({
                                        type: 'group',
                                        items: currentGroup,
                                        key: `group-before-${entry.date.toISOString()}`,
                                    });
                                    currentGroup = [];
                                }
                                sections.push({
                                    type: 'date',
                                    date: entry.date,
                                    key: `date-${entry.date.toISOString()}`,
                                });
                            } else if (entry.entry.kind === 'call') {
                                currentGroup.push(
                                    toCallTimelineItem(entry.entry.item, t, instituteId)
                                );
                            } else {
                                currentGroup.push(
                                    toTimelineItem(
                                        entry.entry.item,
                                        t,
                                        channelConfig,
                                        resendContext
                                    )
                                );
                            }
                        }
                        if (currentGroup.length > 0) {
                            sections.push({
                                type: 'group',
                                items: currentGroup,
                                key: `group-final`,
                            });
                        }

                        return sections.map((s) =>
                            s.type === 'date' ? (
                                <DateSeparator key={s.key} date={s.date} />
                            ) : (
                                <ProfileTimeline key={s.key} items={s.items} />
                            )
                        );
                    })()}
                </div>
            )}

            {/* ── Pagination ───────────────────────────────────────────────── */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 border-t border-neutral-200 pt-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={page === 0}
                        onClick={() => setPage(Math.max(0, page - 1))}
                    >
                        {t('pagination.previous')}
                    </MyButton>
                    <span className="text-xs text-neutral-500">
                        {t('pagination.pageOf', {
                            current: page + 1,
                            total: totalPages,
                        })}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={page >= totalPages - 1}
                        onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    >
                        {t('pagination.next')}
                    </MyButton>
                </div>
            )}

            {/* ── Send dialog (existing — behavior unchanged) ───────────────── */}
            {sendDialog && (
                <IndividualSendDialog
                    open={!!sendDialog}
                    onOpenChange={(o) => {
                        if (!o) {
                            setSendDialog(null);
                            // Refresh the timeline so the just-sent message shows up.
                            void refetch();
                        }
                    }}
                    student={selectedStudent}
                    channel={sendDialog}
                    instituteId={instituteId}
                />
            )}
        </div>
    );
};
