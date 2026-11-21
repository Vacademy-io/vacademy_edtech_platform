import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getInstituteId } from '@/constants/helper';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    fetchFeeTypesForInstitute,
    getFeeTypesQueryKey,
    fetchDashboardCollectionData,
    getCollectionDashboardQueryKey,
    DashboardCollectionRequest,
    DashboardCollectionResponse
} from '@/services/manage-finances';
import { Target, Clock, Coins, WarningCircle, Receipt } from '@phosphor-icons/react';
import { formatCurrency } from '@/utils/finance-utils';
import type { TFunction } from 'i18next';
import { useOfflinePaymentModes } from '@/services/offline-payment-modes';

type VendorCategory = 'ONLINE_PORTAL' | 'CASH' | 'BANK_TRANSFER' | 'OFFLINE_UNSPECIFIED' | 'OTHER';

// The breakdown key is the recorded offline payment mode when there is one (UPI, CHEQUE ...),
// otherwise the vendor. Gateways map to a category; a manual payment recorded without a mode
// is "Offline (not specified)" — it used to be shown as Cash, which a cheque is not.
const VENDOR_CATEGORY_MAP: Record<string, VendorCategory> = {
    RAZORPAY: 'ONLINE_PORTAL',
    CASHFREE: 'ONLINE_PORTAL',
    STRIPE: 'ONLINE_PORTAL',
    PHONEPE: 'ONLINE_PORTAL',
    OFFLINE: 'OFFLINE_UNSPECIFIED',
    MANUAL: 'OFFLINE_UNSPECIFIED',
    EWAY: 'BANK_TRANSFER',
    CASH: 'CASH',
    BANK_TRANSFER: 'BANK_TRANSFER',
};

const CATEGORY_COLOR_MAP: Record<VendorCategory, string> = {
    ONLINE_PORTAL: '#10b981',
    BANK_TRANSFER: '#f59e0b',
    CASH: '#6366f1',
    OFFLINE_UNSPECIFIED: 'hsl(var(--muted-foreground))',
    OTHER: '#94a3b8',
};

/** Colours for the institute's own offline modes (UPI, cheque, custom ones): the theme's chart palette. */
const MODE_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `hsl(var(--chart-${n}))`);

const DEFAULT_COLOR = '#94a3b8';

function categoryLabel(category: VendorCategory, t: TFunction): string {
    switch (category) {
        case 'ONLINE_PORTAL':
            return t('vendorLabels.onlinePortal');
        case 'CASH':
            return t('vendorLabels.cash');
        case 'BANK_TRANSFER':
            return t('vendorLabels.bankTransfer');
        case 'OFFLINE_UNSPECIFIED':
            return t('vendorLabels.offlineUnspecified');
        default:
            return t('vendorLabels.other');
    }
}

function calcRate(collected: number, expected: number): number {
    if (!expected || expected === 0) return 0;
    return (collected / expected) * 100;
}

export const useCollectionDashboard = () => {
    const { t } = useTranslation('financialManagementUseCollectionDashboard');
    const { getAllSessions } = useInstituteDetailsStore();
    const availableSessions = getAllSessions() || [];

    const [sessionId, setSessionId] = useState<string>('');
    const [selectedFeeTypeIds, setSelectedFeeTypeIds] = useState<string[]>([]);
    const instituteId = getInstituteId() || '';

    // --- Fee Types ---
    const { data: feeTypeOptions = [] } = useQuery({
        queryKey: getFeeTypesQueryKey(),
        queryFn: fetchFeeTypesForInstitute,
        staleTime: 300000,
        enabled: !!instituteId
    });

    // --- Dashboard Data ---
    const requestBody: DashboardCollectionRequest = useMemo(() => ({
        instituteId,
        sessionId,
        feeTypeIds: selectedFeeTypeIds
    }), [instituteId, sessionId, selectedFeeTypeIds]);

    const { data: dashboardData, isLoading, isError, refetch } = useQuery({
        queryKey: getCollectionDashboardQueryKey(requestBody),
        queryFn: () => fetchDashboardCollectionData(requestBody),
        staleTime: 60000,
        enabled: !!instituteId
    });

    // --- Actions ---
    const toggleFeeType = (id: string) => {
        setSelectedFeeTypeIds(prev =>
            prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
        );
    };

    const clearFeeTypes = () => setSelectedFeeTypeIds([]);

    // --- Derived Data for UI ---
    const totalDue = useMemo(() => {
        if (!dashboardData) return 0;
        return dashboardData.projectedRevenue - dashboardData.collectedToDate;
    }, [dashboardData]);

    const collectionRate = useMemo(() => {
        if (!dashboardData) return 0;
        return calcRate(dashboardData.collectedToDate, dashboardData.expectedToDate);
    }, [dashboardData]);

    const summaryCards = useMemo(() => {
        if (!dashboardData) return [];
        return [
            { title: t('summaryCards.projectedRevenue'), value: formatCurrency(dashboardData.projectedRevenue), icon: Target, bgColor: 'bg-blue-50', iconColor: 'text-blue-600', borderColor: 'border-blue-100' },
            { title: t('summaryCards.tillNowExpected'), value: formatCurrency(dashboardData.expectedToDate), icon: Clock, bgColor: 'bg-orange-50', iconColor: 'text-orange-500', borderColor: 'border-orange-100' },
            { title: t('summaryCards.tillNowCollected'), value: formatCurrency(dashboardData.collectedToDate), icon: Coins, bgColor: 'bg-green-50', iconColor: 'text-green-600', borderColor: 'border-green-100' },
            { title: t('summaryCards.totalOverdue'), value: formatCurrency(dashboardData.totalOverdue), icon: WarningCircle, bgColor: 'bg-red-50', iconColor: 'text-red-500', borderColor: 'border-red-100' },
            { title: t('summaryCards.totalDue'), value: formatCurrency(totalDue), icon: Receipt, bgColor: 'bg-purple-50', iconColor: 'text-purple-600', borderColor: 'border-purple-100' },
        ];
    }, [dashboardData, totalDue, t]);

    const pipelineData = useMemo(() => {
        if (!dashboardData) return [];
        return [
            { name: t('pipeline.codes.projectedRevenue'), val: dashboardData.projectedRevenue, color: '#1e3a8a', tooltip: t('pipeline.tooltips.projectedRevenue') },
            { name: t('pipeline.codes.tillNowExpected'), val: dashboardData.expectedToDate, color: '#3b82f6', tooltip: t('pipeline.tooltips.tillNowExpected') },
            { name: t('pipeline.codes.tillNowCollected'), val: dashboardData.collectedToDate, color: '#10b981', tooltip: t('pipeline.tooltips.tillNowCollected') },
            { name: t('pipeline.codes.totalOverdue'), val: dashboardData.totalOverdue, color: '#ef4444', tooltip: t('pipeline.tooltips.totalOverdue') },
            { name: t('pipeline.codes.totalDue'), val: totalDue, color: '#a855f7', tooltip: t('pipeline.tooltips.totalDue') }
        ];
    }, [dashboardData, totalDue, t]);

    const classWiseDetails = useMemo(() => {
        if (!dashboardData?.classWiseBreakdown) return [];
        return dashboardData.classWiseBreakdown.map(row => ({
            className: row.className,
            projectedRevenue: row.projectedRevenue,
            expectedToDate: row.expectedToDate,
            collectedToDate: row.collectedToDate,
            collectionRate: calcRate(row.collectedToDate, row.expectedToDate),
            totalOverdue: row.overdue,
        }));
    }, [dashboardData]);

    const { data: offlineModes } = useOfflinePaymentModes(instituteId);

    const pieData = useMemo(() => {
        if (!dashboardData?.paymentModeBreakdown?.length) return [];

        // Aggregate into slices: gateway categories, and one slice per institute offline mode
        // (labelled as the institute named it). Several keys can land in the same slice.
        const slices = new Map<string, { name: string; amount: number; color: string }>();
        let modeIndex = 0;
        let grandTotal = 0;
        for (const entry of dashboardData.paymentModeBreakdown) {
            const key = (entry.vendor || '').toUpperCase();
            const category = VENDOR_CATEGORY_MAP[key];
            const mode = category ? undefined : offlineModes?.modes.find((m) => m.code === key);
            const sliceKey = category ?? (mode ? `MODE:${key}` : 'OTHER');
            const existing = slices.get(sliceKey);
            if (existing) {
                existing.amount += entry.amount;
            } else {
                slices.set(sliceKey, {
                    name: mode ? mode.label : categoryLabel(category ?? 'OTHER', t),
                    amount: entry.amount,
                    color: mode
                        ? MODE_COLORS[modeIndex++ % MODE_COLORS.length]!
                        : CATEGORY_COLOR_MAP[category ?? 'OTHER'] || DEFAULT_COLOR,
                });
            }
            grandTotal += entry.amount;
        }

        if (grandTotal === 0) return [];

        return Array.from(slices.values())
            .map((s) => ({
                name: s.name,
                value: parseFloat(((s.amount / grandTotal) * 100).toFixed(1)),
                color: s.color,
            }))
            .sort((a, b) => b.value - a.value);
    }, [dashboardData, offlineModes, t]);

    const gaugeData = useMemo(() => [
        { name: t('gauge.collected'), value: collectionRate, color: '#10b981' },
        { name: t('gauge.remaining'), value: 100 - collectionRate, color: '#e5e7eb' },
    ], [collectionRate, t]);

    return {
        sessionId,
        setSessionId,
        availableSessions,
        selectedFeeTypeIds,
        feeTypeOptions,
        toggleFeeType,
        clearFeeTypes,
        dashboardData,
        isLoading,
        isError,
        refetch,
        summaryCards,
        pipelineData,
        classWiseDetails,
        pieData,
        collectionRate,
        gaugeData
    };
};
