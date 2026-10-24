/**
 * Coming back from Razorpay's hosted page to the Plan & billing tab.
 *
 * The facade's callback URL carries `?plan_pp=<platform_payment_id>` (plan
 * checkout / upgrade / renewal link) or `?plan_mandate=1` (autopay set-up).
 * As a fallback, the payment id the checkout returned is also remembered in
 * sessionStorage, so a return that lost the param can still be resumed.
 * The params are scrubbed from the URL once read, so a refresh can't
 * re-trigger the confirmation.
 */
const PENDING_KEY = 'ai-plan-pending-payment';
const RAZORPAY_PARAMS = [
    'razorpay_payment_id',
    'razorpay_payment_link_id',
    'razorpay_payment_link_reference_id',
    'razorpay_payment_link_status',
    'razorpay_signature',
];

export interface PlanPaymentReturn {
    paymentId: string | null;
    mandate: boolean;
    /** Razorpay's own status on the redirect, when present ("paid", "cancelled" …). */
    linkStatus: string | null;
}

export function rememberPendingPlanPayment(platformPaymentId: string | null) {
    try {
        if (platformPaymentId) window.sessionStorage.setItem(PENDING_KEY, platformPaymentId);
        else window.sessionStorage.removeItem(PENDING_KEY);
    } catch {
        // Storage blocked (private mode): the URL param still works.
    }
}

function readPending(): string | null {
    try {
        return window.sessionStorage.getItem(PENDING_KEY);
    } catch {
        return null;
    }
}

/** Parse a search string. Pure; exported for tests. */
export function parsePlanReturn(search: string, pending: string | null): PlanPaymentReturn | null {
    const params = new URLSearchParams(search);
    const pp = params.get('plan_pp');
    const mandate = params.get('plan_mandate');
    const linkStatus = params.get('razorpay_payment_link_status');
    const fromRazorpay = RAZORPAY_PARAMS.some((k) => params.has(k));
    if (pp) return { paymentId: pp, mandate: !!mandate, linkStatus };
    if (mandate) return { paymentId: null, mandate: true, linkStatus };
    if (fromRazorpay && pending) return { paymentId: pending, mandate: false, linkStatus };
    return null;
}

/** Read once and scrub the URL. Returns null when this page load is not a return. */
export function consumePlanPaymentReturn(): PlanPaymentReturn | null {
    if (typeof window === 'undefined') return null;
    const result = parsePlanReturn(window.location.search, readPending());
    if (!result) return null;
    const params = new URLSearchParams(window.location.search);
    ['plan_pp', 'plan_mandate', ...RAZORPAY_PARAMS].forEach((k) => params.delete(k));
    const qs = params.toString();
    window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
    );
    rememberPendingPlanPayment(null);
    return result;
}

/**
 * Poll delay after `elapsedMs` of waiting: quick at first, then backing off,
 * then stop (null) after ten minutes. The webhook is the source of truth; a
 * slow one only means the admin sees the result a little later.
 */
export function pollDelayMs(elapsedMs: number): number | null {
    if (elapsedMs < 30_000) return 2_000;
    if (elapsedMs < 120_000) return 5_000;
    if (elapsedMs < 600_000) return 15_000;
    return null;
}
