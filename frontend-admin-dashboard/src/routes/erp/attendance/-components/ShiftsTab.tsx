import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Clock, PencilSimple, Plus, UsersThree } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyTable } from '@/components/design-system/table';
import { StatusChip } from '@/components/design-system/status-chips';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
} from '@/routes/erp/people/-components/HrStates';
import type { ShiftDTO } from '@/routes/erp/-shared/hr-types';
import { useShifts } from '../-hooks/use-attendance';
import { toNumber, formatClockTime } from './attendance-meta';
import { AssignShiftDialog } from './AssignShiftDialog';
import { ShiftDialog } from './ShiftDialog';

/**
 * The institute's shifts, and who is on them.
 *
 * A shift is what makes a check-in interpretable: without one, a stamp at 09:47
 * is neither late nor on time. The default shift covers everyone not explicitly
 * assigned, which is why it is called out in the table rather than buried.
 */
export const ShiftsTab = ({ isHrAdmin }: { isHrAdmin: boolean }) => {
    const { t } = useTranslation('erpShiftsTab');
    const query = useShifts();
    const [editing, setEditing] = useState<ShiftDTO | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [assignOpen, setAssignOpen] = useState(false);

    const rows = useMemo(() => query.data ?? [], [query.data]);

    const columns = useMemo<ColumnDef<ShiftDTO>[]>(() => {
        const base: ColumnDef<ShiftDTO>[] = [
            {
                id: 'name',
                header: t('columns.shift'),
                size: 220,
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="flex items-center gap-2 truncate text-body font-semibold text-foreground">
                            {row.original.name || row.original.code || t('defaultShiftName')}
                            {row.original.is_default && (
                                <StatusChip
                                    text={t('defaultChip')}
                                    textSize="text-caption"
                                    status="INFO"
                                    showIcon={false}
                                />
                            )}
                        </span>
                        {row.original.code && (
                            <span className="text-caption text-muted-foreground">
                                {row.original.code}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'timing',
                header: t('columns.timing'),
                size: 160,
                cell: ({ row }) => (
                    <span className="text-body tabular-nums text-foreground">
                        {formatClockTime(row.original.start_time)} –{' '}
                        {formatClockTime(row.original.end_time)}
                        {row.original.is_night_shift && (
                            <span className="ms-2 text-caption text-muted-foreground">
                                {t('nightTag')}
                            </span>
                        )}
                    </span>
                ),
            },
            {
                id: 'break',
                header: t('columns.break'),
                size: 100,
                cell: ({ row }) => (
                    <span className="block text-end text-body tabular-nums text-muted-foreground">
                        {row.original.break_duration_min
                            ? t('minutesValue', { count: row.original.break_duration_min })
                            : '—'}
                    </span>
                ),
            },
            {
                id: 'grace',
                header: t('columns.grace'),
                size: 100,
                cell: ({ row }) => (
                    <span className="block text-end text-body tabular-nums text-muted-foreground">
                        {row.original.grace_period_min
                            ? t('minutesValue', { count: row.original.grace_period_min })
                            : '—'}
                    </span>
                ),
            },
            {
                id: 'thresholds',
                header: t('columns.thresholds'),
                size: 140,
                cell: ({ row }) => (
                    <span className="block text-end text-body tabular-nums text-foreground">
                        {toNumber(row.original.min_hours_full_day) || '—'} /{' '}
                        {toNumber(row.original.min_hours_half_day) || '—'} h
                    </span>
                ),
            },
        ];

        if (isHrAdmin) {
            base.push({
                id: 'actions',
                header: '',
                size: 100,
                cell: ({ row }) => (
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            layoutVariant="icon"
                            aria-label={t('editAriaLabel', {
                                name: row.original.name ?? t('defaultShiftFallback'),
                            })}
                            onClick={() => {
                                setEditing(row.original);
                                setDialogOpen(true);
                            }}
                        >
                            <PencilSimple size={15} />
                        </MyButton>
                    </div>
                ),
            });
        }

        return base;
    }, [isHrAdmin, t]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-2xl text-body text-muted-foreground">
                    {t('intro')}
                </p>
                {isHrAdmin && (
                    <div className="flex flex-wrap items-center gap-3">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            disable={rows.length === 0}
                            onClick={() => setAssignOpen(true)}
                        >
                            <UsersThree size={18} /> {t('assignToEmployees')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => {
                                setEditing(null);
                                setDialogOpen(true);
                            }}
                        >
                            <Plus size={18} /> {t('addShift')}
                        </MyButton>
                    </div>
                )}
            </div>

            {query.isLoading ? (
                <HrLoadingRows rows={3} />
            ) : query.isError ? (
                <HrErrorState
                    message={t('loadError')}
                    onRetry={() => void query.refetch()}
                />
            ) : rows.length === 0 ? (
                <HrEmptyState
                    icon={<Clock size={36} className="text-muted-foreground" />}
                    title={t('emptyTitle')}
                    description={t('emptyDescription')}
                >
                    {isHrAdmin && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => {
                                setEditing(null);
                                setDialogOpen(true);
                            }}
                        >
                            <Plus size={18} /> {t('addFirstShift')}
                        </MyButton>
                    )}
                </HrEmptyState>
            ) : (
                <MyTable<ShiftDTO>
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

            {isHrAdmin && (
                <>
                    <ShiftDialog open={dialogOpen} onOpenChange={setDialogOpen} shift={editing} />
                    <AssignShiftDialog
                        open={assignOpen}
                        onOpenChange={setAssignOpen}
                        shifts={rows}
                    />
                </>
            )}
        </div>
    );
};
