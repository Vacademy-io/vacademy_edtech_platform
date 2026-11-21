import { useNavigate } from '@tanstack/react-router';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CaretRight, CheckCircle, CurrencyDollar, Stamp, Bell } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    buildPendingActions,
    type PendingAction,
    type PendingActionType,
} from '../-services/pending-actions-service';
import { toSourceState } from '../-services/dashboard-sources';
import {
    useInstituteFeeCollection,
    usePendingAdjustments,
    useSystemAlertsPreview,
} from '../-hooks/useDashboardSources';
import SourceErrorNotice from './SourceErrorNotice';

interface MyPendingActionsWidgetProps {
    instituteId: string;
    userId: string;
    /** Admin of the CURRENT institute — only admins get the institute-wide overdue-fees row. */
    isAdmin: boolean;
    onOpenAllAlerts?: () => void;
}

// Translated factory (instead of a static module-level constant) so icon labels update with
// the active locale. Not exported — nothing outside this file references the metadata.
const buildTypeMeta = (
    t: TFunction
): Record<PendingActionType, { Icon: typeof CurrencyDollar; iconClass: string; label: string }> => ({
    OVERDUE_PAYMENT: {
        Icon: CurrencyDollar,
        iconClass: 'text-red-600',
        label: t('actionType.overduePayment'),
    },
    PENDING_APPROVAL: {
        Icon: Stamp,
        iconClass: 'text-amber-600',
        label: t('actionType.pendingApproval'),
    },
    UNREAD_ALERT: {
        Icon: Bell,
        iconClass: 'text-neutral-600',
        label: t('actionType.unreadAlert'),
    },
});

const buildFormatAge =
    (t: TFunction) =>
    (hours: number): string => {
        if (hours <= 0) return t('age.now');
        if (hours < 1) return t('age.lessThanHour');
        if (hours < 24) return t('age.hoursFormat', { hours });
        const days = Math.round(hours / 24);
        return t('age.daysFormat', { days });
    };

export default function MyPendingActionsWidget({
    instituteId,
    userId,
    isAdmin,
    onOpenAllAlerts,
}: MyPendingActionsWidgetProps) {
    const { t } = useTranslation([
        'dashboardMyPendingActionsWidget',
        'dashboardPendingActionsService',
    ]);
    const navigate = useNavigate();
    // Shared hooks — the KPI band, Finance snapshot and navbar bell read the same queries.
    const adjustmentsQuery = usePendingAdjustments(instituteId);
    const alertsQuery = useSystemAlertsPreview(userId);
    const feeQuery = useInstituteFeeCollection(instituteId, isAdmin);
    const {
        actions: data,
        isLoading,
        hasFailedSource,
    } = buildPendingActions(
        {
            adjustments: toSourceState(adjustmentsQuery),
            alerts: toSourceState(alertsQuery),
            feeCollection: isAdmin ? toSourceState(feeQuery) : undefined,
        },
        t
    );
    const retryFailed = () => {
        if (adjustmentsQuery.isError) void adjustmentsQuery.refetch();
        if (alertsQuery.isError || alertsQuery.data?.fetchFailed) void alertsQuery.refetch();
        if (isAdmin && feeQuery.isError) void feeQuery.refetch();
    };
    const typeMeta = buildTypeMeta(t);
    const formatAge = buildFormatAge(t);

    const handleClick = (action: PendingAction) => {
        if (action.type === 'UNREAD_ALERT' && onOpenAllAlerts) {
            onOpenAllAlerts();
            return;
        }
        navigate({ to: action.deepLink });
    };

    return (
        <Card className="grow bg-white shadow-none">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <CardTitle className="text-sm font-semibold">{t('heading.title')}</CardTitle>
                        {!isLoading && data.length > 0 && (
                            <Badge className="rounded-full border border-primary-200 bg-primary-50 px-1.5 py-0 text-2xs font-medium text-primary-700 shadow-none">
                                {data.length}
                            </Badge>
                        )}
                    </div>
                </div>
                <CardDescription className="mt-0.5 text-2xs text-neutral-500 sm:text-xs">
                    {t('heading.description')}
                </CardDescription>
            </CardHeader>

            <div className="px-2 pb-3">
                {isLoading && data.length === 0 ? (
                    <ul className="space-y-1">
                        {[0, 1, 2].map((i) => (
                            <li key={i} className="flex items-center gap-2 rounded p-2">
                                <Skeleton className="size-7 rounded-full" />
                                <div className="flex-1 space-y-1">
                                    <Skeleton className="h-3 w-3/4" />
                                    <Skeleton className="h-2.5 w-1/2" />
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : data.length === 0 && hasFailedSource ? (
                    // Never "All clear" when a source failed: an empty list proves nothing.
                    <SourceErrorNotice
                        className="px-2 py-3"
                        message={t('error')}
                        onRetry={retryFailed}
                    />
                ) : data.length === 0 ? (
                    <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                        <CheckCircle size={28} weight="duotone" className="text-emerald-500" />
                        <div className="text-xs font-medium text-neutral-700">
                            {t('empty.title')}
                        </div>
                        <div className="text-2xs text-neutral-500">
                            {t('empty.description')}
                        </div>
                    </div>
                ) : (
                    <ul className="space-y-0.5">
                        {data.map((action) => {
                            const meta = typeMeta[action.type];
                            const Icon = meta.Icon;
                            return (
                                <li key={action.id}>
                                    <button
                                        type="button"
                                        onClick={() => handleClick(action)}
                                        className="group flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-neutral-50"
                                    >
                                        <span
                                            className={`flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 ${meta.iconClass}`}
                                        >
                                            <Icon size={14} weight="bold" />
                                        </span>
                                        <span className="flex flex-1 flex-col items-start overflow-hidden">
                                            <span className="line-clamp-1 w-full text-xs font-medium text-neutral-800">
                                                {action.title}
                                            </span>
                                            {action.subtitle && (
                                                <span className="line-clamp-1 w-full text-2xs text-neutral-500">
                                                    {action.subtitle}
                                                </span>
                                            )}
                                        </span>
                                        <span className="shrink-0 text-2xs tabular-nums text-neutral-400">
                                            {formatAge(action.ageHours)}
                                        </span>
                                        <CaretRight
                                            size={12}
                                            className="shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-500"
                                        />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {data.length > 0 && hasFailedSource && (
                    <SourceErrorNotice
                        className="px-2 pt-2"
                        message={t('partialError')}
                        onRetry={retryFailed}
                    />
                )}
            </div>
        </Card>
    );
}
