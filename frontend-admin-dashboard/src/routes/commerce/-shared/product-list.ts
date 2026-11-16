import type { ProductSummary } from './commerce-types';

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
