/**
 * Presentation helpers shared by every surface that lists cart items — the
 * editable list in the cart step and the read-only summary that rides along
 * for the rest of checkout. One copy, so a course cannot be titled one way on
 * the left of the screen and another way on the right.
 */
import type { ProductPageMappingResponse } from '../-types/product-page-types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';

/**
 * Rotating avatar tints. Semantic token families only (each has a 50/600 pair)
 * so the chips stay legible under any institute theme and in dark mode.
 */
export const AVATAR_TINTS = [
    'bg-primary-50 text-primary-500',
    'bg-success-50 text-success-600',
    'bg-info-50 text-info-600',
    'bg-warning-50 text-warning-600',
    'bg-danger-50 text-danger-600',
    'bg-secondary-50 text-secondary-500',
    'bg-tertiary-50 text-tertiary-500',
] as const;

export function currencySymbolFor(currency: string): string {
    return currency === 'INR' ? '₹' : `${currency} `;
}

/** "English Olympiad" → "EN"; falls back to the first two letters of one word. */
export function getInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Placeholder level / session names the backend stores for a course that has
 * none ("default" / "DEFAULT"): never shown to a buyer, as in the catalogue.
 */
const PLACEHOLDER_NAMES = new Set(['default', 'none', 'null', 'undefined']);

/** A level or session name worth showing, or '' for a missing or placeholder one. */
export function displayName(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    return PLACEHOLDER_NAMES.has(trimmed.toLowerCase()) ? '' : trimmed;
}

/**
 * Course label, preferring the package/level/session triple over the plan name.
 *
 * `fallback` lets a caller supply the institute's own word for a course (the
 * Course/Subject/Module terminology setting) instead of the literal below, for
 * the case where a mapping carries no names at all.
 */
export function itemTitle(mapping: ProductPageMappingResponse, fallback = getTerminology(ContentTerms.Course, SystemTerms.Course)): string {
    const parts = [mapping.package_name, displayName(mapping.level_name), displayName(mapping.session_name)].filter(Boolean);
    return parts.join(' · ') || mapping.payment_plan?.name || fallback;
}

/**
 * The subject on its own, for lists that already show the class as a heading.
 * Repeating "Class 5" on every row under a "Class 5" header is noise the
 * parent has to read past to find the one row they want to remove.
 */
export function itemSubject(mapping: ProductPageMappingResponse, fallback = getTerminology(ContentTerms.Course, SystemTerms.Course)): string {
    return mapping.package_name || mapping.payment_plan?.name || fallback;
}
