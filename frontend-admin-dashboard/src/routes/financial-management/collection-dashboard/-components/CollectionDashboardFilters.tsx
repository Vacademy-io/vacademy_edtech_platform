import React from 'react';
import { useTranslation } from 'react-i18next';

interface FiltersProps {
    sessionId: string;
    setSessionId: (id: string) => void;
    availableSessions: any[];
    selectedFeeTypeIds: string[];
    feeTypeOptions: any[];
    toggleFeeType: (id: string) => void;
    clearFeeTypes: () => void;
}

export const CollectionDashboardFilters: React.FC<FiltersProps> = ({
    sessionId,
    setSessionId,
    availableSessions,
    selectedFeeTypeIds,
    feeTypeOptions,
    toggleFeeType,
    clearFeeTypes
}) => {
    const { t } = useTranslation('financialManagementCollectionDashboardFilters');
    return (
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col gap-5">
            <div className="flex items-center gap-6 pb-4 border-b border-gray-100">
                <h1 className="text-xl font-bold text-gray-800 tracking-wide">{t('heading')}</h1>
                <div className="flex items-center gap-3 ms-auto text-sm">
                    <span className="font-semibold text-gray-600">{t('sessionLabel')}</span>
                    <select
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                        className="border border-gray-300 rounded-md px-3 py-1.5 font-medium text-gray-700 outline-none focus:border-blue-500 cursor-pointer bg-gray-50 hover:bg-white"
                    >
                        <option value="">{t('allSessions')}</option>
                        {availableSessions.map(s => <option key={s.id} value={s.id}>{s.session_name}</option>)}
                    </select>
                </div>
            </div>

            {/* Filter Buttons */}
            <div className="flex flex-wrap gap-3">
                <button
                    onClick={clearFeeTypes}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold transition shadow-sm border ${selectedFeeTypeIds.length === 0 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200'}`}
                >
                    {t('total')}
                </button>
                {feeTypeOptions.map(ft => (
                    <button
                        key={ft.id}
                        onClick={() => toggleFeeType(ft.id)}
                        className={`px-4 py-1.5 rounded-full text-sm font-semibold transition shadow-sm border ${selectedFeeTypeIds.includes(ft.id) ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                    >
                        {ft.name}
                    </button>
                ))}
            </div>
        </div>
    );
};
