import type { TFunction } from 'i18next';
import { formatMoney } from '@/components/design-system/money-cell';
import type { ProductSummary } from './commerce-types';
import { ratePaise, unitSign, unitWord } from './units';

/**
 * Small pure helpers of the product list.
 */

export type ProductWarning = 'missingHindi' | 'missingEnglish' | 'missingTaxClass';

/**
 * The warning icon of a list row: a missing translation, and a
 * missing tax class. The server sends `tax_class_id` on every row, null when
 * the product has none; `undefined` (an older server) means "not known".
 */
export function productWarnings(
    product: Pick<ProductSummary, 'names' | 'tax_class_id'>
): ProductWarning[] {
    const warnings: ProductWarning[] = [];
    if (!product.names?.hi?.trim()) warnings.push('missingHindi');
    if (!product.names?.en?.trim()) warnings.push('missingEnglish');
    if (product.tax_class_id === null) warnings.push('missingTaxClass');
    return warnings;
}

/**
 * Whether GET /products honours a filter. `taxClassMissing` is read by the
 * server. `stockState` is not built yet: a row that carries `stock_state`
 * proves the server knows it.
 */
export function serverFilterSupport(rows: ProductSummary[]): {
    stockState: boolean;
    taxClass: boolean;
} {
    return {
        stockState: rows.some((row) => row.stock_state !== undefined),
        taxClass: true,
    };
}

export interface BulkFailure {
    id: string;
    message: string;
}

/** After a bulk action only the rows that failed stay ticked, ready to retry. */
export function selectionAfterBulk(
    _selected: string[],
    failures: BulkFailure[]
): Record<string, boolean> {
    return failures.reduce<Record<string, boolean>>((out, failure) => {
        out[failure.id] = true;
        return out;
    }, {});
}

/**
 * The price column. The summary's prices are per base unit (fact 24): a measured
 * product (B8 `qty_scale` > 1) reads per metre, "₹123.40 / m" or "₹100.00 – ₹123.40 / m".
 */
export const priceRange = (product: ProductSummary, t?: TFunction): string => {
    if (product.min_price === null) return '—';
    const currency = product.currency ?? 'INR';
    const scale = product.qty_scale ?? 1;
    if (scale > 1) {
        const sign = t ? unitWord(product.unit, t) : unitSign(product.unit);
        const at = (price: number) => formatMoney(ratePaise(price, scale) / 100, currency);
        const range =
            product.max_price !== null && product.max_price !== product.min_price
                ? `${at(product.min_price)} – ${at(product.max_price)}`
                : at(product.min_price);
        return sign ? `${range} / ${sign}` : range;
    }
    const min = formatMoney(product.min_price, currency);
    return product.max_price !== null && product.max_price !== product.min_price
        ? `${min} – ${formatMoney(product.max_price, currency)}`
        : min;
};
