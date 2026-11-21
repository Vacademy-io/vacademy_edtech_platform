/**
 * Quick add for a product with options: a sheet with the option
 * picker, the price and stock of the picked variant, and "Add to cart", so a shopper does not
 * have to leave the listing to choose a size. Goods sold by length still open the product
 * page, where the length picker is.
 */
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ProductCard } from '../api/types';
import { sendCommerceEvent } from '../logic/events';
import { thumbUrl } from '../logic/media';
import { activeVariant, initialSelection, selectValue, type Selection } from '../logic/options';
import { quantityRules, stockView } from '../logic/stock';
import { useCommerceCart } from '../state/cart-store';
import { OptionPicker } from './Options';
import { ErrorState, Layer, PriceText } from './primitives';
import { CardAddContext } from './card-add';
import { useProduct } from './queries';
import { ShopLink, useCommerceSite } from './site';

export const QuickAddSheet: React.FC<{ product: ProductCard; to: string; open: boolean; onClose(): void }> = ({ product, to, open, onClose }) => {
    const { t } = useCommerceSite();
    // Asked for only once the sheet is opened.
    const query = useProduct(open ? product.slug : '');
    const detail = query.data;
    const add = useCommerceCart((s) => s.add);
    const openDrawer = useCommerceCart((s) => s.openDrawer);
    const addMode = useContext(CardAddContext);
    const options = useMemo(() => detail?.options || [], [detail]);
    const variants = useMemo(() => [...(detail?.variants || [])].sort((a, b) => a.position - b.position), [detail]);
    const [selection, setSelection] = useState<Selection>({});
    useEffect(() => {
        if (detail) setSelection(initialSelection(options, variants, null));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detail?.id]);
    const variant = detail ? activeVariant(options, variants, selection) : null;
    const price = variant?.price ?? detail?.price ?? product.price;
    const view = stockView(variant ? variant.stock : null);
    const rules = quantityRules(detail?.qty_step || product.qty_step || 1, variant?.stock);
    const canBuy = !!variant && view.purchasable && rules.max !== 0 && typeof price?.amount === 'number';

    const addToCart = () => {
        if (!variant || !canBuy || !detail) return;
        const outcome = add({
            variantId: variant.id,
            slug: detail.slug,
            name: detail.name,
            variantLabel: variant.label,
            imageUrl: thumbUrl(variant.image || product.image),
            quantity: rules.step,
            qtyScale: Math.max(1, detail.qty_scale || 1),
            qtyStep: rules.step,
            unit: detail.unit,
            piece: (detail.stock_mode || '').toUpperCase() === 'PIECE' || view.kind === 'single',
            unitPrice: price?.amount ?? null,
        });
        if (outcome === 'full') {
            toast.error(t('product.cartFull'));
            return;
        }
        sendCommerceEvent({
            name: 'add_to_cart',
            item: { id: variant.sku || variant.id, name: detail.name, unitPrice: price?.amount, quantity: rules.step, qtyScale: detail.qty_scale, unit: detail.unit, variant: variant.label },
            currency: price?.currency,
        });
        if (addMode) addMode.onAdded(product.id);
        onClose();
        if (!addMode) openDrawer();
    };

    const thumb = thumbUrl(variant?.image || product.image);
    return (
        <Layer
            open={open}
            onClose={onClose}
            side="bottom"
            title={t('card.choose')}
            footer={
                <button type="button" className="cmx-btn cmx-btn--primary cmx-btn--lg cmx-btn--block" onClick={addToCart} disabled={!canBuy}>
                    {variant && view.kind === 'out' ? t('product.stock.out') : t('product.addToCart')}
                </button>
            }
        >
            <div className="cmx-layer__body flex flex-col gap-4">
                <div className="flex items-center gap-3">
                    <span className="cmx-img cmx-quick__thumb">{thumb && <img src={thumb} alt="" loading="lazy" decoding="async" width={56} height={70} />}</span>
                    <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{product.name}</span>
                        <PriceText price={price ? { ...price, from: !variant && !!price.from } : price} showOff />
                    </span>
                </div>
                {query.isPending && (
                    <div aria-busy="true" className="flex flex-col gap-3">
                        <p className="cmx-sr" role="status">
                            {t('common.loading')}
                        </p>
                        <div className="cmx-skel h-5 w-1/3" aria-hidden="true" />
                        <div className="cmx-skel h-11 w-full" aria-hidden="true" />
                    </div>
                )}
                {query.isError && <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />}
                {detail && options.length > 0 && (
                    <OptionPicker
                        options={options}
                        variants={variants}
                        selection={selection}
                        onSelect={(option, value) => setSelection(selectValue(options, variants, selection, option, value))}
                    />
                )}
                <ShopLink to={to} className="cmx-link cmx-small cmx-tap inline-flex items-center self-start" onClick={onClose}>
                    {t('card.details')}
                </ShopLink>
            </div>
        </Layer>
    );
};
