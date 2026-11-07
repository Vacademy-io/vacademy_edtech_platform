import React from 'react';
import { useTranslation } from 'react-i18next';
import { AdmissionFormData } from '../AdmissionFormWizard';

interface Props {
    formData: AdmissionFormData;
    handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    admissionId: string;
}

export default function Step6Finish({ formData, handleChange, admissionId }: Props) {
    const { t } = useTranslation('admissionsStep6Finish');
    return (
        <div className="flex flex-col items-center justify-center p-12 text-center duration-200 animate-in fade-in zoom-in-95">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-green-200 bg-green-100 shadow-sm">
                <svg
                    className="h-10 w-10 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M5 13l4 4L19 7"
                    ></path>
                </svg>
            </div>

            <h2 className="mb-2 text-2xl font-bold text-gray-800">{t('readyToSubmitHeading')}</h2>
            <p className="mb-6 max-w-xl text-lg text-gray-600">
                {t('reachedEndPrefix')}{' '}
                <span className="font-semibold text-gray-800">{t('admissionFormLabel')}</span>
                {t('reachedEndSuffix')}
            </p>

            <div className="mb-8 w-full max-w-md rounded-lg border border-gray-200 bg-gray-50 p-6">
                <h3 className="mb-4 border-b pb-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
                    {t('admissionSummaryHeading')}
                </h3>
                <div className="flex flex-col gap-3 text-left">
                    <div className="flex justify-between">
                        <span className="text-gray-600">{t('studentNameLabel')}</span>
                        <span className="font-medium text-gray-800">
                            {formData.studentFirstName} {formData.studentLastName}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-600">{t('classLabel')}</span>
                        <span className="font-medium text-gray-800">
                            {formData.studentClass || '-'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="mt-8 text-sm text-gray-500">
                {t('clickPrefix')}{' '}
                <span className="font-semibold text-gray-700">{t('submitAdmissionLabel')}</span>{' '}
                {t('clickSuffix')}
            </div>
        </div>
    );
}
