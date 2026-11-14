/**
 * Which "who is this person" slot a registration-form field fills.
 *
 * A public form is built entirely out of admin-defined custom fields, so there is no fixed
 * column that holds the email or the phone number — the role has to be read back off the
 * field itself. Field keys are additionally suffixed per institute by the backend's
 * `CustomFieldKeyGenerator` (`phone_number_inst_<uuid>`, plus `_1`/`_2` on collision), which
 * rules out an exact-key match.
 *
 * The keyword rule here mirrors `GuestFormFieldResolver` in admin_core_service and
 * `getFieldRenderType` in the learner app, so the builder's idea of "this is the phone field"
 * is the same one the learner form renders and the backend registers with.
 */
export enum FieldRole {
    EMAIL = 'EMAIL',
    NAME = 'NAME',
    PHONE = 'PHONE',
    OTHER = 'OTHER',
}

const EMAIL_KEYWORDS = ['email', 'e-mail', 'mail'];
const NAME_KEYWORDS = ['name'];
const PHONE_KEYWORDS = ['phone', 'mobile', 'contact', 'telephone', 'cell'];

const normalize = (value?: string | null) => (value ?? '').toLowerCase().trim();

const matches = (value: string, keywords: string[]) =>
    value.length > 0 && keywords.some((keyword) => value.includes(keyword));

/**
 * Classifies a field by its type, key and label. Email is checked before name, and name before
 * phone, so `contact_name` resolves to NAME instead of being claimed by the phone keyword
 * `contact` — the same precedence the backend uses.
 */
export const classifyFieldRole = (field: {
    type?: string | null;
    fieldKey?: string | null;
    label?: string | null;
}): FieldRole => {
    const type = normalize(field.type);
    if (type === 'email') return FieldRole.EMAIL;
    if (type === 'phone') return FieldRole.PHONE;

    const key = normalize(field.fieldKey);
    const label = normalize(field.label);

    if (matches(key, EMAIL_KEYWORDS) || matches(label, EMAIL_KEYWORDS)) return FieldRole.EMAIL;
    if (matches(key, NAME_KEYWORDS) || matches(label, NAME_KEYWORDS)) return FieldRole.NAME;
    if (matches(key, PHONE_KEYWORDS) || matches(label, PHONE_KEYWORDS)) return FieldRole.PHONE;
    return FieldRole.OTHER;
};

/**
 * A registrant is identified by their email or their mobile number — the backend rejects a
 * submission that carries neither. So a form stays usable as long as at least one of the two
 * is still required; every other field, phone included, is free to be optional.
 */
export const hasRequiredIdentityField = (
    fields: { type?: string | null; fieldKey?: string | null; label?: string | null; required?: boolean }[]
): boolean =>
    (fields ?? []).some((field) => {
        if (!field.required) return false;
        const role = classifyFieldRole(field);
        return role === FieldRole.EMAIL || role === FieldRole.PHONE;
    });
