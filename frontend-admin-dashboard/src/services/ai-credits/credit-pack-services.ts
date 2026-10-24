import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE = `${BASE_URL}/admin-core-service/credits/packs`;

// ─── Types (mirror Java DTOs in features/credits/dto/) ────────────────

export interface CreditPack {
    pack_id: string;
    code: string;
    name: string;
    credits: number;
    currency: 'INR' | 'USD';
    base_amount_minor: number;
    tax_amount_minor: number;
    total_amount_minor: number;
    tax_rate_bps: number;
    display_price_major: string;
    display_base_major: string;
    display_tax_major: string;
    hsn_sac_code: string;
    badge?: string | null;
    is_export: boolean;
}

export interface CreditPackPurchaseResponse {
    platform_payment_id: string;
    /** Razorpay hosted page (rzp.io/i/…) — the FE redirects here to pay. */
    payment_link_url: string;
    razorpay_order_id: string | null;
    razorpay_key_id: string;
    amount_minor: number;
    currency: 'INR' | 'USD';
    pack_code: string;
    display_price_major: string;
}

export interface CreditPackOrderStatus {
    platform_payment_id: string;
    status: 'INITIATED' | 'SUCCESS' | 'FAILED';
    payment_status: 'PAYMENT_PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
    credits_granted: number | null;
    /** Relative PDF download path (needs auth) — use downloadInvoicePdf(invoice_id) instead. */
    invoice_url: string | null;
    invoice_id: string | null;
    invoice_number: string | null;
}

export interface BillingProfile {
    legal_name: string | null;
    gstin: string | null;
    state_code: string | null;
    state_name: string | null;
    address: string | null;
    currency: 'INR' | 'USD';
}

export interface PlatformInvoiceSummary {
    invoice_id: string;
    invoice_number: string;
    platform_payment_id: string;
    issued_at: string;
    currency: 'INR' | 'USD';
    base_amount_minor: number;
    tax_amount_minor: number;
    total_amount_minor: number;
    display_total_major: string;
    credits: number;
    pack_name: string;
    payment_status: 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
    is_export: boolean;
    buyer_gstin: string | null;
}

/** GST state codes (first two digits of a GSTIN). Mirrors IndianStates.java. */
export const INDIAN_GST_STATES: { code: string; name: string }[] = [
    { code: '01', name: 'Jammu & Kashmir' },
    { code: '02', name: 'Himachal Pradesh' },
    { code: '03', name: 'Punjab' },
    { code: '04', name: 'Chandigarh' },
    { code: '05', name: 'Uttarakhand' },
    { code: '06', name: 'Haryana' },
    { code: '07', name: 'Delhi' },
    { code: '08', name: 'Rajasthan' },
    { code: '09', name: 'Uttar Pradesh' },
    { code: '10', name: 'Bihar' },
    { code: '11', name: 'Sikkim' },
    { code: '12', name: 'Arunachal Pradesh' },
    { code: '13', name: 'Nagaland' },
    { code: '14', name: 'Manipur' },
    { code: '15', name: 'Mizoram' },
    { code: '16', name: 'Tripura' },
    { code: '17', name: 'Meghalaya' },
    { code: '18', name: 'Assam' },
    { code: '19', name: 'West Bengal' },
    { code: '20', name: 'Jharkhand' },
    { code: '21', name: 'Odisha' },
    { code: '22', name: 'Chhattisgarh' },
    { code: '23', name: 'Madhya Pradesh' },
    { code: '24', name: 'Gujarat' },
    { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
    { code: '27', name: 'Maharashtra' },
    { code: '29', name: 'Karnataka' },
    { code: '30', name: 'Goa' },
    { code: '31', name: 'Lakshadweep' },
    { code: '32', name: 'Kerala' },
    { code: '33', name: 'Tamil Nadu' },
    { code: '34', name: 'Puducherry' },
    { code: '35', name: 'Andaman & Nicobar Islands' },
    { code: '36', name: 'Telangana' },
    { code: '37', name: 'Andhra Pradesh' },
    { code: '38', name: 'Ladakh' },
    { code: '97', name: 'Other Territory' },
];

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(gstin: string): boolean {
    const g = gstin.trim().toUpperCase();
    return GSTIN_REGEX.test(g) && INDIAN_GST_STATES.some((s) => s.code === g.slice(0, 2));
}

// ─── Fetchers ────────────────────────────────────────────────────────

export async function fetchCreditPacks(instituteId: string): Promise<CreditPack[]> {
    const response = await authenticatedAxiosInstance.get<CreditPack[]>(
        `${API_BASE}?instituteId=${encodeURIComponent(instituteId)}`
    );
    return response.data;
}

export interface PurchaseCreditPackInput {
    instituteId: string;
    packId: string;
    returnUrl: string;
    /** 15-char GSTIN; '' clears a previously saved one; undefined leaves it untouched. */
    buyerGstin?: string;
    /** 2-digit GST state code; derived from the GSTIN prefix server-side when omitted. */
    buyerStateCode?: string;
}

export async function purchaseCreditPack({
    instituteId,
    packId,
    returnUrl,
    buyerGstin,
    buyerStateCode,
}: PurchaseCreditPackInput): Promise<CreditPackPurchaseResponse> {
    // Snake_case body — matches the BE DTO's @JsonNaming(SnakeCaseStrategy)
    // and the codebase-wide convention used by PaymentInitiationRequestDTO etc.
    // return_url is where Razorpay sends the browser back after the hosted
    // payment (the backend appends ?topup_pp=<id> so we can resume polling).
    const response = await authenticatedAxiosInstance.post<CreditPackPurchaseResponse>(
        `${API_BASE}/purchase`,
        {
            institute_id: instituteId,
            pack_id: packId,
            return_url: returnUrl,
            buyer_gstin: buyerGstin,
            buyer_state_code: buyerStateCode,
        }
    );
    return response.data;
}

export async function fetchBillingProfile(instituteId: string): Promise<BillingProfile> {
    const response = await authenticatedAxiosInstance.get<BillingProfile>(
        `${API_BASE}/billing-profile?instituteId=${encodeURIComponent(instituteId)}`
    );
    return response.data;
}

export async function fetchPlatformInvoices(
    instituteId: string
): Promise<PlatformInvoiceSummary[]> {
    const response = await authenticatedAxiosInstance.get<PlatformInvoiceSummary[]>(
        `${API_BASE}/invoices?instituteId=${encodeURIComponent(instituteId)}`
    );
    return response.data;
}

/**
 * Download an invoice PDF. The endpoint needs the auth header, so we fetch
 * the bytes via axios and trigger a save from an object URL instead of a
 * plain <a href>.
 */
export async function downloadInvoicePdf(invoiceId: string, fileName?: string): Promise<void> {
    const response = await authenticatedAxiosInstance.get<Blob>(
        `${API_BASE}/invoices/${encodeURIComponent(invoiceId)}/pdf`,
        { responseType: 'blob' }
    );
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName ?? `${invoiceId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchOrderStatus(platformPaymentId: string): Promise<CreditPackOrderStatus> {
    const response = await authenticatedAxiosInstance.get<CreditPackOrderStatus>(
        `${API_BASE}/orders/${encodeURIComponent(platformPaymentId)}/status`
    );
    return response.data;
}

// ─── React Query hooks ───────────────────────────────────────────────

export const useCreditPacksQuery = (instituteId: string | null | undefined, enabled = true) => {
    return useQuery({
        queryKey: ['GET_CREDIT_PACKS', instituteId],
        queryFn: () => fetchCreditPacks(instituteId!),
        enabled: !!instituteId && enabled,
        staleTime: 5 * 60_000, // packs change rarely
        retry: false,
    });
};

export const usePurchaseCreditPackMutation = () => {
    return useMutation({
        mutationFn: (input: PurchaseCreditPackInput) => purchaseCreditPack(input),
    });
};

export const useBillingProfileQuery = (instituteId: string | null | undefined, enabled = true) => {
    return useQuery({
        queryKey: ['GET_CREDIT_BILLING_PROFILE', instituteId],
        queryFn: () => fetchBillingProfile(instituteId!),
        enabled: !!instituteId && enabled,
        staleTime: 60_000,
        retry: false,
    });
};

export const usePlatformInvoicesQuery = (
    instituteId: string | null | undefined,
    enabled = true
) => {
    return useQuery({
        queryKey: ['GET_CREDIT_PACK_INVOICES', instituteId],
        queryFn: () => fetchPlatformInvoices(instituteId!),
        enabled: !!instituteId && enabled,
        staleTime: 60_000,
        retry: false,
    });
};

export const useOrderStatusQuery = (
    platformPaymentId: string | null,
    pollMs: number | false,
    enabled = true
) => {
    return useQuery({
        queryKey: ['GET_CREDIT_PACK_ORDER_STATUS', platformPaymentId],
        queryFn: () => fetchOrderStatus(platformPaymentId!),
        enabled: !!platformPaymentId && enabled,
        refetchInterval: pollMs,
        retry: false,
    });
};

/**
 * Invalidate the AI credits panel queries so the balance refreshes after a
 * confirmed purchase. Call after order status flips to PAID.
 */
export const useInvalidateCreditQueriesOnPaid = () => {
    const queryClient = useQueryClient();
    return () => {
        queryClient.invalidateQueries({ queryKey: ['GET_AI_CREDITS'] });
        queryClient.invalidateQueries({ queryKey: ['GET_AI_TRANSACTIONS'] });
        queryClient.invalidateQueries({ queryKey: ['GET_AI_USAGE_FORECAST'] });
        queryClient.invalidateQueries({ queryKey: ['GET_AI_USAGE_ANALYTICS'] });
        queryClient.invalidateQueries({ queryKey: ['GET_CREDIT_PACK_INVOICES'] });
        queryClient.invalidateQueries({ queryKey: ['GET_CREDIT_BILLING_PROFILE'] });
    };
};

// ─── Razorpay Checkout loader ────────────────────────────────────────

const RZP_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let rzpLoaderPromise: Promise<void> | null = null;

/**
 * Lazily inject Razorpay's checkout.js. Idempotent — a second call returns the
 * same promise so the script tag is added at most once.
 */
export function loadRazorpayScript(): Promise<void> {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Razorpay can only load in the browser'));
    }
    // Already loaded?
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).Razorpay) return Promise.resolve();

    if (rzpLoaderPromise) return rzpLoaderPromise;

    rzpLoaderPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = RZP_SCRIPT_URL;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
            rzpLoaderPromise = null;
            reject(new Error('Failed to load Razorpay checkout.js'));
        };
        document.head.appendChild(script);
    });
    return rzpLoaderPromise;
}

export interface RazorpayOpenOptions {
    key: string;
    order_id: string;
    amount: number;
    currency: string;
    name: string;
    description?: string;
    prefill?: {
        email?: string;
        contact?: string;
        name?: string;
    };
    notes?: Record<string, string>;
    theme?: { color?: string };
    handler: (response: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
    }) => void;
    modal?: {
        ondismiss?: () => void;
    };
}

/**
 * Open Razorpay Checkout. Caller must {@link loadRazorpayScript} first.
 */
export function openRazorpayCheckout(options: RazorpayOpenOptions): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Razorpay = (window as any).Razorpay;
    if (!Razorpay) {
        throw new Error('Razorpay not loaded — call loadRazorpayScript first');
    }
    new Razorpay(options).open();
}
