/**
 * The `product` template: gallery, title and price, badges, origin,
 * option picker, length picker for goods sold by length, buy box, pincode check, reassurance
 * rows, content-block accordions, "pairs well with", and the sticky buy bar on a phone.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useRouter } from '@tanstack/react-router';
import {
    ArrowCounterClockwise,
    CaretDown,
    CaretLeft,
    CheckCircle,
    HandHeart,
    MapPin,
    ShieldCheck,
    Truck,
    WhatsappLogo,
    type Icon,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { sanitizeCustomHtml } from '../../../-utils/catalogue-html';
import { readSearchParam, withSearchParams } from '../../../-utils/catalogue-url-state';
import type { Price, ProductDetail, Stock, Variant } from '../api/types';
import { COMMERCE_STALE_MS } from '../api/client';
import type { CommerceReassuranceItem } from '../config';
import { formatMoney, formatUnits, lineAmount, perUnitAmount, quantityText, unitLabel } from '../logic/format';
import { IMAGE_SIZES, orderGallery, ratioClass, thumbUrl } from '../logic/media';
import { leadImageUrl, productHead } from '../edge/commerce-edge';
import { sendCommerceEvent } from '../logic/events';
import { activeVariant, initialSelection, selectValue, type Selection } from '../logic/options';
import { clampQuantity, isMeasured, lengthChoices, quantityRules, stockView, type QuantityRules } from '../logic/stock';
import { hasMessage } from '../i18n';
import { apiPathTo } from '../routes';
import { useCommerceCart } from '../state/cart-store';
import { Gallery } from './Gallery';
import { ShopHead, useEdgePage } from './Head';
import { OptionPicker } from './Options';
import { EmptyState, ErrorState, Layer, PriceText, ProductImage, QuantityStepper, isNotFound, shouldRetry } from './primitives';
import { ProductRail } from './ProductCard';
import { useProduct, useProductRail } from './queries';
import { ShopLink, useCommerceSite, whatsappLink } from './site';

/* ── stock line ───────────────────────────────────────────────────── */

const StockLine: React.FC<{
    stock: Stock | null | undefined;
    product: ProductDetail;
    /** Less is left than the smallest amount sold (0.4 m of a cloth cut in steps of 0.5 m). */
    soldOut?: boolean;
}> = ({ stock, product, soldOut }) => {
    const { t } = useCommerceSite();
    const view = stockView(stock);
    const measured = isMeasured(product.qty_scale);
    let text = '';
    let tone = 'cmx-ok';
    if (view.kind === 'out' || soldOut) {
        text = t('product.stock.out');
        tone = 'cmx-bad';
    } else if (view.kind === 'single') {
        text = t('product.stock.single');
        tone = '';
    } else if (view.kind === 'low' && view.left !== null) {
        text = measured
            ? t('product.stock.lowMeasured', { count: quantityText(view.left, product.qty_scale, product.unit, t) })
            : t('product.stock.low', { count: formatUnits(view.left, product.qty_scale) });
        tone = '';
    } else if (view.kind === 'made_to_order') {
        text = view.leadTimeDays ? t('product.stock.mtoDays', { days: view.leadTimeDays }) : t('product.stock.mto');
        tone = '';
    } else if (view.kind === 'in' || view.kind === 'low') {
        text = t('product.stock.in');
    }
    if (!text) return null;
    return (
        <p className={cn('cmx-small font-medium', tone)} role="status">
            {text}
        </p>
    );
};

/* ── length picker (goods sold by length) ─────────────────────────── */

const LengthPicker: React.FC<{
    product: ProductDetail;
    price: Price | null | undefined;
    rules: QuantityRules;
    quantity: number;
    onChange(quantity: number): void;
}> = ({ product, price, rules, quantity, onChange }) => {
    const { t, config } = useCommerceSite();
    const scale = Math.max(1, product.qty_scale);
    const unitShort = unitLabel(t, product.unit, true);
    const presets = useMemo(() => lengthChoices(config.lengthPresets, scale, rules), [config.lengthPresets, scale, rules]);
    const presetKey = presets.map((p) => p.quantity).join(',');
    const isPreset = presets.some((p) => p.quantity === quantity);
    const [custom, setCustom] = useState(!isPreset && presets.length > 0);
    // The "other length" box follows the quantity: a new variant that starts at a length no chip
    // offers opens the box, a typed length that is a preset presses its chip. Keyed on the preset
    // numbers, so a background refetch does not close a box the shopper just opened.
    useEffect(() => {
        setCustom(!isPreset && presets.length > 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quantity, presetKey]);
    const [text, setText] = useState(formatUnits(quantity, scale));
    const [notice, setNotice] = useState<string | null>(null);
    const inputId = useId();
    useEffect(() => setText(formatUnits(quantity, scale)), [quantity, scale]);
    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), 4000);
        return () => clearTimeout(timer);
    }, [notice]);
    const perUnit = formatMoney(perUnitAmount(price?.amount, scale), price?.currency);
    const lengthText = (base: number) => quantityText(base, scale, product.unit, t);
    /** The typed text in base units; null when it is not a positive number. */
    const typedBase = (value: string): number | null => {
        const trimmed = value.trim().replace(',', '.');
        const units = trimmed === '' ? Number.NaN : Number(trimmed);
        return Number.isFinite(units) && units > 0 ? units * scale : null;
    };
    const commit = () => {
        const wanted = typedBase(text);
        const next = clampQuantity(wanted ?? rules.step, rules);
        onChange(next);
        setText(formatUnits(next, scale));
        // A length moved onto the step or under the stock limit is said, never changed silently.
        if (wanted === null || Math.abs(wanted - next) > 1e-6) setNotice(t('product.length.changed', { length: lengthText(next) }));
    };
    // The price under the box is for the length typed when it can be bought as typed, else for
    // the length that will be added.
    const typed = typedBase(text);
    const typedOk =
        typed !== null &&
        Math.abs(typed - Math.round(typed)) < 1e-6 &&
        Math.round(typed) % rules.step === 0 &&
        (rules.max === null || typed <= rules.max);
    const priced = typedOk ? Math.round(typed as number) : quantity;
    const pricedAmount = formatMoney(lineAmount(price?.amount, priced), price?.currency);
    return (
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="cmx-option__label">
                {t('product.length.title')}
                {perUnit && <> · {t('price.perUnit', { price: perUnit, unit: unitLabel(t, product.unit) })}</>}
            </legend>
            {presets.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {presets.map((preset) => {
                        const amount = formatMoney(lineAmount(price?.amount, preset.quantity), price?.currency);
                        return (
                            <button
                                key={preset.quantity}
                                type="button"
                                className="cmx-chip h-auto flex-col items-start gap-0 py-2"
                                aria-pressed={!custom && quantity === preset.quantity}
                                onClick={() => {
                                    setCustom(false);
                                    onChange(preset.quantity);
                                }}
                            >
                                <span>
                                    {formatUnits(preset.quantity, scale)} {unitShort}
                                </span>
                                {amount && <span className="cmx-small cmx-muted tabular-nums">{amount}</span>}
                            </button>
                        );
                    })}
                    <button type="button" className="cmx-chip" aria-pressed={custom} onClick={() => setCustom(true)}>
                        {t('product.length.custom')}
                    </button>
                </div>
            )}
            {(custom || presets.length === 0) && (
                <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={inputId} className="cmx-sr">
                        {t('product.length.customLabel', { unit: unitLabel(t, product.unit) })}
                    </label>
                    <input
                        id={inputId}
                        className="cmx-input w-28"
                        type="number"
                        inputMode="decimal"
                        min={rules.step / scale}
                        max={rules.max !== null ? rules.max / scale : undefined}
                        step={rules.step / scale}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => e.key === 'Enter' && commit()}
                    />
                    <span>{unitShort}</span>
                    <span className="cmx-small cmx-muted">
                        {t('product.length.step', { step: formatUnits(rules.step, scale), unit: unitShort })}
                    </span>
                    {pricedAmount && (
                        <p className="cmx-small m-0 basis-full tabular-nums" data-testid="cmx-length-total">
                            {t('product.length.total', { length: lengthText(priced), price: pricedAmount })}
                        </p>
                    )}
                </div>
            )}
            {notice && (
                <p className="cmx-small m-0 font-medium" role="status">
                    {notice}
                </p>
            )}
        </fieldset>
    );
};

/* ── pincode check ────────────────────────────────────────────────── */

const PincodeCheck: React.FC = () => {
    const { t, client, instituteId, locale } = useCommerceSite();
    const saved = useCommerceCart((s) => s.cart.pincode);
    const savePincode = useCommerceCart((s) => s.setPincode);
    const [text, setText] = useState(saved || '');
    const [pin, setPin] = useState<string | null>(saved);
    const [invalid, setInvalid] = useState(false);
    const inputId = useId();
    const errorId = `${inputId}-error`;
    const query = useQuery({
        queryKey: ['commerce', instituteId, locale, 'pincode', pin],
        queryFn: ({ signal }) => client.getPincode(pin as string, signal),
        enabled: !!pin,
        staleTime: COMMERCE_STALE_MS,
        retry: shouldRetry,
    });
    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const value = text.replace(/\s/g, '');
        if (!/^[1-9]\d{5}$/.test(value)) {
            setInvalid(true);
            setPin(null);
            return;
        }
        setInvalid(false);
        setPin(value);
        // The cart prices delivery and tax for the same pincode from now on.
        savePincode(value);
    };
    const info = query.data;
    const place = info ? [info.city, info.state_name].filter(Boolean).join(', ') : '';
    return (
        <section aria-label={t('product.pincode.title')} className="flex flex-col gap-2">
            <form className="flex items-end gap-2" onSubmit={submit} noValidate>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label htmlFor={inputId} className="cmx-option__label mb-0 flex items-center gap-1">
                        <MapPin size={16} aria-hidden="true" />
                        {t('product.pincode.title')}
                    </label>
                    <input
                        id={inputId}
                        className="cmx-input"
                        inputMode="numeric"
                        autoComplete="postal-code"
                        pattern="[1-9][0-9]{5}"
                        maxLength={6}
                        placeholder={t('product.pincode.placeholder')}
                        value={text}
                        onChange={(e) => {
                            setText(e.target.value.replace(/\D/g, '').slice(0, 6));
                            setInvalid(false);
                        }}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? errorId : undefined}
                    />
                </div>
                <button type="submit" className="cmx-btn cmx-btn--outline" disabled={query.isFetching}>
                    {query.isFetching ? t('product.pincode.checking') : t('product.pincode.check')}
                </button>
            </form>
            {invalid && (
                <p id={errorId} className="cmx-small cmx-bad" role="alert">
                    {t('product.pincode.invalid')}
                </p>
            )}
            {query.isError && !invalid && <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />}
            {info && !invalid && (
                <ul className="cmx-small flex list-none flex-col gap-1 p-0" role="status">
                    <li className="flex items-center gap-2">
                        <Truck size={16} aria-hidden="true" />
                        {place ? t('product.pincode.deliversTo', { place }) : t('product.pincode.deliversToPin', { pin: info.pincode })}
                    </li>
                    {/* A shop that does not offer COD at all says nothing about it; only a pincode COD cannot reach is named. */}
                    {info.cod_allowed ? (
                        <li className="flex items-center gap-2">
                            <CheckCircle size={16} aria-hidden="true" className="cmx-ok" />
                            {t('product.pincode.codYes')}
                        </li>
                    ) : (info.cod_reason || '').toUpperCase() !== 'COD_DISABLED' ? (
                        <li className="cmx-muted">{t('product.pincode.codNo')}</li>
                    ) : null}
                    {info.dispatch_promise && <li className="cmx-muted">{info.dispatch_promise}</li>}
                </ul>
            )}
        </section>
    );
};

/* ── reassurance ──────────────────────────────────────────────────── */

/** Icons a reassurance or trust item can name (globalSettings.commerce.reassurance[].icon). */
const REASSURANCE_ICONS: Record<string, Icon> = {
    truck: Truck,
    delivery: Truck,
    shipping: Truck,
    returns: ArrowCounterClockwise,
    return: ArrowCounterClockwise,
    exchange: ArrowCounterClockwise,
    secure: ShieldCheck,
    shield: ShieldCheck,
    payment: ShieldCheck,
    handmade: HandHeart,
    hand: HandHeart,
    craft: HandHeart,
    whatsapp: WhatsappLogo,
    support: WhatsappLogo,
    location: MapPin,
    origin: MapPin,
};

export const ReassuranceRows: React.FC<{ items: readonly CommerceReassuranceItem[]; variant?: 'rows' | 'strip' }> = ({
    items,
    variant = 'rows',
}) => {
    const { t, siteT } = useCommerceSite();
    const [open, setOpen] = useState<CommerceReassuranceItem | null>(null);
    if (items.length === 0) return null;
    return (
        <>
            <ul className={variant === 'strip' ? 'cmx-trust' : 'cmx-rows'}>
                {items.map((item) => {
                    const hasSheet = !!item.text || !!item.route;
                    const ItemIcon = REASSURANCE_ICONS[item.icon.toLowerCase()] || CheckCircle;
                    const body = (
                        <>
                            <ItemIcon size={variant === 'strip' ? 24 : 20} aria-hidden="true" className="shrink-0" />
                            <span className="flex-1">{siteT(item.label)}</span>
                        </>
                    );
                    return (
                        <li key={item.label}>
                            {hasSheet ? (
                                <button type="button" className={variant === 'strip' ? 'cmx-trust__item' : 'cmx-reassure'} onClick={() => setOpen(item)} aria-haspopup="dialog">
                                    {body}
                                </button>
                            ) : (
                                <span className={variant === 'strip' ? 'cmx-trust__item cursor-default' : 'cmx-reassure cursor-default'}>{body}</span>
                            )}
                        </li>
                    );
                })}
            </ul>
            <Layer open={!!open} onClose={() => setOpen(null)} side="bottom" title={open ? siteT(open.label) : ''}>
                <div className="cmx-layer__body flex flex-col gap-4">
                    {open?.text && <p className="cmx-body whitespace-pre-line">{siteT(open.text)}</p>}
                    {open?.route && (
                        <ShopLink to={open.route} className="cmx-link" onClick={() => setOpen(null)}>
                            {t('trust.more')}
                        </ShopLink>
                    )}
                </div>
            </Layer>
        </>
    );
};

/* ── accordions ───────────────────────────────────────────────────── */

const titleCase = (code: string) => code.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Seller HTML (description and content blocks). The server sanitises it on output; it is
 * sanitised again here before it reaches the DOM (no script, style, iframe or event handler).
 */
const SafeHtml: React.FC<{ html: string }> = ({ html }) => {
    const clean = useMemo(() => sanitizeCustomHtml(html), [html]);
    return <div className="cmx-prose" dangerouslySetInnerHTML={{ __html: clean }} />;
};

const Accordions: React.FC<{ product: ProductDetail; variant: Variant | null }> = ({ product, variant }) => {
    const { t, siteT } = useCommerceSite();
    const blocks = (product.content_blocks || []).filter((b) => !!b && !!b.html && b.html.trim());
    const specs = (product.specs || []).filter((s) => (s.values || []).length > 0);
    const dims = variant && [variant.length_mm, variant.width_mm, variant.height_mm].every((n) => typeof n === 'number' && n > 0)
        ? `${(variant.length_mm as number) / 10} × ${(variant.width_mm as number) / 10} × ${(variant.height_mm as number) / 10} ${t('unit.CM.short')}`
        : null;
    const weight = variant && typeof variant.weight_grams === 'number' && variant.weight_grams > 0
        ? variant.weight_grams >= 1000 ? `${variant.weight_grams / 1000} ${t('unit.KG.short')}` : `${variant.weight_grams} ${t('unit.G.short')}`
        : null;
    const panels: Array<{ key: string; title: string; body: React.ReactNode }> = [];
    if (product.description_html && product.description_html.trim()) {
        panels.push({ key: 'description', title: t('product.block.description'), body: <SafeHtml html={product.description_html} /> });
    }
    for (const block of blocks) {
        const key = `product.block.${block.code}`;
        // A block the shop names itself: its code as a title, through the site dictionary.
        panels.push({ key: block.code, title: hasMessage(key) ? t(key) : siteT(titleCase(block.code)), body: <SafeHtml html={block.html as string} /> });
    }
    if (specs.length > 0 || dims || weight || variant?.sku) {
        panels.push({
            key: 'specs',
            title: t('product.block.specs'),
            body: (
                <table className="cmx-specs">
                    <tbody>
                        {specs.map((spec) => (
                            <tr key={spec.code}>
                                <th scope="row">{spec.name || titleCase(spec.code)}</th>
                                <td>{(spec.values || []).join(', ')}</td>
                            </tr>
                        ))}
                        {weight && (
                            <tr>
                                <th scope="row">{t('product.spec.weight')}</th>
                                <td>{weight}</td>
                            </tr>
                        )}
                        {dims && (
                            <tr>
                                <th scope="row">{t('product.spec.dimensions')}</th>
                                <td>{dims}</td>
                            </tr>
                        )}
                        {variant?.sku && (
                            <tr>
                                <th scope="row">{t('product.spec.sku')}</th>
                                <td>{variant.sku}</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            ),
        });
    }
    if (panels.length === 0) return null;
    return (
        <ul className="cmx-rows">
            {panels.map((panel, index) => (
                <li key={panel.key}>
                    <details className="cmx-acc" open={index === 0}>
                        <summary>
                            <h2 className="cmx-h3">{panel.title}</h2>
                            <CaretDown size={16} className="cmx-caret" aria-hidden="true" />
                        </summary>
                        <div className="cmx-acc__body">{panel.body}</div>
                    </details>
                </li>
            ))}
        </ul>
    );
};

/* ── related ──────────────────────────────────────────────────────── */

const Related: React.FC<{ product: ProductDetail }> = ({ product }) => {
    const { t } = useCommerceSite();
    const category = (product.collections || []).find((c) => (c.kind || '').toUpperCase() === 'CATEGORY') || (product.collections || [])[0];
    const { data } = useProductRail({ collection: category?.slug, inStock: true, pageSize: 5 }, !!category);
    const products = (data?.data || []).filter((p) => p.id !== product.id).slice(0, 4);
    if (products.length === 0) return null;
    return (
        <section className="cmx-section" aria-labelledby="cmx-related">
            <div className="cmx-head">
                <h2 className="cmx-h2" id="cmx-related">
                    {t('product.related')}
                </h2>
            </div>
            <ProductRail products={products} showQuickAdd={false} listId="related" />
        </section>
    );
};

/* ── template ─────────────────────────────────────────────────────── */

/** The picture a share card shows: the lead-tag photo, else the first. */
const shareImage = (product: ProductDetail, leadTag: string): string => leadImageUrl(product.media, leadTag);

const ProductSkeleton: React.FC = () => {
    const { config, t } = useCommerceSite();
    return (
        <div className={cn('cmx-pdp', ratioClass(config.theme.imageRatio))} aria-busy="true">
            <p className="cmx-sr" role="status">
                {t('common.loading')}
            </p>
            <div className="cmx-gallery__stage">
                <div className="cmx-img cmx-skel" />
            </div>
            <div className="cmx-pdp__info" aria-hidden="true">
                <div className="cmx-skel h-9 w-4/5" />
                <div className="cmx-skel h-7 w-1/3" />
                <div className="cmx-skel h-12 w-full" />
                <div className="cmx-skel h-14 w-full" />
                <div className="cmx-skel h-32 w-full" />
            </div>
        </div>
    );
};

/**
 * The product's short description under the buy area: two lines and "Read more", so a long
 * spec list never pushes the price and the button below the first screen.
 */
const ShortDescription: React.FC<{ text: string }> = ({ text }) => {
    const { t } = useCommerceSite();
    const [open, setOpen] = useState(false);
    const long = text.length > 90 || text.includes('\n');
    return (
        <div className="cmx-pdp__summary">
            <p className={cn('cmx-body m-0', long && !open && 'cmx-clamp cmx-clamp--2')}>{text}</p>
            {long && (
                <button type="button" className="cmx-link cmx-small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                    {open ? t('listing.readLess') : t('listing.readMore')}
                </button>
            )}
        </div>
    );
};

export const ProductTemplate: React.FC<{
    slug: string;
    sections: readonly string[];
    /** The site's category bar is in the header: the back link is left to it on phones and tablets. */
    categoryBar?: boolean;
}> = ({ slug, sections, categoryBar = false }) => {
    const { t, config, absoluteUrl, siteT } = useCommerceSite();
    const query = useProduct(slug);
    const product = query.data;
    const router = useRouter();
    const searchStr = useLocation({ select: (l) => l.searchStr || '' });
    const wanted = readSearchParam(searchStr, 'v');
    const add = useCommerceCart((s) => s.add);
    const openDrawer = useCommerceCart((s) => s.openDrawer);

    const options = useMemo(() => product?.options || [], [product]);
    const variants = useMemo(() => [...(product?.variants || [])].sort((a, b) => a.position - b.position), [product]);
    const [selection, setSelection] = useState<Selection>({});
    // The picked variant follows the product and ?v=<sku> (a shared or redirected link).
    useEffect(() => {
        if (product) setSelection(initialSelection(options, variants, wanted));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product?.id, wanted]);

    const variant = product ? activeVariant(options, variants, selection) : null;
    const price = variant?.price ?? product?.price;
    const stock = variant ? variant.stock : product?.stock;
    const view = stockView(stock);
    const scale = Math.max(1, product?.qty_scale || 1);
    const measured = isMeasured(scale);
    const rules = useMemo(() => quantityRules(product?.qty_step || 1, stock), [product?.qty_step, stock]);
    const piece = (product?.stock_mode || '').toUpperCase() === 'PIECE' || view.kind === 'single';
    const [quantity, setQuantity] = useState(1);
    // A new variant starts at the smallest quantity (one unit of length for cloth, when the step allows).
    // Keyed on the numbers, not on the rules object: a background refetch of the same product
    // must not throw away the quantity the shopper chose.
    // Less left than one step: nothing can be bought, the quantity is 0 and the button is off.
    const soldOut = view.kind === 'out' || rules.max === 0;
    useEffect(() => {
        if (rules.max === 0) {
            setQuantity(0);
            return;
        }
        const start = measured && scale % rules.step === 0 ? scale : rules.step;
        setQuantity(clampQuantity(start, rules));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [variant?.id, measured, scale, rules.step, rules.max]);

    const gallery = useMemo(
        () => orderGallery(product?.media || [], config.media.leadTag, options.length > 0 ? variant?.id : null),
        [product, config.media.leadTag, options.length, variant?.id]
    );

    // The sticky bar appears once the buy box has left the viewport.
    const buyRef = useRef<HTMLDivElement>(null);
    const [sticky, setSticky] = useState(false);
    useEffect(() => {
        const node = buyRef.current;
        if (!node || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(([entry]) => setSticky(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0));
        observer.observe(node);
        return () => observer.disconnect();
    }, [product?.id]);

    // While hidden the bar is out of the tab order and of the accessibility tree.
    const stickyRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        stickyRef.current?.toggleAttribute('inert', !sticky);
    });
    // The bar is fixed to the bottom of a phone: the page grows by its height, so the end of
    // the footer (legal name, grievance officer) can still be scrolled into view.
    const hasStickyBar = !!product && sections.includes('stickyBar');
    useEffect(() => {
        if (!hasStickyBar) return;
        document.documentElement.classList.add('cmx-has-stickybar');
        return () => document.documentElement.classList.remove('cmx-has-stickybar');
    }, [hasStickyBar]);

    const categoryRef = (product?.collections || []).find((c) => (c.kind || '').toUpperCase() === 'CATEGORY');
    const eventItem = (v: Variant | null, base: number, p: Price | null | undefined) => ({
        id: v?.sku || v?.id || product?.id || slug,
        name: product?.name || slug,
        unitPrice: p?.amount,
        quantity: base,
        qtyScale: scale,
        unit: product?.unit,
        variant: v?.label,
        category: categoryRef?.name,
    });
    // Once per product, not per variant or refetch.
    useEffect(() => {
        if (!product) return;
        sendCommerceEvent({ name: 'view_item', item: eventItem(null, scale, product.price), currency: product.price?.currency });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product?.id]);

    const leadImage = product ? shareImage(product, config.media.leadTag) : '';
    const edgePage = useEdgePage(`p/${slug}`, leadImage);
    const head = useMemo(() => (product ? productHead(edgePage, product) : null), [edgePage, product]);

    if (query.isPending) {
        return (
            <div className="cmx-shell">
                <ProductSkeleton />
            </div>
        );
    }
    if (query.isError || !product) {
        return isNotFound(query.error) ? (
            <>
                <ShopHead title={t('product.notFound.title')} noindex />
                <EmptyState title={t('product.notFound.title')} body={t('product.notFound.body')}>
                    <ShopLink to="" className="cmx-btn cmx-btn--primary">
                        {t('product.browse')}
                    </ShopLink>
                </EmptyState>
            </>
        ) : (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        );
    }

    const has = (section: string) => sections.includes(section);
    const category = (product.collections || []).find((c) => (c.kind || '').toUpperCase() === 'CATEGORY');
    const canBuy = !!variant && view.purchasable && !soldOut && quantity > 0 && typeof price?.amount === 'number';
    // Nothing to buy, no amount: a price is never drawn as zero.
    const total = soldOut ? null : formatMoney(lineAmount(price?.amount, measured ? quantity : 1), price?.currency);
    const whatsapp = whatsappLink(config.whatsappNumber, t('product.whatsappText', { name: product.name, url: absoluteUrl(`p/${product.slug}`) }));
    const badges = (product.badges || []).filter((code) => code !== 'ONLY_N_LEFT' && hasMessage(`badge.${code}`));

    const select = (optionCode: string, valueCode: string) => {
        const next = selectValue(options, variants, selection, optionCode, valueCode);
        setSelection(next);
        // Keep ?v=<sku> in step, so a copied address opens on the same variant.
        const picked = activeVariant(options, variants, next);
        const location = router.history.location;
        const search = withSearchParams(location.search || '', { v: picked?.sku || null });
        router.history.replace(`${location.pathname}${search}${location.hash || ''}`);
    };

    const addToCart = () => {
        if (!variant || !canBuy) return;
        const outcome = add({
            variantId: variant.id,
            slug: product.slug,
            name: product.name,
            variantLabel: variant.label,
            imageUrl: thumbUrl(variant.image || gallery[0] || null),
            quantity,
            qtyScale: scale,
            qtyStep: rules.step,
            unit: product.unit,
            piece,
            unitPrice: price?.amount ?? null,
        });
        if (outcome === 'full') {
            toast.error(t('product.cartFull'));
            return;
        }
        sendCommerceEvent({ name: 'add_to_cart', item: eventItem(variant, quantity, price), currency: price?.currency });
        openDrawer();
    };

    const buyButton = (compact?: boolean) => (
        <button
            type="button"
            className={cn('cmx-btn cmx-btn--primary cmx-btn--lg', !compact && 'cmx-btn--block', compact && 'flex-1')}
            onClick={addToCart}
            disabled={!canBuy}
        >
            {/* The bar already shows the amount beside the button: no second copy inside it. */}
            {soldOut ? t('product.stock.out') : measured && total && !compact ? t('product.addToCartPrice', { price: total }) : t('product.addToCart')}
        </button>
    );

    return (
        <div className={cn('cmx-shell', ratioClass(config.theme.imageRatio))}>
            <ShopHead
                title={product.seo?.title || product.name}
                description={product.seo?.description || undefined}
                canonical={absoluteUrl(`p/${product.slug}`)}
                head={head}
            />
            {/* With the site's category bar on, a phone gets the compact layout: the price and the
                button on the first screen (theme/commerce.css .cmx-pdp--compact). */}
            <article className={cn('cmx-pdp', categoryBar && 'cmx-pdp--compact')}>
                <div className="cmx-pdp__media">
                    {has('gallery') && <Gallery media={gallery} name={product.name} resetKey={`${product.id}:${options.length > 0 ? variant?.id || '' : ''}`} />}
                </div>
                <div className="cmx-pdp__info">
                    {has('backLink') && category && (
                        <ShopLink
                            to={apiPathTo(category.path) || `c/${category.slug}`}
                            className={cn('cmx-small cmx-muted cmx-tap items-center gap-1 self-start', categoryBar ? 'hidden lg:inline-flex' : 'inline-flex')}
                        >
                            <CaretLeft size={14} aria-hidden="true" />
                            {category.name ? t('product.back', { name: category.name }) : t('common.back')}
                        </ShopLink>
                    )}
                    {has('title') && (
                        <header className="flex flex-col gap-2">
                            <h1 className="cmx-h1">{product.name}</h1>
                            {/* Cloth is priced per metre here; the length picker below shows the amount for a length. */}
                            <div className="cmx-pdp__price flex flex-col gap-2">
                                <PriceText
                                    price={price ? { ...price, from: !variant && !!price.from } : price}
                                    scale={scale}
                                    unit={product.unit}
                                    large
                                    showOff
                                />
                                <p className="cmx-small cmx-muted">{t('price.inclTax')}</p>
                            </div>
                        </header>
                    )}
                    {has('badges') && (badges.length > 0 || view.kind !== 'unknown') && (
                        <div className="flex flex-wrap items-center gap-2">
                            {badges.map((code) => (
                                <span key={code} className="cmx-badge">
                                    {hasMessage(`badge.${code}`) ? t(`badge.${code}` as 'badge.NEW') : code}
                                </span>
                            ))}
                            <StockLine stock={stock} product={product} soldOut={soldOut} />
                        </div>
                    )}
                    {has('provenance') && product.origin && (
                        <p className="cmx-small flex items-center gap-2">
                            <MapPin size={16} aria-hidden="true" />
                            {t('product.origin', { place: product.origin })}
                        </p>
                    )}
                    {has('options') && options.length > 0 && <OptionPicker options={options} variants={variants} selection={selection} onSelect={select} />}
                    {has('length') && measured && view.purchasable && !soldOut && (
                        <LengthPicker product={product} price={price} rules={rules} quantity={quantity} onChange={setQuantity} />
                    )}
                    {has('buyBox') && (
                        <div ref={buyRef} className="flex flex-col gap-3">
                            {!measured && !piece && view.purchasable && !soldOut && (
                                <div className="flex items-center gap-3">
                                    <span className="cmx-option__label mb-0">{t('product.qty')}</span>
                                    <QuantityStepper
                                        label={t('product.qty')}
                                        value={quantity}
                                        step={rules.step}
                                        min={rules.step}
                                        max={rules.max}
                                        display={String(quantity)}
                                        onChange={(next) => setQuantity(clampQuantity(next, rules))}
                                    />
                                </div>
                            )}
                            {buyButton()}
                            {whatsapp && (
                                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={cn('cmx-btn cmx-btn--lg cmx-btn--block', soldOut ? 'cmx-btn--primary' : 'cmx-btn--outline')}>
                                    <WhatsappLogo size={20} aria-hidden="true" />
                                    {t('product.askWhatsapp')}
                                </a>
                            )}
                        </div>
                    )}
                    {/* After the buy area: the price and the button come first on a phone's first screen. */}
                    {has('title') && product.short_description && <ShortDescription text={product.short_description} />}
                    {has('pincode') && <PincodeCheck />}
                    {has('reassurance') && (
                        <div>
                            {config.dispatchPromise && <p className="cmx-small cmx-muted mb-2">{siteT(config.dispatchPromise)}</p>}
                            <ReassuranceRows items={config.reassurance} />
                        </div>
                    )}
                    {has('accordions') && <Accordions product={product} variant={variant} />}
                </div>
            </article>
            {has('related') && <Related product={product} />}
            {has('stickyBar') && (
                <div ref={stickyRef} className={cn('cmx-stickybar', sticky && 'cmx-stickybar--on')} aria-hidden={!sticky}>
                    <ProductImage media={gallery[0]} alt="" sizes={IMAGE_SIZES.thumb} className="cmx-stickybar__thumb cmx-img--square" />
                    <span className="flex min-w-0 flex-col">
                        <span className="cmx-small truncate">{product.name}</span>
                        <span className="font-semibold tabular-nums">{total || ''}</span>
                    </span>
                    {buyButton(true)}
                </div>
            )}
        </div>
    );
};
