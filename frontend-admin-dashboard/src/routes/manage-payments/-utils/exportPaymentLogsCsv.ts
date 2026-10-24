import Papa from 'papaparse';
import { readRecordedPaymentDetails } from '@/services/offline-payment-modes';
import { fetchPaymentLogs } from '@/services/payment-logs';
import type { PaymentLogEntry, PaymentLogsRequest } from '@/types/payment-logs';
import { resolveEntryCurrency } from '@/utils/payment-currency';

// Fetch in large pages to keep the number of round-trips small, and cap total rows so an
// accidental "All Time" export on a huge institute can't hang the browser.
const EXPORT_PAGE_SIZE = 500;
const MAX_PAGES = 20; // -> up to 10,000 rows

export interface ExportResult {
    /** Number of rows written to the CSV. */
    rowCount: number;
    /** True when the result set exceeded MAX_PAGES and the CSV is a partial export. */
    truncated: boolean;
}

/**
 * Best-effort single "Payment Type" label for a row, using the same discriminators the
 * backend filter uses. Priority order resolves the overlap between axes (a course payment
 * made via an enroll invite is labelled by its most specific type).
 */
export const derivePaymentTypeLabel = (entry: PaymentLogEntry): string => {
    const userPlan = entry.user_plan;
    if (!userPlan) {
        return 'User Invoice';
    }
    const tag = userPlan.enroll_invite?.tag;
    const optionSource = userPlan.payment_option?.source;
    const optionType = userPlan.payment_option?.type;

    if (tag === 'SUB_ORG') return 'Sub-Org Admin';
    if (tag === 'SUBORG_LEARNER') return 'Sub-Org Learner';
    if (optionType === 'CPO') return 'Custom Installment';
    if (optionSource === 'LIVE_SESSION') return 'Live Class';
    if (optionSource === 'PACKAGE_SESSION') return 'Course / Package';
    if (tag === 'DEFAULT') return 'Enroll Invite';
    return userPlan.source === 'SUB_ORG' ? 'Sub-Org' : 'Individual';
};

/**
 * `created_at` arrives as a UTC instant, so writing it verbatim put a UTC clock in the sheet while
 * the table on screen showed the admin's local time — the same payment read as 08:31 in the export
 * and 2:01 PM in the UI. Emit the local wall clock in a sortable, spreadsheet-friendly shape.
 *
 * The `date` fallback is a DATE column (UTC midnight, no time), so it is rendered date-only in UTC
 * — converting it to local would shift it to the previous day west of UTC.
 */
const toCsvTimestamp = (log: PaymentLogEntry['payment_log']): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    if (log?.created_at) {
        const d = new Date(log.created_at);
        if (!Number.isNaN(d.getTime())) {
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
                d.getHours()
            )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }
    }
    if (log?.date) {
        const d = new Date(log.date);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return '';
};

const toCsvRow = (entry: PaymentLogEntry): Record<string, string | number> => {
    const { payment_log: log, user_plan: plan, user } = entry;
    return {
        'Date & Time': toCsvTimestamp(log),
        'User Name': user?.full_name ?? '',
        Email: user?.email ?? '',
        'Mobile Number': user?.mobile_number ?? '',
        Amount: log?.payment_amount ?? '',
        // Same resolution as the table — a blank payment_log.currency falls back to the plan's.
        Currency: resolveEntryCurrency(entry),
        'Payment Status': entry.current_payment_status ?? log?.payment_status ?? '',
        'Payment Method': log?.vendor ?? '',
        // Offline payments: how it was paid, as the admin recorded it.
        'Paid Via': readRecordedPaymentDetails(log)?.label ?? '',
        'Payment Reference': log?.payment_reference ?? '',
        'Plan Status': plan?.status ?? '',
        'Payment Type': derivePaymentTypeLabel(entry),
        'Course / Membership': plan?.enroll_invite?.name ?? '',
        'Invite Code': plan?.enroll_invite?.invite_code ?? '',
        Organization: plan?.source === 'SUB_ORG' ? (plan?.sub_org_details?.name ?? '') : '',
        'Payment Plan': plan?.payment_plan_dto?.name ?? '',
        'Transaction ID': log?.transaction_id ?? '',
    };
};

/**
 * Fetch every payment log matching the given filters (across all pages) and return the
 * accumulated entries plus whether the set was truncated at MAX_PAGES.
 */
export const fetchAllPaymentLogs = async (
    requestFilters: Omit<PaymentLogsRequest, 'institute_id'>
): Promise<{ entries: PaymentLogEntry[]; truncated: boolean }> => {
    const first = await fetchPaymentLogs(0, EXPORT_PAGE_SIZE, requestFilters);
    const entries: PaymentLogEntry[] = [...(first.content ?? [])];
    const totalPages = first.totalPages ?? 1;
    const pagesToFetch = Math.min(totalPages, MAX_PAGES);

    for (let page = 1; page < pagesToFetch; page++) {
        // Sequential to stay gentle on the API; page count is small at 500/page.
        // eslint-disable-next-line no-await-in-loop
        const next = await fetchPaymentLogs(page, EXPORT_PAGE_SIZE, requestFilters);
        entries.push(...(next.content ?? []));
    }

    return { entries, truncated: totalPages > MAX_PAGES };
};

const triggerDownload = (csv: string, fileName: string): void => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/**
 * Export all payment logs matching the current filters to a CSV file and trigger a download.
 */
export const exportPaymentLogsToCsv = async (
    requestFilters: Omit<PaymentLogsRequest, 'institute_id'>,
    instituteName?: string
): Promise<ExportResult> => {
    const { entries, truncated } = await fetchAllPaymentLogs(requestFilters);

    const csv = Papa.unparse(entries.map(toCsvRow));
    const datePart = new Date().toISOString().slice(0, 10);
    const namePart = (instituteName || 'institute')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    triggerDownload(csv, `payment-logs_${namePart}_${datePart}.csv`);

    return { rowCount: entries.length, truncated };
};

/**
 * Export an already-loaded set of payment entries (e.g. the current searched + filtered view)
 * to CSV and trigger a download. Returns the number of rows written.
 */
export const exportEntriesToCsv = (
    entries: PaymentLogEntry[],
    instituteName?: string
): number => {
    const csv = Papa.unparse(entries.map(toCsvRow));
    const datePart = new Date().toISOString().slice(0, 10);
    const namePart = (instituteName || 'institute')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    triggerDownload(csv, `payment-logs_${namePart}_${datePart}.csv`);
    return entries.length;
};
