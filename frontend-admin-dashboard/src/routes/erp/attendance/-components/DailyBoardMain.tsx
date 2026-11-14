import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { OnChangeFn, RowSelectionState } from '@tanstack/react-table';
import { CalendarBlank, Info, LockKey, MagnifyingGlass, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyInput } from '@/components/design-system/input';
import { MyTable } from '@/components/design-system/table';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDate } from '@/lib/formatters';
import { reportApiError } from '@/lib/report-api-error';
import { useHrRole } from '@/hooks/use-hr-role';
import { humanizeToken } from '@/routes/erp/people/-components/EmployeeFields';
import { useEmployeeOptions } from '@/routes/erp/people/-hooks/use-hr-people';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
    HrNoAccessCard,
} from '@/routes/erp/people/-components/HrStates';
import type { AttendanceRecordDTO, EmployeeProfileDTO } from '@/routes/erp/-shared/hr-types';
import {
    useAttendanceConfig,
    useAttendanceRecords,
    useAttendanceSummary,
    useMarkAttendance,
} from '../-hooks/use-attendance';
import {
    AttendanceStat,
    AttendanceStatusChip,
    MARKABLE_STATUSES,
    dateOnly,
    formatClockTime,
    monthOf,
    toNumber,
    todayIso,
} from './attendance-meta';

/** One employee's standing on the chosen day — the record if there is one, the gap if not. */
interface DayRow {
    employee_id: string;
    employee_code: string;
    employee_name: string;
    record: AttendanceRecordDTO | null;
}

const employeeName = (employee: EmployeeProfileDTO, t: TFunction) =>
    employee.full_name?.trim() || employee.employee_code?.trim() || t('unnamedEmployee');

/**
 * One day of attendance for the whole institute.
 *
 * The point of this screen is the employees who have NO record for the day: the
 * API only returns rows that exist, so an unmarked employee is invisible in the
 * raw response. Every active employee is joined against the day's records so the
 * gaps are what you see and select.
 *
 * The list is a single day on purpose. A month grid of 30 columns × N employees is
 * unreadable at institute size and nothing on it can be acted on without first
 * narrowing to a day anyway — the month is present as a summary strip instead, so
 * the day has context without pretending to be a spreadsheet.
 */
export const DailyBoardMain = () => {
    const { t } = useTranslation('erpDailyBoardMain');
    const { isHrAdmin, isHrStaff } = useHrRole();

    const [date, setDate] = useState<string>(() => todayIso());
    const [search, setSearch] = useState('');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [bulkStatus, setBulkStatus] = useState<string>('PRESENT');
    const [bulkRemarks, setBulkRemarks] = useState('');
    /**
     * The backend's own words when a save is refused. Surfaced verbatim rather than
     * reworded: the month-lock message names the payroll run holding the month, and
     * a paraphrase would drop the one detail that says what to undo.
     */
    const [refusalMessage, setRefusalMessage] = useState<string | null>(null);

    const { month, year } = useMemo(() => monthOf(date), [date]);

    const config = useAttendanceConfig();
    const records = useAttendanceRecords(month, year);
    const summary = useAttendanceSummary(month, year);
    const employees = useEmployeeOptions(isHrStaff);
    const markMutation = useMarkAttendance(year, month);

    const isDayLevel = config.data?.mode === 'DAY_LEVEL';

    /** Changing the day or the filter changes which rows exist — a stale selection would mark the wrong people. */
    useEffect(() => {
        setSelectedIds([]);
        setRefusalMessage(null);
    }, [date]);
    useEffect(() => {
        setSelectedIds([]);
    }, [search]);

    const recordsByEmployee = useMemo(() => {
        const map = new Map<string, AttendanceRecordDTO>();
        (records.data ?? []).forEach((record) => {
            if (dateOnly(record.attendance_date) !== date) return;
            if (record.employee_id) map.set(record.employee_id, record);
        });
        return map;
    }, [records.data, date]);

    const allRows = useMemo<DayRow[]>(
        () =>
            (employees.data?.content ?? [])
                .filter((employee) => !!employee.id)
                .map((employee) => ({
                    employee_id: employee.id as string,
                    employee_code: employee.employee_code ?? '',
                    employee_name: employeeName(employee, t),
                    record: recordsByEmployee.get(employee.id as string) ?? null,
                })),
        [employees.data?.content, recordsByEmployee]
    );

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return allRows;
        return allRows.filter(
            (row) =>
                row.employee_name.toLowerCase().includes(needle) ||
                row.employee_code.toLowerCase().includes(needle)
        );
    }, [allRows, search]);

    const unmarkedCount = useMemo(() => allRows.filter((row) => !row.record).length, [allRows]);

    const monthTotals = useMemo(() => {
        const source = summary.data ?? [];
        return source.reduce<{
            present: number;
            absent: number;
            onLeave: number;
            halfDay: number;
        }>(
            (acc, entry) => ({
                present: acc.present + toNumber(entry.present),
                absent: acc.absent + toNumber(entry.absent),
                onLeave: acc.onLeave + toNumber(entry.on_leave),
                halfDay: acc.halfDay + toNumber(entry.half_day),
            }),
            { present: 0, absent: 0, onLeave: 0, halfDay: 0 }
        );
    }, [summary.data]);

    // ── Row selection, keyed by employee rather than row index ──
    // MyTable reports selection as an index map over the rows it was handed, and a
    // search or a refetch renumbers those. Translating both ways means a selection
    // survives a background refetch instead of silently pointing at someone else.
    const rowSelection = useMemo<RowSelectionState>(() => {
        const state: RowSelectionState = {};
        rows.forEach((row, index) => {
            if (selectedIds.includes(row.employee_id)) state[index] = true;
        });
        return state;
    }, [rows, selectedIds]);

    const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updaterOrValue) => {
        const next =
            typeof updaterOrValue === 'function' ? updaterOrValue(rowSelection) : updaterOrValue;
        const visibleIds = rows.map((row) => row.employee_id);
        const nowSelected = Object.entries(next)
            .filter(([, isSelected]) => isSelected)
            .map(([index]) => rows[Number(index)]?.employee_id)
            .filter((id): id is string => !!id);
        setSelectedIds((prev) => [
            ...prev.filter((id) => !visibleIds.includes(id)),
            ...nowSelected,
        ]);
    };

    const columns = useMemo<ColumnDef<DayRow>[]>(() => {
        const base: ColumnDef<DayRow>[] = [];

        if (isHrAdmin) {
            base.push({
                id: 'checkbox',
                size: 50,
                minSize: 50,
                maxSize: 50,
                enableResizing: false,
                header: ({ table }) => (
                    <Checkbox
                        checked={table.getIsAllRowsSelected()}
                        onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                        aria-label={t('selectAllAria')}
                        className="border-neutral-400 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
                    />
                ),
                cell: ({ row }) => (
                    <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(value) => row.toggleSelected(!!value)}
                        aria-label={t('selectEmployeeAria', { name: row.original.employee_name })}
                        className="flex size-4 items-center justify-center border-neutral-400 shadow-none data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
                    />
                ),
            });
        }

        base.push(
            {
                id: 'employee',
                header: t('columns.employee'),
                size: 220,
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="truncate text-body font-semibold text-foreground">
                            {row.original.employee_name}
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
                id: 'status',
                header: t('columns.status'),
                size: 140,
                cell: ({ row }) => <AttendanceStatusChip status={row.original.record?.status} />,
            }
        );

        if (!isDayLevel) {
            base.push(
                {
                    id: 'check_in',
                    header: t('columns.checkIn'),
                    size: 110,
                    cell: ({ row }) => (
                        <span className="text-body tabular-nums text-foreground">
                            {formatClockTime(row.original.record?.check_in_time)}
                        </span>
                    ),
                },
                {
                    id: 'check_out',
                    header: t('columns.checkOut'),
                    size: 110,
                    cell: ({ row }) => (
                        <span className="text-body tabular-nums text-foreground">
                            {formatClockTime(row.original.record?.check_out_time)}
                        </span>
                    ),
                }
            );
        }

        base.push(
            {
                id: 'hours',
                header: t('columns.hours'),
                size: 90,
                cell: ({ row }) => {
                    const hours = row.original.record?.total_hours;
                    const numeric = toNumber(hours);
                    return (
                        <span className="block text-end text-body tabular-nums text-foreground">
                            {hours === undefined || hours === null || numeric === 0
                                ? '—'
                                : numeric.toFixed(2)}
                        </span>
                    );
                },
            },
            {
                id: 'source',
                header: t('columns.source'),
                size: 120,
                cell: ({ row }) => (
                    <span className="text-body text-muted-foreground">
                        {humanizeToken(row.original.record?.source) || '—'}
                    </span>
                ),
            },
            {
                id: 'remarks',
                header: t('columns.remarks'),
                size: 200,
                cell: ({ row }) => (
                    <span className="truncate text-body text-muted-foreground">
                        {row.original.record?.remarks || '—'}
                    </span>
                ),
            }
        );

        return base;
    }, [isDayLevel, isHrAdmin, t]);

    if (!isHrStaff) return <HrNoAccessCard />;

    const applyBulkStatus = async () => {
        if (selectedIds.length === 0) return;
        setRefusalMessage(null);
        try {
            await markMutation.mutateAsync({
                attendance_date: date,
                records: selectedIds.map((employeeId) => ({
                    employee_id: employeeId,
                    status: bulkStatus,
                    ...(bulkRemarks.trim() ? { remarks: bulkRemarks.trim() } : {}),
                })),
            });
            toast.success(
                t('markSuccess', {
                    count: selectedIds.length,
                    status: humanizeToken(bulkStatus).toLowerCase(),
                })
            );
            setSelectedIds([]);
            setBulkRemarks('');
        } catch (error) {
            // The refusal reason (a payroll-locked month, most often) is the whole
            // message — keep it on screen, not only in a toast that disappears.
            setRefusalMessage(
                reportApiError(error, {
                    feature: 'erp-attendance',
                    tags: { action: 'mark-attendance' },
                    fallbackMessage: t('markError'),
                })
            );
        }
    };

    const isLoading = employees.isLoading || records.isLoading;
    const isError = employees.isError || records.isError;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
                <h2 className="text-h2-semibold text-foreground">{t('heading')}</h2>
                <p className="max-w-3xl text-body text-muted-foreground">
                    {t('subtitle', { date: formatDate(date) })}
                </p>
            </div>

            {/* Month context. The day means little without knowing how the month is going. */}
            {summary.isSuccess && (summary.data ?? []).length > 0 && (
                <div className="flex flex-wrap gap-3">
                    <AttendanceStat label={t('stats.presentThisMonth')} value={monthTotals.present} />
                    <AttendanceStat label={t('stats.absent')} value={monthTotals.absent} />
                    <AttendanceStat label={t('stats.onLeave')} value={monthTotals.onLeave} />
                    <AttendanceStat label={t('stats.halfDays')} value={monthTotals.halfDay} />
                    <AttendanceStat
                        label={t('stats.unmarkedToday')}
                        value={unmarkedCount}
                        hint={unmarkedCount === 0 ? t('stats.everyoneHasRecord') : undefined}
                    />
                </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
                <div className="flex w-52 flex-col gap-1.5">
                    <span className="text-caption text-muted-foreground">{t('dateLabel')}</span>
                    <MyInput
                        inputType="date"
                        input={date}
                        onChangeFunction={(event) => setDate(event.target.value)}
                        inputPlaceholder=""
                        className="w-full sm:w-full"
                    />
                </div>
                <div className="flex w-full flex-col gap-1.5 sm:w-64">
                    <span className="text-caption text-muted-foreground">
                        {t('findEmployeeLabel')}
                    </span>
                    <MyInput
                        inputType="text"
                        input={search}
                        onChangeFunction={(event) => setSearch(event.target.value)}
                        inputPlaceholder={t('findEmployeePlaceholder')}
                        className="w-full sm:w-full"
                    />
                </div>
                {date !== todayIso() && (
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="medium"
                        onClick={() => setDate(todayIso())}
                    >
                        <CalendarBlank size={16} /> {t('backToToday')}
                    </MyButton>
                )}
            </div>

            {/* Persistent explanation of the freeze, so a refusal later is not a surprise. */}
            <div className="flex items-start gap-2 rounded-md border border-info-100 bg-info-50 p-3 text-caption text-neutral-600">
                <LockKey size={16} className="mt-0.5 shrink-0 text-info-600" />
                <span>{t('freezeExplanation')}</span>
            </div>

            {isDayLevel && (
                <p className="flex items-start gap-2 text-caption text-muted-foreground">
                    <Info size={15} className="mt-0.5 shrink-0" />
                    <span>{t('dayLevelExplanation')}</span>
                </p>
            )}

            {refusalMessage && (
                <div className="flex items-start justify-between gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4">
                    <div className="flex items-start gap-2">
                        <LockKey
                            size={18}
                            weight="fill"
                            className="mt-0.5 shrink-0 text-danger-600"
                        />
                        <div className="flex flex-col gap-1">
                            <p className="text-body font-semibold text-danger-600">
                                {t('notSavedTitle')}
                            </p>
                            <p className="text-body text-danger-600">{refusalMessage}</p>
                        </div>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('dismissAria')}
                        onClick={() => setRefusalMessage(null)}
                    >
                        <X size={14} className="text-danger-600" />
                    </MyButton>
                </div>
            )}

            {isHrAdmin && selectedIds.length > 0 && (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
                    <span className="text-body font-semibold text-foreground">
                        {t('bulkBar.markAs', { count: selectedIds.length })}
                    </span>
                    <div className="w-44">
                        <MyDropdown
                            currentValue={humanizeToken(bulkStatus)}
                            dropdownList={MARKABLE_STATUSES.map((status) => humanizeToken(status))}
                            handleChange={(value) => {
                                const match = MARKABLE_STATUSES.find(
                                    (status) => humanizeToken(status) === String(value)
                                );
                                if (match) setBulkStatus(match);
                            }}
                        />
                    </div>
                    <div className="w-full sm:w-64">
                        <MyInput
                            inputType="text"
                            input={bulkRemarks}
                            onChangeFunction={(event) => setBulkRemarks(event.target.value)}
                            inputPlaceholder={t('bulkBar.remarksPlaceholder')}
                            className="w-full sm:w-full"
                        />
                    </div>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={applyBulkStatus}
                        loadingText={t('bulkBar.marking')}
                    >
                        {t('bulkBar.applyTo', { count: selectedIds.length })}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="medium"
                        onClick={() => setSelectedIds([])}
                    >
                        {t('bulkBar.clearSelection')}
                    </MyButton>
                </div>
            )}

            {isLoading ? (
                <HrLoadingRows />
            ) : isError ? (
                <HrErrorState
                    message={t('loadError')}
                    onRetry={() => {
                        void records.refetch();
                        void employees.refetch();
                    }}
                />
            ) : rows.length === 0 ? (
                search.trim() ? (
                    <HrEmptyState
                        icon={<MagnifyingGlass size={36} className="text-muted-foreground" />}
                        title={t('noSearchMatchTitle')}
                        description={t('noSearchMatchDescription')}
                    >
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setSearch('')}
                        >
                            {t('clearSearch')}
                        </MyButton>
                    </HrEmptyState>
                ) : (
                    <HrEmptyState
                        icon={<CalendarBlank size={36} className="text-muted-foreground" />}
                        title={t('noActiveEmployeesTitle')}
                        description={t('noActiveEmployeesDescription')}
                    />
                )
            ) : (
                <MyTable<DayRow>
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
                    rowSelection={rowSelection}
                    onRowSelectionChange={handleRowSelectionChange}
                    scrollable
                />
            )}

            {!isHrAdmin && isHrStaff && (
                <p className="text-caption text-muted-foreground">{t('viewOnlyNote')}</p>
            )}
        </div>
    );
};
