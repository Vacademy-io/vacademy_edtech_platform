import {
    CHANNEL_ORDER,
    INBOX_FILTER_KEYS,
    INBOX_KIND_KEYS,
    INBOX_OUTCOME_KEYS,
    type InboxFilterKey,
    type InboxKindKey,
    type InboxOutcomeKey,
} from '../../-constants';
import type { ChannelKey } from '../../-types';

/**
 * The inbox's whole state lives in the URL, so a link from the daily report opens exactly the
 * items behind a number. Every field is optional; absent means "no filter" (and `filter` absent
 * means the Needs action tab).
 */
export interface InboxSearch {
    filter?: InboxFilterKey;
    /** Engine id. */
    engine?: string;
    channel?: ChannelKey;
    kind?: Exclude<InboxKindKey, 'NO_OP'>;
    /** yyyy-MM-dd, a day in the institute time zone. */
    date?: string;
    /**
     * A period, yyyy-MM-dd to yyyy-MM-dd inclusive, in the institute time zone. Both or neither:
     * it replaces `date` when both are in the link, as it does on the server.
     */
    from?: string;
    to?: string;
    /** Template name, or an email subject. */
    template?: string;
    /** What happened to the message. Only meaningful with a day or period, so dropped without one. */
    outcome?: InboxOutcomeKey;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEMPLATE_LENGTH = 300;

/** A real calendar day: "2026-02-31" has the right shape but the server would refuse it. */
export function isIsoDay(value: unknown): value is string {
    if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The router parses `?template=2024` into a number; a name is always text. */
function text(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | undefined {
    return typeof value === 'string' && (list as readonly string[]).includes(value)
        ? (value as T)
        : undefined;
}

/**
 * A period needs both ends, each a real day, with `from` not after `to` (yyyy-MM-dd strings sort
 * the same as the days they name). Anything else is no period.
 */
function readPeriod(from: unknown, to: unknown): { from: string; to: string } | undefined {
    return isIsoDay(from) && isIsoDay(to) && from <= to ? { from, to } : undefined;
}

/** True when the list is narrowed to a day or a period (what the outcome filter needs). */
export function hasInboxPeriod(s: Pick<InboxSearch, 'date' | 'from' | 'to'>): boolean {
    return !!(s.date || (s.from && s.to));
}

/**
 * Turns whatever is in the URL into a valid InboxSearch: unknown values are dropped, the
 * `waited` tab and `kind=NO_OP` mean the same thing, the `approvals` tab takes no kind, a period with a bad or reversed end is
 * dropped whole (and wins over `date` when valid), and an outcome without a day or period is
 * dropped (the server needs one to look the outcomes up).
 */
export function normalizeInboxSearch(raw: Record<string, unknown>): InboxSearch {
    const period = readPeriod(raw.from, raw.to);
    const date = !period && isIsoDay(raw.date) ? raw.date : undefined;
    const kind = oneOf(INBOX_KIND_KEYS, raw.kind);
    const plainKind = kind === 'NO_OP' ? undefined : kind;
    const waited = raw.filter === 'waited' || kind === 'NO_OP';
    const filter = waited ? 'waited' : oneOf(INBOX_FILTER_KEYS, raw.filter);
    // The approvals tab is CRM actions by definition, like waited is NO_OP.
    const fixedKind = waited || filter === 'approvals';
    const template = text(raw.template)?.slice(0, MAX_TEMPLATE_LENGTH);
    return {
        filter,
        engine: text(raw.engine),
        channel: oneOf(CHANNEL_ORDER, raw.channel),
        // Waited rows are NO_OP and approvals are CRM by definition, so a kind adds nothing.
        kind: fixedKind ? undefined : plainKind,
        date,
        from: period?.from,
        to: period?.to,
        template,
        outcome: date || period ? oneOf(INBOX_OUTCOME_KEYS, raw.outcome) : undefined,
    };
}

/** True when anything other than the tab narrows the list (what "Clear filters" resets). */
export function hasInboxFilters(s: InboxSearch): boolean {
    return !!(
        s.engine ||
        s.channel ||
        s.kind ||
        s.date ||
        s.from ||
        s.to ||
        s.template ||
        s.outcome
    );
}
