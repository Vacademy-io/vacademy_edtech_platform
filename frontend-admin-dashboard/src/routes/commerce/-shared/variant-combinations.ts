/**
 * The variants grid of the product editor ("Options and variants"), as pure
 * functions: pick up to three attributes that vary, tick values,
 * and one row per combination is made.
 *
 * The server never deletes a variant (it has stock, orders and invoices behind
 * it). So a saved variant whose combination is no longer wanted is kept and
 * set to ARCHIVED; an unsaved one is simply dropped.
 */

export const MAX_OPTIONS = 3;
/** A guard against a typo ticking 20 × 20 × 20 values. */
export const MAX_VARIANTS = 200;

export interface OptionSelection {
    attributeId: string;
    /** Ticked value ids, in the order they are shown. */
    valueIds: string[];
}

export type Combination = Record<string, string>;

/**
 * Every combination of the ticked values, in option order (the first option
 * changes slowest). No options gives one empty combination: the single
 * default variant. An option with nothing ticked gives no combination at all.
 */
export function generateCombinations(options: OptionSelection[]): Combination[] {
    return options.reduce<Combination[]>(
        (rows, option) =>
            rows.flatMap((row) =>
                [...new Set(option.valueIds)].map((valueId) => ({
                    ...row,
                    [option.attributeId]: valueId,
                }))
            ),
        [{}]
    );
}

export const countCombinations = (options: OptionSelection[]): number =>
    options.reduce((total, option) => total * new Set(option.valueIds).size, 1);

/** Stable identity of a combination, whatever order its keys were written in. */
export function combinationKey(combination: Combination): string {
    return Object.keys(combination)
        .sort()
        .map((attributeId) => `${attributeId}=${combination[attributeId]}`)
        .join('|');
}

export interface VariantRowLike {
    /** Empty for a row that is not saved yet. */
    package_session_id: string;
    sku: string;
    status: string;
    option_values: Combination;
}

export interface ReconcileResult<T extends VariantRowLike> {
    rows: T[];
    added: number;
    archived: number;
    restored: number;
}

/**
 * Brings the grid in line with the ticked values.
 *  - a wanted combination that already has a row keeps the row, untouched
 *    (an ARCHIVED saved row comes back as ACTIVE);
 *  - a wanted combination without a row gets a new one from `create`;
 *  - a saved row that is no longer wanted is kept and ARCHIVED;
 *  - an unsaved row that is no longer wanted is dropped.
 * Wanted rows come first, in combination order; archived leftovers follow.
 */
export function reconcileVariants<T extends VariantRowLike>(
    current: T[],
    options: OptionSelection[],
    create: (combination: Combination, index: number) => T
): ReconcileResult<T> {
    const wanted = generateCombinations(options);
    const byKey = new Map<string, T>();
    current.forEach((row) => {
        const key = combinationKey(row.option_values);
        const held = byKey.get(key);
        // Two rows with one combination: prefer the saved, then the live one.
        if (!held || (!held.package_session_id && row.package_session_id)) byKey.set(key, row);
    });

    let added = 0;
    let restored = 0;
    const used = new Set<T>();
    const rows: T[] = wanted.map((combination, index) => {
        const existing = byKey.get(combinationKey(combination));
        if (!existing) {
            added += 1;
            return create(combination, index);
        }
        used.add(existing);
        if (existing.package_session_id && existing.status === 'ARCHIVED') {
            restored += 1;
            return { ...existing, status: 'ACTIVE' };
        }
        return existing;
    });

    let archived = 0;
    current.forEach((row) => {
        if (used.has(row) || !row.package_session_id) return;
        if (row.status !== 'ARCHIVED') archived += 1;
        rows.push({ ...row, status: 'ARCHIVED' });
    });
    return { rows, added, archived, restored };
}

const SKU_UNSAFE = /[^A-Z0-9]+/g;

/**
 * A suggested SKU: the product's base and the value codes, upper case and
 * hyphenated ("KURTA-RED-M"). Only a suggestion; the cell stays editable and
 * the server decides whether it is free.
 */
export function suggestSku(base: string, valueCodes: string[]): string {
    return [base, ...valueCodes]
        .map((part) =>
            part
                .toUpperCase()
                .replace(SKU_UNSAFE, '-')
                .replace(/^-+|-+$/g, '')
        )
        .filter(Boolean)
        .join('-')
        .slice(0, 100);
}

/** Skus that appear on more than one live row (compared as the server does: exactly). */
export function duplicateSkus(rows: Array<Pick<VariantRowLike, 'sku'>>): string[] {
    const seen = new Set<string>();
    const twice = new Set<string>();
    rows.forEach((row) => {
        const sku = row.sku.trim();
        if (!sku) return;
        if (seen.has(sku)) twice.add(sku);
        seen.add(sku);
    });
    return [...twice];
}
