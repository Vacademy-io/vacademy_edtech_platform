import type { TaskCallOutcome, TaskOutcome } from '../../-types';

export type OutcomeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

/** The wording of each badge lives under `outcome.badge.<key>` in the inbox locale file. */
export type OutcomeKey =
    | 'sent'
    | 'delivered'
    | 'opened'
    | 'clicked'
    | 'bounced'
    | 'spam'
    | 'read'
    | 'failed'
    | 'replied'
    | 'connected'
    | 'noAnswer'
    | 'busy'
    | 'callFailed'
    | 'callQueued'
    | 'notConnected'
    | 'notDialled'
    | 'notTracked';

export interface OutcomeBadge {
    key: OutcomeKey;
    tone: OutcomeTone;
    /** Language-neutral extra shown after the label: an error code, a call length. */
    detail?: string;
}

/** 81 → "1:21", 3725 → "1:02:05". Empty when there is no usable length. */
export function formatCallDuration(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const two = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** An AI call, from the call log: connected (with its length), no answer, busy, failed... */
function callBadge(call: TaskCallOutcome | null | undefined): OutcomeBadge {
    if (!call) return { key: 'notDialled', tone: 'neutral' };
    if (call.connected) {
        return {
            key: 'connected',
            tone: 'success',
            detail: formatCallDuration(call.durationSeconds),
        };
    }
    switch (call.status) {
        case 'NO_ANSWER':
            return { key: 'noAnswer', tone: 'warning' };
        case 'BUSY':
            return { key: 'busy', tone: 'warning' };
        case 'FAILED':
            return { key: 'callFailed', tone: 'danger' };
        case 'NOT_DIALLED':
            return { key: 'notDialled', tone: 'neutral' };
        case 'QUEUED':
        case 'INITIATED':
            return { key: 'callQueued', tone: 'info' };
        default:
            return { key: 'notConnected', tone: 'warning' };
    }
}

/** An email: how far it got (clicked beats opened beats delivered), plus a bounce or a spam report. */
function emailBadges(o: TaskOutcome): OutcomeBadge[] {
    const badges: OutcomeBadge[] = [];
    if (o.bounced) {
        badges.push({ key: 'bounced', tone: 'danger', detail: o.errorCode ?? undefined });
    } else if (o.deliveryStatus === 'FAILED') {
        badges.push({ key: 'failed', tone: 'danger', detail: o.errorCode ?? undefined });
    } else if (o.clicked) {
        badges.push({ key: 'clicked', tone: 'success' });
    } else if (o.opened) {
        badges.push({ key: 'opened', tone: 'success' });
    } else if (o.delivered || o.deliveryStatus === 'DELIVERED') {
        badges.push({ key: 'delivered', tone: 'success' });
    } else if (o.tracked) {
        badges.push({ key: 'sent', tone: 'neutral' });
    } else {
        badges.push({ key: 'notTracked', tone: 'neutral' });
    }
    if (o.complained) badges.push({ key: 'spam', tone: 'danger' });
    return badges;
}

/** A WhatsApp message: failed (with the error code), read, delivered, or just sent. Never email flags. */
function whatsappBadge(o: TaskOutcome): OutcomeBadge {
    if (o.deliveryStatus === 'FAILED') {
        return { key: 'failed', tone: 'danger', detail: o.errorCode ?? undefined };
    }
    if (o.deliveryStatus === 'READ') return { key: 'read', tone: 'success' };
    if (o.delivered || o.deliveryStatus === 'DELIVERED')
        return { key: 'delivered', tone: 'success' };
    return o.tracked ? { key: 'sent', tone: 'neutral' } : { key: 'notTracked', tone: 'neutral' };
}

/**
 * The badges for one action's outcome, most important first. What counts depends on the
 * channel: an AI call is only ever a call result, never an email flag; in-app is never tracked.
 * `formatReplyTime` turns the attributed reply's timestamp into the text shown after "Replied".
 */
export function outcomeBadges(
    o: TaskOutcome,
    formatReplyTime: (iso: string) => string
): OutcomeBadge[] {
    const badges: OutcomeBadge[] = [];
    switch (o.channel) {
        case 'AI_CALL':
            badges.push(callBadge(o.call));
            break;
        case 'EMAIL':
            badges.push(...emailBadges(o));
            break;
        case 'WHATSAPP':
            badges.push(whatsappBadge(o));
            break;
        default:
            // In-app: no delivery signal exists. A reply is the only thing that can show up.
            if (!o.repliedAt) badges.push({ key: 'notTracked', tone: 'neutral' });
    }
    if (o.repliedAt) {
        badges.push({ key: 'replied', tone: 'info', detail: formatReplyTime(o.repliedAt) });
    }
    return badges;
}

/** Whether an action was actually sent or dialled, so an outcome is worth looking up for it. */
export function hasBeenDispatched(task: {
    kind: string;
    status: string;
    dispatchedAt?: string;
}): boolean {
    if (task.kind === 'NO_OP') return false;
    return (
        task.status === 'SENT' ||
        task.status === 'FAILED' ||
        task.status === 'DISPATCHING' ||
        !!task.dispatchedAt
    );
}
