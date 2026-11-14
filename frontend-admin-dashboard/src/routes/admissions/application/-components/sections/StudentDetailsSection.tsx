import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Registration } from '../../../-types/registration-types';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
    MAX_LENGTH,
    GENDER_OPTIONS,
    NATIONALITY_OPTIONS,
    RELIGION_OPTIONS,
    CATEGORY_OPTIONS,
    BLOOD_GROUP_OPTIONS,
    MOTHER_TONGUE_OPTIONS,
    ID_TYPE_OPTIONS,
} from '@/utils/form-validation';
import AadhaarInput from '@/components/design-system/aadhaar-input';

interface SectionProps {
    formData: Partial<Registration>;
    updateFormData: (data: Partial<Registration>) => void;
}

// `gender` values come from GENDER_OPTIONS ('MALE' | 'FEMALE' | 'OTHER'). Translate
// the known set for display; fall back to the raw value for anything unrecognized
// so new backend values never render blank. The underlying stored/compared value
// (formData.gender / SelectItem `value`) is always the raw option, never this label.
const getGenderLabel = (t: TFunction, gender: string): string => {
    switch (gender) {
        case 'MALE':
            return t('genderLabels.male');
        case 'FEMALE':
            return t('genderLabels.female');
        case 'OTHER':
            return t('genderLabels.other');
        default:
            return gender;
    }
};

const getNationalityLabel = (t: TFunction, nationality: string): string => {
    switch (nationality) {
        case 'Indian':
            return t('nationalityOptions.indian');
        case 'Other':
            return t('nationalityOptions.other');
        default:
            return nationality;
    }
};

const getReligionLabel = (t: TFunction, religion: string): string => {
    switch (religion) {
        case 'Hindu':
            return t('religionOptions.hindu');
        case 'Muslim':
            return t('religionOptions.muslim');
        case 'Christian':
            return t('religionOptions.christian');
        case 'Sikh':
            return t('religionOptions.sikh');
        case 'Jain':
            return t('religionOptions.jain');
        case 'Buddhist':
            return t('religionOptions.buddhist');
        case 'Other':
            return t('religionOptions.other');
        default:
            return religion;
    }
};

const getCategoryLabel = (t: TFunction, category: string): string => {
    switch (category) {
        case 'General':
            return t('categoryOptions.general');
        case 'OBC':
            return t('categoryOptions.obc');
        case 'SC':
            return t('categoryOptions.sc');
        case 'ST':
            return t('categoryOptions.st');
        case 'EWS':
            return t('categoryOptions.ews');
        default:
            return category;
    }
};

// Blood group codes (A+/A-/B+/...) are the same universal medical notation in
// every locale, so the translated value legitimately equals the raw code — this
// is still routed through t() (rather than hardcoded) so it stays overridable.
const getBloodGroupLabel = (t: TFunction, bloodGroup: string): string => {
    switch (bloodGroup) {
        case 'A+':
            return t('bloodGroupOptions.aPositive');
        case 'A-':
            return t('bloodGroupOptions.aNegative');
        case 'B+':
            return t('bloodGroupOptions.bPositive');
        case 'B-':
            return t('bloodGroupOptions.bNegative');
        case 'O+':
            return t('bloodGroupOptions.oPositive');
        case 'O-':
            return t('bloodGroupOptions.oNegative');
        case 'AB+':
            return t('bloodGroupOptions.abPositive');
        case 'AB-':
            return t('bloodGroupOptions.abNegative');
        default:
            return bloodGroup;
    }
};

const getMotherTongueLabel = (t: TFunction, motherTongue: string): string => {
    switch (motherTongue) {
        case 'Hindi':
            return t('motherTongueOptions.hindi');
        case 'English':
            return t('motherTongueOptions.english');
        case 'Gujarati':
            return t('motherTongueOptions.gujarati');
        case 'Marathi':
            return t('motherTongueOptions.marathi');
        case 'Tamil':
            return t('motherTongueOptions.tamil');
        case 'Telugu':
            return t('motherTongueOptions.telugu');
        case 'Kannada':
            return t('motherTongueOptions.kannada');
        case 'Bengali':
            return t('motherTongueOptions.bengali');
        case 'Malayalam':
            return t('motherTongueOptions.malayalam');
        case 'Punjabi':
            return t('motherTongueOptions.punjabi');
        case 'Odia':
            return t('motherTongueOptions.odia');
        case 'Urdu':
            return t('motherTongueOptions.urdu');
        case 'Other':
            return t('motherTongueOptions.other');
        default:
            return motherTongue;
    }
};

const getIdTypeLabel = (t: TFunction, idType: string): string => {
    switch (idType) {
        case 'AADHAR_CARD':
            return t('idTypeOptions.aadhaarCard');
        case 'BIRTH_CERTIFICATE':
            return t('idTypeOptions.birthCertificate');
        case 'PASSPORT':
            return t('idTypeOptions.passport');
        case 'OTHER':
            return t('idTypeOptions.other');
        default:
            return idType;
    }
};

export const StudentDetailsSection: React.FC<SectionProps> = ({ formData, updateFormData }) => {
    const { t } = useTranslation('admissionsStudentDetailsSection');
    // Get levels from institute store
    const { getAllLevels } = useInstituteDetailsStore();
    const levels = getAllLevels();

    const checkboxLanguages = [
        { value: 'Hindi', label: t('checkboxLanguages.hindi') },
        { value: 'English', label: t('checkboxLanguages.english') },
        { value: 'Regional', label: t('checkboxLanguages.regional') },
    ];

    return (
        <div className="space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
                <h4 className="text-sm font-semibold uppercase text-neutral-500">
                    {t('sections.basicInformation')}
                </h4>

                <div>
                    <Label className="mb-1 block text-sm font-medium text-neutral-700">
                        {t('fields.fullName.label')} <span className="text-red-500">*</span>{' '}
                        {t('fields.fullName.hint')}
                    </Label>
                    <Input
                        type="text"
                        placeholder={t('fields.fullName.placeholder')}
                        value={formData.studentName || ''}
                        onChange={(e) => updateFormData({ studentName: e.target.value })}
                        maxLength={MAX_LENGTH.NAME}
                    />
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.dateOfBirth.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            type="date"
                            value={formData.dateOfBirth || ''}
                            onChange={(e) => updateFormData({ dateOfBirth: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.gender.label')} <span className="text-red-500">*</span>
                        </label>
                        <div className="flex gap-4 pt-2">
                            {GENDER_OPTIONS.map((gender) => (
                                <label key={gender} className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="gender"
                                        className="size-4 text-primary-600 focus:ring-primary-500"
                                        checked={formData.gender === gender}
                                        onChange={() => updateFormData({ gender: gender as any })}
                                    />
                                    <span className="text-sm text-neutral-700">
                                        {getGenderLabel(t, gender)}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Demographics */}
            <div className="space-y-4">
                <h4 className="text-sm font-semibold uppercase text-neutral-500">
                    {t('sections.demographics')}
                </h4>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.nationality.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={formData.nationality || 'Indian'}
                            onValueChange={(value) => updateFormData({ nationality: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.nationality.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {NATIONALITY_OPTIONS.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                        {getNationalityLabel(t, opt)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.religion.label')}
                        </Label>
                        <Select
                            value={formData.religion || ''}
                            onValueChange={(value) => updateFormData({ religion: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.religion.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {RELIGION_OPTIONS.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                        {getReligionLabel(t, opt)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.category.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={formData.category || ''}
                            onValueChange={(value) => updateFormData({ category: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.category.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {CATEGORY_OPTIONS.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                        {getCategoryLabel(t, opt)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-neutral-500">
                            ({CATEGORY_OPTIONS.map((opt) => getCategoryLabel(t, opt)).join('/')})
                        </p>
                    </div>
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.bloodGroup.label')}
                        </Label>
                        <Select
                            value={formData.bloodGroup || ''}
                            onValueChange={(value) => updateFormData({ bloodGroup: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.bloodGroup.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {BLOOD_GROUP_OPTIONS.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                        {getBloodGroupLabel(t, opt)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-neutral-500">
                            ({BLOOD_GROUP_OPTIONS.map((opt) => getBloodGroupLabel(t, opt)).join('/')})
                        </p>
                    </div>

                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.motherTongue.label')}
                        </Label>
                        <Select
                            value={formData.motherTongue || ''}
                            onValueChange={(value) => updateFormData({ motherTongue: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.motherTongue.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {MOTHER_TONGUE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                        {getMotherTongueLabel(t, opt)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.languagesKnown.label')}
                        </label>
                        <div className="flex gap-4 pt-2">
                            {checkboxLanguages.map((lang) => (
                                <label key={lang.value} className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        className="size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                                    />
                                    <span className="text-sm text-neutral-700">{lang.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Identification */}
            <div className="space-y-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold uppercase text-neutral-500">
                    <span className="i-ph-identification-card size-4" />
                    {t('sections.identification')}
                </h4>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.idType.label')}
                        </Label>
                        <Select
                            value={formData.idType || ''}
                            onValueChange={(value) => {
                                updateFormData({ idType: value as any });
                                // Clear ID number when type changes
                                if (value !== formData.idType) {
                                    updateFormData({ idType: value as any, idNumber: '' });
                                }
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.idType.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {ID_TYPE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {getIdTypeLabel(t, opt.value)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        {formData.idType === 'AADHAR_CARD' ? (
                            <AadhaarInput
                                name="idNumber"
                                value={formData.idNumber || ''}
                                onChange={(_name, value) => updateFormData({ idNumber: value })}
                                label={t('fields.aadhaarNumber')}
                            />
                        ) : (
                            <>
                                <label className="mb-1 block text-sm font-medium text-neutral-700">
                                    {t('fields.idNumber.label')}
                                </label>
                                <input
                                    type="text"
                                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                    placeholder={t('fields.idNumber.placeholder')}
                                    value={formData.idNumber || ''}
                                    onChange={(e) => updateFormData({ idNumber: e.target.value })}
                                    maxLength={MAX_LENGTH.GENERAL}
                                />
                            </>
                        )}
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.languagesKnown.label')}
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            placeholder={t('fields.languagesKnown.placeholder')}
                            value={formData.languagesKnown || ''}
                            onChange={(e) =>
                                updateFormData({ languagesKnown: e.target.value.split(',') })
                            }
                            maxLength={MAX_LENGTH.GENERAL}
                        />
                    </div>
                </div>
            </div>

            {/* Health Information */}
            <div className="space-y-4">
                <h4 className="text-sm font-semibold uppercase text-neutral-500">
                    {t('sections.healthInformation')}
                </h4>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.medicalConditions.label')}
                        </label>
                        <textarea
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            rows={3}
                            placeholder={t('fields.medicalConditions.placeholder')}
                            value={formData.medicalConditions || ''}
                            onChange={(e) => updateFormData({ medicalConditions: e.target.value })}
                            maxLength={MAX_LENGTH.TEXTAREA}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.dietaryRestrictions.label')}
                        </label>
                        <textarea
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            rows={3}
                            placeholder={t('fields.dietaryRestrictions.placeholder')}
                            value={formData.dietaryRestrictions || ''}
                            onChange={(e) =>
                                updateFormData({ dietaryRestrictions: e.target.value })
                            }
                            maxLength={MAX_LENGTH.TEXTAREA}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
