import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { canSeeReport, type ReportEntry } from './report-catalogue';
import { BUSY_AUTO_RETRIES, readReportError, retryAfterMs } from './report-errors';
import {
    fetchApprovals,
    fetchAudit,
    fetchAuditActors,
    fetchAuditKinds,
    fetchReport,
    fetchReportPlaces,
    REPORT_PAGE_SIZE,
} from './reports-api';
import type { AuditFilterValues, ReportFilterValues, ReportPlace } from './report-types';

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
    actors: () => [...root(), 'audit-actors'] as const,
};

const NO_PLACES: ReportPlace[] = [];

/**
 * A screen read refused as busy (429 `REPORTS_BUSY`, R6) is tried again on its
 * own, after the server's `Retry-After`, twice; anything else is not (the
 * page offers Retry: a 25 s report should not run three times).
 */
export const busyRetry = (failures: number, error: unknown): boolean =>
    failures < BUSY_AUTO_RETRIES && readReportError(error).busy;
export const busyRetryDelay = (_attempt: number, error: unknown): number => retryAfterMs(error);

export function useReportAccess() {
    const access = useCommerceAccess();
    return useMemo(
        () => ({ access, enabled: access.isResolved && access.canOpen('commerce-reports') && !!getInstituteId() }),
        [access]
    );
}

/**
 * The places the person may report on (R9, `GET /reports/places`; ADMIN: all),
 * readable by every report reader without the stock feature (M11), with their
 * GSTINs (M7) and whether the GST reports are open to the person (M6).
 */
export function useReportLocations() {
    const { enabled } = useReportAccess();
    const query = useQuery({
        queryKey: reportKeys.locations(),
        queryFn: fetchReportPlaces,
        enabled,
        staleTime: REFERENCE_STALE_MS,
        retry: false,
    });
    return { ...query, places: query.data?.places ?? NO_PLACES, allPlaces: query.data?.allPlaces ?? null };
}

export function useReport(entry: ReportEntry, filters: ReportFilterValues, cursor: string | null, on = true) {
    const { access, enabled } = useReportAccess();
    const api = entry.api ?? '';
    // N8: a deep link to a report whose feature is off (or not the person's) asks nothing.
    const open = enabled && canSeeReport(entry, access);
    return useQuery({
        queryKey: reportKeys.report(api, filters, cursor),
        queryFn: () =>
            fetchReport(api, filters, cursor, entry.kind === 'register' ? REPORT_PAGE_SIZE : undefined),
        enabled: open && on && !!entry.api && entry.kind !== 'file',
        staleTime: REPORT_STALE_MS,
        placeholderData: keepPreviousData,
        retry: busyRetry,
        retryDelay: busyRetryDelay,
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
        retry: busyRetry,
        retryDelay: busyRetryDelay,
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
        retry: busyRetry,
        retryDelay: busyRetryDelay,
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

/** Everyone seen in the person's audit scope (R9, `GET /reports/audit/actors`): the "who" filter. */
export function useAuditActors() {
    const { enabled } = useReportAccess();
    return useQuery({
        queryKey: reportKeys.actors(),
        queryFn: fetchAuditActors,
        enabled,
        staleTime: REFERENCE_STALE_MS,
        retry: false,
    });
}
