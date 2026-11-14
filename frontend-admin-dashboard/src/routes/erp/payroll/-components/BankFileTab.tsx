import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Bank, DownloadSimple, Info, Prohibit, UserMinus, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { MyTable, type TableData } from '@/components/design-system/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type {
    BankExportDTO,
    BankExportFormat,
    BankExportSkippedEntry,
    PayrollRunDTO,
} from '@/routes/erp/-shared/hr-types';
import { HrEmptyState, HrErrorState } from '@/routes/erp/people/-components/HrStates';
import { useBankExport } from '@/routes/erp/payroll/-hooks/use-bank-export';

/**
 * The one-liners matter more than the labels: picking the wrong template here
 * produces a file the bank silently rejects at 4pm on payday.
 */
const buildFormats = (
    t: TFunction
): Array<{ value: BankExportFormat; label: string; note: string }> => [
    {
        value: 'CSV',
        label: t('formats.csv.label'),
        note: t('formats.csv.note'),
    },
    {
        value: 'XLSX',
        label: t('formats.xlsx.label'),
        note: t('formats.xlsx.note'),
    },
    {
        value: 'HDFC',
        label: t('formats.hdfc.label'),
        note: t('formats.hdfc.note'),
    },
    {
        value: 'ICICI',
        label: t('formats.icici.label'),
        note: t('formats.icici.note'),
    },
    {
        value: 'SBI',
        label: t('formats.sbi.label'),
        note: t('formats.sbi.note'),
    },
];

interface BankFileTabProps {
    runId: string;
    run: PayrollRunDTO | undefined;
    isHrAdmin: boolean;
}

/**
 * The payment file the institute uploads to its bank.
 *
 * Structured around the fact that the file is never the whole story: employees
 * with missing or unusable bank details are silently left OUT of it, and if
 * nobody notices, those people simply don't get paid. So the excluded list is
 * given more weight on this screen than the download button — the file can be
 * fetched again any time, but an unnoticed exclusion is a missed salary.
 */
export const BankFileTab = ({ runId, run, isHrAdmin }: BankFileTabProps) => {
    const { t } = useTranslation('erpBankFileTab');
    const {
        history,
        isHistoryLoading,
        isHistoryError,
        refetchHistory,
        result,
        canGenerate,
        blockedReason,
        generate,
        download,
    } = useBankExport({ runId, run });

    const [format, setFormat] = useState<BankExportFormat>('CSV');
    const formats = useMemo(() => buildFormats(t), [t]);

    const runGenerate = async () => {
        const generated = await generate(format);
        if (generated === null) return; // reported + toasted by the hook
        const records = generated.export.total_records ?? 0;
        toast.success(
            generated.skipped_count > 0
                ? t('toast.readyWithExcluded', { records, excluded: generated.skipped_count })
                : t('toast.ready', { count: records })
        );
    };

    const runDownload = async (bankExport: BankExportDTO) => {
        await download(bankExport);
    };

    const skippedColumns = useMemo<ColumnDef<BankExportSkippedEntry>[]>(
        () => [
            {
                id: 'employee_code',
                header: t('columns.employee'),
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="text-body font-semibold text-neutral-700">
                            {row.original.employee_code ?? '—'}
                        </span>
                        {row.original.employee_name && (
                            <span className="truncate text-caption text-neutral-500">
                                {row.original.employee_name}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'reason',
                header: t('columns.whyExcluded'),
                cell: ({ row }) => (
                    <span className="text-body text-danger-600">{row.original.reason ?? '—'}</span>
                ),
            },
        ],
        [t]
    );

    const historyColumns = useMemo<ColumnDef<BankExportDTO>[]>(() => {
        const base: ColumnDef<BankExportDTO>[] = [
            {
                id: 'file_name',
                header: t('columns.file'),
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="truncate text-body text-neutral-700">
                            {row.original.file_name ?? '—'}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {(row.original.format ?? '').toUpperCase()}
                        </span>
                    </div>
                ),
            },
            {
                id: 'total_records',
                header: t('columns.records'),
                cell: ({ row }) => (
                    <span className="block text-end text-body tabular-nums text-neutral-600">
                        {row.original.total_records ?? '—'}
                    </span>
                ),
            },
            {
                id: 'total_amount',
                header: t('columns.total'),
                cell: ({ row }) => (
                    <MoneyCell
                        value={row.original.total_amount}
                        currency={row.original.currency}
                        className="text-body font-semibold text-neutral-700"
                    />
                ),
            },
            {
                id: 'generated_at',
                header: t('columns.generated'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-600">
                        {row.original.generated_at ? formatDateTime(row.original.generated_at) : '—'}
                    </span>
                ),
            },
        ];

        if (!isHrAdmin) return base;

        return [
            ...base,
            {
                id: 'actions',
                header: '',
                cell: ({ row }) => (
                    <div className="flex justify-end">
                        <MyButton
                            buttonType="text"
                            scale="small"
                            onAsyncClick={() => runDownload(row.original)}
                            loadingText={t('preparing')}
                        >
                            <DownloadSimple size={14} />
                            {t('download')}
                        </MyButton>
                    </div>
                ),
            },
        ];
        // `runDownload` closes over `download`, which the hook keeps referentially stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isHrAdmin, t]);

    // ── The run isn't approved, so the backend has nothing it will pay out ──
    if (blockedReason) {
        return (
            <HrEmptyState
                icon={<Prohibit size={32} className="text-neutral-300" />}
                title={t('noBankFileYet')}
                description={blockedReason}
            />
        );
    }

    const historyData: TableData<BankExportDTO> = {
        content: history,
        total_pages: 1,
        page_no: 0,
        page_size: history.length,
        total_elements: history.length,
        last: true,
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3">
                <Info size={18} className="mt-1 shrink-0 text-neutral-400" />
                <p className="text-caption text-muted-foreground">{t('bankFileInfo')}</p>
            </div>

            {isHrAdmin ? (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-title text-neutral-700">{t('chooseFormat')}</h3>
                        <p className="text-caption text-neutral-500">{t('chooseFormatHint')}</p>
                    </div>

                    <RadioGroup
                        value={format}
                        onValueChange={(value) => setFormat(value as BankExportFormat)}
                        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    >
                        {formats.map((option) => (
                            <label
                                key={option.value}
                                htmlFor={`bank-format-${option.value}`}
                                className={cn(
                                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                                    format === option.value
                                        ? 'border-primary-500 bg-primary-50'
                                        : 'border-border bg-card hover:border-primary-200'
                                )}
                            >
                                <RadioGroupItem
                                    value={option.value}
                                    id={`bank-format-${option.value}`}
                                    className="mt-1"
                                />
                                <span className="flex flex-col gap-1">
                                    <span className="text-body font-semibold text-neutral-700">
                                        {option.label}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {option.note}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </RadioGroup>

                    <div className="flex flex-wrap items-center gap-3">
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={!canGenerate}
                            onAsyncClick={runGenerate}
                            loadingText={t('generating')}
                        >
                            <Bank size={16} />
                            {t('generateBankFile')}
                        </MyButton>
                        <p className="text-caption text-neutral-500">{t('heldEmployeesNote')}</p>
                    </div>
                </div>
            ) : (
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3">
                    <Info size={18} className="mt-1 shrink-0 text-neutral-400" />
                    <p className="text-caption text-muted-foreground">{t('adminOnlyNote')}</p>
                </div>
            )}

            {/* ── What the last generate produced ── */}
            {result && (
                <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-col gap-1">
                            <h3 className="text-title text-neutral-700">
                                {result.export.file_name ?? t('bankFileFallback')}
                            </h3>
                            <p className="text-caption text-neutral-500">
                                {(result.export.format ?? format).toUpperCase()} ·{' '}
                                {result.export.generated_at
                                    ? formatDateTime(result.export.generated_at)
                                    : t('justNow')}
                            </p>
                        </div>
                        {isHrAdmin && result.export.id && (
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                onAsyncClick={() => runDownload(result.export)}
                                loadingText={t('preparing')}
                            >
                                <DownloadSimple size={14} />
                                {t('downloadFile')}
                            </MyButton>
                        )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="flex flex-col gap-1 rounded-md border border-border p-3">
                            <span className="text-caption text-neutral-500">
                                {t('employeesPaid')}
                            </span>
                            <span className="text-title font-semibold tabular-nums text-neutral-700">
                                {result.export.total_records ?? 0}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1 rounded-md border border-border p-3">
                            <span className="text-caption text-neutral-500">
                                {t('totalAmount')}
                            </span>
                            <MoneyCell
                                value={result.export.total_amount}
                                currency={result.export.currency}
                                showCurrency
                                className="text-title font-semibold text-neutral-700"
                            />
                        </div>
                        <div className="flex flex-col gap-1 rounded-md border border-border p-3">
                            <span className="text-caption text-neutral-500">{t('excluded')}</span>
                            <span
                                className={cn(
                                    'text-title font-semibold tabular-nums',
                                    result.skipped_count > 0
                                        ? 'text-danger-600'
                                        : 'text-success-600'
                                )}
                            >
                                {result.skipped_count}
                            </span>
                        </div>
                    </div>

                    {result.warnings.length > 0 && (
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                            <Warning size={18} weight="fill" className="mt-1 shrink-0 text-warning-600" />
                            <ul className="flex list-inside list-disc flex-col gap-1 text-caption text-warning-600">
                                {result.warnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result.skipped.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-start gap-2">
                                <UserMinus size={18} className="mt-1 shrink-0 text-danger-600" />
                                <div className="flex flex-col gap-1">
                                    <p className="text-body font-semibold text-danger-600">
                                        {t('excludedCount', { count: result.skipped.length })}
                                    </p>
                                    <p className="text-caption text-neutral-500">
                                        {t('excludedHint')}
                                    </p>
                                </div>
                            </div>
                            <MyTable<BankExportSkippedEntry>
                                data={{
                                    content: result.skipped,
                                    total_pages: 1,
                                    page_no: 0,
                                    page_size: result.skipped.length,
                                    total_elements: result.skipped.length,
                                    last: true,
                                }}
                                columns={skippedColumns}
                                isLoading={false}
                                error={null}
                                currentPage={0}
                                scrollable
                            />
                        </div>
                    ) : (
                        <p className="text-body text-success-600">{t('noneExcluded')}</p>
                    )}
                </div>
            )}

            {/* ── Files produced earlier ── */}
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <h3 className="text-title text-neutral-700">{t('filesGeneratedTitle')}</h3>
                    <p className="text-caption text-neutral-500">
                        {t('filesGeneratedHint', {
                            scope: run?.month && run?.year ? t('scopeMonth') : t('scopeRun'),
                        })}
                    </p>
                </div>

                {isHistoryError ? (
                    <HrErrorState
                        message={t('errors.loadHistory')}
                        onRetry={() => void refetchHistory()}
                    />
                ) : !isHistoryLoading && history.length === 0 ? (
                    <HrEmptyState
                        icon={<Bank size={32} className="text-neutral-300" />}
                        title={t('noBankFileGenerated')}
                        description={t('noBankFileGeneratedDescription')}
                    />
                ) : (
                    <MyTable<BankExportDTO>
                        data={historyData}
                        columns={historyColumns}
                        isLoading={isHistoryLoading}
                        error={null}
                        currentPage={0}
                        scrollable
                    />
                )}
            </div>
        </div>
    );
};
