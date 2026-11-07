import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import {
    downloadPayslipPdf,
    emailPayslips,
    fetchEmployeeDirectory,
    fetchEmployeePayslips,
    generatePayslips,
    hrKeys,
} from '@/routes/erp/-shared/hr-service';
import type {
    PayrollEntryDTO,
    PayrollRunDTO,
    PayslipDTO,
    PayslipEmailResult,
} from '@/routes/erp/-shared/hr-types';

/** A payslip with the employee's name resolved for display. */
export interface PayslipRow extends PayslipDTO {
    employee_name?: string;
}

/**
 * How many employee payslip lookups run at once. The browser caps concurrent
 * connections per host at ~6 anyway; queueing here keeps the payroll screen from
 * starving the run/entries requests it shares the connection pool with.
 */
const LOOKUP_CONCURRENCY = 6;

/** Statuses the backend refuses to generate payslips for (PayslipService). */
const NOT_GENERATABLE = new Set(['DRAFT', 'PROCESSING', 'CANCELLED']);

async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const worker = async () => {
        for (;;) {
            const index = cursor++;
            if (index >= items.length) return;
            results[index] = await task(items[index] as T);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/**
 * Employee id → name and code → name, for the two screens whose payloads carry
 * only an id or a code. One shared query, so the payslip and bank-file tabs pay
 * for it once.
 */
export function useEmployeeNames() {
    const instituteId = getInstituteId();

    const { data } = useQuery({
        queryKey: hrKeys.employeeDirectory(),
        queryFn: fetchEmployeeDirectory,
        enabled: !!instituteId,
        // Names change about never; re-fetching them on every tab switch is waste.
        staleTime: 5 * 60 * 1000,
    });

    return useMemo(() => {
        const byId = new Map<string, string>();
        const byCode = new Map<string, string>();
        for (const employee of data ?? []) {
            const name = employee.full_name?.trim();
            if (!name) continue;
            if (employee.id) byId.set(employee.id, name);
            if (employee.employee_code) byCode.set(employee.employee_code, name);
        }
        return { byId, byCode };
    }, [data]);
}

export interface UsePayslipsArgs {
    runId: string;
    run: PayrollRunDTO | undefined;
    /** The run's entries, already fetched by `usePayrollRun` — see the listing note below. */
    entries: PayrollEntryDTO[];
    isEntriesLoading: boolean;
}

export interface UsePayslipsResult {
    payslips: PayslipRow[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
    /** False when the run's status makes the backend refuse — `blockedReason` says why. */
    canGenerate: boolean;
    blockedReason: string | null;
    generate: () => Promise<string | null>;
    emailAll: () => Promise<PayslipEmailResult | null>;
    download: (payslip: PayslipRow) => Promise<boolean>;
}

/**
 * The payslips belonging to one payroll run.
 *
 * **Listing approach.** The API has no "payslips for run X" endpoint: the only
 * list is `GET /payslips?employeeId=&year=`. Two options existed — one request
 * per employee, or reuse the run's ENTRIES (already in cache from
 * `usePayrollRun`, so free) and fan out over them. Both cost the same number of
 * requests, but going through the entries means the fan-out is bounded by the
 * run's headcount rather than the institute's, skips employees who were never in
 * this run, and — crucially — gives us the entry ids to match on. `PayslipDTO`
 * carries `payroll_entry_id`, so a payslip is attributed to this run by entry id,
 * exactly. Month/year alone would be wrong: an off-cycle or bonus run shares the
 * period with the regular one and its payslips would be double-counted here.
 *
 * The per-employee calls are queued at {@link LOOKUP_CONCURRENCY} and fail loud —
 * a partially assembled list of who has a payslip is worse than an error state,
 * because the tab's whole job is telling you whether generation covered everyone.
 */
export function usePayslips({
    runId,
    run,
    entries,
    isEntriesLoading,
}: UsePayslipsArgs): UsePayslipsResult {
    const { t } = useTranslation('erpUsePayslips');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const { byId } = useEmployeeNames();

    const employeeIds = useMemo(
        () =>
            Array.from(
                new Set(
                    entries
                        .map((entry) => entry.employee_id)
                        .filter((id): id is string => !!id)
                )
            ),
        [entries]
    );

    const entryIds = useMemo(
        () => new Set(entries.map((entry) => entry.id).filter((id): id is string => !!id)),
        [entries]
    );

    const year = run?.year;
    const enabled = !!runId && !!instituteId && employeeIds.length > 0;

    const query = useQuery({
        queryKey: hrKeys.payslips(runId),
        queryFn: async () => {
            const lists = await mapWithConcurrency(employeeIds, LOOKUP_CONCURRENCY, (employeeId) =>
                fetchEmployeePayslips(employeeId, year)
            );
            return lists
                .flat()
                .filter(
                    (payslip) => !!payslip.payroll_entry_id && entryIds.has(payslip.payroll_entry_id)
                );
        },
        enabled,
    });

    const payslips = useMemo<PayslipRow[]>(() => {
        const rows = (query.data ?? []).map((payslip) => ({
            ...payslip,
            employee_name: payslip.employee_id ? byId.get(payslip.employee_id) : undefined,
        }));
        return rows.sort((a, b) =>
            (a.employee_code ?? '').localeCompare(b.employee_code ?? '', undefined, {
                numeric: true,
            })
        );
    }, [query.data, byId]);

    const status = (run?.status ?? '').toUpperCase();
    const blockedReason = NOT_GENERATABLE.has(status)
        ? status === 'CANCELLED'
            ? t('blockedCancelled')
            : t('blockedNotProcessed')
        : null;
    const canGenerate = !!run && blockedReason === null;

    const refresh = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: hrKeys.payslips(runId) });
    }, [queryClient, runId]);

    const generate = useCallback(async (): Promise<string | null> => {
        try {
            const message = await generatePayslips(runId);
            await refresh();
            // The server distinguishes newly generated from re-rendered legacy
            // payslips in this sentence, so it is passed through untouched.
            return message.trim() ? message : t('generatedFallback');
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-payslips',
                tags: { action: 'generate-payslips', run_id: runId },
            });
            return null;
        }
    }, [runId, refresh, t]);

    const emailAll = useCallback(async (): Promise<PayslipEmailResult | null> => {
        try {
            const result = await emailPayslips(runId);
            // email_status / emailed_at just changed on every row.
            await refresh();
            return result;
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-payslips',
                tags: { action: 'email-payslips', run_id: runId },
            });
            return null;
        }
    }, [runId, refresh]);

    const download = useCallback(
        async (payslip: PayslipRow): Promise<boolean> => {
            if (!payslip.id) return false;
            const code = payslip.employee_code || payslip.employee_id || 'employee';
            const fileName = `payslip_${code}_${payslip.month ?? ''}_${payslip.year ?? ''}.pdf`;
            try {
                await downloadPayslipPdf(payslip.id, fileName);
                return true;
            } catch (error) {
                reportApiError(error, {
                    feature: 'erp-payslips',
                    tags: { action: 'download-payslip', run_id: runId },
                });
                return false;
            }
        },
        [runId]
    );

    return {
        payslips,
        // While entries are still arriving the query is disabled, which reads as
        // "loaded, empty" — say loading instead so the empty state can't flash.
        isLoading: isEntriesLoading || (enabled && query.isPending),
        isError: query.isError,
        refetch: query.refetch,
        canGenerate,
        blockedReason,
        generate,
        emailAll,
        download,
    };
}
