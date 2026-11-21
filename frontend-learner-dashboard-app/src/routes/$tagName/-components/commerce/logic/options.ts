/**
 * The option picker's rules: which variant a set of picked
 * values names, and for every value whether the combination exists and can be bought.
 */
import type { ProductOption, Variant } from '../api/types';

/** Option code to picked value code. */
export type Selection = Record<string, string>;

export type ValueAvailability =
    /** A variant with this value and the other picked values exists and can be bought. */
    | 'available'
    /** It exists but is sold out: shown struck through, still selectable to read "sold out". */
    | 'sold_out'
    /** No variant has this combination: disabled. */
    | 'missing';

const valuesOf = (variant: Variant): Record<string, string> => variant.option_values || {};

const matches = (variant: Variant, selection: Selection, optionCodes: readonly string[]): boolean =>
    optionCodes.every((code) => selection[code] === undefined || valuesOf(variant)[code] === selection[code]);

const purchasable = (variant: Variant): boolean => !!variant.stock && variant.stock.purchasable !== false && variant.stock.state !== 'OUT';

/** The variant every picked value names; null while a value is missing or no variant has the set. */
export const findVariant = (
    options: readonly ProductOption[],
    variants: readonly Variant[],
    selection: Selection
): Variant | null => {
    if (variants.length === 0) return null;
    const codes = options.map((o) => o.code);
    if (codes.length === 0) return variants[0] ?? null;
    if (codes.some((code) => !selection[code])) return null;
    return variants.find((v) => codes.every((code) => valuesOf(v)[code] === selection[code])) ?? null;
};

/**
 * For each value of each option: what picking it would give, holding the OTHER options at
 * their current values.
 */
export const optionAvailability = (
    options: readonly ProductOption[],
    variants: readonly Variant[],
    selection: Selection
): Record<string, Record<string, ValueAvailability>> => {
    const codes = options.map((o) => o.code);
    const out: Record<string, Record<string, ValueAvailability>> = {};
    for (const option of options) {
        const row: Record<string, ValueAvailability> = {};
        for (const value of option.values) {
            const probe: Selection = { ...selection, [option.code]: value.code };
            const candidates = variants.filter((v) => matches(v, probe, codes));
            row[value.code] =
                candidates.length === 0 ? 'missing' : candidates.some(purchasable) ? 'available' : 'sold_out';
        }
        out[option.code] = row;
    }
    return out;
};

const selectionOf = (variant: Variant, options: readonly ProductOption[]): Selection => {
    const out: Selection = {};
    for (const option of options) {
        const value = valuesOf(variant)[option.code];
        if (value) out[option.code] = value;
    }
    return out;
};

/**
 * What is picked when the page opens: the variant named by ?v=<sku> (or its id), else the first
 * that can be bought, else the first. A product without options has an empty selection.
 */
export const initialSelection = (
    options: readonly ProductOption[],
    variants: readonly Variant[],
    wanted?: string | null
): Selection => {
    if (variants.length === 0 || options.length === 0) return {};
    const key = (wanted || '').trim().toLowerCase();
    const named = key
        ? variants.find((v) => (v.sku || '').toLowerCase() === key || v.id.toLowerCase() === key)
        : undefined;
    const ordered = [...variants].sort((a, b) => a.position - b.position);
    const chosen = named ?? ordered.find(purchasable) ?? ordered[0];
    return chosen ? selectionOf(chosen, options) : {};
};

/**
 * Picking a value. When the other picked values do not exist together with it, they move to
 * the closest variant that has the new value: one that can be bought first, then the one that
 * keeps the most of what was picked. The shopper never lands on a combination with no variant.
 */
export const selectValue = (
    options: readonly ProductOption[],
    variants: readonly Variant[],
    selection: Selection,
    optionCode: string,
    valueCode: string
): Selection => {
    const next: Selection = { ...selection, [optionCode]: valueCode };
    if (findVariant(options, variants, next)) return next;
    const withValue = variants.filter((v) => valuesOf(v)[optionCode] === valueCode);
    if (withValue.length === 0) return selection;
    const codes = options.map((o) => o.code);
    const kept = (v: Variant) => codes.filter((code) => valuesOf(v)[code] === next[code]).length;
    const best = [...withValue].sort(
        (a, b) => Number(purchasable(b)) - Number(purchasable(a)) || kept(b) - kept(a) || a.position - b.position
    )[0];
    return best ? selectionOf(best, options) : selection;
};

/** The variant a product without options sells, or the picked one. */
export const activeVariant = (
    options: readonly ProductOption[],
    variants: readonly Variant[],
    selection: Selection
): Variant | null => (options.length === 0 ? (variants[0] ?? null) : findVariant(options, variants, selection));
