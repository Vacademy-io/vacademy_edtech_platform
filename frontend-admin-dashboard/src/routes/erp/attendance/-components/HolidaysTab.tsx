import { useMemo, useState } from 'react';
import { CalendarX, ListPlus, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
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
import { formatDate } from '@/lib/formatters';
import { reportApiError } from '@/lib/report-api-error';
import { humanizeToken } from '@/routes/erp/people/-components/EmployeeFields';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
} from '@/routes/erp/people/-components/HrStates';
import type { HolidayDTO } from '@/routes/erp/-shared/hr-types';
import { useDeleteHoliday, useHolidays } from '../-hooks/use-attendance';
import { monthOf } from './attendance-meta';
import { BulkHolidaysDialog } from './BulkHolidaysDialog';
import { HolidayDialog } from './HolidayDialog';

const MONTH_KEYS = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
];

/** The years worth offering: last year (still being corrected) through next year (being planned). */
const selectableYears = (): number[] => {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
};

/**
 * The institute's holiday calendar for one year.
 *
 * Grouped by month rather than listed flat: a holiday calendar is read to answer
 * "what's closed in March", and a 20-row flat list makes that a scan. Attendance
 * marks these days HOLIDAY automatically, which is why they are configured here
 * and not marked by hand on the daily board.
 */
export const HolidaysTab = ({ isHrAdmin }: { isHrAdmin: boolean }) => {
    const { t } = useTranslation('erpHolidaysTab');
    const [year, setYear] = useState<number>(() => new Date().getFullYear());
    const [editing, setEditing] = useState<HolidayDTO | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<HolidayDTO | null>(null);

    const query = useHolidays(year);
    const deleteMutation = useDeleteHoliday(year);

    const grouped = useMemo(() => {
        const buckets = new Map<number, HolidayDTO[]>();
        (query.data ?? []).forEach((holiday) => {
            const { month } = monthOf(holiday.date ?? '');
            const list = buckets.get(month) ?? [];
            list.push(holiday);
            buckets.set(month, list);
        });
        return Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([month, holidays]) => ({
                month,
                holidays: holidays
                    .slice()
                    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
            }));
    }, [query.data]);

    const total = query.data?.length ?? 0;

    const confirmDelete = async () => {
        if (!pendingDelete?.id) return;
        try {
            await deleteMutation.mutateAsync(pendingDelete.id);
            toast.success(t('toast.removed'));
            setPendingDelete(null);
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-attendance',
                tags: { action: 'delete-holiday' },
                fallbackMessage: t('errors.removeFailed'),
            });
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-2xl text-body text-muted-foreground">
                    {t('description')}
                </p>
                {isHrAdmin && (
                    <div className="flex flex-wrap items-center gap-3">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setBulkOpen(true)}
                        >
                            <ListPlus size={18} /> {t('actions.addSeveral')}
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
                            <Plus size={18} /> {t('actions.addHoliday')}
                        </MyButton>
                    </div>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <div className="w-32">
                    <MyDropdown
                        currentValue={String(year)}
                        dropdownList={selectableYears().map((option) => String(option))}
                        handleChange={(value) => setYear(Number(value))}
                    />
                </div>
                <span className="text-caption text-muted-foreground">
                    {t('count', { count: total, year })}
                </span>
            </div>

            {query.isLoading ? (
                <HrLoadingRows rows={3} />
            ) : query.isError ? (
                <HrErrorState
                    message={t('errors.loadFailed')}
                    onRetry={() => void query.refetch()}
                />
            ) : grouped.length === 0 ? (
                <HrEmptyState
                    icon={<CalendarX size={36} className="text-muted-foreground" />}
                    title={t('empty.title', { year })}
                    description={t('empty.description')}
                >
                    {isHrAdmin && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setBulkOpen(true)}
                        >
                            <ListPlus size={18} /> {t('actions.addYearsHolidays')}
                        </MyButton>
                    )}
                </HrEmptyState>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {grouped.map((group) => (
                        <Card key={group.month} className="flex flex-col gap-3 p-4">
                            <h3 className="text-subtitle font-medium text-foreground">
                                {MONTH_KEYS[group.month - 1]
                                    ? t(`months.${MONTH_KEYS[group.month - 1]}`)
                                    : t('months.unknown', { month: group.month })}
                            </h3>
                            <ul className="flex flex-col gap-3">
                                {group.holidays.map((holiday) => (
                                    <li
                                        key={holiday.id ?? `${holiday.date}-${holiday.name}`}
                                        className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                                    >
                                        <div className="flex min-w-0 flex-col gap-1">
                                            <span className="truncate text-body font-semibold text-foreground">
                                                {holiday.name || t('holiday.defaultName')}
                                            </span>
                                            <span className="text-caption text-muted-foreground">
                                                {holiday.date ? formatDate(holiday.date) : '—'}
                                            </span>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {holiday.type && (
                                                    <StatusChip
                                                        text={humanizeToken(holiday.type)}
                                                        textSize="text-caption"
                                                        status="INFO"
                                                        showIcon={false}
                                                    />
                                                )}
                                                {holiday.is_optional && (
                                                    <StatusChip
                                                        text={t('holiday.optional')}
                                                        textSize="text-caption"
                                                        status="WARNING"
                                                        showIcon={false}
                                                    />
                                                )}
                                            </div>
                                            {holiday.description && (
                                                <span className="text-caption text-muted-foreground">
                                                    {holiday.description}
                                                </span>
                                            )}
                                        </div>
                                        {isHrAdmin && (
                                            <div className="flex shrink-0 items-center gap-1">
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    scale="small"
                                                    layoutVariant="icon"
                                                    aria-label={t('actions.edit', {
                                                        name: holiday.name ?? t('actions.editFallback'),
                                                    })}
                                                    onClick={() => {
                                                        setEditing(holiday);
                                                        setDialogOpen(true);
                                                    }}
                                                >
                                                    <PencilSimple size={15} />
                                                </MyButton>
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    scale="small"
                                                    layoutVariant="icon"
                                                    aria-label={t('actions.remove', {
                                                        name: holiday.name ?? t('actions.editFallback'),
                                                    })}
                                                    onClick={() => setPendingDelete(holiday)}
                                                >
                                                    <Trash size={15} className="text-danger-600" />
                                                </MyButton>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    ))}
                </div>
            )}

            {isHrAdmin && (
                <>
                    <HolidayDialog
                        open={dialogOpen}
                        onOpenChange={setDialogOpen}
                        holiday={editing}
                        year={year}
                    />
                    <BulkHolidaysDialog open={bulkOpen} onOpenChange={setBulkOpen} year={year} />
                    <AlertDialog
                        open={!!pendingDelete}
                        onOpenChange={(open) => !open && setPendingDelete(null)}
                    >
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {pendingDelete
                                        ? t('deleteDialog.description', {
                                              name: pendingDelete.name ?? t('deleteDialog.defaultName'),
                                              date: pendingDelete.date
                                                  ? formatDate(pendingDelete.date)
                                                  : t('deleteDialog.unknownDate'),
                                          })
                                        : ''}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>{t('actions.keepIt')}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => void confirmDelete()}>
                                    {t('actions.removeConfirm')}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </>
            )}
        </div>
    );
};
