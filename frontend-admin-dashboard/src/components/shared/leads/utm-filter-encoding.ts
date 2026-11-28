import {
    UTM_FILTER_DIMENSIONS,
    type UtmFilterDimension,
    type UtmFilterSelection,
    type UtmListFiltersPayload,
} from '@/services/utm-list-filters';

/**
 * How the campaign (UTM) filter selections travel through each list page.
 *
 * Pages that keep their filters in a `columnFilters` array (All Contacts,
 * Students) store one entry per dimension under the id `utm:<dimension>`, so
 * the existing Apply / Reset / URL plumbing carries them untouched. Pages that
 * keep dedicated state (the leads views) hold a {@link UtmFilterSelection}
 * directly. Both shapes serialise to the same `utm_filters` request payload
 * through {@link toUtmFiltersPayload}.
 */
export const UTM_FILTER_ID_PREFIX = 'utm:';

/**
 * Pinned option in the Source dropdown meaning "no campaign at all". It is not
 * a value a touch could hold (the link builder strips everything but
 * [a-z0-9._-+/]), so it can never collide with real data.
 */
export const UTM_UNTAGGED_SENTINEL = '__UTM_UNTAGGED__';

export const utmFilterId = (dimension: UtmFilterDimension): string =>
    `${UTM_FILTER_ID_PREFIX}${dimension}`;

export const isUtmFilterId = (id: string): boolean => id.startsWith(UTM_FILTER_ID_PREFIX);

export const dimensionFromUtmFilterId = (id: string): UtmFilterDimension | null => {
    if (!isUtmFilterId(id)) return null;
    const dim = id.slice(UTM_FILTER_ID_PREFIX.length);
    return (UTM_FILTER_DIMENSIONS as readonly string[]).includes(dim)
        ? (dim as UtmFilterDimension)
        : null;
};

/** Reads the UTM selection back out of a page's columnFilters array. */
export const readUtmSelection = (
    columnFilters: { id: string; value: { id: string; label: string }[] }[]
): UtmFilterSelection => {
    const out: UtmFilterSelection = {};
    for (const f of columnFilters) {
        const dim = dimensionFromUtmFilterId(f.id);
        if (!dim || f.value.length === 0) continue;
        out[dim] = f.value.map((v) => v.id);
    }
    return out;
};

const PAYLOAD_KEY: Record<UtmFilterDimension, keyof UtmListFiltersPayload> = {
    source: 'sources',
    medium: 'mediums',
    campaign: 'campaigns',
    content: 'contents',
    term: 'terms',
    source_type: 'source_types',
};

/**
 * Selection → request payload. Returns undefined when nothing is selected so
 * callers can spread `{ utm_filters: … }` without sending an empty object.
 * The untagged sentinel becomes `untagged_only: true` and drops every value
 * list — there is nothing for them to match once "no campaign" is asked for.
 */
export const toUtmFiltersPayload = (
    selection: UtmFilterSelection | undefined
): UtmListFiltersPayload | undefined => {
    if (!selection) return undefined;
    if ((selection.source ?? []).includes(UTM_UNTAGGED_SENTINEL)) {
        return { untagged_only: true };
    }
    const payload: UtmListFiltersPayload = {};
    let any = false;
    for (const dim of UTM_FILTER_DIMENSIONS) {
        const values = (selection[dim] ?? []).filter((v) => v && v !== UTM_UNTAGGED_SENTINEL);
        if (values.length === 0) continue;
        payload[PAYLOAD_KEY[dim]] = values as never;
        any = true;
    }
    return any ? payload : undefined;
};

/** Order-independent cache-key fragment for a selection. */
export const utmSelectionKey = (selection: UtmFilterSelection | undefined): string => {
    if (!selection) return '';
    return UTM_FILTER_DIMENSIONS.map((dim) => {
        const values = selection[dim] ?? [];
        return values.length ? `${dim}=${[...values].sort().join(',')}` : '';
    })
        .filter(Boolean)
        .join('|');
};

export const hasUtmSelection = (selection: UtmFilterSelection | undefined): boolean =>
    !!selection && UTM_FILTER_DIMENSIONS.some((dim) => (selection[dim] ?? []).length > 0);

/** Human label for a selected value (the sentinel reads as "No campaign"). */
export const utmValueLabel = (value: string, untaggedLabel: string): string =>
    value === UTM_UNTAGGED_SENTINEL ? untaggedLabel : value;
