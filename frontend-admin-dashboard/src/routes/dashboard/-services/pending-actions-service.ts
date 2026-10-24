import type { TFunction } from 'i18next';
import {
    stripHtml,
    type PagedResponse,
    type SystemAlertItem,
} from '@/services/notifications/system-alerts';
import type { DashboardCollectionResponse } from '@/services/manage-finances';
import type { StudentFeeDueDTO } from '@/types/manage-finances';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { formatInstituteMoney, resolveInstituteCurrency } from '@/utils/institute-currency';
import { isAdjustmentPendingApproval, toFeeTotals, type SourceState } from './dashboard-sources';

export type PendingActionType = 'OVERDUE_PAYMENT' | 'PENDING_APPROVAL' | 'UNREAD_ALERT';

export type PendingActionSeverity = 'high' | 'medium' | 'low';

export interface PendingAction {
    id: string;
    type: PendingActionType;
    title: string;
    subtitle?: string;
    ageHours: number;
    deepLink: string;
    severity: PendingActionSeverity;
}

const HOURS = 1000 * 60 * 60;

const hoursSince = (iso: string | null | undefined): number => {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 0;
    return Math.max(0, Math.round((Date.now() - t) / HOURS));
};

/**
 * Fee amounts have no currency of their own, and this runs outside React, so the
 * institute's currency is read straight off the store rather than a hook. Hardcoding ₹ here
 * mislabelled every non-Indian institute's pending actions.
 */
const formatMoney = (n: number): string =>
    formatInstituteMoney(
        n,
        resolveInstituteCurrency(useInstituteDetailsStore.getState().instituteDetails),
        { compact: false }
    );

/**
 * One institute-wide "overdue fees" row from the Collection Dashboard totals.
 *
 * The old per-learner overdue rows came from the adjustment-approval queue, which only holds
 * bills with a concession/penalty awaiting review — so real overdue dues never showed up.
 * There is no cheap institute-wide list of overdue bills (the fee search endpoint loads the
 * whole ledger), so the dashboard shows the total and links to the Collection page.
 */
const buildOverdueSummaryActions = (
    collection: DashboardCollectionResponse,
    t: TFunction
): PendingAction[] => {
    const { overdue } = toFeeTotals(collection);
    if (overdue <= 0) return [];
    return [
        {
            id: 'overdue:institute',
            type: 'OVERDUE_PAYMENT',
            title: t('dashboardPendingActionsService:overdueSummary.title', {
                amount: formatMoney(Math.round(overdue)),
            }),
            subtitle: t('dashboardPendingActionsService:overdueSummary.subtitle'),
            ageHours: 0,
            deepLink: '/financial-management/collection-dashboard',
            severity: 'high',
        },
    ];
};

// Bills awaiting concession/adjustment approval.
const buildPendingApprovalActions = (rows: StudentFeeDueDTO[], t: TFunction): PendingAction[] => {
    const learnerLabel = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const defaultAdjustmentType = t('dashboardPendingActionsService:pendingApproval.defaultType');
    return rows.filter(isAdjustmentPendingApproval).map((r) => ({
        id: `approval:${r.id}`,
        type: 'PENDING_APPROVAL' as const,
        title: t('dashboardPendingActionsService:pendingApproval.title', {
            name: r.student_name || learnerLabel,
        }),
        subtitle: t('dashboardPendingActionsService:pendingApproval.subtitle', {
            type: r.adjustment_type || defaultAdjustmentType,
            amount: formatMoney(r.adjustment_amount || 0),
        }),
        ageHours: hoursSince(r.due_date),
        deepLink: '/financial-management/adjustment-approvals',
        severity: 'medium',
    }));
};

// Unread system alerts (top 5) — clicking opens the existing alerts modal.
const buildUnreadAlertActions = (
    page: PagedResponse<SystemAlertItem>,
    t: TFunction
): PendingAction[] =>
    page.content
        .filter((a) => a.isRead === false && a.isDismissed !== true)
        .slice(0, 5)
        .map((a) => {
            const preview =
                a.content?.type === 'html'
                    ? stripHtml(a.content?.content || '')
                    : a.content?.content || '';
            return {
                id: `alert:${a.messageId}`,
                type: 'UNREAD_ALERT' as const,
                title: a.title || t('dashboardPendingActionsService:unreadAlert.defaultTitle'),
                subtitle: preview ? preview.slice(0, 80) : undefined,
                ageHours: hoursSince(a.createdAt),
                deepLink: '/dashboard?alerts=open',
                severity: 'low',
            };
        });

const SEVERITY_RANK: Record<PendingActionSeverity, number> = {
    high: 3,
    medium: 2,
    low: 1,
};

export interface PendingActionSources {
    adjustments: SourceState<StudentFeeDueDTO[]>;
    alerts: SourceState<PagedResponse<SystemAlertItem>>;
    /** Omit when the viewer shouldn't see institute fee totals (non-admins). */
    feeCollection?: SourceState<DashboardCollectionResponse>;
}

export interface PendingActionsResult {
    actions: PendingAction[];
    /** True while any applicable source is still loading (and none has data yet to show). */
    isLoading: boolean;
    /**
     * True when at least one source failed. The list then holds only what DID load, and the
     * widget must not claim "All clear" — an empty list is not evidence of nothing pending.
     */
    hasFailedSource: boolean;
}

/**
 * Merge the sources into one prioritised list. Pure: callers fetch through the shared
 * dashboard hooks so these requests are not repeated per widget.
 */
export const buildPendingActions = (
    sources: PendingActionSources,
    t: TFunction,
    limit = 20
): PendingActionsResult => {
    // fetchSystemAlerts never rejects; its failure stand-in is flagged instead.
    const alertsFailed = sources.alerts.isError || sources.alerts.data?.fetchFailed === true;
    const applicable: SourceState<unknown>[] = [sources.adjustments, sources.alerts];
    if (sources.feeCollection) applicable.push(sources.feeCollection);

    const groups: PendingAction[][] = [];
    if (sources.feeCollection?.data && !sources.feeCollection.isError) {
        groups.push(buildOverdueSummaryActions(sources.feeCollection.data, t));
    }
    if (sources.adjustments.data && !sources.adjustments.isError) {
        groups.push(buildPendingApprovalActions(sources.adjustments.data, t));
    }
    if (sources.alerts.data && !alertsFailed) {
        groups.push(buildUnreadAlertActions(sources.alerts.data, t));
    }

    const all = groups.flat();
    all.sort((a, b) => {
        const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (sev !== 0) return sev;
        return b.ageHours - a.ageHours;
    });

    return {
        actions: all.slice(0, limit),
        isLoading: applicable.some((s) => s.isLoading),
        hasFailedSource:
            alertsFailed || sources.adjustments.isError || !!sources.feeCollection?.isError,
    };
};
