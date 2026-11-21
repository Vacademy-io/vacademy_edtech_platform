/**
 * Pure helpers for the Email Inbox thread. They exist because the backend rows that feed the
 * inbox were written by several unrelated senders (campaigns, inbox replies, OTPs, automations,
 * AWS bounce daemons) and the raw fields leak that history: `source` can be a service name OR the
 * UUID of the email being replied to, and an inbound body carries the whole quoted chain.
 *
 * Everything here is defensive against an older backend that has not deployed the newer
 * `origin` / `system` fields yet — each function derives the same verdict from the raw fields.
 */

export type EmailOutgoingOrigin = 'CAMPAIGN' | 'INBOX_REPLY' | 'OTP' | 'AUTOMATION' | 'EMAIL';
export type EmailIncomingOrigin = 'REPLY' | 'INCOMING' | 'BOUNCE';
export type EmailOrigin = EmailOutgoingOrigin | EmailIncomingOrigin;

/** The subset of an inbox message the origin resolver needs — kept structural so tests stay light. */
export interface EmailOriginInput {
    direction: 'OUTGOING' | 'INCOMING';
    origin?: string;
    system?: boolean;
    source?: string;
    subject?: string;
    counterpartyEmail?: string;
}

export interface QuotedReplySplit {
    /** The part the person actually typed. */
    main: string;
    /** The quoted chain below it, or null when the body has no recognisable quote. */
    quoted: string | null;
    /** Number of lines in `quoted` — shown on the "Show quoted text" toggle. */
    quotedLineCount: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mail-system local parts: bounce daemons and AWS's own notifier — never a person. */
const SYSTEM_LOCAL_PART_RE = /^(mailer-daemon|postmaster|no-reply-aws|bounce|bounces)$/i;

/** Subject prefixes that mail systems use for delivery failures and setup notices. */
const SYSTEM_SUBJECT_RE =
    /^\s*(delivery status notification|undeliverable|undelivered mail|mail delivery failed|amazon ses setup notification)/i;

/**
 * "On Mon, Sep 14, 2026 at 2:14 PM Shreyash Jain <...> wrote:" on ONE line — and the same header
 * from the French / German / Spanish / Italian / Dutch Gmail and Apple Mail locales (German puts
 * the verb before the name: "Am Mo., 14. Sept. 2026 um 14:14 Uhr schrieb A <a@x.com>:").
 */
const ON_WROTE_LINE_RE =
    /^(On|Le|Am|El|Il|Op) .+\W(wrote|a écrit|schrieb|escribió|ha scritto|schreef)(?!\w).*:\s*$/;
/** The first half of the same header when the mail client wrapped it. */
const ON_LINE_START_RE = /^(On|Le|Am|El|Il|Op) .+/;
/** The half that carries the verb and the closing colon (`\b` is ASCII-only, hence `\W`). */
const WROTE_LINE_END_RE =
    /(?:^|\W)(wrote|a écrit|schrieb|escribió|ha scritto|schreef)(?!\w).*:\s*$/i;
const QUOTE_MARKER_RE = /^>/;
const BLANK_LINE_RE = /^\s*$/;
const ORIGINAL_MESSAGE_RE = /^-{2,}\s*Original Message\s*-{2,}\s*$/i;
const UNDERSCORE_RULE_RE = /^_{20,}\s*$/;
const OUTLOOK_FROM_RE = /^From:\s*\S/i;
const OUTLOOK_SENT_RE = /^(Sent|Date):\s*\S/i;

export function looksLikeUuid(s?: string): boolean {
    return !!s && UUID_RE.test(s.trim());
}

/**
 * True when the counterparty is the mail system itself (a bounce daemon, postmaster, AWS's
 * notifier) or the subject is a delivery-failure notice. Same rule as the backend.
 */
export function isSystemSender(email?: string, subject?: string): boolean {
    if (email) {
        const at = email.indexOf('@');
        const local = (at >= 0 ? email.slice(0, at) : email).trim();
        if (SYSTEM_LOCAL_PART_RE.test(local)) return true;
    }
    return !!subject && SYSTEM_SUBJECT_RE.test(subject);
}

/**
 * A ">" line opens the quoted chain only when it sits where a mail client would put one: after a
 * blank line or an attribution line ("… wrote:"), or when everything below it is quoted too. A
 * ">" the person typed mid-paragraph ("Numbers:\n> 100 students\nplease call me") stays in `main`.
 */
function quoteMarkerOpensChain(lines: string[], i: number): boolean {
    if (i === 0) return true;
    const prev = lines[i - 1] ?? '';
    if (BLANK_LINE_RE.test(prev) || WROTE_LINE_END_RE.test(prev)) return true;
    for (let j = i + 1; j < lines.length; j++) {
        const rest = lines[j] ?? '';
        if (!BLANK_LINE_RE.test(rest) && !QUOTE_MARKER_RE.test(rest)) return false;
    }
    return true;
}

/**
 * Index of the first line where the quoted chain starts, or -1 when there is none.
 * Checks, in document order, whichever marker appears FIRST:
 *  - "On … wrote:" (one line, or "On …" wrapped so that "wrote:" lands within the next 2 lines)
 *  - a line starting with ">" (see quoteMarkerOpensChain for when it counts)
 *  - "-----Original Message-----"
 *  - a rule of 20+ underscores
 *  - an Outlook "From: …" line followed by "Sent: …" / "Date: …" within the next 3 lines
 */
function findQuoteStart(lines: string[]): number {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (ON_WROTE_LINE_RE.test(line)) return i;
        if (ON_LINE_START_RE.test(line)) {
            for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
                if (WROTE_LINE_END_RE.test(lines[j] ?? '')) return i;
            }
        }
        if (QUOTE_MARKER_RE.test(line) && quoteMarkerOpensChain(lines, i)) return i;
        if (ORIGINAL_MESSAGE_RE.test(line)) return i;
        if (UNDERSCORE_RULE_RE.test(line)) return i;
        if (OUTLOOK_FROM_RE.test(line)) {
            for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
                if (OUTLOOK_SENT_RE.test(lines[j] ?? '')) return i;
            }
        }
    }
    return -1;
}

/**
 * Separate what the sender typed from the quoted chain their mail client appended below it.
 * When nothing precedes the quote (the person only forwarded/quoted), the whole text stays as
 * `main` so the bubble is never empty.
 */
export function splitQuotedReply(text: string): QuotedReplySplit {
    const whole = text ?? '';
    const lines = whole.split(/\r?\n/);
    const start = findQuoteStart(lines);
    if (start < 0) {
        return { main: whole, quoted: null, quotedLineCount: 0 };
    }

    const mainLines = lines.slice(0, start);
    while (mainLines.length > 0 && (mainLines[mainLines.length - 1] ?? '').trim() === '') {
        mainLines.pop();
    }
    if (mainLines.length === 0) {
        return { main: whole, quoted: null, quotedLineCount: 0 };
    }

    const quotedLines = lines.slice(start);
    while (quotedLines.length > 0 && (quotedLines[quotedLines.length - 1] ?? '').trim() === '') {
        quotedLines.pop();
    }
    const quoted = quotedLines.join('\n');
    return { main: mainLines.join('\n'), quoted, quotedLineCount: quotedLines.length };
}

/**
 * The producer tag an older backend still sends on outgoing rows, mapped the way the new
 * backend maps it. Only "merged with an announcement twin" is unknowable on this side.
 */
function outgoingOriginFromSource(source?: string): EmailOutgoingOrigin {
    const tag = (source ?? '').trim();
    if (!tag) return 'EMAIL';
    const lower = tag.toLowerCase();
    if (lower === 'announcement-service') return 'CAMPAIGN';
    if (lower === 'email_inbox') return 'INBOX_REPLY';
    if (lower === 'otp_service') return 'OTP';
    if (lower === 'engagement_engine' || lower.startsWith('event:')) return 'AUTOMATION';
    return 'EMAIL';
}

/**
 * The backend's `origin` when it sent one; otherwise the same verdict derived from the raw
 * fields an older backend exposes (a UUID in `source` on an inbound row is the parent
 * outbound log id, i.e. a reply; a service name on an outbound row says who sent it).
 */
export function resolveOrigin(msg: EmailOriginInput): EmailOrigin {
    if (msg.origin) return msg.origin as EmailOrigin;
    if (msg.direction === 'OUTGOING') return outgoingOriginFromSource(msg.source);
    if (msg.system || isSystemSender(msg.counterpartyEmail, msg.subject)) return 'BOUNCE';
    return looksLikeUuid(msg.source) ? 'REPLY' : 'INCOMING';
}

/** True for bounces and other mail-system notices, whichever side of the contract produced them. */
export function isSystemMessage(msg: EmailOriginInput): boolean {
    return !!msg.system || resolveOrigin(msg) === 'BOUNCE';
}

const EMAIL_ADDRESS_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** RFC 3464 DSN fields: "Final-Recipient: rfc822; x@y" / "Original-Recipient: rfc822;x@y". */
const DSN_RECIPIENT_RE = /^(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*(\S+@\S+)/gim;
/** SES: "…to deliver the mail to the following recipients:" then one address per line. */
const FOLLOWING_RECIPIENTS_RE = /following recipients?:\s*\n((?:[^\n]*@[^\n]*\n?)+)/i;
/** Gmail: "Your message wasn't delivered to x@y because…"; Outlook: "Your message to x@y couldn't be delivered." */
const PROSE_RECIPIENT_RE =
    /(?:wasn't delivered to|was not delivered to|couldn't be delivered to|could not be delivered to|your message to)\s+<?([^\s<>,]+@[^\s<>,]+)>?/i;

function cleanAddress(raw: string): string {
    return raw.replace(/^<|[>.,;:]+$/g, '').trim();
}

/**
 * The address(es) a bounce notice says could not be reached, so the card can say WHO instead of
 * only "Delivery failed". Reads the DSN fields first, then the SES / Gmail / Outlook prose.
 * Empty when the body carries nothing recognisable.
 */
export function extractBouncedRecipients(body?: string): string[] {
    const text = body ?? '';
    if (!text.trim()) return [];
    const found: string[] = [];
    const push = (raw: string) => {
        const address = cleanAddress(raw).toLowerCase();
        if (address && !found.includes(address)) found.push(address);
    };

    for (const m of text.matchAll(DSN_RECIPIENT_RE)) {
        if (m[1]) push(m[1]);
    }
    if (found.length) return found;

    const block = text.match(FOLLOWING_RECIPIENTS_RE)?.[1];
    if (block) {
        for (const m of block.matchAll(EMAIL_ADDRESS_RE)) push(m[0]);
    }
    if (found.length) return found;

    const prose = text.match(PROSE_RECIPIENT_RE)?.[1];
    if (prose) push(prose);
    return found;
}
