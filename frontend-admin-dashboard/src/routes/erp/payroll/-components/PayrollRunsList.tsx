import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Plus, Receipt } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MoneyCell } from '@/components/design-system/money-cell';
import { formatMonthValue } from '@/components/design-system/month-picker';
import { StatusChip } from '@/components/design-system/status-chips';
import { MyTable, type TableData } from '@/components/design-system/table';
import { useHrRole } from '@/hooks/use-hr-role';
import type { PayrollRunDTO } from '@/routes/erp/-shared/hr-types';
import {
    buildRunStatusLabels,
    buildRunTypeLabels,
    runStatusChipType,
    type PayrollRunStatus,
    type PayrollRunType,
} from '@/routes/erp/-shared/payroll-status';
import {
    HrEmptyState,
    HrErrorState,
    HrNoAccessCard,
} from '@/routes/erp/people/-components/HrStates';
import { usePayrollRuns } from '@/routes/erp/payroll/-hooks/use-payroll-runs';
import { NewPayrollRunDialog } from './NewPayrollRunDialog';

/** Payroll history worth filtering by — five years covers every audit anyone asks for. */
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, index) =>
    String(new Date().getFullYear() - index)
);

/** "27 Aug 2026, 4:12 pm" — the run's audit timestamps, or a dash. */
const formatStamp = (value: string | undefined) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const StampCell = ({ label, value }: { label: string; value: string | undefined }) => {
    const stamp = formatStamp(value);
    if (!stamp) return <span className="text-caption text-neutral-400">—</span>;
    return (
        <span className="flex flex-col">
            <span className="text-caption text-neutral-400">{label}</span>
            <span className="text-caption text-neutral-600">{stamp}</span>
        </span>
    );
};

/**
 * Every payroll run for a year, newest period first.
 *
 * The endpoint returns a plain list rather than a page, so the MyTable envelope is
 * built here and pagination is deliberately absent: a year holds at most a dozen or
 * two runs, and splitting that across pages would hide the run you came for.
 */
export const PayrollRunsList = () => {
    const { t } = useTranslation(['erpPayrollRunsList', 'erpPayrollStatus']);
    const navigate = useNavigate();
    const { isHrAdmin, isHrStaff } = useHrRole();
    const [year, setYear] = useState(() => new Date().getFullYear());
    const [dialogOpen, setDialogOpen] = useState(false);

    const { runs, isLoading, isError, refetch, create } = usePayrollRuns(year);

    const rows = useMemo(
        () =>
            [...runs].sort(
                (a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.month ?? 0) - (a.month ?? 0)
            ),
        [runs]
    );

    const openRun = (runId: string | undefined) => {
        if (!runId) return;
        void navigate({ to: '/erp/payroll/$runId', params: { runId } });
    };

    const columns = useMemo<ColumnDef<PayrollRunDTO>[]>(() => {
        const runTypeLabels = buildRunTypeLabels(t);
        const runStatusLabels = buildRunStatusLabels(t);
        return [
            {
                id: 'period',
                header: t('table.columns.period'),
                cell: ({ row }) => (
                    <span className="text-body font-semibold text-neutral-700">
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
                id: 'run_type',
                header: t('table.columns.type'),
                cell: ({ row }) => (
                    <StatusChip
                        text={
                            runTypeLabels[
                                (row.original.run_type ?? 'REGULAR').toUpperCase() as PayrollRunType
                            ] ??
                            row.original.run_type ??
                            t('table.defaultRunType')
                        }
                        textSize="text-caption"
                        status="INFO"
                        showIcon={false}
                    />
                ),
            },
            {
                id: 'status',
                header: t('table.columns.status'),
                cell: ({ row }) => (
                    <StatusChip
                        text={
                            runStatusLabels[
                                (row.original.status ?? '').toUpperCase() as PayrollRunStatus
                            ] ??
                            row.original.status ??
                            '—'
                        }
                        textSize="text-caption"
                        status={runStatusChipType(row.original.status)}
                        showIcon={false}
                    />
                ),
            },
            {
                id: 'total_employees',
                header: t('table.columns.employees'),
                cell: ({ row }) => (
                    <span className="block text-end text-body tabular-nums text-neutral-600">
                        {row.original.total_employees ?? 0}
                    </span>
                ),
            },
            {
                id: 'total_net_pay',
                header: t('table.columns.totalNetPay'),
                cell: ({ row }) => (
                    <MoneyCell
                        value={row.original.total_net_pay}
                        currency={row.original.currency}
                        className="text-body font-semibold text-neutral-700"
                    />
                ),
            },
            {
                id: 'processed_at',
                header: t('table.columns.processed'),
                cell: ({ row }) => (
                    <StampCell label={t('table.processedByLabel')} value={row.original.processed_at} />
                ),
            },
            {
                id: 'approved_at',
                header: t('table.columns.approved'),
                cell: ({ row }) => (
                    <StampCell label={t('table.approvedByLabel')} value={row.original.approved_at} />
                ),
            },
            {
                id: 'actions',
                header: '',
                cell: ({ row }) => (
                    <div className="flex justify-end">
                        <MyButton
                            buttonType="text"
                            scale="small"
                            onClick={() => openRun(row.original.id)}
                        >
                            {t('actions.open')}
                            <ArrowRight size={14} />
                        </MyButton>
                    </div>
                ),
            },
        ];
        // openRun closes over `navigate`, which is stable for the life of the route.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t]);

    if (!isHrStaff) return <HrNoAccessCard />;

    const tableData: TableData<PayrollRunDTO> = {
        content: rows,
        total_pages: 1,
        page_no: 0,
        page_size: rows.length,
        total_elements: rows.length,
        last: true,
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                    <p className="max-w-2xl text-body text-neutral-600">
                        {t('description')}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <MyDropdown
                        currentValue={String(year)}
                        dropdownList={YEAR_OPTIONS}
                        handleChange={(value) => setYear(Number(value))}
                        placeholder={t('yearPlaceholder')}
                        className="w-28"
                        contentClassName="min-w-28"
                    />
                    {isHrAdmin && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setDialogOpen(true)}
                        >
                            <Plus size={16} />
                            {t('actions.newPayrollRun')}
                        </MyButton>
                    )}
                </div>
            </div>

            {isError ? (
                <HrErrorState
                    message={t('errors.loadFailed')}
                    onRetry={() => void refetch()}
                />
            ) : !isLoading && rows.length === 0 ? (
                <HrEmptyState
                    icon={<Receipt size={32} className="text-neutral-300" />}
                    title={t('empty.title', { year })}
                    description={
                        isHrAdmin
                            ? t('empty.adminDescription')
                            : t('empty.staffDescription')
                    }
                >
                    {isHrAdmin && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setDialogOpen(true)}
                        >
                            <Plus size={16} />
                            {t('actions.newPayrollRun')}
                        </MyButton>
                    )}
                </HrEmptyState>
            ) : (
                <MyTable<PayrollRunDTO>
                    data={tableData}
                    columns={columns}
                    isLoading={isLoading}
                    error={null}
                    currentPage={0}
                    scrollable
                    onCellClick={(row, column) => {
                        // The Open button in the actions cell already navigates; letting the
                        // cell handler fire too would double-navigate.
                        if (column.id === 'actions') return;
                        openRun(row.id);
                    }}
                />
            )}

            <NewPayrollRunDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                onCreate={create}
                onCreated={openRun}
            />
        </div>
    );
};
