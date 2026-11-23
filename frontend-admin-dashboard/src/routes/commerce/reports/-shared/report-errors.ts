import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { VALIDATION_REASONS } from './report-keys';

/**
 * Report error reading (WP-50 contract §6.3). The server answers
 * `CODE: sentence`; each code maps to `reports.errors.<CODE>` in Hindi and
 * English. Any 403 without a known code reads as "no access at this
 * location" (`reports.errors.noAccess`), a missing answer as the network
 * sentence. `GSTIN_REQUIRED` lists the GSTINs of the range; they are read out
 * of the sentence so the page can offer them in its GSTIN picker.
 *
 * `VALIDATION` (R5) names the filter the server refused; the screen words the
 * known ones itself (`reports.errors.validation.<reason>`) rather than showing
 * the server's English on a Hindi screen.
 *
 * 429 (R6): `REPORTS_BUSY` = too many report screens are being read on this
 * server; the page tries again on its own after `Retry-After`. `REPORT_BUSY`
 * = another download is running.
 */
export const REPORT_ERROR_CODES = [
    'VALIDATION',
    'GSTIN_REQUIRED',
    'EXPORT_TOO_LARGE',
    'FEATURE_DISABLED',
    'ROLE_NOT_ALLOWED',
    'LOCATION_NOT_ALLOWED',
    'REPORT_NOT_FOUND',
    'REPORT_BUSY',
    'REPORTS_BUSY',
    'REPORT_TIMEOUT',
] as const;
export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[number];

/** Keys every other error falls back to; listed for the locales test. */
export const REPORT_ERROR_FALLBACKS = ['noAccess', 'network', 'generic'] as const;

const KNOWN = new Set<string>(REPORT_ERROR_CODES);

/** Errors a second try cannot mend: no Retry button (N5). */
const FINAL = new Set<string>([
    'VALIDATION',
    'GSTIN_REQUIRED',
    'EXPORT_TOO_LARGE',
    'FEATURE_DISABLED',
    'REPORT_NOT_FOUND',
]);

/** A GSTIN: 2-digit state, PAN, entity number, Z, check character. */
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;

export type ValidationReason = (typeof VALIDATION_REASONS)[number];

/** The server's `VALIDATION` sentence → the filter it names (first match wins). */
const VALIDATION_PATTERNS: readonly [RegExp, ValidationReason][] = [
    [/b2cl/i, 'b2clLimit'],
    [/\bsize\b/i, 'size'],
    [/cursor|page link/i, 'cursor'],
    [/years?\b.*(back|ago|old)|too (old|far back)|before \d{4}-\d{2}-\d{2}/i, 'tooOld'],
    [/after today|in the future|future/i, 'future'],
    [/(at most|more than) \d+ days|range is at most|too long/i, 'tooLong'],
    [/from.*(before|after|on or before).*to|from must|"from"/i, 'order'],
    [/month/i, 'month'],
    [/status/i, 'status'],
    [/gstin/i, 'gstin'],
    [/group/i, 'groupBy'],
    [/channel/i, 'channel'],
];

export function validationReason(sentence: string): ValidationReason | null {
    const found = VALIDATION_PATTERNS.find(([pattern]) => pattern.test(sentence));
    return found ? found[1] : null;
}

export interface ReportError {
    status: number | null;
    code: string | null;
    /** The i18n key of the sentence to show. */
    key: string;
    /** The server's sentence without its code. */
    message: string;
    /**
     * Show the server's sentence under ours: only for an unknown code or a
     * `VALIDATION` the screen cannot word itself, and only on an English screen (N7).
     */
    showServerSentence: boolean;
    /** GSTINs named by `GSTIN_REQUIRED`. */
    gstins: string[];
    /** 403 of any kind: the page shows the "no access here" card, not Retry. */
    noAccess: boolean;
    /** A second try may help (not a refusal of the filters, the plan or the size). */
    retryable: boolean;
    /** 429 `REPORTS_BUSY` (or a bare 429 on a screen read): the page tries again on its own. */
    busy: boolean;
}

export function readReportError(error: unknown): ReportError {
    const base = readOrderError(error);
    const code = base.code;
    const known = !!code && KNOWN.has(code);
    const accessCode = code === 'ROLE_NOT_ALLOWED' || code === 'LOCATION_NOT_ALLOWED' || code === 'ACCESS_DENIED';
    const noAccess = accessCode || (base.status === 403 && code !== 'FEATURE_DISABLED');
    const reason = code === 'VALIDATION' ? validationReason(base.message) : null;
    let key: string;
    if (reason) key = `reports.errors.validation.${reason}`;
    else if (known && !accessCode) key = `reports.errors.${code}`;
    else if (noAccess) key = 'reports.errors.noAccess';
    else if (base.status === null && !base.message) key = 'reports.errors.network';
    else if (base.status === 429) key = 'reports.errors.REPORTS_BUSY';
    else key = 'reports.errors.generic';
    return {
        status: base.status,
        code,
        key,
        message: base.message,
        showServerSentence: !!base.message && !noAccess && !reason && (!known || code === 'VALIDATION'),
        gstins: code === 'GSTIN_REQUIRED' ? Array.from(new Set(base.message.match(GSTIN) ?? [])) : [],
        noAccess,
        retryable: !noAccess && !(code && FINAL.has(code)),
        busy: code === 'REPORTS_BUSY' || (base.status === 429 && code !== 'REPORT_BUSY'),
    };
}

/** How long to wait before trying a busy report again: the server's `Retry-After` (seconds), else 3 s; at most 30 s. */
export const BUSY_DEFAULT_WAIT_MS = 3000;
const BUSY_MAX_WAIT_MS = 30000;

export function retryAfterMs(error: unknown): number {
    const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers ?? {};
    const raw = headers['retry-after'] ?? headers['Retry-After'];
    const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(seconds) || seconds < 0) return BUSY_DEFAULT_WAIT_MS;
    return Math.min(seconds * 1000, BUSY_MAX_WAIT_MS);
}

/** Tries a busy screen read makes on its own before it shows the "busy" sentence and Retry. */
export const BUSY_AUTO_RETRIES = 2;
