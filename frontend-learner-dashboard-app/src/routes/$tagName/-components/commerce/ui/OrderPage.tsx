/**
 * The thank-you and order page (contract P2 §9). Opened with the order access token in the
 * history state (never in the address, where analytics scripts could read it); an older
 * "order#t=…" link still works, and its token is moved into the history state at once. The
 * token travels to the API only in the X-Commerce-Order-Token header. A payment in progress
 * shows "Confirming your payment" and the page reads the order again (every 3 s for 30 s, then
 * every 10 s up to 5 minutes); it never offers a second payment while one is in progress, nor
 * in the five minutes after this device's payment window said the payment went through.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Clock, Phone, WhatsappLogo, XCircle } from '@phosphor-icons/react';
import { CommerceApiError } from '../api/client';
import type { OrderView } from '../api/types';
import type { MessageKey } from '../i18n';
import { ORDER_TOKEN_STATE, PURCHASED_STATUSES, orderStage, paidAtFromState, pollDelay, readOrderFragment, tokenFromState } from '../logic/checkout';
import { formatDate } from '../logic/dates';
import { sendPurchaseOnce } from '../logic/events';
import { payWithRazorpay } from '../logic/razorpay';
import { OrderBody, OrderTimeline, apiErrorKey, statusKey, useShopperSession } from './buy-common';
import { ErrorState, shouldRetry } from './primitives';
import { ShopLink, useCommerceSite, whatsappLink } from './site';

/**
 * The order token of this page: from history.state (how the storefront opens it, and on a
 * reload or Back), else from an older "#t=" link, which is then moved into history.state and
 * removed from the address bar.
 */
export const takeOrderToken = (win: Window | undefined = typeof window === 'undefined' ? undefined : window): string | null => {
    if (!win) return null;
    try {
        const kept = tokenFromState(win.history.state);
        if (kept) {
            // A stray fragment never stays in the address next to it.
            if (win.location.hash) win.history.replaceState(win.history.state, '', `${win.location.pathname}${win.location.search}`);
            return kept;
        }
        const fromHash = readOrderFragment(win.location.hash);
        if (fromHash) {
            const state = (win.history.state && typeof win.history.state === 'object' ? win.history.state : {}) as Record<string, unknown>;
            win.history.replaceState({ ...state, [ORDER_TOKEN_STATE]: fromHash }, '', `${win.location.pathname}${win.location.search}`);
            return fromHash;
        }
        return null;
    } catch {
        return null;
    }
};

/** When this device's payment window said "paid", from history.state, else null. */
const takePaidAt = (win: Window | undefined = typeof window === 'undefined' ? undefined : window): number | null => {
    try {
        return win ? paidAtFromState(win.history.state) : null;
    } catch {
        return null;
    }
};

const CANCEL_KEYS: Record<string, MessageKey> = {
    PAYMENT_EXPIRED: 'order.cancel.PAYMENT_EXPIRED',
    SHOPPER_RELEASED: 'order.cancel.SHOPPER_RELEASED',
    OUT_OF_STOCK: 'order.cancel.OUT_OF_STOCK',
};

/** The heading and line of an order's state. */
export const OrderState: React.FC<{ view: OrderView; pollingOver?: boolean; onPay?: () => void; paying?: boolean; paidAt?: number | null }> = ({
    view,
    pollingOver,
    onPay,
    paying,
    paidAt = null,
}) => {
    const { t } = useCommerceSite();
    const stage = orderStage(view, Date.now(), paidAt);
    switch (stage.kind) {
        case 'processing':
            return (
                <div className="cmx-order-state" role="status">
                    <Clock size={28} aria-hidden="true" className="cmx-spin-slow" />
                    <div>
                        <p className="cmx-h2">{t('order.processing.title')}</p>
                        <p className="cmx-body">{pollingOver ? t('order.processing.slow') : t('order.processing.body')}</p>
                    </div>
                </div>
            );
        case 'pay':
            return (
                <div className="cmx-order-state" role="status">
                    <Clock size={28} aria-hidden="true" />
                    <div className="flex flex-1 flex-col gap-3">
                        <div>
                            <p className="cmx-h2">{t('order.status.PENDING_PAYMENT')}</p>
                            <p className="cmx-body">
                                {stage.until ? t('order.payBefore', { time: new Date(stage.until).toTimeString().slice(0, 5) }) : t('order.payPending')}
                            </p>
                        </div>
                        {onPay && (
                            <button type="button" className="cmx-btn cmx-btn--primary cmx-btn--lg" onClick={onPay} disabled={paying} aria-busy={paying}>
                                {t('checkout.payNow')}
                            </button>
                        )}
                    </div>
                </div>
            );
        case 'expired':
            return (
                <div className="cmx-order-state" role="status">
                    <XCircle size={28} aria-hidden="true" />
                    <div>
                        <p className="cmx-h2">{t('order.expired.title')}</p>
                        <p className="cmx-body">{t('order.expired.body')}</p>
                    </div>
                </div>
            );
        case 'cod_pending':
            return (
                <div className="cmx-order-state" role="status">
                    <Phone size={28} aria-hidden="true" />
                    <div>
                        <p className="cmx-h2">{t('order.status.COD_PENDING_CONFIRMATION')}</p>
                        <p className="cmx-body">{t('order.codPending.body')}</p>
                    </div>
                </div>
            );
        case 'cancelled':
            return (
                <div className="cmx-order-state" role="status">
                    <XCircle size={28} aria-hidden="true" />
                    <div>
                        <p className="cmx-h2">{t('order.status.CANCELLED')}</p>
                        <p className="cmx-body">{t((stage.reason && CANCEL_KEYS[stage.reason]) || 'order.cancel.other')}</p>
                    </div>
                </div>
            );
        case 'returned':
            return (
                <div className="cmx-order-state" role="status">
                    <XCircle size={28} aria-hidden="true" />
                    <p className="cmx-h2">{t(statusKey(view.status))}</p>
                </div>
            );
        default:
            return (
                <div className="cmx-order-state cmx-order-state--ok" role="status">
                    <CheckCircle size={28} weight="fill" aria-hidden="true" className="cmx-ok" />
                    <div>
                        <p className="cmx-h2">{(view.status || '').toUpperCase() === 'CONFIRMED' ? t('order.thanks') : t(statusKey(view.status))}</p>
                        <p className="cmx-body">{t('order.thanksBody')}</p>
                    </div>
                </div>
            );
    }
};

export const OrderPage: React.FC = () => {
    const { t, client, instituteId, config: shop, siteName, locale } = useCommerceSite();
    const queryClient = useQueryClient();
    const [token] = useState<string | null>(() => takeOrderToken());
    const [paidAt, setPaidAt] = useState<number | null>(() => takePaidAt());
    const { session, clear: dropSession } = useShopperSession();
    const [pollStart, setPollStart] = useState<number | null>(paidAt);
    const [paying, setPaying] = useState(false);
    const [payError, setPayError] = useState<MessageKey | null>(null);
    const queryKey = useMemo(() => ['commerce', instituteId, 'order', token || ''], [instituteId, token]);
    const query = useQuery({
        queryKey,
        queryFn: ({ signal }) => client.viewOrder(token!, signal),
        enabled: !!token,
        retry: shouldRetry,
        staleTime: 0,
        refetchOnWindowFocus: true,
        refetchInterval: (q) => {
            const data = q.state.data as OrderView | undefined;
            if (!data || pollStart === null || orderStage(data, Date.now(), paidAt).kind !== 'processing') return false;
            return pollDelay(Date.now() - pollStart) ?? false;
        },
    });
    const view = query.data;
    const processing = !!view && orderStage(view, Date.now(), paidAt).kind === 'processing';

    // The polling clock starts when the page first sees the payment in progress.
    useEffect(() => {
        if (processing && pollStart === null) setPollStart(Date.now());
    }, [processing, pollStart]);
    const [, tick] = useState(0);
    useEffect(() => {
        if (!processing || pollStart === null) return;
        const timer = window.setTimeout(() => tick((n) => n + 1), 300_500 - (Date.now() - pollStart));
        return () => window.clearTimeout(timer);
    }, [processing, pollStart]);
    const pollingOver = pollStart !== null && Date.now() - pollStart >= 300_000;

    // purchase: once per order number on this device, when the order is bought.
    useEffect(() => {
        if (!view || !PURCHASED_STATUSES.has((view.status || '').toUpperCase())) return;
        sendPurchaseOnce({
            name: 'purchase',
            transactionId: view.order_number,
            items: (view.lines || []).map((line) => ({
                id: line.sku || line.line_ref || line.name || 'item',
                name: line.name || '',
                unitPrice: line.unit_price,
                quantity: line.quantity,
                qtyScale: line.qty_scale,
                variant: line.variant_label,
            })),
            value: view.totals?.total,
            tax: view.totals?.tax,
            shipping: view.totals?.shipping,
            currency: view.currency,
            paymentType: (view.payment_method || '').toUpperCase() === 'COD' ? 'cod' : 'prepaid',
        }, instituteId);
    }, [view, instituteId]);

    const pay = async () => {
        if (!view || !token) return;
        setPaying(true);
        setPayError(null);
        try {
            const again = await client.retryPayment(view.order_id, token);
            if (again.payment) {
                const outcome = await payWithRazorpay({ payment: again.payment, siteName, phone: null, email: null, method: null });
                if (outcome.kind === 'paid') {
                    await client
                        .confirmPayment(view.order_id, {
                            gateway_order_id: outcome.gatewayOrderId,
                            gateway_payment_id: outcome.gatewayPaymentId,
                            signature: outcome.signature,
                        })
                        .catch(() => undefined);
                    setPaidAt(Date.now());
                    setPollStart(Date.now());
                }
            }
        } catch (failure) {
            if (!(failure instanceof CommerceApiError && failure.code === 'order_not_payable')) setPayError(apiErrorKey(failure));
        } finally {
            setPaying(false);
            await queryClient.invalidateQueries({ queryKey });
        }
    };

    if (!token || (query.error instanceof CommerceApiError && (query.error.status === 403 || query.error.status === 404 || query.error.status === 401))) {
        return (
            <div className="cmx-shell cmx-section">
                <div className="cmx-state">
                    <h1 className="cmx-h2">{t('order.noToken.title')}</h1>
                    <p className="cmx-body">{t('order.noToken.body')}</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <ShopLink to="track-order" className="cmx-btn cmx-btn--primary">
                            {t('track.title')}
                        </ShopLink>
                        <ShopLink to="account" className="cmx-btn cmx-btn--outline">
                            {t('account.seeOrders')}
                        </ShopLink>
                    </div>
                </div>
            </div>
        );
    }
    if (query.error && !view) {
        return (
            <div className="cmx-shell cmx-section">
                <ErrorState error={query.error} onRetry={() => void query.refetch()} />
            </div>
        );
    }
    if (!view) {
        return (
            <div className="cmx-shell cmx-section" aria-busy="true">
                <p className="cmx-sr" role="status">
                    {t('common.loading')}
                </p>
                <div className="cmx-skel mb-4 h-8 w-56" aria-hidden="true" />
                <div className="cmx-skel h-40 w-full" aria-hidden="true" />
            </div>
        );
    }

    const stage = orderStage(view, Date.now(), paidAt);
    const help = whatsappLink(shop.whatsappNumber, t('order.whatsappText', { number: view.order_number }));
    return (
        <div className="cmx-shell cmx-section cmx-order">
            <p className="cmx-eyebrow">{t('order.number', { number: view.order_number })}</p>
            <h1 className="cmx-sr">{t('order.title', { number: view.order_number })}</h1>
            {view.placed_at && <p className="cmx-small cmx-muted mb-4">{t('order.placedOn', { date: formatDate(view.placed_at, locale) })}</p>}
            <OrderState view={view} pollingOver={pollingOver} onPay={stage.kind === 'pay' ? () => void pay() : undefined} paying={paying} paidAt={paidAt} />
            {payError && (
                <p className="cmx-note cmx-note--error mt-3" role="alert">
                    {t(payError)}
                </p>
            )}
            <div className="cmx-order__grid">
                <section className="cmx-panel" aria-label={t('order.items')}>
                    <OrderTimeline view={view} />
                    <OrderBody view={view} />
                </section>
                <aside className="flex flex-col gap-3">
                    {session && <ConsentToggle token={session.token} onInvalid={dropSession} />}
                    <ShopLink to="account" className="cmx-btn cmx-btn--outline cmx-btn--block">
                        {t('account.seeOrders')}
                    </ShopLink>
                    {(stage.kind === 'cancelled' || stage.kind === 'expired') && (
                        <ShopLink to="" className="cmx-btn cmx-btn--primary cmx-btn--block">
                            {t('order.shopAgain')}
                        </ShopLink>
                    )}
                    {help && (
                        <a href={help} target="_blank" rel="noopener noreferrer" className="cmx-link inline-flex min-h-11 items-center gap-2">
                            <WhatsappLogo size={18} aria-hidden="true" />
                            {t('order.help')}
                        </a>
                    )}
                </aside>
            </div>
        </div>
    );
};

/** WhatsApp offers: unticked until the shopper ticks it; stored with time and source by the server. */
export const ConsentToggle: React.FC<{ token: string; onInvalid(): void }> = ({ token, onInvalid }) => {
    const { t, client, instituteId } = useCommerceSite();
    const queryClient = useQueryClient();
    const key = ['commerce', instituteId, 'me', token];
    const me = useQuery({ queryKey: key, queryFn: ({ signal }) => client.getMe({ session: token }, signal), staleTime: 60_000, retry: false });
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const invalidSeen = useRef(false);
    useEffect(() => {
        if (me.error instanceof CommerceApiError && me.error.status === 401 && !invalidSeen.current) {
            invalidSeen.current = true;
            onInvalid();
        }
    }, [me.error, onInvalid]);
    if (!me.data) return null;
    return (
        <label className="cmx-check cmx-panel">
            <input
                type="checkbox"
                checked={!!me.data.marketing_consent}
                disabled={saving}
                onChange={async (event) => {
                    setSaving(true);
                    setFailed(false);
                    try {
                        const next = await client.setConsent({ session: token }, event.target.checked);
                        queryClient.setQueryData(key, next);
                    } catch {
                        setFailed(true);
                    } finally {
                        setSaving(false);
                    }
                }}
            />
            <span>
                {t('checkout.consent')}
                {failed && <span className="cmx-small cmx-bad block">{t('error.generic')}</span>}
            </span>
        </label>
    );
};
