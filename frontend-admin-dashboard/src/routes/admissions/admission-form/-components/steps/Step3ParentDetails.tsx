import React from 'react';
import { useTranslation } from 'react-i18next';
import { AdmissionFormData } from '../AdmissionFormWizard';
import { MAX_LENGTH } from '@/utils/form-validation';
import AadhaarInput from '@/components/design-system/aadhaar-input';
import PhoneNumberInput from '@/components/design-system/phone-number-input';

interface Props {
    formData: AdmissionFormData;
    handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    onFormDataUpdate: (updates: Partial<AdmissionFormData>) => void;
    errors?: Record<string, string>;
}

export default function Step3ParentDetails({
    formData,
    handleChange,
    onFormDataUpdate,
    errors = {},
}: Props) {
    const { t } = useTranslation('admissionsStep3ParentDetails');

    const inputClass = (field?: string) =>
        `rounded-md border px-3 py-2 text-sm outline-none transition-shadow focus:ring-1 ${
            field && errors[field]
                ? 'border-red-400 focus:border-red-500 focus:ring-red-300'
                : 'border-gray-300 focus:border-primary focus:ring-primary'
        }`;

    return (
        <div className="flex flex-col gap-8 animate-in fade-in zoom-in-95 duration-200">
            {/* Father Details Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="col-span-full pb-2 border-b border-gray-100 flex items-center gap-2">
                    <span className="p-1 rounded-md bg-blue-50 text-blue-600">
                        {t('father.sectionLabel')}
                    </span>
                    <h2 className="text-lg font-semibold text-gray-800">
                        {t('father.sectionHeading')}
                    </h2>
                </div>

                <div className="flex flex-col gap-1.5 lg:col-span-2">
                    <label className="text-sm font-medium text-gray-700">
                        {t('father.name.label')} <span className="text-red-500">*</span>
                    </label>
                    <input
                        name="fatherName"
                        value={formData.fatherName}
                        onChange={handleChange}
                        maxLength={MAX_LENGTH.NAME}
                        className={inputClass('fatherName')}
                        placeholder={t('father.name.placeholder')}
                    />
                    {errors.fatherName && (
                        <span className="text-xs text-red-500">{errors.fatherName}</span>
                    )}
                </div>

                <PhoneNumberInput
                    name="fatherMobile"
                    value={formData.fatherMobile}
                    onChange={(name, value) => onFormDataUpdate({ [name]: value })}
                    label={t('father.mobile.label')}
                    required
                    error={errors.fatherMobile}
                />

                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">
                        {t('father.email.label')}
                    </label>
                    <input
                        name="fatherEmail"
                        type="email"
                        value={formData.fatherEmail}
                        onChange={handleChange}
                        maxLength={MAX_LENGTH.EMAIL}
                        className={inputClass('fatherEmail')}
                        placeholder={t('father.email.placeholder')}
                    />
                    {errors.fatherEmail && (
                        <span className="text-xs text-red-500">{errors.fatherEmail}</span>
                    )}
                </div>

                <AadhaarInput
                    name="fatherAadhaar"
                    value={formData.fatherAadhaar}
                    onChange={(name, value) => onFormDataUpdate({ [name]: value })}
                    label={t('father.aadhaar.label')}
                    error={errors.fatherAadhaar}
                />

                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">
                        {t('father.qualification.label')}
                    </label>
                    <input
                        name="fatherQualification"
                        value={formData.fatherQualification}
                        onChange={handleChange}
                        maxLength={MAX_LENGTH.QUALIFICATION}
                        className={inputClass()}
                        placeholder={t('father.qualification.placeholder')}
                    />
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">
                        {t('father.occupation.label')}
                    </label>
                    <input
                        name="fatherOccupation"
                        value={formData.fatherOccupation}
                        onChange={handleChange}
                        maxLength={MAX_LENGTH.OCCUPATION}
                        className={inputClass()}
                        placeholder={t('father.occupation.placeholder')}
                    />
                </div>
            </div>

            {/* Mother Details Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="col-span-full pb-2 border-b border-gray-100 flex items-center gap-2">
                    <span className="p-1 rounded-md bg-pink-50 text-pink-600">
                        {t('mother.sectionLabel')}
                    </span>
                    <h2 className="text-lg font-semibold text-gray-800">
                        {t('mother.sectionHeading')}
                    </h2>
                </div>

                <div className="flex flex-col gap-1.5 lg:col-span-2">
                    <label className="text-sm font-medium text-gray-700">
                        {t('mother.name.label')}
                    </label>
                    <input
                        name="motherName"
                        value={formData.motherName}
                        onChange={handleChange}
                        maxLength={MAX_LENGTH.NAME}
                        className={inputClass()}
                        placeholder={t('mother.name.placeholder')}
                    />
                </div>

                <PhoneNumberInput
                    name="motherMobile"
                    value={formData.motherMobile}
                    onChange={(name, value) => onFormDataUpdate({ [name]: value })}
                    label={t('mother.mobile.label')}
                    error={errors.motherMobile}
                />

                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">
                        {t('mother.email.label')}
                    </label>
                    <input
                        name="motherEmail"
                        type="email"
                        value={formData.motherEmail}
                        onChange={handleChange}
                        maxLength={MAX_LENGTH.EMAIL}
                        className={inputClass('motherEmail')}
                        placeholder={t('mother.email.placeholder')}
                    />
                    {errors.motherEmail && (
                        <span className="text-xs text-red-500">{errors.motherEmail}</span>
                    )}
                </div>

                <AadhaarInput
                    name="motherAadhaar"
                    value={formData.motherAadhaar}
                    onChange={(name, value) => onFormDataUpdate({ [name]: value })}
                    label={t('mother.aadhaar.label')}
                    error={errors.motherAadhaar}
                />

                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">
                        {t('mother.qualification.label')}
                    </label>
                    <input
                        name="motherQualification"
                        value={formData.motherQualification}
                        onChange={handleChange}
                        maxLength={MAX_LENGTH.QUALIFICATION}
                        className={inputClass()}
                        placeholder={t('mother.qualification.placeholder')}
                    />
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">
                        {t('mother.occupation.label')}
                    </label>
                    <input
                        name="motherOccupation"
                        value={formData.motherOccupation}
                        onChange={handleChange}
                        maxLength={MAX_LENGTH.OCCUPATION}
                        className={inputClass()}
                        placeholder={t('mother.occupation.placeholder')}
                    />
                </div>
            </div>

            {/* Guardian Details Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="col-span-full pb-2 border-b border-gray-100 flex items-center gap-2">
                    <span className="p-1 rounded-md bg-green-50 text-green-600">
                        {t('guardian.sectionLabel')}
                    </span>
                    <h2 className="text-lg font-semibold text-gray-800">
                        {t('guardian.sectionHeading')}
                    </h2>
                </div>

                <div className="flex flex-col gap-1.5 lg:col-span-2">
                    <label className="text-sm font-medium text-gray-700">
                        {t('guardian.name.label')}
                    </label>
                    <input
                        name="guardianName"
                        value={formData.guardianName}
                        onChange={handleChange}
                        maxLength={MAX_LENGTH.NAME}
                        className={inputClass()}
                        placeholder={t('guardian.name.placeholder')}
                    />
                </div>

                <PhoneNumberInput
                    name="guardianMobile"
                    value={formData.guardianMobile}
                    onChange={(name, value) => onFormDataUpdate({ [name]: value })}
                    label={t('guardian.mobile.label')}
                    error={errors.guardianMobile}
                />
            </div>
        </div>
    );
}
