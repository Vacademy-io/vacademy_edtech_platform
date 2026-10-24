import { X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { EnquiryDetails } from './enquiry-details';
import { useEnquirySidebar } from '../../-context/selected-enquiry-sidebar-context';

export const EnquirySidebar = () => {
    const { t } = useTranslation('admissionsEnquirySidebar');
    const { isOpen, closeSidebar, selectedEnquiryId } = useEnquirySidebar();

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity"
                onClick={closeSidebar}
            />

            {/* Slide-in panel — mirrors the look of StudentSidebar */}
            <div
                className={`fixed end-0 top-0 z-50 flex h-full w-full max-w-md flex-col
                    border-l border-neutral-200 bg-white shadow-2xl
                    transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
            >
                {/* Header */}
                <div className="pt-safe-native sticky top-0 z-10 border-b border-neutral-100 bg-white/95 shadow-sm backdrop-blur-sm">
                    <div className="flex flex-col p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-6 w-1 animate-pulse rounded-full bg-gradient-to-b from-primary-500 to-primary-400" />
                                <h2 className="bg-gradient-to-r from-neutral-800 to-neutral-600 bg-clip-text text-lg font-semibold text-transparent">
                                    {t('title')}
                                </h2>
                            </div>
                            <button
                                onClick={closeSidebar}
                                className="group rounded-xl p-2 transition-all duration-300 hover:scale-105 hover:bg-gradient-to-r hover:from-red-50 hover:to-red-100 active:scale-95"
                            >
                                <X className="size-5 text-neutral-500 transition-colors duration-200 group-hover:text-red-500" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto p-4">
                    <EnquiryDetails enquiryId={selectedEnquiryId} />
                </div>
            </div>
        </>
    );
};
