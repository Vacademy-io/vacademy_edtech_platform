import type { ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    CurrencyDollar,
    WarningCircle,
    ClipboardText,
    ArrowRight,
    type Icon,
} from '@phosphor-icons/react';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { formatInstituteMoney, resolveInstituteCurrency } from '@/utils/institute-currency';
import { isAdjustmentPendingApproval, toFeeTotals } from '../-services/dashboard-sources';
import { useInstituteFeeCollection, usePendingAdjustments } from '../-hooks/useDashboardSources';
import SourceErrorNotice from './SourceErrorNotice';

interface Tile {
    label: string;
    Icon: Icon;
    iconBg: string;
    iconColor: string;
    valueNode: ReactNode;
}

/** Shown in place of a value whose source failed — never a misleading 0. */
const FAILED_VALUE = '—';

export default function FinanceSummaryWidget({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('dashboardFinanceSummaryWidget');
    const navigate = useNavigate();
    // Outstanding/overdue are institute-wide totals from the Collection Dashboard endpoint;
    // approvals are the adjustment-approval queue. Both queries are shared with the KPI band
    // and Pending Actions, so this widget adds no requests of its own.
    const feeQuery = useInstituteFeeCollection(instituteId);
    const adjustmentsQuery = usePendingAdjustments(instituteId);
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const currency = resolveInstituteCurrency(instituteDetails);

    const fees = feeQuery.data ? toFeeTotals(feeQuery.data) : null;
    const pendingApprovals = (adjustmentsQuery.data || []).filter(
        isAdjustmentPendingApproval
    ).length;
    const feeLoading = feeQuery.isPending && feeQuery.fetchStatus !== 'idle';
    const approvalsLoading = adjustmentsQuery.isPending && adjustmentsQuery.fetchStatus !== 'idle';

    const tiles: Tile[] = [
        {
            label: t('tiles.outstanding'),
            Icon: CurrencyDollar,
            iconBg: 'bg-emerald-50',
            iconColor: 'text-emerald-600',
            valueNode: feeLoading ? (
                <Skeleton className="h-5 w-16" />
            ) : feeQuery.isError || !fees ? (
                FAILED_VALUE
            ) : (
                formatInstituteMoney(fees.outstanding, currency, { compact: true })
            ),
        },
        {
            label: t('tiles.overdue'),
            Icon: WarningCircle,
            iconBg: 'bg-red-50',
            iconColor: 'text-red-600',
            valueNode: feeLoading ? (
                <Skeleton className="h-5 w-16" />
            ) : feeQuery.isError || !fees ? (
                FAILED_VALUE
            ) : (
                formatInstituteMoney(fees.overdue, currency, { compact: true })
            ),
        },
        {
            label: t('tiles.approvals'),
            Icon: ClipboardText,
            iconBg: 'bg-amber-50',
            iconColor: 'text-amber-600',
            valueNode: approvalsLoading ? (
                <Skeleton className="h-5 w-8" />
            ) : adjustmentsQuery.isError ? (
                FAILED_VALUE
            ) : (
                pendingApprovals
            ),
        },
    ];
    const retryFailed = () => {
        if (feeQuery.isError) void feeQuery.refetch();
        if (adjustmentsQuery.isError) void adjustmentsQuery.refetch();
    };

    const go = () => navigate({ to: '/financial-management/collection-dashboard' });

    return (
        <Card className="flex flex-col self-start bg-white shadow-sm">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                            <CurrencyDollar size={14} weight="duotone" />
                        </span>
                        <div className="min-w-0">
                            <CardTitle className="text-sm font-semibold">
                                {t('header.title')}
                            </CardTitle>
                            <CardDescription className="line-clamp-1 text-2xs text-neutral-500 sm:text-xs">
                                {t('header.description')}
                            </CardDescription>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={go}
                        className="flex shrink-0 items-center gap-1 text-2xs font-medium text-primary-600 hover:text-primary-700"
                    >
                        {t('header.openButton')}
                        <ArrowRight size={12} weight="bold" />
                    </button>
                </div>
            </CardHeader>
            <div className="grid grid-cols-3 gap-2 px-4 pb-4">
                {tiles.map((tile) => {
                    const TileIcon = tile.Icon;
                    return (
                        <button
                            key={tile.label}
                            type="button"
                            onClick={go}
                            className="group flex flex-col items-center justify-center gap-1.5 rounded-md border border-neutral-200 p-3 text-center transition-colors hover:border-primary-200 hover:bg-primary-50/40"
                        >
                            <span
                                className={`flex size-8 items-center justify-center rounded-full ${tile.iconBg} ${tile.iconColor}`}
                            >
                                <TileIcon size={14} weight="bold" />
                            </span>
                            <span className="text-2xs font-medium uppercase tracking-wide text-neutral-500">
                                {tile.label}
                            </span>
                            <span className="text-base font-semibold tabular-nums text-neutral-900">
                                {tile.valueNode}
                            </span>
                        </button>
                    );
                })}
            </div>
            {(feeQuery.isError || adjustmentsQuery.isError) && (
                <SourceErrorNotice className="px-4 pb-3" onRetry={retryFailed} />
            )}
        </Card>
    );
}
