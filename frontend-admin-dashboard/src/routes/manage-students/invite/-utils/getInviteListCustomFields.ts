import {
    isBuiltInRegistrationField,
    withBuiltInRegistrationFields,
} from '@/components/common/custom-fields/builtin-registration-fields';
import { fetchInstituteDefaultFields } from '@/services/custom-field-mappings';
import { getInstituteId } from '@/constants/helper';
import type { TFunction } from 'i18next';

/**
 * Interface for invite form custom field
 */
export interface InviteFormCustomField {
    id: string; // Form-level ID (can be numeric string or UUID)
    type: string;
    name: string;
    oldKey: boolean;
    isRequired: boolean;
    key: string;
    order: number;
    options?: Array<{ id: string; value: string; disabled?: boolean }>;
    _id?: string; // Custom field ID from localStorage (for API payload)
    status?: 'ACTIVE' | 'DELETED';
}

/**
 * Map custom field types to invite form field types
 */
const mapFieldType = (type: string): string => {
    if (type === 'select') return 'dropdown';
    if (type === 'textfield') return 'text';
    return type || 'text';
};

/**
 * Generate a key from field name (convert to snake_case)
 */
const generateKeyFromName = (name: string): string => {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
};

/**
 * Get the institute's default custom fields, pre-selected for a brand-new
 * invite create dialog.
 *
 * Custom Fields Revamp (2026-04): the previous implementation read from a
 * stale "Invite List" visibility checkbox. The revamp moved per-feature
 * field selection out of Settings and into each feature's create/edit
 * dialog, so the picker is now seeded from the institute's default catalog
 * (every CustomField + FixedField stored in `CUSTOM_FIELD_SETTING`). The
 * admin can untick anything in the dialog before saving — only the ticked
 * fields are persisted as ENROLL_INVITE mappings on save.
 *
 * Edit-mode pre-selection should fetch the existing ACTIVE mappings for
 * the invite via `GET /admin-core-service/common/custom-fields/feature-fields`
 * (type=ENROLL_INVITE, typeId=<inviteId>) instead of calling this function.
 */
/**
 * Sync variant — returns an empty array. The async variant (below) fetches
 * fresh data from the API and populates the form via useEffect. Returning
 * empty here prevents the fallback defaults (which have no _id) from being
 * submitted to the backend and creating duplicate custom_fields rows.
 */
export const getInviteListCustomFields = (): InviteFormCustomField[] => {
    return [];
};

/**
 * Get default invite fields (fallback)
 *
 * `t` is required so the field labels shown to the admin (column headers /
 * form labels rendered elsewhere from `name`) are translated. Callers get
 * `t` from their own `useTranslation()` — see getInviteListCustomFieldsAsync
 * below.
 */
const getDefaultInviteFields = (t: TFunction): InviteFormCustomField[] => {
    return [
        {
            id: '0',
            type: 'text',
            name: t('manageStudentsGetInviteListCustomFields:defaultFields.fullName'),
            oldKey: true,
            isRequired: true,
            key: 'full_name',
            order: 0,
            status: 'ACTIVE',
        },
        {
            id: '1',
            type: 'text',
            name: t('manageStudentsGetInviteListCustomFields:defaultFields.email'),
            oldKey: true,
            isRequired: true,
            key: 'email',
            order: 1,
            status: 'ACTIVE',
        },
        {
            id: '2',
            type: 'text',
            name: t('manageStudentsGetInviteListCustomFields:defaultFields.phoneNumber'),
            oldKey: true,
            isRequired: true,
            key: 'phone_number',
            order: 2,
            status: 'ACTIVE',
        },
    ];
};

/**
 * Async variant that fetches fresh settings from the API if the cache is
 * empty (e.g. after a Settings save which invalidates the cache). Use this
 * in dialog components that mount after a Settings change.
 */
const SEEDED_FIELD_KEYS = new Set([
    'full_name', 'name', 'fullname',
    'email', 'e_mail',
    'phone_number', 'phone', 'mobile_number', 'mobile',
]);

function isSeededField(field: { name: string; id: string; canBeDeleted?: boolean }): boolean {
    if (field.canBeDeleted === false) return true;
    const key = generateKeyFromName(field.name);
    return SEEDED_FIELD_KEYS.has(key);
}

/**
 * Async variant that fetches DEFAULT_CUSTOM_FIELD mappings directly from
 * the live backend endpoint (GET /common/custom-fields?instituteId=...).
 * This bypasses the stale settings JSON blob entirely, so newly-added
 * DEFAULT fields from Settings always appear immediately.
 */
export const getInviteListCustomFieldsAsync = async (
    t: TFunction
): Promise<InviteFormCustomField[]> => {
    try {
        const instituteId = getInstituteId();
        if (!instituteId) return getDefaultInviteFields(t);

        const defaults = await fetchInstituteDefaultFields(instituteId);
        if (!defaults || defaults.length === 0) return getDefaultInviteFields(t);

        // Alias groups for dedup — old-style (`name`, `phone`) and new-style
        // (`full_name`, `phone_number`) should not both appear.
        const NAME_ALIASES: string[][] = [
            ['full_name', 'name', 'fullname'],
            ['email', 'e_mail'],
            ['phone_number', 'phone', 'mobile_number', 'mobile', 'contact'],
        ];
        const aliasMap = new Map<string, string[]>();
        NAME_ALIASES.forEach((group) => {
            group.forEach((k) => aliasMap.set(k, group));
        });
        const seenKeys = new Set<string>();
        const markSeen = (key: string) => {
            seenKeys.add(key);
            const aliases = aliasMap.get(key);
            if (aliases) aliases.forEach((a) => seenKeys.add(a));
        };

        const result: InviteFormCustomField[] = [];
        defaults.forEach((entry, index) => {
            const cf = entry.custom_field;
            if (!cf || !cf.fieldName) return;

            const fieldType = mapFieldType(cf.fieldType || 'text');
            const key = generateKeyFromName(cf.fieldName);
            if (seenKeys.has(key)) return;
            markSeen(key);

            // Built-in by ROLE, not by a label/key list: institutes that call it "Name" or
            // "E-mail" must get the same default-on Required.
            const seeded =
                isSeededField({ name: cf.fieldName, id: cf.id }) ||
                isBuiltInRegistrationField({ key, label: cf.fieldName, type: fieldType });
            const transformed: InviteFormCustomField = {
                id: String(index),
                type: fieldType,
                name: cf.fieldName,
                oldKey: seeded,
                isRequired: cf.isMandatory || seeded,
                key,
                order: entry.individual_order ?? cf.formOrder ?? index,
                _id: cf.id,
                status: 'ACTIVE',
            };

            if ((fieldType === 'dropdown' || fieldType === 'radio') && cf.config) {
                try {
                    const parsed = JSON.parse(cf.config);
                    if (Array.isArray(parsed)) {
                        transformed.options = parsed.map((opt: any, oi: number) => ({
                            id: `${index}_opt_${oi}`,
                            value: opt.value || opt.label || opt,
                            disabled: true,
                        }));
                    } else if (parsed.coommaSepartedOptions) {
                        transformed.options = parsed.coommaSepartedOptions
                            .split(',')
                            .map((v: string, oi: number) => ({
                                id: `${index}_opt_${oi}`,
                                value: v.trim(),
                                disabled: true,
                            }));
                    }
                } catch { /* ignore parse errors */ }
            }

            result.push(transformed);
        });

        // An institute whose DEFAULT set is missing one of the three (or dropped it from
        // Settings) still gets it here, required to start with — same top-up the campaign
        // builder already does.
        const sorted = result.sort((a, b) => a.order - b.order);
        return withBuiltInRegistrationFields(
            sorted,
            (field) => ({ key: field.key, label: field.name, type: field.type }),
            (builtIn, index) => ({
                id: String(index),
                type: 'text',
                name: builtIn.label,
                oldKey: true,
                isRequired: true,
                key: builtIn.key,
                order: index,
                status: 'ACTIVE' as const,
            })
        );
    } catch (err) {
        console.error('[getInviteListCustomFieldsAsync] API call failed, using fallback defaults:', err);
        return getDefaultInviteFields(t);
    }
};

/**
 * Refresh custom fields for invite list (call this when custom fields are updated)
 */
export const refreshInviteListCustomFields = (): InviteFormCustomField[] => {
    return getInviteListCustomFields();
};
