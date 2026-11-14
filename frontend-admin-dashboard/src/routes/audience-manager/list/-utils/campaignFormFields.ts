/**
 * Field conversion for the audience campaign form — the two directions a
 * registration form's custom fields travel:
 *
 *   API  → editor   `convertExistingCustomFields`
 *   editor → API    `convertFieldsToPayload`
 *
 * Kept out of the component so both directions are unit-testable: a field's
 * type, its options and its position all have to survive the round trip, and
 * every one of them has been silently lost at some point.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    configHoldsOptions,
    isOptionFieldType,
    parseFieldOptionsForForm,
} from './parseFieldOptions';

export const generateKeyFromName = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

/**
 * The field_key the backend gives a NEW field — a mirror of
 * `CustomFieldKeyGenerator.generateFieldKey`. A field without a master id is
 * keyed from its label on save and whatever key the client sends is ignored,
 * so a dependent dropdown pointing at a parent that is not saved yet has to
 * predict this exactly.
 */
export const backendFieldKeyFor = (name: string, instituteId: string): string => {
    let key = name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!key || /^[0-9]/.test(key)) key = `field_${key}`;
    if (key.length < 2) key = `${key}_field`;
    return `${key}_inst_${instituteId}`;
};

/**
 * The field_key a campaign field has, or will get when the form is saved.
 * This is what a dependent dropdown stores as `parentFieldKey`. A saved field
 * keeps its key through a rename; an unsaved one is keyed from its label.
 */
export const savedFieldKeyOf = (field: any, instituteId: string): string => {
    const masterId = field?.custom_field_data?.id || field?._id;
    if (masterId) {
        return field.custom_field_data?.fieldKey || field.fieldKey || field.key || '';
    }
    return field?.name?.trim() ? backendFieldKeyFor(field.name.trim(), instituteId) : '';
};

export const isDropdownFieldType = (type?: string): boolean => {
    const normalized = (type || '').toLowerCase();
    return normalized === 'dropdown' || normalized === 'select';
};

/**
 * Points every dropdown that depends on `fromKey` at `toKey` — or, with
 * `toKey` null (parent deleted / no longer a dropdown), makes it independent
 * again by clearing its `parentFieldKey` and every option's `parent`.
 */
export const retargetDependentFields = <T extends Record<string, any>>(
    fields: T[],
    fromKey: string,
    toKey: string | null
): T[] => {
    if (!fromKey || fromKey === toKey) return fields;
    return fields.map((field) => {
        if (field?.config?.parentFieldKey !== fromKey) return field;
        if (toKey) return { ...field, config: { ...field.config, parentFieldKey: toKey } };
        const { parentFieldKey, ...config } = field.config;
        void parentFieldKey;
        return {
            ...field,
            config,
            options: field.options?.map(({ parent, ...option }: any) => {
                void parent;
                return option;
            }),
        };
    });
};

/**
 * Each editor row is keyed by `id` — React key, drag-and-drop identity, and the
 * `findIndex` that turns a drop into a move. Two rows sharing an id leave a
 * stale copy of one on screen after a delete, and a drag can pick up the wrong
 * row. The loaders can produce such pairs (a list index on one side, the
 * hardcoded `'0'`/`'1'`/`'2'` seeds on the other), so the editor never trusts
 * them as unique.
 *
 * Only a blank or repeated id is replaced. The first holder of an id keeps it,
 * so a saved campaign's mapping ids pass through untouched. The backend never
 * reads this id back (`syncFeatureCustomFields` nulls it and matches on
 * `custom_field.id`), so a replacement changes nothing on save.
 */
export const withUniqueFieldIds = <T extends { id?: unknown }>(fields: T[]): T[] => {
    const used = new Set(
        fields.map((field) => (field.id == null ? '' : String(field.id))).filter((id) => id !== '')
    );
    const seen = new Set<string>();
    let counter = 0;
    return fields.map((field) => {
        const id = field.id == null ? '' : String(field.id);
        if (id !== '' && !seen.has(id)) {
            seen.add(id);
            return field;
        }
        let fresh = `local-${counter}`;
        while (used.has(fresh)) {
            counter += 1;
            fresh = `local-${counter}`;
        }
        used.add(fresh);
        seen.add(fresh);
        return { ...field, id: fresh };
    });
};

/**
 * Id for a field the admin is adding now. Same value as before — the list
 * length — unless a row already holds it, which happens once the loaded ids
 * are not a dense 0..n-1 run.
 */
export const nextFieldId = (fields: Array<{ id?: unknown }> | null | undefined): string => {
    const list = fields ?? [];
    const used = new Set(list.map((field) => String(field.id)));
    let next = list.length;
    while (used.has(String(next))) next += 1;
    return String(next);
};

export const mapApiFieldTypeToUi = (type?: string): string => {
    const normalized = (type || '').toLowerCase();
    if (normalized === 'select') return 'dropdown';
    if (normalized === 'textfield') return 'text';
    return normalized || 'text';
};

const parseFieldsInput = (fields?: any[] | string | null) => {
    if (!fields) {
        return null;
    }

    if (Array.isArray(fields)) {
        return fields;
    }

    if (typeof fields === 'string') {
        try {
            const parsed = JSON.parse(fields);
            if (Array.isArray(parsed)) {
                return parsed;
            }
            // console.warn('⚠️ [convertExistingCustomFields] Parsed custom fields is not an array');
        } catch (error) {
            console.error(
                '❌ [convertExistingCustomFields] Failed to parse custom fields JSON:',
                error
            );
        }
    }

    return null;
};

/**
 * The settings half of `custom_fields.config` — help text, file limits, the
 * verification gate. Returns undefined for the legacy dropdown-only shape (a
 * bare options array), which is not settings and must not be fed back to the
 * dialog as if it were.
 */
export const parseSettingsConfig = (raw?: string | null): Record<string, unknown> | undefined => {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

        // Options are NOT settings. They are owned by the field's type and are
        // rebuilt from `options` on save — carrying them here would put them
        // back after an admin switched a Dropdown to a plain Text field, which
        // is precisely the stale-option bug the save path guards against.
        const { options, commaSeparatedOptions, coommaSepartedOptions, ...settings } =
            parsed as Record<string, unknown>;
        void options;
        void commaSeparatedOptions;
        void coommaSepartedOptions;

        return Object.keys(settings).length > 0 ? settings : undefined;
    } catch {
        return undefined;
    }
};

export const convertExistingCustomFields = (fields?: any[] | string | null) => {
    const normalizedFields = parseFieldsInput(fields);

    if (!normalizedFields || normalizedFields.length === 0) {
        console.log('📋 [convertExistingCustomFields] No custom fields to convert');
        return null;
    }

    // Seeded keys: Full Name / Email / Phone Number must stay locked even in
    // edit mode. The previous code hardcoded `oldKey: false` which let admins
    // delete these system fields when editing an existing audience campaign.
    const SEEDED_KEYS = ['full_name', 'name', 'email', 'phone_number', 'phone', 'mobile_number'];
    const SEEDED_NAMES = ['full name', 'name', 'email', 'phone number', 'phone', 'mobile number'];

    const converted = normalizedFields
        .map((field, index) => {
            const meta = field?.custom_field || {};
            const fieldName = meta.fieldName || field.field_name || `Field ${index + 1}`;
            const fieldKey = meta.fieldKey || generateKeyFromName(fieldName);
            const normalizedKey = fieldKey ? fieldKey.toLowerCase() : '';
            const normalizedName = (fieldName || '').toLowerCase();
            const isSeeded =
                SEEDED_KEYS.includes(normalizedKey) || SEEDED_NAMES.includes(normalizedName);
            // The builder stores options as a JSON array; comma-splitting it turned one
            // option into several fragments and re-saving persisted the fragments.
            const uiType = mapApiFieldTypeToUi(meta.fieldType || field.type);
            const configOptions = isOptionFieldType(uiType)
                ? parseFieldOptionsForForm(
                      meta.config,
                      field.id || meta.id || field.field_id || index
                  )
                : undefined;

            // Preserve status from API - default to ACTIVE if not present
            const fieldStatus = field.status || 'ACTIVE';

            const convertedField = {
                id: field.id || meta.id || field.field_id || `${index}`,
                _id: meta.id || field.id || field.field_id,
                field_id: field.field_id || meta.id || field.id,
                type: uiType,
                name: fieldName,
                oldKey: isSeeded,
                // Per-form answer first (that is what this campaign's Required switch writes
                // and what the public form now reads), master row second.
                isRequired:
                    typeof field.is_mandatory === 'boolean'
                        ? field.is_mandatory
                        : typeof meta.isMandatory === 'boolean'
                          ? meta.isMandatory
                          : field.isRequired ?? true,
                key: fieldKey,
                // Order by the per-form mapping order (individual_order) so the editor
                // matches what the public form renders. Fall back to the master formOrder
                // (1-based) only when the mapping has no order, then to array index.
                order:
                    typeof field.individual_order === 'number'
                        ? field.individual_order
                        : typeof meta.formOrder === 'number'
                          ? Math.max(meta.formOrder - 1, 0)
                          : index,
                options: configOptions,
                // Preserve all original field data for payload
                status: fieldStatus,
                institute_id: field.institute_id,
                type_id: field.type_id,
                group_name: field.group_name || meta.groupName,
                individual_order: field.individual_order,
                group_internal_order: field.group_internal_order,
                // Store full custom_field object for payload
                custom_field_data: meta,
                // The stored settings object, so editing a field starts from the
                // help text / file limits / verification it already has.
                config: parseSettingsConfig(meta.config),
            };

            return convertedField;
        })
        .filter((field) => field.status !== 'DELETED') // Filter out deleted fields from display
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((field, index) => ({
            ...field,
            order: index,
        }));

    return withUniqueFieldIds(converted);
};

export const mapFieldTypeToPayload = (type?: string) => {
    if (!type) return 'TEXT';
    const normalized = type.toLowerCase();
    switch (normalized) {
        case 'text':
        case 'textfield':
            return 'TEXT';
        // Not folded into TEXT: the picker offers Text Area as its own type, so
        // collapsing it here made every saved text area come back as a text field.
        case 'textarea':
            return 'TEXTAREA';
        case 'number':
            return 'NUMBER';
        case 'email':
            return 'EMAIL';
        case 'date':
            return 'DATE';
        case 'dropdown':
        case 'select':
            return 'DROPDOWN';
        default:
            return normalized.toUpperCase();
    }
};

export const convertFieldsToPayload = (fields: any[], instituteId: string) => {
    if (!Array.isArray(fields) || fields.length === 0) return [];

    return fields.map((field, index) => {
        const optionEntries: Array<{ value: string; parent?: string }> | undefined =
            Array.isArray(field.options) && field.options.length > 0
                ? field.options
                      .map((option: any) => ({
                          value: option.value?.trim(),
                          parent: typeof option.parent === 'string' ? option.parent.trim() : '',
                      }))
                      .filter((entry: { value?: string }) => Boolean(entry.value))
                : undefined;
        // A dependent (cascading) dropdown saves the object form so each option
        // can carry its parent value. Every other choice field keeps saving the
        // bare array it always has.
        const parentFieldKey =
            isDropdownFieldType(field.type) && typeof field.config?.parentFieldKey === 'string'
                ? field.config.parentFieldKey.trim()
                : '';
        const optionList = optionEntries?.map((entry, i) => ({
            id: i + 1,
            value: entry.value,
            label: entry.value,
            ...(parentFieldKey && entry.parent ? { parent: entry.parent } : {}),
        }));

        // Use existing field data if available (from API), otherwise create new structure
        const fieldId = field.id || field._id || field.field_id;
        const customFieldData = field.custom_field_data || field.custom_field || {};

        // Build the payload according to the required structure
        const payload: any = {
            ...(fieldId && { id: fieldId }),
            field_id: field.field_id || customFieldData.id || fieldId,
            institute_id: field.institute_id || instituteId,
            type: '',
            type_id: '',
            group_name: field.group_name || customFieldData.groupName || '',
            status: field.status || 'ACTIVE', // Preserve status (ACTIVE or DELETED)
            // Per-form required-ness. The public form still renders the master
            // flag, but the mapping is the per-form home for it, so keep it in
            // step instead of leaving it at its insert-time default.
            is_mandatory: Boolean(
                typeof field.isRequired === 'boolean'
                    ? field.isRequired
                    : field.custom_field_data?.isMandatory ?? true
            ),
            // Persist the current on-screen order so reordering in the editor
            // actually updates the effective per-form order the public form reads.
            // The array index is the display order and stays dense after a delete,
            // whereas a carried-over `field.order` leaves holes.
            individual_order: index,
            group_internal_order: field.group_internal_order ?? 0,
            custom_field: {
                ...((customFieldData.id || field._id) && {
                    id: customFieldData.id || field._id,
                }),
                ...(customFieldData.guestId && { guestId: customFieldData.guestId }),
                fieldKey: field.key || customFieldData.fieldKey || generateKeyFromName(field.name),
                fieldName: field.name || customFieldData.fieldName || `Field ${index + 1}`,
                fieldType: mapFieldTypeToPayload(field.type || customFieldData.fieldType),
                defaultValue: customFieldData.defaultValue || '',
                // Switching a choice field to a plain type must not leave its old
                // option list behind; a settings object (help text, file limits)
                // belongs to the field itself and is preserved.
                config: optionList
                    ? parentFieldKey
                        ? JSON.stringify({ ...field.config, options: optionList, parentFieldKey })
                        : JSON.stringify(optionList)
                    : // What the admin just set in the dialog wins over the copy
                      // loaded from the API, which is what makes an edit stick.
                      // PRESENCE decides, not emptiness: clearing the last
                      // setting leaves an empty object, and treating that as
                      // "nothing was edited" would fall through and restore the
                      // stale API config — turning a switch off would not stick.
                      field.config !== undefined
                      ? Object.keys(field.config).length > 0
                          ? JSON.stringify(field.config)
                          : ''
                      : configHoldsOptions(customFieldData.config)
                        ? ''
                        : customFieldData.config || '',
                // Only read for brand-new master rows — the backend leaves form_order
                // alone on an existing field so one form cannot reshuffle the
                // shared catalog every other form inherits.
                formOrder: index + 1,
                isMandatory: Boolean(
                    typeof field.isRequired === 'boolean'
                        ? field.isRequired
                        : customFieldData.isMandatory ?? true
                ),
                isFilter: customFieldData.isFilter ?? false,
                isSortable: customFieldData.isSortable ?? false,
                isHidden: customFieldData.isHidden ?? false,
                ...(customFieldData.createdAt && { createdAt: customFieldData.createdAt }),
                ...(customFieldData.updatedAt && { updatedAt: customFieldData.updatedAt }),
                ...(customFieldData.sessionId && { sessionId: customFieldData.sessionId }),
                ...(customFieldData.liveSessionId && {
                    liveSessionId: customFieldData.liveSessionId,
                }),
                customFieldValue: customFieldData.customFieldValue || '',
                groupName: field.group_name || customFieldData.groupName || '',
                groupInternalOrder: field.group_internal_order ?? 0,
                individualOrder: index,
            },
        };

        return payload;
    });
};
