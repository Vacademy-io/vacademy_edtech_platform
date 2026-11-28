/**
 * commerceProductCard: picture in the shop's ratio, one badge, name,
 * origin line, price with the MRP struck through, swatch dots, and quick add for a product
 * with a single variant. Plus the grid and the rail that lay cards out.
 */
import React, { useContext, useState } from 'react';
import { CheckCircle, ShoppingBagOpen } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { ProductCard } from '../api/types';
import { sendCommerceEvent } from '../logic/events';
import { quantityText } from '../logic/format';
import { IMAGE_SIZES, mediaChip, ratioClass, thumbUrl } from '../logic/media';
import { isMeasured, stockView } from '../logic/stock';
import { hasMessage } from '../i18n';
import { apiPathTo } from '../routes';
import { useCommerceCart } from '../state/cart-store';
import { PriceText, ProductImage } from './primitives';
import { CardAddContext } from './card-add';
import { QuickAddSheet } from './QuickAdd';
import { ShopLink, useCommerceSite } from './site';

/** The one badge a card shows: sold out first, then the first rule badge the API sent. */
export const useCardBadge = (product: ProductCard): { text: string; muted: boolean } | null => {
    const { t } = useCommerceSite();
    const view = stockView(product.stock);
    if (view.kind === 'out') return { text: t('badge.SOLD_OUT'), muted: true };
    const code = (product.badges || [])[0];
    if (!code) return null;
    if (code === 'ONLY_N_LEFT') {
        return view.left !== null
            ? { text: t('badge.ONLY_N_LEFT', { count: quantityText(view.left, product.qty_scale, product.unit, t) }), muted: false }
            : { text: t('badge.LOW'), muted: false };
    }
    const key = `badge.${code}`;
    return hasMessage(key) ? { text: t(key), muted: false } : null;
};

export const ProductCardView: React.FC<{
    product: ProductCard;
    /** Above the fold: the first row of a listing loads at once. */
    eager?: boolean;
    sizes?: string;
    showQuickAdd?: boolean;
    as?: 'li' | 'div';
    /** The list this card sits in, for analytics ("c/sarees", "search", "rail"). */
    listId?: string;
    listName?: string;
    index?: number;
}> = ({ product, eager, sizes = IMAGE_SIZES.card, showQuickAdd = true, as: Tag = 'li', listId = 'rail', listName, index }) => {
    const { t, config, siteT } = useCommerceSite();
    const [sheetOpen, setSheetOpen] = useState(false);
    const add = useCommerceCart((s) => s.add);
    const openDrawer = useCommerceCart((s) => s.openDrawer);
    const addMode = useContext(CardAddContext);
    const inCart = useCommerceCart((s) => !!addMode && s.cart.lines.some((line) => line.slug === product.slug));
    const badge = useCardBadge(product);
    const view = stockView(product.stock);
    const swatches = (product.swatches || []).filter((s) => !!s && !!s.swatch_hex);
    const to = apiPathTo(product.path) || `p/${product.slug}`;
    const chipLabel = product.image ? mediaChip(product.image, config.media.leadTag, config.media.tagLabels) : null;
    // The label is the seller's text: through the site dictionary, like every other setting.
    const chip = chipLabel ? siteT(chipLabel) : null;
    const measured = isMeasured(product.qty_scale);
    const direct = !!product.default_variant_id && !measured;
    // Several variants and not sold by length: the options are picked in a sheet on the card.
    const viaSheet = !direct && !measured && product.variant_count > 1;
    const eventItem = { id: product.id, name: product.name, unitPrice: product.price?.amount, qtyScale: product.qty_scale, index };

    const quickAdd = () => {
        if (!product.default_variant_id) return;
        const outcome = add({
            variantId: product.default_variant_id,
            slug: product.slug,
            name: product.name,
            variantLabel: null,
            imageUrl: thumbUrl(product.image),
            quantity: Math.max(1, product.qty_step || 1),
            qtyScale: Math.max(1, product.qty_scale || 1),
            qtyStep: Math.max(1, product.qty_step || 1),
            unit: product.unit,
            piece: !!product.stock?.single_piece,
            unitPrice: product.price?.amount ?? null,
        });
        if (outcome === 'full') {
            toast.error(t('product.cartFull'));
            return;
        }
        sendCommerceEvent({ name: 'add_to_cart', item: { ...eventItem, quantity: Math.max(1, product.qty_step || 1) }, currency: product.price?.currency });
        if (addMode) addMode.onAdded(product.id);
        else openDrawer();
    };

    return (
        <Tag className={cn('cmx-card', ratioClass(config.theme.imageRatio), view.kind === 'out' && 'cmx-card--out')}>
            <ProductImage
                media={product.image}
                alt={product.image?.alt || product.name}
                sizes={sizes}
                eager={eager}
                className="cmx-card__media"
            >
                {chip && <span className="cmx-media-chip">{chip}</span>}
            </ProductImage>
            {badge && (
                <span className={cn('cmx-badge cmx-card__badge', badge.muted && 'cmx-badge--muted')}>{badge.text}</span>
            )}
            <div className="cmx-card__body">
                <h3 className="cmx-card__name">
                    <ShopLink to={to} className="cmx-card__link" onClick={() => sendCommerceEvent({ name: 'select_item', listId, listName, item: eventItem })}>
                        {product.name}
                    </ShopLink>
                </h3>
                {product.origin && <p className="cmx-small cmx-muted">{t('product.origin', { place: product.origin })}</p>}
                {/* Cloth shows its price per metre, with the unit: never the price of one base unit. */}
                <PriceText price={product.price} scale={product.qty_scale} unit={product.unit} />
                {swatches.length > 1 && (
                    <p className="flex items-center gap-1" role="img" aria-label={t('card.colours', { count: swatches.length })}>
                        {swatches.slice(0, 5).map((s) => (
                            <span
                                key={s.code}
                                className="cmx-swatch"
                                title={s.label || s.code}
                                // The colour is the seller's data (a swatch hex), not a theme value.
                                style={{ ['--cmx-swatch' as string]: s.swatch_hex as string }}
                            />
                        ))}
                        {swatches.length > 5 && <span className="cmx-small cmx-muted">+{swatches.length - 5}</span>}
                    </p>
                )}
                {showQuickAdd && view.purchasable && (
                    <div className="cmx-card__quick">
                        {direct ? (
                            <button
                                type="button"
                                className="cmx-btn cmx-btn--outline cmx-btn--block cmx-small"
                                onClick={quickAdd}
                                aria-label={inCart ? t('card.inCartOf', { name: product.name }) : t('card.quickAddOf', { name: product.name })}
                            >
                                {inCart ? (
                                    <>
                                        <CheckCircle size={18} weight="fill" aria-hidden="true" className="cmx-card__quick-icon cmx-ok" />
                                        {t('card.inCart')}
                                    </>
                                ) : (
                                    <>
                                        <ShoppingBagOpen size={18} aria-hidden="true" className="cmx-card__quick-icon" />
                                        {t('card.quickAdd')}
                                    </>
                                )}
                            </button>
                        ) : viaSheet ? (
                            <button
                                type="button"
                                className="cmx-btn cmx-btn--outline cmx-btn--block cmx-small"
                                onClick={() => setSheetOpen(true)}
                                aria-haspopup="dialog"
                                aria-label={`${t('card.choose')}: ${product.name}`}
                            >
                                {t('card.choose')}
                            </button>
                        ) : (
                            <ShopLink to={to} className="cmx-btn cmx-btn--outline cmx-btn--block cmx-small" tabIndex={-1} aria-hidden="true">
                                {t('card.choose')}
                            </ShopLink>
                        )}
                    </div>
                )}
            </div>
            {viaSheet && sheetOpen && <QuickAddSheet product={product} to={to} open onClose={() => setSheetOpen(false)} />}
        </Tag>
    );
};

export const ProductGrid: React.FC<{
    products: readonly ProductCard[];
    className?: string;
    /** How many cards are above the fold (loaded at once). */
    eagerCount?: number;
    showQuickAdd?: boolean;
    listId?: string;
    listName?: string;
}> = ({ products, className, eagerCount = 2, showQuickAdd, listId, listName }) => (
    <ul className={cn('cmx-grid', className)}>
        {products.map((product, index) => (
            <ProductCardView
                key={product.id}
                product={product}
                eager={index < eagerCount}
                showQuickAdd={showQuickAdd}
                listId={listId}
                listName={listName}
                index={index}
            />
        ))}
    </ul>
);

/** A horizontal row on phones (swipe, no autoplay), a plain row of columns on desktop. */
export const ProductRail: React.FC<{
    products: readonly ProductCard[];
    columns?: number;
    showQuickAdd?: boolean;
    listId?: string;
    listName?: string;
}> = ({ products, columns = 4, showQuickAdd, listId = 'rail', listName }) => (
    <ul className="cmx-rail" style={{ ['--cmx-rail-cols' as string]: String(columns) }}>
        {products.map((product, index) => (
            <ProductCardView
                key={product.id}
                product={product}
                sizes={IMAGE_SIZES.rail}
                showQuickAdd={showQuickAdd}
                listId={listId}
                listName={listName}
                index={index}
            />
        ))}
    </ul>
);
