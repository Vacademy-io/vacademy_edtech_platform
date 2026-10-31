import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Lock, Plus, Trash, Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import {
    MonthPicker,
    currentMonthValue,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getInstituteId } from '@/constants/helper';
import { useHrRole } from '@/hooks/use-hr-role';
import { reportApiError } from '@/lib/report-api-error';
import { formatEmployeeLabel } from '@/routes/erp/-shared/EmployeePicker';
import {
    deleteAdjustment,
    fetchAdjustments,
    fetchEmployees,
    hrKeys,
} from '@/routes/erp/-shared/hr-service';
import type { PayrollAdjustmentDTO } from '@/routes/erp/-shared/hr-types';
import { AdjustmentDialog } from './AdjustmentDialog';
import { AdjustmentTypeChip, RunScopeChip } from './adjustment-meta';
import { IncentivesTab } from './IncentivesTab';
import { TeachingPayTab } from './TeachingPayTab';

/**
 * Adjustments carry `employee_id` only, so a name map is fetched alongside them.
 * Deliberately unfiltered by status and a page bigger than the picker's: an FNF
 * adjustment belongs to someone who has already left, and showing a raw UUID for
 * them would be worse than one extra request.
 */
const NAME_MAP_PAGE_SIZE = 200;

/**
 * Variable Pay: everything that lands on a payroll run as a one-off amount.
 *
 * Three tabs, one screen, because all three end up in the same place — an
 * hr_payroll_adjustment row the next matching run consumes. Adjustments is the
 * manual entry; Teaching Pay and Incentives are the two computed sources that
 * write the same kind of row from LMS teaching activity and collected CRM revenue.
 * Splitting them across routes would hide that they all compete for one run.
 *
 * The HR gate lives here rather than per tab: it is the whole screen that is
 * restricted, and repeating the card three times would let one tab drift.
 */
export const AdjustmentsMain = () => {
    const { t } = useTranslation('erpAdjustmentsMain');
    const { isHrStaff } = useHrRole();

    if (!isHrStaff) {
        return (
            <Card className="mx-auto max-w-xl">
                <CardHeader className="flex flex-row items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
                        <Lock size={20} />
                    </span>
                    <CardTitle className="text-title">{t('restricted.title')}</CardTitle>
                </CardHeader>
                <CardContent className="text-body text-neutral-600">
                    {t('restricted.description')}
                </CardContent>
            </Card>
        );
    }

    return (
        <Tabs defaultValue="adjustments" className="flex flex-col gap-4">
            <TabsList className="w-fit">
                <TabsTrigger value="adjustments">{t('tabs.adjustments')}</TabsTrigger>
                <TabsTrigger value="teaching">{t('tabs.teachingPay')}</TabsTrigger>
                <TabsTrigger value="incentives">{t('tabs.incentives')}</TabsTrigger>
            </TabsList>

            <TabsContent value="adjustments" className="mt-0">
                <AdjustmentsTab />
            </TabsContent>
            <TabsContent value="teaching" className="mt-0">
                <TeachingPayTab />
            </TabsContent>
            <TabsContent value="incentives" className="mt-0">
                <IncentivesTab />
            </TabsContent>
        </Tabs>
    );
};

const AdjustmentsTab = () => {
    const { t } = useTranslation('erpAdjustmentsMain');
    const { isHrAdmin, isHrStaff } = useHrRole();
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();

    const [month, setMonth] = useState<MonthValue>(currentMonthValue());
    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<PayrollAdjustmentDTO | null>(null);

    const adjustmentsQuery = useQuery({
        queryKey: hrKeys.adjustments(month.year, month.month),
        queryFn: () => fetchAdjustments(month.year, month.month),
        enabled: !!instituteId && isHrStaff,
    });

    const employeesQuery = useQuery({
        queryKey: hrKeys.employees({ size: NAME_MAP_PAGE_SIZE }),
        queryFn: () => fetchEmployees({ size: NAME_MAP_PAGE_SIZE }),
        enabled: !!instituteId && isHrStaff,
    });

    const employeeLabels = useMemo(() => {
        const map = new Map<string, string>();
        for (const employee of employeesQuery.data?.content ?? []) {
            if (employee.id) map.set(employee.id, formatEmployeeLabel(employee));
        }
        return map;
    }, [employeesQuery.data]);

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdjustment(id),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: hrKeys.adjustments(month.year, month.month),
            });
            toast.success(t('toast.removed'));
            setPendingDelete(null);
        },
        onError: (error) => {
            // The backend refuses to delete an adjustment a payroll run already
            // consumed; its message says so, so let it through untouched.
            reportApiError(error, {
                feature: 'erp-adjustments',
                tags: { action: 'delete-adjustment' },
                fallbackMessage: t('errors.deleteFailed'),
            });
            setPendingDelete(null);
        },
    });

    const rows = useMemo(() => adjustmentsQuery.data ?? [], [adjustmentsQuery.data]);

    const columns = useMemo<ColumnDef<PayrollAdjustmentDTO>[]>(
        () => [
            {
                id: 'employee',
                header: t('columns.employee'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-700">
                        {employeeLabels.get(row.original.employee_id ?? '') ??
                            row.original.employee_id ??
                            '—'}
                    </span>
                ),
            },
            {
                id: 'type',
                header: t('columns.type'),
                cell: ({ row }) => <AdjustmentTypeChip type={row.original.type} />,
            },
            {
                id: 'code',
                header: t('columns.code'),
                cell: ({ row }) => (
                    <span className="font-mono text-caption text-neutral-600">
                        {row.original.code ?? '—'}
                    </span>
                ),
            },
            {
                id: 'label',
                header: t('columns.label'),
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="text-body text-neutral-700">
                            {row.original.label ?? '—'}
                        </span>
                        {row.original.notes && (
                            <span className="truncate text-caption text-neutral-500">
                                {row.original.notes}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'amount',
                header: t('columns.amount'),
                cell: ({ row }) => (
                    <MoneyCell
                        value={row.original.amount}
                        currency={row.original.currency}
                        tone={
                            (row.original.type ?? '').toUpperCase() === 'DEDUCTION'
                                ? 'deduction'
                                : 'earning'
                        }
                    />
                ),
            },
            {
                id: 'run_scope',
                header: t('columns.runScope'),
                cell: ({ row }) => <RunScopeChip scope={row.original.run_scope} />,
            },
            {
                id: 'source',
                header: t('columns.source'),
                cell: ({ row }) => (
                    <span className="text-caption text-neutral-500">
                        {row.original.source ?? t('manualSource')}
                    </span>
                ),
            },
            {
                id: 'consumed',
                header: t('columns.pickedUp'),
                cell: ({ row }) =>
                    row.original.payroll_entry_id ? (
                        <StatusChip
                            text={t('inPayroll')}
                            textSize="text-caption"
                            status="SUCCESS"
                            showIcon={false}
                        />
                    ) : (
                        <StatusChip
                            text={t('pending')}
                            textSize="text-caption"
                            status="INFO"
                            showIcon={false}
                        />
                    ),
            },
            ...(isHrAdmin
                ? [
                      {
                          id: 'actions',
                          header: '',
                          cell: ({ row }) =>
                              row.original.payroll_entry_id ? (
                                  <span className="text-caption text-neutral-400">
                                      {t('locked')}
                                  </span>
                              ) : (
                                  <MyButton
                                      buttonType="text"
                                      scale="small"
                                      layoutVariant="icon"
                                      aria-label={t('removeAdjustment', {
                                          label: row.original.label ?? t('adjustmentNoun'),
                                      })}
                                      onClick={() => setPendingDelete(row.original)}
                                  >
                                      <Trash size={16} className="text-danger-600" />
                                  </MyButton>
                              ),
                      } as ColumnDef<PayrollAdjustmentDTO>,
                  ]
                : []),
        ],
        [employeeLabels, isHrAdmin, t]
    );

    const tableData: TableData<PayrollAdjustmentDTO> = {
        content: rows,
        total_pages: 1,
        page_no: 0,
        page_size: rows.length,
        total_elements: rows.length,
        last: true,
    };

    return (
        <div className="flex flex-col gap-4">
            <p className="max-w-3xl text-body text-neutral-600">{t('intro')}</p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <MonthPicker label={t('monthLabel')} value={month} onChange={setMonth} />
                {isHrAdmin && (
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setDialogOpen(true)}
                    >
                        <Plus size={16} />
                        {t('addAdjustment')}
                    </MyButton>
                )}
            </div>

            {adjustmentsQuery.isError ? (
                <Card>
                    <CardContent className="flex flex-col items-start gap-3 p-6">
                        <div className="flex items-center gap-2 text-body text-danger-600">
                            <Warning size={18} />
                            {t('errors.loadFailed')}
                        </div>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onAsyncClick={async () => {
                                await adjustmentsQuery.refetch();
                            }}
                            loadingText={t('retrying')}
                        >
                            {t('retry')}
                        </MyButton>
                    </CardContent>
                </Card>
            ) : !adjustmentsQuery.isLoading && rows.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-start gap-3 p-6">
                        <p className="text-subtitle text-neutral-700">{t('emptyState.title')}</p>
                        <p className="max-w-xl text-body text-neutral-600">
                            {t('emptyState.description')}
                        </p>
                        {isHrAdmin && (
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={() => setDialogOpen(true)}
                            >
                                <Plus size={16} />
                                {t('addAdjustment')}
                            </MyButton>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <MyTable<PayrollAdjustmentDTO>
                    data={tableData}
                    columns={columns}
                    isLoading={adjustmentsQuery.isLoading}
                    error={null}
                    currentPage={0}
                    scrollable
                />
            )}

            <AdjustmentDialog open={dialogOpen} onOpenChange={setDialogOpen} month={month} />

            <AlertDialog
                open={!!pendingDelete}
                onOpenChange={(next) => {
                    if (!next) setPendingDelete(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('removeDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('removeDialog.description', {
                                label: pendingDelete?.label ?? t('thisAdjustment'),
                                month: month.month,
                                year: month.year,
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('keepIt')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault();
                                if (pendingDelete?.id) deleteMutation.mutate(pendingDelete.id);
                            }}
                        >
                            {deleteMutation.isPending ? t('removing') : t('remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
