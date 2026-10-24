import React from 'react';
import { useTranslation } from 'react-i18next';
import { Registration } from '../../../-types/registration-types';

interface SectionProps {
    formData: Partial<Registration>;
    updateFormData: (data: Partial<Registration>) => void;
}

export const DocumentUploadSection: React.FC<SectionProps> = ({ formData, updateFormData }) => {
    const { t } = useTranslation('admissionsDocumentUploadSection');

    const documents = [
        { id: 'photo', label: t('documents.photo'), required: true },
        { id: 'birthCert', label: t('documents.birthCert'), required: true },
        { id: 'aadhar', label: t('documents.aadhar'), required: false },
        { id: 'tc', label: t('documents.tc'), required: true },
        { id: 'reportCard', label: t('documents.reportCard'), required: true },
    ];

    return (
        <div className="space-y-6">
            <h4 className="flex items-center gap-2 text-sm font-semibold uppercase text-neutral-500">
                <span className="i-ph-file-text size-4" />
                {t('requiredDocuments')}
            </h4>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {documents.map((doc) => (
                    <div
                        key={doc.id}
                        className="flex items-center justify-between rounded-lg border border-neutral-200 p-4"
                    >
                        <div>
                            <span className="block text-sm font-medium text-neutral-900">
                                {doc.label}{' '}
                                {doc.required && <span className="text-red-500">*</span>}
                            </span>
                            <span className="text-xs text-neutral-500">
                                {t('supportedFormats')}
                            </span>
                        </div>
                        <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
                            {t('upload')}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};
