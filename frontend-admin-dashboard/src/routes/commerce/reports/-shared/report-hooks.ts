import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { fetchCommerceStaff } from '@/routes/commerce/-shared/commerce-api';
import { fetchInventoryLocations } from '@/routes/commerce/inventory/-shared/inventory-api';
import { assignedLocations } from '@/routes/commerce/inventory/-shared/inventory-hooks';
import type { ReportEntry } from './report-catalogue';
import { fetchApprovals, fetchAudit, fetchAuditKinds, fetchReport, REPORT_PAGE_SIZE } from './reports-api';
import type { AuditFilterValues, ReportFilterValues } from './report-types';

/**
 * Query bindings of the report screens. Keys start with
 * `['commerce', <institute>, 'reports']`. Nothing is fetched until the
 * person's access is known and opens the reports screen; a failed report is
 * not retried on its own (the page offers Retry: a 25 s report should not run
 * three times).
 */

const REFERENCE_STALE_MS = 5 * 60 * 1000;
const REPORT_STALE_MS = 30 * 1000;

const root = () => ['commerce', getInstituteId() ?? 'none', 'reports'] as const;

export const reportKeys = {
    locations: () => [...root(), 'locations'] as const,
    report: (api: string, filters: ReportFilterValues, cursor: string | null) =>
        [...root(), 'report', api, filters, cursor] as const,
    audit: (filters: AuditFilterValues, cursor: string | null) => [...root(), 'audit', filters, cursor] as const,
    approvals: (filters: AuditFilterValues, cursor: string | null) =>
        [...root(), 'approvals', filters, cursor] as const,
    kinds: () => [...root(), 'audit-kinds'] as const,
    staff: () => [...root(), 'staff'] as const,
};

export function useReportAccess() {
    const access = useCommerceAccess();
    return useMemo(
        () => ({ access, enabled: access.isResolved && access.canOpen('commerce-reports') && !!getInstituteId() }),
        [access]
    );
}

/**
 * The places the person may pick (ADMIN: all). Read from the locations list
 * the stock screens use; when that list is closed to the person (it needs the
 * stock feature) the picker offers "All my places" only and the server still
 * filters to what they may see.
 */
export function useReportLocations() {
    const { enabled } = useReportAccess();
    const query = useQuery({
        queryKey: reportKeys.locations(),
        queryFn: fetchInventoryLocations,
        enabled,
        staleTime: REFERENCE_STALE_MS,
        retry: false,
    });
    const places = useMemo(() => assignedLocations(query.data), [query.data]);
    return { ...query, places };
}

export function useReport(entry: ReportEntry, filters: ReportFilterValues, cursor: string | null, on = true) {
    const { enabled } = useReportAccess();
    const api = entry.api ?? '';
    return useQuery({
        queryKey: reportKeys.report(api, filters, cursor),
        queryFn: () =>
            fetchReport(api, filters, cursor, entry.kind === 'register' ? REPORT_PAGE_SIZE : undefined),
        enabled: enabled && on && !!entry.api && entry.kind !== 'file',
        staleTime: REPORT_STALE_MS,
        placeholderData: keepPreviousData,
        retry: false,
    });
}

export function useAuditLog(filters: AuditFilterValues, cursor: string | null, on: boolean) {
    const { enabled } = useReportAccess();
    return useQuery({
        queryKey: reportKeys.audit(filters, cursor),
        queryFn: () => fetchAudit(filters, cursor),
        enabled: enabled && on,
        staleTime: REPORT_STALE_MS,
        placeholderData: keepPreviousData,
        retry: false,
    });
}

export function useApprovals(filters: AuditFilterValues, cursor: string | null, on: boolean) {
    const { enabled } = useReportAccess();
    return useQuery({
        queryKey: reportKeys.approvals(filters, cursor),
        queryFn: () => fetchApprovals(filters, cursor),
        enabled: enabled && on,
        staleTime: REPORT_STALE_MS,
        placeholderData: keepPreviousData,
        retry: false,
    });
}

export function useAuditKinds() {
    const { enabled } = useReportAccess();
    return useQuery({
        queryKey: reportKeys.kinds(),
        queryFn: fetchAuditKinds,
        enabled,
        staleTime: REFERENCE_STALE_MS,
        retry: false,
    });
}

/** Shop staff for the "who" filter; closed to some readers, then the page uses the names it has seen. */
export function useStaffNames() {
    const { enabled } = useReportAccess();
    return useQuery({
        queryKey: reportKeys.staff(),
        queryFn: fetchCommerceStaff,
        enabled,
        staleTime: REFERENCE_STALE_MS,
        retry: false,
    });
}
