import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
    ArrowClockwise,
    DownloadSimple,
    EnvelopeSimple,
    FileText,
    Info,
    Prohibit,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { formatMonthValue } from '@/components/design-system/month-picker';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { MyTable, type TableData } from '@/components/design-system/table';
import { formatDateTime } from '@/lib/formatters';
import type {
    PayrollEntryDTO,
    PayrollRunDTO,
    PayslipEmailOutcome,
    PayslipEmailResult,
} from '@/routes/erp/-shared/hr-types';
import { HrEmptyState, HrErrorState } from '@/routes/erp/people/-components/HrStates';
import { usePayslips, type PayslipRow } from '@/routes/erp/payroll/-hooks/use-payslips';

const buildEmailStatusLabels = (t: TFunction): Record<string, string> => ({
    SENT: t('emailStatusSent'),
    FAILED: t('emailStatusFailed'),
    NOT_SENT: t('emailStatusNotSent'),
    PENDING: t('emailStatusPending'),
});

/** Not-sent is a neutral fact, not a warning — nothing is wrong until a send fails. */
const emailStatusChipType = (status: string | undefined): StatusType => {
    switch ((status ?? '').toUpperCase()) {
        case 'SENT':
            return 'SUCCESS';
        case 'FAILED':
            return 'DANGER';
        default:
            return 'INFO';
    }
};

interface PayslipsTabProps {
    runId: string;
    run: PayrollRunDTO | undefined;
    entries: PayrollEntryDTO[];
    isEntriesLoading: boolean;
    isHrAdmin: boolean;
}

/**
 * The PDFs this run produced, and whether each one reached its employee.
 *
 * Two distinct facts share the tab because they are read as one question —
 * "is everybody paid AND told?" — and separating them would hide the second
 * behind a click nobody makes. Emailing reports per-employee outcomes in a
 * dialog rather than a toast: a count of failures is not actionable, the list of
 * who failed and why is.
 */
export const PayslipsTab = ({
    runId,
    run,
    entries,
    isEntriesLoading,
    isHrAdmin,
}: PayslipsTabProps) => {
    const { t } = useTranslation('erpPayslipsTab');
    const {
        payslips,
        isLoading,
        isError,
        refetch,
        canGenerate,
        blockedReason,
        generate,
        emailAll,
        download,
    } = usePayslips({ runId, run, entries, isEntriesLoading });

    const [confirmEmail, setConfirmEmail] = useState(false);
    const [emailResult, setEmailResult] = useState<PayslipEmailResult | null>(null);

    const emailStatusLabels = useMemo(() => buildEmailStatusLabels(t), [t]);

    const period =
        run?.month && run?.year ? formatMonthValue({ month: run.month, year: run.year }) : '—';

    const runGenerate = async () => {
        const message = await generate();
        if (message === null) return; // reported + toasted by the hook
        toast.success(message);
    };

    const runEmail = async () => {
        const result = await emailAll();
        if (result === null) return;
        setConfirmEmail(false);
        setEmailResult(result);
        toast.success(t('emailToastSummary', { sent: result.sent, total: result.total, count: result.total }));
    };

    const columns = useMemo<ColumnDef<PayslipRow>[]>(
        () => [
            {
                id: 'employee',
                header: t('columnEmployee'),
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
                id: 'period',
                header: t('columnPeriod'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-600">
                        {row.original.month && row.original.year
                            ? formatMonthValue({
                                  month: row.original.month,
                                  year: row.original.year,
                              })
                            : '—'}
                    </span>
                ),
            },
            {
                id: 'email_status',
                header: t('columnEmail'),
                cell: ({ row }) => {
                    const status = (row.original.email_status ?? '').toUpperCase();
                    return (
                        <div className="flex flex-col gap-1">
                            <StatusChip
                                text={
                                    emailStatusLabels[status] ?? row.original.email_status ?? '—'
                                }
                                textSize="text-caption"
                                status={emailStatusChipType(status)}
                                showIcon={false}
                            />
                            {row.original.emailed_at && (
                                <span className="text-caption text-neutral-400">
                                    {formatDateTime(row.original.emailed_at)}
                                </span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'generated_at',
                header: t('columnGenerated'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-600">
                        {row.original.generated_at ? formatDateTime(row.original.generated_at) : '—'}
                    </span>
                ),
            },
            {
                id: 'actions',
                header: '',
                cell: ({ row }) =>
                    row.original.id ? (
                        <div className="flex justify-end">
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onAsyncClick={async () => {
                                    await download(row.original);
                                }}
                                loadingText={t('preparingLoading')}
                            >
                                <DownloadSimple size={14} />
                                {t('downloadButton')}
                            </MyButton>
                        </div>
                    ) : null,
            },
        ],
        [download, t, emailStatusLabels]
    );

    // ── The run isn't far enough along for the backend to render anything ──
    if (blockedReason) {
        return (
            <HrEmptyState
                icon={<Prohibit size={32} className="text-neutral-300" />}
                title={t('blockedTitle')}
                description={blockedReason}
            />
        );
    }

    if (isError) {
        return (
            <HrErrorState message={t('loadError')} onRetry={() => void refetch()} />
        );
    }

    // ── Nothing generated yet ──
    if (!isLoading && payslips.length === 0) {
        return (
            <HrEmptyState
                icon={<FileText size={32} className="text-neutral-300" />}
                title={t('emptyTitle')}
                description={<>{t('emptyDescription', { period })}</>}
            >
                {canGenerate && isHrAdmin ? (
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={runGenerate}
                        loadingText={t('generatingLoading')}
                    >
                        <FileText size={16} />
                        {t('generateButton')}
                    </MyButton>
                ) : (
                    <p className="text-caption text-neutral-500">{t('generateAdminOnly')}</p>
                )}
            </HrEmptyState>
        );
    }

    const tableData: TableData<PayslipRow> = {
        content: payslips,
        total_pages: 1,
        page_no: 0,
        page_size: payslips.length,
        total_elements: payslips.length,
        last: true,
    };

    const notSent = payslips.filter(
        (payslip) => (payslip.email_status ?? '').toUpperCase() !== 'SENT'
    ).length;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-2xl text-caption text-neutral-500">
                    {t('summaryPayslipsCount', { count: payslips.length, period })}
                    {notSent > 0
                        ? ` ${t('notSentLine', { count: notSent })}`
                        : ` ${t('allEmailedLine')}`}{' '}
                    {t('regenerateSafeLine')}
                </p>

                {isHrAdmin && (
                    <div className="flex flex-wrap items-center gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onAsyncClick={runGenerate}
                            loadingText={t('regeneratingLoading')}
                        >
                            <ArrowClockwise size={14} />
                            {t('regenerateButton')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            onClick={() => setConfirmEmail(true)}
                        >
                            <EnvelopeSimple size={14} />
                            {t('emailAllButton')}
                        </MyButton>
                    </div>
                )}
            </div>

            {!isHrAdmin && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3">
                    <Info size={18} className="mt-1 shrink-0 text-neutral-400" />
                    <p className="text-caption text-muted-foreground">{t('nonAdminInfo')}</p>
                </div>
            )}

            <MyTable<PayslipRow>
                data={tableData}
                columns={columns}
                isLoading={isLoading}
                error={null}
                currentPage={0}
                scrollable
            />

            {/* ── Confirm the fan-out ── */}
            <MyDialog
                heading={t('emailDialogHeading', { period })}
                open={confirmEmail}
                onOpenChange={(open) => !open && setConfirmEmail(false)}
                dialogWidth="max-w-lg"
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setConfirmEmail(false)}
                        >
                            {t('notYetButton')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={runEmail}
                            loadingText={t('sendingLoading')}
                        >
                            {t('sendEmailsButton', { count: payslips.length })}
                        </MyButton>
                    </>
                }
            >
                <div className="flex flex-col gap-3 text-body text-neutral-600">
                    <p>{t('dialogBody1', { count: payslips.length })}</p>
                    <p>{t('dialogBody2')}</p>
                    <p className="text-caption text-neutral-500">{t('dialogBody3')}</p>
                </div>
            </MyDialog>

            <EmailResultDialog result={emailResult} onClose={() => setEmailResult(null)} />
        </div>
    );
};

/**
 * Who got their payslip and who didn't.
 *
 * The failures carry the reason the send was refused (no email on file, bounced
 * address), which is the only part anyone acts on — so they are listed in full
 * rather than summarised into a count.
 */
const EmailResultDialog = ({
    result,
    onClose,
}: {
    result: PayslipEmailResult | null;
    onClose: () => void;
}) => {
    const { t } = useTranslation('erpPayslipsTab');
    const emailStatusLabels = useMemo(() => buildEmailStatusLabels(t), [t]);

    const columns = useMemo<ColumnDef<PayslipEmailOutcome>[]>(
        () => [
            {
                id: 'employee_code',
                header: t('resultColumnEmployee'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-700">
                        {row.original.employee_code ?? '—'}
                    </span>
                ),
            },
            {
                id: 'status',
                header: t('resultColumnResult'),
                cell: ({ row }) => {
                    const status = (row.original.status ?? '').toUpperCase();
                    return (
                        <StatusChip
                            text={emailStatusLabels[status] ?? row.original.status ?? '—'}
                            textSize="text-caption"
                            status={emailStatusChipType(status)}
                            showIcon={false}
                        />
                    );
                },
            },
            {
                id: 'reason',
                header: t('resultColumnReason'),
                cell: ({ row }) => (
                    <span className="text-body text-danger-600">{row.original.reason ?? ''}</span>
                ),
            },
        ],
        [t, emailStatusLabels]
    );

    if (!result) return null;

    const failures = result.outcomes.filter(
        (outcome) => (outcome.status ?? '').toUpperCase() === 'FAILED'
    );
    // Failures first: this dialog exists for them.
    const ordered = [
        ...failures,
        ...result.outcomes.filter((outcome) => (outcome.status ?? '').toUpperCase() !== 'FAILED'),
    ];

    const tableData: TableData<PayslipEmailOutcome> = {
        content: ordered,
        total_pages: 1,
        page_no: 0,
        page_size: ordered.length,
        total_elements: ordered.length,
        last: true,
    };

    return (
        <MyDialog
            heading={t('resultHeading')}
            open
            onOpenChange={(open) => !open && onClose()}
            dialogWidth="max-w-3xl"
            footer={
                <MyButton buttonType="primary" scale="medium" onClick={onClose}>
                    {t('doneButton')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-3">
                    <SummaryTile label={t('tileAttempted')} value={result.total} />
                    <SummaryTile label={t('tileSent')} value={result.sent} tone="success" />
                    <SummaryTile label={t('tileFailed')} value={result.failed} tone="danger" />
                </div>

                {result.failed > 0 ? (
                    <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                        <Info size={18} className="mt-1 shrink-0 text-warning-600" />
                        <p className="text-caption text-warning-600">
                            {t('failedWarning', { count: result.failed })}
                        </p>
                    </div>
                ) : (
                    <p className="text-body text-success-600">{t('allReachedMessage')}</p>
                )}

                {ordered.length > 0 && (
                    <MyTable<PayslipEmailOutcome>
                        data={tableData}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={0}
                        scrollable
                    />
                )}
            </div>
        </MyDialog>
    );
};

const SummaryTile = ({
    label,
    value,
    tone = 'default',
}: {
    label: string;
    value: number;
    tone?: 'default' | 'success' | 'danger';
}) => (
    <div className="flex min-w-24 flex-col gap-1 rounded-md border border-border bg-card p-3">
        <span className="text-caption text-neutral-500">{label}</span>
        <span
            className={
                tone === 'success'
                    ? 'text-title font-semibold text-success-600'
                    : tone === 'danger'
                      ? 'text-title font-semibold text-danger-600'
                      : 'text-title font-semibold text-neutral-700'
            }
        >
            {value}
        </span>
    </div>
);
