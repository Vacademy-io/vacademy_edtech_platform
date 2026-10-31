import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { CheckCircle, ClipboardText, XCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyTable } from '@/components/design-system/table';
import { StatusChip } from '@/components/design-system/status-chips';
import { formatDate } from '@/lib/formatters';
import { useHrRole } from '@/hooks/use-hr-role';
import { humanizeToken } from '@/routes/erp/people/-components/EmployeeFields';
import { SingleFilterChip } from '@/routes/erp/people/-components/SingleFilterChip';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
    HrNoAccessCard,
} from '@/routes/erp/people/-components/HrStates';
import type { RegularizationDTO } from '@/routes/erp/-shared/hr-types';
import { useRegularizations } from '../-hooks/use-attendance';
import {
    AttendanceStatusChip,
    REGULARIZATION_STATUSES,
    formatClockTime,
    regularizationTone,
    type RegularizationStatus,
} from './attendance-meta';
import {
    RegularizationActionDialog,
    type RegularizationDecision,
} from './RegularizationActionDialog';

/**
 * The queue of "my attendance is wrong" requests.
 *
 * Opens on PENDING because that is the only state with work in it — the approved
 * and rejected lists are history, and landing on "all" would bury three requests
 * that need a decision under three hundred that don't.
 */
export const RegularizationsMain = () => {
    const { t } = useTranslation('erpRegularizationsMain');
    const { isHrAdmin, isHrStaff } = useHrRole();
    const [status, setStatus] = useState<RegularizationStatus>('PENDING');
    const [pending, setPending] = useState<{
        request: RegularizationDTO;
        decision: RegularizationDecision;
    } | null>(null);

    const query = useRegularizations(status);
    const rows = useMemo(() => query.data ?? [], [query.data]);

    const columns = useMemo<ColumnDef<RegularizationDTO>[]>(() => {
        const base: ColumnDef<RegularizationDTO>[] = [
            {
                id: 'employee',
                header: t('columns.employee'),
                size: 200,
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="truncate text-body font-semibold text-foreground">
                            {row.original.employee_name || t('defaultEmployeeName')}
                        </span>
                        {row.original.employee_code && (
                            <span className="text-caption text-muted-foreground">
                                {row.original.employee_code}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'date',
                header: t('columns.date'),
                size: 120,
                cell: ({ row }) => (
                    <span className="text-body text-foreground">
                        {row.original.attendance_date
                            ? formatDate(row.original.attendance_date)
                            : '—'}
                    </span>
                ),
            },
            {
                id: 'change',
                header: t('columns.requestedChange'),
                size: 240,
                cell: ({ row }) => (
                    <div className="flex flex-wrap items-center gap-2">
                        <AttendanceStatusChip status={row.original.original_status} />
                        <span className="text-caption text-muted-foreground">→</span>
                        <AttendanceStatusChip status={row.original.requested_status} />
                    </div>
                ),
            },
            {
                id: 'times',
                header: t('columns.times'),
                size: 200,
                cell: ({ row }) => (
                    <div className="flex flex-col text-caption tabular-nums">
                        <span className="text-muted-foreground">
                            {t('timesWas', {
                                from: formatClockTime(row.original.original_check_in),
                                to: formatClockTime(row.original.original_check_out),
                            })}
                        </span>
                        <span className="text-foreground">
                            {t('timesAsks', {
                                from: formatClockTime(row.original.requested_check_in),
                                to: formatClockTime(row.original.requested_check_out),
                            })}
                        </span>
                    </div>
                ),
            },
            {
                id: 'reason',
                header: t('columns.reason'),
                size: 240,
                cell: ({ row }) => (
                    <span className="truncate text-body text-muted-foreground">
                        {row.original.reason || '—'}
                    </span>
                ),
            },
        ];

        if (status !== 'PENDING') {
            base.push({
                id: 'outcome',
                header: t('columns.outcome'),
                size: 180,
                cell: ({ row }) => (
                    <div className="flex flex-col gap-1">
                        <StatusChip
                            text={humanizeToken(row.original.approval_status) || t('defaultOutcome')}
                            textSize="text-caption"
                            status={regularizationTone(row.original.approval_status)}
                            showIcon={false}
                        />
                        {row.original.remarks && (
                            <span className="truncate text-caption text-muted-foreground">
                                {row.original.remarks}
                            </span>
                        )}
                    </div>
                ),
            });
        }

        if (isHrAdmin && status === 'PENDING') {
            base.push({
                id: 'actions',
                header: t('columns.decision'),
                size: 180,
                cell: ({ row }) => (
                    <div className="flex items-center gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() =>
                                setPending({ request: row.original, decision: 'APPROVED' })
                            }
                        >
                            <CheckCircle size={15} className="text-success-600" /> {t('approve')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={() =>
                                setPending({ request: row.original, decision: 'REJECTED' })
                            }
                        >
                            <XCircle size={15} className="text-danger-600" /> {t('reject')}
                        </MyButton>
                    </div>
                ),
            });
        }

        return base;
    }, [isHrAdmin, status, t]);

    if (!isHrStaff) return <HrNoAccessCard />;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
                <h2 className="text-h2-semibold text-foreground">{t('heading')}</h2>
                <p className="max-w-3xl text-body text-muted-foreground">
                    {t('description')}
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <SingleFilterChip
                    label={t('statusFilterLabel')}
                    options={REGULARIZATION_STATUSES.map((option) => ({
                        id: option,
                        label: humanizeToken(option),
                    }))}
                    value={status}
                    onChange={(next) => setStatus((next as RegularizationStatus) ?? 'PENDING')}
                />
                <span className="text-caption text-muted-foreground">
                    {t('requestsCount', {
                        count: rows.length,
                        status: humanizeToken(status).toLowerCase(),
                    })}
                </span>
            </div>

            {query.isLoading ? (
                <HrLoadingRows rows={4} />
            ) : query.isError ? (
                <HrErrorState
                    message={t('loadError')}
                    onRetry={() => void query.refetch()}
                />
            ) : rows.length === 0 ? (
                <HrEmptyState
                    icon={<ClipboardText size={36} className="text-muted-foreground" />}
                    title={
                        status === 'PENDING'
                            ? t('emptyPendingTitle')
                            : t('emptyOtherTitle', { status: humanizeToken(status).toLowerCase() })
                    }
                    description={
                        status === 'PENDING'
                            ? t('emptyPendingDescription')
                            : t('emptyOtherDescription')
                    }
                />
            ) : (
                <MyTable<RegularizationDTO>
                    data={{
                        content: rows,
                        total_pages: 1,
                        page_no: 0,
                        page_size: rows.length,
                        total_elements: rows.length,
                        last: true,
                    }}
                    columns={columns}
                    isLoading={false}
                    error={null}
                    currentPage={0}
                    scrollable
                />
            )}

            {!isHrAdmin && (
                <p className="text-caption text-muted-foreground">
                    {t('reviewOnlyNote')}
                </p>
            )}

            <RegularizationActionDialog
                open={!!pending}
                onOpenChange={(open) => !open && setPending(null)}
                request={pending?.request ?? null}
                decision={pending?.decision ?? 'APPROVED'}
            />
        </div>
    );
};
