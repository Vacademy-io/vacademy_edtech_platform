import type { OfflinePaymentDetails } from '@/services/offline-payment-modes';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_INVOICES_BY_USER,
    GET_INVOICES_BY_INSTITUTE,
    GET_INVOICE_DOWNLOAD_URL,
    GET_INVOICES_BULK_DOWNLOAD,
    GET_INVOICE_BY_ID,
    POST_ADMIN_CREATE_INVOICE,
    POST_ADMIN_PREVIEW_INVOICE,
    POST_REJECT_INVOICE,
    DELETE_INVOICE,
    GET_USER_ACCOUNT_SUMMARY,
    GET_USER_ACCOUNT_LEDGER,
    POST_MARK_INVOICE_PAID_MANUAL,
    PUT_UPDATE_INVOICE,
    POST_INVOICES_BY_PAYMENT_LOGS,
} from '@/constants/urls';
import type { AdminDiscountRequest } from '@/services/admin-discounts';

// Field names must match the wire format exactly: the backend InvoiceLineItemDTO is
// @JsonNaming(SnakeCaseStrategy) — item_type/unit_price, NOT itemType/unitPrice.
export interface InvoiceLineItemDTO {
    id: string;
    item_type: string;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
}

export interface InvoiceDTO {
    id: string;
    invoice_number: string;
    user_id: string;
    /** Primary payment log this invoice covers, if any. Absent on unpaid/synthetic rows. */
    payment_log_id?: string | null;
    /** Every payment log this invoice covers — an installment invoice has several. */
    payment_log_ids?: string[] | null;
    institute_id: string;
    invoice_date: string;
    due_date: string;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    currency: string;
    status: string;
    pdf_file_id: string | null;
    pdf_url: string | null;
    tax_included: boolean;
    /** Admin-entered notes, if any — used to prefill "Duplicate". */
    notes?: string | null;
    /**
     * True while this is still an unpaid PROFORMA: it carries a number from the institute's
     * separate proforma series and only becomes a numbered invoice when it is paid.
     * Only set when the institute has `proformaEnabled` in its invoice settings.
     */
    proforma?: boolean | null;
    created_at: string;
    updated_at: string;
    line_items: InvoiceLineItemDTO[];
    /** Which flow created this invoice: ADMIN_MANUAL, USER_PLAN, STUDENT_FEE_PAYMENT, etc. */
    source?: string | null;
    source_id?: string | null;
    /** Gateway payment link — present on ADMIN_MANUAL and USER_PLAN invoices when a payment option is configured. */
    payment_link?: string | null;
    /** Admin who gave the discount on this invoice (admin invoice, or the discounted enrollment it bills). */
    discount_granted_by_user_id?: string | null;
    /** That admin's internal reason for the discount. Admin views only. */
    discount_reason?: string | null;
    /** Installment rows still owing money: what has been paid on it so far. */
    amount_paid?: number | null;
    /** Installment rows still owing money: the latest receipt for what was paid (view/download open it). */
    receipt_number?: string | null;
}

export interface UserAccountLedgerEntryDTO {
    id: string;
    // DEBIT_ACCRUAL | CREDIT_PAYMENT | CREDIT_WAIVER | CREDIT_ADJUSTMENT | DEBIT_PENALTY
    // | DEBIT_REVERSAL (obligation voided before any money moved — cancels the accrual out
    //   of total_accrued rather than counting as money received)
    // | CREDIT_REVERSAL (a payment recorded by mistake was voided — takes it back out of
    //   total_paid)
    event_type: string;
    amount: number;
    currency: string;
    due_date: string | null;
    source_type: string | null;
    source_id: string | null;
    invoice_id: string | null;
    reference_id: string | null;
    remarks: string | null;
    created_at: string;
    /** Discounted accruals only: list price before the coupon (amount is the net). */
    gross_amount?: number | null;
    /** Discounted accruals only: the coupon/discount applied. */
    discount_amount?: number | null;
    /** CREDIT_PAYMENT rows: status of the payment behind the credit (VOIDED once voided). */
    payment_status?: string | null;
    /** CREDIT_PAYMENT rows: how it was paid — MANUAL / OFFLINE ones can be voided. */
    payment_vendor?: string | null;
}

export interface LedgerPageResponse {
    content: UserAccountLedgerEntryDTO[];
    totalElements: number;
    totalPages: number;
    number: number;
    last: boolean;
}

export interface UserAccountSummaryDTO {
    user_id: string;
    institute_id: string;
    total_accrued: number;
    total_paid: number;
    balance: number;
    overdue: number;
    currency: string;
}

export interface InvoicePaginatedResponse {
    content: InvoiceDTO[];
    totalElements: number;
    totalPages: number;
    size: number;
    number: number;
    first: boolean;
    last: boolean;
}

export async function fetchUserInvoices(
    userId: string,
    /**
     * Scope to one institute. Worth passing wherever the caller knows it: the same payment
     * can legitimately be invoiced by two institutes, and unscoped this returns both.
     */
    instituteId?: string
): Promise<InvoiceDTO[]> {
    const response = await authenticatedAxiosInstance.get<InvoiceDTO[]>(
        GET_INVOICES_BY_USER(userId),
        instituteId ? { params: { instituteId } } : undefined
    );
    return response.data;
}

export async function fetchUserAccountSummary(
    userId: string,
    instituteId: string
): Promise<UserAccountSummaryDTO> {
    const response = await authenticatedAxiosInstance.get<UserAccountSummaryDTO>(
        GET_USER_ACCOUNT_SUMMARY(userId),
        { params: { instituteId } }
    );
    return response.data;
}

export async function fetchUserAccountLedger(
    userId: string,
    instituteId: string,
    page = 0,
    size = 20
): Promise<LedgerPageResponse> {
    const response = await authenticatedAxiosInstance.get<LedgerPageResponse>(
        GET_USER_ACCOUNT_LEDGER(userId),
        { params: { instituteId, page, size } }
    );
    return response.data;
}

export async function markInvoicePaidManual(
    invoiceId: string,
    body: { transaction_id?: string; notes?: string; payment_details?: OfflinePaymentDetails | null }
): Promise<InvoiceDTO> {
    const response = await authenticatedAxiosInstance.post<InvoiceDTO>(
        POST_MARK_INVOICE_PAID_MANUAL(invoiceId),
        body
    );
    return response.data;
}

export async function fetchInstituteInvoices(
    instituteId: string,
    page = 0,
    size = 20,
    filters?: {
        userId?: string;
        status?: string;
        startDate?: string;
        endDate?: string;
    }
): Promise<InvoicePaginatedResponse> {
    const params: Record<string, string> = {
        page: String(page),
        size: String(size),
    };
    if (filters?.userId) params['userId'] = filters.userId;
    if (filters?.status) params['status'] = filters.status;
    if (filters?.startDate) params['startDate'] = filters.startDate;
    if (filters?.endDate) params['endDate'] = filters.endDate;

    const response = await authenticatedAxiosInstance.get<InvoicePaginatedResponse>(
        GET_INVOICES_BY_INSTITUTE(instituteId),
        { params }
    );
    return response.data;
}

/**
 * The invoice issued for a single payment log, as returned by the bulk lookup below.
 * Compact on purpose — no line items, and no `pdf_url` (the server would have to presign
 * one file per row). Fetch the invoice by id when the PDF is actually needed.
 */
export interface PaymentLogInvoiceDTO {
    /** The payment log this invoice covers — the key to join back on. */
    payment_log_id: string;
    invoice_id: string;
    invoice_number: string;
    invoice_date: string | null;
    status: string;
    total_amount: number | null;
    currency: string | null;
    /** Whether a PDF is already stored. False just means the first preview regenerates it. */
    has_pdf: boolean;
}

/**
 * Which invoice covers each of the given payment logs.
 *
 * Resolved server-side from the invoice ↔ payment-log mapping the invoice itself was built
 * from, so the number is the one actually issued — not one guessed from amounts or dates.
 * Payment logs with no invoice are omitted from the response rather than returned as nulls.
 */
export async function fetchInvoicesForPaymentLogs(
    instituteId: string,
    paymentLogIds: string[]
): Promise<PaymentLogInvoiceDTO[]> {
    if (!instituteId || paymentLogIds.length === 0) return [];
    const response = await authenticatedAxiosInstance.post<PaymentLogInvoiceDTO[]>(
        POST_INVOICES_BY_PAYMENT_LOGS,
        { payment_log_ids: paymentLogIds },
        { params: { instituteId } }
    );
    return response.data ?? [];
}

/**
 * Download every invoice issued in the window as one ZIP (PDFs + an `invoices.csv` manifest).
 * One invoice per payment — a payment that was invoiced twice keeps its first-issued invoice and
 * the manifest lists the extra. Dates are UTC instants; empty = unbounded.
 *
 * The server refuses an empty period (404) or one with too many invoices (400) with a message;
 * with a blob response that message arrives as a Blob, so it is unpacked into the thrown Error.
 */
export async function downloadInvoicesZip(
    instituteId: string,
    range: { startDate?: string; endDate?: string },
    fileName: string
): Promise<void> {
    const params: Record<string, string> = {};
    if (range.startDate) params['startDate'] = range.startDate;
    if (range.endDate) params['endDate'] = range.endDate;
    let data: Blob;
    try {
        const response = await authenticatedAxiosInstance.get<Blob>(
            GET_INVOICES_BULK_DOWNLOAD(instituteId),
            // A large period takes a while to assemble; don't let a default timeout cut it off.
            { params, responseType: 'blob', timeout: 0 }
        );
        data = response.data;
    } catch (error) {
        const body = (error as { response?: { data?: unknown } })?.response?.data;
        if (body instanceof Blob) {
            try {
                const parsed = JSON.parse(await body.text());
                const message = parsed?.ex ?? parsed?.message ?? parsed?.error;
                if (typeof message === 'string' && message) throw new Error(message);
            } catch (parseError) {
                if (parseError instanceof Error && !(parseError instanceof SyntaxError)) {
                    throw parseError;
                }
            }
        }
        throw error;
    }
    const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function getInvoiceDownloadUrl(invoiceId: string): string {
    return GET_INVOICE_DOWNLOAD_URL(invoiceId);
}

/** Full invoice detail (line items + notes) — used to prefill "Duplicate". */
export async function fetchInvoiceById(invoiceId: string): Promise<InvoiceDTO> {
    const response = await authenticatedAxiosInstance.get<InvoiceDTO>(GET_INVOICE_BY_ID(invoiceId));
    return response.data;
}

/**
 * Body for editing an existing unpaid invoice. Mirrors the create request minus
 * user/institute, which are fixed for the life of an invoice.
 */
export interface AdminUpdateInvoiceRequest {
    line_items: AdminInvoiceLineItemRequest[];
    currency: string;
    due_date: string;
    invoice_date?: string;
    notes?: string;
    overrides?: Record<string, string>;
    tax_enabled?: boolean;
    tax_rate_percent?: number;
}

/**
 * Edits an unpaid (PENDING_PAYMENT) invoice in place, keeping the same invoice number and
 * regenerating the PDF. The server rejects the call for PAID/REJECTED invoices.
 */
export async function updateAdminInvoice(
    invoiceId: string,
    instituteId: string,
    request: AdminUpdateInvoiceRequest
): Promise<InvoiceDTO> {
    const response = await authenticatedAxiosInstance.put<InvoiceDTO>(
        PUT_UPDATE_INVOICE(invoiceId),
        request,
        { params: { instituteId } }
    );
    return response.data;
}

/**
 * Voids a PENDING_PAYMENT admin invoice created in error. Terminal — the payment link
 * stops working and it can never be marked paid afterward. `reason` is optional.
 */
export async function rejectInvoice(
    invoiceId: string,
    instituteId: string,
    reason?: string
): Promise<InvoiceDTO> {
    const response = await authenticatedAxiosInstance.post<InvoiceDTO>(
        POST_REJECT_INVOICE(invoiceId),
        reason ? { reason } : {},
        { params: { instituteId } }
    );
    return response.data;
}

/**
 * PERMANENTLY deletes an invoice. Only offered when the viewer's role has Display Settings →
 * Learner Management → "delete payments & invoices" on (off by default); the server checks the
 * same setting and refuses otherwise, and refuses an invoice with a live payment against it.
 */
export async function deleteInvoicePermanently(
    invoiceId: string,
    instituteId: string
): Promise<{ invoice_id: string; invoice_number: string }> {
    const response = await authenticatedAxiosInstance.delete<{ invoice_id: string; invoice_number: string }>(
        DELETE_INVOICE(invoiceId),
        { params: { instituteId } }
    );
    return response.data;
}

// ─── Admin Invoice Creation ───────────────────────────────────────────────────

export interface AdminInvoiceLineItemRequest {
    description: string;
    quantity: number;
    unit_price: number;
    item_type?: string;
}

export interface AdminCreateInvoiceRequest {
    user_ids: string[];
    institute_id: string;
    line_items: AdminInvoiceLineItemRequest[];
    currency: string;
    due_date: string;
    /** Admin-chosen invoice date (ISO). Defaults to now on the server when omitted. */
    invoice_date?: string;
    notes?: string;
    /** Per-invoice edits to dynamic template values, keyed by placeholder name. */
    overrides?: Record<string, string>;
    /**
     * PREVIEW-ONLY: id of the invoice being edited, so its own invoice_number isn't
     * mistaken for a collision and replaced with a freshly-generated one.
     */
    editing_invoice_id?: string;
    /** Turn tax off entirely for this invoice, regardless of the institute's default. */
    tax_enabled?: boolean;
    /** Override the tax rate (percentage, e.g. 18) for this invoice only. Ignored when tax_enabled is false. */
    tax_rate_percent?: number;
    /**
     * Admin-granted discount, applied as a DISCOUNT line on the pre-tax subtotal. COUPON mode
     * accepts institute-wide coupons only. apply_for_cycles is not used here.
     */
    admin_discount?: AdminDiscountRequest;
}

/** One editable/derived dynamic value discovered in the institute's invoice template. */
export interface InvoicePlaceholderValue {
    key: string;
    label: string;
    /** Grouping heading: INVOICE / BILL TO / INSTITUTE / TAX / AMOUNTS / NOTES. */
    group: string;
    /** Current value: override when set, else the auto-derived value. */
    value: string;
    editable: boolean;
    /** Preferred input control: 'text' | 'textarea' | 'date'. */
    input_type: string;
}

export interface AdminInvoicePreviewResponse {
    /** Rendered invoice HTML (all placeholders substituted) for the live preview pane. */
    html: string;
    /** Editable/derived placeholder values to seed the review panel. */
    resolved_values: InvoicePlaceholderValue[];
}

export interface AdminInvoicePaymentLinkResponse {
    invoice_id: string;
    invoice_number: string;
    user_id: string;
    total_amount: number;
    currency: string;
    status: string;
    due_date: string;
    payment_link: string;
    pdf_url: string | null;
}

export async function createAdminInvoice(
    request: AdminCreateInvoiceRequest
): Promise<AdminInvoicePaymentLinkResponse[]> {
    const response = await authenticatedAxiosInstance.post<AdminInvoicePaymentLinkResponse[]>(
        POST_ADMIN_CREATE_INVOICE,
        request
    );
    return response.data;
}

/**
 * Non-persisting preview: renders the institute's invoice template with the given line
 * items + overrides and returns the rendered HTML plus the resolved dynamic values. Used
 * by the "Review & Preview" step before the invoice is actually created.
 */
export async function previewAdminInvoice(
    request: AdminCreateInvoiceRequest
): Promise<AdminInvoicePreviewResponse> {
    const response = await authenticatedAxiosInstance.post<AdminInvoicePreviewResponse>(
        POST_ADMIN_PREVIEW_INVOICE,
        request
    );
    return response.data;
}
