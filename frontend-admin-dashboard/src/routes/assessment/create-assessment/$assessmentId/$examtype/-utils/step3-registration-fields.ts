import {
    BUILT_IN_REGISTRATION_FIELDS,
    withBuiltInRegistrationFields,
} from '@/components/common/custom-fields/builtin-registration-fields';
import { CustomFieldStep3 } from '@/types/assessments/assessment-data-type';

/**
 * The edit form's registration fields: what the assessment has saved, with any of Full Name /
 * Email / Phone Number it is missing shown on top as unsaved rows (ids '0' / '1' / '2').
 *
 * Matched by role, not by field_name — the old all-three-by-name check prepended all three again
 * whenever one was missing or renamed ("Name", "E-mail"), which duplicates the others once these
 * rows are actually saved.
 */
export const withMissingBuiltInFieldsOnTop = (saved: CustomFieldStep3[]): CustomFieldStep3[] => {
    const toppedUp = withBuiltInRegistrationFields(
        saved,
        (field) => ({ key: field.key, label: field.name, type: field.type }),
        (builtIn) => ({
            id: String(BUILT_IN_REGISTRATION_FIELDS.indexOf(builtIn)),
            type: 'textfield',
            name: builtIn.label,
            oldKey: true,
            isRequired: true,
            key: builtIn.key,
        })
    );
    const missing = toppedUp.slice(saved.length);
    if (missing.length === 0) return saved;
    // Number the rows as the builder shows them. Saved forms that lack the built-ins usually start
    // at field_order 0, so keeping both orders would tie them and the learner page could interleave
    // them. The saved fields keep their relative order.
    return [...missing, ...saved].map((field, index) => ({ ...field, order: index }));
};

/**
 * The snapshot an edit is diffed against when it is saved.
 *
 * Open test: the fields that are actually saved. The built-ins shown on top of a form that lacks
 * them are not, so they must diff as added — snapshotting them as existing meant the form showed
 * them while the learner's registration page never asked for them — and any renumbering that made
 * room for them diffs as updated.
 *
 * Closed test: the snapshot as loaded, so nothing is added. A closed test has no registration page
 * and the create flow saves no form for one either.
 */
export const diffBaseForSave = <T extends { open_test: { custom_fields: CustomFieldStep3[] } }>(
    loaded: T | null,
    saved: CustomFieldStep3[],
    isOpenTest: boolean
): T | null =>
    loaded && isOpenTest
        ? { ...loaded, open_test: { ...loaded.open_test, custom_fields: saved } }
        : loaded;
