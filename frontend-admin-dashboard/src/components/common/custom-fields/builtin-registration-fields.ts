import { FieldRole, classifyFieldRole } from './field-roles';

/**
 * The three fields every registration form starts with: who the person is, and the two ways to
 * reach them.
 *
 * They are seeded from the institute's DEFAULT_CUSTOM_FIELD set, which is fine for institutes that
 * have one — but a fresh institute has no defaults at all, and an institute that removed one of
 * the three from Settings never gets it back. Both cases used to produce a registration form that
 * silently collected nothing, or collected no phone number. Every builder now tops its seed up
 * with whichever of the three is missing.
 *
 * Required by default, and only by default: the admin can turn any of them off (or rename,
 * reorder, remove them) from the form builder afterwards.
 */
export interface BuiltInRegistrationField {
    key: string;
    label: string;
    /** The field type to create it with. Plain text is the safe shape everything already renders. */
    type: 'text' | 'email' | 'phone';
    role: FieldRole;
}

export const BUILT_IN_REGISTRATION_FIELDS: BuiltInRegistrationField[] = [
    { key: 'full_name', label: 'Full Name', type: 'text', role: FieldRole.NAME },
    { key: 'email', label: 'Email', type: 'email', role: FieldRole.EMAIL },
    { key: 'phone_number', label: 'Phone Number', type: 'phone', role: FieldRole.PHONE },
];

/**
 * Words that mark a field as being about someone OTHER than the person registering. Without this,
 * an institute whose default set happens to carry "Parent Name" or "School Name" would be read as
 * already collecting the registrant's name and never get a Full Name field — and one with
 * "Parent Email" would never get an Email field.
 */
const SOMEONE_ELSE = [
    'parent',
    'guardian',
    'father',
    'mother',
    'spouse',
    'emergency',
    'alternate',
    'alternative',
    'secondary',
    'school',
    'college',
    'institute',
    'organisation',
    'organization',
    'company',
    'office',
    'referr',
];

const isRegistrantsOwnField = (field: { key?: string | null; label?: string | null }) => {
    const haystack = `${field.key ?? ''} ${field.label ?? ''}`.toLowerCase();
    return !SOMEONE_ELSE.some((word) => haystack.includes(word));
};

/**
 * True when `fields` already carries a field playing this role FOR THE REGISTRANT — matched by
 * role, not by key, so an institute whose default set calls it "Mobile Number", "name" or
 * "E-mail" is not handed a second copy. Institute-suffixed keys
 * (`phone_number_inst_<uuid>`) resolve the same way.
 */
const rolePresent = (
    fields: { key?: string | null; label?: string | null; type?: string | null }[],
    role: FieldRole
) =>
    fields.some(
        (field) =>
            isRegistrantsOwnField(field) &&
            classifyFieldRole({ type: field.type, fieldKey: field.key, label: field.label }) === role
    );

/**
 * True when this field IS one of the three built-ins — the registrant's own name, email or phone
 * — however the institute worded it.
 *
 * Seeding used to decide that from a hardcoded label list (`'full name' | 'email' | 'phone number'
 * | 'mobile number'`), which missed every institute that simply calls it "Name" (302 default rows
 * across 295 institutes) or "E-mail". Those fields fell through to the institute's stored flag,
 * and that flag is `false` on the overwhelming majority of default rows (567 of 590 email rows,
 * 260 of 279 phone rows) — so the form opened with Required already off.
 */
export const isBuiltInRegistrationField = (field: {
    key?: string | null;
    label?: string | null;
    type?: string | null;
}): boolean => {
    if (!isRegistrantsOwnField(field)) return false;
    const role = classifyFieldRole({ type: field.type, fieldKey: field.key, label: field.label });
    return BUILT_IN_REGISTRATION_FIELDS.some((builtIn) => builtIn.role === role);
};

/**
 * Returns `fields` with any of the three built-ins it is missing appended, built by the caller's
 * own `make` (each builder stores fields in its own shape). Order of the existing fields is left
 * exactly as it was — a top-up must never reshuffle a form an admin has already arranged.
 */
export const withBuiltInRegistrationFields = <T>(
    fields: T[],
    read: (field: T) => { key?: string | null; label?: string | null; type?: string | null },
    make: (builtIn: BuiltInRegistrationField, index: number) => T
): T[] => {
    const existing = fields.map(read);
    const missing = BUILT_IN_REGISTRATION_FIELDS.filter(
        (builtIn) => !rolePresent(existing, builtIn.role)
    );
    return [...fields, ...missing.map((builtIn, i) => make(builtIn, fields.length + i))];
};
