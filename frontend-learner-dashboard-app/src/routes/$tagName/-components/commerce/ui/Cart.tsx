/**
 * The mini cart drawer and the cart page. The cart is held in the
 * browser; every number a shopper reads as money comes from /cart/price: line totals,
 * discounts, delivery, the amount left for free delivery, tax inside the total. While the
 * server has not answered, a line shows its remembered unit price and no total is drawn.
 */
import React, { useEffect, useRef } from 'react';
import { CheckCircle, Trash, WarningCircle, WhatsappLogo } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { CartPrice, CartPriceLine, CartUnavailableLine } from '../api/types';
import { sendCommerceEvent } from '../logic/events';
import { formatMoney, perUnitAmount, quantityText, unitLabel } from '../logic/format';
import { isMeasured } from '../logic/stock';
import type { CartLine } from '../state/cart-logic';
import { useCommerceCart } from '../state/cart-store';
import type { MessageKey } from '../i18n';
import { useOnline } from './hooks';
import { EmptyState, ErrorState, Layer, QuantityStepper } from './primitives';
import { CartRecommendations } from './CartRecommendations';
import { ProductRail } from './ProductCard';
import { useShopFlag } from './shop-flags';
import { useCartPrice, useProductRail } from './queries';
import { ShopLink, useCommerceSite, whatsappLink } from './site';

/**
 * The quantity a fix offers, on the line's step grid: what is in stock, or the most one order may
 * hold, rounded DOWN to the step (25 at a step of 10 offers 20, never 30). Null when not even
 * one step fits.
 */
const fixQuantity = (problem: CartUnavailableLine | undefined, line: Pick<CartLine, 'qtyStep'>): number | null => {
    if (!problem) return null;
    const step = Math.max(1, Math.floor(line.qtyStep || 1));
    const limit =
        typeof problem.available_quantity === 'number'
            ? problem.available_quantity
            : typeof problem.max_quantity === 'number'
              ? problem.max_quantity
              : null;
    if (limit === null || limit < step) return null;
    return Math.floor(limit / step) * step;
};

const useUnavailableText = () => {
    const { t } = useCommerceSite();
    return (problem: CartUnavailableLine, line: CartLine): string => {
        // Every number carries its unit: "Only 1.5 m available", never a bare "1.5".
        const amount = (base: number) => quantityText(base, line.qtyScale, line.unit, t);
        const count = typeof problem.available_quantity === 'number' ? amount(problem.available_quantity) : null;
        switch (problem.reason) {
            case 'INSUFFICIENT_STOCK':
                return count !== null
                    ? t('cart.unavailable.INSUFFICIENT_STOCK', { count })
                    : t('cart.unavailable.INSUFFICIENT_STOCK_PLAIN');
            case 'QUANTITY_STEP':
                return t('cart.unavailable.QUANTITY_STEP', {
                    step: amount(problem.qty_step || line.qtyStep),
                });
            case 'QUANTITY_ABOVE_MAX':
                return typeof problem.max_quantity === 'number'
                    ? t('cart.unavailable.QUANTITY_ABOVE_MAX', { max: amount(problem.max_quantity) })
                    : t('cart.unavailable.QUANTITY_INVALID');
            case 'NOT_FOUND':
            case 'NO_PRICE':
            case 'OUT_OF_STOCK':
            case 'QUANTITY_INVALID':
                return t(`cart.unavailable.${problem.reason}` as MessageKey);
            default:
                return t('cart.unavailable.generic');
        }
    };
};

const CartLineRow: React.FC<{
    line: CartLine;
    priced: CartPriceLine | undefined;
    problem: CartUnavailableLine | undefined;
    currency: string | null | undefined;
    onNavigate?: () => void;
}> = ({ line, priced, problem, currency, onNavigate }) => {
    const { t } = useCommerceSite();
    const setQuantity = useCommerceCart((s) => s.setQuantity);
    const remove = useCommerceCart((s) => s.remove);
    const unavailableText = useUnavailableText();
    const measured = isMeasured(line.qtyScale);
    // The server's line total when it has priced the line; else only the remembered unit price.
    const amount = priced ? formatMoney(priced.net ?? priced.gross, currency) : null;
    // One metre of cloth (the API prices one base unit), worked out in whole paise.
    const unitPrice = formatMoney(perUnitAmount(priced?.unit_price ?? line.unitPrice, measured ? line.qtyScale : 1), currency);
    const fixTo = fixQuantity(problem, line);
    return (
        <li className={cn('cmx-line', problem && 'cmx-line--off')}>
            <div className="cmx-img cmx-line__thumb">
                {line.imageUrl && <img src={line.imageUrl} alt="" loading="lazy" decoding="async" width={72} height={90} />}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                    <ShopLink to={`p/${line.slug}`} className="cmx-small font-medium" onClick={onNavigate}>
                        {priced?.name || line.name}
                    </ShopLink>
                    <button
                        type="button"
                        className="cmx-icon-btn -me-2 -mt-2 shrink-0"
                        onClick={() => {
                            sendCommerceEvent({
                                name: 'remove_from_cart',
                                item: { id: priced?.sku || line.variantId, name: line.name, unitPrice: priced?.unit_price ?? line.unitPrice, quantity: line.quantity, qtyScale: line.qtyScale, unit: line.unit, variant: line.variantLabel },
                                currency,
                            });
                            remove(line.variantId);
                        }}
                        aria-label={t('cart.remove', { name: line.name })}
                    >
                        <Trash size={18} aria-hidden="true" />
                    </button>
                </div>
                {(priced?.variant_label || line.variantLabel) && (
                    <p className="cmx-small cmx-muted">{priced?.variant_label || line.variantLabel}</p>
                )}
                {unitPrice && (
                    <p className="cmx-small cmx-muted">
                        {measured ? t('price.perUnit', { price: unitPrice, unit: unitLabel(t, line.unit, false) }) : unitPrice}
                    </p>
                )}
                {problem && (
                    <p className="cmx-small cmx-bad flex flex-wrap items-center gap-2" role="status">
                        <span>
                            {unavailableText(problem, line)} · {t('cart.notInTotal')}
                        </span>
                        {fixTo !== null && (
                            <button type="button" className="cmx-link" onClick={() => setQuantity(line.variantId, fixTo)}>
                                {t('cart.fix.setTo', { count: quantityText(fixTo, line.qtyScale, line.unit, t) })}
                            </button>
                        )}
                    </p>
                )}
                <div className="mt-1 flex items-center justify-between gap-2">
                    {line.piece ? (
                        <span className="cmx-badge">{t('badge.ONE_OF_ONE')}</span>
                    ) : (
                        <QuantityStepper
                            small
                            label={t('product.qty')}
                            value={line.quantity}
                            step={line.qtyStep}
                            min={line.qtyStep}
                            max={null}
                            display={quantityText(line.quantity, line.qtyScale, line.unit, t)}
                            onChange={(next) => setQuantity(line.variantId, next)}
                        />
                    )}
                    {/* Never a guessed total: only the server's number is shown as the line amount. */}
                    <span className="font-semibold tabular-nums" aria-live="polite">
                        {amount ?? ''}
                    </span>
                </div>
            </div>
        </li>
    );
};

/** The server's totals of a priced cart (cart drawer, cart page, checkout). */
export const CartTotals: React.FC<{ price: CartPrice }> = ({ price }) => {
    const { t } = useCommerceSite();
    const totals = price.totals;
    const shipping = price.shipping;
    const money = (value: number | null | undefined) => formatMoney(value, price.currency);
    if (!totals) return null;
    const discount = typeof totals.discount === 'number' && totals.discount > 0 ? money(totals.discount) : null;
    const tax = typeof price.tax?.tax_amount === 'number' && price.tax.tax_amount > 0 ? money(price.tax.tax_amount) : null;
    // CGST + SGST inside the seller's state, IGST outside it: named once the server knows the place of supply.
    const positive = (value: number | null | undefined) => (typeof value === 'number' && value > 0 ? money(value) : null);
    const [cgst, sgst, igst] = [positive(price.tax?.cgst), positive(price.tax?.sgst), positive(price.tax?.igst)];
    const split = !price.tax?.place_of_supply_known
        ? null
        : igst
          ? t('cart.taxSplit.inter', { igst })
          : cgst && sgst
            ? t('cart.taxSplit.intra', { cgst, sgst })
            : null;
    return (
        <dl className="cmx-totals" aria-label={t('cart.totalsLabel')}>
            <div>
                <dt>{t('cart.subtotal')}</dt>
                <dd>{money(totals.subtotal)}</dd>
            </div>
            {discount && (
                <div>
                    <dt>{t('cart.discount')}</dt>
                    <dd className="cmx-ok">-{discount}</dd>
                </div>
            )}
            <div>
                <dt>{t('cart.delivery')}</dt>
                <dd>{shipping?.free || !totals.shipping ? t('cart.free') : money(totals.shipping)}</dd>
            </div>
            {typeof totals.cod_charge === 'number' && totals.cod_charge > 0 && (
                <div>
                    <dt>{t('checkout.codCharge')}</dt>
                    <dd>{money(totals.cod_charge)}</dd>
                </div>
            )}
            <div className="cmx-totals__total">
                <dt>{t('cart.total')}</dt>
                <dd>{money(totals.total)}</dd>
            </div>
            <p className="cmx-small cmx-muted">{split || (tax ? t('cart.inclTax', { tax }) : t('price.inclTax'))}</p>
        </dl>
    );
};

/** True when the server's answer carries a free-delivery amount (the bar shows). */
const hasFreeBar = (price: CartPrice): boolean => typeof price.shipping?.free_above === 'number' && price.shipping.free_above > 0;

/**
 * Whether this shop's carts show the free-delivery bar, as the last price answer said (any cart,
 * any page: the drawer prices the cart after every add). Until the first answer the bar's room
 * is held, so the lines under it do not move when the price arrives; a shop without the bar
 * learns that on its first answer and holds nothing after.
 */
const useFreeBarExpected = (price: CartPrice | undefined): boolean => useShopFlag('freebar', price ? hasFreeBar(price) : undefined) !== false;

/** The bar's room while the cart is priced: the same fixed height as the bar. */
const FreeDeliveryHold: React.FC = () => (
    <div className="cmx-note cmx-freebar flex-col" aria-hidden="true" data-testid="cmx-freebar-hold">
        <span className="cmx-skel block h-4 w-2/3" />
        <span className="cmx-skel cmx-meter block w-full" />
    </div>
);

/** "Add ₹X more for free delivery", hidden when the seller sets no free-delivery amount. One line, fixed height. */
const FreeDeliveryBar: React.FC<{ price: CartPrice }> = ({ price }) => {
    const { t } = useCommerceSite();
    const shipping = price.shipping;
    if (!shipping || !hasFreeBar(price)) return null;
    const freeAbove = shipping.free_above as number;
    const remaining = typeof shipping.remaining_for_free === 'number' ? shipping.remaining_for_free : 0;
    const reached = shipping.free || remaining <= 0;
    const percent = reached ? 100 : Math.max(4, Math.min(100, Math.round((1 - remaining / freeAbove) * 100)));
    return (
        <div className="cmx-note cmx-freebar flex-col" role="status">
            <span className="cmx-freebar__text">
                {reached
                    ? t('cart.freeDelivery.reached')
                    : t('cart.freeDelivery.remaining', { amount: formatMoney(remaining, price.currency) })}
            </span>
            <span className="cmx-meter w-full" aria-hidden="true" style={{ ['--cmx-meter' as string]: String(percent) }}>
                <span />
            </span>
        </div>
    );
};

/** Lines, what changed, and the server's totals: the body shared by the drawer and the page. */
export const useCartView = (active: boolean) => {
    const cart = useCommerceCart((s) => s.cart);
    const hydrated = useCommerceCart((s) => s.hydrated);
    const { price, pending, error, refetch } = useCartPrice(active);
    return { cart, hydrated, price, pending, error, refetch };
};

export const CartLines: React.FC<{
    view: ReturnType<typeof useCartView>;
    onNavigate?: () => void;
}> = ({ view, onNavigate }) => {
    const { t } = useCommerceSite();
    const lastAdded = useCommerceCart((s) => s.lastAdded);
    const { cart, price, error, refetch } = view;
    const expectBar = useFreeBarExpected(price);
    const priced = new Map((price?.lines || []).map((l) => [l.line_ref, l]));
    const problems = new Map((price?.unavailable || []).map((l) => [l.line_ref, l]));
    const priceChanges = (price?.changes || []).filter(
        (c) => c.type === 'PRICE_CHANGED' && c.old_unit_price !== null && c.new_unit_price !== null
    );
    return (
        <div className="flex flex-col gap-3">
            {lastAdded && cart.lines.some((l) => l.variantId === lastAdded) && (
                <p className="cmx-note cmx-ok items-center" role="status">
                    <CheckCircle size={18} weight="fill" aria-hidden="true" />
                    {t('cart.added')}
                </p>
            )}
            {price ? <FreeDeliveryBar price={price} /> : expectBar && !error ? <FreeDeliveryHold /> : null}
            {priceChanges.map((change) => {
                const line = cart.lines.find((l) => l.variantId === change.line_ref);
                if (!line) return null;
                const scale = isMeasured(line.qtyScale) ? line.qtyScale : 1;
                return (
                    <p key={change.line_ref} className="cmx-note cmx-note--warn" role="status">
                        <WarningCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
                        {t('cart.change.price', {
                            name: line.name,
                            old: formatMoney((change.old_unit_price as number) * scale, price?.currency),
                            new: formatMoney((change.new_unit_price as number) * scale, price?.currency),
                        })}
                    </p>
                );
            })}
            {error && !price ? <ErrorState compact error={error} onRetry={() => void refetch()} /> : null}
            <ul className="cmx-rows">
                {cart.lines.map((line) => (
                    <CartLineRow
                        key={line.variantId}
                        line={line}
                        priced={priced.get(line.variantId)}
                        problem={problems.get(line.variantId)}
                        currency={price?.currency}
                        onNavigate={onNavigate}
                    />
                ))}
            </ul>
        </div>
    );
};

/**
 * Totals and the way forward. Checkout is a later package: until the site turns it on
 * (globalSettings.commerce.checkout), the cart offers an order over WhatsApp when the seller
 * has a number, and says that online checkout opens soon otherwise.
 */
export const CartSummary: React.FC<{ view: ReturnType<typeof useCartView>; onNavigate?: () => void; page?: boolean }> = ({
    view,
    onNavigate,
    page,
}) => {
    const { t, config, absoluteUrl } = useCommerceSite();
    const { cart, price, pending, error, refetch } = view;
    const total = formatMoney(price?.totals?.total, price?.currency);
    const orderText = [
        t('cart.whatsappText'),
        ...cart.lines.map((l) => `• ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''} × ${quantityText(l.quantity, l.qtyScale, l.unit, t)} — ${absoluteUrl(`p/${l.slug}`)}`),
    ].join('\n');
    const whatsapp = whatsappLink(config.whatsappNumber, orderText);
    const online = useOnline();
    // Checkout needs the server: with no connection the button waits instead of failing later.
    const payable = !!price && (price.lines || []).length > 0 && online;
    return (
        <div className="flex flex-col gap-3" aria-busy={pending}>
            {price ? (
                <CartTotals price={price} />
            ) : error ? null : (
                // The totals' own rows and words with the amounts still to come, so the box keeps its height.
                <dl className="cmx-totals" aria-hidden="true">
                    {[t('cart.subtotal'), t('cart.delivery')].map((label) => (
                        <div key={label}>
                            <dt>{label}</dt>
                            <dd>
                                <span className="cmx-skel inline-block h-4 w-16 align-middle" />
                            </dd>
                        </div>
                    ))}
                    <div className="cmx-totals__total">
                        <dt>{t('cart.total')}</dt>
                        <dd>
                            <span className="cmx-skel inline-block h-5 w-20 align-middle" />
                        </dd>
                    </div>
                    <p className="cmx-small cmx-muted">{t('price.inclTax')}</p>
                </dl>
            )}
            {/* Said, not drawn: a line that comes and goes with every re-price would move the button. */}
            <p className="cmx-sr" role="status">
                {pending ? t('cart.pricing') : ''}
            </p>
            {error && price ? (
                <p className="cmx-small cmx-bad" role="alert">
                    {t('cart.priceError')}{' '}
                    <button type="button" className="cmx-link" onClick={() => void refetch()}>
                        {t('common.retry')}
                    </button>
                </p>
            ) : null}
            {!online && (
                <p className="cmx-note" role="status">
                    {t('cart.offline')}
                </p>
            )}
            {config.checkout ? (
                <ShopLink
                    to="checkout"
                    className="cmx-btn cmx-btn--primary cmx-btn--lg cmx-btn--block"
                    aria-disabled={!payable || pending}
                    onClick={(event) => {
                        if (!payable || pending) event.preventDefault();
                        else onNavigate?.();
                    }}
                >
                    {total ? t('cart.checkout', { total }) : t('cart.pricing')}
                </ShopLink>
            ) : whatsapp ? (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="cmx-btn cmx-btn--primary cmx-btn--lg cmx-btn--block">
                    <WhatsappLogo size={20} aria-hidden="true" />
                    {t('cart.orderWhatsapp')}
                </a>
            ) : (
                <p className="cmx-note">{t('cart.checkoutSoon')}</p>
            )}
            {!page && (
                <ShopLink to="cart" className="cmx-btn cmx-btn--ghost cmx-btn--block" onClick={onNavigate}>
                    {t('cart.viewCart')}
                </ShopLink>
            )}
        </div>
    );
};

/** Something to buy on an empty cart page: the newest products in stock. */
const EmptyCartRail: React.FC = () => {
    const { t } = useCommerceSite();
    const { data, isPending } = useProductRail({ sort: 'newest', inStock: true, pageSize: 4 });
    const products = data?.data || [];
    if (isPending) {
        // The rail's room is held while it loads, so the footer does not jump down when it arrives.
        return (
            <section className="cmx-section" aria-hidden="true">
                <div className="cmx-head">
                    <div className="cmx-skel h-7 w-40" />
                </div>
                <ul className="cmx-rail">
                    {Array.from({ length: 4 }, (_, i) => (
                        <li key={i} className="cmx-card">
                            <div className="cmx-img cmx-skel" />
                            <div className="cmx-card__body">
                                <div className="cmx-skel h-4 w-11/12" />
                                <div className="cmx-skel h-5 w-1/3" />
                                <div className="cmx-skel cmx-card__quick h-11 w-full" />
                            </div>
                        </li>
                    ))}
                </ul>
            </section>
        );
    }
    if (products.length === 0) return null;
    return (
        <section className="cmx-section" aria-labelledby="cmx-cart-rail">
            <div className="cmx-head">
                <h2 className="cmx-h2" id="cmx-cart-rail">
                    {t('cart.empty.rail')}
                </h2>
            </div>
            <ProductRail products={products} listId="cart-empty" />
        </section>
    );
};

export const CartEmpty: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
    const { t } = useCommerceSite();
    return (
        <EmptyState title={t('cart.empty.title')} body={t('cart.empty.body')}>
            <ShopLink to="" className="cmx-btn cmx-btn--primary" onClick={onNavigate}>
                {t('cart.continue')}
            </ShopLink>
        </EmptyState>
    );
};

/** view_cart once per opening, with the server's total, when the cart has been priced. */
const useViewCartEvent = (view: ReturnType<typeof useCartView>, shown: boolean): void => {
    const sent = useRef(false);
    const { cart, price } = view;
    useEffect(() => {
        if (!shown) {
            sent.current = false;
            return;
        }
        if (sent.current || !price || cart.lines.length === 0) return;
        sent.current = true;
        sendCommerceEvent({
            name: 'view_cart',
            items: cart.lines.map((l) => ({ id: l.variantId, name: l.name, unitPrice: l.unitPrice, quantity: l.quantity, qtyScale: l.qtyScale, unit: l.unit, variant: l.variantLabel })),
            value: price.totals?.total,
            currency: price.currency,
        });
    }, [shown, price, cart.lines]);
};

/** commerceCartDrawer: opened by the header's cart button and after every "Add to cart". */
export const CartDrawer: React.FC = () => {
    const { t } = useCommerceSite();
    const open = useCommerceCart((s) => s.drawerOpen);
    const close = useCommerceCart((s) => s.closeDrawer);
    const view = useCartView(open);
    useViewCartEvent(view, open);
    const empty = view.cart.lines.length === 0;
    return (
        <Layer
            open={open}
            onClose={close}
            side="right"
            title={t('cart.title')}
            footer={empty ? undefined : <CartSummary view={view} onNavigate={close} />}
        >
            <div className="cmx-layer__body">
                {empty ? (
                    <CartEmpty onNavigate={close} />
                ) : (
                    <>
                        <CartLines view={view} onNavigate={close} />
                        <CartRecommendations variant="drawer" onNavigate={close} />
                    </>
                )}
            </div>
        </Layer>
    );
};

/** The `cart` template: the same cart on a page of its own. */
export const CartPage: React.FC = () => {
    const { t } = useCommerceSite();
    const view = useCartView(true);
    useViewCartEvent(view, true);
    const count = view.cart.lines.length;
    return (
        <div className="cmx-shell cmx-section">
            <h1 className="cmx-h1 mb-6">{t('cart.title')}</h1>
            {!view.hydrated ? null : count === 0 ? (
                <>
                    <CartEmpty />
                    <EmptyCartRail />
                </>
            ) : (
                <div className="cmx-cartpage">
                    <section aria-label={t('cart.lines', { count })}>
                        <CartLines view={view} />
                    </section>
                    <aside className="cmx-panel">
                        <CartSummary view={view} page />
                    </aside>
                </div>
            )}
            {view.hydrated && count > 0 && <CartRecommendations variant="page" />}
        </div>
    );
};
