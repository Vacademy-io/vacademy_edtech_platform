/**
 * The checkout and order pages as data (contract P2 §5, §9). Pure, apart from the attempt store,
 * which takes its storage as an argument. No money is computed here: totals come from
 * /cart/price and the order answers.
 */
import type { CommerceApiError } from '../api/client';
import type { CartPriceRequestLine, CheckoutRequestBody, OrderView, PaymentMethod, Placed } from '../api/types';
import type { CartState } from '../state/cart-logic';
import type { KeyValueStorage } from '../state/session';

/* ── fields ───────────────────────────────────────────────────────── */

/** An Indian mobile as ten digits ("+91 98765 43210", "09876543210" -> "9876543210"), else null. */
export const normaliseMobile = (raw: string | null | undefined): string | null => {
    let digits = (raw || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};

/** What the phone field keeps while typing: digits only, at most ten (a pasted +91 is dropped). */
export const typedMobile = (raw: string): string => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length > 10 && digits.startsWith('91')) return digits.slice(2, 12);
    if (digits.length > 10 && digits.startsWith('0')) return digits.slice(1, 11);
    return digits.slice(0, 10);
};

/** "98765 43210" for reading back a number. */
export const spacedMobile = (digits: string): string => (digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

export const maskedMobile = (digits: string): string => (digits.length >= 4 ? `••••••${digits.slice(-4)}` : '');

export const isPincode = (pin: string | null | undefined): pin is string => !!pin && /^[1-9]\d{5}$/.test(pin);

export const isEmail = (value: string | null | undefined): boolean =>
    !!value && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

/** A GSTIN: 2-digit state, 10-character PAN, entity digit, Z, check character. */
export const isGstin = (value: string | null | undefined): boolean =>
    !!value && /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.trim().toUpperCase());

/** GST state codes with their names, for the state picker (the server holds the same list). */
export const INDIAN_STATES: ReadonlyArray<{ code: string; en: string; hi: string }> = [
    { code: '35', en: 'Andaman and Nicobar Islands', hi: 'अंडमान और निकोबार द्वीपसमूह' },
    { code: '37', en: 'Andhra Pradesh', hi: 'आंध्र प्रदेश' },
    { code: '12', en: 'Arunachal Pradesh', hi: 'अरुणाचल प्रदेश' },
    { code: '18', en: 'Assam', hi: 'असम' },
    { code: '10', en: 'Bihar', hi: 'बिहार' },
    { code: '04', en: 'Chandigarh', hi: 'चंडीगढ़' },
    { code: '22', en: 'Chhattisgarh', hi: 'छत्तीसगढ़' },
    { code: '26', en: 'Dadra and Nagar Haveli and Daman and Diu', hi: 'दादरा और नगर हवेली और दमन और दीव' },
    { code: '07', en: 'Delhi', hi: 'दिल्ली' },
    { code: '30', en: 'Goa', hi: 'गोवा' },
    { code: '24', en: 'Gujarat', hi: 'गुजरात' },
    { code: '06', en: 'Haryana', hi: 'हरियाणा' },
    { code: '02', en: 'Himachal Pradesh', hi: 'हिमाचल प्रदेश' },
    { code: '01', en: 'Jammu and Kashmir', hi: 'जम्मू और कश्मीर' },
    { code: '20', en: 'Jharkhand', hi: 'झारखंड' },
    { code: '29', en: 'Karnataka', hi: 'कर्नाटक' },
    { code: '32', en: 'Kerala', hi: 'केरल' },
    { code: '38', en: 'Ladakh', hi: 'लद्दाख' },
    { code: '31', en: 'Lakshadweep', hi: 'लक्षद्वीप' },
    { code: '23', en: 'Madhya Pradesh', hi: 'मध्य प्रदेश' },
    { code: '27', en: 'Maharashtra', hi: 'महाराष्ट्र' },
    { code: '14', en: 'Manipur', hi: 'मणिपुर' },
    { code: '17', en: 'Meghalaya', hi: 'मेघालय' },
    { code: '15', en: 'Mizoram', hi: 'मिज़ोरम' },
    { code: '13', en: 'Nagaland', hi: 'नगालैंड' },
    { code: '21', en: 'Odisha', hi: 'ओडिशा' },
    { code: '34', en: 'Puducherry', hi: 'पुदुचेरी' },
    { code: '03', en: 'Punjab', hi: 'पंजाब' },
    { code: '08', en: 'Rajasthan', hi: 'राजस्थान' },
    { code: '11', en: 'Sikkim', hi: 'सिक्किम' },
    { code: '33', en: 'Tamil Nadu', hi: 'तमिलनाडु' },
    { code: '36', en: 'Telangana', hi: 'तेलंगाना' },
    { code: '16', en: 'Tripura', hi: 'त्रिपुरा' },
    { code: '09', en: 'Uttar Pradesh', hi: 'उत्तर प्रदेश' },
    { code: '05', en: 'Uttarakhand', hi: 'उत्तराखंड' },
    { code: '19', en: 'West Bengal', hi: 'पश्चिम बंगाल' },
];

export const stateName = (code: string | null | undefined, locale: string): string => {
    const state = INDIAN_STATES.find((s) => s.code === code);
    if (!state) return '';
    return locale.startsWith('hi') ? state.hi : state.en;
};

/* ── the address and contact form ─────────────────────────────────── */

export interface CheckoutForm {
    phone: string;
    email: string;
    name: string;
    pincode: string;
    city: string;
    stateCode: string;
    line1: string;
    landmark: string;
    gstin: string;
    giftNote: string;
}

export const EMPTY_FORM: CheckoutForm = {
    phone: '',
    email: '',
    name: '',
    pincode: '',
    city: '',
    stateCode: '',
    line1: '',
    landmark: '',
    gstin: '',
    giftNote: '',
};

export type FieldName = keyof CheckoutForm;
export type FieldError = 'required' | 'phone' | 'email' | 'pincode' | 'gstin' | 'short';

/** Field errors in page order (the first one gets focus). */
export const validateForm = (form: CheckoutForm, opts: { emailRequired: boolean }): Array<[FieldName, FieldError]> => {
    const errors: Array<[FieldName, FieldError]> = [];
    if (!form.phone) errors.push(['phone', 'required']);
    else if (!normaliseMobile(form.phone)) errors.push(['phone', 'phone']);
    if (form.email.trim() ? !isEmail(form.email) : opts.emailRequired) errors.push(['email', form.email.trim() ? 'email' : 'required']);
    if (!form.pincode) errors.push(['pincode', 'required']);
    else if (!isPincode(form.pincode)) errors.push(['pincode', 'pincode']);
    if (!form.city.trim()) errors.push(['city', 'required']);
    if (!form.stateCode) errors.push(['stateCode', 'required']);
    if (!form.name.trim()) errors.push(['name', 'required']);
    else if (form.name.trim().length < 2) errors.push(['name', 'short']);
    if (!form.line1.trim()) errors.push(['line1', 'required']);
    else if (form.line1.trim().length < 5) errors.push(['line1', 'short']);
    if (form.gstin.trim() && !isGstin(form.gstin)) errors.push(['gstin', 'gstin']);
    return errors;
};

/** The address is complete enough to price delivery and tax for it. */
export const addressReady = (form: CheckoutForm): boolean =>
    isPincode(form.pincode) && !!form.stateCode && !!form.city.trim() && form.name.trim().length >= 2 && form.line1.trim().length >= 5;

/* ── the attempt (idempotency key) ─────────────────────────────────── */

/** A short, stable fingerprint of what is being bought (FNV-1a over the lines and coupon). */
export const cartHash = (cart: Pick<CartState, 'lines'>, coupon?: string | null): string => {
    const text = JSON.stringify([coupon || '', cart.lines.map((l) => [l.variantId, l.quantity])]);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
};

/** 8 to 64 safe characters, as the server asks. */
export const newClientRequestId = (random: () => number = Math.random): string => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `cx-${crypto.randomUUID()}`;
    } catch {
        // Fall through to the plain generator.
    }
    let out = 'cx-';
    for (let i = 0; i < 24; i += 1) out += Math.floor(random() * 36).toString(36);
    return out;
};

/**
 * One checkout attempt: its idempotency key and, once placed, the order's id, number, access
 * token and the hold's release token. Lives in sessionStorage only (this tab, until it closes).
 */
export interface CheckoutAttempt {
    id: string;
    cartHash: string;
    createdAt: number;
    orderId?: string;
    orderNumber?: string;
    orderToken?: string;
    hold?: { paymentLogId: string; releaseToken: string; expiresAt: string };
}

export const attemptKey = (instituteId: string): string => `cmx.attempt.v1.${instituteId}`;

const readAttempt = (storage: KeyValueStorage | null, instituteId: string): CheckoutAttempt | null => {
    try {
        const raw = storage?.getItem(attemptKey(instituteId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CheckoutAttempt;
        return parsed && typeof parsed.id === 'string' && typeof parsed.cartHash === 'string' ? parsed : null;
    } catch {
        return null;
    }
};

export const writeAttempt = (storage: KeyValueStorage | null, instituteId: string, attempt: CheckoutAttempt | null): void => {
    try {
        if (!attempt) storage?.removeItem(attemptKey(instituteId));
        else storage?.setItem(attemptKey(instituteId), JSON.stringify(attempt));
    } catch {
        // Without storage the attempt lives as long as the page; a reload makes a new one.
    }
};

/**
 * The attempt for this cart: the stored one when it was made for the same cart (a reload, or
 * the resubmit after an OTP, reuses its key), else a new one.
 */
export const attemptFor = (
    storage: KeyValueStorage | null,
    instituteId: string,
    hash: string,
    now: number = Date.now(),
    makeId: () => string = newClientRequestId
): CheckoutAttempt => {
    const stored = readAttempt(storage, instituteId);
    if (stored && stored.cartHash === hash) return stored;
    const fresh: CheckoutAttempt = { id: makeId(), cartHash: hash, createdAt: now };
    writeAttempt(storage, instituteId, fresh);
    return fresh;
};

/** A new key for the same cart: after order_not_payable, idempotency_key_reused or a cancelled replay. */
export const renewAttempt = (
    storage: KeyValueStorage | null,
    instituteId: string,
    hash: string,
    now: number = Date.now(),
    makeId: () => string = newClientRequestId
): CheckoutAttempt => {
    const fresh: CheckoutAttempt = { id: makeId(), cartHash: hash, createdAt: now };
    writeAttempt(storage, instituteId, fresh);
    return fresh;
};

/** The attempt with what the placed order answered (order, token, hold). */
export const withPlaced = (attempt: CheckoutAttempt, placed: Placed): CheckoutAttempt => ({
    ...attempt,
    orderId: placed.order_id,
    orderNumber: placed.order_number,
    orderToken: placed.order_access_token || attempt.orderToken,
    hold: placed.hold
        ? { paymentLogId: placed.hold.payment_log_id, releaseToken: placed.hold.release_token, expiresAt: placed.hold.expires_at }
        : attempt.hold,
});

/* ── the request ──────────────────────────────────────────────────── */

export const buildCheckoutBody = (args: {
    attemptId: string;
    lines: CartPriceRequestLine[];
    form: CheckoutForm;
    method: PaymentMethod;
    expectedTotal: number | null;
    couponCode?: string | null;
    verified: boolean;
    saveAddress: boolean;
    marketingConsent: boolean;
    phoneToken?: string | null;
    challengeToken?: string | null;
}): CheckoutRequestBody => {
    const { form } = args;
    const phone = normaliseMobile(form.phone) || form.phone;
    const optional = (value: string) => (value.trim() ? value.trim() : null);
    return {
        client_request_id: args.attemptId,
        lines: args.lines,
        ...(args.couponCode ? { coupon_code: args.couponCode } : {}),
        payment_method: args.method,
        expected_total: args.expectedTotal,
        customer: { name: form.name.trim(), phone, ...(form.email.trim() ? { email: form.email.trim() } : {}) },
        shipping_address: {
            name: form.name.trim(),
            phone,
            line1: form.line1.trim(),
            landmark: optional(form.landmark),
            city: form.city.trim(),
            state_code: form.stateCode,
            pincode: form.pincode,
        },
        ...(form.gstin.trim() ? { buyer_gstin: form.gstin.trim().toUpperCase() } : {}),
        ...(form.giftNote.trim() ? { gift_note: form.giftNote.trim().slice(0, 500) } : {}),
        // Only a proved phone may keep an address or say yes to WhatsApp offers.
        ...(args.verified && args.saveAddress ? { save_address: true } : {}),
        ...(args.verified && args.marketingConsent ? { marketing_consent: true } : {}),
        ...(args.phoneToken ? { phone_token: args.phoneToken } : {}),
        ...(args.challengeToken ? { challenge_token: args.challengeToken } : {}),
    };
};

/* ── refusals of /checkout (contract §5.2 table) ───────────────────── */

export type CheckoutErrorAction =
    | 'field'
    | 'email'
    | 'otp'
    | 'bot_retry'
    | 'new_attempt'
    | 'price_changed'
    | 'cart_changed'
    | 'drop_coupon'
    | 'hide_cod'
    | 'back_to_cart'
    | 'too_many'
    | 'wait'
    | 'later'
    | 'network'
    | 'generic';

export const checkoutErrorAction = (error: Pick<CommerceApiError, 'code' | 'status' | 'kind' | 'details'>): CheckoutErrorAction => {
    switch (error.code) {
        case 'invalid_request':
            return 'field';
        case 'email_required':
            return 'email';
        case 'phone_verification_required':
            return 'otp';
        case 'bot_check_failed':
            return 'bot_retry';
        case 'idempotency_key_reused':
        case 'order_not_payable':
            return 'new_attempt';
        case 'price_changed':
            return 'price_changed';
        case 'cart_changed':
        case 'out_of_stock':
            return 'cart_changed';
        case 'coupon_not_available':
            return 'drop_coupon';
        case 'payment_method_not_available':
            return 'hide_cod';
        case 'cart_not_priceable':
            return 'back_to_cart';
        case 'too_many_open_orders':
            return error.details?.otp_allows_more === true ? 'otp' : 'too_many';
        case 'rate_limited':
            return 'wait';
        case 'checkout_not_configured':
        case 'buyer_unavailable':
            return 'later';
        default:
            if (error.kind === 'network') return 'network';
            if (error.status === 429) return 'wait';
            if (error.status >= 500) return 'later';
            return 'generic';
    }
};

/* ── the order page ───────────────────────────────────────────────── */

/** Statuses at which the order is bought (the purchase event fires once for them). */
export const PURCHASED_STATUSES = new Set(['CONFIRMED', 'COD_PENDING_CONFIRMATION', 'PACKED', 'SHIPPED', 'DELIVERED']);

export type OrderStage =
    | { kind: 'processing' }
    | { kind: 'pay'; until: number | null }
    | { kind: 'expired' }
    | { kind: 'cod_pending' }
    | { kind: 'placed' }
    | { kind: 'cancelled'; reason: string | null }
    | { kind: 'returned' };

/** How long after the payment window said "paid" an unpaid order still reads as "confirming". */
export const AWAIT_CAPTURE_MS = 5 * 60_000;

/**
 * What the order page shows. A payment in progress never offers a pay button (the page waits
 * for the capture); an unpaid order offers "Pay now" only until its hold ends. `paidAt` is when
 * this device's payment window said the payment went through: for five minutes after it, an
 * order the server still has as unpaid is "confirming" (the confirmation call may have been
 * lost on a weak signal, and the gateway's message or the payment fetch is still on its way).
 */
export const orderStage = (
    view: Pick<OrderView, 'status' | 'payment_processing' | 'payment_retryable' | 'hold_expires_at' | 'cancel_reason'>,
    now: number = Date.now(),
    paidAt: number | null = null
): OrderStage => {
    const status = (view.status || '').toUpperCase();
    if (view.payment_processing) return { kind: 'processing' };
    if (status === 'PENDING_PAYMENT' && paidAt !== null && now - paidAt >= 0 && now - paidAt < AWAIT_CAPTURE_MS) return { kind: 'processing' };
    if (status === 'PENDING_PAYMENT') {
        const until = view.hold_expires_at ? Date.parse(view.hold_expires_at) : NaN;
        if (Number.isFinite(until) && until <= now) return { kind: 'expired' };
        return view.payment_retryable === false ? { kind: 'expired' } : { kind: 'pay', until: Number.isFinite(until) ? until : null };
    }
    if (status === 'COD_PENDING_CONFIRMATION') return { kind: 'cod_pending' };
    if (status === 'CANCELLED') return { kind: 'cancelled', reason: view.cancel_reason || null };
    if (status === 'RTO' || status === 'RETURNED') return { kind: 'returned' };
    return { kind: 'placed' };
};

/** How long to wait before reading a processing order again: 3 s for 30 s, then 10 s up to 5 min. */
export const pollDelay = (elapsedMs: number): number | null => {
    if (elapsedMs < 30_000) return 3_000;
    if (elapsedMs < 300_000) return 10_000;
    return null;
};

/**
 * The order token in an "#t=<token>" fragment, else null. The storefront no longer makes such
 * links (the token travels in the history state, never in an address that analytics may read);
 * this reads one that was saved or shared before.
 */
export const readOrderFragment = (hash: string | null | undefined): string | null => {
    const raw = (hash || '').replace(/^#/, '');
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    const token = params.get('t');
    return token && token.length <= 512 && /^[A-Za-z0-9._~-]+$/.test(token) ? token : null;
};

/** History-state keys of the order page. */
export const ORDER_TOKEN_STATE = 'cmxOrderToken';
export const ORDER_PAID_STATE = 'cmxPaidAt';

/**
 * What the order page is opened with: the order token (and, right after a payment, when the
 * payment window said it went through) as history state, so neither is ever in the address.
 */
export const orderHistoryState = (token: string | null | undefined, paidAt?: number | null): Record<string, unknown> => ({
    ...(token ? { [ORDER_TOKEN_STATE]: token } : {}),
    ...(typeof paidAt === 'number' && Number.isFinite(paidAt) ? { [ORDER_PAID_STATE]: paidAt } : {}),
});

/** A usable order token from history state, else null. */
export const tokenFromState = (state: unknown): string | null => {
    const value = state && typeof state === 'object' ? (state as Record<string, unknown>)[ORDER_TOKEN_STATE] : null;
    return typeof value === 'string' && value.length <= 512 && /^[A-Za-z0-9._~-]+$/.test(value) ? value : null;
};

/** When the payment window said "paid" (epoch ms) from history state, else null. */
export const paidAtFromState = (state: unknown): number | null => {
    const value = state && typeof state === 'object' ? (state as Record<string, unknown>)[ORDER_PAID_STATE] : null;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** Ordered steps of the timeline a buyer sees. */
export const TIMELINE_STEPS = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'] as const;

/** How far along the steps an order is (0-based), or -1 for an order that is not moving. */
export const timelineIndex = (status: string): number => {
    switch ((status || '').toUpperCase()) {
        case 'PENDING_PAYMENT':
        case 'COD_PENDING_CONFIRMATION':
            return 0;
        case 'CONFIRMED':
            return 1;
        case 'PACKED':
            return 2;
        case 'SHIPPED':
            return 3;
        case 'DELIVERED':
            return 4;
        default:
            return -1;
    }
};
