import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';

/**
 * Report error reading (WP-50 contract §6.3). The server answers
 * `CODE: sentence`; each code maps to `reports.errors.<CODE>` in Hindi and
 * English. Any 403 without a known code reads as "no access at this
 * location" (`reports.errors.noAccess`), a missing answer as the network
 * sentence. `GSTIN_REQUIRED` lists the GSTINs of the range; they are read out
 * of the sentence so the page can offer them in its GSTIN picker.
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
    'REPORT_TIMEOUT',
] as const;
export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[number];

/** Keys every other error falls back to; listed for the locales test. */
export const REPORT_ERROR_FALLBACKS = ['noAccess', 'network', 'generic'] as const;

const KNOWN = new Set<string>(REPORT_ERROR_CODES);

/** Codes whose server sentence names the field or the limit and is shown under ours. */
const SHOW_SENTENCE = new Set<string>(['VALIDATION']);

/** A GSTIN: 2-digit state, PAN, entity number, Z, check character. */
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;

export interface ReportError {
    status: number | null;
    code: string | null;
    /** The i18n key of the sentence to show. */
    key: string;
    /** The server's sentence without its code. */
    message: string;
    showServerSentence: boolean;
    /** GSTINs named by `GSTIN_REQUIRED`. */
    gstins: string[];
    /** 403 of any kind: the page shows the "no access here" card, not Retry. */
    noAccess: boolean;
}

export function readReportError(error: unknown): ReportError {
    const base = readOrderError(error);
    const code = base.code;
    const known = !!code && KNOWN.has(code);
    const accessCode = code === 'ROLE_NOT_ALLOWED' || code === 'LOCATION_NOT_ALLOWED' || code === 'ACCESS_DENIED';
    const noAccess = accessCode || (base.status === 403 && code !== 'FEATURE_DISABLED');
    let key: string;
    if (known && !accessCode) key = `reports.errors.${code}`;
    else if (noAccess) key = 'reports.errors.noAccess';
    else if (base.status === null && !base.message) key = 'reports.errors.network';
    else if (base.status === 429) key = 'reports.errors.REPORT_BUSY';
    else key = 'reports.errors.generic';
    return {
        status: base.status,
        code,
        key,
        message: base.message,
        showServerSentence: !!base.message && (!known || SHOW_SENTENCE.has(code as string)) && !noAccess,
        gstins: code === 'GSTIN_REQUIRED' ? Array.from(new Set(base.message.match(GSTIN) ?? [])) : [],
        noAccess,
    };
}
