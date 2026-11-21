import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Plus, Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MoneyCell, formatMoney } from '@/components/design-system/money-cell';
import { Card } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
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
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import { formatDate } from '@/lib/formatters';
import { useHrRole } from '@/hooks/use-hr-role';
import {
    createChallan,
    deleteChallan,
    fetchChallans,
    hrKeys,
} from '@/routes/erp/-shared/hr-service';
import type { TdsChallanDTO } from '@/routes/erp/-shared/hr-types';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
    HrNoAccessCard,
} from '@/routes/erp/people/-components/HrStates';
import { HrTextField } from '@/routes/erp/people/-components/HrFormFields';
import { FY_QUARTERS, financialYearOf, recentFinancialYears } from './compliance-shared';

const buildSchema = (t: TFunction) =>
    z.object({
        financialYear: z.string().regex(/^\d{4}-\d{2}$/, t('validation.financialYearFormat')),
        quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']),
        depositDate: z.string().min(1, t('validation.depositDateRequired')),
        amount: z.coerce.number().positive(t('validation.amountPositive')),
        bsrCode: z.string().optional(),
        challanSerial: z.string().optional(),
        interest: z.coerce.number().min(0).optional(),
        fee: z.coerce.number().min(0).optional(),
        notes: z.string().optional(),
    });

type ChallanForm = z.infer<ReturnType<typeof buildSchema>>;

/**
 * The TDS challan register.
 *
 * Every deposit recorded here is what Form 24Q reconciles the quarter's withheld
 * TDS against — an unrecorded challan shows up there as a mismatch, which is why
 * this screen exists separately from the filing itself.
 */
export const ChallansMain = () => {
    const { t } = useTranslation('erpChallansMain');
    const { isHrAdmin } = useHrRole();
    const queryClient = useQueryClient();
    const [financialYear, setFinancialYear] = useState(() => financialYearOf());
    const [quarter, setQuarter] = useState<string>('Q1');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<TdsChallanDTO | null>(null);

    const query = useQuery({
        queryKey: hrKeys.challans(financialYear, quarter),
        queryFn: () => fetchChallans(financialYear, quarter),
        enabled: !!getInstituteId() && isHrAdmin,
    });

    const challans = useMemo(() => query.data ?? [], [query.data]);
    const total = useMemo(
        () => challans.reduce((sum, c) => sum + Number(c.amount ?? 0), 0),
        [challans]
    );

    const schema = useMemo(() => buildSchema(t), [t]);

    const form = useForm<ChallanForm>({
        resolver: zodResolver(schema),
        defaultValues: {
            financialYear,
            quarter: 'Q1',
            depositDate: '',
            amount: 0,
            bsrCode: '',
            challanSerial: '',
            notes: '',
        },
    });

    const createMutation = useMutation({
        mutationFn: (values: ChallanForm) =>
            createChallan({
                financialYear: values.financialYear,
                quarter: values.quarter,
                depositDate: values.depositDate,
                amount: values.amount,
                bsrCode: values.bsrCode || undefined,
                challanSerial: values.challanSerial || undefined,
                interest: values.interest,
                fee: values.fee,
                notes: values.notes || undefined,
            }),
        onSuccess: () => {
            toast.success(t('toast.recorded'));
            setDialogOpen(false);
            form.reset({ ...form.getValues(), amount: 0, depositDate: '', challanSerial: '' });
            void queryClient.invalidateQueries({ queryKey: hrKeys.challans(financialYear, quarter) });
        },
        onError: (error) =>
            reportApiError(error, {
                feature: 'erp-compliance',
                fallbackMessage: t('errors.record'),
            }),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteChallan(id),
        onSuccess: () => {
            toast.success(t('toast.removed'));
            setPendingDelete(null);
            void queryClient.invalidateQueries({ queryKey: hrKeys.challans(financialYear, quarter) });
        },
        onError: (error) =>
            reportApiError(error, {
                feature: 'erp-compliance',
                fallbackMessage: t('errors.remove'),
            }),
    });

    if (!isHrAdmin) return <HrNoAccessCard />;

    return (
        <div className="flex flex-col gap-5">
            <p className="text-body text-neutral-500">{t('description')}</p>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <MyDropdown
                        currentValue={financialYear}
                        dropdownList={recentFinancialYears()}
                        handleChange={(v) => setFinancialYear(String(v))}
                    />
                    <MyDropdown
                        currentValue={FY_QUARTERS.find((q) => q.value === quarter)?.label ?? quarter}
                        dropdownList={FY_QUARTERS.map((q) => q.label)}
                        handleChange={(v) =>
                            setQuarter(FY_QUARTERS.find((q) => q.label === String(v))?.value ?? 'Q1')
                        }
                    />
                </div>
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={() => {
                        form.reset({
                            financialYear,
                            quarter: quarter as ChallanForm['quarter'],
                            depositDate: '',
                            amount: 0,
                            bsrCode: '',
                            challanSerial: '',
                            notes: '',
                        });
                        setDialogOpen(true);
                    }}
                >
                    <Plus size={16} />
                    {t('recordChallan')}
                </MyButton>
            </div>

            {query.isLoading ? (
                <HrLoadingRows rows={4} />
            ) : query.isError ? (
                <HrErrorState message={t('errors.load')} onRetry={() => void query.refetch()} />
            ) : challans.length === 0 ? (
                <HrEmptyState
                    title={t('empty.title')}
                    description={t('empty.description', { financialYear, quarter })}
                />
            ) : (
                <Card className="overflow-x-auto p-0">
                    <table className="w-full text-body">
                        <thead>
                            <tr className="border-b border-neutral-200 bg-neutral-50 text-caption uppercase text-neutral-500">
                                <th className="px-4 py-2 text-start font-medium">
                                    {t('table.depositDate')}
                                </th>
                                <th className="px-4 py-2 text-start font-medium">
                                    {t('table.bsrCode')}
                                </th>
                                <th className="px-4 py-2 text-start font-medium">
                                    {t('table.serial')}
                                </th>
                                <th className="px-4 py-2 text-end font-medium">{t('table.amount')}</th>
                                <th className="px-4 py-2 text-end font-medium">
                                    {t('table.interest')}
                                </th>
                                <th className="px-4 py-2 text-end font-medium">{t('table.fee')}</th>
                                <th className="px-4 py-2 text-end font-medium" />
                            </tr>
                        </thead>
                        <tbody>
                            {challans.map((c) => (
                                <tr key={c.id} className="border-b border-neutral-100 last:border-0">
                                    <td className="px-4 py-2.5 text-neutral-700">
                                        {c.depositDate ? formatDate(c.depositDate) : '—'}
                                    </td>
                                    <td className="px-4 py-2.5 tabular-nums text-neutral-600">
                                        {c.bsrCode || '—'}
                                    </td>
                                    <td className="px-4 py-2.5 tabular-nums text-neutral-600">
                                        {c.challanSerial || '—'}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <MoneyCell value={c.amount ?? null} />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <MoneyCell value={c.interest ?? null} dashOnZero />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <MoneyCell value={c.fee ?? null} dashOnZero />
                                    </td>
                                    <td className="px-4 py-2.5 text-end">
                                        <MyButton
                                            buttonType="text"
                                            scale="small"
                                            layoutVariant="icon"
                                            onClick={() => setPendingDelete(c)}
                                            aria-label={t('removeChallanAria')}
                                        >
                                            <Trash size={15} className="text-danger-600" />
                                        </MyButton>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t border-neutral-200 font-medium">
                                <td className="px-4 py-2.5 text-neutral-700" colSpan={3}>
                                    {t('totalDeposited', { financialYear, quarter })}
                                </td>
                                <td className="px-4 py-2.5">
                                    <MoneyCell value={total} />
                                </td>
                                <td colSpan={3} />
                            </tr>
                        </tfoot>
                    </table>
                </Card>
            )}

            <MyDialog
                heading={t('dialog.heading')}
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                dialogWidth="max-w-xl"
                footer={
                    <div className="flex justify-end gap-2">
                        <MyButton buttonType="secondary" onClick={() => setDialogOpen(false)}>
                            {t('dialog.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onAsyncClick={form.handleSubmit(async (values) => {
                                await createMutation.mutateAsync(values);
                            })}
                            loadingText={t('dialog.saving')}
                        >
                            {t('dialog.save')}
                        </MyButton>
                    </div>
                }
            >
                <Form {...form}>
                    <form className="flex flex-col gap-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <HrTextField
                                control={form.control}
                                name="financialYear"
                                label={t('fields.financialYear')}
                                placeholder={t('fields.financialYearPlaceholder')}
                            />
                            <div className="flex flex-col gap-1.5">
                                <span className="text-caption text-neutral-600">
                                    {t('fields.quarter')}
                                </span>
                                <MyDropdown
                                    currentValue={
                                        FY_QUARTERS.find((q) => q.value === form.watch('quarter'))
                                            ?.label
                                    }
                                    dropdownList={FY_QUARTERS.map((q) => q.label)}
                                    handleChange={(v) =>
                                        form.setValue(
                                            'quarter',
                                            (FY_QUARTERS.find((q) => q.label === String(v))?.value ??
                                                'Q1') as ChallanForm['quarter']
                                        )
                                    }
                                />
                            </div>
                            <HrTextField
                                control={form.control}
                                name="depositDate"
                                label={t('fields.depositDate')}
                                inputType="date"
                            />
                            <HrTextField
                                control={form.control}
                                name="amount"
                                label={t('fields.amountDeposited')}
                                inputType="number"
                            />
                            <HrTextField
                                control={form.control}
                                name="bsrCode"
                                label={t('fields.bsrCode')}
                                placeholder={t('fields.bsrCodePlaceholder')}
                            />
                            <HrTextField
                                control={form.control}
                                name="challanSerial"
                                label={t('fields.challanSerial')}
                            />
                            <HrTextField
                                control={form.control}
                                name="interest"
                                label={t('fields.interest')}
                                inputType="number"
                            />
                            <HrTextField
                                control={form.control}
                                name="fee"
                                label={t('fields.fee')}
                                inputType="number"
                            />
                        </div>
                        <HrTextField control={form.control} name="notes" label={t('fields.notes')} />
                    </form>
                </Form>
            </MyDialog>

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
                                      amount: formatMoney(pendingDelete.amount ?? 0),
                                      date: pendingDelete.depositDate
                                          ? formatDate(pendingDelete.depositDate)
                                          : t('deleteDialog.unknownDate'),
                                  })
                                : ''}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('deleteDialog.keepIt')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => pendingDelete?.id && deleteMutation.mutate(pendingDelete.id)}
                        >
                            {t('deleteDialog.remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
