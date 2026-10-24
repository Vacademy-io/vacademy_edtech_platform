import React from 'react';
import { useTranslation } from 'react-i18next';
import { AdmissionFormData } from '../AdmissionFormWizard';

interface Props {
    formData: AdmissionFormData;
    handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
}

export default function Step4AddressDetails({ formData, handleChange }: Props) {
    const { t } = useTranslation('admissionsStep4AddressDetails');
    return (
        <div className="flex flex-col gap-8 animate-in fade-in zoom-in-95 duration-200">
            {/* Current Address Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
                <div className="col-span-full pb-2 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-800">{t('current.heading')}</h2>
                </div>

                <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-sm font-medium text-gray-700">{t('address.label')}</label>
                    <textarea
                        name="currentAddress"
                        value={formData.currentAddress}
                        onChange={handleChange}
                        rows={3}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow resize-none"
                        placeholder={t('address.placeholder')}
                    />
                </div>

                <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-sm font-medium text-gray-700">{t('locality.label')}</label>
                    <input
                        name="currentLocality"
                        value={formData.currentLocality}
                        onChange={handleChange}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow"
                        placeholder={t('locality.placeholder')}
                    />
                </div>
            </div>

            {/* Same As current address toggle */}
            <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-md border border-primary/20 w-fit">
                <input
                    type="checkbox"
                    id="sameAsPermanent"
                    name="sameAsPermanent"
                    checked={formData.sameAsPermanent}
                    onChange={handleChange}
                    className="h-4 w-4 rounded border-primary text-primary focus:ring-primary cursor-pointer"
                />
                <label htmlFor="sameAsPermanent" className="text-sm font-medium text-primary cursor-pointer select-none">
                    {t('sameAsPermanent.label')}
                </label>
            </div>

            {/* Permanent Address Section */}
            {!formData.sameAsPermanent && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="col-span-full pb-2 border-b border-gray-100">
                        <h2 className="text-lg font-semibold text-gray-800">{t('permanent.heading')}</h2>
                    </div>

                    <div className="flex flex-col gap-1.5 md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">{t('address.label')} <span className="text-red-500">*</span></label>
                        <textarea
                            name="permanentAddress"
                            value={formData.permanentAddress}
                            onChange={handleChange}
                            rows={3}
                            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow resize-none"
                            placeholder={t('permanent.addressPlaceholder')}
                        />
                    </div>

                    <div className="flex flex-col gap-1.5 md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">{t('locality.label')} <span className="text-red-500">*</span></label>
                        <input
                            name="permanentLocality"
                            value={formData.permanentLocality}
                            onChange={handleChange}
                            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow"
                            placeholder={t('locality.placeholder')}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
