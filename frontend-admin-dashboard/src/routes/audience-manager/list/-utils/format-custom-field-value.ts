/**
 * Formats a stored custom-field value for human display, based on the field's
 * type. Mirrors the encoding used by {@link CustomFieldRenderer}:
 *
 * - `dropdown` / `radio` / text-ish → stored as the visible string; render as-is.
 * - `checkbox` (single)            → stored as `'true'` / `'false'`; render Yes/No.
 * - `multi_select`                 → stored as `JSON.stringify(string[])`; render
 *                                     as a comma-separated list.
 * - `file`                          → stored as a URL; render as a clickable link
 *                                     (caller provides the renderer; this util
 *                                     returns the URL string).
 *
 * Input from the API can have varied casing (`DROPDOWN`, `dropdown`, `Dropdown`)
 * — we normalize to lowercase for the comparison.
 */

import type { TFunction } from 'i18next';

export const formatCustomFieldValue = (
    rawValue: string | null | undefined,
    fieldType: string | null | undefined,
    t: TFunction
): string => {
    if (rawValue === null || rawValue === undefined || rawValue === '') {
        // Sentinel for "no value" — several call sites do an identity
        // comparison (`display === '-'`) against this exact literal to
        // decide whether to show a "not provided" placeholder instead, so
        // it must stay a stable, non-translated string.
        return '-';
    }
    const value = String(rawValue);
    const type = (fieldType ?? '').toString().toLowerCase().trim();

    if (type === 'multi_select' || type === 'multiselect') {
        // Multi-select stores a JSON-encoded string array. Fall back to the raw
        // value if it doesn't parse as one (defensive against legacy rows).
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                const items = parsed.filter((v) => v != null && String(v).length > 0);
                return items.length ? items.map(String).join(', ') : '-';
            }
        } catch {
            // not JSON — treat as already-formatted string
        }
        return value;
    }

    if (type === 'checkbox') {
        // Single boolean checkbox.
        const v = value.toLowerCase().trim();
        if (v === 'true' || v === '1' || v === 'yes') return t('checkbox.yes');
        if (v === 'false' || v === '0' || v === 'no') return t('checkbox.no');
        return value;
    }

    // dropdown, radio, text, textfield, number, email, phone, file, etc.
    return value;
};

/**
 * Returns true when {@link fieldType} represents a multi-value checkbox group.
 * Used by callers that want to render each selection as its own chip rather
 * than a comma-separated string.
 */
export const isMultiSelectType = (fieldType: string | null | undefined): boolean => {
    const t = (fieldType ?? '').toString().toLowerCase().trim();
    return t === 'multi_select' || t === 'multiselect';
};

/**
 * Parse a stored multi-select value into its array of selections.
 * Returns an empty array on any failure or non-array input.
 */
export const parseMultiSelectValue = (rawValue: string | null | undefined): string[] => {
    if (rawValue === null || rawValue === undefined || rawValue === '') return [];
    try {
        const parsed = JSON.parse(String(rawValue));
        if (Array.isArray(parsed)) {
            return parsed.filter((v) => v != null && String(v).length > 0).map(String);
        }
    } catch {
        // ignore
    }
    return [];
};
