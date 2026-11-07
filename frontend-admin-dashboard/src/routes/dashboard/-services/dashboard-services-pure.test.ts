import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { StudentFeeDueDTO } from '@/types/manage-finances';
import type { PagedResponse, SystemAlertItem } from '@/services/notifications/system-alerts';
import type { DashboardCollectionResponse } from '@/services/manage-finances';
import {
    ADJUSTMENT_PENDING_STATUS,
    isAdjustmentPendingApproval,
    toFeeTotals,
    toSourceState,
    type SourceState,
} from './dashboard-sources';
import { buildPendingActions } from './pending-actions-service';
import { buildAdminKpis, buildTeacherKpis } from './dashboard-kpis-service';

const t = ((key: string) => key) as unknown as TFunction;

const ok = <T>(data: T): SourceState<T> => ({ data, isLoading: false, isError: false });
const failed = <T>(): SourceState<T> => ({ data: undefined, isLoading: false, isError: true });
const loading = <T>(): SourceState<T> => ({ data: undefined, isLoading: true, isError: false });

const bill = (over: Partial<StudentFeeDueDTO>): StudentFeeDueDTO =>
    ({
        id: 'b1',
        student_name: 'Asha',
        adjustment_status: ADJUSTMENT_PENDING_STATUS,
        adjustment_type: 'CONCESSION',
        adjustment_amount: 500,
        due_date: new Date().toISOString(),
        ...over,
    }) as StudentFeeDueDTO;

const alertsPage = (
    content: Partial<SystemAlertItem>[],
    extra: Partial<PagedResponse<SystemAlertItem>> = {}
): PagedResponse<SystemAlertItem> =>
    ({ content: content as SystemAlertItem[], ...extra }) as PagedResponse<SystemAlertItem>;

const collection = (over: Partial<DashboardCollectionResponse> = {}): DashboardCollectionResponse =>
    ({
        projectedRevenue: 10_000,
        expectedToDate: 6_000,
        collectedToDate: 4_000,
        totalOverdue: 2_000,
        classWiseBreakdown: [],
        paymentModeBreakdown: [],
        ...over,
    }) as DashboardCollectionResponse;

describe('pending-approval status', () => {
    it("matches the backend's PENDING_FOR_APPROVAL, not PENDING_APPROVAL", () => {
        expect(isAdjustmentPendingApproval({ adjustment_status: 'PENDING_FOR_APPROVAL' })).toBe(
            true
        );
        expect(isAdjustmentPendingApproval({ adjustment_status: 'PENDING_APPROVAL' })).toBe(false);
        expect(isAdjustmentPendingApproval({ adjustment_status: 'APPROVED' })).toBe(false);
    });
});

describe('toFeeTotals', () => {
    it('reads outstanding/overdue like the Collection Dashboard page', () => {
        expect(toFeeTotals(collection())).toEqual({ outstanding: 6_000, overdue: 2_000 });
    });

    it('never goes negative on over-collection', () => {
        expect(toFeeTotals(collection({ collectedToDate: 12_000, totalOverdue: 0 }))).toEqual({
            outstanding: 0,
            overdue: 0,
        });
    });
});

describe('toSourceState', () => {
    it('treats a disabled (idle) pending query as not loading', () => {
        expect(
            toSourceState({ data: undefined, isPending: true, isError: false, fetchStatus: 'idle' })
                .isLoading
        ).toBe(false);
        expect(
            toSourceState({
                data: undefined,
                isPending: true,
                isError: false,
                fetchStatus: 'fetching',
            }).isLoading
        ).toBe(true);
    });
});

describe('buildPendingActions', () => {
    it('lists bills awaiting approval (PENDING_FOR_APPROVAL)', () => {
        const res = buildPendingActions(
            {
                adjustments: ok([bill({}), bill({ id: 'b2', adjustment_status: 'APPROVED' })]),
                alerts: ok(alertsPage([])),
            },
            t
        );
        expect(res.actions.map((a) => a.id)).toEqual(['approval:b1']);
        expect(res.actions[0]?.deepLink).toBe('/financial-management/adjustment-approvals');
        expect(res.hasFailedSource).toBe(false);
    });

    it('adds one institute-wide overdue row from the collection totals (admins)', () => {
        const res = buildPendingActions(
            {
                adjustments: ok([]),
                alerts: ok(alertsPage([])),
                feeCollection: ok(collection()),
            },
            t
        );
        expect(res.actions.map((a) => a.id)).toEqual(['overdue:institute']);
        expect(res.actions[0]?.severity).toBe('high');
    });

    it('adds no overdue row when nothing is overdue', () => {
        const res = buildPendingActions(
            {
                adjustments: ok([]),
                alerts: ok(alertsPage([])),
                feeCollection: ok(collection({ totalOverdue: 0 })),
            },
            t
        );
        expect(res.actions).toEqual([]);
    });

    it('flags a failed request so the widget never says "All clear"', () => {
        const res = buildPendingActions({ adjustments: failed(), alerts: ok(alertsPage([])) }, t);
        expect(res.actions).toEqual([]);
        expect(res.hasFailedSource).toBe(true);
    });

    it("treats fetchSystemAlerts' empty failure stand-in as a failed source", () => {
        const res = buildPendingActions(
            { adjustments: ok([]), alerts: ok(alertsPage([], { fetchFailed: true })) },
            t
        );
        expect(res.hasFailedSource).toBe(true);
    });

    it('keeps what loaded when another source failed (partial failure)', () => {
        const res = buildPendingActions(
            {
                adjustments: ok([bill({})]),
                alerts: ok(alertsPage([])),
                feeCollection: failed(),
            },
            t
        );
        expect(res.actions.map((a) => a.id)).toEqual(['approval:b1']);
        expect(res.hasFailedSource).toBe(true);
    });

    it('reports loading while a source is in flight', () => {
        const res = buildPendingActions({ adjustments: loading(), alerts: ok(alertsPage([])) }, t);
        expect(res.isLoading).toBe(true);
    });
});

describe('buildAdminKpis', () => {
    it('marks only the cards whose source failed', () => {
        const kpis = buildAdminKpis(
            {
                counts: ok({ active_student_count: 12, course_count: 3 }),
                teamCount: ok(4),
                feeCollection: failed(),
                sessions: loading(),
            },
            t
        );
        const status = Object.fromEntries(kpis.map((k) => [k.id, k.status]));
        expect(status).toEqual({
            activeLearners: 'ready',
            totalCourses: 'ready',
            teamMembers: 'ready',
            outstandingFees: 'error',
            overdueFees: 'error',
            classesToday: 'loading',
        });
    });

    it('fills both fee cards from the collection totals', () => {
        const kpis = buildAdminKpis(
            {
                counts: ok({}),
                teamCount: ok(0),
                feeCollection: ok(collection()),
                sessions: ok([]),
            },
            t
        );
        const value = Object.fromEntries(kpis.map((k) => [k.id, k.value]));
        expect(value.outstandingFees).toBe(6_000);
        expect(value.overdueFees).toBe(2_000);
    });
});

describe('buildTeacherKpis', () => {
    it("marks today's classes failed instead of showing 0", () => {
        expect(buildTeacherKpis(failed(), t)[0]?.status).toBe('error');
    });
});
