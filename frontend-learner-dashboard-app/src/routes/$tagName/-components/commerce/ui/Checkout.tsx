/**
 * The one-page checkout (contract P2 §9, STOREFRONT §7): order summary, phone (with the
 * WhatsApp code when the shop's buyer-identity setting or the order asks for it), address with
 * the PIN first, collapsed GST details and gift note, the delivery line from the first render,
 * payment with UPI first, and a sticky "Pay ₹X securely" bar. Every total is the server's
 * (/cart/price); the order is placed once per attempt key, so a double tap or a reload never
 * makes two orders.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { CheckCircle, LockSimple, Truck, WarningCircle, WhatsappLogo } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { CommerceApiError } from '../api/client';
import type { AddressView, CartPrice, OtpVerified, PaymentMethod, PincodeInfo, Placed, PlacedPayment } from '../api/types';
import type { MessageKey } from '../i18n';
import {
    EMPTY_FORM,
    INDIAN_STATES,
    addressReady,
    attemptFor,
    buildCheckoutBody,
    cartHash,
    checkoutErrorAction,
    isPincode,
    maskedMobile,
    normaliseMobile,
    renewAttempt,
    validateForm,
    withPlaced,
    writeAttempt,
    type CheckoutAttempt,
    type CheckoutForm,
    type FieldError,
    type FieldName,
} from '../logic/checkout';
import { sendBeginCheckoutOnce, sendCommerceEvent, sendPurchaseOnce, type EventItem } from '../logic/events';
import { formatMoney, formatUnits } from '../logic/format';
import { buyerIdentityOf, identityRules } from '../logic/identity';
import { payWithRazorpay } from '../logic/razorpay';
import { ChallengeError } from '../logic/turnstile';
import { toPriceRequest } from '../state/cart-logic';
import { useCommerceCart } from '../state/cart-store';
import { handOffOrder } from '../state/order-handoff';
import { browserSessionStorage, sessionMatchesPhone } from '../state/session';
import { CartTotals } from './Cart';
import {
    CheckoutUnavailableError,
    Collapsible,
    FIELD_ERROR_KEYS,
    Field,
    apiErrorKey,
    useChallenge,
    useCheckoutConfig,
    useShopperSession,
} from './buy-common';
import { useOnline } from './hooks';
import { OtpStep, PhoneField } from './Otp';
import { EmptyState, ErrorState, shouldRetry, unitLabel } from './primitives';
import { useDebounced } from './queries';
import { ShopLink, useCommerceSite, whatsappLink } from './site';

type Pay = 'upi' | 'card' | 'cod';
type Phase = 'form' | 'submitting' | 'paying' | 'unpaid' | 'confirming';

const COD_REASON_KEYS: Record<string, MessageKey> = {
    ORDER_ABOVE_COD_LIMIT: 'checkout.cod.ORDER_ABOVE_COD_LIMIT',
    PINCODE_BLOCKED: 'checkout.cod.PINCODE_BLOCKED',
    OPEN_COD_ORDERS: 'checkout.cod.OPEN_COD_ORDERS',
    COD_REFUSALS: 'checkout.cod.COD_REFUSALS',
};

/** The cart as analytics items: SKU when the server named it, price per base unit. */
const eventItems = (cart: ReturnType<typeof useCommerceCart.getState>['cart'], price: CartPrice | undefined): EventItem[] => {
    const priced = new Map((price?.lines || []).map((l) => [l.line_ref, l]));
    return cart.lines.map((line) => {
        const p = priced.get(line.variantId);
        return {
            id: p?.sku || line.variantId,
            name: p?.name || line.name,
            unitPrice: p?.unit_price ?? line.unitPrice,
            quantity: line.quantity,
            qtyScale: line.qtyScale,
            variant: p?.variant_label || line.variantLabel,
        };
    });
};

export const CheckoutPage: React.FC = () => {
    const { t, client, instituteId, locale, config: shop, href, siteName, absoluteUrl } = useCommerceSite();
    const router = useRouter();
    const configQuery = useCheckoutConfig();
    const config = configQuery.data;
    const mode = buyerIdentityOf(config?.buyer_identity);
    const cart = useCommerceCart((s) => s.cart);
    const hydrated = useCommerceCart((s) => s.hydrated);
    const applyPrice = useCommerceCart((s) => s.applyPrice);
    const setCartPincode = useCommerceCart((s) => s.setPincode);
    const clearCart = useCommerceCart((s) => s.clear);
    const online = useOnline();
    const { session, save: keepSession, clear: dropSession } = useShopperSession();
    const challenge = useChallenge(config);

    const [form, setForm] = useState<CheckoutForm>(() => ({ ...EMPTY_FORM, pincode: useCommerceCart.getState().cart.pincode || '' }));
    const [errors, setErrors] = useState<Partial<Record<FieldName, FieldError>>>({});
    const [pay, setPay] = useState<Pay>('upi');
    const [phoneProof, setPhoneProof] = useState<{ token: string; phone: string; expiresAt: number } | null>(null);
    const [serverAsksOtp, setServerAsksOtp] = useState(false);
    // The server did not take the stored session as proof (signed out elsewhere, or not readable):
    // it no longer counts on this page, so the code step shows.
    const [sessionRefused, setSessionRefused] = useState(false);
    const [otpOpen, setOtpOpen] = useState(false);
    const [editingPhone, setEditingPhone] = useState(false);
    const [saveAddress, setSaveAddress] = useState(false);
    const [consent, setConsent] = useState(false);
    const [codRefused, setCodRefused] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ key: MessageKey; tone: 'warn' | 'error'; link?: 'cart' } | null>(null);
    const [phase, setPhase] = useState<Phase>('form');
    const [showLandmark, setShowLandmark] = useState(false);
    const [pinInfo, setPinInfo] = useState<PincodeInfo | null>(null);
    const [pickedAddress, setPickedAddress] = useState<string | null>(null);
    const [attempt, setAttempt] = useState<CheckoutAttempt | null>(null);
    const autoFilled = useRef({ city: false, state: false });
    const resubmitAfterOtp = useRef(false);
    // Whether the last order sent carried a proof of the phone (a fresh code or the session).
    const orderPhoneProved = useRef(false);
    const fields = useRef<Partial<Record<FieldName, HTMLInputElement | HTMLSelectElement | null>>>({});
    const otpRef = useRef<HTMLDivElement>(null);
    const noticeRef = useRef<HTMLDivElement>(null);
    const store = useMemo(browserSessionStorage, []);
    const hash = useMemo(() => cartHash(cart), [cart]);

    const set = <K extends FieldName>(name: K, value: CheckoutForm[K]) => {
        setForm((current) => ({ ...current, [name]: value }));
        setErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
    };

    // An order placed in this tab and not paid yet (a reload after closing the payment window).
    useEffect(() => {
        if (!hydrated || cart.lines.length === 0) return;
        const stored = attemptFor(store, instituteId, hash);
        setAttempt(stored);
        // A changed cart is a new attempt: the unpaid order of the old one is left to expire.
        if (stored.orderId && stored.orderToken) setPhase((p) => (p === 'form' ? 'unpaid' : p));
        else setPhase((p) => (p === 'unpaid' ? 'form' : p));
    }, [hydrated, store, instituteId, hash, cart.lines.length]);

    /* identity */
    const phone10 = normaliseMobile(form.phone) || '';
    const method: PaymentMethod = pay === 'cod' ? 'COD' : 'PREPAID';

    /* price: asked again on every change, never cached */
    const priceBody = useMemo(() => {
        const base = toPriceRequest(cart);
        return {
            ...base,
            pincode: isPincode(form.pincode) ? form.pincode : base.pincode,
            ...(form.stateCode ? { state_code: form.stateCode } : {}),
            payment_method: method,
        };
    }, [cart, form.pincode, form.stateCode, method]);
    const liveKey = useMemo(() => JSON.stringify([locale, priceBody]), [locale, priceBody]);
    const key = useDebounced(liveKey, 300);
    const bodyRef = useRef(priceBody);
    bodyRef.current = priceBody;
    const priceQuery = useQuery({
        queryKey: ['commerce', instituteId, 'checkout-price', key],
        queryFn: ({ signal }) => client.priceCart(bodyRef.current, signal),
        enabled: hydrated && cart.lines.length > 0,
        staleTime: 0,
        gcTime: 0,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
        placeholderData: keepPreviousData,
    });
    const price = cart.lines.length > 0 ? priceQuery.data : undefined;
    const pricing = priceQuery.isFetching || key !== liveKey;
    useEffect(() => {
        if (priceQuery.data) applyPrice(priceQuery.data);
    }, [priceQuery.data, applyPrice]);
    const unavailable = (price?.unavailable || []).length > 0;

    /* PIN first: fills city and state (both stay editable; the state is never guessed) */
    useEffect(() => {
        if (!isPincode(form.pincode)) {
            setPinInfo(null);
            return;
        }
        const controller = new AbortController();
        setCartPincode(form.pincode);
        client
            .getPincode(form.pincode, controller.signal)
            .then((info) => {
                setPinInfo(info);
                setForm((current) => {
                    if (current.pincode !== info.pincode) return current;
                    const next = { ...current };
                    if (info.city && (!current.city || autoFilled.current.city)) {
                        next.city = info.city;
                        autoFilled.current.city = true;
                    }
                    if (info.state_code && (!current.stateCode || autoFilled.current.state)) {
                        next.stateCode = info.state_code;
                        autoFilled.current.state = true;
                    }
                    return next;
                });
            })
            .catch(() => setPinInfo(null));
        return () => controller.abort();
    }, [form.pincode, client, setCartPincode]);

    /* saved addresses of a signed-in shopper */
    const addressesQuery = useQuery({
        queryKey: ['commerce', instituteId, 'me-addresses', session?.token || ''],
        queryFn: ({ signal }) => client.myAddresses({ session: session!.token }, signal),
        enabled: !!session,
        staleTime: 60_000,
        retry: false,
    });
    const meQuery = useQuery({
        queryKey: ['commerce', instituteId, 'me', session?.token || ''],
        queryFn: ({ signal }) => client.getMe({ session: session!.token }, signal),
        enabled: !!session,
        staleTime: 60_000,
        retry: false,
    });
    useEffect(() => {
        const failure = addressesQuery.error || meQuery.error;
        if (failure instanceof CommerceApiError && failure.status === 401) dropSession();
    }, [addressesQuery.error, meQuery.error, dropSession]);
    const knownName = meQuery.data?.name || '';
    // The session's number (from /me, kept in memory only) is filled in, masked, with "Change".
    const sessionPhone = session ? normaliseMobile(meQuery.data?.phone) : null;
    useEffect(() => {
        if (sessionPhone && !editingPhone) setForm((current) => (current.phone ? current : { ...current, phone: sessionPhone }));
    }, [sessionPhone, editingPhone]);
    const phoneTokenFresh = !!phoneProof && phoneProof.phone === phone10 && phoneProof.expiresAt > Date.now() + 30_000;
    const sessionForPhone = !sessionRefused && sessionMatchesPhone(session, sessionPhone, phone10);
    const rules = identityRules({ mode, method, phoneTokenFresh, sessionForPhone, serverAsksOtp });
    const showMaskedPhone = !!sessionPhone && sessionForPhone && !editingPhone;
    useEffect(() => {
        if (knownName) setForm((current) => (current.name ? current : { ...current, name: knownName }));
    }, [knownName]);
    const savedAddresses = (addressesQuery.data || []).slice(0, 10);
    const pickAddress = (address: AddressView) => {
        setPickedAddress(address.id);
        autoFilled.current = { city: false, state: false };
        setForm((current) => ({
            ...current,
            name: address.name || current.name,
            line1: [address.line1, address.line2].filter(Boolean).join(', ') || current.line1,
            landmark: address.landmark || '',
            city: address.city || '',
            stateCode: address.state_code || '',
            pincode: address.pincode || '',
        }));
        if (address.landmark) setShowLandmark(true);
        setErrors({});
    };

    /* analytics: begin_checkout once per cart, add_shipping_info once per attempt */
    const items = useMemo(() => eventItems(cart, price), [cart, price]);
    useEffect(() => {
        if (!price || cart.lines.length === 0) return;
        sendBeginCheckoutOnce(hash, { name: 'begin_checkout', items, value: price.totals?.total, currency: price.currency });
    }, [price, hash, items, cart.lines.length]);
    const shippingSent = useRef<string | null>(null);
    useEffect(() => {
        if (!price || pricing || !addressReady(form) || price.tax?.place_of_supply_known === false) return;
        const marker = attempt?.id || hash;
        if (shippingSent.current === marker) return;
        shippingSent.current = marker;
        sendCommerceEvent({ name: 'add_shipping_info', items, value: price.totals?.total, currency: price.currency });
    }, [price, pricing, form, attempt?.id, hash, items]);

    /* COD: offered only when the shop sells it online and the server says this cart qualifies */
    const codOnline = !!config?.cod?.enabled && !!config?.cod?.online && (config?.payment_methods || []).includes('COD');
    const codEligible = price?.cod ? price.cod.eligible : false;
    const codReason = codRefused || (!codEligible ? price?.cod?.reason || null : null);
    const codSelectable = codOnline && codEligible && !codRefused;
    useEffect(() => {
        if (pay === 'cod' && !codSelectable && !pricing) setPay('upi');
    }, [pay, codSelectable, pricing]);

    // The token stays in this tab's sessionStorage; the address and history.state (which analytics
    // scripts can read) carry only a random key.
    const goToOrder = useCallback(
        (token: string | null | undefined, paidAt?: number) =>
            router.navigate({
                href: href('order'),
                state: handOffOrder(instituteId, token, { paidAt, placedHere: true, phoneProved: orderPhoneProved.current }) as never,
            }),
        [router, href, instituteId]
    );

    const showNotice = (key: MessageKey, tone: 'warn' | 'error' = 'error', link?: 'cart') => {
        setNotice({ key, tone, link });
        window.setTimeout(() => noticeRef.current?.scrollIntoView?.({ block: 'center' }), 0);
    };

    /* payment */
    const openPayment = async (payment: PlacedPayment, current: CheckoutAttempt) => {
        setPhase('paying');
        let outcome;
        try {
            outcome = await payWithRazorpay({
                payment,
                siteName,
                phone: phone10 || null,
                email: form.email.trim() || null,
                method: pay === 'upi' ? 'upi' : null,
            });
        } catch {
            setPhase('unpaid');
            showNotice('checkout.payLoadFailed');
            return;
        }
        if (outcome.kind === 'dismissed') {
            setPhase('unpaid');
            return;
        }
        const paidAt = Date.now();
        setPhase('confirming');
        try {
            if (current.orderId) {
                await client.confirmPayment(current.orderId, {
                    gateway_order_id: outcome.gatewayOrderId,
                    gateway_payment_id: outcome.gatewayPaymentId,
                    signature: outcome.signature,
                });
            }
        } catch {
            // The gateway's own message and the payment fetch confirm it anyway; the order page
            // reads the state and never offers a second payment while one is in progress.
        }
        writeAttempt(store, instituteId, null);
        // Leave first, then empty the cart, so the page never flashes "your cart is empty". The
        // order page reads an unpaid order as "confirming" for a while after this payment.
        await goToOrder(current.orderToken, paidAt);
        clearCart();
    };

    const afterPlaced = async (placed: Placed, current: CheckoutAttempt) => {
        const status = (placed.status || '').toUpperCase();
        if (!placed.payment && (status === 'CONFIRMED' || status === 'COD_PENDING_CONFIRMATION')) {
            sendPurchaseOnce(
                {
                    name: 'purchase',
                    transactionId: placed.order_number,
                    items,
                    value: placed.total ?? price?.totals?.total,
                    tax: price?.tax?.tax_amount,
                    shipping: price?.totals?.shipping,
                    currency: placed.currency || price?.currency,
                    paymentType: 'cod',
                },
                instituteId
            );
            writeAttempt(store, instituteId, null);
            await goToOrder(current.orderToken);
            clearCart();
            return;
        }
        if (placed.payment_processing) {
            await goToOrder(current.orderToken);
            return;
        }
        if (placed.payment) {
            await openPayment(placed.payment, current);
            return;
        }
        if (placed.payment_retryable && current.orderId && current.orderToken) {
            const again = await client.retryPayment(current.orderId, current.orderToken);
            if (again.payment) {
                await openPayment(again.payment, current);
                return;
            }
        }
        await goToOrder(current.orderToken);
    };

    const focusField = (name: FieldName) => {
        const element = fields.current[name];
        element?.focus();
        element?.scrollIntoView?.({ block: 'center' });
    };

    const submit = async (opts: { phoneToken?: string | null; botRetried?: boolean; renewed?: boolean } = {}): Promise<void> => {
        if (!online || !price || unavailable || phase !== 'form') return;
        // The token passed in wins: right after an OTP the state of this render is not updated yet.
        const token = opts.phoneToken ?? (phoneTokenFresh ? phoneProof!.token : null);
        const now = identityRules({ mode, method, phoneTokenFresh: !!token, sessionForPhone, serverAsksOtp: serverAsksOtp && !token });
        const problems = validateForm(form, { emailRequired: now.emailRequired });
        if (problems.length) {
            setErrors(Object.fromEntries(problems));
            showNotice('checkout.fixFields');
            focusField(problems[0]![0]);
            return;
        }
        setErrors({});
        if (now.otpRequired) {
            resubmitAfterOtp.current = true;
            setOtpOpen(true);
            showNotice(method === 'COD' ? 'checkout.codNeedsOtp' : 'checkout.needOtp', 'warn');
            window.setTimeout(() => otpRef.current?.scrollIntoView?.({ block: 'center' }), 0);
            return;
        }
        if (!opts.botRetried && !opts.renewed) {
            sendCommerceEvent({ name: 'add_payment_info', items, value: price.totals?.total, currency: price.currency, paymentType: method === 'COD' ? 'cod' : 'prepaid' });
        }
        setPhase('submitting');
        setNotice(null);
        let current = opts.renewed ? renewAttempt(store, instituteId, hash) : attemptFor(store, instituteId, hash);
        setAttempt(current);
        const sentSession = method === 'PREPAID' && sessionForPhone && session ? session.token : null;
        orderPhoneProved.current = !!token || !!sentSession;
        try {
            const challengeToken = await challenge.get();
            const body = buildCheckoutBody({
                attemptId: current.id,
                lines: toPriceRequest(cart).lines,
                form,
                method,
                expectedTotal: typeof price.totals?.total === 'number' ? price.totals.total : null,
                verified: now.verified,
                saveAddress: saveAddress && !pickedAddress,
                marketingConsent: consent,
                phoneToken: token,
                challengeToken,
            });
            const placed = await client.placeOrder(body, { session: sentSession });
            if (placed.replayed && (placed.status || '').toUpperCase() === 'CANCELLED' && !opts.renewed) {
                setPhase('form');
                return submit({ ...opts, phoneToken: token, renewed: true });
            }
            current = withPlaced(current, placed);
            writeAttempt(store, instituteId, current);
            setAttempt(current);
            await afterPlaced(placed, current);
        } catch (failure) {
            setPhase('form');
            if (failure instanceof CheckoutUnavailableError) {
                showNotice('checkout.unavailable');
                return;
            }
            if (failure instanceof ChallengeError) {
                showNotice('checkout.botFailed');
                return;
            }
            if (!(failure instanceof CommerceApiError)) {
                showNotice('error.generic');
                return;
            }
            const action = checkoutErrorAction(failure);
            sendCommerceEvent({ name: 'commerce_checkout_error', code: failure.code || action });
            switch (action) {
                case 'field':
                    showNotice('checkout.fixFields');
                    return;
                case 'email':
                    if (sentSession) setSessionRefused(true);
                    setErrors((e) => ({ ...e, email: 'required' }));
                    if (failure.details?.otp_allowed === true) setOtpOpen(true);
                    showNotice(failure.details?.otp_allowed === true ? 'checkout.emailOrOtp' : 'checkout.emailNeeded', 'warn');
                    focusField('email');
                    return;
                case 'otp':
                    if (sentSession) setSessionRefused(true);
                    setServerAsksOtp(true);
                    resubmitAfterOtp.current = true;
                    setOtpOpen(true);
                    showNotice(failure.details?.reason === 'cod' ? 'checkout.codNeedsOtp' : 'checkout.needOtp', 'warn');
                    return;
                case 'bot_retry':
                    if (!opts.botRetried) return submit({ ...opts, phoneToken: token, botRetried: true });
                    showNotice('checkout.botFailed');
                    return;
                case 'new_attempt':
                    if (!opts.renewed) return submit({ ...opts, phoneToken: token, renewed: true });
                    showNotice('error.generic');
                    return;
                case 'price_changed':
                    void priceQuery.refetch();
                    showNotice('checkout.priceChanged', 'warn');
                    return;
                case 'cart_changed':
                    void priceQuery.refetch();
                    showNotice('checkout.cartChanged', 'warn');
                    return;
                case 'drop_coupon':
                    showNotice('checkout.couponDropped', 'warn');
                    return;
                case 'hide_cod':
                    setCodRefused(typeof failure.details?.reason === 'string' ? failure.details.reason : 'COD_NOT_AVAILABLE');
                    setPay('upi');
                    showNotice('checkout.codUnavailable', 'warn');
                    return;
                case 'back_to_cart':
                    showNotice('checkout.backToCart', 'error', 'cart');
                    return;
                case 'too_many':
                    showNotice('checkout.tooMany');
                    return;
                case 'wait':
                    showNotice('error.rateLimited');
                    return;
                case 'later':
                    showNotice('buy.error.later');
                    return;
                case 'network':
                    showNotice('error.network');
                    return;
                default:
                    showNotice('error.generic');
            }
        }
    };

    const onVerified = (verified: OtpVerified, phone: string) => {
        setPhoneProof({ token: verified.verified_phone_token, phone, expiresAt: Date.now() + Math.max(60, verified.expires_in || 900) * 1000 });
        keepSession(verified);
        setSessionRefused(false);
        setOtpOpen(false);
        setServerAsksOtp(false);
        setNotice(null);
        if (resubmitAfterOtp.current) {
            resubmitAfterOtp.current = false;
            void submit({ phoneToken: verified.verified_phone_token });
        }
    };

    /* the unpaid order of this attempt: pay again, or cancel and free the stock */
    const payAgain = async () => {
        if (!attempt?.orderId || !attempt.orderToken) return;
        setPhase('submitting');
        try {
            const again = await client.retryPayment(attempt.orderId, attempt.orderToken);
            if (again.payment_processing || !again.payment) {
                await goToOrder(attempt.orderToken);
                return;
            }
            await openPayment(again.payment, attempt);
        } catch (failure) {
            if (failure instanceof CommerceApiError && failure.code === 'order_not_payable') {
                // Paid meanwhile, or its time ran out: the order page says which.
                await goToOrder(attempt.orderToken);
                return;
            }
            setPhase('unpaid');
            showNotice(apiErrorKey(failure));
        }
    };

    const cancelOrder = async () => {
        if (!attempt) return;
        setPhase('submitting');
        try {
            if (attempt.hold) await client.releaseHold({ payment_log_id: attempt.hold.paymentLogId, release_token: attempt.hold.releaseToken });
        } catch {
            // The hold ends on its own at its time; the order then expires.
        }
        setAttempt(renewAttempt(store, instituteId, hash));
        setPhase('form');
        showNotice('checkout.cancelled', 'warn');
    };

    /* ── render ── */

    if (!hydrated || (configQuery.isPending && !configQuery.error)) return <CheckoutSkeleton />;
    if (cart.lines.length === 0) {
        return (
            <div className="cmx-shell cmx-section">
                <EmptyState title={t('cart.empty.title')} body={t('checkout.emptyBody')}>
                    <ShopLink to="cart" className="cmx-btn cmx-btn--primary">
                        {t('checkout.backToCartButton')}
                    </ShopLink>
                </EmptyState>
            </div>
        );
    }
    if (configQuery.error || challenge.unavailable) {
        return (
            <div className="cmx-shell cmx-section">
                <h1 className="cmx-h1 mb-4">{t('checkout.title')}</h1>
                {configQuery.error ? (
                    <ErrorState error={configQuery.error} onRetry={() => void configQuery.refetch()} />
                ) : (
                    <p className="cmx-note cmx-note--error">{t('checkout.unavailable')}</p>
                )}
            </div>
        );
    }

    const money = (value: number | null | undefined) => formatMoney(value, price?.currency);
    const total = money(price?.totals?.total);
    const busy = phase !== 'form';
    const payable = online && !!price && !pricing && !unavailable && !busy;
    const error = (name: FieldName) => (errors[name] ? t(FIELD_ERROR_KEYS[errors[name]!]!) : null);
    const helpText = [t('cart.whatsappText'), ...cart.lines.map((l) => `• ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''} — ${absoluteUrl(`p/${l.slug}`)}`)].join('\n');
    const help = whatsappLink(shop.whatsappNumber, helpText);
    // The time left on the unpaid order's hold, not the shop's full hold time.
    const holdEnds = attempt?.hold?.expiresAt ? Date.parse(attempt.hold.expiresAt) : NaN;
    const holdMinutes = Number.isFinite(holdEnds)
        ? Math.max(1, Math.ceil((holdEnds - Date.now()) / 60_000))
        : Number(config?.hold_minutes) > 0
          ? Number(config?.hold_minutes)
          : 15;

    return (
        <div className="cmx-shell cmx-section cmx-checkout-page">
            <h1 className="cmx-h1 mb-2">{t('checkout.title')}</h1>
            <DeliveryLine price={price} pending={pricing && !price} dispatch={shop.dispatchPromise} />
            {!online && (
                <p className="cmx-note mt-3" role="status">
                    {t('cart.offline')}
                </p>
            )}
            <div className="cmx-checkout">
                <form
                    className="cmx-checkout__main"
                    noValidate
                    aria-busy={busy}
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <details className="cmx-panel cmx-checkout__summary lg:hidden">
                        <summary className="flex min-h-11 items-center justify-between gap-3 font-semibold">
                            <span>{t('checkout.summary', { count: cart.lines.length })}</span>
                            <span className="tabular-nums">{total ?? '…'}</span>
                        </summary>
                        <div className="mt-3">
                            <SummaryBody price={price} />
                        </div>
                    </details>

                    {/* contact */}
                    <section className="cmx-buy-section" aria-labelledby="cmx-co-contact">
                        <h2 className="cmx-h3 cmx-buy-section__title" id="cmx-co-contact">
                            {t('checkout.contact')}
                        </h2>
                        {showMaskedPhone ? (
                            <div className="cmx-field">
                                <span className="cmx-field__label">{t('form.phone')}</span>
                                <div className="cmx-field__box cmx-field__box--static">
                                    <span className="cmx-field__input flex items-center gap-2">
                                        +91 {maskedMobile(sessionPhone!)}
                                        <CheckCircle size={18} weight="fill" className="cmx-ok" aria-label={t('checkout.verified')} />
                                    </span>
                                    <button
                                        type="button"
                                        className="cmx-link px-3"
                                        onClick={() => {
                                            setEditingPhone(true);
                                            set('phone', '');
                                            window.setTimeout(() => fields.current.phone?.focus(), 0);
                                        }}
                                    >
                                        {t('checkout.change')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <PhoneField
                                value={form.phone}
                                onChange={(next) => set('phone', next)}
                                error={error('phone')}
                                hint={rules.verified ? null : t('checkout.phoneHint')}
                                fieldRef={(el) => {
                                    fields.current.phone = el;
                                }}
                                after={
                                    rules.verified ? (
                                        <CheckCircle size={20} weight="fill" className="cmx-ok me-3 shrink-0" aria-label={t('checkout.verified')} />
                                    ) : undefined
                                }
                            />
                        )}
                        {!rules.verified && (rules.otpRequired || otpOpen || rules.otpRecommended || mode === 'EMAIL') && (
                            <div ref={otpRef} className={cn('flex flex-col gap-2', rules.otpRequired && 'cmx-buy-required')}>
                                {rules.otpRequired && <p className="cmx-small font-medium">{method === 'COD' ? t('checkout.codNeedsOtp') : t('checkout.otpRequired')}</p>}
                                {otpOpen || rules.otpRequired || rules.otpRecommended ? (
                                    <OtpStep
                                        purpose="CHECKOUT"
                                        phone={phone10}
                                        config={config}
                                        recommended={rules.otpRecommended || rules.otpRequired}
                                        onVerified={onVerified}
                                    />
                                ) : (
                                    <button type="button" className="cmx-link self-start" onClick={() => setOtpOpen(true)}>
                                        {t('checkout.useSaved')}
                                    </button>
                                )}
                            </div>
                        )}
                        <Field
                            label={t('form.email')}
                            optionalText={rules.emailRequired ? null : t('form.optional')}
                            hint={rules.emailRequired && mode !== 'EMAIL' ? t('checkout.emailHintRequired') : t('checkout.emailHint')}
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            maxLength={254}
                            value={form.email}
                            onChange={(event) => set('email', event.target.value)}
                            error={error('email')}
                            required={rules.emailRequired}
                            fieldRef={(el) => {
                                fields.current.email = el;
                            }}
                        />
                    </section>

                    {/* address */}
                    <section className="cmx-buy-section" aria-labelledby="cmx-co-address">
                        <h2 className="cmx-h3 cmx-buy-section__title" id="cmx-co-address">
                            {t('checkout.address')}
                        </h2>
                        {savedAddresses.length > 0 && (
                            <fieldset className="flex flex-col gap-2">
                                <legend className="cmx-small cmx-muted mb-1">{t('checkout.savedAddresses')}</legend>
                                {savedAddresses.map((address) => (
                                    <label key={address.id} className={cn('cmx-choice', pickedAddress === address.id && 'cmx-choice--on')}>
                                        <input type="radio" name="cmx-saved" checked={pickedAddress === address.id} onChange={() => pickAddress(address)} />
                                        <span className="min-w-0">
                                            <span className="block font-medium">{address.name}</span>
                                            <span className="cmx-small cmx-body block">
                                                {[address.line1, address.city, address.pincode].filter(Boolean).join(', ')}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </fieldset>
                        )}
                        <Field
                            label={t('form.pincode')}
                            type="text"
                            inputMode="numeric"
                            autoComplete="postal-code"
                            pattern="[0-9]*"
                            maxLength={6}
                            value={form.pincode}
                            onChange={(event) => {
                                setPickedAddress(null);
                                set('pincode', event.target.value.replace(/\D/g, '').slice(0, 6));
                            }}
                            error={error('pincode')}
                            hint={pinInfo?.city ? t('checkout.pinFound', { place: pinInfo.city }) : t('checkout.pinHint')}
                            fieldRef={(el) => {
                                fields.current.pincode = el;
                            }}
                        />
                        <div className="cmx-field-row">
                            <Field
                                label={t('form.city')}
                                autoComplete="address-level2"
                                maxLength={80}
                                value={form.city}
                                onChange={(event) => {
                                    autoFilled.current.city = false;
                                    set('city', event.target.value);
                                }}
                                error={error('city')}
                                fieldRef={(el) => {
                                    fields.current.city = el;
                                }}
                            />
                            <StateSelect
                                value={form.stateCode}
                                onChange={(code) => {
                                    autoFilled.current.state = false;
                                    set('stateCode', code);
                                }}
                                error={error('stateCode')}
                                selectRef={(el) => {
                                    fields.current.stateCode = el;
                                }}
                            />
                        </div>
                        <Field
                            label={t('form.name')}
                            autoComplete="name"
                            maxLength={120}
                            value={form.name}
                            onChange={(event) => set('name', event.target.value)}
                            error={error('name')}
                            fieldRef={(el) => {
                                fields.current.name = el;
                            }}
                        />
                        <Field
                            label={t('form.line1')}
                            hint={t('form.line1Hint')}
                            autoComplete="street-address"
                            maxLength={240}
                            value={form.line1}
                            onChange={(event) => {
                                setPickedAddress(null);
                                set('line1', event.target.value);
                            }}
                            error={error('line1')}
                            fieldRef={(el) => {
                                fields.current.line1 = el;
                            }}
                        />
                        {showLandmark ? (
                            <Field
                                label={t('form.landmark')}
                                optionalText={t('form.optional')}
                                maxLength={120}
                                value={form.landmark}
                                onChange={(event) => set('landmark', event.target.value)}
                            />
                        ) : (
                            <button type="button" className="cmx-link self-start" onClick={() => setShowLandmark(true)}>
                                {t('form.addLandmark')}
                            </button>
                        )}
                        {rules.canSaveAddress && !pickedAddress && (
                            <label className="cmx-check">
                                <input type="checkbox" checked={saveAddress} onChange={(event) => setSaveAddress(event.target.checked)} />
                                {t('checkout.saveAddress')}
                            </label>
                        )}
                        <Collapsible summary={t('checkout.gst')}>
                            <Field
                                label={t('form.gstin')}
                                hint={t('form.gstinHint')}
                                autoCapitalize="characters"
                                maxLength={15}
                                value={form.gstin}
                                onChange={(event) => set('gstin', event.target.value.toUpperCase().replace(/\s/g, ''))}
                                error={error('gstin')}
                                fieldRef={(el) => {
                                    fields.current.gstin = el;
                                }}
                            />
                        </Collapsible>
                        <Collapsible summary={t('checkout.gift')}>
                            <label className="cmx-field">
                                <span className="cmx-field__label">{t('checkout.giftLabel')}</span>
                                <textarea
                                    className="cmx-textarea"
                                    rows={3}
                                    maxLength={500}
                                    value={form.giftNote}
                                    onChange={(event) => set('giftNote', event.target.value)}
                                />
                            </label>
                        </Collapsible>
                    </section>

                    {/* payment */}
                    <section className="cmx-buy-section" aria-labelledby="cmx-co-pay">
                        <h2 className="cmx-h3 cmx-buy-section__title" id="cmx-co-pay">
                            {t('checkout.payment')}
                        </h2>
                        <fieldset className="flex flex-col gap-2" aria-labelledby="cmx-co-pay">
                            <PayChoice id="upi" value={pay} onPick={setPay} title={t('checkout.pay.upi')} detail={t('checkout.pay.upiDetail')} badge={t('checkout.recommended')} />
                            <PayChoice id="card" value={pay} onPick={setPay} title={t('checkout.pay.card')} detail={t('checkout.pay.cardDetail')} />
                            {codOnline &&
                                (codSelectable ? (
                                    <PayChoice
                                        id="cod"
                                        value={pay}
                                        onPick={setPay}
                                        title={t('checkout.pay.cod')}
                                        detail={
                                            typeof price?.cod?.charge === 'number' && price.cod.charge > 0
                                                ? t('checkout.pay.codCharge', { amount: money(price.cod.charge) })
                                                : rules.verified || phoneTokenFresh
                                                  ? t('checkout.pay.codDetail')
                                                  : t('checkout.pay.codOtp')
                                        }
                                    />
                                ) : codReason ? (
                                    <p className="cmx-small cmx-muted">{t(COD_REASON_KEYS[codReason] || 'checkout.cod.generic')}</p>
                                ) : null)}
                        </fieldset>
                        {rules.canSaveAddress && (
                            <label className="cmx-check">
                                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                                {t('checkout.consent')}
                            </label>
                        )}
                    </section>

                    {(shop.reassurance.length > 0 || help) && (
                        <ul className="cmx-reassure-list" aria-label={t('checkout.reassurance')}>
                            {shop.reassurance.slice(0, 4).map((item) => (
                                <li key={item.label} className="flex items-start gap-2">
                                    <CheckCircle size={18} className="cmx-ok mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>{item.label}</span>
                                </li>
                            ))}
                            {help && (
                                <li>
                                    <a href={help} target="_blank" rel="noopener noreferrer" className="cmx-link inline-flex min-h-11 items-center gap-2">
                                        <WhatsappLogo size={18} aria-hidden="true" />
                                        {t('checkout.help')}
                                    </a>
                                </li>
                            )}
                        </ul>
                    )}

                    {/* The bot check, when Cloudflare needs a tap, shows here: next to the pay button, on screen. */}
                    {challenge.host}

                    <div ref={noticeRef}>
                        {notice && (
                            <p className={cn('cmx-note', notice.tone === 'warn' ? 'cmx-note--warn' : 'cmx-note--error')} role="alert">
                                <WarningCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
                                <span>
                                    {t(notice.key)}{' '}
                                    {notice.link === 'cart' && (
                                        <ShopLink to="cart" className="cmx-link">
                                            {t('checkout.backToCartButton')}
                                        </ShopLink>
                                    )}
                                </span>
                            </p>
                        )}
                    </div>

                    {phase === 'unpaid' && attempt?.orderNumber ? (
                        <div className="cmx-panel flex flex-col gap-3" role="status">
                            <p className="font-semibold">{t('checkout.unpaid.title', { number: attempt.orderNumber })}</p>
                            <p className="cmx-small cmx-body">{t('checkout.unpaid.body', { minutes: holdMinutes })}</p>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <button type="button" className="cmx-btn cmx-btn--primary cmx-btn--lg flex-1" onClick={() => void payAgain()}>
                                    {t('checkout.payNow')}
                                </button>
                                <button type="button" className="cmx-btn cmx-btn--outline cmx-btn--lg flex-1" onClick={() => void cancelOrder()}>
                                    {t('checkout.cancelOrder')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="cmx-paybar">
                            <button type="submit" className="cmx-btn cmx-btn--primary cmx-btn--lg cmx-btn--block" disabled={!payable} aria-busy={busy}>
                                {method === 'PREPAID' && <LockSimple size={18} weight="bold" aria-hidden="true" />}
                                {phase === 'submitting' || phase === 'paying'
                                    ? t('checkout.placing')
                                    : phase === 'confirming'
                                      ? t('checkout.confirming')
                                      : !total
                                        ? t('cart.pricing')
                                        : method === 'COD'
                                          ? t('checkout.placeOrder', { total })
                                          : t('checkout.payButton', { total })}
                            </button>
                            <p className="cmx-small cmx-muted text-center">{t('checkout.terms')}</p>
                        </div>
                    )}
                </form>
                <aside className="cmx-panel cmx-checkout__aside hidden lg:block" aria-label={t('cart.totalsLabel')}>
                    <SummaryBody price={price} />
                </aside>
            </div>
        </div>
    );
};

/** Lines and the server's totals. */
const SummaryBody: React.FC<{ price: CartPrice | undefined }> = ({ price }) => {
    const { t } = useCommerceSite();
    const cart = useCommerceCart((s) => s.cart);
    const priced = new Map((price?.lines || []).map((l) => [l.line_ref, l]));
    const problems = new Map((price?.unavailable || []).map((l) => [l.line_ref, l]));
    return (
        <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-3">
                {cart.lines.map((line) => {
                    const p = priced.get(line.variantId);
                    const scale = Math.max(1, Math.floor(line.qtyScale || 1));
                    const qty = scale > 1 ? `${formatUnits(line.quantity, scale)} ${unitLabel(t, line.unit, true)}` : String(line.quantity);
                    return (
                        <li key={line.variantId} className="flex items-start gap-3">
                            <div className="cmx-img cmx-line__thumb w-12 shrink-0">
                                {line.imageUrl && <img src={line.imageUrl} alt="" loading="lazy" decoding="async" width={48} height={60} />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="cmx-small font-medium">{p?.name || line.name}</p>
                                <p className="cmx-small cmx-muted">
                                    {[p?.variant_label || line.variantLabel, t('order.qty', { qty })].filter(Boolean).join(' · ')}
                                </p>
                                {problems.has(line.variantId) && (
                                    <p className="cmx-small cmx-bad" role="status">
                                        {t('checkout.lineUnavailable')}
                                    </p>
                                )}
                            </div>
                            <span className="cmx-small font-semibold tabular-nums">{p ? formatMoney(p.net ?? p.gross, price?.currency) : ''}</span>
                        </li>
                    );
                })}
            </ul>
            {price ? (
                <CartTotals price={price} />
            ) : (
                <div className="flex flex-col gap-2" aria-hidden="true">
                    <div className="cmx-skel h-4 w-full" />
                    <div className="cmx-skel h-6 w-full" />
                </div>
            )}
            {(price?.unavailable || []).length > 0 && (
                <ShopLink to="cart" className="cmx-link">
                    {t('checkout.fixCart')}
                </ShopLink>
            )}
        </div>
    );
};

/** "Delivery ₹80 · Ships in 2 working days": shown from the first render, never a total that grows later. */
const DeliveryLine: React.FC<{ price: CartPrice | undefined; pending: boolean; dispatch: string }> = ({ price, pending, dispatch }) => {
    const { t, siteT } = useCommerceSite();
    const shipping = price?.shipping;
    const charge = price?.totals?.shipping;
    return (
        <p className="cmx-delivery" role="status">
            <Truck size={20} aria-hidden="true" className="shrink-0" />
            {pending || !price ? (
                <span className="cmx-skel inline-block h-4 w-40" aria-label={t('cart.pricing')} />
            ) : (
                <span>
                    {shipping?.free || !charge ? t('checkout.deliveryFree') : t('checkout.delivery', { amount: formatMoney(charge, price.currency) })}
                    {dispatch ? ` · ${siteT(dispatch)}` : ''}
                </span>
            )}
        </p>
    );
};

const PayChoice: React.FC<{ id: Pay; value: Pay; onPick(id: Pay): void; title: string; detail: string; badge?: string }> = ({
    id,
    value,
    onPick,
    title,
    detail,
    badge,
}) => (
    <label className={cn('cmx-choice', value === id && 'cmx-choice--on')}>
        <input type="radio" name="cmx-pay" value={id} checked={value === id} onChange={() => onPick(id)} />
        <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 font-medium">
                {title}
                {badge && <span className="cmx-badge">{badge}</span>}
            </span>
            <span className="cmx-small cmx-body block">{detail}</span>
        </span>
    </label>
);

/** The state picker: empty until the PIN or the shopper fills it, never a guessed state. */
export const StateSelect: React.FC<{
    value: string;
    onChange(code: string): void;
    error?: string | null;
    selectRef?: React.Ref<HTMLSelectElement>;
}> = ({ value, onChange, error, selectRef }) => {
    const { t, locale } = useCommerceSite();
    const id = React.useId();
    const states = useMemo(
        () => [...INDIAN_STATES].sort((a, b) => (locale.startsWith('hi') ? a.hi.localeCompare(b.hi, 'hi') : a.en.localeCompare(b.en))),
        [locale]
    );
    return (
        <div className="cmx-field">
            <label htmlFor={id} className="cmx-field__label">
                {t('form.state')}
            </label>
            <div className={cn('cmx-field__box', !!error && 'cmx-field__box--bad')}>
                <select
                    id={id}
                    ref={selectRef}
                    className="cmx-field__input cmx-field__select"
                    autoComplete="address-level1"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                >
                    <option value="">{t('form.statePick')}</option>
                    {states.map((s) => (
                        <option key={s.code} value={s.code}>
                            {locale.startsWith('hi') ? s.hi : s.en}
                        </option>
                    ))}
                </select>
            </div>
            {error && (
                <p id={`${id}-error`} className="cmx-field__error" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
};

const CheckoutSkeleton: React.FC = () => {
    const { t } = useCommerceSite();
    return (
        <div className="cmx-shell cmx-section" aria-busy="true">
            <p className="cmx-sr" role="status">
                {t('common.loading')}
            </p>
            <div className="cmx-skel mb-4 h-8 w-40" aria-hidden="true" />
            <div className="flex flex-col gap-4" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="cmx-skel cmx-skel--field w-full" />
                ))}
            </div>
        </div>
    );
};
