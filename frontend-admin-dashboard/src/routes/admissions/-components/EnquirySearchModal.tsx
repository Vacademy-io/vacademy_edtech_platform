import React, { useState } from 'react';
import { X, MagnifyingGlass } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { searchEnquiriesByFilter, type EnquiryDetailsResponse } from '../-services/applicant-services';
import { toast } from 'sonner';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

// overall_status values returned by the backend
type EnquiryStatus = 'ENQUIRY' | 'APPLICATION' | 'ADMISSION';

interface EnquirySearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    // Pass only the callback(s) relevant to the context.
    // RegistrationListPage passes onSelectForApplication only.
    // AdmissionEntryScreen passes onSelectForAdmission only.
    // Passing both shows both action columns simultaneously.
    // Callbacks receive the full search result object (no second API call needed).
    onSelectForApplication?: (enquiryData: EnquiryDetailsResponse) => void;
    onSelectForAdmission?: (enquiryData: EnquiryDetailsResponse) => void;
}

const buildStatusBadge = (t: TFunction): Record<EnquiryStatus, { label: string; className: string }> => ({
    ENQUIRY:     { label: t('statusBadge.enquiry'),  className: 'bg-orange-100 text-orange-800' },
    APPLICATION: { label: t('statusBadge.applied'),  className: 'bg-blue-100 text-blue-800' },
    ADMISSION:   { label: t('statusBadge.admitted'), className: 'bg-green-100 text-green-800' },
});

export const EnquirySearchModal: React.FC<EnquirySearchModalProps> = ({
    isOpen,
    onClose,
    onSelectForApplication,
    onSelectForAdmission,
}) => {
    const [searchName, setSearchName] = useState('');
    const [searchPhone, setSearchPhone] = useState('');
    const [searchTrackingId, setSearchTrackingId] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [searchResults, setSearchResults] = useState<EnquiryDetailsResponse[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const { instituteDetails } = useInstituteDetailsStore();
    const { t } = useTranslation('admissionsEnquirySearchModal');
    const statusBadge = buildStatusBadge(t);

    if (!isOpen) return null;

    const handleSearch = async () => {
        if (!searchName.trim() && !searchPhone.trim() && !searchTrackingId.trim()) {
            toast.warning(t('toast.enterAtLeastOneCriteria'));
            return;
        }

        setIsLoading(true);
        try {
            const results = await searchEnquiriesByFilter({
                instituteId: instituteDetails?.id || '',
                name: searchName.trim() || undefined,
                phone: searchPhone.trim() || undefined,
                enquiryTrackingId: searchTrackingId.trim() || undefined,
            });
            setSearchResults(results);
            setHasSearched(true);
        } catch (error) {
            console.error('Error searching enquiries:', error);
            toast.error(t('toast.searchFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectForApplication = (result: EnquiryDetailsResponse) => {
        onSelectForApplication?.(result);
        onClose();
    };

    const handleSelectForAdmission = (result: EnquiryDetailsResponse) => {
        onSelectForAdmission?.(result);
        onClose();
    };

    const showApplicationCol = !!onSelectForApplication;
    const showAdmissionCol   = !!onSelectForAdmission;
    const colSpanEmpty = 4 + (showApplicationCol ? 1 : 0) + (showAdmissionCol ? 1 : 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-5xl rounded-lg bg-white p-6 shadow-xl flex flex-col max-h-dialog-tall">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-neutral-900">{t('title')}</h2>
                    <button
                        onClick={onClose}
                        className="text-neutral-400 hover:text-neutral-600 transition-colors"
                    >
                        <X className="size-6" />
                    </button>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    {/* filter by name */}
                    <div>
                        <Label htmlFor="searchName">{t('filters.nameLabel')}</Label>
                        <Input
                            id="searchName"
                            type="text"
                            placeholder={t('filters.namePlaceholder')}
                            value={searchName}
                            onChange={(e) => setSearchName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="mt-1"
                        />
                    </div>
                    {/* filter by phone number */}
                    <div>
                        <Label htmlFor="searchPhone">{t('filters.phoneLabel')}</Label>
                        <Input
                            id="searchPhone"
                            type="tel"
                            placeholder={t('filters.phonePlaceholder')}
                            value={searchPhone}
                            onChange={(e) => setSearchPhone(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="mt-1"
                        />
                    </div>
                    {/* filter by Enquiry tracking id */}
                    <div>
                        <Label htmlFor="searchTrackingId">{t('filters.trackingIdLabel')}</Label>
                        <Input
                            id="searchTrackingId"
                            type="text"
                            placeholder={t('filters.trackingIdPlaceholder')}
                            value={searchTrackingId}
                            onChange={(e) => setSearchTrackingId(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="mt-1"
                        />
                    </div>
                </div>
                {/* search button */}
                <div className="flex justify-end mb-6">
                    <MyButton
                        buttonType="primary"
                        onClick={handleSearch}
                        disabled={isLoading}
                        className="w-full md:w-auto"
                    >
                        <MagnifyingGlass className="mr-2 size-4" />
                        {isLoading ? t('actions.searching') : t('actions.searchEnquiries')}
                    </MyButton>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto border rounded-xl border-neutral-200">
                    <table className="w-full text-left text-sm text-neutral-600">
                        <thead className="bg-neutral-50 text-xs font-semibold uppercase text-neutral-500 sticky top-0 shadow-sm z-10">
                            <tr>
                                <th className="px-4 py-3 bg-neutral-50">{t('table.headers.trackingId')}</th>
                                <th className="px-4 py-3 bg-neutral-50">{t('table.headers.studentName')}</th>
                                <th className="px-4 py-3 bg-neutral-50">{t('table.headers.parentName')}</th>
                                <th className="px-4 py-3 bg-neutral-50">{t('table.headers.phone')}</th>
                                <th className="px-4 py-3 bg-neutral-50">{t('table.headers.status')}</th>
                                {showApplicationCol && (
                                    <th className="px-4 py-3 bg-neutral-50 text-center">{t('table.headers.application')}</th>
                                )}
                                {showAdmissionCol && (
                                    <th className="px-4 py-3 bg-neutral-50 text-center">{t('table.headers.admission')}</th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200">
                            {searchResults.map((result, idx) => {
                                const status: EnquiryStatus = result.overall_status || 'ENQUIRY';
                                const badge = statusBadge[status] ?? statusBadge.ENQUIRY;

                                // Application button: disable only if already applied or admitted
                                const appApplied = status === 'APPLICATION' || status === 'ADMISSION';
                                // Admission button: disable only if already admitted (direct admission is allowed)
                                const admAdmitted = status === 'ADMISSION';

                                return (
                                    <tr key={result.enquiry_id || idx} className="hover:bg-neutral-50 transition-colors">
                                        <td className="whitespace-nowrap px-4 py-3 font-medium text-primary-600">
                                            {result.tracking_id || '-'}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-neutral-900">
                                            {result.child?.name || '-'}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3">
                                            {result.parent?.name || '-'}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3">
                                            {result.parent?.phone || '-'}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3">
                                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                                                {badge.label}
                                            </span>
                                        </td>

                                        {showApplicationCol && (
                                            <td className="whitespace-nowrap px-4 py-3 text-center">
                                                <MyButton
                                                    buttonType={appApplied ? 'secondary' : 'primary'}
                                                    scale="small"
                                                    onClick={() => handleSelectForApplication(result)}
                                                    disabled={appApplied}
                                                >
                                                    {appApplied ? t('actions.applied') : t('actions.apply')}
                                                </MyButton>
                                            </td>
                                        )}

                                        {showAdmissionCol && (
                                            <td className="whitespace-nowrap px-4 py-3 text-center">
                                                <MyButton
                                                    buttonType={admAdmitted ? 'secondary' : 'primary'}
                                                    scale="small"
                                                    onClick={() => handleSelectForAdmission(result)}
                                                    disabled={admAdmitted}
                                                >
                                                    {admAdmitted ? t('actions.admitted') : t('actions.admit')}
                                                </MyButton>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                            {searchResults.length === 0 && hasSearched && !isLoading && (
                                <tr>
                                    <td colSpan={colSpanEmpty} className="px-4 py-12 text-center text-neutral-500">
                                        {t('table.empty.noResults')}
                                    </td>
                                </tr>
                            )}
                            {searchResults.length === 0 && !hasSearched && !isLoading && (
                                <tr>
                                    <td colSpan={colSpanEmpty} className="px-4 py-12 text-center text-neutral-400">
                                        {t('table.empty.prompt')}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
