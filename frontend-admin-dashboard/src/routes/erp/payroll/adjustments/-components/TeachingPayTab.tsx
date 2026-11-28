import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { CalendarCheck, Sparkle, Calculator } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import {
    MonthPicker,
    formatMonthValue,
    previousMonthValue,
    type MonthValue,
} from '@/components/design-system/month-picker';
import { StatusChip } from '@/components/design-system/status-chips';
import { MyTable, type TableData } from '@/components/design-system/table';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card } from '@/components/ui/card';
import { useHrRole } from '@/hooks/use-hr-role';
import { cn } from '@/lib/utils';
import { reportApiError } from '@/lib/report-api-error';
import type { TeachingEmployeeSummaryDTO, TeachingPayLineDTO } from '@/routes/erp/-shared/hr-types';
import { HrEmptyState, HrErrorState } from '@/routes/erp/people/-components/HrStates';
import {
    useMaterializeTeachingPay,
    useSyncTeachingAttendance,
    useTeachingPayPreview,
    useTeachingSummary,
} from '../-hooks/use-teaching-pay';
import {
    NoProfileNote,
    UnratedNote,
    VariablePayStat,
    formatCount,
    formatHours,
} from './variable-pay-shared';

/**
 * Variable Pay → Teaching Pay.
 *
 * Turns hosted live sessions into money in three deliberate steps rather than one
 * button: look at the month, sync the teaching days into HR attendance, then price
 * them. They are separate because each one answers a different question and the
 * middle one writes attendance records that payroll (and leave) also read.
 *
 * Nothing here pays anyone. Materializing writes TEACHING_PAY adjustments, which
 * sit on the Adjustments tab until a regular payroll run for that month consumes
 * them — the same lifecycle as a manually entered adjustment.
 */

/** A teacher's month with their priced line attached, once a preview has been run. */
interface TeachingRow {
    key: string;
    employee_id?: string;
    employee_name?: string;
    employee_code?: string;
    no_employee_profile: boolean;
    sessions_scheduled?: number;
    sessions_with_attendance?: number;
    total_taught_minutes?: number;
    pay?: TeachingPayLineDTO;
}

/** userId is the only id every teacher has — one without an HR profile has no employeeId. */
const rowKeyOf = (row: { user_id?: string; employee_id?: string }) =>
    row.user_id || row.employee_id || '';

/**
 * Summary rows joined to pay lines.
 *
 * Both endpoints derive from the same month of teaching, so this is normally a
 * clean one-to-one join; it still merges over the union of the two lists, because
 * a priced teacher who somehow has no summary row is exactly the case where
 * dropping the row would hide money from the person checking it.
 */
function mergeTeachingRows(
    teachers: TeachingEmployeeSummaryDTO[] | undefined,
    lines: TeachingPayLineDTO[] | undefined
): TeachingRow[] {
    const byKey = new Map<string, TeachingRow>();

    for (const teacher of teachers ?? []) {
        const key = rowKeyOf(teacher);
        if (!key) continue;
        byKey.set(key, {
            key,
            employee_id: teacher.employee_id,
            employee_name: teacher.employee_name,
            employee_code: teacher.employee_code,
            no_employee_profile: teacher.no_employee_profile === true,
            sessions_scheduled: teacher.sessions_scheduled,
            sessions_with_attendance: teacher.sessions_with_attendance,
            total_taught_minutes: teacher.total_taught_minutes,
        });
    }

    for (const line of lines ?? []) {
        const key = rowKeyOf(line);
        if (!key) continue;
        const existing = byKey.get(key);
        if (existing) {
            existing.pay = line;
            continue;
        }
        byKey.set(key, {
            key,
            employee_id: line.employee_id,
            employee_name: line.employee_name,
            employee_code: line.employee_code,
            no_employee_profile: (line.status ?? '') === 'NO_EMPLOYEE_PROFILE',
            sessions_with_attendance: line.sessions_with_attendance,
            total_taught_minutes: line.taught_minutes,
            pay: line,
        });
    }

    return [...byKey.values()];
}

const buildPayStatusLabel = (
    t: TFunction
): Record<string, { text: string; status: 'SUCCESS' | 'INFO' | 'WARNING' }> => ({
    ELIGIBLE: { text: t('statusWillBeCreated'), status: 'INFO' },
    CREATED: { text: t('statusAdjustmentCreated'), status: 'SUCCESS' },
    SKIPPED_EXISTING: { text: t('statusAlreadyCreated'), status: 'SUCCESS' },
    UNRATED: { text: t('statusNoRate'), status: 'WARNING' },
    ZERO_QUANTITY: { text: t('statusNothingTaught'), status: 'INFO' },
    NO_EMPLOYEE_PROFILE: { text: t('statusNoHrProfile'), status: 'WARNING' },
});

const buildBasisLabel = (t: TFunction): Record<string, string> => ({
    PER_SESSION: t('basisPerSession'),
    PER_HOUR: t('basisPerHour'),
});

export const TeachingPayTab = () => {
    const { t } = useTranslation('erpTeachingPayTab');
    const { isHrAdmin } = useHrRole();
    const [month, setMonth] = useState<MonthValue>(() => previousMonthValue());
    const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);

    const summaryQuery = useTeachingSummary(month, true);
    const previewQuery = useTeachingPayPreview(month);
    const syncMutation = useSyncTeachingAttendance(month);
    const materializeMutation = useMaterializeTeachingPay(month);

    const pay = previewQuery.data;
    const hasPreview = !!pay;

    const rows = useMemo(
        () => mergeTeachingRows(summaryQuery.data?.teachers, pay?.lines),
        [summaryQuery.data, pay]
    );

    const runPreview = async () => {
        const result = await previewQuery.refetch();
        if (result.error) {
            reportApiError(result.error, {
                feature: 'erp-teaching',
                tags: { action: 'pay-preview' },
                fallbackMessage: t('previewError'),
            });
            return;
        }
        const unrated = result.data?.unrated_count ?? 0;
        toast.success(
            t('pricedToast', {
                count: result.data?.eligible_count ?? 0,
                period: formatMonthValue(month),
            }) + (unrated ? ` · ${t('skippedNoRateSuffix', { count: unrated })}` : '')
        );
    };

    const handleSync = async () => {
        try {
            const result = await syncMutation.mutateAsync();
            const withoutProfile = result.teachers_without_profile?.length ?? 0;
            toast.success(
                t('syncedToast', {
                    period: formatMonthValue(month),
                    created: result.created ?? 0,
                    updated: result.updated ?? 0,
                    skipped: result.skipped ?? 0,
                }) +
                    (withoutProfile
                        ? ` · ${t('skippedNoProfileSuffix', { count: withoutProfile })}`
                        : '')
            );
            setSyncConfirmOpen(false);
        } catch (error) {
            // A payroll-locked month is refused here, and the server's message names
            // the run that locked it — far more useful than anything written here,
            // so it is shown verbatim and this fallback only covers a dead network.
            reportApiError(error, {
                feature: 'erp-teaching',
                tags: { action: 'attendance-sync' },
                fallbackMessage: t('syncError'),
            });
            setSyncConfirmOpen(false);
        }
    };

    const handleMaterialize = async () => {
        try {
            const result = await materializeMutation.mutateAsync();
            const skipped = result.skipped_existing_count ?? 0;
            const unrated = result.unrated_count ?? 0;
            toast.success(
                t('materializedToast', {
                    count: result.created_count ?? 0,
                    period: formatMonthValue(month),
                }) +
                    (skipped ? ` · ${t('alreadyExistedSuffix', { count: skipped })}` : '') +
                    (unrated ? ` · ${t('skippedNoRateSuffix', { count: unrated })}` : '')
            );
            // Invalidation alone would not refresh a query that never auto-runs, and
            // the statuses in the table have just changed from "will be created" to
            // "created" — refetch so the table agrees with what was written.
            await previewQuery.refetch();
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-teaching',
                tags: { action: 'pay-materialize' },
                fallbackMessage: t('materializeError'),
            });
        }
    };

    const payStatusLabel = useMemo(() => buildPayStatusLabel(t), [t]);
    const basisLabel = useMemo(() => buildBasisLabel(t), [t]);

    const columns = useMemo<ColumnDef<TeachingRow>[]>(() => {
        const base: ColumnDef<TeachingRow>[] = [
            {
                id: 'teacher',
                header: t('columnTeacher'),
                cell: ({ row }) => {
                    const r = row.original;
                    const isUnrated = (r.pay?.status ?? '') === 'UNRATED';
                    return (
                        <div className="flex flex-col gap-0.5">
                            <span
                                className={cn(
                                    'text-body',
                                    r.no_employee_profile ? 'text-neutral-400' : 'text-neutral-700'
                                )}
                            >
                                {r.employee_name || r.employee_code || r.key || '—'}
                            </span>
                            {r.no_employee_profile && <NoProfileNote />}
                            {!r.no_employee_profile && isUnrated && <UnratedNote />}
                        </div>
                    );
                },
            },
            {
                id: 'sessions_scheduled',
                header: t('columnSessionsScheduled'),
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'block text-end tabular-nums',
                            row.original.no_employee_profile
                                ? 'text-neutral-400'
                                : 'text-neutral-600'
                        )}
                    >
                        {formatCount(row.original.sessions_scheduled)}
                    </span>
                ),
            },
            {
                id: 'sessions_attended',
                header: t('columnSessionsAttended'),
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'block text-end tabular-nums',
                            row.original.no_employee_profile
                                ? 'text-neutral-400'
                                : 'text-neutral-600'
                        )}
                    >
                        {formatCount(row.original.sessions_with_attendance)}
                    </span>
                ),
            },
            {
                id: 'taught_hours',
                header: t('columnTaughtHours'),
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'block text-end tabular-nums',
                            row.original.no_employee_profile
                                ? 'text-neutral-400'
                                : 'text-neutral-600'
                        )}
                    >
                        {formatHours(row.original.total_taught_minutes)}
                    </span>
                ),
            },
        ];

        // Rate and amount only exist once a preview has been run — showing empty
        // columns beforehand would read as "this teacher earns nothing".
        if (!hasPreview) return base;

        return [
            ...base,
            {
                id: 'rate',
                header: t('columnRate'),
                cell: ({ row }) => {
                    const line = row.original.pay;
                    if (!line?.basis) {
                        return <span className="block text-end text-neutral-300">—</span>;
                    }
                    return (
                        <span className="flex flex-col items-end">
                            <MoneyCell value={line.rate ?? null} />
                            <span className="text-caption text-neutral-500">
                                {basisLabel[line.basis] ?? line.basis}
                            </span>
                        </span>
                    );
                },
            },
            {
                id: 'amount',
                header: t('columnPay'),
                cell: ({ row }) => (
                    <MoneyCell value={row.original.pay?.amount ?? null} dashOnZero />
                ),
            },
            {
                id: 'pay_status',
                header: t('columnStatus'),
                cell: ({ row }) => {
                    const status = row.original.pay?.status;
                    if (!status) return <span className="text-caption text-neutral-400">—</span>;
                    const meta = payStatusLabel[status];
                    return (
                        <StatusChip
                            text={meta?.text ?? status}
                            textSize="text-caption"
                            status={meta?.status ?? 'INFO'}
                            showIcon={false}
                        />
                    );
                },
            },
        ];
    }, [hasPreview, t, basisLabel, payStatusLabel]);

    const tableData: TableData<TeachingRow> = {
        content: rows,
        total_pages: 1,
        page_no: 0,
        page_size: rows.length,
        total_elements: rows.length,
        last: true,
    };

    const eligibleCount = pay?.eligible_count ?? 0;

    return (
        <div className="flex flex-col gap-4">
            <p className="max-w-3xl text-body text-neutral-600">{t('pageDescription')}</p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <MonthPicker
                    label={t('teachingMonthLabel')}
                    value={month}
                    onChange={setMonth}
                    disableFuture
                />
                {isHrAdmin && (
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => setSyncConfirmOpen(true)}
                    >
                        <CalendarCheck size={16} />
                        {t('syncAttendanceButton')}
                    </MyButton>
                )}
            </div>

            <Card className="flex flex-wrap items-end justify-between gap-3 p-4">
                <div className="flex flex-col gap-1">
                    <span className="text-subtitle font-medium text-neutral-700">
                        {t('cardHeading', { period: formatMonthValue(month) })}
                    </span>
                    <span className="max-w-xl text-caption text-neutral-500">
                        {t('cardSubtitle')}
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onAsyncClick={runPreview}
                        loadingText={t('computingLoading')}
                    >
                        <Calculator size={16} />
                        {hasPreview ? t('recomputePreviewButton') : t('previewPayButton')}
                    </MyButton>
                    {isHrAdmin && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={handleMaterialize}
                            loadingText={t('creatingLoading')}
                            disabled={!hasPreview || eligibleCount === 0}
                        >
                            <Sparkle size={16} />
                            {t('materializePayButton')}
                        </MyButton>
                    )}
                </div>
            </Card>

            {hasPreview && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <VariablePayStat label={t('statTeachersPriced')} value={pay?.eligible_count ?? 0} />
                    <VariablePayStat
                        label={t('statTotalTeachingPay')}
                        value={pay?.total_amount}
                        isMoney
                    />
                    <VariablePayStat label={t('statNoRateSet')} value={pay?.unrated_count ?? 0} />
                    <VariablePayStat
                        label={t('statAlreadyMaterialized')}
                        value={pay?.skipped_existing_count ?? 0}
                    />
                </div>
            )}

            {summaryQuery.isError ? (
                <HrErrorState
                    message={t('summaryLoadError')}
                    onRetry={() => void summaryQuery.refetch()}
                />
            ) : !summaryQuery.isLoading && rows.length === 0 ? (
                <HrEmptyState
                    title={t('nobodyTaughtTitle')}
                    description={t('nobodyTaughtDescription', { period: formatMonthValue(month) })}
                />
            ) : (
                <MyTable<TeachingRow>
                    data={tableData}
                    columns={columns}
                    isLoading={summaryQuery.isLoading}
                    error={null}
                    currentPage={0}
                    scrollable
                />
            )}

            <AlertDialog
                open={syncConfirmOpen}
                onOpenChange={(next) => {
                    if (!syncMutation.isPending) setSyncConfirmOpen(next);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('syncConfirmTitle', { period: formatMonthValue(month) })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>{t('syncConfirmDescription')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('cancelButton')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault();
                                void handleSync();
                            }}
                        >
                            {syncMutation.isPending
                                ? t('syncingLoading')
                                : t('syncAttendanceButton')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
