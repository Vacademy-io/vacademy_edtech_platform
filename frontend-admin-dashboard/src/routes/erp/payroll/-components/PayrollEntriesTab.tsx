import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CaretDown, CaretRight, PauseCircle, PlayCircle, Users } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { StatusChip } from '@/components/design-system/status-chips';
import { MyTable, type TableData } from '@/components/design-system/table';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { PayrollEntryDTO } from '@/routes/erp/-shared/hr-types';
import { entryStatusChipType } from '@/routes/erp/-shared/payroll-status';
import { HrEmptyState, HrErrorState } from '@/routes/erp/people/-components/HrStates';
import { EntryBreakdown } from './EntryBreakdown';
import { HoldEntryDialog } from './HoldEntryDialog';

const buildEntryStatusLabels = (t: TFunction): Record<string, string> => ({
    CALCULATED: t('status.calculated'),
    HELD: t('status.held'),
    PAID: t('status.paid'),
});

/** Days arrive as BigDecimal (half-days exist), so 21.5 must survive and 21 must not read "21.00". */
const formatDays = (value: number | string | null | undefined) => {
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (numeric === null || numeric === undefined || !Number.isFinite(numeric)) return '—';
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
};

interface PayrollEntriesTabProps {
    entries: PayrollEntryDTO[];
    isLoading: boolean;
    isError: boolean;
    onRetry: () => void;
    /** From runTransitions(run.status) — entries are only mutable while the run is. */
    canEditEntries: boolean;
    isHrAdmin: boolean;
    onHold: (entryId: string, reason: string) => Promise<string | null>;
    onRelease: (entryId: string) => Promise<string | null>;
}

/**
 * The payroll register: one row per employee, expandable into their payslip.
 *
 * Unpaginated on purpose. A register is read as a whole — you scan for the outlier,
 * the held row, the net pay that looks wrong — and page breaks defeat that. It is
 * bounded by headcount, and `MyTable` already scrolls inside its own container.
 */
export const PayrollEntriesTab = ({
    entries,
    isLoading,
    isError,
    onRetry,
    canEditEntries,
    isHrAdmin,
    onHold,
    onRelease,
}: PayrollEntriesTabProps) => {
    const { t } = useTranslation('erpPayrollEntriesTab');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [holdTarget, setHoldTarget] = useState<PayrollEntryDTO | null>(null);

    const showRowActions = canEditEntries && isHrAdmin;

    const rows = useMemo(
        () =>
            [...entries].sort((a, b) =>
                (a.employee_code ?? '').localeCompare(b.employee_code ?? '', undefined, {
                    numeric: true,
                })
            ),
        [entries]
    );

    const release = async (entry: PayrollEntryDTO) => {
        if (!entry.id) return;
        const message = await onRelease(entry.id);
        if (message === null) return;
        toast.success(message);
    };

    const columns = useMemo<ColumnDef<PayrollEntryDTO>[]>(() => {
        const entryStatusLabels = buildEntryStatusLabels(t);
        /** A held entry is muted everywhere so the eye skips it while scanning totals. */
        const muted = (entry: PayrollEntryDTO) =>
            (entry.status ?? '').toUpperCase() === 'HELD' ? 'text-neutral-400' : '';

        const base: ColumnDef<PayrollEntryDTO>[] = [
            {
                id: 'expand',
                header: '',
                size: 48,
                cell: ({ row }) => {
                    const isOpen = !!row.original.id && expandedId === row.original.id;
                    return (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            layoutVariant="icon"
                            aria-label={isOpen ? t('table.hideBreakdown') : t('table.showBreakdown')}
                            aria-expanded={isOpen}
                            onClick={() => setExpandedId(isOpen ? null : row.original.id ?? null)}
                        >
                            {isOpen ? <CaretDown size={16} /> : <CaretRight size={16} />}
                        </MyButton>
                    );
                },
            },
            {
                id: 'employee_code',
                header: t('table.columns.employee'),
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span
                            className={cn(
                                'text-body font-semibold text-neutral-700',
                                muted(row.original)
                            )}
                        >
                            {row.original.employee_code ?? '—'}
                        </span>
                        {row.original.hold_reason && (
                            <span className="flex items-center gap-1 text-caption text-warning-600">
                                <PauseCircle size={12} weight="fill" />
                                <span className="truncate">{row.original.hold_reason}</span>
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'total_working_days',
                header: t('table.columns.working'),
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'block text-end text-body tabular-nums text-neutral-600',
                            muted(row.original)
                        )}
                    >
                        {formatDays(row.original.total_working_days)}
                    </span>
                ),
            },
            {
                id: 'days_present',
                header: t('table.columns.present'),
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'block text-end text-body tabular-nums text-neutral-600',
                            muted(row.original)
                        )}
                    >
                        {formatDays(row.original.days_present)}
                    </span>
                ),
            },
            {
                id: 'days_absent',
                header: t('table.columns.absent'),
                cell: ({ row }) => {
                    const numeric = Number(row.original.days_absent ?? 0);
                    return (
                        <span
                            className={cn(
                                'block text-end text-body tabular-nums',
                                numeric > 0 ? 'text-danger-600' : 'text-neutral-600',
                                muted(row.original)
                            )}
                        >
                            {formatDays(row.original.days_absent)}
                        </span>
                    );
                },
            },
            {
                id: 'days_on_leave',
                header: t('table.columns.leave'),
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'block text-end text-body tabular-nums text-neutral-600',
                            muted(row.original)
                        )}
                    >
                        {formatDays(row.original.days_on_leave)}
                    </span>
                ),
            },
            {
                id: 'gross_salary',
                header: t('table.columns.gross'),
                cell: ({ row }) => (
                    <MoneyCell
                        value={row.original.gross_salary}
                        currency={row.original.currency}
                        className={cn('text-body', muted(row.original))}
                    />
                ),
            },
            {
                id: 'total_deductions',
                header: t('table.columns.deductions'),
                cell: ({ row }) => (
                    <MoneyCell
                        value={row.original.total_deductions}
                        currency={row.original.currency}
                        dashOnZero
                        tone="deduction"
                        className={cn('text-body', muted(row.original))}
                    />
                ),
            },
            {
                id: 'net_pay',
                header: t('table.columns.netPay'),
                cell: ({ row }) => (
                    <MoneyCell
                        value={row.original.net_pay}
                        currency={row.original.currency}
                        className={cn(
                            'text-body font-semibold text-neutral-700',
                            muted(row.original)
                        )}
                    />
                ),
            },
            {
                id: 'status',
                header: t('table.columns.status'),
                cell: ({ row }) => {
                    const status = (row.original.status ?? '').toUpperCase();
                    return (
                        <StatusChip
                            text={entryStatusLabels[status] ?? row.original.status ?? '—'}
                            textSize="text-caption"
                            status={entryStatusChipType(status)}
                            showIcon={false}
                        />
                    );
                },
            },
        ];

        if (!showRowActions) return base;

        return [
            ...base,
            {
                id: 'actions',
                header: '',
                cell: ({ row }) => {
                    const isHeld = (row.original.status ?? '').toUpperCase() === 'HELD';
                    // A paid entry is settled — there is nothing left to hold or release.
                    if ((row.original.status ?? '').toUpperCase() === 'PAID') return null;
                    return (
                        <div className="flex justify-end">
                            {isHeld ? (
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    onAsyncClick={() => release(row.original)}
                                    loadingText={t('actions.releasing')}
                                >
                                    <PlayCircle size={14} />
                                    {t('actions.release')}
                                </MyButton>
                            ) : (
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    onClick={() => setHoldTarget(row.original)}
                                >
                                    <PauseCircle size={14} />
                                    {t('actions.hold')}
                                </MyButton>
                            )}
                        </div>
                    );
                },
            },
        ];
        // `release` closes over onRelease, which the hook keeps referentially stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expandedId, showRowActions, t]);

    if (isError) {
        return (
            <HrErrorState
                message={t('errors.loadFailed')}
                onRetry={onRetry}
            />
        );
    }

    if (!isLoading && rows.length === 0) {
        return (
            <HrEmptyState
                icon={<Users size={32} className="text-neutral-300" />}
                title={t('empty.title')}
                description={t('empty.description')}
            />
        );
    }

    const tableData: TableData<PayrollEntryDTO> = {
        content: rows,
        total_pages: 1,
        page_no: 0,
        page_size: rows.length,
        total_elements: rows.length,
        last: true,
    };

    return (
        <div className="flex flex-col gap-3">
            <p className="text-caption text-neutral-500">
                {t('description.base')}
                {showRowActions ? t('description.holdHint') : ''}
            </p>

            <MyTable<PayrollEntryDTO>
                data={tableData}
                columns={columns}
                isLoading={isLoading}
                error={null}
                currentPage={0}
                scrollable
                renderExpandedRow={(entry) =>
                    entry.id && entry.id === expandedId ? <EntryBreakdown entry={entry} /> : null
                }
            />

            <HoldEntryDialog
                entry={holdTarget}
                onClose={() => setHoldTarget(null)}
                onHold={onHold}
            />
        </div>
    );
};
