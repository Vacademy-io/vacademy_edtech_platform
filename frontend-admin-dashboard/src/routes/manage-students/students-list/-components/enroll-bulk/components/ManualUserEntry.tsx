import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PhoneInput from 'react-phone-input-2';
import 'react-phone-input-2/lib/bootstrap.css';
import { isValidPhoneValue } from '@/lib/phone-validation';
import { MyButton } from '@/components/design-system/button';
import {
    Plus,
    Trash,
    CaretDown,
    CaretUp,
    CheckCircle,
    CircleNotch,
    Info,
    WarningCircle,
} from '@phosphor-icons/react';
import { NewUserRow, CustomFieldValue } from '../../../-types/bulk-assign-types';
import {
    getCustomFieldSettings,
    getCustomFieldSettingsFromCache,
    getEnrollmentFormCustomFields,
    CustomField,
    CustomFieldSettingsData,
} from '@/services/custom-field-settings';
import { useUserIdentifierSetting } from '@/services/user-identifier-setting';
import { useLearnerUsernamePolicy } from '@/services/student-display-settings';
import { checkUsernameAvailability } from '@/services/username-availability';
import { getPreferredPhoneCountries } from '@/services/domain-routing';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { noAutofillProps } from '@/lib/no-autofill';
import { AutofillDecoy } from '@/components/design-system/autofill-decoy';
import { CustomFieldRenderer } from '@/components/common/custom-fields/CustomFieldRenderer';
import { isOptionFieldType } from '@/routes/audience-manager/list/-utils/parseFieldOptions';
import { cn } from '@/lib/utils';

// field_type is stored as dropdown / DROPDOWN / select / radio / multi_select depending on
// where the field was created, so an exact 'dropdown' check left most choice fields as text.
const choiceKindOf = (cf: CustomField): 'single' | 'multi' | null => {
    if (!cf.options?.length || !isOptionFieldType(cf.type)) return null;
    const type = (cf.type ?? '').toLowerCase().trim();
    return type === 'multi_select' || type === 'multiselect' ? 'multi' : 'single';
};

interface Props {
    onAdd: (rows: NewUserRow[]) => void;
    /** When provided, renders a single pre-filled row in edit mode. */
    editingRow?: NewUserRow;
    onEditSave?: (row: NewUserRow) => void;
    onEditCancel?: () => void;
}

// Internal row state (extends NewUserRow with a custom_fields Record for easy editing)
interface EditableRow {
    email: string;
    full_name: string;
    mobile_number: string;
    username: string;
    password: string;
    gender: string;
    date_of_birth: string;
    address_line: string;
    city: string;
    region: string;
    pin_code: string;
    fathers_name: string;
    mothers_name: string;
    parents_mobile_number: string;
    parents_email: string;
    parents_to_mother_mobile_number: string;
    parents_to_mother_email: string;
    linked_institute_name: string;
    /** custom_field_id → value */
    custom_fields: Record<string, string>;
    /** Whether the "extra fields" section is expanded */
    expanded: boolean;
    /** Last username availability answer, for the inputs in `key` */
    username_check?: UsernameCheck;
}

type UsernameCheckState = 'checking' | 'available' | 'existing' | 'taken';

interface UsernameCheck {
    key: string;
    state: UsernameCheckState;
}

const typedUsername = (r: EditableRow) => r.username.replace(/\s/g, '');

// The answer depends on the email and phone too: a username that is this same
// learner's own counts as free. A change to any of the three makes it stale.
const usernameCheckKey = (r: EditableRow) =>
    [typedUsername(r), r.email.trim().toLowerCase(), r.mobile_number?.trim() ?? ''].join('|');

const currentUsernameCheck = (r: EditableRow): UsernameCheckState | null =>
    r.username_check?.key === usernameCheckKey(r) ? r.username_check.state : null;

const UsernameCheckNote = ({ state, t }: { state: UsernameCheckState | null; t: TFunction }) => {
    if (!state) return null;
    return (
        <p
            className={cn(
                'mt-1 flex items-center gap-1 text-xs',
                state === 'taken' && 'text-danger-600',
                state === 'available' && 'text-success-600',
                state === 'existing' && 'text-info-600',
                state === 'checking' && 'text-neutral-500'
            )}
        >
            {state === 'checking' && <CircleNotch size={12} className="animate-spin" />}
            {state === 'available' && <CheckCircle size={12} weight="fill" />}
            {state === 'existing' && <Info size={12} weight="fill" />}
            {state === 'taken' && <WarningCircle size={12} weight="fill" />}
            {state === 'checking' && t('core.usernameChecking')}
            {state === 'available' && t('core.usernameAvailable')}
            {state === 'existing' && t('core.usernameExisting')}
            {state === 'taken' && t('core.usernameTaken')}
        </p>
    );
};

const emptyRow = (): EditableRow => ({
    email: '',
    full_name: '',
    mobile_number: '',
    username: '',
    password: '',
    gender: '',
    date_of_birth: '',
    address_line: '',
    city: '',
    region: '',
    pin_code: '',
    fathers_name: '',
    mothers_name: '',
    parents_mobile_number: '',
    parents_email: '',
    parents_to_mother_mobile_number: '',
    parents_to_mother_email: '',
    linked_institute_name: '',
    custom_fields: {},
    expanded: false,
});

const rowFromNewUser = (u: NewUserRow): EditableRow => {
    const cf: Record<string, string> = {};
    for (const v of u.custom_field_values || []) cf[v.custom_field_id] = v.value;
    return {
        email: u.email || '',
        full_name: u.full_name || '',
        mobile_number: u.mobile_number || '',
        username: u.username || '',
        password: u.password || '',
        gender: u.gender || '',
        date_of_birth: u.date_of_birth || '',
        address_line: u.address_line || '',
        city: u.city || '',
        region: u.region || '',
        pin_code: u.pin_code || '',
        fathers_name: u.fathers_name || '',
        mothers_name: u.mothers_name || '',
        parents_mobile_number: u.parents_mobile_number || '',
        parents_email: u.parents_email || '',
        parents_to_mother_mobile_number: u.parents_to_mother_mobile_number || '',
        parents_to_mother_email: u.parents_to_mother_email || '',
        linked_institute_name: u.linked_institute_name || '',
        custom_fields: cf,
        expanded: true,
    };
};

const editableRowToNewUser = (r: EditableRow): NewUserRow => {
    const cfValues: CustomFieldValue[] = [];
    for (const [cfId, val] of Object.entries(r.custom_fields)) {
        if (val?.trim()) {
            cfValues.push({ custom_field_id: cfId, value: val.trim() });
        }
    }
    return {
        email: r.email.trim(),
        full_name: r.full_name.trim(),
        mobile_number: r.mobile_number?.trim() || undefined,
        // Usernames must never contain spaces — strip all whitespace, not just ends
        username: r.username?.replace(/\s/g, '') || undefined,
        password: r.password?.trim() || undefined,
        gender: r.gender?.trim() || undefined,
        date_of_birth: r.date_of_birth?.trim() || undefined,
        address_line: r.address_line?.trim() || undefined,
        city: r.city?.trim() || undefined,
        region: r.region?.trim() || undefined,
        pin_code: r.pin_code?.trim() || undefined,
        fathers_name: r.fathers_name?.trim() || undefined,
        mothers_name: r.mothers_name?.trim() || undefined,
        parents_mobile_number: r.parents_mobile_number?.trim() || undefined,
        parents_email: r.parents_email?.trim() || undefined,
        parents_to_mother_mobile_number: r.parents_to_mother_mobile_number?.trim() || undefined,
        parents_to_mother_email: r.parents_to_mother_email?.trim() || undefined,
        linked_institute_name: r.linked_institute_name?.trim() || undefined,
        custom_field_values: cfValues.length > 0 ? cfValues : undefined,
    };
};

// Map system field key → EditableRow field key + input type. Built from `t` so
// placeholders re-localize when the active language changes.
const buildSystemFieldMap = (
    t: TFunction
): Record<string, { rowKey: keyof EditableRow; inputType: string; placeholder: string }> => ({
    GENDER: {
        rowKey: 'gender',
        inputType: 'text',
        placeholder: t('fields.gender.placeholder'),
    },
    DATE_OF_BIRTH: {
        rowKey: 'date_of_birth',
        inputType: 'date',
        placeholder: t('fields.dateOfBirth.placeholder'),
    },
    ADDRESS_LINE: {
        rowKey: 'address_line',
        inputType: 'text',
        placeholder: t('fields.addressLine.placeholder'),
    },
    CITY: { rowKey: 'city', inputType: 'text', placeholder: t('fields.city.placeholder') },
    REGION: {
        rowKey: 'region',
        inputType: 'text',
        placeholder: t('fields.region.placeholder'),
    },
    PIN_CODE: {
        rowKey: 'pin_code',
        inputType: 'text',
        placeholder: t('fields.pinCode.placeholder'),
    },
    LINKED_INSTITUTE_NAME: {
        rowKey: 'linked_institute_name',
        inputType: 'text',
        placeholder: t('fields.linkedInstituteName.placeholder'),
    },
    FATHER_NAME: {
        rowKey: 'fathers_name',
        inputType: 'text',
        placeholder: t('fields.fathersName.placeholder'),
    },
    MOTHER_NAME: {
        rowKey: 'mothers_name',
        inputType: 'text',
        placeholder: t('fields.mothersName.placeholder'),
    },
    PARENTS_MOBILE_NUMBER: {
        rowKey: 'parents_mobile_number',
        inputType: 'tel',
        placeholder: t('fields.parentsMobileNumber.placeholder'),
    },
    PARENTS_EMAIL: {
        rowKey: 'parents_email',
        inputType: 'email',
        placeholder: t('fields.parentsEmail.placeholder'),
    },
    PARENTS_TO_MOTHER_MOBILE_NUMBER: {
        rowKey: 'parents_to_mother_mobile_number',
        inputType: 'tel',
        placeholder: t('fields.parentsToMotherMobileNumber.placeholder'),
    },
    PARENTS_TO_MOTHER_EMAIL: {
        rowKey: 'parents_to_mother_email',
        inputType: 'email',
        placeholder: t('fields.parentsToMotherEmail.placeholder'),
    },
});

// System fields that are excluded from the form (handled in other steps)
const EXCLUDED_SYSTEM_KEYS = new Set([
    'FULL_NAME',
    'EMAIL',
    'MOBILE_NUMBER',
    'USERNAME',
    'PACKAGE_SESSION_ID',
    'INSTITUTE_ENROLLMENT_ID',
    'ATTENDANCE',
    'COUNTRY',
    'PLAN_TYPE',
    'AMOUNT_PAID',
    'PREFFERED_BATCH',
    'EXPIRY_DATE',
    'STATUS',
]);

interface VisibleSystemField {
    key: string;
    label: string;
    rowKey: keyof EditableRow;
    inputType: string;
    placeholder: string;
}

export const ManualUserEntry = ({ onAdd, editingRow, onEditSave, onEditCancel }: Props) => {
    const { t } = useTranslation('manageStudentsManualUserEntry');
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const isEditMode = !!editingRow;
    const { data: userIdentifier } = useUserIdentifierSetting();
    const phoneRequired = userIdentifier === 'PHONE';
    // Settings → Login & Signup can make the username rule replace a typed one;
    // then the box is locked (showing the email when the rule is Email).
    const usernamePolicy = useLearnerUsernamePolicy();
    const usernameLocked = usernamePolicy.overridesTyped;

    const [rows, setRows] = useState<EditableRow[]>(() =>
        editingRow ? [rowFromNewUser(editingRow)] : [emptyRow()],
    );
    const [submitted, setSubmitted] = useState(false);
    const [checkingUsernames, setCheckingUsernames] = useState(false);

    // Institute field settings. The cache is empty when this dialog opens from a
    // page that never loaded them (course, batch), so fetch instead of showing
    // no custom fields at all.
    const [fieldSettings, setFieldSettings] = useState<CustomFieldSettingsData | null>(() =>
        getCustomFieldSettingsFromCache()
    );
    useEffect(() => {
        if (fieldSettings) return;
        getCustomFieldSettings()
            .then(setFieldSettings)
            .catch((err) => console.error('Failed to load custom field settings:', err));
    }, [fieldSettings]);

    // Default selected country + picker order from the institute's preferred countries.
    const { defaultCountry, preferredCountries } = useMemo(
        () => getPreferredPhoneCountries(),
        [],
    );

    // Reset form whenever edit target changes — entering edit (load row),
    // switching edit target (reload row), or exiting edit (back to empty add).
    useEffect(() => {
        setRows(editingRow ? [rowFromNewUser(editingRow)] : [emptyRow()]);
        setSubmitted(false);
    }, [editingRow]);

    // ─── Compute dynamic fields from institute settings ────
    const { visibleSystemFields, enrollmentCustomFields } = useMemo(() => {
        const settings = fieldSettings;
        const systemFieldMap = buildSystemFieldMap(t);

        // System fields
        const sysFields: VisibleSystemField[] = [];
        if (settings?.systemFields) {
            for (const sf of settings.systemFields) {
                if (!sf.visibility) continue;
                if (EXCLUDED_SYSTEM_KEYS.has(sf.key)) continue;
                const mapping = systemFieldMap[sf.key];
                if (!mapping) continue;
                sysFields.push({
                    key: sf.key,
                    label: sf.customValue || sf.defaultValue,
                    rowKey: mapping.rowKey,
                    inputType: mapping.inputType,
                    placeholder: mapping.placeholder,
                });
            }
        } else {
            // Fallback: show gender only if no settings
            sysFields.push({
                key: 'GENDER',
                label: t('fields.gender.label'),
                rowKey: 'gender',
                inputType: 'text',
                placeholder: t('fields.gender.placeholder'),
            });
        }

        // Required custom fields + the ones switched on for "Learner's Enrollment"
        return {
            visibleSystemFields: sysFields,
            enrollmentCustomFields: getEnrollmentFormCustomFields(settings),
        };
    }, [t, fieldSettings]);

    // Custom fields sit with the core fields; only optional system fields stay
    // behind "More fields".
    const hasExtraFields = visibleSystemFields.length > 0;

    const update = (idx: number, field: keyof EditableRow, value: string) => {
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
    };

    const updateCustomField = (idx: number, cfId: string, value: string) => {
        setRows((prev) =>
            prev.map((r, i) =>
                i === idx ? { ...r, custom_fields: { ...r.custom_fields, [cfId]: value } } : r
            )
        );
    };

    const toggleExpanded = (idx: number) => {
        setRows((prev) =>
            prev.map((r, i) => (i === idx ? { ...r, expanded: !r.expanded } : r))
        );
    };

    const addRow = () => setRows((prev) => [...prev, emptyRow()]);

    const removeRow = (idx: number) =>
        setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

    const isMissingRequired = (row: EditableRow, cf: CustomField) =>
        cf.required && !row.custom_fields[cf.id]?.trim();

    const validate = (row: EditableRow) => {
        if (!row.full_name.trim()) return false;
        if (enrollmentCustomFields.some((cf) => isMissingRequired(row, cf))) return false;
        const phone = row.mobile_number?.trim();
        if (phoneRequired) {
            return isValidPhoneValue(phone);
        }
        // Optional phone: when provided it must be a valid number for its country.
        if (phone && !isValidPhoneValue(phone)) return false;
        return !!row.email.trim();
    };

    // ─── Username availability ────
    // A username is unique across the whole platform. Typing one that already
    // belongs to someone else must not go through: tell the admin to pick another.
    const needsUsernameCheck = (row: EditableRow) => !usernameLocked && !!typedUsername(row);

    const setUsernameCheck = (key: string, check: UsernameCheck | undefined) =>
        setRows((prev) =>
            prev.map((r) => (usernameCheckKey(r) === key ? { ...r, username_check: check } : r))
        );

    // Fails open: when the check itself errors the row goes through, and the
    // server gives a taken name a suffix instead of re-using someone's account.
    const isUsernameFree = async (row: EditableRow): Promise<boolean> => {
        const key = usernameCheckKey(row);
        const known = currentUsernameCheck(row);
        if (known && known !== 'checking') return known !== 'taken';
        setUsernameCheck(key, { key, state: 'checking' });
        try {
            const answer = await checkUsernameAvailability({
                username: typedUsername(row),
                email: row.email.trim(),
                mobile_number: row.mobile_number?.trim(),
            });
            // A learner already in this institute is allowed: that learner gets enrolled.
            const state: UsernameCheckState = !answer.available
                ? 'taken'
                : answer.existingLearner
                  ? 'existing'
                  : 'available';
            setUsernameCheck(key, { key, state });
            return answer.available;
        } catch (err) {
            console.error('Username availability check failed:', err);
            setUsernameCheck(key, undefined);
            return true;
        }
    };

    const checkUsernameOnBlur = (idx: number) => {
        const row = rows[idx];
        if (row && needsUsernameCheck(row)) void isUsernameFree(row);
    };

    /** Rows whose username belongs to someone else, or repeats one earlier in this batch. */
    const findTakenUsernames = async (candidates: EditableRow[]) => {
        const taken = new Set<EditableRow>();
        const seen = new Set<string>();
        let repeated: string | null = null;
        for (const row of candidates.filter(needsUsernameCheck)) {
            const name = typedUsername(row).toLowerCase();
            if (seen.has(name)) {
                taken.add(row);
                repeated = repeated ?? typedUsername(row);
            }
            seen.add(name);
        }
        const toCheck = candidates.filter((r) => needsUsernameCheck(r) && !taken.has(r));
        const free = await Promise.all(toCheck.map(isUsernameFree));
        const takenByOthers = toCheck.filter((_, i) => !free[i]);
        takenByOthers.forEach((r) => taken.add(r));

        const [firstTaken] = takenByOthers;
        if (takenByOthers.length === 1 && firstTaken) {
            toast.error(t('toast.usernameTaken', { username: typedUsername(firstTaken) }));
        } else if (takenByOthers.length > 1) {
            toast.error(t('toast.usernamesTaken'));
        }
        if (repeated) toast.error(t('toast.usernameDuplicate', { username: repeated }));
        return taken;
    };

    const markTaken = (row: EditableRow): EditableRow => ({
        ...row,
        username_check: { key: usernameCheckKey(row), state: 'taken' },
    });

    const handleAdd = async () => {
        setSubmitted(true);
        const valid = rows.filter(validate);
        if (valid.length === 0) return;

        setCheckingUsernames(true);
        const taken = await findTakenUsernames(valid).finally(() => setCheckingUsernames(false));
        const ready = valid.filter((row) => !taken.has(row));

        if (ready.length > 0) onAdd(ready.map(editableRowToNewUser));
        // Keep typed-in rows that still fail (e.g. a required custom field left
        // blank, or a username that is taken) so the admin can finish them instead
        // of losing them silently. Blank extra rows are still dropped, as before.
        const pending = rows
            .filter((row) => !ready.includes(row) && !!(row.full_name.trim() || row.email.trim()))
            .map((row) => (taken.has(row) ? markTaken(row) : row));
        setRows(pending.length > 0 ? pending : [emptyRow()]);
        setSubmitted(pending.length > 0);
    };

    const handleEditSave = async () => {
        setSubmitted(true);
        const row = rows[0];
        if (!row || !validate(row)) return;

        setCheckingUsernames(true);
        const taken = await findTakenUsernames([row]).finally(() => setCheckingUsernames(false));
        if (taken.has(row)) {
            setRows([markTaken(row)]);
            return;
        }
        onEditSave?.(editableRowToNewUser(row));
    };

    const emailLabel = phoneRequired ? t('core.emailLabelOptional') : t('core.emailLabel');
    const mobileLabel = phoneRequired ? t('core.mobileLabel') : t('core.mobileLabelOptional');

    return (
        <div className="flex flex-col gap-4">
            {/* These username/password fields set the LEARNER's credentials, not the
                admin's — the decoy pair soaks up any autofill Chrome insists on
                doing so the real rows stay blank (auto-generated server side). */}
            <AutofillDecoy />
            <div className="flex flex-col gap-3">
                {rows.map((row, idx) => (
                    <div
                        key={idx}
                        className="rounded-lg border border-neutral-200 bg-white p-4"
                    >
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-semibold text-neutral-500">
                                {isEditMode
                                    ? t('row.editTitle', { term: learnerTerm })
                                    : t('row.title', { term: learnerTerm, number: idx + 1 })}
                            </span>
                            <div className="flex items-center gap-2">
                                {hasExtraFields && (
                                    <button
                                        onClick={() => toggleExpanded(idx)}
                                        className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-800 transition-colors"
                                    >
                                        {row.expanded ? (
                                            <>
                                                <CaretUp size={12} /> {t('row.lessFields')}
                                            </>
                                        ) : (
                                            <>
                                                <CaretDown size={12} /> {t('row.moreFields')}
                                            </>
                                        )}
                                    </button>
                                )}
                                {!isEditMode && rows.length > 1 && (
                                    <button
                                        onClick={() => removeRow(idx)}
                                        className="text-neutral-400 hover:text-danger-500 transition-colors"
                                    >
                                        <Trash size={14} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Core fields — always visible */}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <Label className="mb-1 text-xs text-neutral-500">
                                    {emailLabel}
                                    {!phoneRequired && <span className="text-danger-500"> *</span>}
                                </Label>
                                <Input
                                    type="email"
                                    placeholder={t('core.emailPlaceholder')}
                                    value={row.email}
                                    onChange={(e) => update(idx, 'email', e.target.value)}
                                    className={
                                        submitted && !phoneRequired && !row.email.trim()
                                            ? 'border-danger-400'
                                            : ''
                                    }
                                />
                            </div>
                            <div>
                                <Label className="mb-1 text-xs text-neutral-500">
                                    {t('core.fullNameLabel')} <span className="text-danger-500">*</span>
                                </Label>
                                <Input
                                    placeholder={t('core.fullNamePlaceholder')}
                                    value={row.full_name}
                                    onChange={(e) => update(idx, 'full_name', e.target.value)}
                                    className={
                                        submitted && !row.full_name.trim()
                                            ? 'border-danger-400'
                                            : ''
                                    }
                                />
                            </div>
                            <div>
                                <Label className="mb-1 text-xs text-neutral-500">
                                    {mobileLabel}
                                    {phoneRequired && <span className="text-danger-500"> *</span>}
                                </Label>
                                <PhoneInput
                                    country={defaultCountry}
                                    preferredCountries={preferredCountries}
                                    enableSearch={true}
                                    placeholder={t('core.mobilePlaceholder')}
                                    value={row.mobile_number}
                                    onChange={(value) =>
                                        update(idx, 'mobile_number', value)
                                    }
                                    inputClass={`!w-full h-7 ${
                                        submitted &&
                                        ((phoneRequired && !isValidPhoneValue(row.mobile_number)) ||
                                            (!!row.mobile_number?.trim() &&
                                                !isValidPhoneValue(row.mobile_number)))
                                            ? '!border-danger-400'
                                            : ''
                                    }`}
                                    inputProps={{ name: `mobile_number_${idx}` }}
                                />
                            </div>
                            <div>
                                <Label className="mb-1 text-xs text-neutral-500">
                                    {t('core.usernameLabel')}
                                </Label>
                                <Input
                                    name={`learner_username_${idx}`}
                                    placeholder={
                                        usernameLocked
                                            ? t('core.usernameFromSettingPlaceholder')
                                            : t('core.autoGeneratedPlaceholder')
                                    }
                                    value={
                                        !usernameLocked
                                            ? row.username
                                            : usernamePolicy.strategy === 'email'
                                              ? row.email.trim().toLowerCase()
                                              : ''
                                    }
                                    disabled={usernameLocked}
                                    // Usernames cannot contain spaces — strip whitespace as it's typed/pasted
                                    onChange={(e) =>
                                        update(idx, 'username', e.target.value.replace(/\s/g, ''))
                                    }
                                    onBlur={() => checkUsernameOnBlur(idx)}
                                    className={cn(
                                        !usernameLocked &&
                                            currentUsernameCheck(row) === 'taken' &&
                                            'border-danger-400'
                                    )}
                                    {...noAutofillProps('text')}
                                />
                                {!usernameLocked && (
                                    <UsernameCheckNote state={currentUsernameCheck(row)} t={t} />
                                )}
                            </div>
                            <div>
                                <Label className="mb-1 text-xs text-neutral-500">
                                    {t('core.passwordLabel')}
                                </Label>
                                <Input
                                    type="password"
                                    name={`learner_password_${idx}`}
                                    placeholder={t('core.autoGeneratedPlaceholder')}
                                    value={row.password}
                                    onChange={(e) => update(idx, 'password', e.target.value)}
                                    {...noAutofillProps('password')}
                                />
                            </div>

                            {/* Custom fields — required ones + those on for "Learner's Enrollment" */}
                            {enrollmentCustomFields.map((cf: CustomField) => {
                                const missing = submitted && isMissingRequired(row, cf);
                                return (
                                    <div key={cf.id}>
                                        <Label className="mb-1 text-xs text-neutral-500">
                                            {cf.name}
                                            {cf.required && (
                                                <span className="ml-1 text-danger-500">*</span>
                                            )}
                                        </Label>
                                        {choiceKindOf(cf) === 'multi' ? (
                                            <div
                                                className={cn(
                                                    missing && 'rounded-md ring-1 ring-danger-400'
                                                )}
                                            >
                                                <CustomFieldRenderer
                                                    type="multi_select"
                                                    name={`${cf.id}-${idx}`}
                                                    options={cf.options}
                                                    value={row.custom_fields[cf.id] || ''}
                                                    onChange={(value) =>
                                                        updateCustomField(idx, cf.id, value)
                                                    }
                                                />
                                            </div>
                                        ) : choiceKindOf(cf) === 'single' && cf.options ? (
                                            <select
                                                className={cn(
                                                    'flex h-9 w-full rounded-md border border-neutral-200 bg-white px-3 py-1 text-sm transition-colors focus:border-primary-500 focus:outline-none',
                                                    missing && 'border-danger-400'
                                                )}
                                                value={row.custom_fields[cf.id] || ''}
                                                onChange={(e) =>
                                                    updateCustomField(idx, cf.id, e.target.value)
                                                }
                                            >
                                                <option value="">
                                                    {t('extra.selectOption', { name: cf.name })}
                                                </option>
                                                {cf.options.map((opt) => (
                                                    <option key={opt} value={opt}>
                                                        {opt}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <Input
                                                type={cf.type === 'number' ? 'number' : 'text'}
                                                placeholder={t('extra.enterPlaceholder', {
                                                    name: cf.name,
                                                })}
                                                value={row.custom_fields[cf.id] || ''}
                                                onChange={(e) =>
                                                    updateCustomField(idx, cf.id, e.target.value)
                                                }
                                                className={missing ? 'border-danger-400' : ''}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Expandable extra fields */}
                        {row.expanded && hasExtraFields && (
                            <div className="mt-3 border-t border-neutral-100 pt-3">
                                <p className="mb-2 text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                                    {t('extra.sectionTitle')}
                                </p>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {/* Dynamic system fields */}
                                    {visibleSystemFields.map((sf) => (
                                        <div key={sf.key}>
                                            <Label className="mb-1 text-xs text-neutral-500">
                                                {sf.label}
                                            </Label>
                                            <Input
                                                type={sf.inputType}
                                                placeholder={sf.placeholder}
                                                value={
                                                    (row[sf.rowKey] as string) || ''
                                                }
                                                onChange={(e) =>
                                                    update(idx, sf.rowKey, e.target.value)
                                                }
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {isEditMode ? (
                <div className="flex items-center justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={onEditCancel}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={handleEditSave}
                        disable={checkingUsernames}
                    >
                        {t('actions.saveChanges')}
                    </MyButton>
                </div>
            ) : (
                <div className="flex items-center gap-3">
                    <button
                        onClick={addRow}
                        className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-800 transition-colors"
                    >
                        <Plus size={14} />
                        {t('actions.addAnotherLearner')}
                    </button>
                    <div className="flex-1" />
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={handleAdd}
                        disable={checkingUsernames}
                    >
                        {t('actions.addLearners', { count: rows.filter(validate).length })}
                    </MyButton>
                </div>
            )}
        </div>
    );
};
