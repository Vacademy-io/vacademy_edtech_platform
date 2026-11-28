/**
 * Small building blocks every shop section uses: the modal layer (drawer, sheet, overlay),
 * responsive product image, price, stepper, and the loading / empty / error states.
 * All of them read only the commerce tokens (theme/commerce.css).
 */
import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ImageSquare, Minus, Plus, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { Media, Price } from '../api/types';
import { CommerceApiError } from '../api/client';
import { formatMoney, hasCompareAt, lineAmount, percentOff, unitLabel } from '../logic/format';
import { imageSource } from '../logic/media';
import { isMeasured } from '../logic/stock';
import type { MessageKey } from '../i18n';
import { useCommerceSite } from './site';

/* ── theme root ───────────────────────────────────────────────────── */

/**
 * The site's theme wrapper. Layers are portalled INTO it (not to document.body), so a drawer
 * wears the site's palette, fonts and radius without copying variables around.
 */
export const themeRootOf = (anchor?: Element | null): HTMLElement | null => {
    if (typeof document === 'undefined') return null;
    return (
        (anchor?.closest('[data-catalogue-theme]') as HTMLElement | null) ??
        (document.querySelector('[data-catalogue-theme]') as HTMLElement | null) ??
        document.body
    );
};

/** Inline custom properties for the shop-only tokens a site sets (fonts). */
export const useCommerceThemeVars = (): React.CSSProperties | undefined => {
    const { config } = useCommerceSite();
    const { displayFont, textFont } = config.theme;
    return React.useMemo(() => {
        const vars: Record<string, string> = {};
        // Devanagari-capable fallbacks after the named face, then the system stack.
        if (displayFont) vars['--cmx-font-display'] = `"${displayFont}", "Mukta", "Noto Sans Devanagari", serif`;
        if (textFont) vars['--cmx-font-text'] = `"${textFont}", "Noto Sans Devanagari", system-ui, sans-serif`;
        return Object.keys(vars).length ? (vars as React.CSSProperties) : undefined;
    }, [displayFont, textFont]);
};

/** The class of the shop's theme preset ("cmx-preset-heritage"), for every root the shop draws. */
export const usePresetClass = (): string | undefined => {
    const { config } = useCommerceSite();
    return config.theme.preset ? `cmx-preset-${config.theme.preset}` : undefined;
};

/* ── layer ────────────────────────────────────────────────────────── */

export interface LayerProps {
    open: boolean;
    onClose(): void;
    title: string;
    side: 'right' | 'bottom' | 'full' | 'top';
    /** Hide the visible title bar (the title is still announced). */
    bare?: boolean;
    dark?: boolean;
    header?: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
    initialFocus?: React.RefObject<HTMLElement>;
}

/**
 * A modal layer: traps focus, closes on Escape and on a tap outside, returns focus to what
 * opened it, locks page scroll (all from Radix Dialog). Motion is a short fade and slide that
 * the reduced-motion rule in commerce.css turns off.
 */
export const Layer: React.FC<LayerProps> = ({
    open,
    onClose,
    title,
    side,
    bare,
    dark,
    header,
    footer,
    className,
    children,
    initialFocus,
}) => {
    const { t, locale } = useCommerceSite();
    const themeVars = useCommerceThemeVars();
    const preset = usePresetClass();
    // Resolved while rendering, so the first paint of a drawer is already inside the theme
    // wrapper (an effect would paint once under <body>, without the site's palette).
    const container = open ? themeRootOf() : null;
    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal container={container ?? undefined}>
                <Dialog.Overlay className={cn('cmx cmx-scrim', preset)} />
                <Dialog.Content
                    lang={locale}
                    aria-describedby={undefined}
                    className={cn('cmx cmx-layer', preset, `cmx-layer--${side}`, dark && 'cmx-layer--dark', className)}
                    style={themeVars}
                    onOpenAutoFocus={(event) => {
                        if (initialFocus?.current) {
                            event.preventDefault();
                            initialFocus.current.focus();
                        }
                    }}
                >
                    <div className={cn('cmx-layer__head', bare && !header && 'cmx-sr')}>
                        <Dialog.Title className={cn('cmx-layer__title', header && 'cmx-sr')}>{title}</Dialog.Title>
                        {header}
                        <Dialog.Close className="cmx-icon-btn" aria-label={t('common.close')}>
                            <X size={20} aria-hidden="true" />
                        </Dialog.Close>
                    </div>
                    {children}
                    {footer && <div className="cmx-layer__foot">{footer}</div>}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

/* ── image ────────────────────────────────────────────────────────── */

export interface ProductImageProps {
    media: Media | null | undefined;
    alt: string;
    sizes: string;
    /** The first image of a page: loaded at once and with priority (the LCP image). */
    eager?: boolean;
    className?: string;
    children?: React.ReactNode;
}

/**
 * A product picture in a box of the shop's image ratio. The box is reserved before the image
 * loads (no layout shift); sources come from the stored renditions; everything but the first
 * image of a page is lazy.
 */
export const ProductImage: React.FC<ProductImageProps> = ({ media, alt, sizes, eager, className, children }) => {
    const source = imageSource(media);
    return (
        <div className={cn('cmx-img', className)}>
            {source && (
                <img
                    src={source.src}
                    srcSet={source.srcSet}
                    sizes={source.srcSet ? sizes : undefined}
                    width={source.width}
                    height={source.height}
                    alt={alt}
                    loading={eager ? 'eager' : 'lazy'}
                    decoding={eager ? 'sync' : 'async'}
                    // The LCP image: fetched ahead of the rest (React 19 writes the attribute).
                    {...(eager ? ({ fetchPriority: 'high' } as React.ImgHTMLAttributes<HTMLImageElement>) : {})}
                    draggable={false}
                />
            )}
            {!source && (
                // A product without a picture yet: a quiet mark, not an empty box.
                <span className="cmx-img__none" aria-hidden="true">
                    <ImageSquare size={28} weight="light" />
                </span>
            )}
            {children}
        </div>
    );
};

/* ── price ────────────────────────────────────────────────────────── */

/**
 * "₹4,899" with the MRP struck through when it is higher. A missing amount shows a quiet
 * placeholder: a price is never drawn as zero.
 */
export const PriceText: React.FC<{
    price: Price | null | undefined;
    /** Multiplies the unit price (a length of cloth). */
    quantity?: number;
    /**
     * Base units in one unit (qty_scale) and the unit's code. The API prices ONE base unit, so
     * goods sold by length or weight are shown per whole unit with its name: "₹450 / m",
     * never the price of a centimetre.
     */
    scale?: number | null;
    unit?: string | null;
    large?: boolean;
    showOff?: boolean;
    className?: string;
}> = ({ price, quantity = 1, scale, unit, large, showOff, className }) => {
    const { t } = useCommerceSite();
    const perUnit = isMeasured(scale || 1) && quantity === 1;
    const factor = perUnit ? Math.floor(scale as number) : quantity;
    const amount = typeof price?.amount === 'number' ? lineAmount(price.amount, factor) : null;
    const compare = typeof price?.compare_at_amount === 'number' ? lineAmount(price.compare_at_amount, factor) : null;
    const now = formatMoney(amount, price?.currency);
    if (!now) return <span className={cn('cmx-muted cmx-small', className)}>{t('price.unavailable')}</span>;
    const mrp = hasCompareAt(amount, compare) ? formatMoney(compare, price?.currency) : null;
    const off = showOff ? percentOff(amount, compare) : null;
    return (
        <span className={cn('cmx-price', large && 'cmx-price--lg', className)}>
            <span className="cmx-price__now">
                {price?.from && quantity === 1 ? t('card.from', { price: now }) : now}
                {perUnit && <span className="cmx-price__unit"> / {unitLabel(t, unit, true)}</span>}
            </span>
            {mrp && (
                <s className="cmx-price__mrp">
                    <span className="cmx-sr">{t('card.mrp', { price: mrp })}</span>
                    <span aria-hidden="true">{mrp}</span>
                </s>
            )}
            {off !== null && <span className="cmx-price__off">{t('price.off', { percent: off })}</span>}
        </span>
    );
};

/* ── stepper ──────────────────────────────────────────────────────── */

export const QuantityStepper: React.FC<{
    value: number;
    step: number;
    min: number;
    max: number | null;
    /** What the number reads as ("2.5 m"). */
    display: string;
    onChange(next: number): void;
    small?: boolean;
    label: string;
}> = ({ value, step, min, max, display, onChange, small, label }) => {
    const { t } = useCommerceSite();
    return (
        <div className={cn('cmx-stepper', small && 'cmx-stepper--sm')} role="group" aria-label={label}>
            <button type="button" onClick={() => onChange(value - step)} disabled={value - step < min} aria-label={t('product.qty.decrease')}>
                <Minus size={16} aria-hidden="true" />
            </button>
            <output aria-live="polite">{display}</output>
            <button
                type="button"
                onClick={() => onChange(value + step)}
                disabled={max !== null && value + step > max}
                aria-label={t('product.qty.increase')}
            >
                <Plus size={16} aria-hidden="true" />
            </button>
        </div>
    );
};

/* ── states ───────────────────────────────────────────────────────── */

export const errorMessageKey = (error: unknown): MessageKey => {
    if (error instanceof CommerceApiError) {
        if (error.kind === 'network') return 'error.network';
        if (error.kind === 'rate_limited') return 'error.rateLimited';
        if (error.kind === 'not_enabled' || error.kind === 'unauthorized') return 'error.notEnabled';
    }
    return 'error.generic';
};

export const isNotFound = (error: unknown): boolean => error instanceof CommerceApiError && error.kind === 'not_found';

/** react-query retry rule: once more for a network or server fault, never for a 4xx. */
export const shouldRetry = (failureCount: number, error: unknown): boolean =>
    failureCount < 1 && error instanceof CommerceApiError && (error.kind === 'network' || error.kind === 'server');

export const ErrorState: React.FC<{ error: unknown; onRetry?: () => void; compact?: boolean }> = ({
    error,
    onRetry,
    compact,
}) => {
    const { t } = useCommerceSite();
    const retryable = !(error instanceof CommerceApiError) || error.retryable;
    return (
        <div className={compact ? 'cmx-note cmx-note--error' : 'cmx-state'} role="alert">
            <p className={compact ? undefined : 'cmx-body'}>{t(errorMessageKey(error))}</p>
            {onRetry && retryable && (
                <button type="button" className={compact ? 'cmx-link' : 'cmx-btn cmx-btn--outline'} onClick={onRetry}>
                    {t('common.retry')}
                </button>
            )}
        </div>
    );
};

export const EmptyState: React.FC<{ title: string; body?: string; children?: React.ReactNode }> = ({
    title,
    body,
    children,
}) => (
    <div className="cmx-state">
        <h2 className="cmx-h2">{title}</h2>
        {body && <p className="cmx-body">{body}</p>}
        {children}
    </div>
);

/** A grid of card-shaped placeholders with the final box sizes: no layout shift when data arrives. */
export const GridSkeleton: React.FC<{ count: number; className?: string }> = ({ count, className }) => (
    <ul className={cn('cmx-grid', className)} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
            <li key={i} className="cmx-card">
                <div className="cmx-img cmx-skel" />
                <div className="cmx-card__body">
                    <div className="cmx-skel h-4 w-11/12" />
                    <div className="cmx-skel h-4 w-1/2" />
                    <div className="cmx-skel mt-1 h-5 w-1/3" />
                </div>
            </li>
        ))}
    </ul>
);

export const Busy: React.FC<{ label: string }> = ({ label }) => (
    <p role="status" className="cmx-sr">
        {label}
    </p>
);

/** Unit names from the API codes (MTR, KG, PCS) in the visitor's language. */
export { unitLabel };

/** True below the desktop breakpoint; false during the first render and on the server. */
export const useIsNarrow = (maxWidth = 1023.98): boolean => {
    const [narrow, setNarrow] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const query = window.matchMedia(`(max-width: ${maxWidth}px)`);
        const update = () => setNarrow(query.matches);
        update();
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, [maxWidth]);
    return narrow;
};
