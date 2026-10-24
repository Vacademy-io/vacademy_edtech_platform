import type { AggregatedCustomField, ProductPageMappingResponse } from '../-types/product-page-types';

/**
 * Returns the subset of aggregated fields that are relevant to the currently
 * selected mappings. A field is included if at least one of its owning invites
 * belongs to a selected mapping.
 */
export function getActiveFields(
    allMappings: ProductPageMappingResponse[],
    selectedPsOptionIds: string[],
    allAggregatedFields: AggregatedCustomField[]
): AggregatedCustomField[] {
    const activeInviteIds = new Set(
        allMappings
            .filter((m) => selectedPsOptionIds.includes(m.ps_invite_payment_option_id))
            .map((m) => m.enroll_invite_id)
    );

    return allAggregatedFields.filter((f) =>
        f.enroll_invite_ids.some((id) => activeInviteIds.has(id))
    );
}

/**
 * Collapses fields that share a storage key down to one input each.
 *
 * A `custom_fields` row is created per enroll invite rather than reused, so an
 * institute that has re-added the same field over time accumulates several rows
 * under one `field_key`. iThinkers' catalogue page carries three of them for
 * email ("Email", "email", and a required "Email"), and the checkout form drew
 * all three.
 *
 * That is not just untidy. Every input binds to `formValues[fieldKey]`, so the
 * duplicates fill in together as the visitor types in one of them; and the
 * submitted `registrationData` is keyed by the same string, so only ONE of the
 * ids was ever sent — chosen by iteration order, which is what a required
 * duplicate hides behind.
 *
 * Keeps the most demanding row per key: mandatory beats optional (dropping a
 * required field would let an incomplete form through), then the row backed by
 * the most invites, then first seen. The winner inherits the whole group's
 * invite ids so the value is still recorded against every invite that asked for
 * it, and the surviving rows keep their original relative order.
 */
export function dedupeFieldsByKey(
    fields: AggregatedCustomField[]
): AggregatedCustomField[] {
    const groups = new Map<string, AggregatedCustomField[]>();
    for (const f of fields) {
        const key = f.field.custom_field.fieldKey;
        const group = groups.get(key);
        if (group) group.push(f);
        else groups.set(key, [f]);
    }

    const winners = new Map<string, AggregatedCustomField>();
    for (const [key, group] of groups) {
        const best = group.reduce((a, b) => {
            if (a.field.custom_field.isMandatory !== b.field.custom_field.isMandatory) {
                return a.field.custom_field.isMandatory ? a : b;
            }
            return b.enroll_invite_ids.length > a.enroll_invite_ids.length ? b : a;
        });
        winners.set(key, {
            ...best,
            enroll_invite_ids: [...new Set(group.flatMap((f) => f.enroll_invite_ids))],
        });
    }

    // Emit in first-seen order so deduping never reshuffles the form.
    const emitted = new Set<string>();
    const out: AggregatedCustomField[] = [];
    for (const f of fields) {
        const key = f.field.custom_field.fieldKey;
        if (emitted.has(key)) continue;
        emitted.add(key);
        out.push(winners.get(key)!);
    }
    return out;
}

/**
 * Form order for one field.
 *
 * The mapping's `individual_order` is the per-context answer and wins; the
 * custom field's own `formOrder` is the institute-wide default it falls back
 * to. Fields an admin has never ordered all share one value, so the sort stays
 * stable and the form looks exactly as it did — ordering only bites once
 * someone actually sets it.
 */
export function fieldOrder(f: AggregatedCustomField): number {
    return f.field.individual_order ?? f.field.custom_field.formOrder ?? 0;
}

/**
 * Returns the initial set of selected ps_invite_payment_option_ids from the URL only.
 * DB preselected flag is intentionally ignored — preselection is URL-driven.
 *   1. ?courseIds= matched against package_session_id
 *   2. ?courseIds= matched against ps_invite_payment_option_id
 *   3. No param → empty (no auto-selection)
 */
export function resolveInitialSelection(
    mappings: ProductPageMappingResponse[],
    courseIdsParam?: string
): string[] {
    if (!courseIdsParam) return [];

    const ids = new Set(courseIdsParam.split(',').map((s) => s.trim()).filter(Boolean));

    // Try package_session_id first (the canonical admin-generated URL format)
    const byPsId = mappings
        .filter((m) => ids.has(m.package_session_id) && m.status === 'ACTIVE')
        .map((m) => m.ps_invite_payment_option_id);
    if (byPsId.length > 0) return byPsId;

    // Also accept ps_invite_payment_option_id directly
    return mappings
        .filter((m) => ids.has(m.ps_invite_payment_option_id) && m.status === 'ACTIVE')
        .map((m) => m.ps_invite_payment_option_id);
}
