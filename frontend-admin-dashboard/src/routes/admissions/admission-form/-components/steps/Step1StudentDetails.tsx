import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AdmissionFormData } from '../AdmissionFormWizard';
import { BatchForSessionType } from '@/schemas/student/student-list/institute-schema';
import { MAX_LENGTH } from '@/utils/form-validation';
import AadhaarInput from '@/components/design-system/aadhaar-input';
import PhoneNumberInput from '@/components/design-system/phone-number-input';

interface PackageSessionOption {
    id: string;
    label: string;
    sessionId: string;
}

interface Props {
    formData: AdmissionFormData;
    handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    packageSessionOptions: PackageSessionOption[];
    allBatches: BatchForSessionType[];
    onFormDataUpdate: (updates: Partial<AdmissionFormData>) => void;
    errors?: Record<string, string>;
}

export default function Step1StudentDetails({
    formData,
    handleChange,
    packageSessionOptions,
    allBatches,
    onFormDataUpdate,
    errors = {},
}: Props) {
    const { t } = useTranslation('admissionsStep1StudentDetails');

    // Track selected parent class separately so section dropdown stays stable
    const [selectedParentId, setSelectedParentId] = React.useState<string>(() => {
        // Initialize: if destinationPackageSessionId is a child, find its parent
        const current = allBatches.find((b) => b.id === formData.destinationPackageSessionId);
        if (current?.parent_id) return current.parent_id;
        return formData.destinationPackageSessionId || '';
    });

    // Derive section (child) options based on selected parent class
    const sectionOptions = useMemo(() => {
        if (!selectedParentId) return [];
        return allBatches
            .filter((b) => b.parent_id === selectedParentId)
            .map((b) => ({
                id: b.id,
                label: b.name || b.level.level_name,
            }));
    }, [allBatches, selectedParentId]);

    const handleClassChange = (packageSessionId: string) => {
        const selected = packageSessionOptions.find((opt) => opt.id === packageSessionId);
        setSelectedParentId(packageSessionId);
        onFormDataUpdate({
            destinationPackageSessionId: packageSessionId,
            studentClass: selected?.label || packageSessionId,
            sessionId: selected?.sessionId || formData.sessionId,
            section: '',
        });
    };

    const handleSectionChange = (sectionPackageSessionId: string) => {
        if (!sectionPackageSessionId) {
            // Reset to parent when "Select Section" is chosen
            onFormDataUpdate({
                destinationPackageSessionId: selectedParentId,
                section: '',
            });
            return;
        }
        const selected = sectionOptions.find((opt) => opt.id === sectionPackageSessionId);
        onFormDataUpdate({
            destinationPackageSessionId: sectionPackageSessionId,
            section: selected?.label || '',
        });
    };

    const inputClass = (field?: string) =>
        `rounded-md border px-3 py-2 text-sm outline-none transition-shadow focus:ring-1 ${
            field && errors[field]
                ? 'border-red-400 focus:border-red-500 focus:ring-red-300'
                : 'border-gray-300 focus:border-primary focus:ring-primary'
        }`;

    return (
        <div className="grid grid-cols-1 gap-6 duration-200 animate-in fade-in zoom-in-95 md:grid-cols-2 lg:grid-cols-3">
            <div className="col-span-full border-b border-gray-100 pb-2">
                <h2 className="text-lg font-semibold text-gray-800">{t('heading')}</h2>
            </div>

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                    {t('studentFirstName.label')} <span className="text-red-500">*</span>
                </label>
                <input
                    name="studentFirstName"
                    value={formData.studentFirstName}
                    onChange={handleChange}
                    maxLength={MAX_LENGTH.NAME}
                    className={inputClass('studentFirstName')}
                    placeholder={t('studentFirstName.placeholder')}
                />
                {errors.studentFirstName && (
                    <span className="text-xs text-red-500">{errors.studentFirstName}</span>
                )}
            </div>
            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">{t('middleName.label')}</label>
                <input
                    name="studentMiddleName"
                    value={formData.studentMiddleName}
                    onChange={handleChange}
                    maxLength={MAX_LENGTH.NAME}
                    className={inputClass()}
                    placeholder={t('middleName.placeholder')}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                    {t('lastName.label')} <span className="text-red-500">*</span>
                </label>
                <input
                    name="studentLastName"
                    value={formData.studentLastName}
                    onChange={handleChange}
                    maxLength={MAX_LENGTH.NAME}
                    className={inputClass('studentLastName')}
                    placeholder={t('lastName.placeholder')}
                />
                {errors.studentLastName && (
                    <span className="text-xs text-red-500">{errors.studentLastName}</span>
                )}
            </div>

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">{t('gender.label')}</label>
                <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleChange}
                    className={inputClass()}
                >
                    <option value="">{t('gender.select')}</option>
                    <option value="MALE">{t('gender.male')}</option>
                    <option value="FEMALE">{t('gender.female')}</option>
                    <option value="OTHER">{t('gender.other')}</option>
                </select>
            </div>

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                    {t('applicationNumber.label')}
                </label>
                <input
                    name="applicationNumber"
                    value={formData.applicationNumber}
                    onChange={handleChange}
                    maxLength={MAX_LENGTH.APPLICATION_NUMBER}
                    className={inputClass()}
                    placeholder={t('applicationNumber.placeholder')}
                />
            </div>

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                    {t('class.label')} <span className="text-red-500">*</span>
                </label>
                <select
                    value={selectedParentId}
                    onChange={(e) => handleClassChange(e.target.value)}
                    className={inputClass('destinationPackageSessionId')}
                >
                    <option value="">{t('class.select')}</option>
                    {packageSessionOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                {errors.destinationPackageSessionId && (
                    <span className="text-xs text-red-500">
                        {errors.destinationPackageSessionId}
                    </span>
                )}
            </div>

            {sectionOptions.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">{t('section.label')}</label>
                    <select
                        value={
                            sectionOptions.some(
                                (opt) => opt.id === formData.destinationPackageSessionId
                            )
                                ? formData.destinationPackageSessionId
                                : ''
                        }
                        onChange={(e) => handleSectionChange(e.target.value)}
                        className={inputClass()}
                    >
                        <option value="">{t('section.select')}</option>
                        {sectionOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                    {t('dateOfAdmission.label')}
                </label>
                <input
                    type="date"
                    name="dateOfAdmission"
                    value={formData.dateOfAdmission}
                    onChange={handleChange}
                    className={inputClass()}
                />
            </div>

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                    {t('dateOfBirth.label')} <span className="text-red-500">*</span>
                </label>
                <input
                    type="date"
                    name="dateOfBirth"
                    value={formData.dateOfBirth}
                    onChange={handleChange}
                    className={inputClass('dateOfBirth')}
                />
                {errors.dateOfBirth && (
                    <span className="text-xs text-red-500">{errors.dateOfBirth}</span>
                )}
            </div>

            <PhoneNumberInput
                name="residentialPhone"
                value={formData.residentialPhone}
                onChange={(name, value) => onFormDataUpdate({ [name]: value })}
                label={t('residentialPhone.label')}
                error={errors.residentialPhone}
            />

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">{t('studentType.label')}</label>
                <select
                    name="studentType"
                    value={formData.studentType}
                    onChange={handleChange}
                    className={inputClass()}
                >
                    <option value="">{t('studentType.select')}</option>
                    <option value="Regular">{t('studentType.regular')}</option>
                    <option value="Transfer">{t('studentType.transfer')}</option>
                </select>
            </div>

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                    {t('admissionType.label')}
                </label>
                <select
                    name="admissionType"
                    value={formData.admissionType}
                    onChange={handleChange}
                    className={inputClass()}
                >
                    <option value="">{t('admissionType.select')}</option>
                    <option value="Day Scholar">{t('admissionType.dayScholar')}</option>
                    <option value="Hostel">{t('admissionType.hostel')}</option>
                </select>
            </div>

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                    {t('transport.label')}
                </label>
                <select
                    name="transport"
                    value={formData.transport}
                    onChange={handleChange}
                    className={inputClass()}
                >
                    <option value="No">{t('transport.no')}</option>
                    <option value="Yes">{t('transport.yes')}</option>
                </select>
            </div>

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                    {t('aadhaarType.label')}
                </label>
                <select
                    name="aadhaarType"
                    value={formData.aadhaarType}
                    onChange={handleChange}
                    className={inputClass()}
                >
                    <option value="">{t('aadhaarType.select')}</option>
                    <option value="Standard">{t('aadhaarType.standard')}</option>
                    <option value="Temporary">{t('aadhaarType.temporary')}</option>
                </select>
            </div>

            <AadhaarInput
                name="aadhaarNumber"
                value={formData.aadhaarNumber}
                onChange={(name, value) => onFormDataUpdate({ [name]: value })}
                error={errors.aadhaarNumber}
            />
        </div>
    );
}
