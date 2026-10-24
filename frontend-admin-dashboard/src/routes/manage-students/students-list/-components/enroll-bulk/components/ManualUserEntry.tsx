import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PhoneInput from 'react-phone-input-2';
import 'react-phone-input-2/lib/bootstrap.css';
import { isValidPhoneValue } from '@/lib/phone-validation';
import { MyButton } from '@/components/design-system/button';
import { Plus, Trash, CaretDown, CaretUp } from '@phosphor-icons/react';
import { NewUserRow, CustomFieldValue } from '../../../-types/bulk-assign-types';
import {
    getCustomFieldSettingsFromCache,
    CustomField,
} from '@/services/custom-field-settings';
import { useUserIdentifierSetting } from '@/services/user-identifier-setting';
import { useLearnerUsernamePolicy } from '@/services/student-display-settings';
import { getPreferredPhoneCountries } from '@/services/domain-routing';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { noAutofillProps } from '@/lib/no-autofill';
import { AutofillDecoy } from '@/components/design-system/autofill-decoy';

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
}

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
        const settings = getCustomFieldSettingsFromCache();
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

        // Custom fields with learnerEnrollment visibility
        const cfFields = (settings?.customFields ?? []).filter(
            (cf: CustomField) => cf.visibility?.learnerEnrollment === true
        );

        return { visibleSystemFields: sysFields, enrollmentCustomFields: cfFields };
    }, [t]);

    const hasExtraFields = visibleSystemFields.length > 0 || enrollmentCustomFields.length > 0;

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

    const validate = (row: EditableRow) => {
        if (!row.full_name.trim()) return false;
        const phone = row.mobile_number?.trim();
        if (phoneRequired) {
            return isValidPhoneValue(phone);
        }
        // Optional phone: when provided it must be a valid number for its country.
        if (phone && !isValidPhoneValue(phone)) return false;
        return !!row.email.trim();
    };

    const handleAdd = () => {
        setSubmitted(true);
        const valid = rows.filter(validate);
        if (valid.length === 0) return;

        onAdd(valid.map(editableRowToNewUser));
        setRows([emptyRow()]);
        setSubmitted(false);
    };

    const handleEditSave = () => {
        setSubmitted(true);
        const row = rows[0];
        if (!row || !validate(row)) return;
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
                                    {...noAutofillProps('text')}
                                />
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

                                    {/* Custom fields */}
                                    {enrollmentCustomFields.map((cf: CustomField) => (
                                        <div key={cf.id}>
                                            <Label className="mb-1 text-xs text-neutral-500">
                                                {cf.name}
                                                {cf.required && (
                                                    <span className="ml-1 text-danger-500">*</span>
                                                )}
                                            </Label>
                                            {cf.type === 'dropdown' && cf.options ? (
                                                <select
                                                    className="flex h-9 w-full rounded-md border border-neutral-200 bg-white px-3 py-1 text-sm transition-colors focus:border-primary-500 focus:outline-none"
                                                    value={row.custom_fields[cf.id] || ''}
                                                    onChange={(e) =>
                                                        updateCustomField(
                                                            idx,
                                                            cf.id,
                                                            e.target.value
                                                        )
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
                                                    type={
                                                        cf.type === 'number'
                                                            ? 'number'
                                                            : 'text'
                                                    }
                                                    placeholder={t('extra.enterPlaceholder', { name: cf.name })}
                                                    value={row.custom_fields[cf.id] || ''}
                                                    onChange={(e) =>
                                                        updateCustomField(
                                                            idx,
                                                            cf.id,
                                                            e.target.value
                                                        )
                                                    }
                                                />
                                            )}
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
                    >
                        {t('actions.addLearners', { count: rows.filter(validate).length })}
                    </MyButton>
                </div>
            )}
        </div>
    );
};
