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
    /** Template name, or an email subject. */
    template?: string;
    /** What happened to the message. Only meaningful with a day, so it is dropped without one. */
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
 * Turns whatever is in the URL into a valid InboxSearch: unknown values are dropped, the
 * `waited` tab and `kind=NO_OP` mean the same thing, and an outcome without a day is dropped
 * (the server needs the day to look the outcomes up).
 */
export function normalizeInboxSearch(raw: Record<string, unknown>): InboxSearch {
    const date = isIsoDay(raw.date) ? raw.date : undefined;
    const kind = oneOf(INBOX_KIND_KEYS, raw.kind);
    const plainKind = kind === 'NO_OP' ? undefined : kind;
    const waited = raw.filter === 'waited' || kind === 'NO_OP';
    const filter = waited ? 'waited' : oneOf(INBOX_FILTER_KEYS, raw.filter);
    const template = text(raw.template)?.slice(0, MAX_TEMPLATE_LENGTH);
    return {
        filter,
        engine: text(raw.engine),
        channel: oneOf(CHANNEL_ORDER, raw.channel),
        // Waited rows are NO_OP by definition, so a kind next to it adds nothing.
        kind: waited ? undefined : plainKind,
        date,
        template,
        outcome: date ? oneOf(INBOX_OUTCOME_KEYS, raw.outcome) : undefined,
    };
}

/** True when anything other than the tab narrows the list (what "Clear filters" resets). */
export function hasInboxFilters(s: InboxSearch): boolean {
    return !!(s.engine || s.channel || s.kind || s.date || s.template || s.outcome);
}
