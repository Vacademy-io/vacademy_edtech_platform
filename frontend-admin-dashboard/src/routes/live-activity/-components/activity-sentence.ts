import type { LiveActivityEvent } from '../-services/live-activity-service';

/**
 * Human-readable phrasing for one event.
 *
 * <p>Built from the structured `action` rather than a server-supplied description string.
 * The admin activity log learned this the hard way: it ships prose from the backend and the
 * frontend then regex-matches it to decide what to bold, so a phrase sharing a prefix with
 * another ("updated lead ..." vs "updated lead TAT settings") silently bolds the wrong half.
 * Deriving the sentence from the action here means a new event type cannot mis-render an
 * existing one.
 */
export interface ActivitySentence {
    verb: string;
    subject?: string;
    detail?: string;
}

const NAMELESS = 'Someone';

export function describeActivity(event: LiveActivityEvent): ActivitySentence {
    const who = event.subjectName || event.subjectEmail || event.subjectMobile || NAMELESS;
    const payload = event.payload ?? {};

    switch (event.action) {
        // ── Enrolment funnel ───────────────────────────────────────────────
        case 'FORM_NEXT':
            return {
                verb: 'filled the invite form',
                subject: who,
                detail: asString(payload.inviteName),
            };
        case 'REACHED_PAYMENT':
            return { verb: 'reached the payment page', subject: who };
        case 'ENROLLED':
            return { verb: 'completed enrolment', subject: who };

        // ── Leads ──────────────────────────────────────────────────────────
        case 'LEAD_SUBMITTED':
            return {
                verb: 'submitted a lead form',
                subject: who,
                detail: asString(payload.sourceType),
            };

        // ── Calls ──────────────────────────────────────────────────────────
        case 'CALL_QUEUED':
            return { verb: 'started a call', subject: who };
        case 'CALL_RINGING':
            return { verb: 'is ringing', subject: who };
        case 'CALL_CONNECTED':
            return { verb: 'connected', subject: who };
        case 'CALL_ENDED': {
            const seconds = payload.durationSeconds;
            return {
                verb: 'ended a call',
                subject: who,
                detail: typeof seconds === 'number' ? formatDuration(seconds) : undefined,
            };
        }

        // ── Payments ───────────────────────────────────────────────────────
        case 'PAYMENT_SUCCEEDED':
            return { verb: 'paid', subject: who, detail: formatMoney(payload) };
        case 'PAYMENT_FAILED':
            return { verb: 'payment failed', subject: who, detail: formatMoney(payload) };
        case 'RENEWAL_SUCCEEDED':
            return { verb: 'renewal charged', subject: who, detail: formatMoney(payload) };
        case 'RENEWAL_FAILED':
            return { verb: 'renewal failed', subject: who, detail: formatMoney(payload) };

        // ── Counsellors. Names match ActivityFeedItemDTO on the server. ─────
        case 'STATUS_CHANGED':
            return {
                verb: 'changed status',
                subject: event.counsellorName || event.counsellorUserId || NAMELESS,
                detail: asString(payload.status),
            };
        case 'LEAD_TRANSFERRED_IN':
            return {
                verb: 'received leads',
                subject: event.counsellorName || event.counsellorUserId || NAMELESS,
                detail: countLabel(payload.leadCount, 'lead'),
            };
        case 'LEAD_TRANSFERRED_OUT':
            return {
                verb: 'transferred leads away',
                subject: event.counsellorName || event.counsellorUserId || NAMELESS,
                detail: countLabel(payload.leadCount, 'lead'),
            };
        case 'NOTE_ADDED':
            return {
                verb: 'logged a call outcome',
                subject: event.counsellorName || event.counsellorUserId || NAMELESS,
                detail: asString(payload.dispositionLabel) ?? asString(payload.dispositionKey),
            };
        case 'FOLLOWUP_CREATED':
            return {
                verb: 'scheduled a follow-up',
                subject: event.counsellorName || event.counsellorUserId || NAMELESS,
            };
        case 'FOLLOWUP_CLOSED':
            return {
                verb: 'closed a follow-up',
                subject: event.counsellorName || event.counsellorUserId || NAMELESS,
            };

        default:
            // An event type this build has never heard of. Rows outlive code -- a 90-day
            // retention window spans many deploys -- so render it plainly rather than
            // dropping it or throwing.
            return { verb: event.action.toLowerCase().replace(/_/g, ' '), subject: who };
    }
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function countLabel(value: unknown, noun: string): string | undefined {
    if (typeof value !== 'number') return undefined;
    return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function formatMoney(payload: Record<string, unknown>): string | undefined {
    const amount = payload.amount;
    if (typeof amount !== 'number') return undefined;
    const currency = asString(payload.currency);
    return currency ? `${currency} ${amount}` : String(amount);
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}
