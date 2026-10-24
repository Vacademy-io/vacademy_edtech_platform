/**
 * Plain-language explanations for WhatsApp failures.
 *
 * The provider hands us its own vocabulary — "Re-engagement message (131047)", "Business
 * eligibility payment issue (131042)" — which tells an admin nothing about what went wrong or what
 * to do next. This maps the codes we can identify with certainty onto a sentence they can act on,
 * and leaves everything else showing the provider's exact words: a wrong explanation for a real
 * failure is worse than an unexplained one.
 *
 * This module is imported from plain (non-React) call sites, so it cannot call the
 * `useTranslation()` hook. The display strings below (`title`/`detail`, and the generic
 * fallback strings in `describeApiError`) are looked up via the i18next singleton at the
 * point of use instead. The `match` substrings in BY_TEXT and the numeric codes in BY_CODE are
 * NOT translated — they are compared against the WhatsApp provider's own (always-English) error
 * text, not shown to anyone.
 */
import i18n from '@/i18n';

const NS = 'communicationWhatsappErrors';

export interface FailureExplanation {
    /** Headline: what happened, in five words. */
    title: string;
    /** What to do about it. Absent when the code is one we cannot speak to. */
    detail?: string;
    /** Provider error code, when the message carried one. */
    code?: string;
    /**
     * True when the failure kills every send on this WhatsApp number rather than only this
     * recipient — the difference between "this person can't be reached" and "the account is down".
     */
    accountLevel?: boolean;
}

interface KnownFailure {
    /** i18n key (under `byCode.*`/`byText.*`) whose `.title`/`.detail` hold the display text. */
    key: string;
    accountLevel?: boolean;
}

/** Reads `${NS}:<key>.title` / `.detail` from the active locale. */
function resolve(known: KnownFailure): { title: string; detail: string } {
    return {
        title: i18n.t(`${NS}:${known.key}.title`),
        detail: i18n.t(`${NS}:${known.key}.detail`),
    };
}

/**
 * WhatsApp Cloud API error codes. Recipient-level entries explain a single undelivered message;
 * account-level entries mean the number itself cannot send until someone fixes it.
 *
 * The keys of this object (error codes) are the provider's own vocabulary — lookup keys, never
 * shown to anyone, and never translated. Only `resolve()` above produces display text.
 */
const BY_CODE: Record<string, KnownFailure> = {
    // --- Recipient-level: this message, this person ---
    '131047': { key: 'byCode.131047' },
    '131026': { key: 'byCode.131026' },
    '131049': { key: 'byCode.131049' },
    '130472': { key: 'byCode.130472' },
    '131021': { key: 'byCode.131021' },
    '131051': { key: 'byCode.131051' },
    '131052': { key: 'byCode.131052' },
    '131053': { key: 'byCode.131053' },

    // --- Account-level: every send on this number is affected ---
    '131042': { key: 'byCode.131042', accountLevel: true },
    '131031': { key: 'byCode.131031', accountLevel: true },
    '131045': { key: 'byCode.131045', accountLevel: true },
    '133010': { key: 'byCode.133010', accountLevel: true },
    '190': { key: 'byCode.190', accountLevel: true },
    '368': { key: 'byCode.368', accountLevel: true },

    // --- Template problems ---
    '132000': { key: 'byCode.132000' },
    '132001': { key: 'byCode.132001' },
    '132005': { key: 'byCode.132005' },
    '132007': { key: 'byCode.132007' },
    '132012': { key: 'byCode.132012' },
    '132015': { key: 'byCode.132015' },
    '132016': { key: 'byCode.132016' },

    // --- Throttling ---
    '130429': { key: 'byCode.rateLimit' },
    '131056': { key: 'byCode.131056' },
    '80007': { key: 'byCode.rateLimit' },
    '4': { key: 'byCode.rateLimit' },
};

/**
 * Failures whose provider text carries no usable code. Matched on a lowercased substring of the
 * whole message, so the phrase has to be specific enough that it cannot match anything else.
 *
 * `match` is compared against the WhatsApp/WATI provider's own error text, which always arrives
 * in English regardless of the admin's chosen language — it is a protocol sentinel, not display
 * text, and must NOT be translated.
 */
const BY_TEXT: Array<{ match: string; failure: KnownFailure }> = [
    {
        // WATI answers an exhausted wallet with prose, not a code — a three-day outage once hid
        // behind "unknown error" because of it.
        match: 'insufficient',
        failure: { key: 'byText.outOfCredits', accountLevel: true },
    },
    {
        match: 'out of credit',
        failure: { key: 'byText.outOfCredits', accountLevel: true },
    },
    {
        match: '24 hour',
        failure: { key: 'byText.sessionWindowClosed' },
    },
];

/** Pulls "131047" out of "Re-engagement message (131047)" — or out of a bare code. */
function extractCode(raw: string): string | undefined {
    const trailing = raw.match(/\((\d{1,7})\)\s*$/);
    if (trailing?.[1]) return trailing[1];
    const labelled = raw.match(/\b(?:code|error)[\s:#=]+(\d{1,7})\b/i);
    if (labelled?.[1]) return labelled[1];
    if (/^\d{1,7}$/.test(raw.trim())) return raw.trim();
    return undefined;
}

/** The provider's own words, with the code stripped off — we render that separately. */
function withoutCode(raw: string): string {
    return raw.replace(/\s*\(\d{1,7}\)\s*$/, '').trim();
}

/** A headline is one line. A provider that answers with an essay gets cut, not laid out in full. */
function truncate(text: string, max = 160): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Explain a provider failure string. Returns null for a blank input; for an unrecognised one,
 * returns the provider's text as the title with no invented detail.
 */
export function explainWhatsAppFailure(raw?: string | null): FailureExplanation | null {
    if (!raw || !raw.trim()) return null;

    const text = raw.trim();
    const code = extractCode(text);

    const known = code ? BY_CODE[code] : undefined;
    if (known) {
        const { title, detail } = resolve(known);
        return { title, detail, code, accountLevel: known.accountLevel };
    }

    const lower = text.toLowerCase();
    const matched = BY_TEXT.find((entry) => lower.includes(entry.match));
    if (matched) {
        const { title, detail } = resolve(matched.failure);
        return {
            title,
            detail,
            code,
            accountLevel: matched.failure.accountLevel,
        };
    }

    const provider = withoutCode(text);
    return { title: provider ? truncate(provider) : i18n.t(`${NS}:notDelivered`), code };
}

export interface ApiErrorInfo {
    title: string;
    detail?: string;
}

interface AxiosLikeError {
    code?: string;
    message?: string;
    isAxiosError?: boolean;
    response?: {
        status?: number;
        data?: { message?: string; error?: string; detail?: string } | string;
    };
}

/** The server's own explanation, when it sent one, whatever shape it used. */
function serverMessage(err: AxiosLikeError): string | undefined {
    const data = err.response?.data;
    if (typeof data === 'string') {
        // A proxy answering with an HTML error page is not an explanation — fall through to the
        // status-code wording rather than pasting markup into a toast.
        const trimmed = data.trim();
        return !trimmed || trimmed.startsWith('<') ? undefined : trimmed;
    }
    return data?.message || data?.error || data?.detail || undefined;
}

/**
 * Turn a failed request into something worth showing a person: the server's reason where there is
 * one (run through the WhatsApp translation first, since send failures arrive as provider text),
 * and otherwise a description of the transport failure rather than a bare "something went wrong".
 */
export function describeApiError(err: unknown, fallback: string): ApiErrorInfo {
    const error = (err ?? {}) as AxiosLikeError;

    const fromServer = serverMessage(error);
    if (fromServer) {
        const explained = explainWhatsAppFailure(fromServer);
        if (explained) return { title: explained.title, detail: explained.detail };
    }

    const status = error.response?.status;
    if (status === undefined) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return {
                title: i18n.t(`${NS}:offline.title`),
                detail: i18n.t(`${NS}:offline.detail`),
            };
        }
        if (error.code === 'ECONNABORTED') {
            return {
                title: i18n.t(`${NS}:timedOut.title`),
                detail: i18n.t(`${NS}:timedOut.detail`),
            };
        }
        // A request that never reached the network and one that threw while we were handling the
        // answer both land here, and they are not the same problem. Only the first is worth
        // sending someone to check their connection over.
        const transportFailure = error.isAxiosError || error.code !== undefined || !error.message;
        return transportFailure
            ? {
                  title: fallback,
                  detail: i18n.t(`${NS}:couldNotReachServer`),
              }
            : {
                  title: fallback,
                  detail: i18n.t(`${NS}:unexpectedError`, { message: truncate(error.message ?? '') }),
              };
    }

    if (status === 401 || status === 403) {
        return {
            title: i18n.t(`${NS}:noAccess.title`),
            detail: i18n.t(`${NS}:noAccess.detail`),
        };
    }
    if (status === 404) {
        return { title: fallback, detail: i18n.t(`${NS}:conversationGone`) };
    }
    if (status === 413) {
        return {
            title: i18n.t(`${NS}:fileTooLarge.title`),
            detail: i18n.t(`${NS}:fileTooLarge.detail`),
        };
    }
    if (status === 429) {
        return {
            title: i18n.t(`${NS}:tooManyRequests.title`),
            detail: i18n.t(`${NS}:tooManyRequests.detail`),
        };
    }
    if (status >= 500) {
        return {
            title: fallback,
            detail: i18n.t(`${NS}:serverError`, { status }),
        };
    }

    return { title: fallback, detail: i18n.t(`${NS}:requestFailed`, { status }) };
}
