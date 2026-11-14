import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCollectionDashboard } from '../-hooks/useCollectionDashboard';
import { CollectionSummaryCards } from './SummaryCards';
import { CollectionDashboardFilters } from './CollectionDashboardFilters';
import { CollectionPipelineChart } from './CollectionPipelineChart';
import { CollectionRateGauge } from './CollectionRateGauge';
import { ClassWiseCollectionTable } from './ClassWiseCollectionTable';
import { PaymentModeInsights } from './PaymentModeInsights';
import { CollectionEnhanced } from './CollectionEnhanced';

/**
 * CollectionDashboardMain
 * 
 * Orchestrates the School Collection dashboard by connecting the
 * useCollectionDashboard hook to specialized UI components.
 */
export default function CollectionDashboardMain() {
    const { t } = useTranslation('financialManagementCollectionDashboardMain');
    const {
        sessionId,
        setSessionId,
        availableSessions,
        selectedFeeTypeIds,
        feeTypeOptions,
        toggleFeeType,
        clearFeeTypes,
        isLoading,
        isError,
        summaryCards,
        pipelineData,
        classWiseDetails,
        pieData,
        collectionRate,
        gaugeData,
        dashboardData,
        refetch
    } = useCollectionDashboard();

    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center p-20 bg-red-50 rounded-2xl border border-red-100 text-center gap-4 animate-in fade-in transition duration-500">
                <div className="text-red-600 font-black text-xl uppercase tracking-tighter">{t('errorTitle')}</div>
                <p className="text-red-400 text-sm font-medium">{t('errorMessage')}</p>
                <button
                    onClick={() => refetch()}
                    className="px-6 py-2 bg-red-600 text-white rounded-full font-bold text-sm hover:bg-red-700 transition-all shadow-lg hover:shadow-red-200"
                >
                    {t('retryLoading')}
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 w-full max-w-[1500px] mx-auto p-2">
            {/* Filters & Title Section */}
            <CollectionDashboardFilters 
                sessionId={sessionId}
                setSessionId={setSessionId}
                availableSessions={availableSessions}
                selectedFeeTypeIds={selectedFeeTypeIds}
                feeTypeOptions={feeTypeOptions}
                toggleFeeType={toggleFeeType}
                clearFeeTypes={clearFeeTypes}
            />

            {isLoading ? (
                <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                    <div className="w-12 h-12 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
                    <div className="text-indigo-600 font-bold uppercase tracking-widest text-xs animate-pulse">
                        {t('analyzingData')}
                    </div>
                </div>
            ) : (
                <>
                    {/* Summary Overview */}
                    <CollectionSummaryCards cards={summaryCards} />

                    {/* Enhanced. */}
                    {dashboardData && <CollectionEnhanced data={dashboardData} />}

                    {/* Charts Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-auto lg:h-[400px]">
                        <CollectionPipelineChart data={pipelineData} />
                        <CollectionRateGauge collectionRate={collectionRate} gaugeData={gaugeData} />
                    </div>

                    {/*Class wise Details Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                        <div className="lg:col-span-2">
                            <ClassWiseCollectionTable classWiseDetails={classWiseDetails} />
                        </div>
                        <div className="lg:col-span-1 h-full">
                            <PaymentModeInsights pieData={pieData} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
