import type { MappingRow, ProductPageInviteMappingResponse } from '../-types/product-page-types';

/**
 * How the product-page editor orders and seeds its course rows.
 *
 * The row order IS the saved order: Save writes display_order = position. So
 * the editor must open in display_order (a learning path's step order), not in
 * whatever order the database returned the rows — otherwise the first save
 * after opening would silently rewrite the order. Ties (rows created outside
 * the editor all carry the column default 0) keep the order they arrived in.
 */

const orderOf = (m: { display_order?: number | null }) =>
    typeof m.display_order === 'number' && Number.isFinite(m.display_order) ? m.display_order : Number.MAX_SAFE_INTEGER;

/** Stable sort by display_order; equal (or missing) values keep their arrival order. */
export const sortByDisplayOrder = <T extends { display_order?: number | null }>(mappings: T[]): T[] =>
    mappings
        .map((m, index) => ({ m, index }))
        .sort((a, b) => orderOf(a.m) - orderOf(b.m) || a.index - b.index)
        .map(({ m }) => m);

/**
 * Only live mappings become rows. A row in the editor is re-saved as ACTIVE,
 * so a switched-off mapping (e.g. one a catalogue sync deactivated) must never
 * be loaded, or the next Save would quietly switch it back on.
 */
export const isLiveMapping = (m: { status?: string | null }) => !m.status || m.status === 'ACTIVE';

export const mappingResponseToRow = (m: ProductPageInviteMappingResponse, idx: number): MappingRow => ({
    rowId: m.id || `row-${Date.now()}-${idx}`,
    inviteId: m.enroll_invite_id || '',
    inviteName: '',
    psInvitePaymentOptionId: m.ps_invite_payment_option_id || '',
    packageSessionId: m.package_session_id || '',
    paymentPlanId: m.payment_plan_id || '',
    paymentPlanName: m.payment_plan?.name || '',
    paymentPlanPrice: m.payment_plan?.actual_price || 0,
    currency: m.payment_plan?.currency || '',
    preselected: m.preselected ?? false,
    displayOrder: m.display_order ?? idx,
    levelName: m.level_name || '',
    packageName: m.package_name || '',
});

/** Editor rows for a product page response: live mappings, in display order. */
export const mappingsToRows = (mappings: ProductPageInviteMappingResponse[] | null | undefined): MappingRow[] =>
    sortByDisplayOrder((mappings || []).filter(isLiveMapping)).map(mappingResponseToRow);

/**
 * Moves one row a step up (-1) or down (+1) and renumbers displayOrder the way
 * removing a row does. At either end, or for an unknown row, the SAME array is
 * returned so callers can tell nothing moved.
 */
export const moveRowInList = (rows: MappingRow[], rowId: string, direction: -1 | 1): MappingRow[] => {
    const from = rows.findIndex((r) => r.rowId === rowId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= rows.length) return rows;
    const next = [...rows];
    [next[from], next[to]] = [next[to]!, next[from]!];
    return next.map((r, i) => (r.displayOrder === i ? r : { ...r, displayOrder: i }));
};
