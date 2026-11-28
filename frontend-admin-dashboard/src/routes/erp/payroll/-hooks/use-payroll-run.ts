import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import {
    ERP_KEY,
    approvePayrollRun,
    cancelPayrollRun,
    fetchPayrollEntries,
    fetchPayrollErrors,
    fetchPayrollRun,
    holdPayrollEntry,
    hrKeys,
    markPayrollRunPaid,
    processPayrollRun,
    rejectPayrollRun,
    releasePayrollEntry,
} from '@/routes/erp/-shared/hr-service';
import type {
    PayrollEntryDTO,
    PayrollEntryError,
    PayrollRunDTO,
} from '@/routes/erp/-shared/hr-types';
import { runTransitions, type RunTransitions } from '@/routes/erp/-shared/payroll-status';

/**
 * Everything the run-detail screen needs: the run, its entries, its per-employee
 * errors, and the six state transitions.
 *
 * Every mutation resolves to the server's own message on success — that string is
 * the only place a partial failure ("… N failed, see run errors") is reported, so
 * it must reach the user verbatim — or to `null` when the call failed, in which
 * case the error has already been reported and toasted. Callers therefore never
 * need a try/catch, which keeps the action bar presentational.
 *
 * Invalidation is deliberately coarse for the money-moving transitions. Processing
 * consumes adjustments and schedules loan EMIs; rejecting reverses all of it;
 * cancelling releases them again. Those ripple into salary, loans and reimbursement
 * caches this screen doesn't own, so the whole ERP namespace is dropped rather than
 * curating a list that will silently rot as the module grows. Holding one entry is
 * local, so it only refreshes the run and its lines.
 */
export interface UsePayrollRunResult {
    run: PayrollRunDTO | undefined;
    entries: PayrollEntryDTO[];
    errors: PayrollEntryError[];
    transitions: RunTransitions;
    isRunLoading: boolean;
    isRunError: boolean;
    isEntriesLoading: boolean;
    isEntriesError: boolean;
    isErrorsLoading: boolean;
    isErrorsError: boolean;
    refetchRun: () => Promise<unknown>;
    refetchEntries: () => Promise<unknown>;
    refetchErrors: () => Promise<unknown>;
    process: () => Promise<string | null>;
    approve: () => Promise<string | null>;
    reject: () => Promise<string | null>;
    markPaid: () => Promise<string | null>;
    cancel: () => Promise<string | null>;
    holdEntry: (entryId: string, reason: string) => Promise<string | null>;
    releaseEntry: (entryId: string) => Promise<string | null>;
}

export function usePayrollRun(runId: string): UsePayrollRunResult {
    const { t } = useTranslation('erpUsePayrollRun');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const enabled = !!runId && !!instituteId;

    const runQuery = useQuery({
        queryKey: hrKeys.payrollRun(runId),
        queryFn: () => fetchPayrollRun(runId),
        enabled,
    });

    const entriesQuery = useQuery({
        queryKey: hrKeys.payrollEntries(runId),
        queryFn: () => fetchPayrollEntries(runId),
        enabled,
    });

    const errorsQuery = useQuery({
        queryKey: hrKeys.payrollErrors(runId),
        queryFn: () => fetchPayrollErrors(runId),
        enabled,
    });

    /** Run + its lines + its errors + the listing whose totals just changed. */
    const refreshRun = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: hrKeys.payrollRun(runId) }),
            queryClient.invalidateQueries({ queryKey: hrKeys.payrollEntries(runId) }),
            queryClient.invalidateQueries({ queryKey: hrKeys.payrollErrors(runId) }),
            queryClient.invalidateQueries({ queryKey: [...ERP_KEY, 'payroll-runs'] }),
        ]);
    }, [queryClient, runId]);

    /** A transition that touched loans, reimbursements or the journal. */
    const refreshModule = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: ERP_KEY });
    }, [queryClient]);

    const act = useCallback(
        async (
            action: string,
            call: () => Promise<string>,
            refresh: () => Promise<void>
        ): Promise<string | null> => {
            try {
                const message = await call();
                await refresh();
                return typeof message === 'string' && message.trim() ? message : t('done');
            } catch (error) {
                reportApiError(error, {
                    feature: 'erp-payroll',
                    tags: { action, run_id: runId },
                });
                return null;
            }
        },
        [runId, t]
    );

    const process = useCallback(
        () => act('process-run', () => processPayrollRun(runId), refreshModule),
        [act, runId, refreshModule]
    );

    const approve = useCallback(
        () => act('approve-run', () => approvePayrollRun(runId), refreshModule),
        [act, runId, refreshModule]
    );

    const reject = useCallback(
        () => act('reject-run', () => rejectPayrollRun(runId), refreshModule),
        [act, runId, refreshModule]
    );

    const markPaid = useCallback(
        () => act('mark-run-paid', () => markPayrollRunPaid(runId), refreshModule),
        [act, runId, refreshModule]
    );

    const cancel = useCallback(
        () => act('cancel-run', () => cancelPayrollRun(runId), refreshModule),
        [act, runId, refreshModule]
    );

    const holdEntry = useCallback(
        (entryId: string, reason: string) =>
            act('hold-entry', () => holdPayrollEntry(entryId, reason), refreshRun),
        [act, refreshRun]
    );

    const releaseEntry = useCallback(
        (entryId: string) => act('release-entry', () => releasePayrollEntry(entryId), refreshRun),
        [act, refreshRun]
    );

    return {
        run: runQuery.data,
        entries: entriesQuery.data ?? [],
        errors: errorsQuery.data ?? [],
        transitions: runTransitions(runQuery.data?.status),
        isRunLoading: runQuery.isLoading,
        isRunError: runQuery.isError,
        isEntriesLoading: entriesQuery.isLoading,
        isEntriesError: entriesQuery.isError,
        isErrorsLoading: errorsQuery.isLoading,
        isErrorsError: errorsQuery.isError,
        refetchRun: runQuery.refetch,
        refetchEntries: entriesQuery.refetch,
        refetchErrors: errorsQuery.refetch,
        process,
        approve,
        reject,
        markPaid,
        cancel,
        holdEntry,
        releaseEntry,
    };
}
