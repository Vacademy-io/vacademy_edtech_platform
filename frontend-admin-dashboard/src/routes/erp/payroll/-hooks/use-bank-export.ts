import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import {
    downloadBankExportFile,
    fetchBankExports,
    generateBankExport,
    hrKeys,
} from '@/routes/erp/-shared/hr-service';
import type {
    BankExportDTO,
    BankExportFormat,
    BankExportResult,
    PayrollRunDTO,
} from '@/routes/erp/-shared/hr-types';
import { useEmployeeNames } from './use-payslips';

/** Statuses the backend accepts for a bank export (BankExportService). */
const EXPORTABLE = new Set(['APPROVED', 'PAID']);

export interface UseBankExportArgs {
    runId: string;
    run: PayrollRunDTO | undefined;
}

export interface UseBankExportResult {
    /** Files generated for this run before now. */
    history: BankExportDTO[];
    isHistoryLoading: boolean;
    isHistoryError: boolean;
    refetchHistory: () => Promise<unknown>;
    /** The file generated in this session — kept locally because only the POST returns skips. */
    result: BankExportResult | null;
    clearResult: () => void;
    /** False when the run's status makes the backend refuse — `blockedReason` says why. */
    canGenerate: boolean;
    blockedReason: string | null;
    generate: (format: BankExportFormat) => Promise<BankExportResult | null>;
    download: (bankExport: BankExportDTO) => Promise<boolean>;
}

/**
 * Bank payment files for one payroll run.
 *
 * The generate response is held in component state rather than in the query
 * cache on purpose: the excluded-employee list only ever comes back from the
 * POST. `GET /reports/bank-export` returns the export LOG (file name, record
 * count, total) and says nothing about who was left out, so re-reading the
 * history after generating would silently drop the one output that needs acting
 * on. History and result are therefore shown as two different things.
 *
 * Skipped rows are enriched with employee names from the shared directory: the
 * API returns a bare code, and "EMP0142 — missing IFSC" is not something the
 * person fixing it can look up quickly.
 */
export function useBankExport({ runId, run }: UseBankExportArgs): UseBankExportResult {
    const { t } = useTranslation('erpUseBankExport');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const { byCode } = useEmployeeNames();
    const [result, setResult] = useState<BankExportResult | null>(null);

    const historyQuery = useQuery({
        queryKey: hrKeys.bankExports(runId),
        queryFn: () => fetchBankExports(runId),
        enabled: !!runId && !!instituteId,
    });

    const status = (run?.status ?? '').toUpperCase();
    const blockedReason = run
        ? EXPORTABLE.has(status)
            ? null
            : status === 'CANCELLED'
              ? t('blockedReasons.cancelled')
              : t('blockedReasons.notApproved')
        : null;
    const canGenerate = !!run && blockedReason === null;

    const withNames = useCallback(
        (raw: BankExportResult): BankExportResult => ({
            ...raw,
            skipped: raw.skipped.map((entry) => ({
                ...entry,
                employee_name:
                    entry.employee_name ??
                    (entry.employee_code ? byCode.get(entry.employee_code) : undefined),
            })),
        }),
        [byCode]
    );

    const generate = useCallback(
        async (format: BankExportFormat): Promise<BankExportResult | null> => {
            try {
                const raw = await generateBankExport(runId, format);
                const enriched = withNames(raw);
                setResult(enriched);
                await queryClient.invalidateQueries({ queryKey: hrKeys.bankExports(runId) });
                return enriched;
            } catch (error) {
                reportApiError(error, {
                    feature: 'erp-bank-export',
                    tags: { action: 'generate-bank-export', run_id: runId, format },
                });
                return null;
            }
        },
        [runId, queryClient, withNames]
    );

    const download = useCallback(
        async (bankExport: BankExportDTO): Promise<boolean> => {
            if (!bankExport.id) return false;
            const fileName =
                bankExport.file_name?.trim() ||
                `bank_export_${bankExport.format ?? 'file'}_${runId}.txt`;
            try {
                await downloadBankExportFile(bankExport.id, fileName);
                return true;
            } catch (error) {
                reportApiError(error, {
                    feature: 'erp-bank-export',
                    tags: { action: 'download-bank-export', run_id: runId },
                });
                return false;
            }
        },
        [runId]
    );

    /** Names arrive after the POST when the directory was still loading — re-map on read. */
    const namedResult = useMemo(() => (result ? withNames(result) : null), [result, withNames]);

    return {
        history: historyQuery.data ?? [],
        isHistoryLoading: historyQuery.isLoading,
        isHistoryError: historyQuery.isError,
        refetchHistory: historyQuery.refetch,
        result: namedResult,
        clearResult: () => setResult(null),
        canGenerate,
        blockedReason,
        generate,
        download,
    };
}
