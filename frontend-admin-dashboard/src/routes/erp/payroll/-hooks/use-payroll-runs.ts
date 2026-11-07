import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatMonthValue, type MonthValue } from '@/components/design-system/month-picker';
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import {
    ERP_KEY,
    createPayrollRun,
    fetchPayrollRuns,
    hrKeys,
} from '@/routes/erp/-shared/hr-service';
import type { PayrollRunDTO } from '@/routes/erp/-shared/hr-types';
import { buildRunTypeLabels, type PayrollRunType } from '@/routes/erp/-shared/payroll-status';

/** Anything that looks like a UUID — how we tell "created id" from "server message". */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateRunInput {
    period: MonthValue;
    runType: PayrollRunType;
    notes?: string;
}

/**
 * Whether the run was created, kept separate from where to go next.
 *
 * A run can be created successfully and still leave us without an id to navigate
 * to (the endpoint answers with a sentence and the refetch races the write). That
 * is a successful create with no destination, not a failure — collapsing the two
 * into `string | null` would tell the user their payroll run failed when it exists.
 */
export interface CreateRunResult {
    created: boolean;
    runId?: string;
}

/**
 * The runs listing plus creation.
 *
 * `fetchPayrollRuns` returns a plain array (no Spring Page), so ordering and the
 * MyTable envelope are the caller's job — done here rather than in each screen so
 * the list is sorted the same way everywhere: newest period first, because the
 * run you want is almost always the one you just made.
 */
export function usePayrollRuns(year: number) {
    const { t } = useTranslation(['erpUsePayrollRuns', 'erpPayrollStatus']);
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();

    const runsQuery = useQuery({
        queryKey: hrKeys.payrollRuns(year),
        queryFn: () => fetchPayrollRuns(year),
        enabled: !!instituteId,
    });

    /**
     * Create a run and resolve the id to navigate to.
     *
     * The endpoint returns a bare string. Every other create in hr-service returns
     * the new id, but a run creation can also come back as a sentence, so the id is
     * only trusted when it parses as a UUID; otherwise we re-read the list and match
     * on the period, which is unique per (month, year, run_type) by construction.
     * `created: false` means the call failed — the error has already been reported.
     */
    const create = useCallback(
        async ({ period, runType, notes }: CreateRunInput): Promise<CreateRunResult> => {
            try {
                const created = await createPayrollRun({
                    month: period.month,
                    year: period.year,
                    run_type: runType,
                    notes: notes?.trim() || undefined,
                });

                // Every cached year is stale now: the list is filtered server-side.
                await queryClient.invalidateQueries({ queryKey: [...ERP_KEY, 'payroll-runs'] });

                if (typeof created === 'string' && UUID_RE.test(created.trim())) {
                    return { created: true, runId: created.trim() };
                }

                const fresh = await queryClient.fetchQuery({
                    queryKey: hrKeys.payrollRuns(period.year),
                    queryFn: () => fetchPayrollRuns(period.year),
                });
                const match = (fresh as PayrollRunDTO[]).find(
                    (run) =>
                        run.month === period.month &&
                        run.year === period.year &&
                        (run.run_type ?? 'REGULAR').toUpperCase() === runType
                );
                return { created: true, runId: match?.id };
            } catch (error) {
                const message = reportApiError(error, {
                    feature: 'erp-payroll',
                    showToast: false,
                    tags: { action: 'create-run', run_type: runType },
                    extra: { month: period.month, year: period.year },
                });
                // The backend refuses a second run for the same month + type. That is a
                // normal thing to bump into, not a failure worth a raw stack sentence.
                if (/already exist|duplicate/i.test(message)) {
                    toast.error(
                        t('errors.duplicateRun', {
                            runType: buildRunTypeLabels(t)[runType].toLowerCase(),
                            period: formatMonthValue(period),
                        })
                    );
                } else {
                    toast.error(message);
                }
                return { created: false };
            }
        },
        [queryClient, t]
    );

    return {
        runs: runsQuery.data ?? [],
        isLoading: runsQuery.isLoading,
        isError: runsQuery.isError,
        refetch: runsQuery.refetch,
        create,
    };
}
